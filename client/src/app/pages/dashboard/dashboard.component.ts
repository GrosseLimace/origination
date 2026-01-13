import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { Customer, Contract, PlantingIntention } from '../../models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '../../components/ui/card/card.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, BadgeComponent],
  template: `
    <div class="space-y-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Territory Dashboard</h1>

      <!-- Key Metrics -->
      <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <app-card>
          <app-card-content class="p-4 text-center">
            <div class="text-2xl font-bold text-gray-900 dark:text-white">{{ customers.length }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Customers</div>
          </app-card-content>
        </app-card>
        <app-card>
          <app-card-content class="p-4 text-center">
            <div class="text-2xl font-bold text-gray-900 dark:text-white">{{ totalAcres | number }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Total Acres</div>
          </app-card-content>
        </app-card>
        <app-card>
          <app-card-content class="p-4 text-center">
            <div class="text-2xl font-bold text-green-600">{{ activeContracts }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Active Contracts</div>
          </app-card-content>
        </app-card>
        <app-card>
          <app-card-content class="p-4 text-center">
            <div class="text-2xl font-bold text-gray-900 dark:text-white">{{ totalContractedBushels | number }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Contracted Bu</div>
          </app-card-content>
        </app-card>
        <app-card>
          <app-card-content class="p-4 text-center">
            <div class="text-2xl font-bold text-blue-600">{{ plannedAcres | number }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Planned Acres</div>
          </app-card-content>
        </app-card>
        <app-card>
          <app-card-content class="p-4 text-center">
            <div class="text-2xl font-bold text-gray-900 dark:text-white">\${{ avgContractValue | number:'1.2-2' }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Avg Contract</div>
          </app-card-content>
        </app-card>
      </div>

      <!-- Charts Section -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Crop Distribution -->
        <app-card>
          <app-card-header>
            <app-card-title>Crop Distribution (Contracted Bushels)</app-card-title>
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

        <!-- Contract Status -->
        <app-card>
          <app-card-header>
            <app-card-title>Contract Status</app-card-title>
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

        <!-- Planting Intentions -->
        <app-card>
          <app-card-header>
            <app-card-title>2025 Planting Intentions</app-card-title>
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

        <!-- Location Summary -->
        <app-card>
          <app-card-header>
            <app-card-title>Customers by Location</app-card-title>
          </app-card-header>
          <app-card-content>
            <div class="space-y-3">
              @for (loc of locationSummary; track loc.location) {
                <div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div>
                    <p class="font-medium text-gray-900 dark:text-white">{{ loc.location }}</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">{{ loc.customerCount }} customer(s)</p>
                  </div>
                  <div class="text-right">
                    <p class="font-medium text-gray-900 dark:text-white">{{ loc.totalAcres | number }}</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">acres</p>
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
export class DashboardComponent implements OnInit {
  private apiService = inject(ApiService);

  customers: Customer[] = [];
  contracts: Contract[] = [];
  plantingIntentions: PlantingIntention[] = [];

  totalAcres = 0;
  activeContracts = 0;
  totalContractedBushels = 0;
  plannedAcres = 0;
  avgContractValue = 0;

  cropDistribution: { name: string; bushels: number; percentage: number; color: string }[] = [];
  contractStatus: { name: string; count: number; dotColor: string }[] = [];
  plantingByCustomer: { customerId: string; customerName: string; crops: { name: string; acres: number; variant: 'default' | 'secondary' | 'success' }[] }[] = [];
  locationSummary: { location: string; customerCount: number; totalAcres: number }[] = [];

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.apiService.getCustomers().subscribe(data => {
      this.customers = data;
      this.totalAcres = data.reduce((sum, c) => sum + c.totalAcres, 0);
      this.calculateLocationSummary();
    });

    this.apiService.getContracts().subscribe(data => {
      this.contracts = data;
      this.activeContracts = data.filter(c => c.status === 'Active').length;
      this.totalContractedBushels = data.reduce((sum, c) => sum + c.quantity, 0);
      this.avgContractValue = data.length > 0
        ? data.reduce((sum, c) => sum + c.quantity * c.price, 0) / data.length
        : 0;
      this.calculateCropDistribution();
      this.calculateContractStatus();
    });

    this.apiService.getPlantingIntentions().subscribe(data => {
      this.plantingIntentions = data;
      this.plannedAcres = data.reduce((sum, p) => sum + p.acres, 0);
      this.calculatePlantingByCustomer();
    });
  }

  private calculateCropDistribution(): void {
    const cropMap = new Map<string, number>();
    for (const contract of this.contracts) {
      cropMap.set(contract.crop, (cropMap.get(contract.crop) || 0) + contract.quantity);
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
    const customerMap = new Map<string, { name: string; crops: Map<string, number> }>();

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
      customerId,
      customerName: data.name,
      crops: Array.from(data.crops.entries()).map(([name, acres]) => ({
        name,
        acres,
        variant: cropVariants[name] || 'secondary'
      }))
    }));
  }

  private calculateLocationSummary(): void {
    const locationMap = new Map<string, { customerCount: number; totalAcres: number }>();

    for (const customer of this.customers) {
      const loc = customer.location;
      if (!locationMap.has(loc)) {
        locationMap.set(loc, { customerCount: 0, totalAcres: 0 });
      }
      const entry = locationMap.get(loc)!;
      entry.customerCount++;
      entry.totalAcres += customer.totalAcres;
    }

    this.locationSummary = Array.from(locationMap.entries())
      .map(([location, data]) => ({ location, ...data }))
      .sort((a, b) => b.totalAcres - a.totalAcres);
  }
}
