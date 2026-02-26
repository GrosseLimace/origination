import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, PlantingIntention, StoredGrain, DashboardPlantingEstimate, DashboardMarketShare, Commodity } from '../../models';
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
          <div
            (click)="togglePlantingIntentions()"
            class="flex items-center gap-3 w-full cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-6 -my-4 px-6 py-4 rounded-lg transition-colors"
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
            <div class="flex items-center gap-3 flex-1">
              <div>
                <app-card-title>Planting Intentions <span class="text-base font-normal text-gray-500 dark:text-gray-400">({{ selectedDashboardTradeUnits.join(', ') }})</span></app-card-title>
                <app-card-description>Planned crops and production estimates across your territory</app-card-description>
              </div>
            </div>
          </div>
        </app-card-header>
        @if (plantingIntentionsExpanded) {
        <app-card-content>
          <!-- 2x2 Grid: Tables stacked two and two -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <!-- Table 1: Average Yield Estimates (Crop Code Level) -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Average Yield Estimates</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Yield estimates per crop code</p>
                  </div>
                  <div class="flex gap-2">
                    @if (!yieldEditMode) {
                      <button
                        (click)="startYieldEdit()"
                        class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-green-300 dark:border-green-700 text-xs font-medium text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                        Edit
                      </button>
                    } @else {
                      <button
                        (click)="cancelYieldEdit()"
                        class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >Cancel</button>
                      <button
                        (click)="saveYieldEdit()"
                        [disabled]="estimatesSaving"
                        class="px-2 py-1 rounded-md border border-green-300 dark:border-green-700 text-xs font-medium text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                      >Save</button>
                    }
                  </div>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Crop</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Yield Est. (bu/ac)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    @for (row of yieldRows; track row.cropCode) {
                      <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td class="py-2 px-4 text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.cropName }}</td>
                        <td class="py-2 px-4 text-right text-sm">
                          @if (yieldEditMode) {
                            <input
                              type="number"
                              [(ngModel)]="tempYieldMap[row.cropCode]"
                              min="0"
                              class="w-24 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          } @else {
                            @if (row.yieldEstimate != null) {
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">{{ row.yieldEstimate }}</span>
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
              <div class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Total Estimated Production</h3>
                <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Sum of (acres x yield) by category</p>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Category</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Production (bu)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    @for (row of categoryRows; track row.category) {
                      <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td class="py-2 px-4 text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.category }}</td>
                        <td class="py-2 px-4 text-right text-sm font-bold text-gray-900 dark:text-white">
                          @if (row.totalEstimatedProduction > 0) {
                            {{ row.totalEstimatedProduction | number:'1.0-0' }}
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
              <div class="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Est. Market Share</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Expected share by category</p>
                  </div>
                  @if (!marketShareEditMode) {
                    <button
                      (click)="startMarketShareEdit()"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-orange-300 dark:border-orange-700 text-xs font-medium text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                      Edit
                    </button>
                  } @else {
                    <div class="flex gap-1">
                      <button
                        (click)="cancelMarketShareEdit()"
                        class="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >Cancel</button>
                      <button
                        (click)="saveMarketShareEdit()"
                        [disabled]="estimatesSaving"
                        class="px-2 py-1 rounded-md border border-orange-300 dark:border-orange-700 text-xs font-medium text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-50"
                      >Save</button>
                    </div>
                  }
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Category</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Mkt Share %</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    @for (row of categoryRows; track row.category) {
                      <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td class="py-2 px-4 text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.category }}</td>
                        <td class="py-2 px-4 text-right text-sm">
                          @if (marketShareEditMode) {
                            <div class="inline-flex items-center gap-1">
                              <input
                                type="number"
                                [(ngModel)]="tempMarketShareMap[row.category]"
                                min="0"
                                max="100"
                                step="1"
                                class="w-16 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <span class="text-xs text-gray-400">%</span>
                            </div>
                          } @else {
                            @if (row.marketSharePct != null) {
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">{{ row.marketSharePct }}%</span>
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
              <div class="bg-gradient-to-r from-teal-50 to-cyan-50 dark:from-teal-900/20 dark:to-cyan-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Est. Harvest Handle</h3>
                <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Production x market share %</p>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Category</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Est. Handle (bu)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    @for (row of categoryRows; track row.category) {
                      <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td class="py-2 px-4 text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.category }}</td>
                        <td class="py-2 px-4 text-right text-sm font-bold text-gray-900 dark:text-white">
                          @if (row.estimatedHarvestHandle > 0) {
                            {{ row.estimatedHarvestHandle | number:'1.0-0' }}
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
    this.loadDashboardEstimates();
    this.loadDashboardMarketShares();
  }

  private calculateYieldRows(): void {
    const selectedTUs = this.selectedDashboardTradeUnits;

    const forGlobalTUs = this.plantingIntentions.filter(p =>
      selectedTUs.length === 0 || selectedTUs.includes(p.tradeUnit)
    );

    // Available years
    const years = [...new Set(forGlobalTUs.map(p => p.plantingYear))].sort((a, b) => b - a);
    this.availablePlantingYears = years;
    if (years.length > 0 && !years.includes(this.selectedPlantingYear)) {
      this.selectedPlantingYear = years[0];
    }

    // Filter by selected year
    const filtered = forGlobalTUs.filter(p => p.plantingYear === this.selectedPlantingYear);

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
          this.cdr.detectChanges();
        },
        error: () => {
          this.savedMarketShares = [];
          this.calculateCategoryRows();
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

}
