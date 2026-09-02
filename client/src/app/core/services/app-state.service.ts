import { Injectable, signal, computed } from '@angular/core';
import { Customer, Contract, Ticket, PlantingIntention, Note, NoteLastContact, StoredGrain, DpContract, SavedList, Commodity, CommodityConversion, HarvestWindow, DashboardPlantingEstimate, DashboardMarketShare, DashboardActualHarvest, DashboardSummary, RefinementFilters, ContractPricingLine, QueryLibraryItem } from '@models';
import { ProducerDetails } from '../../models/producer-details.model';

export interface DashboardCacheEntry {
  tradeUnitsKey: string;
  customers: Customer[];
  contracts: Contract[];
  plantingIntentions: PlantingIntention[];
  storedGrain: StoredGrain[];
  commodities: Commodity[];
  savedYieldEstimates: DashboardPlantingEstimate[];
  savedMarketShares: DashboardMarketShare[];
  savedActualHarvest: DashboardActualHarvest[];
  loadedAt: Date;
}

export interface BuildListState {
  queryText: string;
  filteredCustomerIds: number[];
  hasGenerated: boolean;
  showMap: boolean;
  detectedState: string | null;
  tradeUnits: string[];
  appliedRefinements?: RefinementFilters;
  notContactedDaysInput?: string;
  showRefinePanel?: boolean;
  manuallyIncludedCustomerIds?: number[];
  manuallyExcludedCustomerIds?: number[];
  showManageMembersPanel?: boolean;
  selectedLibraryQuery?: QueryLibraryItem | null;
  /** When a saved list is the active context, persist it so navigating away and back
   *  restores the "Active List" indicator and keeps Save/Update wired to the same list
   *  (rather than dropping back to a no-context state that creates a new list on save). */
  activeSavedList?: SavedList | null;
}

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  private static readonly PREFS_KEY = 'origination_user_prefs';

  constructor() {
    try {
      const raw = localStorage.getItem(AppStateService.PREFS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { groups?: string[]; units?: string[] };
        if (saved.groups?.length) this.selectedGroupNames.set(saved.groups);
        if (saved.units?.length)  this.selectedTradeUnits.set(saved.units);
      }
    } catch { /* ignore parse errors */ }
  }

  savePrefsToLocalStorage(groups: string[], units: string[]): void {
    try {
      localStorage.setItem(AppStateService.PREFS_KEY, JSON.stringify({ groups, units }));
    } catch { /* ignore */ }
  }

  // Trade unit groups cache — loaded once and shared globally. tradeUnits carries each code's
  // description/location (e.g. "Pratt, KS"); tradeUnitCodes is kept for code-only consumers.
  userGroups = signal<{ groupName: string; tradeUnitCodes: string[]; tradeUnits?: { code: string; description?: string }[] }[]>([]);
  userGroupsLoaded = signal(false);

  setUserGroups(groups: { groupName: string; tradeUnitCodes: string[]; tradeUnits?: { code: string; description?: string }[] }[]): void {
    this.userGroups.set(groups);
    this.userGroupsLoaded.set(true);
  }

  /** Trade-unit code → description/location (e.g. "2190" → "Pratt, KS"), from the loaded groups.
   *  Empty until groups load (or for older cached data without descriptions). */
  readonly tradeUnitDescriptions = computed(() => {
    const map = new Map<string, string>();
    for (const g of this.userGroups()) {
      for (const tu of g.tradeUnits ?? []) {
        if (tu.description && !map.has(tu.code)) map.set(tu.code, tu.description);
      }
    }
    return map;
  });

  // View state
  currentView = signal<'customers' | 'insights' | 'buildlist' | 'dashboard'>('customers');

  // Selection state
  selectedCustomer = signal<Customer | null>(null);
  selectedTradeUnits = signal<string[]>([]);
  selectedGroupNames = signal<string[]>([]);
  // "All Producers" mode — a session-only override that clears scope so the customer-list
  // search spans all producers (our table + ODS onboarding fallback). Deliberately NOT
  // persisted (localStorage or server preference) and starts false every session, so the
  // user's saved preference always remains a real trade group, never "All Producers".
  allProducersMode = signal(false);

  /**
   * Trade group names currently in play — used to scope the commodity pickers (Organics & IP).
   *
   * Precedence matches the rest of the app: individually selected trade units win (a group counts
   * if any of its codes is selected), then selected groups, then — per the selector's
   * _computeAvailableTradeUnits — an empty selection means ALL of the user's groups, not none.
   * Empty until userGroups loads, at which point every consumer re-filters on its own.
   *
   * Selecting an Organics unit alongside a conventional one is additive: both groups come back,
   * so the organic crops show without hiding anything else.
   */
  readonly inScopeGroupNames = computed<readonly string[]>(() => {
    const groups = this.userGroups();
    const units = this.selectedTradeUnits();
    const names = this.selectedGroupNames();

    if (units.length > 0) {
      const selected = new Set(units.map(u => u.trim()));
      return groups
        .filter(g => g.tradeUnitCodes.some(c => selected.has(c.trim())))
        .map(g => g.groupName);
    }
    // Intersect rather than echo the names back, so a stale saved selection can't invent a group.
    if (names.length > 0) {
      return groups.filter(g => names.includes(g.groupName)).map(g => g.groupName);
    }
    return groups.map(g => g.groupName);
  });

  /**
   * Trade unit codes currently in play — the unit-level counterpart to inScopeGroupNames, used to
   * scope commodities restricted to specific units rather than a whole group.
   *
   * Precedence is identical: explicit units win, then selected groups expanded to their member
   * codes, then — nothing selected means ALL of the user's units, not none. Kept separate from
   * inScopeGroupNames rather than derived from it because that computed deliberately collapses
   * units up to their group name, which loses exactly the granularity this needs: selecting 2080
   * and selecting 2291 both yield 'Organics & IP'.
   */
  readonly inScopeTradeUnitCodes = computed<readonly string[]>(() => {
    const groups = this.userGroups();
    const units = this.selectedTradeUnits();
    const names = this.selectedGroupNames();

    if (units.length > 0) return units.map(u => u.trim()).filter(Boolean);
    if (names.length > 0) {
      return groups
        .filter(g => names.includes(g.groupName))
        .flatMap(g => g.tradeUnitCodes.map(c => c.trim()))
        .filter(Boolean);
    }
    return groups.flatMap(g => g.tradeUnitCodes.map(c => c.trim())).filter(Boolean);
  });

  // Scroll state — tracks last customer scrolled to in the list so re-navigation doesn't re-scroll
  lastScrolledCustomerId = signal<number | null>(null);

  // Build a List UI state — persists across navigation
  buildListState = signal<BuildListState | null>(null);

  // Search state
  searchQuery = signal<string>('');

  // Saved list selection state — persists across navigation
  selectedSavedListId = signal<string>('');

  // Data cache - persists across navigation
  customers = signal<Customer[]>([]);
  contracts = signal<Contract[]>([]);
  todaysTickets = signal<Ticket[]>([]);
  tickets = signal<Ticket[]>([]);
  plantingIntentions = signal<PlantingIntention[]>([]);
  /** Full TU-wide note set — a LAZY cache for NLQ/saved-list consumers only (see notesLoaded).
   *  No longer eagerly bulk-loaded on page load / TU change; badges use noteLastContacts. */
  notes = signal<Note[]>([]);
  /** Per-customer "last contacted" aggregate — the lightweight badge feed (all trade units,
   *  entitlement-filtered). Preloaded on TU change; tiny regardless of how many notes exist. */
  noteLastContacts = signal<NoteLastContact[]>([]);
  storedGrain = signal<StoredGrain[]>([]);
  dpContracts = signal<DpContract[]>([]);
  /** True once a DP fetch has COMPLETED for the current trade units, regardless of row count.
   *  Callers must gate on this rather than `dpContracts().length > 0`: a trade unit with genuinely
   *  zero DP positions is indistinguishable from "not fetched yet" by length alone, which makes a
   *  query flash "no producers found" while the fetch is still in flight. Same reason
   *  `ticketsLoaded` exists. Reset on trade-unit change. */
  dpContractsLoaded = signal(false);
  savedLists = signal<SavedList[]>([]);
  commodities = signal<Commodity[]>([]);
  commodityConversions = signal<CommodityConversion[]>([]);
  /** Shared query library cache so home + customer-list can resolve a saved list's prompt
   *  category (Contracts / Tickets / etc.) by queryText match without each page fetching
   *  independently. Loaded lazily on first access — both build-list and customer-list
   *  populate this signal when they receive the API response. */
  queryLibrary = signal<QueryLibraryItem[]>([]);
  harvestWindows = signal<HarvestWindow[]>([]);
  producerDetails = signal<ProducerDetails[]>([]);
  pricingLines = signal<ContractPricingLine[]>([]);

  setView(view: 'customers' | 'insights' | 'buildlist' | 'dashboard'): void {
    this.currentView.set(view);
  }

  selectCustomer(customer: Customer | null): void {
    this.selectedCustomer.set(customer);
  }

  setTradeUnits(tradeUnits: string[]): void {
    this.selectedTradeUnits.set(tradeUnits);
  }

  setSelectedGroupNames(groups: string[]): void {
    this.selectedGroupNames.set(groups);
  }

  setAllProducersMode(on: boolean): void {
    this.allProducersMode.set(on);
  }

  setSearchQuery(query: string): void {
    this.searchQuery.set(query);
  }

  setSelectedSavedListId(id: string): void {
    this.selectedSavedListId.set(id);
  }

  // Update data cache
  setCustomers(customers: Customer[]): void {
    this.customers.set(customers);
  }

  setContracts(contracts: Contract[]): void {
    this.contracts.set(contracts);
  }

  setTodaysTickets(tickets: Ticket[]): void {
    this.todaysTickets.set(tickets);
  }

  setTickets(tickets: Ticket[]): void {
    this.tickets.set(tickets);
    this.ticketsLoaded.set(true);
  }

  setPlantingIntentions(plantingIntentions: PlantingIntention[]): void {
    this.plantingIntentions.set(plantingIntentions);
  }

  setNotes(notes: Note[]): void {
    this.notes.set(notes);
    this.notesLoaded.set(true);
  }

  setNoteLastContacts(rows: NoteLastContact[]): void {
    this.noteLastContacts.set(rows);
  }

  setStoredGrain(storedGrain: StoredGrain[]): void {
    this.storedGrain.set(storedGrain);
  }

  /** TU-WIDE load: replaces the set and marks DP loaded for the current trade units. Only call this
   *  from a fetch that covers the whole trade-unit scope. */
  setDpContracts(dpContracts: DpContract[]): void {
    this.dpContracts.set(dpContracts);
    this.dpContractsLoaded.set(true);
  }

  /**
   * PER-PRODUCER merge — swaps in one producer's DP rows and leaves everyone else's alone.
   *
   * Deliberately does NOT set dpContractsLoaded: one producer's rows are not a trade-unit-wide load.
   * Claiming otherwise made TU-wide consumers (Build A List) believe DP was fully loaded after a
   * single producer was opened, then filter every producer against that partial set and report
   * "no producers match".
   */
  mergeCustomerDpContracts(customerId: number, rows: DpContract[]): void {
    this.dpContracts.update(existing => [...existing.filter(d => d.customerId !== customerId), ...rows]);
  }

  setPricingLines(lines: ContractPricingLine[]): void {
    this.pricingLines.set(lines);
  }

  setSavedLists(savedLists: SavedList[]): void {
    this.savedLists.set(savedLists);
  }

  setCommodities(commodities: Commodity[]): void {
    this.commodities.set(commodities);
  }

  setProducerDetails(details: ProducerDetails[]): void {
    this.producerDetails.set(details);
  }

  // Global data loading flag — true while DataPreloadService is fetching on TU change
  dataLoading = signal(false);

  setDataLoading(loading: boolean): void {
    this.dataLoading.set(loading);
  }

  // Tickets-specific loading flag — true while the full ticket set is still arriving.
  // Flipped false independently of dataLoading so insights cards that don't depend on
  // the full ticket set (Unconfirmed Contracts, Spot Loads) can render as soon as
  // their own data is ready.
  ticketsLoading = signal(false);

  setTicketsLoading(loading: boolean): void {
    this.ticketsLoading.set(loading);
  }

  // True once the TU-wide ticket set has been loaded into `tickets` (via setTickets). List/NLQ
  // consumers (customer-list, build-list) gate their own lazy TU-wide fetch on this instead of
  // `tickets().length === 0`, because per-producer selection no longer populates `tickets` — so an
  // emptiness check would misfire. Reset on TU change / logout via clearTicketsCache().
  ticketsLoaded = signal(false);

  clearTicketsCache(): void {
    this.tickets.set([]);
    this.ticketsLoaded.set(false);
  }

  /** Drops the DP set + its loaded flag. Must run on TU change: without it, dpContractsLoaded stays
   *  true from the PREVIOUS trade unit, so a DP query runs against the prior TU's rows and reports
   *  "no producers match" for producers that do hold DP. */
  clearDpContractsCache(): void {
    this.dpContracts.set([]);
    this.dpContractsLoaded.set(false);
  }

  // True once the full TU-wide note set has been loaded into `notes` (via setNotes). NLQ/
  // saved-list consumers gate their lazy fetch on this instead of `notes().length === 0`,
  // because notes are no longer eagerly bulk-loaded — an emptiness check would misfire for
  // a user whose trade units genuinely have zero notes. Reset on TU change / logout.
  notesLoaded = signal(false);

  clearNotesCache(): void {
    this.notes.set([]);
    this.notesLoaded.set(false);
  }

  // Per-dataset loading flags — let each screen/category render as soon as ITS own data
  // arrives instead of waiting on the slowest core query. Set by DataPreloadService: all
  // true when a trade-unit load starts, each flipped false as its data streams in.
  //   - Actionable Insights: Spot Loads waits on todaysTicketsLoading; the contract-based
  //     categories (Unconfirmed Contracts, Unshipped Bushels) wait on contractsLoading.
  //   - Dashboard: waits on customers + contracts, NOT tickets (it doesn't use them).
  customersLoading = signal(false);
  contractsLoading = signal(false);
  todaysTicketsLoading = signal(false);

  // Dashboard cache — keyed by trade unit so navigating back shows data instantly
  dashboardCache = signal<DashboardCacheEntry | null>(null);

  setDashboardCache(entry: DashboardCacheEntry): void {
    this.dashboardCache.set(entry);
  }

  clearDashboardCache(): void {
    this.dashboardCache.set(null);
  }

  // Pre-fetched dashboard summary — DataPreloadService populates this for the current year
  // so the dashboard component can render without waiting for its own API calls.
  preloadedDashboardSummary = signal<(DashboardSummary & { tradeUnitsKey: string; year: number }) | null>(null);

  setPreloadedDashboardSummary(tradeUnitsKey: string, year: number, summary: DashboardSummary): void {
    this.preloadedDashboardSummary.set({ tradeUnitsKey, year, ...summary });
  }

  clearPreloadedDashboardSummary(): void {
    this.preloadedDashboardSummary.set(null);
  }

  // Geocode cache — plain Map (not a signal) so mutation is cheap and in-place
  // Capped at 500 entries to prevent unbounded memory growth (LRU-style: evict oldest on overflow)
  private readonly GEOCODE_CACHE_MAX = 500;
  mapGeocodeCache = new Map<string, { lat: number; lng: number }>();

  setGeocodeCache(key: string, value: { lat: number; lng: number }): void {
    if (this.mapGeocodeCache.size >= this.GEOCODE_CACHE_MAX) {
      // Map iteration order is insertion order — delete the oldest entry
      const firstKey = this.mapGeocodeCache.keys().next().value;
      if (firstKey !== undefined) this.mapGeocodeCache.delete(firstKey);
    }
    this.mapGeocodeCache.set(key, value);
  }

  clearMapGeocodeCache(): void {
    this.mapGeocodeCache.clear();
  }

  setLastScrolledCustomerId(id: number | null): void {
    this.lastScrolledCustomerId.set(id);
  }

  setBuildListState(state: BuildListState): void {
    this.buildListState.set(state);
  }

  clearBuildListState(): void {
    this.buildListState.set(null);
  }

  clearSelection(): void {
    this.selectedCustomer.set(null);
  }

  // Clear all state (for logout or reset)
  clearAll(): void {
    this.userGroups.set([]);
    this.userGroupsLoaded.set(false);
    this.selectedCustomer.set(null);
    this.selectedTradeUnits.set([]);
    this.selectedGroupNames.set([]);
    this.searchQuery.set('');
    this.selectedSavedListId.set('');
    this.customers.set([]);
    this.contracts.set([]);
    this.clearTicketsCache();
    this.plantingIntentions.set([]);
    this.clearNotesCache();
    this.noteLastContacts.set([]);
    this.storedGrain.set([]);
    this.dpContracts.set([]);
    this.dpContractsLoaded.set(false);
    this.savedLists.set([]);
    this.commodities.set([]);
    this.producerDetails.set([]);
    this.buildListState.set(null);
    this.lastScrolledCustomerId.set(null);
    this.dashboardCache.set(null);
    this.preloadedDashboardSummary.set(null);
    this.dataLoading.set(false);
    this.customersLoading.set(false);
    this.contractsLoading.set(false);
    this.todaysTicketsLoading.set(false);
    this.todaysTickets.set([]);
  }
}
