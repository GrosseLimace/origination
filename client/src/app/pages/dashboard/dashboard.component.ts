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
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">

      <!-- ================================================================ -->
      <!-- Header -->
      <!-- ================================================================ -->
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="p-2.5 bg-green-100 dark:bg-green-900/30 rounded-xl flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-400">
              <path d="M7 20h10"/>
              <path d="M10 20c5.5-2.5.8-6.4 3-10"/>
              <path d="M9.5 9.4c1.1.8 1.8 2.1 2 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.8.8z"/>
              <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>
            </svg>
          </div>
          <div>
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Planting Intentions Dashboard</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Aggregate planting data across all customers</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          @if (availableTradeUnits.length > 1) {
            <div class="relative">
              <button
                (click)="showTradeUnitDropdown = !showTradeUnitDropdown"
                class="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                <span>{{ selectedDashboardTradeUnits.length === availableTradeUnits.length ? 'All Trade Units' : selectedDashboardTradeUnits.length + ' selected' }}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              @if (showTradeUnitDropdown) {
                <div class="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 py-1">
                  @for (unit of availableTradeUnits; track unit) {
                    <label class="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm text-gray-900 dark:text-white">
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
          <button
            (click)="goToSeasonTargets()"
            class="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
            Set Season Targets
          </button>
        </div>
      </div>

      <!-- ================================================================ -->
      <!-- Year Navigation + Crop Filter Bar -->
      <!-- ================================================================ -->
      <div class="flex items-center gap-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-3">
        <div class="flex items-center gap-3">
          <button
            (click)="prevYear()"
            class="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="text-center min-w-[72px]">
            <div class="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{{ selectedPlantingYear }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">Growing Season</div>
          </div>
          <button
            (click)="nextYear()"
            class="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
        <div class="ml-auto flex items-center gap-2">
          <label class="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Filter by Crop:</label>
          <select
            [(ngModel)]="selectedCropFilter"
            (ngModelChange)="onCropFilterChange()"
            class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">All Crops</option>
            @for (crop of availableCrops; track crop) {
              <option [value]="crop">{{ crop }}</option>
            }
          </select>
        </div>
      </div>

      <!-- ================================================================ -->
      <!-- Loading / Empty States -->
      <!-- ================================================================ -->
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

        <!-- ============================================================== -->
        <!-- 4 Stat Cards -->
        <!-- ============================================================== -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">

          <!-- Total Acres -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-2.5 mb-3">
              <div class="p-1.5 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-400">
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                  <line x1="8" y1="2" x2="8" y2="18"/>
                  <line x1="16" y1="6" x2="16" y2="22"/>
                </svg>
              </div>
              <span class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Acres</span>
            </div>
            <div class="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{{ totalAcresForYear | number }}</div>
            @if (acresTrend !== null) {
              <div class="mt-1.5 text-xs font-medium" [class]="acresTrend >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'">
                {{ acresTrend >= 0 ? '↑' : '↓' }} {{ acresTrend < 0 ? (acresTrend * -1 | number:'1.0-1') : (acresTrend | number:'1.0-1') }}% vs {{ selectedPlantingYear - 1 }}
              </div>
            } @else {
              <div class="mt-1.5 text-xs text-gray-400 dark:text-gray-500">No prior year data</div>
            }
          </div>

          <!-- Projected Production -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-2.5 mb-3">
              <div class="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-600 dark:text-amber-400">
                  <line x1="18" y1="20" x2="18" y2="10"/>
                  <line x1="12" y1="20" x2="12" y2="4"/>
                  <line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
              </div>
              <span class="text-sm font-medium text-gray-500 dark:text-gray-400">Projected Production</span>
            </div>
            <div class="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{{ projectedProductionFormatted }}</div>
            <div class="mt-1.5 text-xs text-gray-400 dark:text-gray-500">bushels estimated</div>
          </div>

          <!-- Average Yield -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-2.5 mb-3">
              <div class="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-600 dark:text-blue-400">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                  <polyline points="17 6 23 6 23 12"/>
                </svg>
              </div>
              <span class="text-sm font-medium text-gray-500 dark:text-gray-400">Average Yield</span>
            </div>
            <div class="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{{ averageYield > 0 ? averageYield : '--' }}</div>
            <div class="mt-1.5 text-xs text-gray-400 dark:text-gray-500">bu / acre (weighted avg)</div>
          </div>

          <!-- Active Growers -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-2.5 mb-3">
              <div class="p-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-purple-600 dark:text-purple-400">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <span class="text-sm font-medium text-gray-500 dark:text-gray-400">Active Growers</span>
            </div>
            <div class="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{{ activeGrowers }}</div>
            <div class="mt-1.5 text-xs text-gray-400 dark:text-gray-500">customers with intentions</div>
          </div>

        </div>

        <!-- ============================================================== -->
        <!-- Tab Navigation -->
        <!-- ============================================================== -->
        <div>
          <div class="flex gap-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl p-1 border border-gray-200 dark:border-gray-700">
            @for (tab of tabs; track tab.id) {
              <button
                (click)="activeTab = tab.id"
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                [class]="activeTab === tab.id
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
              >
                {{ tab.label }}
              </button>
            }
          </div>

          <!-- Tab Content -->
          <div class="mt-5">

            <!-- ========================================================== -->
            <!-- By Crop Tab -->
            <!-- ========================================================== -->
            @if (activeTab === 'byCrop') {
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

                <!-- Bar Chart: Acres by Crop -->
                <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 class="text-base font-semibold text-gray-900 dark:text-white">Acres by Crop</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5 mb-5">Planned acres by crop type for {{ selectedPlantingYear }}</p>
                  @if (cropBreakdown.length === 0) {
                    <div class="flex items-center justify-center h-48 text-sm text-gray-400 dark:text-gray-500 italic">
                      No planting data for {{ selectedPlantingYear }}
                    </div>
                  } @else {
                    <div class="flex items-end gap-2" style="height: 200px; padding-bottom: 4px;">
                      @for (crop of cropBreakdown; track crop.name) {
                        <div class="flex flex-col items-center gap-1 flex-1 min-w-0 h-full justify-end">
                          <span class="text-xs text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">{{ formatAcres(crop.acres) }}</span>
                          <div
                            class="w-full rounded-t-sm transition-all duration-300"
                            [ngClass]="crop.barColor"
                            [style.height.px]="maxCropAcres > 0 ? (crop.acres / maxCropAcres) * 155 : 0"
                          ></div>
                          <span class="text-xs text-gray-600 dark:text-gray-400 truncate w-full text-center leading-tight mt-0.5">{{ crop.name }}</span>
                        </div>
                      }
                    </div>
                  }
                </div>

                <!-- Donut Chart: Crop Distribution -->
                <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 class="text-base font-semibold text-gray-900 dark:text-white">Crop Distribution</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5 mb-5">Share of total acres by crop type</p>
                  @if (cropBreakdown.length === 0) {
                    <div class="flex items-center justify-center h-48 text-sm text-gray-400 dark:text-gray-500 italic">
                      No planting data for {{ selectedPlantingYear }}
                    </div>
                  } @else {
                    <div class="flex items-center gap-6">
                      <!-- Donut ring -->
                      <div
                        class="relative flex-shrink-0 rounded-full"
                        style="width: 148px; height: 148px;"
                        [style.background]="cropDistributionGradient"
                      >
                        <!-- Inner circle (donut hole) -->
                        <div
                          class="absolute rounded-full bg-white dark:bg-gray-800 flex items-center justify-center"
                          style="top: 37px; left: 37px; right: 37px; bottom: 37px;"
                        >
                          <div class="text-center">
                            <div class="text-base font-bold text-gray-900 dark:text-white">{{ cropBreakdown.length }}</div>
                            <div class="text-xs text-gray-500 dark:text-gray-400">Crops</div>
                          </div>
                        </div>
                      </div>
                      <!-- Legend -->
                      <div class="flex-1 space-y-2.5 overflow-auto" style="max-height: 148px;">
                        @for (crop of cropBreakdown; track crop.name) {
                          <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-2 min-w-0">
                              <div class="w-2.5 h-2.5 rounded-full flex-shrink-0" [ngClass]="crop.dotColor"></div>
                              <span class="text-sm text-gray-700 dark:text-gray-300 truncate">{{ crop.name }}</span>
                            </div>
                            <div class="flex items-center gap-1.5 flex-shrink-0">
                              <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums">{{ formatAcres(crop.acres) }}</span>
                              <span class="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">{{ crop.pct }}%</span>
                            </div>
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>

              </div>

              <!-- Crop Details Table -->
              @if (cropDetailsRows.length > 0) {
                <div class="mt-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div class="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 class="text-base font-semibold text-gray-900 dark:text-white">Crop Details</h3>
                  </div>
                  <div class="overflow-x-auto">
                    <table class="w-full">
                      <thead>
                        <tr class="border-b border-gray-200 dark:border-gray-700">
                          <th class="text-left py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Crop</th>
                          <th class="text-right py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Acres</th>
                          <th class="text-right py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Yield</th>
                          <th class="text-right py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Production</th>
                          <th class="text-right py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Growers</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
                        @for (row of cropDetailsRows; track row.name) {
                          <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                            <td class="py-3 px-5">
                              <div class="flex items-center gap-2">
                                <div class="w-2.5 h-2.5 rounded-full flex-shrink-0" [ngClass]="row.dotColor"></div>
                                <span class="px-2.5 py-0.5 text-sm font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">{{ row.name }}</span>
                              </div>
                            </td>
                            <td class="py-3 px-5 text-right text-sm font-semibold text-gray-900 dark:text-white tabular-nums">{{ row.acres | number }}</td>
                            <td class="py-3 px-5 text-right text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                              @if (row.avgYield != null) { {{ row.avgYield }} bu/ac } @else { <span class="text-gray-400 dark:text-gray-500 italic text-xs">--</span> }
                            </td>
                            <td class="py-3 px-5 text-right text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                              @if (row.production != null) { {{ formatK(row.production) }} bu } @else { <span class="text-gray-400 dark:text-gray-500 italic text-xs">--</span> }
                            </td>
                            <td class="py-3 px-5 text-right text-sm text-gray-500 dark:text-gray-400 tabular-nums">{{ row.growers }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              }

            }

            <!-- ========================================================== -->
            <!-- Top Producers Tab -->
            <!-- ========================================================== -->
            @else if (activeTab === 'topProducers') {
              <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div class="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 class="text-base font-semibold text-gray-900 dark:text-white">Top 10 Producers by Volume</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Ranked by total planned acres for {{ selectedPlantingYear }}</p>
                </div>
                @if (topProducersRows.length === 0) {
                  <div class="flex items-center justify-center py-16 text-sm text-gray-400 dark:text-gray-500 italic">
                    No planting intentions for {{ selectedPlantingYear }}
                  </div>
                } @else {
                  <div class="overflow-x-auto">
                    <table class="w-full">
                      <thead>
                        <tr class="border-b border-gray-200 dark:border-gray-700">
                          <th class="text-left py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-8">#</th>
                          <th class="text-left py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Producer</th>
                          <th class="text-right py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Acres</th>
                          <th class="text-right py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Production</th>
                          <th class="text-left py-2.5 px-5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Crops</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
                        @for (row of topProducersRows; track row.customerId; let i = $index) {
                          <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                            <td class="py-3 px-5 text-sm font-medium text-gray-400 dark:text-gray-500 tabular-nums">{{ i + 1 }}</td>
                            <td class="py-3 px-5">
                              <div class="text-sm font-semibold text-gray-900 dark:text-white">{{ row.customerName }}</div>
                              @if (row.tradeUnit) {
                                <div class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{{ row.tradeUnit }}</div>
                              }
                            </td>
                            <td class="py-3 px-5 text-right">
                              <span class="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{{ row.acres | number }}</span>
                              <div class="mt-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden" style="width: 80px; margin-left: auto;">
                                <div class="h-full bg-green-500 rounded-full" [style.width.%]="(row.acres / topProducersRows[0].acres) * 100"></div>
                              </div>
                            </td>
                            <td class="py-3 px-5 text-right text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                              @if (row.production != null) { {{ formatK(row.production) }} bu } @else { <span class="text-gray-400 dark:text-gray-500 italic text-xs">--</span> }
                            </td>
                            <td class="py-3 px-5">
                              <div class="flex flex-wrap gap-1">
                                @for (crop of row.crops; track crop) {
                                  <span class="px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{{ crop }}</span>
                                }
                              </div>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>
            }

            <!-- ========================================================== -->
            <!-- Harvest & Contracts Tab — 6 existing tables -->
            <!-- ========================================================== -->
            @else if (activeTab === 'harvestContracts') {
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

                <!-- Table 1: Average Yield Estimates -->
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
                        @if (yieldRows.length === 0) {
                          <tr><td colspan="2" class="py-6 text-center text-xs text-gray-400 dark:text-gray-500 italic">No planting intentions for {{ selectedPlantingYear }}</td></tr>
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
                        @if (categoryRows.length === 0) {
                          <tr><td colspan="2" class="py-6 text-center text-xs text-gray-400 dark:text-gray-500 italic">No data available</td></tr>
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
                        @if (categoryRows.length === 0) {
                          <tr><td colspan="2" class="py-6 text-center text-xs text-gray-400 dark:text-gray-500 italic">No data available</td></tr>
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
                        @if (categoryRows.length === 0) {
                          <tr><td colspan="2" class="py-6 text-center text-xs text-gray-400 dark:text-gray-500 italic">No data available</td></tr>
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
            }

          </div>
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

  // Tables 2–4: Category rows
  categoryRows: { category: string; totalEstimatedProduction: number; marketSharePct: number | null; estimatedHarvestHandle: number }[] = [];

  availablePlantingYears: number[] = [];
  selectedPlantingYear: number = new Date().getFullYear();

  plantingIntentionsExpanded = false;

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

  // =========================================================================
  // New tab / filter state
  // =========================================================================

  activeTab: 'byCrop' | 'topProducers' | 'harvestContracts' = 'byCrop';
  selectedCropFilter: string = '';

  readonly tabs = [
    { id: 'byCrop' as const, label: 'By Crop' },
    { id: 'topProducers' as const, label: 'Top Producers' },
    { id: 'harvestContracts' as const, label: 'Harvest & Contracts' },
  ];

  private readonly CHART_COLORS = [
    { bar: 'bg-green-500', dot: 'bg-green-500', hex: '#22c55e' },
    { bar: 'bg-blue-500', dot: 'bg-blue-500', hex: '#3b82f6' },
    { bar: 'bg-amber-500', dot: 'bg-amber-500', hex: '#f59e0b' },
    { bar: 'bg-purple-500', dot: 'bg-purple-500', hex: '#a855f7' },
    { bar: 'bg-red-500', dot: 'bg-red-500', hex: '#ef4444' },
    { bar: 'bg-teal-500', dot: 'bg-teal-500', hex: '#14b8a6' },
    { bar: 'bg-orange-500', dot: 'bg-orange-500', hex: '#f97316' },
    { bar: 'bg-indigo-500', dot: 'bg-indigo-500', hex: '#6366f1' },
  ];

  // =========================================================================
  // Lifecycle
  // =========================================================================

  ngOnInit(): void {
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

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // =========================================================================
  // Year navigation
  // =========================================================================

  prevYear(): void {
    this.selectedPlantingYear--;
    this.selectedCropFilter = '';
    this.onPlantingYearChange();
  }

  nextYear(): void {
    this.selectedPlantingYear++;
    this.selectedCropFilter = '';
    this.onPlantingYearChange();
  }

  goToSeasonTargets(): void {
    this.activeTab = 'harvestContracts';
  }

  onCropFilterChange(): void {
    this.cdr.markForCheck();
  }

  // =========================================================================
  // Trade unit selection
  // =========================================================================

  toggleDashboardTradeUnit(unit: string): void {
    const idx = this.selectedDashboardTradeUnits.indexOf(unit);
    if (idx >= 0) {
      if (this.selectedDashboardTradeUnits.length > 1) {
        this.selectedDashboardTradeUnits = this.selectedDashboardTradeUnits.filter(u => u !== unit);
      }
    } else {
      this.selectedDashboardTradeUnits = [...this.selectedDashboardTradeUnits, unit];
    }
    this.selectedCropFilter = '';
    this.loadData();
  }

  // =========================================================================
  // Data loading
  // =========================================================================

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
  // Planting Intentions — computed key and row logic
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

    const years = [...new Set(forGlobalTUs.map(p => p.plantingYear))].sort((a, b) => b - a);
    this.availablePlantingYears = years;

    const filtered = forGlobalTUs.filter(p => +p.plantingYear === +this.selectedPlantingYear);

    const cropAcresMap = new Map<string, number>();
    const cropCategoryMap = new Map<string, string>();
    for (const p of filtered) {
      const commodity = this.allCommodities.find(c => c.code === p.crop);
      const category = commodity?.category || p.crop;
      const cropKey = [p.type, category].filter(Boolean).join(' ');
      cropAcresMap.set(cropKey, (cropAcresMap.get(cropKey) || 0) + p.acres);
      cropCategoryMap.set(cropKey, category);
    }

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
  // Row color coding (consistent category colors across all tables)
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

  get usedHarvestCrops(): Set<string> {
    return new Set(this.actualHarvestRows.map(r => r.cropCategory));
  }

  private static readonly HARVEST_EXCLUDED_CATEGORIES = ['transportation', 'currency', 'feed & fert ingredients'];

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

  // =========================================================================
  // Reload on year change
  // =========================================================================

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

  // =========================================================================
  // New computed getters — stat cards & charts
  // =========================================================================

  get filteredIntentionsForYear(): PlantingIntention[] {
    const selectedTUs = this.selectedDashboardTradeUnits;
    return this.plantingIntentions.filter(p => {
      if (+p.plantingYear !== +this.selectedPlantingYear) return false;
      if (selectedTUs.length > 0 && !selectedTUs.includes(p.tradeUnit)) return false;
      if (this.selectedCropFilter) {
        const commodity = this.allCommodities.find(c => c.code === p.crop);
        const category = commodity?.category || p.crop;
        if (category !== this.selectedCropFilter) return false;
      }
      return true;
    });
  }

  get totalAcresForYear(): number {
    return this.filteredIntentionsForYear.reduce((sum, p) => sum + p.acres, 0);
  }

  get acresTrend(): number | null {
    const prevYear = this.selectedPlantingYear - 1;
    const selectedTUs = this.selectedDashboardTradeUnits;
    const prevAcres = this.plantingIntentions
      .filter(p => +p.plantingYear === prevYear && (selectedTUs.length === 0 || selectedTUs.includes(p.tradeUnit)))
      .reduce((sum, p) => sum + p.acres, 0);
    if (prevAcres === 0) return null;
    return ((this.totalAcresForYear - prevAcres) / prevAcres) * 100;
  }

  // Pairs each intention with its yield estimate using the composite crop key (always accurate)
  private get intentionProductionPairs(): { acres: number; yieldEst: number | null }[] {
    return this.filteredIntentionsForYear.map(p => {
      const commodity = this.allCommodities.find(c => c.code === p.crop);
      const category = commodity?.category || p.crop;
      const cropKey = [p.type, category].filter(Boolean).join(' ');
      const saved = this.savedYieldEstimates.find(e => e.crop === cropKey);
      return { acres: p.acres, yieldEst: saved?.yieldEstimate ?? null };
    });
  }

  get projectedProductionFormatted(): string {
    const total = this.intentionProductionPairs
      .filter(p => p.yieldEst != null)
      .reduce((sum, p) => sum + p.acres * p.yieldEst!, 0);
    return this.formatK(Math.round(total));
  }

  get averageYield(): number {
    const pairs = this.intentionProductionPairs.filter(p => p.yieldEst != null);
    const totalAcres = pairs.reduce((sum, p) => sum + p.acres, 0);
    const totalProd = pairs.reduce((sum, p) => sum + p.acres * p.yieldEst!, 0);
    return totalAcres > 0 ? Math.round(totalProd / totalAcres) : 0;
  }

  get activeGrowers(): number {
    return new Set(this.filteredIntentionsForYear.map(p => p.customerId)).size;
  }

  get availableCrops(): string[] {
    const selectedTUs = this.selectedDashboardTradeUnits;
    const forYear = this.plantingIntentions.filter(p => {
      if (+p.plantingYear !== +this.selectedPlantingYear) return false;
      if (selectedTUs.length > 0 && !selectedTUs.includes(p.tradeUnit)) return false;
      return true;
    });
    const crops = new Set<string>();
    for (const p of forYear) {
      const commodity = this.allCommodities.find(c => c.code === p.crop);
      const category = commodity?.category || p.crop;
      crops.add(category);
    }
    return [...crops].sort();
  }

  get cropBreakdown(): { name: string; acres: number; pct: number; barColor: string; dotColor: string; hex: string }[] {
    const cropAcresMap = new Map<string, number>();
    for (const p of this.filteredIntentionsForYear) {
      const commodity = this.allCommodities.find(c => c.code === p.crop);
      const category = commodity?.category || p.crop;
      // When a crop is selected: break down by type (Dryland/Irrigated); otherwise group by generic crop
      const key = this.selectedCropFilter
        ? [p.type, category].filter(Boolean).join(' ')
        : category;
      cropAcresMap.set(key, (cropAcresMap.get(key) || 0) + p.acres);
    }
    const total = [...cropAcresMap.values()].reduce((a, b) => a + b, 0);
    return [...cropAcresMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, acres], i) => {
        const color = this.CHART_COLORS[i % this.CHART_COLORS.length];
        return {
          name,
          acres,
          pct: total > 0 ? Math.round((acres / total) * 100) : 0,
          barColor: color.bar,
          dotColor: color.dot,
          hex: color.hex
        };
      });
  }

  get maxCropAcres(): number {
    return Math.max(...this.cropBreakdown.map(c => c.acres), 1);
  }

  get cropDistributionGradient(): string {
    if (this.cropBreakdown.length === 0) return 'conic-gradient(#e5e7eb 0deg 360deg)';
    let deg = 0;
    const stops: string[] = [];
    for (const c of this.cropBreakdown) {
      const end = deg + (c.pct / 100) * 360;
      stops.push(`${c.hex} ${deg}deg ${end}deg`);
      deg = end;
    }
    // Fill any rounding gap
    if (deg < 360) stops.push(`${this.cropBreakdown[0].hex} ${deg}deg 360deg`);
    return `conic-gradient(${stops.join(', ')})`;
  }

  get cropDetailsRows(): { name: string; acres: number; avgYield: number | null; production: number | null; growers: number; dotColor: string }[] {
    return this.cropBreakdown.map(c => {
      const matching = this.filteredIntentionsForYear.filter(p => {
        const commodity = this.allCommodities.find(com => com.code === p.crop);
        const category = commodity?.category || p.crop;
        const key = this.selectedCropFilter
          ? [p.type, category].filter(Boolean).join(' ')
          : category;
        return key === c.name;
      });

      let totalProd = 0;
      let totalAcresWeighted = 0;
      for (const p of matching) {
        const commodity = this.allCommodities.find(com => com.code === p.crop);
        const category = commodity?.category || p.crop;
        const cropKey = [p.type, category].filter(Boolean).join(' ');
        const saved = this.savedYieldEstimates.find(e => e.crop === cropKey);
        if (saved?.yieldEstimate != null) {
          totalProd += p.acres * saved.yieldEstimate;
          totalAcresWeighted += p.acres;
        }
      }

      const avgYield = totalAcresWeighted > 0 ? Math.round(totalProd / totalAcresWeighted) : null;
      const production = totalProd > 0 ? Math.round(totalProd) : null;
      const growers = new Set(matching.map(p => p.customerId)).size;
      return { name: c.name, acres: c.acres, avgYield, production, growers, dotColor: c.dotColor };
    });
  }

  get topProducersRows(): { customerId: number; customerName: string; tradeUnit: string; acres: number; production: number | null; crops: string[] }[] {
    const map = new Map<number, { customerName: string; tradeUnit: string; acres: number; production: number; cropSet: Set<string> }>();

    for (const p of this.filteredIntentionsForYear) {
      const commodity = this.allCommodities.find(c => c.code === p.crop);
      const category = commodity?.category || p.crop;
      const cropKey = [p.type, category].filter(Boolean).join(' ');
      const saved = this.savedYieldEstimates.find(e => e.crop === cropKey);
      const production = saved?.yieldEstimate != null ? p.acres * saved.yieldEstimate : 0;

      const existing = map.get(p.customerId);
      if (existing) {
        existing.acres += p.acres;
        existing.production += production;
        existing.cropSet.add(category);
      } else {
        map.set(p.customerId, {
          customerName: p.customerName,
          tradeUnit: p.tradeUnit,
          acres: p.acres,
          production,
          cropSet: new Set([category])
        });
      }
    }

    return [...map.entries()]
      .sort((a, b) => b[1].acres - a[1].acres)
      .slice(0, 10)
      .map(([customerId, v]) => ({
        customerId,
        customerName: v.customerName,
        tradeUnit: v.tradeUnit,
        acres: v.acres,
        production: v.production > 0 ? Math.round(v.production) : null,
        crops: [...v.cropSet].sort()
      }));
  }

  // =========================================================================
  // Formatting helpers
  // =========================================================================

  formatAcres(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return Math.round(n / 1_000) + 'K';
    return n.toString();
  }

  formatK(n: number): string {
    if (n === 0) return '--';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return Math.round(n / 1_000) + 'K';
    return n.toString();
  }
}
