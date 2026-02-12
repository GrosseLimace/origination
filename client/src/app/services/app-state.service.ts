import { Injectable, signal, computed } from '@angular/core';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, Farm, SavedList } from '../models';

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  // View state
  currentView = signal<'customers' | 'insights' | 'buildlist' | 'dashboard'>('customers');

  // Selection state
  selectedCustomer = signal<Customer | null>(null);
  selectedFarmId = signal<string | null>(null);
  selectedTradeUnits = signal<string[]>([]);

  // Search state
  searchQuery = signal<string>('');

  // Data cache - persists across navigation
  customers = signal<Customer[]>([]);
  contracts = signal<Contract[]>([]);
  tickets = signal<Ticket[]>([]);
  plantingIntentions = signal<PlantingIntention[]>([]);
  notes = signal<Note[]>([]);
  storedGrain = signal<StoredGrain[]>([]);
  farms = signal<Farm[]>([]);
  savedLists = signal<SavedList[]>([]);

  setView(view: 'customers' | 'insights' | 'buildlist' | 'dashboard'): void {
    this.currentView.set(view);
  }

  selectCustomer(customer: Customer | null): void {
    this.selectedCustomer.set(customer);
    if (customer && customer.farmIds.length > 0) {
      this.selectedFarmId.set(customer.farmIds[0]);
    } else {
      this.selectedFarmId.set(null);
    }
  }

  selectFarm(farmId: string | null): void {
    this.selectedFarmId.set(farmId);
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

  setFarms(farms: Farm[]): void {
    this.farms.set(farms);
  }

  setSavedLists(savedLists: SavedList[]): void {
    this.savedLists.set(savedLists);
  }

  clearSelection(): void {
    this.selectedCustomer.set(null);
    this.selectedFarmId.set(null);
  }

  // Clear all state (for logout or reset)
  clearAll(): void {
    this.selectedCustomer.set(null);
    this.selectedFarmId.set(null);
    this.selectedTradeUnits.set([]);
    this.searchQuery.set('');
    this.customers.set([]);
    this.contracts.set([]);
    this.tickets.set([]);
    this.plantingIntentions.set([]);
    this.notes.set([]);
    this.storedGrain.set([]);
    this.farms.set([]);
    this.savedLists.set([]);
  }
}
