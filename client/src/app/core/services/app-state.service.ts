import { Injectable, signal, computed } from '@angular/core';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, SavedList, Commodity, DashboardPlantingEstimate, DashboardMarketShare, DashboardActualHarvest } from '@models';

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
}

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
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

  setSavedLists(savedLists: SavedList[]): void {
    this.savedLists.set(savedLists);
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
    this.buildListState.set(null);
    this.lastScrolledCustomerId.set(null);
    this.insightsCache.set(null);
    this.dashboardCache.set(null);
  }
}
