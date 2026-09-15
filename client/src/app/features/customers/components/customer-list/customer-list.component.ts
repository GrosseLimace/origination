import { Component, input, output, effect, inject, untracked, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, ElementRef, DestroyRef, afterNextRender, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of, forkJoin, takeUntil } from 'rxjs';
import { catchError, debounceTime, switchMap, map } from 'rxjs/operators';
import { StoredGrain, DpContract, Ticket, PlantingIntention, Contract } from '@models';
import { Customer, SavedList, Note, NoteLastContact, ReminderDue, ProducerDetails } from '@models';
import { MsalService } from '@azure/msal-angular';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { NlqFilterService, NlqFilterContext } from '@core/services/nlq-filter.service';
import { REMINDER_DUE_CLASS, reminderDueTier } from '@shared/utils/reminder-due';
import { buildLinkedProducerComponents } from '@shared/utils/linked-producers';
import { filterSavedListsByTradeUnitOverlap } from '@shared/utils/saved-list-trade-units';
import { CardComponent, CardContentComponent } from '@shared/components/card/card.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';

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
  /** Per-customer "last contacted" aggregate (all trade units, one row per customer with
   *  notes) — feeds the badge cache without the full note download. */
  public noteLastContacts = input<NoteLastContact[]>([]);
  /** The signed-in user's OWN open follow-ups (all producers). Private per user — the API only
   *  returns the caller's — so this badge never reveals another originator's plans. */
  public myReminders = input<ReminderDue[]>([]);
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
  /** "All Producers" mode — search spans every producer (our table + ODS onboarding fallback). */
  readonly allProducersMode = computed(() => this.appStateService.allProducersMode());

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
        // Only fall back to the ODS master once the term is specific enough — a 1–2 char
        // term is a broad LIKE scan over the whole customer master (slow) and never a
        // useful onboarding lookup. Keeps short-term typing fast (our-table search only).
        const noScope = explicitUnits.length === 0 && selectedGroups.length === 0;
        const odsEligible = noScope && searchTerm.trim().length >= 3;
        return this.apiService.searchCustomers(searchTerm, tradeUnits).pipe(
          // Onboarding fallback: when nothing matches in our tables AND no TU/group is
          // selected, look the term up in the ODS customer master so the user can find
          // and onboard a producer who exists in CTRM but has no contract/ticket yet.
          switchMap(results => {
            if (results.length === 0 && odsEligible) {
              return this.apiService.searchOdsCustomers(searchTerm).pipe(
                map(ods => ods.map(c => ({ ...c, isOnboardCandidate: true }))),
                catchError(() => of([] as Customer[]))
              );
            }
            return of(results);
          }),
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

    // Re-run the active saved list's NLQ when tickets / stored grain / planting
    // intentions arrive AFTER the first run. Without this, a saved list whose query
    // needs tickets (e.g. "Producers with unapplied tickets") runs once when those
    // signals are empty, returns 0 from the live NLQ, and stays stuck on the saved
    // includedCustomerIds (typically 4 from the last save). When the lazy ticket fetch
    // finishes the count should update — this effect makes that happen.
    effect(() => {
      const tickets = this.appStateService.tickets();
      const storedGrain = this.appStateService.storedGrain();
      const planting = this.appStateService.plantingIntentions();
      untracked(() => {
        const listId = this.selectedListId();
        if (!listId || listId === 'all') return;
        const savedList = this.savedLists().find(l => String(l.id) === listId);
        if (!savedList || !savedList.query) return;
        const q = savedList.query;
        // Only re-run if the data that just arrived is what this query depends on.
        const needsTickets  = this.nlqFilterService.queryInvolvesTickets(q)  && tickets.length  > 0;
        const needsStorage  = this.nlqFilterService.queryInvolvesStorage(q)  && storedGrain.length > 0;
        const needsPlanting = this.nlqFilterService.queryInvolvesPlanting(q) && planting.length    > 0;
        if (!(needsTickets || needsStorage || needsPlanting)) return;
        // Re-execute the live filter against the now-complete data and persist the
        // refreshed customerIds back to appState.
        this._executeNlq(savedList);
        this.applyFilters();
      });
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
        // A saved list that still overlaps the new selection STAYS selected and re-runs under it —
        // its cached customerIds belong to the old roster, so drop them (the customers effect
        // re-enters applyFilters once the new roster lands). A list that no longer overlaps can't
        // be shown, so fall back to All Producers.
        const currentList = this.selectedListId();
        if (currentList && currentList !== 'all') {
          this._cancelSavedList$.next();
          if (this.getVisibleSavedLists().some(l => String(l.id) === currentList)) {
            const savedList = this.savedLists().find(l => String(l.id) === currentList);
            if (savedList) savedList.customerIds = undefined as any;
            this.savedListLoading.set(true);
          } else {
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

  /** Saved lists sharing at least one trade unit with the current selection (see
   *  saved-list-trade-units.ts). Trade units govern visibility only — picking one runs its query
   *  against the currently loaded roster (_runSavedListNlq fetches with the current selection). */
  getVisibleSavedLists(): SavedList[] {
    return filterSavedListsByTradeUnitOverlap(this.savedLists(), this.appStateService.selectedTradeUnits());
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
      // Clear any active producer-search term so applyFilters() resolves the saved list through
      // the fast LOCAL NLQ path. With a term present, applyFilters() diverts to the search
      // pipeline (and the slow ODS fallback in All-Producers mode) and that path never clears
      // savedListLoading — leaving "Running saved list..." up for the whole search. Mirrors the
      // clear-on-trade-unit-change behavior. Set the value directly (not clearSearch(), which would
      // call applyFilters() a second time) so the applyFilters() below runs once with no term.
      if (this.searchInputValue) {
        this.searchInputValue = '';
        this.searchLoading.set(false);
        this.appStateService.setSearchQuery('');
      }
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
    // Gate on the loaded flag, not length: a per-producer merge can leave rows present without a
    // TU-wide load, and a TU with genuinely zero DP would otherwise re-fetch every time.
    if (this.nlqFilterService.queryInvolvesDpContracts(query) && !this.appStateService.dpContractsLoaded()) {
      missing['dpContracts'] = this.apiService.getDpContracts(tuParam).pipe(catchError(() => of([] as DpContract[])));
    }
    // Guard on the explicit ticketsLoaded flag, not `.length === 0`: tickets are no longer
    // eagerly bulk-loaded, and per-producer selection no longer writes into appState.tickets, so an
    // emptiness check could misfire (or skip the fetch after a partial write). ticketsLoaded is only
    // true once a TU-wide set has been loaded; it's reset on TU change.
    if (this.nlqFilterService.queryInvolvesTickets(query) && !this.appStateService.ticketsLoaded()) {
      missing['tickets'] = this.apiService.getTickets(tuParam).pipe(catchError(() => of([] as Ticket[])));
    }
    if (this.nlqFilterService.queryInvolvesPlanting(query) && this.appStateService.plantingIntentions().length === 0) {
      missing['plantingIntentions'] = this.apiService.getPlantingIntentions(tuParam).pipe(catchError(() => of([] as PlantingIntention[])));
    }
    // Contracts: if the query needs them and the global signal is empty, fetch before
    // running NLQ. Without this, the saved list runs against an empty contracts array
    // and "with active contracts" returns 0 even though the producers have contracts —
    // while commodity-specific prompts silently fall back to customer.commodities and
    // still return producers, making the failure look intermittent.
    if (this.nlqFilterService.queryInvolvesContracts(query) && this.appStateService.contracts().length === 0) {
      missing['contracts'] = this.apiService.getContracts(tuParam).pipe(catchError(() => of([] as Contract[])));
    }
    // Notes (full set with bodies/authors): fetch ONLY for prompts that actually read note
    // content/authors/pinned/counts, or whose refine filters do. Recency ("not contacted",
    // "never contacted", "notes in last N days") and every non-note prompt resolve from the
    // last-contact aggregate (always loaded on TU change), so they never download the full set.
    // Gate on notesLoaded, not length (a TU can genuinely have zero notes).
    const needsFullNotes = this.nlqFilterService.queryNeedsFullNotes(query)
      || this.nlqFilterService.refineFiltersNeedFullNotes(savedList.filters);
    if (needsFullNotes && !this.appStateService.notesLoaded()) {
      missing['notes'] = this.apiService.getNotes().pipe(catchError(() => of([] as Note[])));
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
          if (results.dpContracts) this.appStateService.setDpContracts(results.dpContracts);
          if (results.tickets) this.appStateService.setTickets(results.tickets);
          if (results.plantingIntentions) this.appStateService.setPlantingIntentions(results.plantingIntentions);
          if (results.contracts) this.appStateService.setContracts(results.contracts);
          if (results.notes) this.appStateService.setNotes(results.notes);
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
      noteLastContacts: this.appStateService.noteLastContacts(),
      plantingIntentions: this.appStateService.plantingIntentions(),
      storedGrain: this.appStateService.storedGrain(),
      dpContracts: this.appStateService.dpContracts(),
      commodities: this.appStateService.commodities(),
      commodityConversions: this.appStateService.commodityConversions()
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
          dpContracts: this.appStateService.dpContracts(),
          plantingIntentions: this.appStateService.plantingIntentions(),
          commodityConversions: this.appStateService.commodityConversions(),
          noteLastContacts: this.appStateService.noteLastContacts(),
          commodities: this.appStateService.commodities()
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
    const components = buildLinkedProducerComponents(allCustomers);

    for (const customer of customersToCache) {
      // Start from the connected component when we have a scoularId — otherwise fall back
      // to direct outgoing links keyed by this customer's id (rare: customers without a
      // scoularId can still carry linkedProducerIds).
      let allCodes: Set<string>;
      if (customer.scoularId) {
        allCodes = components.get(customer.scoularId) ?? new Set([customer.scoularId]);
      } else {
        allCodes = new Set(customer.linkedProducerIds || []);
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
}
