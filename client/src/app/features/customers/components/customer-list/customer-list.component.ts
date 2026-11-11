import { Component, input, output, effect, inject, untracked, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, ElementRef, DestroyRef, afterNextRender, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, switchMap, map } from 'rxjs/operators';
import { Customer } from '@models';
import { CustomerStore } from '../../data-access/customer.store';
import { CustomersApiService } from '../../data-access/customers-api.service';
import { AppStateService } from '@core/services/app-state.service';
import { CardComponent, CardContentComponent } from '@shared/components/card/card.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { TradeUnitSelectorComponent } from '@core/layout/trade-unit-selector/trade-unit-selector.component';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { CustomerListFilter } from '@core/context/customer-list-filter';
import { CustomerSlotComponent } from '@core/modules/customer-slot.component';
import { CustomerRowSlotComponent } from '@core/modules/customer-row-slot.component';
import { CustomerListScrollStore } from '../../data-access/customer-list-scroll.store';

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardContentComponent, BadgeComponent, TradeUnitSelectorComponent, CustomerSlotComponent, CustomerRowSlotComponent],
  // The filter the panel in the list-filter slot sets (the Lists module's saved-list picker). Each row's badges are the
  // modules' panels in its row slots: Producers' acres, and Engagement's last-contacted and follow-up lines.
  providers: [CustomerListFilter],
  host: { class: 'block w-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-list.component.html'
})
export class CustomerListComponent {
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLElement>;

  public customers = input<Customer[]>([]);
  public selectedCustomer = input<Customer | null>(null);
  public loading = input(false);
  public selectCustomer = output<Customer>();
  public clearSelection = output<void>();
  /** Emitted once the pointer has rested on a row long enough to suggest a click is coming, so the
   *  parent can warm that producer's contracts and tickets. Dwell-gated: a pointer sweeping down the
   *  list emits nothing, so scrolling past fifty producers costs no requests. */
  public prefetchCustomer = output<Customer>();
  private _hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly PREFETCH_DWELL_MS = 350;

  private readonly customersApi = inject(CustomersApiService);
  private readonly appStateService = inject(AppStateService);
  private readonly customerStore = inject(CustomerStore);
  private readonly tradeUnitContext = inject(TradeUnitContext);
  private readonly scrollStore = inject(CustomerListScrollStore);
  private readonly filter = inject(CustomerListFilter);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _searchSubject$ = new Subject<string>();

  // Plain property for the search input — not a signal, so typing does not mark the
  // component dirty and does not re-render the customer list on each keystroke.
  searchInputValue = '';
  searchLoading = signal(false);
  /** The last producer search errored. The list shows a "search failed" state instead of rows —
   *  never the loaded roster, which would read as everyone matching the term. Cleared by the next
   *  successful search or by leaving search. */
  searchFailed = signal(false);
  filteredCustomers = signal<Customer[]>([]);

  /** A filter from the list-filter slot narrows the list. */
  readonly filtered = computed(() => this.filter.kept().kind !== 'all');
  /** What the list says while the filter is still working out who it keeps, or null. */
  readonly pendingMessage = computed(() => {
    const kept = this.filter.kept();
    return kept.kind === 'pending' ? kept.message : null;
  });

  readonly hasTradeUnitSelection = computed(() =>
    this.tradeUnitContext.selectedTradeUnits().length > 0 || this.tradeUnitContext.selectedGroupNames().length > 0
  );
  /** "All Producers" mode — search spans every producer (our table + ODS onboarding fallback). */
  readonly allProducersMode = computed(() => this.appStateService.allProducersMode());
  /** The trade-unit producer read failed and nothing has replaced it, so an empty list is an outage,
   *  not "no producers". */
  readonly customersLoadFailed = computed(() =>
    this.customerStore.customersLoadFailed() && this.customers().length === 0);

  private _scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Restore state from service
    this.searchInputValue = this.appStateService.searchQuery();
    this.applyFilters();

    // Set up search — switchMap cancels any in-flight request when a new term arrives,
    // preventing stale results from overwriting newer ones.
    // No distinctUntilChanged — allows re-searching the same term (e.g. after clearing and retyping).
    this._searchSubject$.pipe(
      debounceTime(150),
      switchMap(searchTerm => {
        this.searchLoading.set(true);
        const explicitUnits = this.tradeUnitContext.selectedTradeUnits();
        const selectedGroups = this.tradeUnitContext.selectedGroupNames();
        let tradeUnits: string[] | undefined;
        if (explicitUnits.length > 0) {
          tradeUnits = explicitUnits;
        } else if (selectedGroups.length > 0) {
          tradeUnits = this._computeAvailableTradeUnits(this.tradeUnitContext.userGroups(), selectedGroups);
        }
        // Only fall back to the ODS master once the term is specific enough — a 1–2 char
        // term is a broad LIKE scan over the whole customer master (slow) and never a
        // useful onboarding lookup. Keeps short-term typing fast (our-table search only).
        const noScope = explicitUnits.length === 0 && selectedGroups.length === 0;
        const odsEligible = noScope && searchTerm.trim().length >= 3;
        return this.customersApi.searchCustomers(searchTerm, tradeUnits).pipe(
          // Onboarding fallback: when nothing matches in our tables AND no TU/group is
          // selected, look the term up in the ODS customer master so the user can find
          // and onboard a producer who exists in CTRM but has no contract/ticket yet.
          switchMap(results => {
            if (results.length === 0 && odsEligible) {
              return this.customersApi.searchOdsCustomers(searchTerm).pipe(
                map(ods => ods.map(c => ({ ...c, isOnboardCandidate: true }))),
                catchError(() => of([] as Customer[]))
              );
            }
            return of(results);
          }),
          // null marks a failed search. ApiService already toasts 401/403, so the failure is
          // shown inline in the list rather than with a second toast.
          catchError(() => of(null))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(customers => {
      this.searchLoading.set(false);
      if (customers === null) {
        this.searchFailed.set(true);
        this.filteredCustomers.set([]);
        return;
      }
      this.searchFailed.set(false);
      // A search's results are narrowed by the filter too; one still working out who it keeps shows none of them.
      let result = customers;
      const kept = this.filter.kept();
      if (kept.kind === 'some') result = result.filter(c => kept.ids.has(c.id));
      else if (kept.kind === 'pending') result = [];
      this.filteredCustomers.set(result);
    });

    // Scroll to last selected customer after first render
    afterNextRender(() => {
      const lastId = this.scrollStore.lastScrolledCustomerId();
      if (lastId !== null) {
        const el = this.scrollContainer?.nativeElement
          ?.querySelector<HTMLElement>(`#customer-item-${lastId}`);
        if (el) {
          this._scrollItemIntoView(el, 'auto');
        }
      }
    });

    // After an onboarding save the parent re-selects the producer as a real record: the candidate
    // flag cleared and, for a producer found in CTRM, the minted id in place of the search's
    // placeholder. The search-result row that was clicked still carries the candidate, so swap it
    // for the real record here; otherwise a second click on that row would reload the candidate
    // state against an id that no longer means anything. Matched on the producer code, which is the
    // one identifier both sides share. filteredCustomers is read untracked so this cannot loop.
    effect(() => {
      const sel = this.selectedCustomer();
      if (!sel || sel.isOnboardCandidate || !sel.scoularId) return;
      const rows = untracked(() => this.filteredCustomers());
      const index = rows.findIndex(r => r.isOnboardCandidate && r.scoularId === sel.scoularId);
      if (index < 0) return;
      const next = [...rows];
      next[index] = sel;
      this.filteredCustomers.set(next);
    });

    // The filter in the list-filter slot changed which customers the list keeps.
    effect(() => {
      this.filter.kept();
      untracked(() => this.applyFilters());
    });

    // A filter picked: leave the search, so the filter applies to the trade units' customers rather than a search's
    // results. Cleared here rather than through clearSearch, since the filter's own change applies the filters.
    this.filter.picked.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.searchInputValue) return;
      this.searchInputValue = '';
      this.searchLoading.set(false);
      this.appStateService.setSearchQuery('');
      this._cdr.markForCheck();
    });

    // React to customers changing — reapply filters.
    // untracked prevents applyFilters() from implicitly tracking searchQuery, the filter,
    // etc. and causing this effect to fire on every keystroke.
    effect(() => {
      this.customers();
      untracked(() => this.applyFilters());
    });

    // Clear search when the trade unit or group selection changes so stale search
    // results from the previous TU don't persist into the new view.
    let _tuInitialized = false;
    effect(() => {
      this.tradeUnitContext.selectedTradeUnits();
      this.tradeUnitContext.selectedGroupNames();
      if (!_tuInitialized) { _tuInitialized = true; return; }
      untracked(() => {
        // The filter keeps or drops its pick for the new selection itself.
        if (this.searchInputValue) this.clearSearch();
      });
    });

    // React to selectedCustomer changes — scroll into view
    effect(() => {
      const selectedCustomer = this.selectedCustomer();
      if (selectedCustomer) {
        const newId = selectedCustomer.id;
        if (newId !== this.scrollStore.lastScrolledCustomerId()) {
          this.scrollStore.setLastScrolledCustomerId(newId);
          if (this._scrollTimeoutId !== null) clearTimeout(this._scrollTimeoutId);
          this._scrollTimeoutId = setTimeout(() => {
            this._scrollTimeoutId = null;
            const el = this.scrollContainer?.nativeElement
              ?.querySelector<HTMLElement>(`#customer-item-${newId}`);
            if (el) {
              this._scrollItemIntoView(el, 'smooth');
            }
          }, 50);
        }
      }
    });

    this.destroyRef.onDestroy(() => {
      this.onRowLeave();
      if (this._scrollTimeoutId !== null) clearTimeout(this._scrollTimeoutId);
    });
  }

  get selectedTradeUnits(): string[] {
    return this.tradeUnitContext.selectedTradeUnits();
  }

  // ---- Group / trade unit helpers (read-only — for search scoping) ----

  getAvailableTradeUnits(): string[] {
    return this._computeAvailableTradeUnits(
      this.tradeUnitContext.userGroups(),
      this.tradeUnitContext.selectedGroupNames()
    );
  }

  private _computeAvailableTradeUnits(
    groups: { groupName: string; tradeUnitCodes: string[] }[],
    selectedGroups: string[]
  ): string[] {
    if (groups.length <= 1) return groups[0]?.tradeUnitCodes ?? [];
    const filterGroups = selectedGroups.length === 0 ? groups : groups.filter(g => selectedGroups.includes(g.groupName));
    const units = new Set<string>();
    for (const g of filterGroups) {
      g.tradeUnitCodes.forEach(u => units.add(u));
    }
    return [...units].sort();
  }



  /** Scroll a customer item into view within the list container only — never scrolls the document. */
  private _scrollItemIntoView(el: HTMLElement, behavior: ScrollBehavior): void {
    const container = this.scrollContainer?.nativeElement;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const elTop = el.getBoundingClientRect().top;
    const offset = elTop - containerTop;
    const target = container.scrollTop + offset - (container.clientHeight / 2) + (el.clientHeight / 2);
    container.scrollTo({ top: target, behavior });
  }

  onSearchInput(value: string): void {
    const wasNonEmpty = !!this.searchInputValue;
    this.searchInputValue = value;
    this.applyFilters();
    // Only trigger CD when X / Reset button visibility changes (empty↔non-empty transition).
    // During continuous typing (non-empty→non-empty) no CD fires — the customer list is
    // not re-rendered until actual search results arrive via filteredCustomers signal.
    if (!!value !== wasNonEmpty) this._cdr.markForCheck();
  }

  applyFilters(): void {
    const searchTerm = this.searchInputValue.trim().toLowerCase();

    // Save search query to state service
    this.appStateService.setSearchQuery(this.searchInputValue);

    if (searchTerm) {
      // Use API search — scoped to selected TUs when explicitly chosen, global otherwise
      this._searchSubject$.next(searchTerm);
      return;
    }

    // No search term — client-side filter on loaded customers
    this.searchFailed.set(false);
    let result = [...this.customers()];

    // The filter in the list-filter slot. While it is still working out who it keeps, the list keeps what it shows,
    // with the filter's spinner, rather than flashing every customer; one that keeps nobody shows "No customers
    // found".
    const kept = this.filter.kept();
    if (kept.kind === 'pending') return;
    if (kept.kind === 'some') result = result.filter(c => kept.ids.has(c.id));

    this.filteredCustomers.set(result);
  }

  clearSearch(): void {
    this.searchInputValue = '';
    this.searchLoading.set(false);
    this.appStateService.setSearchQuery('');
    this.applyFilters();
  }

  clearAll(): void {
    this.searchInputValue = '';
    this.appStateService.setSearchQuery('');
    this.filter.clear();
    this.tradeUnitContext.setTradeUnits([]);
    this.tradeUnitContext.setSelectedGroupNames([]);
    this.searchFailed.set(false);
    this.filteredCustomers.set([]);
    this.clearSelection.emit();
  }

  getCustomerItemClass(customer: Customer): string {
    const isSelected = this.selectedCustomer()?.id === customer.id;
    const baseClass = 'px-4 py-3 cursor-pointer transition-colors';
    const stateClass = isSelected
      ? 'bg-green-50 dark:bg-green-900/30'
      : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700';
    return `${baseClass} ${stateClass}`;
  }

  getFormattedLocation(customer: Customer): string {
    if (!customer.location && !customer.stateProvince) {
      return '';
    }
    if (customer.location && customer.stateProvince) {
      return `${customer.location}, ${customer.stateProvince}`;
    }
    return customer.location || customer.stateProvince || '';
  }

  getFormattedPhone(phone: string): string {
    if (!phone) return '';
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    // Format as (XXX) XXX-XXXX
    if (cleaned.length === 10) {
      return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
    }
    // Return original if not 10 digits
    return phone;
  }

  onRowEnter(customer: Customer): void {
    this.onRowLeave();
    this._hoverTimer = setTimeout(() => {
      this._hoverTimer = null;
      this.prefetchCustomer.emit(customer);
    }, CustomerListComponent.PREFETCH_DWELL_MS);
  }

  onRowLeave(): void {
    if (this._hoverTimer !== null) {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = null;
    }
  }
}
