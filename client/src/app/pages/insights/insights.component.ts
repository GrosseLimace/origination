import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { Customer, Contract, Ticket, PlantingIntention, Note } from '../../models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '../../components/ui/card/card.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [CommonModule, CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent, BadgeComponent],
  template: `
    <div class="space-y-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Actionable Insights</h1>

      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <app-card>
          <app-card-content class="p-6">
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Customers</div>
            <div class="text-3xl font-bold text-gray-900 dark:text-white mt-1">{{ customers.length }}</div>
          </app-card-content>
        </app-card>
        <app-card>
          <app-card-content class="p-6">
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">Active Contracts</div>
            <div class="text-3xl font-bold text-gray-900 dark:text-white mt-1">{{ activeContracts }}</div>
          </app-card-content>
        </app-card>
        <app-card>
          <app-card-content class="p-6">
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Acres</div>
            <div class="text-3xl font-bold text-gray-900 dark:text-white mt-1">{{ totalAcres | number }}</div>
          </app-card-content>
        </app-card>
        <app-card>
          <app-card-content class="p-6">
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">Pending Contracts</div>
            <div class="text-3xl font-bold text-amber-500 mt-1">{{ pendingContracts }}</div>
          </app-card-content>
        </app-card>
      </div>

      <!-- Insights Cards -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Customers Needing Contact -->
        <app-card>
          <app-card-header>
            <app-card-title>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-2 text-amber-500">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" x2="12" y1="9" y2="13"/>
                <line x1="12" x2="12.01" y1="17" y2="17"/>
              </svg>
              Customers Needing Contact
            </app-card-title>
            <app-card-description>Customers not contacted in the last 30 days</app-card-description>
          </app-card-header>
          <app-card-content>
            @if (needsContact.length === 0) {
              <p class="text-gray-500 dark:text-gray-400 text-center py-4">All customers have been contacted recently!</p>
            } @else {
              <div class="space-y-2">
                @for (customer of needsContact; track customer.id) {
                  <div class="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <div class="flex items-center justify-between">
                      <div>
                        <p class="font-medium text-gray-900 dark:text-white">{{ customer.name }}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">{{ customer.farm }}</p>
                      </div>
                      <app-badge variant="warning">{{ getLastContactDays(customer.id) }} days ago</app-badge>
                    </div>
                  </div>
                }
              </div>
            }
          </app-card-content>
        </app-card>

        <!-- Unsigned Contracts -->
        <app-card>
          <app-card-header>
            <app-card-title>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-2 text-red-500">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              Unsigned Contracts
            </app-card-title>
            <app-card-description>Contracts awaiting customer signature</app-card-description>
          </app-card-header>
          <app-card-content>
            @if (unsignedContracts.length === 0) {
              <p class="text-gray-500 dark:text-gray-400 text-center py-4">All contracts are signed!</p>
            } @else {
              <div class="space-y-2">
                @for (contract of unsignedContracts; track contract.id) {
                  <div class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                    <div class="flex items-center justify-between">
                      <div>
                        <p class="font-medium text-gray-900 dark:text-white">{{ contract.contractNumber }} - {{ contract.crop }}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">{{ contract.quantity | number }} {{ contract.unit }}</p>
                      </div>
                      <app-badge variant="destructive">Unsigned</app-badge>
                    </div>
                  </div>
                }
              </div>
            }
          </app-card-content>
        </app-card>

        <!-- Top Customers by Acres -->
        <app-card>
          <app-card-header>
            <app-card-title>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-2 text-green-500">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
                <path d="M4 22h16"/>
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
              </svg>
              Top Customers by Acres
            </app-card-title>
          </app-card-header>
          <app-card-content>
            <div class="space-y-2">
              @for (customer of topCustomers; track customer.id; let i = $index) {
                <div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div class="flex items-center gap-3">
                    <span class="text-lg font-bold text-gray-400">{{ i + 1 }}</span>
                    <div>
                      <p class="font-medium text-gray-900 dark:text-white">{{ customer.name }}</p>
                      <p class="text-sm text-gray-500 dark:text-gray-400">{{ customer.location }}</p>
                    </div>
                  </div>
                  <app-badge variant="success">{{ customer.totalAcres | number }} acres</app-badge>
                </div>
              }
            </div>
          </app-card-content>
        </app-card>

        <!-- Upcoming Deliveries -->
        <app-card>
          <app-card-header>
            <app-card-title>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-2 text-blue-500">
                <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                <line x1="16" x2="16" y1="2" y2="6"/>
                <line x1="8" x2="8" y1="2" y2="6"/>
                <line x1="3" x2="21" y1="10" y2="10"/>
              </svg>
              Upcoming Delivery Windows
            </app-card-title>
          </app-card-header>
          <app-card-content>
            <div class="space-y-2">
              @for (contract of upcomingDeliveries; track contract.id) {
                <div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="font-medium text-gray-900 dark:text-white">{{ contract.crop }}</p>
                      <p class="text-sm text-gray-500 dark:text-gray-400">{{ contract.quantity | number }} {{ contract.unit }}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-sm font-medium text-gray-900 dark:text-white">{{ contract.deliveryStart | date:'MMM d' }} - {{ contract.deliveryEnd | date:'MMM d' }}</p>
                    </div>
                  </div>
                </div>
              }
            </div>
          </app-card-content>
        </app-card>
      </div>
    </div>
  `
})
export class InsightsComponent implements OnInit {
  private apiService = inject(ApiService);

  customers: Customer[] = [];
  contracts: Contract[] = [];
  tickets: Ticket[] = [];
  plantingIntentions: PlantingIntention[] = [];
  notes: Note[] = [];

  activeContracts = 0;
  pendingContracts = 0;
  totalAcres = 0;
  needsContact: Customer[] = [];
  unsignedContracts: Contract[] = [];
  topCustomers: Customer[] = [];
  upcomingDeliveries: Contract[] = [];

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.apiService.getCustomers().subscribe(data => {
      this.customers = data;
      this.totalAcres = data.reduce((sum, c) => sum + c.totalAcres, 0);
      this.topCustomers = [...data].sort((a, b) => b.totalAcres - a.totalAcres).slice(0, 5);
      this.calculateNeedsContact();
    });

    this.apiService.getContracts().subscribe(data => {
      this.contracts = data;
      this.activeContracts = data.filter(c => c.status === 'Active').length;
      this.pendingContracts = data.filter(c => c.status === 'Pending').length;
      this.unsignedContracts = data.filter(c => !c.signed && c.status !== 'Fulfilled');
      this.upcomingDeliveries = data
        .filter(c => c.status === 'Active' && new Date(c.deliveryEnd) > new Date())
        .sort((a, b) => new Date(a.deliveryStart).getTime() - new Date(b.deliveryStart).getTime())
        .slice(0, 5);
    });

    this.apiService.getNotes().subscribe(data => {
      this.notes = data;
      this.calculateNeedsContact();
    });
  }

  private calculateNeedsContact(): void {
    if (this.customers.length === 0 || this.notes.length === 0) return;

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    this.needsContact = this.customers.filter(customer => {
      const customerNotes = this.notes.filter(n => n.customerId === customer.id);
      if (customerNotes.length === 0) return true;
      const lastNote = customerNotes.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];
      return new Date(lastNote.createdAt).getTime() < thirtyDaysAgo;
    });
  }

  getLastContactDays(customerId: string): number {
    const customerNotes = this.notes.filter(n => n.customerId === customerId);
    if (customerNotes.length === 0) return 999;
    const lastNote = customerNotes.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
    return Math.floor((Date.now() - new Date(lastNote.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  }
}
