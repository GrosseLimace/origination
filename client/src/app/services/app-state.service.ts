import { Injectable, signal, computed } from '@angular/core';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, SavedList } from '../models';

export interface BuildListState {
  queryText: string;
  filteredCustomerIds: number[];
  hasGenerated: boolean;
  showMap: boolean;
  detectedState: string | null;
  queryUnrecognized: boolean;
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

  // Scroll state — tracks last customer scrolled to in the list so re-navigation doesn't re-scroll
  lastScrolledCustomerId = signal<number | null>(null);

  // Build a List UI state — persists across navigation
  buildListState = signal<BuildListState | null>(null);

  // Search state
  searchQuery = signal<string>('');

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

  setSearchQuery(query: string): void {
    this.searchQuery.set(query);
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

  // Geocode cache — plain Map (not a signal) so mutation is cheap and in-place
  mapGeocodeCache = new Map<string, { lat: number; lng: number }>();

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
    this.searchQuery.set('');
    this.customers.set([]);
    this.contracts.set([]);
    this.tickets.set([]);
    this.plantingIntentions.set([]);
    this.notes.set([]);
    this.storedGrain.set([]);
    this.savedLists.set([]);
    this.buildListState.set(null);
    this.lastScrolledCustomerId.set(null);
  }
}
