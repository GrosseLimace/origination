import { Injectable, signal, computed } from '@angular/core';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, SavedList, Commodity, DashboardPlantingEstimate, DashboardMarketShare, DashboardActualHarvest, DashboardSummary, RefinementFilters, ContractPricingLine } from '@models';
import { ProducerDetails } from '../../models/producer-details.model';

export interface InsightsCacheEntry {
  tradeUnitsKey: string; // sorted, comma-joined trade unit IDs — used to detect trade unit changes
  customers: Customer[];
  contracts: Contract[];
  tickets: Ticket[];
  notes: Note[];
  loadedAt: Date;
}

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
  queryUnrecognized: boolean;
  tradeUnits: string[];
  appliedRefinements?: RefinementFilters;
  notContactedDaysInput?: string;
  showRefinePanel?: boolean;
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
  tickets = signal<Ticket[]>([]);
  plantingIntentions = signal<PlantingIntention[]>([]);
  notes = signal<Note[]>([]);
  storedGrain = signal<StoredGrain[]>([]);
  savedLists = signal<SavedList[]>([]);
  commodities = signal<Commodity[]>([]);
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

  // Insights cache — keyed by trade unit so navigating back shows data instantly
  insightsCache = signal<InsightsCacheEntry | null>(null);

  setInsightsCache(entry: InsightsCacheEntry): void {
    this.insightsCache.set(entry);
  }

  clearInsightsCache(): void {
    this.insightsCache.set(null);
  }

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
    this.insightsCache.set(null);
    this.dashboardCache.set(null);
    this.preloadedDashboardSummary.set(null);
    this.dataLoading.set(false);
  }
}
