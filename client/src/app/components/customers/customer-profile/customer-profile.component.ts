import { Component, Input, Output, EventEmitter, inject, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../../../services/theme.service';
import { CardComponent, CardHeaderComponent, CardTitleComponent, CardContentComponent } from '../../ui/card/card.component';
import { ContractsTableComponent } from '../contracts-table/contracts-table.component';
import { TicketsTableComponent } from '../tickets-table/tickets-table.component';
import { PlantingIntentionsTableComponent } from '../planting-intentions-table/planting-intentions-table.component';
import { StoredGrainTableComponent } from '../stored-grain-table/stored-grain-table.component';
import { CustomerNotesComponent } from '../customer-notes/customer-notes.component';
import { ProducerInsightsComponent } from '../producer-insights/producer-insights.component';
import { AIGrowthForecastComponent } from '../ai-growth-forecast/ai-growth-forecast.component';
import { ActivitySummaryComponent } from '../activity-summary/activity-summary.component';
import { EditCustomerDialogComponent } from '../edit-customer-dialog/edit-customer-dialog.component';
import { Customer, Farm, Contract, Ticket, PlantingIntention, StoredGrain, Note } from '../../../models';

@Component({
  selector: 'app-customer-profile',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    CardHeaderComponent,
    CardTitleComponent,
    CardContentComponent,
    ContractsTableComponent,
    TicketsTableComponent,
    PlantingIntentionsTableComponent,
    StoredGrainTableComponent,
    CustomerNotesComponent,
    ProducerInsightsComponent,
    AIGrowthForecastComponent,
    ActivitySummaryComponent,
    EditCustomerDialogComponent
  ],
  template: `
    <div class="space-y-8">
      <!-- Header Card -->
      <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm relative">
        <!-- Print Button - Top Right -->
        <button
          type="button"
          class="absolute top-4 right-4 p-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors"
          (click)="printCustomerInfo()"
          title="Print Customer Info"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect width="12" height="8" x="6" y="14"/>
          </svg>
        </button>
        <div class="p-6 pr-16">
          <!-- Row 1: Customer Name + eSign Badge (on same line) -->
          <div class="flex items-center gap-3 flex-wrap mb-1">
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ customer.name }}</h1>
            @if (customer.eSignEnabled) {
              <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-600 text-white">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                eSign Enabled
              </span>
            } @else {
              <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-400 text-white">
                eSign Not Enrolled
              </span>
            }
          </div>

          <!-- Row 2: Farm Name -->
          <p class="text-gray-500 dark:text-gray-400 mb-3">{{ customer.farm }}</p>

          <!-- Row 3: Producer Insights and Edit buttons (under farm name) -->
          <div class="flex items-center gap-2 flex-wrap mb-6">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors"
              [class]="showProducerInsights ? 'bg-green-600 text-white border-green-600' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'"
              (click)="toggleProducerInsights()"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" x2="18" y1="20" y2="10"/>
                <line x1="12" x2="12" y1="20" y2="4"/>
                <line x1="6" x2="6" y1="20" y2="14"/>
              </svg>
              Producer Insights
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              (click)="openEditDialog()"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
              Edit
            </button>
          </div>

          <!-- Row 4: Select Farm Dropdown (only show if more than one farm) -->
          @if (farms.length > 1) {
            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-900 dark:text-white mb-1">Select Farm</label>
              <select
                class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                [ngModel]="getSelectedFarmIdOrFirst()"
                (ngModelChange)="onFarmChange.emit($event)"
              >
                @for (farm of farms; track farm.id) {
                  <option [value]="farm.id">{{ farm.name }}</option>
                }
              </select>
            </div>
          }

          <!-- Row 5: Contact / Farm Details (2 columns) -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <!-- Contact Info -->
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">Contact</h3>
              <div class="space-y-2 text-sm">
                <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  <span>{{ customer.location }}</span>
                </div>
                <a [href]="'tel:' + customer.phone" class="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                  <span>{{ customer.phone }}</span>
                </a>
                <a [href]="'mailto:' + customer.email" class="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="20" height="16" x="2" y="4" rx="2"/>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                  </svg>
                  <span class="truncate">{{ customer.email }}</span>
                </a>
              </div>
            </div>

            <!-- Farm Details -->
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">Farm Details</h3>
              <div class="space-y-2 text-sm">
                <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <!-- Tractor icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m10 11 11 .9a1 1 0 0 1 .8 1.1l-.665 4.158a1 1 0 0 1-.988.842H20"/>
                    <path d="M16 18h-5"/>
                    <path d="M18 5a1 1 0 0 0-1 1v5.573"/>
                    <path d="M3 4h8.129a1 1 0 0 1 .99.863L13 11.246"/>
                    <path d="M4 11V4"/>
                    <path d="M7 15h.01"/>
                    <path d="M8 10.1V4"/>
                    <circle cx="18" cy="18" r="2"/>
                    <circle cx="7" cy="15" r="5"/>
                  </svg>
                  <span>{{ getSelectedFarmAcres() | number }} acres</span>
                </div>
                @if (getSelectedFarmStorage() > 0) {
                  <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <!-- Warehouse icon -->
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/>
                      <path d="M6 18h12"/>
                      <path d="M6 14h12"/>
                      <rect width="12" height="12" x="6" y="10"/>
                    </svg>
                    <span>{{ getSelectedFarmStorage() | number }} bu storage</span>
                  </div>
                }
              </div>
            </div>
          </div>

          <!-- Row 6: Activity / Market Share (2 columns with stat boxes) -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Activity -->
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">Activity</h3>
              <div class="flex gap-4">
                <div class="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-center">
                  <div class="text-2xl font-bold text-green-600">{{ contracts.length }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Contracts</div>
                </div>
                <div class="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-center">
                  <div class="text-2xl font-bold text-blue-600">{{ tickets.length }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Tickets</div>
                </div>
              </div>
            </div>

            <!-- Market Share -->
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">Market Share</h3>
              <div
                class="border rounded-lg p-3 text-center"
                [class]="marketSharePercentage > 0 ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30' : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30'"
              >
                <div
                  class="text-2xl font-bold"
                  [class]="marketSharePercentage > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
                >
                  {{ marketSharePercentage | number:'1.0-0' }}%
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {{ bushelsAvailable | number }} bu available
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Producer Insights Panel (hidden by default, shows when button clicked) -->
      @if (showProducerInsights) {
        <app-producer-insights
          [customer]="customer"
          [contracts]="contracts"
          [tickets]="tickets"
          [plantingIntentions]="plantingIntentions"
          [notes]="notes"
          [storedGrain]="storedGrain">
        </app-producer-insights>

        <!-- AI Growth Forecast -->
        <app-ai-growth-forecast
          [customer]="customer"
          [contracts]="contracts"
          [plantingIntentions]="plantingIntentions"
          [notes]="notes">
        </app-ai-growth-forecast>
      }

      <!-- Activity Summary - Always visible -->
      <app-activity-summary
        [customer]="customer"
        [contracts]="allCustomerContracts"
        [tickets]="allCustomerTickets"
        [plantingIntentions]="allCustomerPlantingIntentions"
        [notes]="notes"
        [storedGrain]="allCustomerStoredGrain">
      </app-activity-summary>

      <!-- Tabs Section - Below Summary -->
      <div>
        <!-- Pill-style tab navigation -->
        <div class="w-full bg-gray-100 dark:bg-gray-800 rounded-full p-1 mb-6">
          <div class="flex">
            @for (tab of tabs; track tab.id) {
              <button
                type="button"
                [class]="getTabClass(tab.id)"
                (click)="activeTab = tab.id"
              >
                {{ tab.label }} ({{ tab.count }})
              </button>
            }
          </div>
        </div>

        <!-- Tab Content -->
        <div class="pb-8">
          @switch (activeTab) {
            @case ('contracts') {
              <app-contracts-table [contracts]="contracts" [tickets]="tickets" [customer]="customer"></app-contracts-table>
            }
            @case ('tickets') {
              <app-tickets-table [tickets]="tickets" [customer]="customer"></app-tickets-table>
            }
            @case ('planting') {
              <app-planting-intentions-table
                [plantingIntentions]="plantingIntentions"
                [customer]="customer"
                (add)="onAddPlanting.emit()"
                (edit)="onEditPlanting.emit($event)">
              </app-planting-intentions-table>
            }
            @case ('storage') {
              <app-stored-grain-table [storedGrain]="storedGrain" [customer]="customer"></app-stored-grain-table>
            }
          }
        </div>
      </div>

      <!-- Notes Section - Always visible at bottom -->
      <app-card>
        <app-card-header>
          <div class="flex items-center justify-between">
            <app-card-title>Notes</app-card-title>
            <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                <line x1="16" x2="16" y1="2" y2="6"/>
                <line x1="8" x2="8" y1="2" y2="6"/>
                <line x1="3" x2="21" y1="10" y2="10"/>
              </svg>
              <span>Last contacted: {{ getLastContactedDate() }}</span>
            </div>
          </div>
        </app-card-header>
        <app-card-content>
          <app-customer-notes
            [notes]="notes"
            [customer]="customer"
            (addNote)="onAddNote.emit($event)"
            (togglePin)="onTogglePin.emit($event)">
          </app-customer-notes>
        </app-card-content>
      </app-card>
    </div>

    <!-- Edit Customer Dialog - managed locally like Blazor -->
    <app-edit-customer-dialog
      [isOpen]="showEditDialog"
      [customer]="customer"
      [allFarms]="allFarms"
      [allCustomers]="allCustomers"
      (close)="closeEditDialog()"
      (save)="handleSaveCustomer($event)"
      (createFarm)="onCreateFarm.emit($event)">
    </app-edit-customer-dialog>
  `
})
export class CustomerProfileComponent implements OnChanges {
  @Input() customer!: Customer;
  @Input() farms: Farm[] = [];
  @Input() allFarms: Farm[] = [];
  @Input() allCustomers: Customer[] = [];
  @Input() contracts: Contract[] = [];
  @Input() tickets: Ticket[] = [];
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() storedGrain: StoredGrain[] = [];
  @Input() notes: Note[] = [];
  @Input() selectedFarmId?: string;

  // Unfiltered data for Activity Summary (all farms)
  @Input() allCustomerContracts: Contract[] = [];
  @Input() allCustomerTickets: Ticket[] = [];
  @Input() allCustomerPlantingIntentions: PlantingIntention[] = [];
  @Input() allCustomerStoredGrain: StoredGrain[] = [];

  @Output() onAddPlanting = new EventEmitter<{crop: string, acres: number, variety: string, plantingDate: Date, estimatedYield: number}>();
  @Output() onEditPlanting = new EventEmitter<{intentionId: string, crop: string, acres: number, variety: string, plantingDate: Date, estimatedYield: number}>();
  @Output() onAddNote = new EventEmitter<string>();
  @Output() onTogglePin = new EventEmitter<Note>();
  @Output() onFarmChange = new EventEmitter<string>();
  @Output() onSaveCustomer = new EventEmitter<{ customerId: string; location: string; phone: string; email: string; farmIds: string[]; linkedProducerIds: string[]; eSignEnabled: boolean }>();
  @Output() onCreateFarm = new EventEmitter<{ name: string; location: string; acres: number }>();

  private themeService = inject(ThemeService);
  private cdr = inject(ChangeDetectorRef);

  // Local state - plain booleans like Blazor
  activeTab = 'contracts';
  showProducerInsights = false;
  showEditDialog = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['customer'] || changes['contracts'] || changes['notes'] || changes['farms']) {
      this.cdr.detectChanges();
    }
  }

  toggleProducerInsights(): void {
    this.showProducerInsights = !this.showProducerInsights;
  }

  openEditDialog(): void {
    this.showEditDialog = true;
    this.cdr.detectChanges();
  }

  closeEditDialog(): void {
    this.showEditDialog = false;
    this.cdr.detectChanges();
  }

  handleSaveCustomer(data: { customerId: string; location: string; phone: string; email: string; farmIds: string[]; linkedProducerIds: string[]; eSignEnabled: boolean }): void {
    this.onSaveCustomer.emit(data);
    this.closeEditDialog();
  }

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  get tabs() {
    return [
      { id: 'contracts', label: 'Contracts', count: this.contracts.length },
      { id: 'tickets', label: 'Tickets', count: this.tickets.length },
      { id: 'planting', label: 'Planting', count: this.plantingIntentions.length },
      { id: 'storage', label: 'Storage', count: this.storedGrain.length }
    ];
  }

  getTabClass(tabId: string): string {
    const isActive = this.activeTab === tabId;
    const baseClass = 'flex-1 text-center px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 border-0 outline-none';

    if (isActive) {
      return `${baseClass} bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm`;
    }
    return `${baseClass} bg-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white`;
  }

  getSelectedFarmIdOrFirst(): string {
    if (this.selectedFarmId) {
      return this.selectedFarmId;
    }
    return this.farms.length > 0 ? this.farms[0].id : '';
  }

  getSelectedFarmAcres(): number {
    const farmId = this.getSelectedFarmIdOrFirst();
    if (farmId) {
      const farm = this.farms.find(f => f.id === farmId);
      return farm?.acres || this.customer.totalAcres;
    }
    return this.customer.totalAcres;
  }

  getSelectedFarmStorage(): number {
    const farmId = this.getSelectedFarmIdOrFirst();
    if (farmId) {
      const farm = this.farms.find(f => f.id === farmId);
      return farm?.binStorageCapacity || 0;
    }
    const farmWithStorage = this.farms.find(f => f.binStorageCapacity && f.binStorageCapacity > 0);
    return farmWithStorage?.binStorageCapacity || 0;
  }

  get totalProjectedYield(): number {
    return this.plantingIntentions.reduce((sum, p) => sum + (p.acres * p.estimatedYield), 0);
  }

  get totalContracted(): number {
    return this.contracts
      .filter(c => c.status === 'Active' || c.status === 'Pending')
      .reduce((sum, c) => sum + c.quantity, 0);
  }

  get marketSharePercentage(): number {
    return this.totalProjectedYield > 0
      ? (this.totalContracted / this.totalProjectedYield) * 100
      : 0;
  }

  get bushelsAvailable(): number {
    return Math.max(0, this.totalProjectedYield - this.totalContracted);
  }

  getLastContactedDate(): string {
    if (this.notes.length === 0) return 'Never';

    const sorted = [...this.notes].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const lastNote = sorted[0];
    const diff = Date.now() - new Date(lastNote.createdAt).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;

    return new Date(lastNote.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /** Opens a print dialog with formatted customer information */
  printCustomerInfo(): void {
    const activeContracts = this.contracts.filter(c => c.status === 'Active' || c.status === 'Pending');
    const contractValue = activeContracts.reduce((sum, c) => sum + (c.quantity * c.price), 0);

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Customer Info - ${this.customer.name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 40px; color: #000; }
          h1 { font-size: 24px; margin-bottom: 8px; color: #000; }
          h2 { font-size: 18px; margin-top: 24px; margin-bottom: 12px; border-bottom: 2px solid #000; padding-bottom: 4px; color: #000; }
          h3 { font-size: 14px; margin-top: 16px; margin-bottom: 8px; color: #000; }
          .header { margin-bottom: 24px; }
          .farm-name { color: #000; font-size: 14px; margin-bottom: 4px; }
          .print-date { color: #000; font-size: 12px; }
          .section { margin-bottom: 20px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          .info-item { margin-bottom: 8px; }
          .label { font-weight: bold; color: #000; font-size: 12px; text-transform: uppercase; }
          .value { font-size: 14px; margin-top: 2px; color: #000; }
          .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 12px; }
          .summary-box { border: 1px solid #000; border-radius: 4px; padding: 12px; text-align: center; }
          .summary-value { font-size: 20px; font-weight: bold; color: #000; }
          .summary-label { font-size: 12px; color: #000; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
          th { background: #fff; text-align: left; padding: 10px 8px; font-weight: 600; border-bottom: 2px solid #000; color: #000; }
          td { padding: 10px 8px; border-bottom: 1px solid #000; color: #000; }
          .status { font-size: 12px; font-weight: 500; color: #000; }
          .text-right { text-align: right; }
          @media print {
            body { padding: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${this.customer.name}</h1>
          <div class="farm-name">${this.customer.farm}</div>
          <div class="print-date">Printed: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>

        <h2>Customer Information</h2>
        <div class="grid">
          <div>
            <h3>Contact</h3>
            <div class="info-item">
              <div class="label">Location</div>
              <div class="value">${this.customer.location}</div>
            </div>
            <div class="info-item">
              <div class="label">Phone</div>
              <div class="value">${this.customer.phone}</div>
            </div>
            <div class="info-item">
              <div class="label">Email</div>
              <div class="value">${this.customer.email}</div>
            </div>
          </div>
          <div>
            <h3>Farm Details</h3>
            <div class="info-item">
              <div class="label">Total Acres</div>
              <div class="value">${this.getSelectedFarmAcres().toLocaleString()} acres</div>
            </div>
            ${this.getSelectedFarmStorage() > 0 ? `
            <div class="info-item">
              <div class="label">Storage Capacity</div>
              <div class="value">${this.getSelectedFarmStorage().toLocaleString()} bushels</div>
            </div>
            ` : ''}
            <div class="info-item">
              <div class="label">eSign Status</div>
              <div class="value">${this.customer.eSignEnabled ? 'Enabled' : 'Not Enrolled'}</div>
            </div>
          </div>
        </div>

        <h2>Farm Overview</h2>
        <div class="section">
          ${this.farms.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>Farm Name</th>
                <th class="text-right">Acres</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              ${this.farms.map(farm => `
              <tr>
                <td>${farm.name}</td>
                <td class="text-right">${farm.acres?.toLocaleString() || '-'}</td>
                <td>${farm.location || '-'}</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
          ` : '<p>No farms on record</p>'}
        </div>

        <h2>Contract Summary</h2>
        <div class="summary-grid">
          <div class="summary-box">
            <div class="summary-value">${this.totalContracted.toLocaleString()}</div>
            <div class="summary-label">Total Contracted Bushels</div>
          </div>
          <div class="summary-box">
            <div class="summary-value">${this.bushelsAvailable.toLocaleString()}</div>
            <div class="summary-label">Available Bushels</div>
          </div>
          <div class="summary-box">
            <div class="summary-value">$${contractValue.toLocaleString()}</div>
            <div class="summary-label">Contract Value</div>
          </div>
        </div>

        <h2>Active Contracts</h2>
        <div class="section">
          ${activeContracts.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>Contract #</th>
                <th>Crop</th>
                <th class="text-right">Quantity</th>
                <th class="text-right">Price</th>
                <th>Delivery Period</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${activeContracts.map(contract => `
              <tr>
                <td>${contract.contractNumber}</td>
                <td>${contract.crop}</td>
                <td class="text-right">${contract.quantity.toLocaleString()} bu</td>
                <td class="text-right">$${contract.price.toFixed(2)}</td>
                <td>${this.formatDeliveryPeriod(contract.deliveryStart, contract.deliveryEnd)}</td>
                <td><span class="status">${contract.status}</span></td>
              </tr>
              `).join('')}
            </tbody>
          </table>
          ` : '<p>No active contracts</p>'}
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  }

  /** Formats delivery period for print display */
  private formatDeliveryPeriod(start: Date, end: Date): string {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `${startMonth} - ${endMonth}`;
  }
}
