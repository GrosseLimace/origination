import { Component, input, output, effect, inject, untracked, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, ElementRef, DestroyRef, afterNextRender, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, switchMap, map } from 'rxjs/operators';
import { Customer, NoteLastContact, ReminderDue } from '@models';
import { CustomerStore } from '../../data-access/customer.store';
import { CustomersApiService } from '../../data-access/customers-api.service';
import { AppStateService } from '@core/services/app-state.service';
import { REMINDER_DUE_CLASS, reminderDueTier } from '@shared/utils/reminder-due';
import { buildLinkedProducerComponents } from '@shared/utils/linked-producers';
import { profileLinkedIds } from '@shared/utils/producer-profile';
import { CardComponent, CardContentComponent } from '@shared/components/card/card.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { TradeUnitSelectorComponent } from '@core/layout/trade-unit-selector/trade-unit-selector.component';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { CustomerListFilter } from '@core/context/customer-list-filter';
import { CustomerSlotComponent } from '@core/modules/customer-slot.component';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { CustomerListScrollStore } from '../../data-access/customer-list-scroll.store';

/** The follow-up badge on a producer row — the signed-in user's next open reminder for them. */
interface ReminderBadge {
  text: string;
  cssClass: string;
}

interface LastContactInfo {
  text: string;
  daysAgo: number;
  cssClass: string;
}

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardContentComponent, BadgeComponent, TradeUnitSelectorComponent, CustomerSlotComponent],
  // The filter the panel in the list-filter slot sets (the Lists module's saved-list picker).
  providers: [CustomerListFilter],
  host: { class: 'block w-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-list.component.html'
})
export class CustomerListComponent {
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLElement>;

  public customers = input<Customer[]>([]);
  public selectedCustomer = input<Customer | null>(null);
  /** Per-customer "last contacted" aggregate (all trade units, one row per customer with
   *  notes) — feeds the badge cache without the full note download. */
  public noteLastContacts = input<NoteLastContact[]>([]);
  /** The signed-in user's OWN open follow-ups (all producers). Private per user — the API only
   *  returns the caller's — so this badge never reveals another originator's plans. */
  public myReminders = input<ReminderDue[]>([]);
  public loading = input(false);
  /** Extra customers fetched for incoming/outgoing linked-producer lookups (populated by the home
   *  page when a customer is selected in no-TU mode). Folded into the incoming-link map so the
   *  last-contacted date on the card reflects notes from reverse-linked producers. */
  public linkedProducerCustomers = input<Customer[]>([]);
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
  /** Every producer's saved details: the acres on each row, the links the last-contacted badge follows, and what a
   *  saved list's prompts and refines read. */
  private readonly producerProfiles = inject(ProducerProfiles);
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
  /** The last-contact aggregate failed to load and nothing replaced it, so "no contact on record" is
   *  unknown rather than "Never contacted". */
  readonly contactHistoryUnavailable = computed(() =>
    this.appStateService.noteLastContactsLoadFailed() && this.noteLastContacts().length === 0);

  // Performance optimization: Cache last contact info to avoid repeated filtering/sorting
  // Signal so the OnPush template re-renders automatically when the cache is rebuilt.
  lastContactCache = signal(new Map<number, LastContactInfo>());
  /** Per-customer follow-up badge, keyed by customer id. Rebuilt with the last-contact cache. */
  reminderCache = signal(new Map<number, ReminderBadge>());

  private _scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this._rebuildLastContactCache();

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

    // React to customers/last-contact/filteredCustomers changes — filteredCustomers covers the
    // search-with-no-TU case where customers() input is empty but filteredCustomers has results.
    effect(() => {
      this.customers();
      this.filteredCustomers();
      this.noteLastContacts();
      this.linkedProducerCustomers();
      this._rebuildLastContactCache();
    });

    // The follow-up badge rebuilds on its own so adding or completing a reminder repaints the
    // list without redoing the (much larger) last-contact pass over every producer.
    effect(() => {
      this.customers();
      this.filteredCustomers();
      this.myReminders();
      this._rebuildReminderCache();
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

  /** A producer's farm acres, from their saved details; 0 without any. */
  acresOf(customer: Customer): number {
    return this.producerProfiles.profileOf(customer.id)?.totalAcres ?? 0;
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

  /**
   * Builds the follow-up badge for each visible producer: the SOONEST open reminder the signed-in
   * user has for them.
   *
   * Keyed on customerId rather than customerCode, and deliberately NOT walked across the
   * linked-producer group the way last-contact is. A reminder is a personal to-do about the one
   * producer it was set on — surfacing it on a linked producer's row would send the user to the
   * wrong page when they click it.
   */
  private _rebuildReminderCache(): void {
    const rows = this.myReminders();
    if (rows.length === 0) {
      // Skip the allocation entirely in the common case: most producers have no follow-up, and
      // for a brand-new user this runs on every list render.
      if (this.reminderCache().size > 0) this.reminderCache.set(new Map());
      return;
    }

    const soonestByCustomer = new Map<number, number>();
    for (const row of rows) {
      const due = this._parseUtcMs(row.dueAt);
      const existing = soonestByCustomer.get(row.customerId);
      if (existing === undefined || due < existing) soonestByCustomer.set(row.customerId, due);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newCache = new Map<number, ReminderBadge>();
    for (const [customerId, dueMs] of soonestByCustomer) {
      const dueDay = new Date(dueMs);
      dueDay.setHours(0, 0, 0, 0);
      const days = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);

      let text: string;
      if (days < 0) {
        const overdue = Math.abs(days);
        text = overdue === 1 ? 'Follow-up overdue by 1 day' : `Follow-up overdue by ${overdue} days`;
      } else if (days === 0) {
        text = 'Follow-up today';
      } else if (days === 1) {
        text = 'Follow-up tomorrow';
      } else {
        text = `Follow-up in ${days} days`;
      }

      // Colour comes from the shared rule the producer-pane card also reads, so the badge and the
      // card can never disagree about how urgent the same follow-up is.
      newCache.set(customerId, { text, cssClass: REMINDER_DUE_CLASS[reminderDueTier(dueDay)] });
    }

    // New Map reference so the OnPush template re-renders.
    this.reminderCache.set(newCache);
  }

  /** Bare ISO strings from the API are UTC without a Z suffix. */
  private _parseUtcMs(ts: string): number {
    const raw = !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
    return new Date(raw).getTime();
  }

  /**
   * Performance optimization: Pre-calculate all last contact info once
   * instead of filtering/sorting on every render for every customer.
   *
   * Fed by the last-contact aggregate (one row per customer with notes, all trade units)
   * rather than the full note download — O(r + n) where r = customers-with-notes.
   */
  private _rebuildLastContactCache(): void {
    const newCache = new Map<number, LastContactInfo>();

    // Treat bare ISO strings as UTC (API stores DateTime.UtcNow without Z suffix).
    const parseUtc = (ts: string | Date) => {
      const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
      return new Date(raw).getTime();
    };

    // Index the aggregate by customerCode (ODS source ID string) — more stable than
    // customerId. This works even after linked-producer relationships are removed or for
    // cross-TU producers whose customer record isn't in the current loaded set. Rows are
    // already the most-recent CREATED note per customer (createdAt only — pinning/editing
    // is not a new contact event; the server aggregate uses MAX(CreatedAt)).
    const lastByCode = new Map<string, number>();
    for (const row of this.noteLastContacts()) {
      const key = row.customerCode;
      if (!key) continue;
      const ms = parseUtc(row.lastNoteAt);
      const existing = lastByCode.get(key);
      if (existing === undefined || ms > existing) lastByCode.set(key, ms);
    }

    // Calculate last contact for each customer - single pass O(n)
    // Use filteredCustomers when available (covers API search results when no TU is selected
    // and customers() input is empty). Fall back to customers() for TU-filtered loads.
    const customersToCache = this.filteredCustomers().length > 0 ? this.filteredCustomers() : this.customers();

    // Walk the FULL connected component for each customer — same transitive closure used
    // on build-list — so chained links (A→B→C) all surface the latest note across every
    // member of the chain. Without this, A's badge would only see A's own notes plus B's
    // (one hop), missing notes on C even though they're in the same producer network.
    // Includes any linked-producer customers fetched on demand by home page so links across
    // TUs still resolve when the main roster is filtered or empty.
    const allCustomers = [...this.customers(), ...this.linkedProducerCustomers()];
    const profiles = this.producerProfiles.profiles();
    const components = buildLinkedProducerComponents(allCustomers, c => profileLinkedIds(profiles.get(c.id)));

    for (const customer of customersToCache) {
      // Start from the connected component when we have a scoularId — otherwise fall back
      // to direct outgoing links keyed by this customer's id (rare: customers without a
      // scoularId can still have links in their saved details).
      let allCodes: Set<string>;
      if (customer.scoularId) {
        allCodes = components.get(customer.scoularId) ?? new Set([customer.scoularId]);
      } else {
        allCodes = new Set(profileLinkedIds(profiles.get(customer.id)));
      }
      let lastMs = -1;
      for (const code of allCodes) {
        const ms = lastByCode.get(code);
        if (ms !== undefined && ms > lastMs) lastMs = ms;
      }

      if (lastMs < 0) {
        newCache.set(customer.id, {
          text: 'Never contacted',
          daysAgo: -1,
          cssClass: 'text-red-500'
        });
        continue;
      }

      const noteDate = new Date(lastMs);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      noteDate.setHours(0, 0, 0, 0);
      const daysAgo = Math.max(0, Math.round((today.getTime() - noteDate.getTime()) / (1000 * 60 * 60 * 24)));

      let text: string;
      if (daysAgo === 0) text = 'Today';
      else if (daysAgo === 1) text = '1 day ago';
      else if (daysAgo < 30) text = `${daysAgo} days ago`;
      else if (daysAgo < 365) {
        const months = Math.floor(daysAgo / 30);
        text = months === 1 ? '1 month ago' : `${months} months ago`;
      }
      else {
        const years = Math.floor(daysAgo / 365);
        text = years === 1 ? '1 year ago' : `${years} years ago`;
      }

      const cssClass = this._getLastContactClass(daysAgo);

      newCache.set(customer.id, { text, daysAgo, cssClass });
    }

    // Assign new Map reference so the signal notifies the OnPush template to re-render.
    this.lastContactCache.set(newCache);
  }

  getCustomerItemClass(customer: Customer): string {
    const isSelected = this.selectedCustomer()?.id === customer.id;
    const baseClass = 'px-4 py-3 cursor-pointer transition-colors';
    const stateClass = isSelected
      ? 'bg-green-50 dark:bg-green-900/30'
      : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700';
    return `${baseClass} ${stateClass}`;
  }

  private _getLastContactClass(daysAgo: number): string {
    if (daysAgo < 0) return 'text-red-500';
    if (daysAgo <= 7) return 'text-green-500';
    if (daysAgo <= 30) return 'text-yellow-500';
    return 'text-red-500';
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
