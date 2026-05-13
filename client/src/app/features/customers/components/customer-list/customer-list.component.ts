import { Component, input, output, effect, inject, untracked, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, ElementRef, DestroyRef, afterNextRender, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of, forkJoin, takeUntil } from 'rxjs';
import { catchError, debounceTime, switchMap } from 'rxjs/operators';
import { StoredGrain, Ticket, PlantingIntention } from '@models';
import { Customer, SavedList, Note, ProducerDetails } from '@models';
import { MsalService } from '@azure/msal-angular';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { NlqFilterService, NlqFilterContext } from '@core/services/nlq-filter.service';
import { CardComponent, CardContentComponent } from '@shared/components/card/card.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';

interface LastContactInfo {
  text: string;
  daysAgo: number;
  cssClass: string;
}

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardContentComponent, BadgeComponent, TradeUnitSelectorComponent],
  host: { class: 'block w-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-list.component.html'
})
export class CustomerListComponent {
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLElement>;

  public customers = input<Customer[]>([]);
  public selectedCustomer = input<Customer | null>(null);
  public savedLists = input<SavedList[]>([]);
  public notes = input<Note[]>([]);
  public loading = input(false);
  public producerDetailsMap = input(new Map<number, ProducerDetails>());
  /** Extra customers fetched for incoming/outgoing linked-producer lookups (populated by the home
   *  page when a customer is selected in no-TU mode). Folded into the incoming-link map so the
   *  last-contacted date on the card reflects notes from reverse-linked producers. */
  public linkedProducerCustomers = input<Customer[]>([]);
  public selectCustomer = output<Customer>();
  public clearSelection = output<void>();

  private readonly apiService = inject(ApiService);
  private readonly appStateService = inject(AppStateService);
  private readonly msalService = inject(MsalService);
  private readonly nlqFilterService = inject(NlqFilterService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _searchSubject$ = new Subject<string>();

  // Plain property for the search input — not a signal, so typing does not mark the
  // component dirty and does not re-render the customer list on each keystroke.
  searchInputValue = '';
  selectedListId = signal('all');
  savedListLoading = signal(false);
  searchLoading = signal(false);
  filteredCustomers = signal<Customer[]>([]);
  readonly hasTradeUnitSelection = computed(() =>
    this.appStateService.selectedTradeUnits().length > 0 || this.appStateService.selectedGroupNames().length > 0
  );

  // Performance optimization: Cache last contact info to avoid repeated filtering/sorting
  // Signal so the OnPush template re-renders automatically when the cache is rebuilt.
  lastContactCache = signal(new Map<number, LastContactInfo>());

  readonly listMaxHeight = computed(() => {
    const hasSavedLists = !this.loading() && this.getVisibleSavedLists().length > 0;
    return `calc(100vh - ${hasSavedLists ? 21 : 16}rem)`;
  });

  private _scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this._rebuildLastContactCache();

    // Restore state from service
    this.searchInputValue = this.appStateService.searchQuery();
    this.selectedListId.set(this.appStateService.selectedSavedListId() || 'all');

    // Apply the restored list selection — applyFilters will use cached customerIds if available
    if (this.selectedListId() !== 'all') {
      this.applyFilters();
    } else {
      this.applyFilters();
    }

    // Set up search — switchMap cancels any in-flight request when a new term arrives,
    // preventing stale results from overwriting newer ones.
    // No distinctUntilChanged — allows re-searching the same term (e.g. after clearing and retyping).
    this._searchSubject$.pipe(
      debounceTime(150),
      switchMap(searchTerm => {
        this.searchLoading.set(true);
        const explicitUnits = this.appStateService.selectedTradeUnits();
        const selectedGroups = this.appStateService.selectedGroupNames();
        let tradeUnits: string[] | undefined;
        if (explicitUnits.length > 0) {
          tradeUnits = explicitUnits;
        } else if (selectedGroups.length > 0) {
          tradeUnits = this._computeAvailableTradeUnits(this.appStateService.userGroups(), selectedGroups);
        }
        return this.apiService.searchCustomers(searchTerm, tradeUnits).pipe(
          catchError(() => of([...this.customers()]))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(customers => {
      this.searchLoading.set(false);
      let result = customers.map(c => {
        const pd = this.producerDetailsMap().get(c.id);
        if (pd) {
          return {
            ...c,
            totalAcres: pd.totalAcres ?? c.totalAcres,
            binCapacity: pd.binCapacity ?? c.binCapacity,
            primaryContact: pd.primaryContact ?? c.primaryContact,
            commodities: pd.commodities ? pd.commodities.split(',').map(s => s.trim()) : c.commodities
          };
        }
        return c;
      });
      if (this.selectedListId() && this.selectedListId() !== 'all') {
        const savedList = this.savedLists().find(l => String(l.id) === this.selectedListId());
        if (savedList) {
          result = result.filter(c => (savedList.customerIds || []).includes(c.id));
        }
      }
      this.filteredCustomers.set(result);
    });

    // Scroll to last selected customer after first render
    afterNextRender(() => {
      const lastId = this.appStateService.lastScrolledCustomerId();
      if (lastId !== null) {
        const el = this.scrollContainer?.nativeElement
          ?.querySelector<HTMLElement>(`#customer-item-${lastId}`);
        if (el) {
          this._scrollItemIntoView(el, 'auto');
        }
      }
    });

    // React to customers/notes/filteredCustomers changes — filteredCustomers covers the
    // search-with-no-TU case where customers() input is empty but filteredCustomers has results.
    effect(() => {
      this.customers();
      this.filteredCustomers();
      this.notes();
      this.linkedProducerCustomers();
      this._rebuildLastContactCache();
    });

    // React to savedLists changes — validate selectedListId and reapply filters.
    // untracked prevents applyFilters() from adding its own signal reads as
    // effect dependencies, which would cause this effect to re-run on every keystroke.
    effect(() => {
      const savedLists = this.savedLists();
      untracked(() => {
        if (this.selectedListId() !== 'all') {
          const stillExists = savedLists.some(l => String(l.id) === this.selectedListId());
          if (!stillExists) {
            this.selectedListId.set('all');
            this.appStateService.setSelectedSavedListId('all');
          }
        }
        this.applyFilters();
      });
    });

    // React to customers changing — reapply filters.
    // untracked prevents applyFilters() from implicitly tracking searchQuery, savedLists,
    // etc. and causing this effect to fire on every keystroke.
    effect(() => {
      this.customers();
      untracked(() => this.applyFilters());
    });

    // Clear search when the trade unit or group selection changes so stale search
    // results from the previous TU don't persist into the new view.
    let _tuInitialized = false;
    effect(() => {
      this.appStateService.selectedTradeUnits();
      this.appStateService.selectedGroupNames();
      if (!_tuInitialized) { _tuInitialized = true; return; }
      untracked(() => {
        if (this.searchInputValue) this.clearSearch();
        // Reset saved list if the current selection isn't visible for the new TUs
        const currentList = this.selectedListId();
        if (currentList && currentList !== 'all') {
          const visible = this.getVisibleSavedLists();
          if (!visible.some(l => String(l.id) === currentList)) {
            this._cancelSavedList$.next();
            this.savedListLoading.set(false);
            this.selectedListId.set('all');
            this.appStateService.setSelectedSavedListId('all');
          }
        }
      });
    });

    // React to selectedCustomer changes — scroll into view
    effect(() => {
      const selectedCustomer = this.selectedCustomer();
      if (selectedCustomer) {
        const newId = selectedCustomer.id;
        if (newId !== this.appStateService.lastScrolledCustomerId()) {
          this.appStateService.setLastScrolledCustomerId(newId);
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
      if (this._scrollTimeoutId !== null) clearTimeout(this._scrollTimeoutId);
    });
  }

  get selectedTradeUnits(): string[] {
    return this.appStateService.selectedTradeUnits();
  }

  // ---- Group / trade unit helpers (read-only — for search scoping) ----

  getAvailableTradeUnits(): string[] {
    return this._computeAvailableTradeUnits(
      this.appStateService.userGroups(),
      this.appStateService.selectedGroupNames()
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
    let result = [...this.customers()];

    // Apply saved list filter (skip for "all" which means show all customers).
    // Invariant: when a saved list is selected, the only valid outcomes are
    // (a) filter by resolved customerIds, or (b) return early and keep the current
    // view + spinner. We never fall through to "all customers" while a list is selected
    // — that's the back-to-back bug where the second pick briefly showed everyone.
    //
    // We check `customerIds === undefined` (rather than .length) to distinguish
    // "not yet computed" from "computed as zero matches". Zero matches must flow
    // through to filteredCustomers.set([]) so the template renders "No customers
    // found" instead of leaving the previous (often unfiltered) list visible.
    if (this.selectedListId() && this.selectedListId() !== 'all') {
      let savedList = this.savedLists().find(l => String(l.id) === this.selectedListId());
      if (!savedList) {
        // Saved list not in the array yet (mid-refetch / pre-load). Keep current view.
        return;
      }
      if (savedList.customerIds === undefined) {
        this._runSavedListNlq(savedList);
        // _runSavedListNlq may have synchronously called _executeNlq which patches
        // appState via setSavedLists. Re-read so we see the resolved customerIds
        // without waiting for the savedLists effect to re-run applyFilters.
        savedList = this.savedLists().find(l => String(l.id) === this.selectedListId());
      }
      if (savedList?.customerIds === undefined) {
        // Async path (forkJoin in flight) — keep spinner up; the next signal-driven
        // re-run will set filteredCustomers once customerIds resolves (even to []).
        return;
      }
      result = result.filter(c => savedList!.customerIds!.includes(c.id));
    }

    this.filteredCustomers.set(result);
  }

  /** Returns saved lists whose trade units exactly match the currently selected trade units. */
  getVisibleSavedLists(): SavedList[] {
    const selectedTU = this.appStateService.selectedTradeUnits();
    if (selectedTU.length === 0) return [];
    const selectedSet = new Set(selectedTU);
    return this.savedLists().filter(list => {
      if (!list.tradeUnits) return false;
      const listUnits = list.tradeUnits.split(',').map(u => u.trim()).filter(Boolean);
      if (listUnits.length !== selectedSet.size) return false;
      return listUnits.every(u => selectedSet.has(u));
    });
  }

  /** Called when the user selects a saved list from the dropdown. */
  onSavedListChange(): void {
    this._cancelSavedList$.next(); // Cancel any in-flight NLQ from previous list
    const id = this.selectedListId();
    this.appStateService.setSelectedSavedListId(id);
    if (id && id !== 'all') {
      // Show spinner immediately on click so the user gets visual feedback.
      // _runSavedListNlq will either keep it on (async fetch path) or _executeNlq
      // will clear it (synchronous cached path). Without this set-true here, the
      // sync path can paint a single frame of "all customers + no spinner" before
      // the spinner flips on inside _runSavedListNlq.
      this.savedListLoading.set(true);
      // Clear cached customerIds so the NLQ re-runs for the new selection.
      // We mutate directly because savedLists is fed via an input binding from the parent —
      // an immutable swap on appState wouldn't propagate to our input, but a mutation on the
      // shared object reference is visible everywhere that holds it.
      const savedList = this.savedLists().find(l => String(l.id) === id);
      if (savedList) savedList.customerIds = undefined as any;
    } else {
      this.savedListLoading.set(false);
    }
    this.applyFilters();
  }

  private _cancelSavedList$ = new Subject<void>();
  private _activeSavedListRunId = 0;

  /** Runs the NLQ for the active saved list. Only fetches data the query actually needs. */
  private _runSavedListNlq(savedList: SavedList): void {
    // Can't run NLQ without customers — keep spinner up; the customers-input effect
    // re-runs applyFilters() once data lands, which re-enters this method.
    if (this.customers().length === 0) {
      this.savedListLoading.set(true);
      return;
    }

    const runId = ++this._activeSavedListRunId;
    const query = savedList.query;
    const selectedTU = this.appStateService.selectedTradeUnits();
    const tuParam = selectedTU.length > 0 ? selectedTU : undefined;

    // Only fetch data types the query actually needs — skip unnecessary slow fetches
    const missing: Record<string, any> = {};
    if (this.nlqFilterService.queryInvolvesStorage(query) && this.appStateService.storedGrain().length === 0) {
      missing['storedGrain'] = this.apiService.getStoredGrain(tuParam).pipe(catchError(() => of([] as StoredGrain[])));
    }
    if (this.nlqFilterService.queryInvolvesTickets(query) && this.appStateService.tickets().length === 0) {
      missing['tickets'] = this.apiService.getTickets(tuParam).pipe(catchError(() => of([] as Ticket[])));
    }
    if (this.nlqFilterService.queryInvolvesPlanting(query) && this.appStateService.plantingIntentions().length === 0) {
      missing['plantingIntentions'] = this.apiService.getPlantingIntentions(tuParam).pipe(catchError(() => of([] as PlantingIntention[])));
    }
    // Also fetch the query library when the saved list lacks the _promptCategory hint —
    // we use it to resolve dimension by queryText match in applyRefinementFilters.
    if (savedList.filters && !savedList.filters._promptCategory && this.appStateService.queryLibrary().length === 0) {
      missing['queryLibrary'] = this.apiService.getQueryLibrary().pipe(catchError(() => of([] as import('@models').QueryLibraryItem[])));
    }

    if (Object.keys(missing).length > 0) {
      this.savedListLoading.set(true);
      forkJoin(missing).pipe(takeUntil(this._cancelSavedList$), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (results: any) => {
          // Stale-response guard — ignore callbacks from a superseded selection.
          if (runId !== this._activeSavedListRunId) return;
          if (results.storedGrain) this.appStateService.setStoredGrain(results.storedGrain);
          if (results.tickets) this.appStateService.setTickets(results.tickets);
          if (results.plantingIntentions) this.appStateService.setPlantingIntentions(results.plantingIntentions);
          if (results.queryLibrary) this.appStateService.queryLibrary.set(results.queryLibrary);
          this._executeNlq(savedList);
          this.savedListLoading.set(false);
          this.applyFilters();
        },
        error: () => {
          if (runId !== this._activeSavedListRunId) return;
          this.savedListLoading.set(false);
          // Run NLQ with whatever data is available — don't retry the fetch
          this._executeNlq(savedList);
          this.applyFilters();
        }
      });
      return;
    }

    // All needed data is available — run NLQ instantly
    this._executeNlq(savedList);
    this.savedListLoading.set(false);
  }

  private _executeNlq(savedList: SavedList): void {
    const contracts = this.appStateService.contracts();
    const notes = this.appStateService.notes();
    const context: NlqFilterContext = {
      customers: this.customers(),
      contracts,
      tickets: this.appStateService.tickets(),
      notes,
      plantingIntentions: this.appStateService.plantingIntentions(),
      storedGrain: this.appStateService.storedGrain(),
      commodities: this.appStateService.commodities()
    };
    // Resolve "I"/"me"/"my" to the user's name so author-based queries work
    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0];
    const resolvedQuery = this.nlqFilterService.resolveUserReferences(savedList.query, account?.name ?? '', account?.username ?? '');
    const result = this.nlqFilterService.parseAndFilter(resolvedQuery, context);
    // Backfill _promptCategory if the saved list pre-dates the hint AND the query library
    // has a match for its queryText (the service uses this to drive dimension-aware filters
    // like the contracts-crop match).
    let listFilters = savedList.filters;
    if (listFilters && !listFilters._promptCategory) {
      const lib = this.appStateService.queryLibrary();
      if (lib.length > 0) {
        const qLower = savedList.query.trim().toLowerCase();
        const matched = lib.find(q => q.queryText.trim().toLowerCase() === qLower);
        if (matched?.category) listFilters = { ...listFilters, _promptCategory: matched.category };
      }
    }
    const refined = listFilters
      ? this.nlqFilterService.applyRefinementFilters(result.customers, listFilters, contracts, notes, {
          tickets: this.appStateService.tickets(),
          storedGrain: this.appStateService.storedGrain(),
          plantingIntentions: this.appStateService.plantingIntentions(),
          commodityConversions: this.appStateService.commodityConversions()
        })
      : result.customers;
    savedList.customerIds = this.nlqFilterService.applyCustomerOverrides(
      refined.map(c => c.id), savedList.includedCustomerIds, savedList.excludedCustomerIds
    );

    // Persist customerIds to appState so they survive component remount.
    const lists = this.appStateService.savedLists().map(l =>
      l.id === savedList.id ? { ...l, customerIds: savedList.customerIds } : l
    );
    this.appStateService.setSavedLists(lists);
  }

  clearSearch(): void {
    this.searchInputValue = '';
    this.searchLoading.set(false);
    this.appStateService.setSearchQuery('');
    this.applyFilters();
  }

  clearAll(): void {
    this._cancelSavedList$.next(); // Cancel any in-flight saved list NLQ
    this.savedListLoading.set(false);
    this.searchInputValue = '';
    this.appStateService.setSearchQuery('');
    this.selectedListId.set('all');
    this.appStateService.setSelectedSavedListId('all');
    this.appStateService.setTradeUnits([]);
    this.appStateService.setSelectedGroupNames([]);
    this.filteredCustomers.set([]);
    this.clearSelection.emit();
  }

  /**
   * Performance optimization: Pre-calculate all last contact info once
   * instead of filtering/sorting on every render for every customer.
   *
   * Complexity: O(m + n) where m = notes count, n = customers count
   * Previously: O(n * m) on EVERY change detection cycle
   */
  private _rebuildLastContactCache(): void {
    const newCache = new Map<number, LastContactInfo>();

    // Group notes by customerCode (ODS source ID string) — more stable than customerId.
    // Notes carry the ODS code of the customer they were written for, so this works even
    // after linked-producer relationships are removed or for cross-TU producers whose
    // customer record isn't in the current loaded set (no sourceToId resolution needed).
    const notesByCode = new Map<string, Note[]>();
    for (const note of this.notes()) {
      const key = note.customerCode;
      if (!key) continue;
      if (!notesByCode.has(key)) notesByCode.set(key, []);
      notesByCode.get(key)!.push(note);
    }

    // Calculate last contact for each customer - single pass O(n)
    // Use filteredCustomers when available (covers API search results when no TU is selected
    // and customers() input is empty). Fall back to customers() for TU-filtered loads.
    const customersToCache = this.filteredCustomers().length > 0 ? this.filteredCustomers() : this.customers();

    // Build incoming-links map from the FULL customer list + any linked producer customers
    // fetched for selected customers (populated by home's _fetchMissingLinkedProducers). This
    // makes last-contacted resolve notes from reverse-linked producers even in no-TU search mode
    // where the main roster is empty.
    const allCustomers = [...this.customers(), ...this.linkedProducerCustomers()];
    const linkedById = new Map<number, string[]>();
    for (const c of allCustomers) {
      if (c.linkedProducerIds?.length) linkedById.set(c.id, c.linkedProducerIds);
    }
    const incomingCodeLinks = new Map<string, Set<string>>();
    for (const c of allCustomers) {
      if (!c.scoularId) continue;
      for (const linkedCode of (c.linkedProducerIds || [])) {
        if (!incomingCodeLinks.has(linkedCode)) incomingCodeLinks.set(linkedCode, new Set());
        incomingCodeLinks.get(linkedCode)!.add(c.scoularId);
      }
    }

    for (const customer of customersToCache) {
      // Collect all source codes to look up: this customer + outgoing links + incoming links.
      // Use linkedProducerIds from the full customer list (not the potentially stale filtered copy).
      const freshLinked = linkedById.get(customer.id) ?? customer.linkedProducerIds ?? [];
      const allCodes = new Set<string>();
      if (customer.scoularId) allCodes.add(customer.scoularId);
      for (const linkedCode of freshLinked) allCodes.add(linkedCode);
      for (const incomingCode of (incomingCodeLinks.get(customer.scoularId || '') || new Set<string>())) {
        allCodes.add(incomingCode);
      }
      const customerNotes = [...allCodes].flatMap(code => notesByCode.get(code) || []);

      if (customerNotes.length === 0) {
        newCache.set(customer.id, {
          text: 'Never contacted',
          daysAgo: -1,
          cssClass: 'text-red-500'
        });
        continue;
      }

      // Find the most recently CREATED note — createdAt only, not modifiedAt.
      // Pinning or editing a note updates modifiedAt but is not a new contact event.
      // Treat bare ISO strings as UTC (API stores DateTime.UtcNow without Z suffix).
      const parseUtc = (ts: string | Date) => {
        const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
        return new Date(raw).getTime();
      };
      const lastNote = customerNotes.reduce((latest, note) => parseUtc(note.createdAt) > parseUtc(latest.createdAt) ? note : latest, customerNotes[0]);

      const noteDate = new Date(parseUtc(lastNote.createdAt));
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
    const baseClass = 'p-4 cursor-pointer transition-colors';
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
}
