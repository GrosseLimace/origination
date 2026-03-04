import { Component, Input, Output, EventEmitter, inject, OnChanges, SimpleChanges, ChangeDetectorRef, ChangeDetectionStrategy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { ContractsTableComponent } from '../contracts-table/contracts-table.component';
import { TicketsTableComponent } from '../tickets-table/tickets-table.component';
import { PlantingIntentionsTableComponent } from '../planting-intentions-table/planting-intentions-table.component';
import { StoredGrainTableComponent } from '../stored-grain-table/stored-grain-table.component';
import { ProducerInsightsComponent } from '../producer-insights/producer-insights.component';
import { ContractPacingCardComponent } from '../contract-pacing-card/contract-pacing-card.component';
import { AIGrowthForecastComponent } from '../ai-growth-forecast/ai-growth-forecast.component';
import { ActivitySummaryComponent } from '../activity-summary/activity-summary.component';
import { EditCustomerDialogComponent } from '../edit-customer-dialog/edit-customer-dialog.component';
import { Customer, Contract, Ticket, PlantingIntention, StoredGrain, Note, ContractPricingLine, DashboardPlantingEstimate, Commodity } from '../../../models';

@Component({
  selector: 'app-customer-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ContractsTableComponent,
    TicketsTableComponent,
    PlantingIntentionsTableComponent,
    StoredGrainTableComponent,
    ProducerInsightsComponent,
    ContractPacingCardComponent,
    AIGrowthForecastComponent,
    ActivitySummaryComponent,
    EditCustomerDialogComponent
  ],
  template: `
    <div class="space-y-8">
      <!-- Header Card -->
      <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
        <div class="p-4 sm:p-6">
          <!-- Top: Name block + action buttons -->
          <div class="flex items-start justify-between gap-3 mb-4">
            <div class="min-w-0">
              <!-- Name + eSign badge on same line -->
              <div class="flex items-center gap-2 min-w-0">
                <h1 class="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white leading-tight truncate min-w-0">{{ customer.name }}</h1>
                @if (customer.eSignEnabled) {
                  <button
                    type="button"
                    (click)="showESignRecipients = !showESignRecipients"
                    class="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    eSign Enrolled
                  </button>
                } @else {
                  <span class="shrink-0 inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 border border-gray-200 dark:border-gray-600">
                    No eSign
                  </span>
                }
              </div>
              @if (customer.eSignEnabled && showESignRecipients && customer.scoularViewRecipients) {
                <div class="mt-2">
                  <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">ScoularView Recipients</p>
                  <div class="flex flex-wrap gap-1.5">
                    @for (recipient of customer.scoularViewRecipients.split(','); track recipient) {
                      @if (recipient.trim()) {
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          {{ recipient.trim() }}
                        </span>
                      }
                    }
                  </div>
                </div>
              }
              @if (customer.sourceCustomerId) {
                <p class="text-sm text-gray-400 dark:text-gray-500 mt-0.5">{{ customer.sourceCustomerId }}</p>
              }
              @if (customer.farm) {
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ customer.farm }}</p>
              }
              <div class="flex items-center gap-2 mt-2 flex-wrap">
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs sm:text-sm font-medium transition-colors"
                  [class]="showProducerInsights ? 'bg-green-600 text-white border-green-600' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'"
                  (click)="toggleProducerInsights()"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" x2="18" y1="20" y2="10"/>
                    <line x1="12" x2="12" y1="20" y2="4"/>
                    <line x1="6" x2="6" y1="20" y2="14"/>
                  </svg>
                  Producer Insights
                </button>
                @if (linkedCustomers.length > 0) {
                  <select
                    class="h-9 w-auto max-w-xs px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500"
                    [value]="customer.id"
                    (change)="onSelectLinkedCustomer.emit(+$any($event.target).value)"
                  >
                    <option [value]="customer.id">{{ customer.name }}{{ customer.sourceCustomerId ? ' (' + customer.sourceCustomerId + ')' : '' }}</option>
                    @for (linked of linkedCustomers; track linked.id) {
                      <option [value]="linked.id">{{ linked.name }}{{ linked.sourceCustomerId ? ' (' + linked.sourceCustomerId + ')' : '' }}</option>
                    }
                  </select>
                }
              </div>
            </div>

            <!-- Action buttons -->
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors"
                (click)="printCustomerInfo()"
                title="Print"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9"/>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                  <rect width="12" height="8" x="6" y="14"/>
                </svg>
                <span class="hidden sm:inline">Print</span>
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors"
                (click)="openEditDialog()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                </svg>
                Edit
              </button>
            </div>
          </div>

          <!-- Divider -->
          <div class="border-t border-gray-100 dark:border-gray-700 mb-4"></div>

          <!-- Details: Contact + Farm Details + Contract Percentage -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-4">
            <!-- Contact -->
            <div>
              <h3 class="text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2.5">Contact</h3>
              <div class="space-y-2 text-xs sm:text-sm">
                @if (customer.primaryContact) {
                  <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" class="shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                    <span>{{ customer.primaryContact }}</span>
                  </div>
                }
                <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" class="shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <span>{{ getFormattedLocation() }}</span>
                </div>
                @if (getCustomerPhone()) {
                  <a [href]="'tel:' + getCustomerPhone()" class="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" class="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                    <span>{{ getFormattedPhone() }}</span>
                  </a>
                }
                @if (getCustomerEmail()) {
                  <a [href]="'mailto:' + getCustomerEmail()" class="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" class="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                    </svg>
                    <span class="truncate">{{ getCustomerEmail() }}</span>
                  </a>
                }
              </div>
            </div>

            <!-- Farm Details -->
            <div>
              <h3 class="text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2.5">Farm Details</h3>
              <div class="space-y-2 text-xs sm:text-sm">
                <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" class="shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m10 11 11 .9a1 1 0 0 1 .8 1.1l-.665 4.158a1 1 0 0 1-.988.842H20"/>
                    <path d="M16 18h-5"/><path d="M18 5a1 1 0 0 0-1 1v5.573"/>
                    <path d="M3 4h8.129a1 1 0 0 1 .99.863L13 11.246"/>
                    <path d="M4 11V4"/><path d="M7 15h.01"/><path d="M8 10.1V4"/>
                    <circle cx="18" cy="18" r="2"/><circle cx="7" cy="15" r="5"/>
                  </svg>
                  <span>{{ (customer.totalAcres || 0) | number }} acres</span>
                </div>
                <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" class="shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/>
                  </svg>
                  <span>{{ (customer.binCapacity || 0) | number }} bu capacity</span>
                </div>
                <div class="flex items-start gap-2 text-gray-600 dark:text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" class="shrink-0 mt-0.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 22 16 8"/>
                    <path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
                    <path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
                    <path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
                    <path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z"/>
                    <path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>
                    <path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>
                    <path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>
                  </svg>
                  @if (getEffectiveCommodities().length > 0) {
                    <div class="flex flex-wrap gap-1">
                      @for (commodity of getEffectiveCommodities(); track commodity) {
                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">{{ commodity }}</span>
                      }
                    </div>
                  } @else {
                    <span>No commodities</span>
                  }
                </div>
              </div>
            </div>

            <!-- Contract Pace Percentage (Year-over-Year) -->
            <div>
              <h3 class="text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2.5">Contract Pace Percentage</h3>
              @if (yoyCurrentYear === 0) {
                <p class="text-xs text-gray-400 dark:text-gray-500 py-2">No contract data available.</p>
              } @else {
                <div class="rounded-lg border p-3 text-center cursor-pointer transition-opacity hover:opacity-80 select-none"
                     [class]="pacingBoxClass"
                     (click)="toggleProducerInsights()"
                     title="Click to {{ showProducerInsights ? 'hide' : 'show' }} Contract Pacing details">
                  <div class="text-3xl font-bold">{{ yoyThisPctDisplay }}</div>
                  <div class="text-xs mt-1 opacity-60">{{ yoyCurrentYear - 1 }} vs {{ yoyCurrentYear }}</div>
                </div>
              }
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

        <app-contract-pacing-card [contracts]="contracts"></app-contract-pacing-card>

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
        [storedGrain]="allCustomerStoredGrain"
        [allCustomers]="allCustomers">
      </app-activity-summary>

      <!-- Tabs Section - Below Summary -->
      <div #tabsSection>
        <!-- Pill-style tab navigation -->
        <div class="w-full bg-gray-100 dark:bg-gray-800 rounded-full p-0.5 sm:p-1 mb-6">
          <div class="flex">
            @for (tab of tabs; track tab.id) {
              <button
                type="button"
                [class]="getTabClass(tab.id)"
                (click)="selectTab(tab.id)"
              >
                <span class="hidden sm:inline">{{ tab.label }} ({{ tab.count }})</span>
                <span class="sm:hidden">{{ tab.shortLabel }} ({{ tab.count }})</span>
              </button>
            }
          </div>
        </div>

        <!-- Tab Content -->
        <div class="pb-8">
          @switch (activeTab) {
            @case ('contracts') {
              <app-contracts-table [contracts]="contracts" [tickets]="tickets" [pricingLines]="pricingLines" [customer]="customer" [openContractId]="openContractId"></app-contracts-table>
            }
            @case ('tickets') {
              <app-tickets-table [tickets]="tickets" [contracts]="contracts" [customer]="customer"></app-tickets-table>
            }
            @case ('planting') {
              <!-- Contract Percentage Summary for this planting year -->
              @if (isLoadingEstimates) {
                <div class="mb-4 flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500 px-1">
                  <svg class="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.961 3 8.12l3-2.829z"></path>
                  </svg>
                  Calculating contract percentage...
                </div>
              } @else if (plantingIntentions.length > 0) {
                <div class="mb-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <div class="flex items-center justify-between gap-4 flex-wrap">
                    <div class="flex items-start gap-6 flex-wrap">
                      <div class="text-center min-w-[80px] relative group cursor-default">
                        <div class="text-3xl font-bold" [class]="marketSharePercentage > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'">{{ marketSharePercentage | number:'1.0-0' }}%</div>
                        <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Contracted{{ contractYear > 0 ? ' (' + contractYear + ')' : '' }}</div>
                        <!-- Hover tooltip -->
                        <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 w-64 pointer-events-none">
                          <div class="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 shadow-lg text-left space-y-1">
                            <p class="text-gray-300">bu contracted / bu projected yield</p>
                            <p class="text-gray-400">Projected yield = planting acres × yield estimate (set in the Trade Unit Dashboard).</p>
                          </div>
                          <div class="w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45 mx-auto -mt-1"></div>
                        </div>
                      </div>
                      <div class="border-l border-gray-200 dark:border-gray-700 pl-6 space-y-1 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        <div><span class="font-medium text-gray-700 dark:text-gray-300">{{ totalContracted | number }}</span> bu contracted</div>
                        <div><span class="font-medium text-gray-700 dark:text-gray-300">{{ totalProjectedYield | number }}</span> bu projected yield</div>
                        <div><span class="font-medium text-gray-700 dark:text-gray-300">{{ bushelsAvailable | number }}</span> bu available to contract</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors shrink-0"
                      (click)="openAddPlanting()"
                    >
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                      </svg>
                      Add Planting Intention
                    </button>
                  </div>
                </div>
              }
              <app-planting-intentions-table
                [plantingIntentions]="plantingIntentions"
                [customer]="customer"
                [tradeUnits]="selectedTradeUnits"
                [customerCommodityCodes]="getEffectiveCommodities()"
                [yieldEstimateCrops]="yieldEstimateCrops"
                (add)="onAddPlanting.emit($event)"
                (edit)="onEditPlanting.emit($event)"
                (delete)="onDeletePlanting.emit($event)">
              </app-planting-intentions-table>
            }
            @case ('storage') {
              <app-stored-grain-table [storedGrain]="storedGrain" [customer]="customer"></app-stored-grain-table>
            }
          }
        </div>
      </div>
    </div>

    <!-- Edit Customer Dialog - managed locally like Blazor -->
    <app-edit-customer-dialog
      [isOpen]="showEditDialog"
      [customer]="customer"
      [tickets]="tickets"
      [allCustomers]="allCustomers"
      [selectedTradeUnits]="selectedTradeUnits"
      (close)="closeEditDialog()"
      (save)="handleSaveCustomer($event)">
    </app-edit-customer-dialog>
  `
})
export class CustomerProfileComponent implements OnChanges {
  @Input() customer!: Customer;
  @Input() allCustomers: Customer[] = [];
  @Input() selectedTradeUnits: string[] = [];
  @Input() contracts: Contract[] = [];
  @Input() tickets: Ticket[] = [];
  @Input() pricingLines: ContractPricingLine[] = [];
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() storedGrain: StoredGrain[] = [];
  @Input() notes: Note[] = [];
  @Input() yieldEstimateCrops: string[] = [];
  @Input() yieldEstimates: DashboardPlantingEstimate[] = [];
  @Input() commodities: Commodity[] = [];
  @Input() isLoadingEstimates = false;

  // Unfiltered data for Activity Summary
  @Input() allCustomerContracts: Contract[] = [];
  @Input() allCustomerTickets: Ticket[] = [];
  @Input() allCustomerPlantingIntentions: PlantingIntention[] = [];
  @Input() allCustomerStoredGrain: StoredGrain[] = [];

  @Output() onAddPlanting = new EventEmitter<{crop: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}>();
  @Output() onEditPlanting = new EventEmitter<{intentionId: number, crop: string, type?: string, description?: string, acres: number, plantingYear: number}>();
  @Output() onDeletePlanting = new EventEmitter<number>();
  @Output() onAddNote = new EventEmitter<string>();
  @Output() onTogglePin = new EventEmitter<Note>();
  @Output() onSaveCustomer = new EventEmitter<{ customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean }>();
  @Input() linkedCustomers: Customer[] = [];
  @Output() onSelectLinkedCustomer = new EventEmitter<number>();
  @Input() openContractId: number | null = null;

  @ViewChild(PlantingIntentionsTableComponent) private plantingTable?: PlantingIntentionsTableComponent;
  @ViewChild('tabsSection') private tabsSectionRef?: ElementRef<HTMLElement>;

  private themeService = inject(ThemeService);
  private cdr = inject(ChangeDetectorRef);

  // Local state - plain booleans like Blazor
  activeTab = 'contracts';
  showProducerInsights = false;
  showESignRecipients = false;
  showEditDialog = false;

  selectTab(tabId: string): void {
    this.activeTab = tabId;
    // Scroll the tabs section into view so the user doesn't have to manually scroll down
    const el = this.tabsSectionRef?.nativeElement;
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 72; // 72px offset for sticky header
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }

  // Performance optimization: Cache computed values used in template
  private _totalProjectedYield = 0;
  private _totalContracted = 0;
  private _marketSharePercentage = 0;
  private _bushelsAvailable = 0;
  private _contractYear = 0;
  private _pacingDeliveryYear = 0;
  private _pacingPct: number | null = null;
  private _tabs: any[] = [];
  private _unappliedTicketCount = 0;
  private _effectiveCommodities: string[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    // When arriving from Insights with a specific contract, switch to contracts tab
    if (changes['openContractId'] && this.openContractId != null) {
      this.activeTab = 'contracts';
    }

    // Reset eSign recipients panel when switching customers
    if (changes['customer']) {
      this.showESignRecipients = false;
    }

    // Derive the contract year from the most recent planting intention year.
    // All contract % calculations are scoped to this year.
    if (changes['plantingIntentions']) {
      let maxYear = 0;
      for (const pi of this.plantingIntentions) {
        if (pi.plantingYear > maxYear) maxYear = pi.plantingYear;
      }
      this._contractYear = maxYear;
    }

    // Recalculate total contracted bushels:
    // Include Active, Pending, Fulfilled, and Overdue — exclude Cancelled.
    // Scope to the planting intention year via cropYear on the contract.
    if (changes['contracts'] || changes['plantingIntentions']) {
      const year = this._contractYear;
      this._totalContracted = this.contracts
        .filter(c =>
          c.status !== 'Cancelled' &&
          (year === 0 || c.cropYear === year)
        )
        .reduce((sum, c) => sum + c.quantity, 0);
    }

    // Contract pacing: delivery-year YoY % change — purely contract-based, no planting intentions.
    // Mirrors the logic in ContractPacingCardComponent.
    if (changes['contracts']) {
      let maxYear = 0;
      for (const c of this.contracts) {
        if (c.deliveryStart) {
          const y = new Date(c.deliveryStart).getFullYear();
          if (y > maxYear) maxYear = y;
        }
      }
      this._pacingDeliveryYear = maxYear;

      if (maxYear > 0) {
        const priorYear = maxYear - 1;
        const today = new Date();
        const samePointLastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());

        const thisYearBu = this.contracts
          .filter(c => c.deliveryStart && new Date(c.deliveryStart).getFullYear() === maxYear)
          .reduce((sum, c) => sum + c.quantity, 0);

        const lastYearBu = this.contracts
          .filter(c => {
            if (!c.deliveryStart || new Date(c.deliveryStart).getFullYear() !== priorYear) return false;
            if (!c.contractDate) return true;
            return new Date(c.contractDate) <= samePointLastYear;
          })
          .reduce((sum, c) => sum + c.quantity, 0);

        this._pacingPct = lastYearBu > 0 ? ((thisYearBu - lastYearBu) / lastYearBu) * 100 : null;
      } else {
        this._pacingPct = null;
      }
    }

    // Recalculate projected yield from planting intentions × dashboard yield estimates.
    // Yield estimates are keyed by "[type] [category]" (e.g. "Dryland CORN") — same
    // composite key the dashboard uses when saving estimates.
    if (changes['plantingIntentions'] || changes['yieldEstimates'] || changes['commodities']) {
      const intentionsForYear = this._contractYear > 0
        ? this.plantingIntentions.filter(pi => pi.plantingYear === this._contractYear)
        : this.plantingIntentions;

      this._totalProjectedYield = intentionsForYear.reduce((sum, pi) => {
        const commodity = this.commodities.find(c => c.code === pi.crop);
        const category = commodity?.category || pi.crop;
        const cropKey = [pi.type, category].filter(Boolean).join(' ');
        const est = this.yieldEstimates.find(ye => ye.crop === cropKey);
        return sum + pi.acres * (est?.yieldEstimate ?? 0);
      }, 0);
    }

    // Recalculate dependent values
    if (changes['plantingIntentions'] || changes['yieldEstimates'] || changes['commodities'] || changes['contracts']) {
      this._marketSharePercentage = this._totalProjectedYield > 0
        ? (this._totalContracted / this._totalProjectedYield) * 100
        : 0;
      this._bushelsAvailable = Math.max(0, this._totalProjectedYield - this._totalContracted);
    }

    // Update unapplied ticket count
    if (changes['contracts'] || changes['tickets']) {
      const appliedContractIds = new Set(
        this.contracts
          .map(c => c.sourceContractId)
          .filter((id): id is string => !!id)
      );
      this._unappliedTicketCount = this.tickets.filter(t =>
        !t.ctrmContractNumber || !appliedContractIds.has(t.ctrmContractNumber.trim())
      ).length;
    }

    // Update tabs cache
    if (changes['contracts'] || changes['tickets'] || changes['plantingIntentions'] || changes['storedGrain']) {
      this._tabs = [
        { id: 'contracts', label: 'Contracts', shortLabel: 'Cont', count: this.contracts.length },
        { id: 'tickets', label: 'Unapplied Tickets', shortLabel: 'Tick', count: this.unappliedTicketCount },
        { id: 'planting', label: 'Planting', shortLabel: 'Plan', count: this.plantingIntentions.length },
        { id: 'storage', label: 'Storage', shortLabel: 'Stor', count: this.storedGrain.length }
      ];
    }

    // Rebuild effective commodities from tickets + user-added
    if (changes['customer'] || changes['tickets']) {
      const ticketCommodities = [...new Set(
        this.tickets
          .map(t => t.productCode || '')
          .filter(Boolean)
      )];
      const userCommodities = this.customer?.commodities || [];
      this._effectiveCommodities = [...new Set([...ticketCommodities, ...userCommodities])].sort();
    }

    if (changes['customer'] || changes['contracts'] || changes['notes']) {
      this.cdr.markForCheck();
    }
  }

  toggleProducerInsights(): void {
    this.showProducerInsights = !this.showProducerInsights;
    this.cdr.markForCheck();
  }

  openEditDialog(): void {
    this.showEditDialog = true;
    this.cdr.markForCheck();
  }

  closeEditDialog(): void {
    this.showEditDialog = false;
    this.cdr.markForCheck();
  }

  openAddPlanting(): void {
    this.plantingTable?.openAddDialog();
  }

  handleSaveCustomer(data: { customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean }): void {
    this.onSaveCustomer.emit(data);
    this.closeEditDialog();
  }

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  get tabs() {
    return this._tabs;
  }

  getTabClass(tabId: string): string {
    const isActive = this.activeTab === tabId;
    const baseClass = 'flex-1 text-center px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 border-0 outline-none';

    if (isActive) {
      return `${baseClass} bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm`;
    }
    return `${baseClass} bg-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white`;
  }

  get contractYear(): number {
    return this._contractYear;
  }

  get totalProjectedYield(): number {
    return this._totalProjectedYield;
  }

  get totalContracted(): number {
    return this._totalContracted;
  }

  get marketSharePercentage(): number {
    return this._marketSharePercentage;
  }

  get bushelsAvailable(): number {
    return this._bushelsAvailable;
  }

  /** Most recent delivery year seen across all contracts. */
  get yoyCurrentYear(): number { return this._pacingDeliveryYear; }

  /** YoY pacing % as display string, e.g. "+15%" or "-8%" or "—" if no prior-year data. */
  get yoyThisPctDisplay(): string {
    if (this._pacingPct === null) return '—';
    const sign = this._pacingPct >= 0 ? '+' : '';
    return `${sign}${Math.round(this._pacingPct)}%`;
  }

  /** True when pacing is strictly ahead vs prior year. */
  get yoyIsAhead(): boolean {
    return this._pacingPct !== null && this._pacingPct > 0;
  }

  /** Box classes for the Contract Pace Percentage card: green/red/neutral. */
  get pacingBoxClass(): string {
    if (this._pacingPct === null || this._pacingPct === 0) {
      return 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400';
    }
    return this._pacingPct > 0
      ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
      : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400';
  }

  get unappliedTicketCount(): number {
    return this._unappliedTicketCount;
  }

  getEffectiveCommodities(): string[] {
    return this._effectiveCommodities;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Opens a print dialog with formatted customer information */
  printCustomerInfo(): void {
    const activeContracts = this.contracts.filter(c => c.status === 'Active' || c.status === 'Pending');
    const contractValue = activeContracts.reduce((sum, c) => sum + (c.quantity * c.price), 0);

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Customer Info - ${this.escapeHtml(this.customer.name)}</title>
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
          <h1>${this.escapeHtml(this.customer.name)}</h1>
          <div class="farm-name">${this.escapeHtml(this.customer.farm ?? '')}</div>
          <div class="print-date">Printed: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>

        <h2>Customer Information</h2>
        <div class="grid">
          <div>
            <h3>Contact</h3>
            <div class="info-item">
              <div class="label">Location</div>
              <div class="value">${this.escapeHtml(this.getFormattedLocation())}</div>
            </div>
            ${this.getCustomerPhone() ? `
            <div class="info-item">
              <div class="label">Phone</div>
              <div class="value">${this.escapeHtml(this.getFormattedPhone())}</div>
            </div>
            ` : ''}
            ${this.getCustomerEmail() ? `
            <div class="info-item">
              <div class="label">Email</div>
              <div class="value">${this.escapeHtml(this.getCustomerEmail() ?? '')}</div>
            </div>
            ` : ''}
          </div>
          <div>
            <h3>Farm Details</h3>
            <div class="info-item">
              <div class="label">Total Acres</div>
              <div class="value">${(this.customer.totalAcres || 0).toLocaleString()} acres</div>
            </div>
            ${(this.customer.binCapacity || 0) > 0 ? `
            <div class="info-item">
              <div class="label">Bin Capacity</div>
              <div class="value">${(this.customer.binCapacity || 0).toLocaleString()} bushels</div>
            </div>
            ` : ''}
            <div class="info-item">
              <div class="label">eSign Status</div>
              <div class="value">${this.customer.eSignEnabled ? 'Enabled' : 'Not Enrolled'}</div>
            </div>
          </div>
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
                <td>${this.escapeHtml(contract.contractNumber)}</td>
                <td>${this.escapeHtml(contract.commodityDescription || contract.commodityCode || '')}</td>
                <td class="text-right">${contract.quantity.toLocaleString()} bu</td>
                <td class="text-right">$${contract.price.toFixed(2)}</td>
                <td>${this.escapeHtml(this.formatDeliveryPeriod(contract.deliveryStart, contract.deliveryEnd))}</td>
                <td><span class="status">${this.escapeHtml(contract.status ?? '')}</span></td>
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

  getFormattedLocation(): string {
    if (!this.customer.location && !this.customer.stateProvince) {
      return '';
    }
    if (this.customer.location && this.customer.stateProvince) {
      return `${this.customer.location}, ${this.customer.stateProvince}`;
    }
    return this.customer.location || this.customer.stateProvince || '';
  }

  getCustomerPhone(): string {
    // Use primary phone, fallback to extended phone if primary is empty
    return this.customer.phone || this.customer.extendedPrimaryPhone || '';
  }

  getCustomerEmail(): string {
    // Use primary email, fallback to supplemental email if primary is empty
    return this.customer.email || this.customer.supplementalEmail || '';
  }

  getFormattedPhone(): string {
    const phone = this.getCustomerPhone();
    if (!phone) return '';
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    // Format as (XXX) XXX-XXXX
    if (cleaned.length === 10) {
      return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
    }
    // Return original if not 10 digits
    return phone;
  }
}
