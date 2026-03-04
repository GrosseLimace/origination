import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, PlantingIntention, StoredGrain, DashboardPlantingEstimate, DashboardMarketShare, DashboardActualHarvest, Commodity } from '../../models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '../../components/ui/card/card.component';


@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent],
  template: `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-3">
            <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Trade Unit Dashboard</h2>
            @if (availableTradeUnits.length > 1) {
              <div class="relative">
                <button
                  (click)="showTradeUnitDropdown = !showTradeUnitDropdown"
                  class="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  <span>{{ selectedDashboardTradeUnits.length === availableTradeUnits.length ? 'All Trade Units' : selectedDashboardTradeUnits.length + ' selected' }}</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                @if (showTradeUnitDropdown) {
                  <div class="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 py-1">
                    @for (unit of availableTradeUnits; track unit) {
                      <label
                        class="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm text-gray-900 dark:text-white"
                      >
                        <input
                          type="checkbox"
                          [checked]="selectedDashboardTradeUnits.includes(unit)"
                          (change)="toggleDashboardTradeUnit(unit)"
                          class="rounded border-gray-300 dark:border-gray-600 text-green-600 focus:ring-green-500"
                        />
                        {{ unit }}
                      </label>
                    }
                  </div>
                }
              </div>
            }
          </div>
          <p class="text-gray-500 dark:text-gray-400 mt-1">
            @if (selectedDashboardTradeUnits.length > 0) {
              Overview of {{ selectedDashboardTradeUnits.join(', ') }} performance
            } @else {
              Select a trade unit to view performance metrics
            }
          </p>
        </div>
      </div>

      @if (selectedDashboardTradeUnits.length === 0) {
        <div class="flex items-center justify-center py-20">
          <div class="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 text-gray-300 dark:text-gray-600">
              <path d="M12 2a10 10 0 1 0 10 10H12V2z"/>
              <path d="M12 2v10h10"/>
            </svg>
            <p class="text-gray-400 dark:text-gray-500">Select a trade unit above to view dashboard</p>
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

      <!-- Planting Intentions - Full Width -->
      <app-card>
        <app-card-header>
          <div class="flex items-center gap-3 w-full -mx-6 -my-4 px-6 py-4">
            <div
              (click)="togglePlantingIntentions()"
              class="flex items-center gap-3 flex-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-2 px-2 py-1 rounded-lg transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-gray-500 dark:text-gray-400 transition-transform duration-200 flex-shrink-0"
                [class.rotate-180]="!plantingIntentionsExpanded"
              >
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
              <div>
                <app-card-title>Planting Intentions <span class="text-base font-normal text-gray-500 dark:text-gray-400">({{ selectedDashboardTradeUnits.join(', ') }})</span></app-card-title>
                <app-card-description>Planned crops and production estimates across your territory</app-card-description>
              </div>
            </div>
            @if (availablePlantingYears.length > 0) {
              <div class="flex items-center gap-2 flex-shrink-0" (click)="$event.stopPropagation()">
                <label class="text-sm font-medium text-gray-500 dark:text-gray-400">Planting Year:</label>
                <select [(ngModel)]="selectedPlantingYear" (ngModelChange)="onPlantingYearChange()"
                  class="px-3 py-1.5 text-sm font-semibold rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  @for (year of availablePlantingYears; track year) {
                    <option [ngValue]="year">{{ year }}</option>
                  }
                </select>
              </div>
            }
          </div>
        </app-card-header>
        @if (plantingIntentionsExpanded) {
        <app-card-content>
          <!-- 3x2 Grid: Tables stacked two and two -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <!-- Table 1: Average Yield Estimates (Crop Code Level) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-base font-semibold text-gray-900 dark:text-white">Average Yield Estimates</h3>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Yield estimates per crop code</p>
                  </div>
                  <div class="flex gap-2">
                    @if (!yieldEditMode) {
                      <button (click)="startYieldEdit()"
                        class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                        Edit
                      </button>
                    } @else {
                      <button (click)="cancelYieldEdit()"
                        class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors">Cancel</button>
                      <button (click)="saveYieldEdit()" [disabled]="estimatesSaving"
                        class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors disabled:opacity-50">Save</button>
                    }
                  </div>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                      <th class="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Crop</th>
                      <th class="text-right py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Yield Est. (bu/ac)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
                    @for (row of yieldRows; track row.cropCode) {
                      <tr [class]="rowColorBg(row.category)">
                        <td class="py-3 px-4 text-sm font-semibold text-gray-800 dark:text-gray-100">{{ row.cropName }}</td>
                        <td class="py-3 px-4 text-right">
                          @if (yieldEditMode) {
                            <input type="number" [(ngModel)]="tempYieldMap[row.cropCode]" min="0"
                              class="w-24 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                          } @else {
                            @if (row.yieldEstimate != null) {
                              <span class="text-base font-bold text-gray-900 dark:text-white">{{ row.yieldEstimate }}</span>
                            } @else {
                              <span class="text-gray-400 dark:text-gray-500 italic text-xs">--</span>
                            }
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Table 2: Total Estimated Production (READ-ONLY) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <h3 class="text-base font-semibold text-gray-900 dark:text-white">Total Estimated Production</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Sum of (acres × yield) by category</p>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                      <th class="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
                      <th class="text-right py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Production (bu)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
                    @for (row of categoryRows; track row.category) {
                      <tr [class]="rowColorBg(row.category)">
                        <td class="py-3 px-4 text-sm font-semibold text-gray-800 dark:text-gray-100">{{ row.category }}</td>
                        <td class="py-3 px-4 text-right">
                          @if (row.totalEstimatedProduction > 0) {
                            <span class="text-base font-bold text-gray-900 dark:text-white">{{ row.totalEstimatedProduction | number:'1.0-0' }}</span>
                          } @else {
                            <span class="text-gray-400 dark:text-gray-500 italic text-xs">--</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Table 3: Estimated Market Share (EDITABLE %) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-base font-semibold text-gray-900 dark:text-white">Estimate Market Share</h3>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Expected share by category</p>
                  </div>
                  @if (!marketShareEditMode) {
                    <button (click)="startMarketShareEdit()"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                      Edit
                    </button>
                  } @else {
                    <div class="flex gap-1">
                      <button (click)="cancelMarketShareEdit()"
                        class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors">Cancel</button>
                      <button (click)="saveMarketShareEdit()" [disabled]="estimatesSaving"
                        class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors disabled:opacity-50">Save</button>
                    </div>
                  }
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                      <th class="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
                      <th class="text-right py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Mkt Share %</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
                    @for (row of categoryRows; track row.category) {
                      <tr [class]="rowColorBg(row.category)">
                        <td class="py-3 px-4 text-sm font-semibold text-gray-800 dark:text-gray-100">{{ row.category }}</td>
                        <td class="py-3 px-4 text-right">
                          @if (marketShareEditMode) {
                            <div class="inline-flex items-center gap-1">
                              <input type="number" [(ngModel)]="tempMarketShareMap[row.category]" min="0" max="100" step="1"
                                class="w-16 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                              <span class="text-xs text-gray-400">%</span>
                            </div>
                          } @else {
                            @if (row.marketSharePct != null) {
                              <span class="text-base font-bold text-gray-900 dark:text-white">{{ row.marketSharePct }}%</span>
                            } @else {
                              <span class="text-gray-400 dark:text-gray-500 italic text-xs">0%</span>
                            }
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Table 4: Estimated Harvest Handle (READ-ONLY, CALCULATED) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <h3 class="text-base font-semibold text-gray-900 dark:text-white">Estimate Harvest Handle</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Production × market share %</p>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                      <th class="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
                      <th class="text-right py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Est. Handle (bu)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
                    @for (row of categoryRows; track row.category) {
                      <tr [class]="rowColorBg(row.category)">
                        <td class="py-3 px-4 text-sm font-semibold text-gray-800 dark:text-gray-100">{{ row.category }}</td>
                        <td class="py-3 px-4 text-right">
                          @if (row.estimatedHarvestHandle > 0) {
                            <span class="text-base font-bold text-gray-900 dark:text-white">{{ row.estimatedHarvestHandle | number:'1.0-0' }}</span>
                          } @else {
                            <span class="text-gray-400 dark:text-gray-500 italic text-xs">--</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Table 5: Actual PrevYear Producer Harvest Handle (EDITABLE, USER-ADDS ROWS) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between">
                <div>
                  <h3 class="text-base font-semibold text-gray-900 dark:text-white">Actual {{ selectedPlantingYear - 1 }} Producer Harvest Handle</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Actual bushels handled last year by category</p>
                </div>
                <div class="flex gap-2">
                  @if (!harvestEditMode && !showAddHarvestRow) {
                    <button (click)="showAddHarvestRow = true; newHarvestCrop = ''; newHarvestBushels = ''"
                      class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Add Row
                    </button>
                    @if (actualHarvestRows.length > 0) {
                      <button (click)="startHarvestEdit()"
                        class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                        Edit
                      </button>
                    }
                  } @else if (showAddHarvestRow) {
                    <button (click)="showAddHarvestRow = false; newHarvestCrop = ''; newHarvestBushels = ''"
                      class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    <button (click)="addHarvestRow()" [disabled]="harvestSaving || !newHarvestCrop || !newHarvestBushels"
                      class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors disabled:opacity-50">Save</button>
                  } @else {
                    <button (click)="cancelHarvestEdit()"
                      class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    <button (click)="saveHarvestEdit()" [disabled]="harvestSaving"
                      class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors disabled:opacity-50">Save</button>
                  }
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                      <th class="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Crop</th>
                      <th class="text-right py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Bushels (bu)</th>
                      @if (harvestEditMode) {
                        <th class="py-2.5 px-2 w-12"></th>
                      }
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
                    @for (row of actualHarvestRows; track row.id) {
                      <tr [class]="rowColorBg(row.cropCategory)">
                        <td class="py-3 px-4 text-sm font-semibold text-gray-800 dark:text-gray-100">{{ row.cropCategory }}</td>
                        <td class="py-3 px-4 text-right">
                          @if (harvestEditMode) {
                            <input type="text" inputmode="numeric" pattern="[0-9]*" [(ngModel)]="tempHarvestMap[row.id]"
                              class="w-28 text-right text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:outline-none" />
                          } @else {
                            <span class="text-base font-bold text-gray-900 dark:text-white">{{ row.bushels | number:'1.0-0' }}</span>
                          }
                        </td>
                        @if (harvestEditMode) {
                          <td class="py-3 px-2">
                            <button (click)="confirmDeleteHarvestRow = { id: row.id, cropCategory: row.cropCategory }"
                              class="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                          </td>
                        }
                      </tr>
                    }
                    @if (showAddHarvestRow) {
                      <tr class="bg-gray-50 dark:bg-gray-700/30">
                        <td class="py-2.5 px-4">
                          <select [(ngModel)]="newHarvestCrop"
                            class="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:outline-none">
                            <option value="">Select crop...</option>
                            @for (cat of availableHarvestCropCategories; track cat) {
                              <option [value]="cat">{{ cat }}</option>
                            }
                          </select>
                        </td>
                        <td class="py-2.5 px-4">
                          <input type="text" inputmode="numeric" pattern="[0-9]*" [(ngModel)]="newHarvestBushels" placeholder="0"
                            class="w-full text-right text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                            (keydown.enter)="addHarvestRow()" (keydown.escape)="showAddHarvestRow = false; newHarvestCrop = ''; newHarvestBushels = ''" />
                        </td>
                      </tr>
                    }
                    @if (actualHarvestRows.length === 0 && !showAddHarvestRow) {
                      <tr>
                        <td colspan="3" class="py-6 text-center text-xs text-gray-400 dark:text-gray-500 italic">
                          No rows yet — click Add Row to enter last year's harvest data
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <!-- Delete confirmation modal -->
              @if (confirmDeleteHarvestRow) {
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60">
                  <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4">
                    <h3 class="text-base font-semibold text-gray-900 dark:text-white mb-2">Delete Row</h3>
                    <p class="text-sm text-gray-600 dark:text-gray-400 mb-5">
                      Are you sure you want to delete the <span class="font-semibold text-gray-900 dark:text-white">{{ confirmDeleteHarvestRow.cropCategory }}</span> row? This cannot be undone.
                    </p>
                    <div class="flex justify-end gap-3">
                      <button (click)="confirmDeleteHarvestRow = null"
                        class="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        Cancel
                      </button>
                      <button (click)="deleteHarvestRow(confirmDeleteHarvestRow.id); confirmDeleteHarvestRow = null"
                        class="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors">
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              }
            </div>

            <!-- Table 6: Actual Market Share of Selected Producers (READ-ONLY, CALCULATED) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <h3 class="text-base font-semibold text-gray-900 dark:text-white">Actual Market Share of Selected Producers</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Actual harvest last year ÷ total estimated production this year</p>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                      <th class="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Crop</th>
                      <th class="text-right py-2.5 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Market Share %</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
                    @for (row of actualMarketShareRows; track row.cropCategory) {
                      <tr [class]="rowColorBg(row.cropCategory)">
                        <td class="py-3 px-4 text-sm font-semibold text-gray-800 dark:text-gray-100">{{ row.cropCategory }}</td>
                        <td class="py-3 px-4 text-right">
                          @if (row.pct !== null) {
                            <span class="text-base font-bold text-gray-900 dark:text-white">{{ row.pct | number:'1.0-1' }}%</span>
                          } @else {
                            <span class="text-gray-400 dark:text-gray-500 italic text-xs">--</span>
                          }
                        </td>
                      </tr>
                    }
                    @if (actualMarketShareRows.length === 0) {
                      <tr>
                        <td colspan="2" class="py-6 text-center text-xs text-gray-400 dark:text-gray-500 italic">
                          Add rows in the harvest table above to calculate market share
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

          </div>

        </app-card-content>
        }
      </app-card>

      }
    </div>
  `
})
export class DashboardComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private appStateService = inject(AppStateService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  // Data for display
  customers: Customer[] = [];
  contracts: Contract[] = [];
  plantingIntentions: PlantingIntention[] = [];
  storedGrain: StoredGrain[] = [];
  allCommodities: Commodity[] = [];

  // Trade unit selection
  availableTradeUnits: string[] = [];
  selectedDashboardTradeUnits: string[] = [];
  showTradeUnitDropdown = false;

  loading = false;
  totalAcres = 0;
  activeContracts = 0;
  totalContractValue = 0;

  cropDistribution: { name: string; bushels: number; percentage: number; color: string }[] = [];
  contractStatus: { name: string; count: number; dotColor: string }[] = [];

  // Planting Intentions section state
  savedYieldEstimates: DashboardPlantingEstimate[] = [];
  savedMarketShares: DashboardMarketShare[] = [];
  savedActualHarvest: DashboardActualHarvest[] = [];

  // Table 5: Actual harvest edit state
  harvestEditMode = false;
  tempHarvestMap: Record<number, string> = {};
  showAddHarvestRow = false;
  newHarvestCrop = '';
  newHarvestBushels = '';
  harvestSaving = false;
  confirmDeleteHarvestRow: { id: number; cropCategory: string } | null = null;

  // Table 1: Yield rows (crop code level)
  yieldRows: { cropCode: string; cropName: string; category: string; totalAcres: number; yieldEstimate: number | null }[] = [];

  // Tables 2-4: Category rows
  categoryRows: { category: string; totalEstimatedProduction: number; marketSharePct: number | null; estimatedHarvestHandle: number }[] = [];

  availablePlantingYears: number[] = [];
  selectedPlantingYear: number = new Date().getFullYear();

  plantingIntentionsExpanded = false;

  // Add crop dialog

  // Edit mode flags
  yieldEditMode = false;
  marketShareEditMode = false;
  estimatesSaving = false;

  // Temporary edit maps
  tempYieldMap: Record<string, number | null> = {};
  tempMarketShareMap: Record<string, number | null> = {};

  // Loading state to prevent concurrent data loads
  private isLoading = false;
  private isFirstLoad = true;

  ngOnInit(): void {
    const savedState = localStorage.getItem('plantingIntentionsExpanded');
    if (savedState !== null) {
      this.plantingIntentionsExpanded = savedState === 'true';
    }

    this.availableTradeUnits = this.appStateService.selectedTradeUnits();
    this.selectedDashboardTradeUnits = [...this.availableTradeUnits];

    this.loadData();

    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: NavigationEnd) => {
      if (this.isFirstLoad) {
        this.isFirstLoad = false;
        return;
      }
      if (event.urlAfterRedirects === '/dashboard' || event.url === '/dashboard') {
        this.loadData();
      }
    });
  }

  togglePlantingIntentions(): void {
    this.plantingIntentionsExpanded = !this.plantingIntentionsExpanded;
    localStorage.setItem('plantingIntentionsExpanded', this.plantingIntentionsExpanded.toString());
    if (this.plantingIntentionsExpanded) {
      this.reloadPlantingIntentions();
    }
  }

  reloadPlantingIntentions(): void {
    this.apiService.getPlantingIntentions()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.plantingIntentions = data;
          this.calculateYieldRows();
          this.loadDashboardEstimates();
          this.cdr.detectChanges();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleDashboardTradeUnit(unit: string): void {
    const idx = this.selectedDashboardTradeUnits.indexOf(unit);
    if (idx >= 0) {
      if (this.selectedDashboardTradeUnits.length > 1) {
        this.selectedDashboardTradeUnits = this.selectedDashboardTradeUnits.filter(u => u !== unit);
      }
    } else {
      this.selectedDashboardTradeUnits = [...this.selectedDashboardTradeUnits, unit];
    }
    this.loadData();
  }

  private loadData(): void {
    if (this.isLoading) return;
    this.isLoading = true;
    const tradeUnitToLoad = this.selectedDashboardTradeUnits.length > 0 ? this.selectedDashboardTradeUnits : undefined;
    this.loading = true;

    forkJoin({
      customers: this.apiService.getCustomers(tradeUnitToLoad),
      contracts: this.apiService.getContracts(tradeUnitToLoad),
      plantingIntentions: this.apiService.getPlantingIntentions(),
      storedGrain: this.apiService.getStoredGrain(),
      commodities: this.apiService.getCommodities()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.customers = data.customers;
        this.contracts = data.contracts;
        this.plantingIntentions = data.plantingIntentions;
        this.storedGrain = data.storedGrain;
        this.allCommodities = data.commodities;

        const customerIds = new Set(this.customers.map(c => c.id));
        this.storedGrain = this.storedGrain.filter(s => customerIds.has(s.customerId));

        this.calculateMetrics();
        this.calculateYieldRows();
        this.loadDashboardEstimates();

        this.isLoading = false;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to load dashboard data');
        this.isLoading = false;
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private calculateMetrics(): void {
    this.totalAcres = this.customers.reduce((sum, c) => sum + c.totalAcres, 0);
    this.activeContracts = this.contracts.filter(c => c.status === 'Active').length;
    this.totalContractValue = this.contracts.reduce((sum, c) => sum + c.quantity * c.price, 0);

    this.calculateCropDistribution();
    this.calculateContractStatus();
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
    const cropColors: Record<string, string> = {
      'Corn': 'bg-green-500',
      'Soybeans': 'bg-blue-500',
      'Wheat': 'bg-amber-500',
      'Milo': 'bg-orange-500'
    };

    this.cropDistribution = Array.from(cropMap.entries())
      .map(([name, bushels]) => ({
        name,
        bushels,
        percentage: Math.round((bushels / total) * 100),
        color: cropColors[name] || 'bg-gray-500'
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

  // =========================================================================
  // Planting Intentions - computed key and row logic
  // =========================================================================

  get tradeUnitKey(): string {
    return [...this.selectedDashboardTradeUnits].sort().join(',');
  }

  onPlantingYearChange(): void {
    this.selectedPlantingYear = +this.selectedPlantingYear;
    this.reloadPlantingIntentions();
  }

  private calculateYieldRows(): void {
    const selectedTUs = this.selectedDashboardTradeUnits;

    const forGlobalTUs = this.plantingIntentions.filter(p =>
      selectedTUs.length === 0 || selectedTUs.includes(p.tradeUnit)
    );

    // Available years
    const years = [...new Set(forGlobalTUs.map(p => p.plantingYear))].sort((a, b) => b - a);
    this.availablePlantingYears = years;

    // Filter by selected year
    const filtered = forGlobalTUs.filter(p => +p.plantingYear === +this.selectedPlantingYear);

    // Group acres by combined type+category key (e.g. "Dryland Wheat", "Irrigated Corn")
    const cropAcresMap = new Map<string, number>();
    const cropCategoryMap = new Map<string, string>();
    for (const p of filtered) {
      const commodity = this.allCommodities.find(c => c.code === p.crop);
      const category = commodity?.category || p.crop;
      const cropKey = [p.type, category].filter(Boolean).join(' ');
      cropAcresMap.set(cropKey, (cropAcresMap.get(cropKey) || 0) + p.acres);
      cropCategoryMap.set(cropKey, category);
    }

    // Use crop keys from planting intentions only
    const allCropCodes = new Set<string>(cropAcresMap.keys());

    this.yieldRows = [...allCropCodes].sort().map(cropCode => {
      const saved = this.savedYieldEstimates.find(e => e.crop === cropCode);
      return {
        cropCode,
        cropName: cropCode,
        category: cropCategoryMap.get(cropCode) || 'Unknown',
        totalAcres: cropAcresMap.get(cropCode) || 0,
        yieldEstimate: saved?.yieldEstimate ?? null
      };
    });

    this.calculateCategoryRows();
  }

  private calculateCategoryRows(): void {
    // Group yield rows by category, sum production
    const categoryMap = new Map<string, number>();
    for (const row of this.yieldRows) {
      const production = (row.yieldEstimate != null && row.totalAcres > 0)
        ? row.totalAcres * row.yieldEstimate
        : 0;
      const current = categoryMap.get(row.category) || 0;
      categoryMap.set(row.category, current + production);
    }

    this.categoryRows = [...categoryMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, totalEstimatedProduction]) => {
        const savedShare = this.savedMarketShares.find(s => s.cropCategory === category);
        const marketSharePct = savedShare?.marketSharePct ?? null;
        const estimatedHarvestHandle = (marketSharePct != null && totalEstimatedProduction > 0)
          ? totalEstimatedProduction * (marketSharePct / 100)
          : 0;
        return { category, totalEstimatedProduction, marketSharePct, estimatedHarvestHandle };
      });
  }

  loadDashboardEstimates(): void {
    const key = this.tradeUnitKey;
    if (!key) {
      this.savedYieldEstimates = [];
      this.calculateYieldRows();
      return;
    }
    this.apiService.getDashboardPlantingEstimates(key, this.selectedPlantingYear)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.savedYieldEstimates = data;
          this.calculateYieldRows();
          this.loadDashboardMarketShares();
          this.cdr.detectChanges();
        },
        error: () => {
          this.savedYieldEstimates = [];
          this.calculateYieldRows();
          this.cdr.detectChanges();
        }
      });
  }

  loadDashboardMarketShares(): void {
    const key = this.tradeUnitKey;
    if (!key) {
      this.savedMarketShares = [];
      this.calculateCategoryRows();
      return;
    }
    this.apiService.getDashboardMarketShares(key, this.selectedPlantingYear)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.savedMarketShares = data;
          this.calculateCategoryRows();
          this.loadActualHarvest();
          this.cdr.detectChanges();
        },
        error: () => {
          this.savedMarketShares = [];
          this.calculateCategoryRows();
          this.cdr.detectChanges();
        }
      });
  }

  loadActualHarvest(): void {
    const key = this.tradeUnitKey;
    if (!key) {
      this.savedActualHarvest = [];
      this.cdr.detectChanges();
      return;
    }
    this.apiService.getDashboardActualHarvest(key, this.selectedPlantingYear - 1)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.savedActualHarvest = data;
          this.cdr.detectChanges();
        },
        error: () => {
          this.savedActualHarvest = [];
          this.cdr.detectChanges();
        }
      });
  }

  // =========================================================================
  // Yield edit
  // =========================================================================

  startYieldEdit(): void {
    this.yieldEditMode = true;
    this.tempYieldMap = {};
    for (const row of this.yieldRows) {
      this.tempYieldMap[row.cropCode] = row.yieldEstimate;
    }
  }

  saveYieldEdit(): void {
    const key = this.tradeUnitKey;
    if (!key) return;
    const estimates = this.yieldRows.map(row => ({
      tradeUnitKey: key,
      crop: row.cropCode,
      plantingYear: this.selectedPlantingYear,
      yieldEstimate: this.tempYieldMap[row.cropCode] ?? null
    }));
    this.estimatesSaving = true;
    this.apiService.upsertDashboardPlantingEstimates(estimates)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.yieldEditMode = false;
          this.estimatesSaving = false;
          this.toastService.success('Yield estimates saved');
          this.loadDashboardEstimates();
        },
        error: () => {
          this.estimatesSaving = false;
          this.toastService.error('Failed to save yield estimates');
        }
      });
  }

  cancelYieldEdit(): void {
    this.yieldEditMode = false;
    this.tempYieldMap = {};
  }

  // =========================================================================
  // Market share edit
  // =========================================================================

  startMarketShareEdit(): void {
    this.marketShareEditMode = true;
    this.tempMarketShareMap = {};
    for (const row of this.categoryRows) {
      this.tempMarketShareMap[row.category] = row.marketSharePct;
    }
  }

  saveMarketShareEdit(): void {
    const key = this.tradeUnitKey;
    if (!key) return;
    const shares = this.categoryRows.map(row => ({
      tradeUnitKey: key,
      cropCategory: row.category,
      plantingYear: this.selectedPlantingYear,
      marketSharePct: this.tempMarketShareMap[row.category] ?? null
    }));
    this.estimatesSaving = true;
    this.apiService.upsertDashboardMarketShares(shares)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.marketShareEditMode = false;
          this.estimatesSaving = false;
          this.toastService.success('Market share saved');
          this.loadDashboardMarketShares();
        },
        error: () => {
          this.estimatesSaving = false;
          this.toastService.error('Failed to save market share');
        }
      });
  }

  cancelMarketShareEdit(): void {
    this.marketShareEditMode = false;
    this.tempMarketShareMap = {};
  }

  // =========================================================================
  // Add crop to yield estimates
  // =========================================================================

  // =========================================================================
  // Row color coding (consistent category colors across all 6 tables)
  // =========================================================================

  private static readonly CATEGORY_ROW_COLORS = [
    'bg-emerald-100 dark:bg-emerald-800/35',
    'bg-sky-100 dark:bg-sky-800/35',
    'bg-amber-100 dark:bg-amber-800/35',
    'bg-violet-100 dark:bg-violet-800/35',
    'bg-rose-100 dark:bg-rose-800/35',
    'bg-teal-100 dark:bg-teal-800/35',
    'bg-orange-100 dark:bg-orange-800/35',
    'bg-indigo-100 dark:bg-indigo-800/35',
  ];

  rowColorBg(category: string): string {
    const idx = this.categoryRows.findIndex(r => r.category === category);
    if (idx < 0) return 'transition-colors';
    return `${DashboardComponent.CATEGORY_ROW_COLORS[idx % DashboardComponent.CATEGORY_ROW_COLORS.length]} transition-colors`;
  }

  // =========================================================================
  // Actual harvest rows (Table 5) computed
  // =========================================================================

  get actualHarvestRows(): { id: number; cropCategory: string; bushels: number }[] {
    return [...this.savedActualHarvest]
      .filter(h => h.tradeUnitKey === this.tradeUnitKey && h.plantingYear === this.selectedPlantingYear - 1)
      .sort((a, b) => a.cropCategory.localeCompare(b.cropCategory))
      .map(h => ({ id: h.id, cropCategory: h.cropCategory, bushels: h.bushels }));
  }

  /** Categories already added to Table 5 (prevents duplicates in dropdown) */
  get usedHarvestCrops(): Set<string> {
    return new Set(this.actualHarvestRows.map(r => r.cropCategory));
  }

  private static readonly HARVEST_EXCLUDED_CATEGORIES = ['transportation', 'currency', 'feed & fert ingredients'];

  /** Commodity categories available to add (not already in Table 5, excluding non-crop categories) */
  get availableHarvestCropCategories(): string[] {
    const all = [...new Set(this.allCommodities.map(c => c.category).filter(Boolean) as string[])].sort();
    return all.filter(cat =>
      !this.usedHarvestCrops.has(cat) &&
      !DashboardComponent.HARVEST_EXCLUDED_CATEGORIES.includes(cat.toLowerCase())
    );
  }

  // =========================================================================
  // Actual market share rows (Table 6) computed
  // =========================================================================

  get actualMarketShareRows(): { cropCategory: string; harvestBushels: number; totalEstimatedProduction: number; pct: number | null }[] {
    const allCrops = new Set<string>();
    for (const r of this.actualHarvestRows) allCrops.add(r.cropCategory);
    for (const r of this.categoryRows) allCrops.add(r.category);

    return [...allCrops].sort().map(crop => {
      const harvestRow = this.actualHarvestRows.find(r => r.cropCategory === crop);
      const prodRow = this.categoryRows.find(r => r.category === crop);
      const harvestBushels = harvestRow?.bushels ?? 0;
      const totalEstimatedProduction = prodRow?.totalEstimatedProduction ?? 0;
      const pct = totalEstimatedProduction > 0
        ? (harvestBushels / totalEstimatedProduction) * 100
        : null;
      return { cropCategory: crop, harvestBushels, totalEstimatedProduction, pct };
    });
  }

  // =========================================================================
  // Actual harvest CRUD
  // =========================================================================

  startHarvestEdit(): void {
    this.tempHarvestMap = {};
    for (const row of this.actualHarvestRows) {
      this.tempHarvestMap[row.id] = row.bushels.toString();
    }
    this.harvestEditMode = true;
  }

  cancelHarvestEdit(): void {
    this.harvestEditMode = false;
    this.tempHarvestMap = {};
  }

  saveHarvestEdit(): void {
    const rows = this.actualHarvestRows;
    const items = rows
      .map(row => {
        const bushels = parseInt(this.tempHarvestMap[row.id] ?? '', 10);
        return { tradeUnitKey: this.tradeUnitKey, cropCategory: row.cropCategory, plantingYear: this.selectedPlantingYear - 1, bushels };
      })
      .filter(item => !isNaN(item.bushels) && item.bushels >= 0);
    if (items.length === 0) { this.cancelHarvestEdit(); return; }
    this.harvestSaving = true;
    this.apiService.upsertDashboardActualHarvest(items).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.harvestSaving = false;
        this.harvestEditMode = false;
        this.tempHarvestMap = {};
        this.loadActualHarvest();
      },
      error: () => {
        this.harvestSaving = false;
        this.toastService.error('Failed to save harvest data');
      }
    });
  }

  deleteHarvestRow(id: number): void {
    this.apiService.deleteDashboardActualHarvest(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => this.loadActualHarvest(),
        error: () => this.toastService.error('Failed to delete harvest row')
      });
  }

  addHarvestRow(): void {
    const bushels = parseInt(this.newHarvestBushels, 10);
    if (!this.newHarvestCrop || isNaN(bushels) || bushels < 0) return;
    const key = this.tradeUnitKey;
    this.harvestSaving = true;
    this.apiService.upsertDashboardActualHarvest([{
      tradeUnitKey: key,
      cropCategory: this.newHarvestCrop,
      plantingYear: this.selectedPlantingYear - 1,
      bushels
    }]).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.harvestSaving = false;
        this.showAddHarvestRow = false;
        this.newHarvestCrop = '';
        this.newHarvestBushels = '';
        this.loadActualHarvest();
      },
      error: () => {
        this.harvestSaving = false;
        this.toastService.error('Failed to add harvest row');
      }
    });
  }
}
