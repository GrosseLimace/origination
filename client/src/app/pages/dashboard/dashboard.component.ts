import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, PlantingIntention, StoredGrain } from '../../models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '../../components/ui/card/card.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';

interface StorageSummaryItem {
  crop: string;
  totalBushels: number;
  customerCount: number;
  percentage: number;
  color: string;
}

interface UnsignedContract {
  contract: Contract;
  customerName: string;
  value: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent, BadgeComponent],
  template: `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-3">
            <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Trade Unit Dashboard</h2>
            @if (availableTradeUnits.length > 1) {
              <select
                [(ngModel)]="selectedTradeUnitForDashboard"
                (change)="onTradeUnitChange()"
                class="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                @for (unit of availableTradeUnits; track unit) {
                  <option [value]="unit">{{ unit }}</option>
                }
              </select>
            } @else if (availableTradeUnits.length === 1) {
              <span class="text-lg font-medium text-gray-600 dark:text-gray-300">- {{ availableTradeUnits[0] }}</span>
            }
          </div>
          <p class="text-gray-500 dark:text-gray-400 mt-1">
            @if (selectedTradeUnitForDashboard) {
              Overview of {{ selectedTradeUnitForDashboard }} performance
            } @else {
              Select a trade unit to view performance metrics
            }
          </p>
        </div>
      </div>

      @if (!selectedTradeUnitForDashboard) {
        <div class="flex items-center justify-center py-20">
          <div class="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 text-gray-400 dark:text-gray-500">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            <p class="text-gray-500 dark:text-gray-400 font-medium text-lg mb-2">No Trade Unit Selected</p>
            <p class="text-gray-400 dark:text-gray-500 text-sm">Please select a trade unit from the Customers page to view dashboard metrics</p>
          </div>
        </div>
      } @else if (loading) {
        <div class="flex items-center justify-center py-20">
          <div class="text-center">
            <div class="inline-block animate-spin rounded-full h-16 w-16 border-4 border-gray-300 dark:border-gray-600 border-t-green-600 dark:border-t-green-500 mb-4"></div>
            <p class="text-gray-500 dark:text-gray-400 font-medium text-lg">Loading dashboard data...</p>
          </div>
        </div>
      } @else {
        <!-- Summary Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <app-card class="!p-4">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-400">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div>
              <div class="text-2xl font-bold text-gray-900 dark:text-white">{{ customers.length }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">Total Customers</div>
            </div>
          </div>
        </app-card>
        <app-card class="!p-4">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-600 dark:text-blue-400">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div>
              <div class="text-2xl font-bold text-gray-900 dark:text-white">{{ activeContracts }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">Active Contracts</div>
            </div>
          </div>
        </app-card>
        <app-card class="!p-4">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-600 dark:text-amber-400">
                <path d="M12 2a10 10 0 1 0 10 10H12V2z"/>
                <path d="M12 2v10h10"/>
              </svg>
            </div>
            <div>
              <div class="text-2xl font-bold text-gray-900 dark:text-white">{{ totalAcres | number }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">Total Acres</div>
            </div>
          </div>
        </app-card>
        <app-card class="!p-4">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-purple-600 dark:text-purple-400">
                <line x1="12" x2="12" y1="2" y2="22"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div>
              <div class="text-2xl font-bold text-gray-900 dark:text-white">\${{ totalContractValue | number:'1.0-0' }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">Contract Value</div>
            </div>
          </div>
        </app-card>
      </div>

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Contract Status Distribution -->
        <app-card>
          <app-card-header>
            <app-card-title>Contract Status Distribution</app-card-title>
            <app-card-description>All contracts across your territory</app-card-description>
          </app-card-header>
          <app-card-content>
            <div class="space-y-4">
              @for (status of contractStatus; track status.name) {
                <div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div class="flex items-center gap-3">
                    <div class="w-3 h-3 rounded-full" [class]="status.dotColor"></div>
                    <span class="text-gray-900 dark:text-white">{{ status.name }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-2xl font-bold text-gray-900 dark:text-white">{{ status.count }}</span>
                    <span class="text-sm text-gray-500 dark:text-gray-400">contracts</span>
                  </div>
                </div>
              }
            </div>
          </app-card-content>
        </app-card>

        <!-- Crop Distribution -->
        <app-card>
          <app-card-header>
            <app-card-title>Crop Distribution</app-card-title>
            <app-card-description>Contracted bushels by crop type</app-card-description>
          </app-card-header>
          <app-card-content>
            <div class="space-y-4">
              @for (crop of cropDistribution; track crop.name) {
                <div>
                  <div class="flex justify-between mb-1">
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ crop.name }}</span>
                    <span class="text-sm text-gray-500 dark:text-gray-400">{{ crop.bushels | number }} bu ({{ crop.percentage }}%)</span>
                  </div>
                  <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                    <div
                      class="h-3 rounded-full"
                      [class]="crop.color"
                      [style.width.%]="crop.percentage"
                    ></div>
                  </div>
                </div>
              }
            </div>
          </app-card-content>
        </app-card>
      </div>

      <!-- Unsigned Contracts Alert -->
      @if (unsignedContracts.length > 0) {
        <app-card class="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
          <app-card-header>
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-600 dark:text-red-400">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" x2="12" y1="9" y2="13"/>
                <line x1="12" x2="12.01" y1="17" y2="17"/>
              </svg>
              <app-card-title class="text-red-800 dark:text-red-200">Unsigned Contracts Requiring Attention</app-card-title>
            </div>
            <app-card-description class="text-red-600 dark:text-red-400">{{ unsignedContracts.length }} contract(s) awaiting signature - \${{ totalUnsignedValue | number:'1.0-0' }} at risk</app-card-description>
          </app-card-header>
          <app-card-content>
            <div class="space-y-3">
              @for (item of unsignedContracts; track item.contract.id) {
                <div
                  class="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900 cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  (click)="navigateToCustomer(item.contract.customerId)">
                  <div class="flex items-center gap-3">
                    <div class="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-600 dark:text-red-400">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                      </svg>
                    </div>
                    <div>
                      <div class="font-medium text-gray-900 dark:text-white">{{ item.customerName }}</div>
                      <div class="text-sm text-gray-500 dark:text-gray-400">{{ item.contract.contractNumber }} - {{ item.contract.commodityDescription || item.contract.commodityCode }} ({{ item.contract.quantity | number }} bu)</div>
                    </div>
                  </div>
                  <div class="text-right">
                    <div class="font-bold text-red-600 dark:text-red-400">\${{ item.value | number:'1.0-0' }}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">contract value</div>
                  </div>
                </div>
              }
            </div>
          </app-card-content>
        </app-card>
      }

      <!-- Bottom Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Storage Summary -->
        <app-card>
          <app-card-header>
            <app-card-title>Territory Storage Summary</app-card-title>
            <app-card-description>{{ totalStoredBushels | number }} bushels across {{ customersWithStorage }} customers</app-card-description>
          </app-card-header>
          <app-card-content>
            @if (storageSummary.length > 0) {
              <div class="space-y-4">
                @for (item of storageSummary; track item.crop) {
                  <div>
                    <div class="flex justify-between mb-1">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ item.crop }}</span>
                        <span class="text-xs text-gray-400">({{ item.customerCount }} customer{{ item.customerCount !== 1 ? 's' : '' }})</span>
                      </div>
                      <span class="text-sm text-gray-500 dark:text-gray-400">{{ item.totalBushels | number }} bu ({{ item.percentage }}%)</span>
                    </div>
                    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                      <div
                        class="h-3 rounded-full transition-all"
                        [class]="item.color"
                        [style.width.%]="item.percentage"
                      ></div>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <div class="text-center py-6 text-gray-500 dark:text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-2 text-gray-400">
                  <path d="M2 20h20"/>
                  <path d="M5 20V8l7-5 7 5v12"/>
                  <path d="M9 20v-6h6v6"/>
                </svg>
                <p>No grain currently in storage</p>
              </div>
            }
          </app-card-content>
        </app-card>

        <!-- Planting Intentions -->
        <app-card>
          <app-card-header>
            <app-card-title>2025 Planting Intentions</app-card-title>
            <app-card-description>Planned crops by customer</app-card-description>
          </app-card-header>
          <app-card-content>
            <div class="space-y-3">
              @for (intention of plantingByCustomer; track intention.customerId) {
                <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div class="font-medium text-gray-900 dark:text-white mb-2">{{ intention.customerName }}</div>
                  <div class="flex flex-wrap gap-2">
                    @for (crop of intention.crops; track crop.name) {
                      <app-badge [variant]="crop.variant">{{ crop.name }}: {{ crop.acres | number }} ac</app-badge>
                    }
                  </div>
                </div>
              }
            </div>
          </app-card-content>
        </app-card>
      </div>
      }
    </div>
  `
})
export class DashboardComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private appStateService = inject(AppStateService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  // Data for display
  customers: Customer[] = [];
  contracts: Contract[] = [];
  plantingIntentions: PlantingIntention[] = [];
  storedGrain: StoredGrain[] = [];

  // Trade unit selection
  availableTradeUnits: string[] = [];
  selectedTradeUnitForDashboard: string = '';

  loading = false;
  totalAcres = 0;
  activeContracts = 0;
  totalContractValue = 0;

  cropDistribution: { name: string; bushels: number; percentage: number; color: string }[] = [];
  contractStatus: { name: string; count: number; dotColor: string }[] = [];
  plantingByCustomer: { customerId: string; customerName: string; crops: { name: string; acres: number; variant: 'default' | 'secondary' | 'success' }[] }[] = [];
  storageSummary: StorageSummaryItem[] = [];
  unsignedContracts: UnsignedContract[] = [];
  totalStoredBushels = 0;
  customersWithStorage = 0;

  get totalUnsignedValue(): number {
    return this.unsignedContracts.reduce((sum, item) => sum + item.value, 0);
  }

  ngOnInit(): void {
    // Get selected trade units from app state
    this.availableTradeUnits = this.appStateService.selectedTradeUnits();

    // Set the first trade unit as default for dashboard view
    if (this.availableTradeUnits.length > 0) {
      this.selectedTradeUnitForDashboard = this.availableTradeUnits[0];
      this.loadData();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onTradeUnitChange(): void {
    // When user changes the selected trade unit, reload data for that specific trade unit
    this.loadData();
  }

  private loadData(): void {
    // Load data for the currently selected trade unit for dashboard display
    const tradeUnitToLoad = this.selectedTradeUnitForDashboard ? [this.selectedTradeUnitForDashboard] : undefined;

    this.loading = true;

    forkJoin({
      customers: this.apiService.getCustomers(tradeUnitToLoad),
      contracts: this.apiService.getContracts(tradeUnitToLoad),
      plantingIntentions: this.apiService.getPlantingIntentions(),
      storedGrain: this.apiService.getStoredGrain()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.customers = data.customers;
        this.contracts = data.contracts;
        this.plantingIntentions = data.plantingIntentions;
        this.storedGrain = data.storedGrain;

        // Filter planting intentions and stored grain by customer IDs from the loaded customers
        const customerIds = new Set(this.customers.map(c => c.id));
        this.plantingIntentions = this.plantingIntentions.filter(p => customerIds.has(p.customerId));
        this.storedGrain = this.storedGrain.filter(s => customerIds.has(s.customerId));

        this.calculateMetrics();
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load dashboard data:', err);
        this.toastService.error('Failed to load dashboard data');
        this.loading = false;
      }
    });
  }

  private calculateMetrics(): void {
    this.totalAcres = this.customers.reduce((sum, c) => sum + c.totalAcres, 0);
    this.activeContracts = this.contracts.filter(c => c.status === 'Active').length;
    this.totalContractValue = this.contracts.reduce((sum, c) => sum + c.quantity * c.price, 0);

    this.calculateCropDistribution();
    this.calculateContractStatus();
    this.calculatePlantingByCustomer();
    this.calculateStorageSummary();
    this.calculateUnsignedContracts();
  }

  navigateToCustomer(customerId: number): void {
    this.router.navigate(['/'], { queryParams: { customerId } });
  }

  private calculateCropDistribution(): void {
    const cropMap = new Map<string, number>();
    for (const contract of this.contracts) {
      const commodity = contract.commodityDescription || contract.commodityCode || 'Unknown';
      cropMap.set(commodity, (cropMap.get(commodity) || 0) + (contract.quantity || 0));
    }

    const total = Array.from(cropMap.values()).reduce((a, b) => a + b, 0);
    const colors = ['bg-green-500', 'bg-blue-500', 'bg-amber-500', 'bg-purple-500'];

    this.cropDistribution = Array.from(cropMap.entries())
      .map(([name, bushels], i) => ({
        name,
        bushels,
        percentage: Math.round((bushels / total) * 100),
        color: colors[i % colors.length]
      }))
      .sort((a, b) => b.bushels - a.bushels);
  }

  private calculateContractStatus(): void {
    const statusMap = new Map<string, number>();
    for (const contract of this.contracts) {
      statusMap.set(contract.status, (statusMap.get(contract.status) || 0) + 1);
    }

    const statusColors: Record<string, string> = {
      'Active': 'bg-green-500',
      'Pending': 'bg-amber-500',
      'Fulfilled': 'bg-blue-500',
      'Cancelled': 'bg-red-500'
    };

    this.contractStatus = Array.from(statusMap.entries()).map(([name, count]) => ({
      name,
      count,
      dotColor: statusColors[name] || 'bg-gray-500'
    }));
  }

  private calculatePlantingByCustomer(): void {
    if (this.customers.length === 0 || this.plantingIntentions.length === 0) return;

    const customerMap = new Map<number, { name: string; crops: Map<string, number> }>();

    for (const intention of this.plantingIntentions) {
      const customer = this.customers.find(c => c.id === intention.customerId);
      if (!customer) continue;

      if (!customerMap.has(intention.customerId)) {
        customerMap.set(intention.customerId, { name: customer.name, crops: new Map() });
      }

      const entry = customerMap.get(intention.customerId)!;
      entry.crops.set(intention.crop, (entry.crops.get(intention.crop) || 0) + intention.acres);
    }

    const cropVariants: Record<string, 'default' | 'secondary' | 'success'> = {
      'Corn': 'success',
      'Soybeans': 'default',
      'Wheat': 'secondary'
    };

    this.plantingByCustomer = Array.from(customerMap.entries()).map(([customerId, data]) => ({
      customerId: customerId.toString(),
      customerName: data.name,
      crops: Array.from(data.crops.entries()).map(([name, acres]) => ({
        name,
        acres,
        variant: cropVariants[name] || 'secondary'
      }))
    }));
  }

  private calculateStorageSummary(): void {
    if (this.storedGrain.length === 0) {
      this.storageSummary = [];
      this.totalStoredBushels = 0;
      this.customersWithStorage = 0;
      return;
    }

    // Calculate totals by crop
    const cropMap = new Map<string, { bushels: number; customers: Set<number> }>();

    for (const grain of this.storedGrain) {
      const existing = cropMap.get(grain.crop) || { bushels: 0, customers: new Set<number>() };
      existing.bushels += grain.bushels;
      existing.customers.add(grain.customerId);
      cropMap.set(grain.crop, existing);
    }

    // Calculate total and unique customers
    this.totalStoredBushels = this.storedGrain.reduce((sum, g) => sum + g.bushels, 0);
    this.customersWithStorage = new Set(this.storedGrain.map(g => g.customerId)).size;

    // Color palette for crops
    const colors: Record<string, string> = {
      'Corn': 'bg-amber-500',
      'Soybeans': 'bg-green-500',
      'Wheat': 'bg-yellow-500',
      'Oats': 'bg-orange-500',
      'Barley': 'bg-purple-500',
      'Sorghum': 'bg-red-500'
    };
    const defaultColors = ['bg-blue-500', 'bg-teal-500', 'bg-indigo-500', 'bg-pink-500'];
    let colorIndex = 0;

    this.storageSummary = Array.from(cropMap.entries())
      .map(([crop, data]) => ({
        crop,
        totalBushels: data.bushels,
        customerCount: data.customers.size,
        percentage: Math.round((data.bushels / this.totalStoredBushels) * 100),
        color: colors[crop] || defaultColors[colorIndex++ % defaultColors.length]
      }))
      .sort((a, b) => b.totalBushels - a.totalBushels);
  }

  private calculateUnsignedContracts(): void {
    if (this.customers.length === 0 || this.contracts.length === 0) return;

    this.unsignedContracts = this.contracts
      .filter(c => !c.signed && (c.status === 'Active' || c.status === 'Pending'))
      .map(contract => {
        const customer = this.customers.find(c => c.id === contract.customerId);
        return {
          contract,
          customerName: customer?.name || 'Unknown',
          value: contract.quantity * contract.price
        };
      })
      .sort((a, b) => b.value - a.value);
  }
}
