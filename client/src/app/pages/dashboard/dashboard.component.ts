import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, PlantingIntention, StoredGrain, DashboardPlantingEstimate } from '../../models';
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
        <div class="flex min-h-[60vh] items-center justify-center">
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
                <app-card-title>Planting Intentions</app-card-title>
                <app-card-description>Planned crops and production estimates across your territory</app-card-description>
              </div>
              @if (availablePlantingYears.length > 0) {
                <select
                  [(ngModel)]="selectedPlantingYear"
                  (change)="onPlantingYearChange()"
                  (click)="$event.stopPropagation()"
                  class="ml-2 px-2.5 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  @for (year of availablePlantingYears; track year) {
                    <option [value]="year">{{ year }}</option>
                  }
                </select>
              }
            </div>
          </div>
        </app-card-header>
        @if (plantingIntentionsExpanded) {
        <app-card-content>
          @if (plantingRows.length === 0) {
            <div class="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500 text-sm">
              No planting intentions found for the selected trade units and year.
            </div>
          } @else {
          <!-- Row 1: Estimated Production and Estimated Harvest Handle -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

            <!-- Estimated Production -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-base font-semibold text-gray-900 dark:text-white">Estimated Production</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Total acres × yield estimate per acre</p>
                  </div>
                  @if (!yieldEditMode) {
                    <button
                      (click)="startYieldEdit()"
                      class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-green-300 dark:border-green-700 text-xs sm:text-sm font-medium text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" class="sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                      </svg>
                      Edit
                    </button>
                  } @else {
                    <div class="flex gap-2">
                      <button
                        (click)="cancelYieldEdit()"
                        class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-gray-300 dark:border-gray-600 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" class="sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                        Cancel
                      </button>
                      <button
                        (click)="saveYieldEdit()"
                        [disabled]="estimatesSaving"
                        class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-green-300 dark:border-green-700 text-xs sm:text-sm font-medium text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" class="sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Save
                      </button>
                    </div>
                  }
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Crop</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Acres</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Yield (bu/ac)</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Production (bu)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    @for (row of plantingRows; track row.crop) {
                      <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td class="py-2 px-4 text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.crop }}</td>
                        <td class="py-2 px-4 text-right text-sm text-gray-700 dark:text-gray-300">{{ row.totalAcres | number:'1.0-0' }}</td>
                        <td class="py-2 px-4 text-right text-sm">
                          @if (yieldEditMode) {
                            <input
                              type="number"
                              [(ngModel)]="tempYieldMap[row.crop]"
                              min="0"
                              class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                          } @else {
                            @if (row.yieldEstimate != null) {
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">{{ row.yieldEstimate }}</span>
                            } @else {
                              <span class="text-gray-400 dark:text-gray-500 italic text-xs">—</span>
                            }
                          }
                        </td>
                        <td class="py-2 px-4 text-right text-sm font-bold text-gray-900 dark:text-white">
                          @if (row.yieldEstimate != null) {
                            {{ row.totalProduction | number:'1.0-0' }}
                          } @else {
                            <span class="text-gray-400 dark:text-gray-500 italic text-xs">—</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Estimated Harvest Handle -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-base font-semibold text-gray-900 dark:text-white">Estimated Harvest Handle</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Production × market share %</p>
                  </div>
                  @if (!marketShareEditMode) {
                    <button
                      (click)="startMarketShareEdit()"
                      class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-orange-300 dark:border-orange-700 text-xs sm:text-sm font-medium text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" class="sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                      </svg>
                      Edit
                    </button>
                  } @else {
                    <div class="flex gap-2">
                      <button
                        (click)="cancelMarketShareEdit()"
                        class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-gray-300 dark:border-gray-600 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" class="sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                        Cancel
                      </button>
                      <button
                        (click)="saveMarketShareEdit()"
                        [disabled]="estimatesSaving"
                        class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-orange-300 dark:border-orange-700 text-xs sm:text-sm font-medium text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-50"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" class="sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Save
                      </button>
                    </div>
                  }
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Crop</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Production (bu)</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Mkt Share %</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Est. Handle (bu)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    @for (row of plantingRows; track row.crop) {
                      <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td class="py-2 px-4 text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.crop }}</td>
                        <td class="py-2 px-4 text-right text-sm text-gray-700 dark:text-gray-300">
                          @if (row.yieldEstimate != null) {
                            {{ row.totalProduction | number:'1.0-0' }}
                          } @else {
                            <span class="text-gray-400 dark:text-gray-500 italic text-xs">—</span>
                          }
                        </td>
                        <td class="py-2 px-4 text-right text-sm">
                          @if (marketShareEditMode) {
                            <div class="inline-flex items-center gap-1">
                              <input
                                type="number"
                                [(ngModel)]="tempMarketShareMap[row.crop]"
                                min="0"
                                max="100"
                                step="1"
                                class="w-16 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                              />
                              <span class="text-xs text-gray-400">%</span>
                            </div>
                          } @else {
                            @if (row.marketSharePct != null) {
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">{{ row.marketSharePct }}%</span>
                            } @else {
                              <span class="text-gray-400 dark:text-gray-500 italic text-xs">—</span>
                            }
                          }
                        </td>
                        <td class="py-2 px-4 text-right text-sm font-bold text-gray-900 dark:text-white">
                          @if (row.marketSharePct != null && row.yieldEstimate != null) {
                            {{ row.estHarvestHandle | number:'1.0-0' }}
                          } @else {
                            <span class="text-gray-400 dark:text-gray-500 italic text-xs">—</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Row 2: Actual Harvest Handle and Actual Market Share -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <!-- Actual Harvest Handle -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-base font-semibold text-gray-900 dark:text-white">Actual Harvest Handle</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Actual bushels handled at harvest</p>
                  </div>
                  @if (!actualHarvestEditMode) {
                    <button
                      (click)="startActualHarvestEdit()"
                      class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-red-300 dark:border-red-700 text-xs sm:text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" class="sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                      </svg>
                      Edit
                    </button>
                  } @else {
                    <div class="flex gap-2">
                      <button
                        (click)="cancelActualHarvestEdit()"
                        class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-gray-300 dark:border-gray-600 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" class="sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                        Cancel
                      </button>
                      <button
                        (click)="saveActualHarvestEdit()"
                        [disabled]="estimatesSaving"
                        class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-red-300 dark:border-red-700 text-xs sm:text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" class="sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Save
                      </button>
                    </div>
                  }
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Crop</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Actual Handle (bu)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    @for (row of plantingRows; track row.crop) {
                      <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td class="py-2.5 px-4 text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.crop }}</td>
                        <td class="py-2.5 px-4 text-right text-sm">
                          @if (actualHarvestEditMode) {
                            <div class="inline-flex items-center gap-1">
                              <input
                                type="number"
                                [(ngModel)]="tempActualMap[row.crop]"
                                min="0"
                                step="1"
                                class="w-28 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                              />
                              <span class="text-xs text-gray-400">bu</span>
                            </div>
                          } @else {
                            @if (row.actualHarvestHandle != null) {
                              <span class="text-base font-bold text-gray-900 dark:text-white">{{ row.actualHarvestHandle | number:'1.0-0' }}</span>
                              <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">bu</span>
                            } @else {
                              <span class="text-gray-400 dark:text-gray-500 italic text-xs">—</span>
                            }
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Actual Market Share -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="bg-gradient-to-r from-cyan-50 to-teal-50 dark:from-cyan-900/20 dark:to-teal-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <h3 class="text-base font-semibold text-gray-900 dark:text-white">Actual Market Share</h3>
                <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Actual handle ÷ estimated production</p>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Crop</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Actual Market Share</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    @for (row of plantingRows; track row.crop) {
                      <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td class="py-2.5 px-4 text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.crop }}</td>
                        <td class="py-2.5 px-4 text-right text-sm">
                          @if (row.actualHarvestHandle != null && row.totalProduction > 0) {
                            <span class="text-base font-bold text-gray-900 dark:text-white">{{ row.actualMarketSharePct | number:'1.1-1' }}%</span>
                          } @else {
                            <span class="text-gray-400 dark:text-gray-500 italic text-xs">—</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          }
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

  // Trade unit selection
  availableTradeUnits: string[] = [];
  selectedTradeUnitForDashboard: string = '';

  loading = false;
  totalAcres = 0;
  activeContracts = 0;
  totalContractValue = 0;

  cropDistribution: { name: string; bushels: number; percentage: number; color: string }[] = [];
  contractStatus: { name: string; count: number; dotColor: string }[] = [];

  // Planting Intentions section state
  savedEstimates: DashboardPlantingEstimate[] = [];
  plantingRows: { crop: string; totalAcres: number; yieldEstimate: number | null; totalProduction: number; marketSharePct: number | null; estHarvestHandle: number; actualHarvestHandle: number | null; actualMarketSharePct: number }[] = [];
  availablePlantingYears: number[] = [];
  selectedPlantingYear: number = new Date().getFullYear();

  plantingIntentionsExpanded = false;

  // Edit mode flags
  yieldEditMode = false;
  marketShareEditMode = false;
  actualHarvestEditMode = false;
  estimatesSaving = false;

  // Temporary edit maps (keyed by crop code)
  tempYieldMap: Record<string, number | null> = {};
  tempMarketShareMap: Record<string, number | null> = {};
  tempActualMap: Record<string, number | null> = {};

  // Loading state to prevent concurrent data loads
  private isLoading = false;
  private isFirstLoad = true;

  ngOnInit(): void {
    // Load the saved state from localStorage
    const savedState = localStorage.getItem('plantingIntentionsExpanded');
    if (savedState !== null) {
      this.plantingIntentionsExpanded = savedState === 'true';
    }

    // Get selected trade units from app state and set default
    this.availableTradeUnits = this.appStateService.selectedTradeUnits();
    if (this.availableTradeUnits.length > 0) {
      this.selectedTradeUnitForDashboard = this.availableTradeUnits[0];
    }

    // Initial data load
    this.loadData();

    // Reload data when navigating back to the dashboard route
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: NavigationEnd) => {
      // Skip the first NavigationEnd event which happens during component initialization
      if (this.isFirstLoad) {
        this.isFirstLoad = false;
        return;
      }

      // Only reload if we're navigating TO the dashboard route
      if (event.urlAfterRedirects === '/dashboard' || event.url === '/dashboard') {
        this.loadData();
      }
    });
  }

  togglePlantingIntentions(): void {
    this.plantingIntentionsExpanded = !this.plantingIntentionsExpanded;
    // Save the state to localStorage
    localStorage.setItem('plantingIntentionsExpanded', this.plantingIntentionsExpanded.toString());
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
    // Prevent concurrent data loads
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
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

        // Filter stored grain by customer IDs from the loaded customers
        const customerIds = new Set(this.customers.map(c => c.id));
        this.storedGrain = this.storedGrain.filter(s => customerIds.has(s.customerId));

        this.calculateMetrics();
        this.calculatePlantingRows();
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
    return [...this.appStateService.selectedTradeUnits()].sort().join(',');
  }

  onPlantingYearChange(): void {
    this.loadDashboardEstimates();
  }

  private calculatePlantingRows(): void {
    const globalTUs = this.appStateService.selectedTradeUnits();

    // All intentions for the globally selected TUs
    const forGlobalTUs = this.plantingIntentions.filter(p =>
      globalTUs.length === 0 || globalTUs.includes(p.tradeUnit)
    );

    // Available years come from all intentions for those TUs
    const years = [...new Set(forGlobalTUs.map(p => p.plantingYear))].sort((a, b) => b - a);
    this.availablePlantingYears = years;
    if (years.length > 0 && !years.includes(this.selectedPlantingYear)) {
      this.selectedPlantingYear = years[0];
    }

    // Filter by selected year
    const filtered = forGlobalTUs.filter(p => p.plantingYear === this.selectedPlantingYear);

    // Group acres by crop
    const cropMap = new Map<string, number>();
    for (const p of filtered) {
      cropMap.set(p.crop, (cropMap.get(p.crop) || 0) + p.acres);
    }

    const uniqueCrops = [...cropMap.keys()].sort();
    this.plantingRows = uniqueCrops.map(crop => {
      const totalAcres = cropMap.get(crop) || 0;
      const saved = this.savedEstimates.find(e => e.crop === crop);
      const yieldEstimate = saved?.yieldEstimate ?? null;
      const totalProduction = yieldEstimate != null ? totalAcres * yieldEstimate : 0;
      const marketSharePct = saved?.marketSharePct ?? null;
      const estHarvestHandle = (marketSharePct != null && yieldEstimate != null) ? totalProduction * (marketSharePct / 100) : 0;
      const actualHarvestHandle = saved?.actualHarvestHandle ?? null;
      const actualMarketSharePct = (actualHarvestHandle != null && totalProduction > 0)
        ? (actualHarvestHandle / totalProduction) * 100
        : 0;
      return { crop, totalAcres, yieldEstimate, totalProduction, marketSharePct, estHarvestHandle, actualHarvestHandle, actualMarketSharePct };
    });
  }

  loadDashboardEstimates(): void {
    const key = this.tradeUnitKey;
    if (!key) {
      this.savedEstimates = [];
      this.calculatePlantingRows();
      return;
    }
    this.apiService.getDashboardPlantingEstimates(key, this.selectedPlantingYear)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.savedEstimates = data;
          this.calculatePlantingRows();
          this.cdr.detectChanges();
        },
        error: () => {
          this.savedEstimates = [];
          this.calculatePlantingRows();
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
    for (const row of this.plantingRows) {
      this.tempYieldMap[row.crop] = row.yieldEstimate;
    }
  }

  saveYieldEdit(): void {
    const key = this.tradeUnitKey;
    if (!key) return;
    const estimates = this.plantingRows.map(row => {
      const existing = this.savedEstimates.find(e => e.crop === row.crop);
      return {
        tradeUnitKey: key,
        crop: row.crop,
        plantingYear: this.selectedPlantingYear,
        yieldEstimate: this.tempYieldMap[row.crop] ?? null,
        marketSharePct: existing?.marketSharePct ?? null,
        actualHarvestHandle: existing?.actualHarvestHandle ?? null
      };
    });
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
    for (const row of this.plantingRows) {
      this.tempMarketShareMap[row.crop] = row.marketSharePct;
    }
  }

  saveMarketShareEdit(): void {
    const key = this.tradeUnitKey;
    if (!key) return;
    const estimates = this.plantingRows.map(row => {
      const existing = this.savedEstimates.find(e => e.crop === row.crop);
      return {
        tradeUnitKey: key,
        crop: row.crop,
        plantingYear: this.selectedPlantingYear,
        yieldEstimate: existing?.yieldEstimate ?? null,
        marketSharePct: this.tempMarketShareMap[row.crop] ?? null,
        actualHarvestHandle: existing?.actualHarvestHandle ?? null
      };
    });
    this.estimatesSaving = true;
    this.apiService.upsertDashboardPlantingEstimates(estimates)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.marketShareEditMode = false;
          this.estimatesSaving = false;
          this.toastService.success('Market share saved');
          this.loadDashboardEstimates();
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
  // Actual harvest handle edit
  // =========================================================================

  startActualHarvestEdit(): void {
    this.actualHarvestEditMode = true;
    this.tempActualMap = {};
    for (const row of this.plantingRows) {
      this.tempActualMap[row.crop] = row.actualHarvestHandle;
    }
  }

  saveActualHarvestEdit(): void {
    const key = this.tradeUnitKey;
    if (!key) return;
    const estimates = this.plantingRows.map(row => {
      const existing = this.savedEstimates.find(e => e.crop === row.crop);
      return {
        tradeUnitKey: key,
        crop: row.crop,
        plantingYear: this.selectedPlantingYear,
        yieldEstimate: existing?.yieldEstimate ?? null,
        marketSharePct: existing?.marketSharePct ?? null,
        actualHarvestHandle: this.tempActualMap[row.crop] ?? null
      };
    });
    this.estimatesSaving = true;
    this.apiService.upsertDashboardPlantingEstimates(estimates)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.actualHarvestEditMode = false;
          this.estimatesSaving = false;
          this.toastService.success('Actual harvest handle saved');
          this.loadDashboardEstimates();
        },
        error: () => {
          this.estimatesSaving = false;
          this.toastService.error('Failed to save actual harvest handle');
        }
      });
  }

  cancelActualHarvestEdit(): void {
    this.actualHarvestEditMode = false;
    this.tempActualMap = {};
  }

}
