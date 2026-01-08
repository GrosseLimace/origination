import { Injectable, signal, computed } from '@angular/core';
import { Customer } from '../models';

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  currentView = signal<'customers' | 'insights' | 'buildlist' | 'dashboard'>('customers');
  selectedCustomer = signal<Customer | null>(null);
  selectedFarmId = signal<string | null>(null);

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

  clearSelection(): void {
    this.selectedCustomer.set(null);
    this.selectedFarmId.set(null);
  }
}
