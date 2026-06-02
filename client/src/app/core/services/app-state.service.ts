import { Injectable, signal, computed } from '@angular/core';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, SavedList, Commodity, CommodityConversion, HarvestWindow, DashboardPlantingEstimate, DashboardMarketShare, DashboardActualHarvest, DashboardSummary, RefinementFilters, ContractPricingLine, QueryLibraryItem } from '@models';
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

  // Trade unit groups cache — loaded once and shared globally
  userGroups = signal<{ groupName: string; tradeUnitCodes: string[] }[]>([]);
  userGroupsLoaded = signal(false);

  setUserGroups(groups: { groupName: string; tradeUnitCodes: string[] }[]): void {
    this.userGroups.set(groups);
    this.userGroupsLoaded.set(true);
  }

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
  notes = signal<Note[]>([]);
  storedGrain = signal<StoredGrain[]>([]);
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
  }

  setPlantingIntentions(plantingIntentions: PlantingIntention[]): void {
    this.plantingIntentions.set(plantingIntentions);
  }

  setNotes(notes: Note[]): void {
    this.notes.set(notes);
  }

  setStoredGrain(storedGrain: StoredGrain[]): void {
    this.storedGrain.set(storedGrain);
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
    this.tickets.set([]);
    this.plantingIntentions.set([]);
    this.notes.set([]);
    this.storedGrain.set([]);
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
