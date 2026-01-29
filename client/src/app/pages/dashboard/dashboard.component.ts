import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, PlantingIntention, StoredGrain } from '../../models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '../../components/ui/card/card.component';


@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent],
  template: `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Territory Dashboard</h2>
          <p class="text-gray-500 dark:text-gray-400">Overview of your territory performance</p>
        </div>
      </div>

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
            <div>
              <app-card-title>2025 Planting Intentions</app-card-title>
              <app-card-description>Planned crops and production estimates across your territory</app-card-description>
            </div>
          </div>
        </app-card-header>
        @if (plantingIntentionsExpanded) {
        <app-card-content>
          <!-- First Row: Average Yield Estimates and Total Estimated Production -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <!-- Average Yield Estimates -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-base font-semibold text-gray-900 dark:text-white">Average Yield Estimates</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Expected yields per acre by crop type</p>
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
                        class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-green-300 dark:border-green-700 text-xs sm:text-sm font-medium text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
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
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Crop Type</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Yield (bu/acre)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2 px-4 text-sm text-gray-900 dark:text-gray-100 font-medium">IR HRWW</td>
                      <td class="py-2 px-4 text-right text-sm">
                        @if (yieldEditMode) {
                          <input
                            type="number"
                            [(ngModel)]="tempYieldEstimates['IR HRWW']"
                            class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        } @else {
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                            {{ yieldEstimates['IR HRWW'] }}
                          </span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2 px-4 text-sm text-gray-900 dark:text-gray-100 font-medium">DL HRWW</td>
                      <td class="py-2 px-4 text-right text-sm">
                        @if (yieldEditMode) {
                          <input
                            type="number"
                            [(ngModel)]="tempYieldEstimates['DL HRWW']"
                            class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        } @else {
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                            {{ yieldEstimates['DL HRWW'] }}
                          </span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2 px-4 text-sm text-gray-900 dark:text-gray-100 font-medium">IR Corn</td>
                      <td class="py-2 px-4 text-right text-sm">
                        @if (yieldEditMode) {
                          <input
                            type="number"
                            [(ngModel)]="tempYieldEstimates['IR Corn']"
                            class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        } @else {
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                            {{ yieldEstimates['IR Corn'] }}
                          </span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2 px-4 text-sm text-gray-900 dark:text-gray-100 font-medium">DL YC</td>
                      <td class="py-2 px-4 text-right text-sm">
                        @if (yieldEditMode) {
                          <input
                            type="number"
                            [(ngModel)]="tempYieldEstimates['DL YC']"
                            class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        } @else {
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                            {{ yieldEstimates['DL YC'] }}
                          </span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2 px-4 text-sm text-gray-900 dark:text-gray-100 font-medium">IR Milo</td>
                      <td class="py-2 px-4 text-right text-sm">
                        @if (yieldEditMode) {
                          <input
                            type="number"
                            [(ngModel)]="tempYieldEstimates['IR Milo']"
                            class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        } @else {
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                            {{ yieldEstimates['IR Milo'] }}
                          </span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2 px-4 text-sm text-gray-900 dark:text-gray-100 font-medium">DL Milo</td>
                      <td class="py-2 px-4 text-right text-sm">
                        @if (yieldEditMode) {
                          <input
                            type="number"
                            [(ngModel)]="tempYieldEstimates['DL Milo']"
                            class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        } @else {
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                            {{ yieldEstimates['DL Milo'] }}
                          </span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2 px-4 text-sm text-gray-900 dark:text-gray-100 font-medium">IR Beans</td>
                      <td class="py-2 px-4 text-right text-sm">
                        @if (yieldEditMode) {
                          <input
                            type="number"
                            [(ngModel)]="tempYieldEstimates['IR Beans']"
                            class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        } @else {
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                            {{ yieldEstimates['IR Beans'] }}
                          </span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2 px-4 text-sm text-gray-900 dark:text-gray-100 font-medium">DL YSB</td>
                      <td class="py-2 px-4 text-right text-sm">
                        @if (yieldEditMode) {
                          <input
                            type="number"
                            [(ngModel)]="tempYieldEstimates['DL YSB']"
                            class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        } @else {
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                            {{ yieldEstimates['DL YSB'] }}
                          </span>
                        }
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Total Estimated Production -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <h3 class="text-base font-semibold text-gray-900 dark:text-white">Total Estimated Production</h3>
                <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Combined production across all selected producers</p>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Crop Category</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Total (bu)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-amber-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Wheat</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        <span class="text-base font-bold text-gray-900 dark:text-white">{{ totalProduction.wheat | number:'1.0-0' }}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">bu</span>
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-green-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Corn</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        <span class="text-base font-bold text-gray-900 dark:text-white">{{ totalProduction.corn | number:'1.0-0' }}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">bu</span>
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-orange-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Milo</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        <span class="text-base font-bold text-gray-900 dark:text-white">{{ totalProduction.milo | number:'1.0-0' }}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">bu</span>
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-blue-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Soybeans</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        <span class="text-base font-bold text-gray-900 dark:text-white">{{ totalProduction.soybeans | number:'1.0-0' }}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">bu</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Second Row: Market Share and Harvest Handle -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Estimated Market Share -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-base font-semibold text-gray-900 dark:text-white">Estimated Market Share</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Expected percentage of production we will handle</p>
                  </div>
                  @if (!marketShareEditMode) {
                    <button
                      (click)="startMarketShareEdit()"
                      class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-purple-300 dark:border-purple-700 text-xs sm:text-sm font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
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
                        class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-purple-300 dark:border-purple-700 text-xs sm:text-sm font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
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
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Crop Category</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Market Share</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-amber-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Wheat</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        @if (marketShareEditMode) {
                          <div class="inline-flex items-center gap-1">
                            <input
                              type="number"
                              [(ngModel)]="tempMarketShare.wheat"
                              min="0"
                              max="100"
                              step="1"
                              class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <span class="text-sm text-gray-500 dark:text-gray-400">%</span>
                          </div>
                        } @else {
                          <span class="text-base font-bold text-gray-900 dark:text-white">{{ marketShare.wheat * 100 }}%</span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-green-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Corn</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        @if (marketShareEditMode) {
                          <div class="inline-flex items-center gap-1">
                            <input
                              type="number"
                              [(ngModel)]="tempMarketShare.corn"
                              min="0"
                              max="100"
                              step="1"
                              class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <span class="text-sm text-gray-500 dark:text-gray-400">%</span>
                          </div>
                        } @else {
                          <span class="text-base font-bold text-gray-900 dark:text-white">{{ marketShare.corn * 100 }}%</span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-orange-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Milo</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        @if (marketShareEditMode) {
                          <div class="inline-flex items-center gap-1">
                            <input
                              type="number"
                              [(ngModel)]="tempMarketShare.milo"
                              min="0"
                              max="100"
                              step="1"
                              class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <span class="text-sm text-gray-500 dark:text-gray-400">%</span>
                          </div>
                        } @else {
                          <span class="text-base font-bold text-gray-900 dark:text-white">{{ marketShare.milo * 100 }}%</span>
                        }
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-blue-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Soybeans</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        @if (marketShareEditMode) {
                          <div class="inline-flex items-center gap-1">
                            <input
                              type="number"
                              [(ngModel)]="tempMarketShare.soybeans"
                              min="0"
                              max="100"
                              step="1"
                              class="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <span class="text-sm text-gray-500 dark:text-gray-400">%</span>
                          </div>
                        } @else {
                          <span class="text-base font-bold text-gray-900 dark:text-white">{{ marketShare.soybeans * 100 }}%</span>
                        }
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Estimated Harvest Handle -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div class="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <h3 class="text-base font-semibold text-gray-900 dark:text-white">Estimated Harvest Handle</h3>
                <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Expected bushels we will handle at harvest</p>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr class="bg-gray-50 dark:bg-gray-700/50">
                      <th class="text-left py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Crop Category</th>
                      <th class="text-right py-2 px-4 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Harvest Handle (bu)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-amber-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Wheat</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        <span class="text-base font-bold text-gray-900 dark:text-white">{{ harvestHandle.wheat | number:'1.0-0' }}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">bu</span>
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-green-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Corn</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        <span class="text-base font-bold text-gray-900 dark:text-white">{{ harvestHandle.corn | number:'1.0-0' }}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">bu</span>
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-orange-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Milo</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        <span class="text-base font-bold text-gray-900 dark:text-white">{{ harvestHandle.milo | number:'1.0-0' }}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">bu</span>
                      </td>
                    </tr>
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td class="py-2.5 px-4">
                        <div class="flex items-center gap-2">
                          <div class="w-2 h-2 rounded-full bg-blue-500"></div>
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Soybeans</span>
                        </div>
                      </td>
                      <td class="py-2.5 px-4 text-right">
                        <span class="text-base font-bold text-gray-900 dark:text-white">{{ harvestHandle.soybeans | number:'1.0-0' }}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">bu</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </app-card-content>
        }
      </app-card>

    </div>
  `
})
export class DashboardComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  customers: Customer[] = [];
  contracts: Contract[] = [];
  plantingIntentions: PlantingIntention[] = [];
  storedGrain: StoredGrain[] = [];

  totalAcres = 0;
  activeContracts = 0;
  totalContractValue = 0;

  cropDistribution: { name: string; bushels: number; percentage: number; color: string }[] = [];
  contractStatus: { name: string; count: number; dotColor: string }[] = [];
  plantingByCustomer: { customerId: string; customerName: string; crops: { name: string; acres: number; variant: 'default' | 'secondary' | 'success' }[] }[] = [];
  totalProduction = { wheat: 0, corn: 0, milo: 0, soybeans: 0 };

  // Yield estimates (bu/acre) - used by both Average Yield Estimates table and Total Production calculations
  yieldEstimates: Record<string, number> = {
    'IR HRWW': 75,
    'DL HRWW': 50,
    'IR Corn': 215,
    'DL YC': 100,
    'IR Milo': 120,
    'DL Milo': 75,
    'IR Beans': 60,
    'DL YSB': 30
  };

  // Market share estimates (as decimals)
  marketShare = { wheat: 0.80, corn: 0.80, milo: 0.85, soybeans: 0.80 };

  // Estimated harvest handle based on production and market share
  harvestHandle = { wheat: 0, corn: 0, milo: 0, soybeans: 0 };

  // Planting Intentions section expanded state
  plantingIntentionsExpanded = false;

  // Edit mode state
  yieldEditMode = false;
  marketShareEditMode = false;

  // Temporary edit values
  tempYieldEstimates: Record<string, number> = {};
  tempMarketShare = { wheat: 0, corn: 0, milo: 0, soybeans: 0 };

  // Loading state to prevent concurrent data loads
  private isLoading = false;
  private isFirstLoad = true;

  ngOnInit(): void {
    // Load the saved state from localStorage
    const savedState = localStorage.getItem('plantingIntentionsExpanded');
    if (savedState !== null) {
      this.plantingIntentionsExpanded = savedState === 'true';
    }

    // Load saved yield estimates
    const savedYields = localStorage.getItem('yieldEstimates');
    if (savedYields) {
      this.yieldEstimates = JSON.parse(savedYields);
    }

    // Load saved market share
    const savedMarketShare = localStorage.getItem('marketShare');
    if (savedMarketShare) {
      this.marketShare = JSON.parse(savedMarketShare);
    }

    console.log('[Dashboard] ngOnInit - Starting initial data load');
    // Initial data load
    this.loadData();

    // Reload data when navigating back to the dashboard route
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: NavigationEnd) => {
      console.log('[Dashboard] Navigation event:', event.url, event.urlAfterRedirects);

      // Skip the first NavigationEnd event which happens during component initialization
      if (this.isFirstLoad) {
        console.log('[Dashboard] Skipping first NavigationEnd (component initialization)');
        this.isFirstLoad = false;
        return;
      }

      // Only reload if we're navigating TO the dashboard route
      if (event.urlAfterRedirects === '/dashboard' || event.url === '/dashboard') {
        console.log('[Dashboard] Reloading data after navigation to dashboard');
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

  private loadData(): void {
    // Prevent concurrent data loads
    if (this.isLoading) {
      console.log('[Dashboard] loadData() called but already loading, skipping...');
      return;
    }

    this.isLoading = true;
    const loadTimestamp = new Date().toISOString();
    console.log(`[Dashboard] loadData() called at ${loadTimestamp}`);

    forkJoin({
      customers: this.apiService.getCustomers(),
      contracts: this.apiService.getContracts(),
      plantingIntentions: this.apiService.getPlantingIntentions(),
      storedGrain: this.apiService.getStoredGrain()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        console.log(`[Dashboard] Data received at ${new Date().toISOString()} (load started at ${loadTimestamp})`);
        console.log(`[Dashboard] Customers: ${data.customers.length}, Contracts: ${data.contracts.length}, Planting Intentions: ${data.plantingIntentions.length}, Stored Grain: ${data.storedGrain.length}`);

        this.customers = data.customers;
        this.contracts = data.contracts;
        this.plantingIntentions = data.plantingIntentions;
        this.storedGrain = data.storedGrain;

        this.totalAcres = this.customers.reduce((sum, c) => sum + c.totalAcres, 0);
        this.activeContracts = this.contracts.filter(c => c.status === 'Active').length;
        this.totalContractValue = this.contracts.reduce((sum, c) => sum + c.quantity * c.price, 0);

        this.calculateCropDistribution();
        this.calculateContractStatus();
        this.calculatePlantingByCustomer();
        this.calculateTotalProduction();
        this.calculateHarvestHandle();

        console.log('[Dashboard] All calculations complete, triggering change detection');
        this.isLoading = false;

        // Manually trigger change detection to ensure view updates
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('[Dashboard] Error loading data:', err);
        this.isLoading = false;
        this.toastService.error('Failed to load dashboard data');
        this.cdr.detectChanges();
      }
    });
  }

  navigateToCustomer(customerId: string): void {
    this.router.navigate(['/'], { queryParams: { customerId } });
  }

  private calculateCropDistribution(): void {
    const cropMap = new Map<string, number>();

    // Map IR/DL variants to main crop categories
    for (const contract of this.contracts) {
      let mainCrop = '';
      if (contract.crop === 'IR HRWW' || contract.crop === 'DL HRWW') {
        mainCrop = 'Wheat';
      } else if (contract.crop === 'IR Corn' || contract.crop === 'DL YC') {
        mainCrop = 'Corn';
      } else if (contract.crop === 'IR Milo' || contract.crop === 'DL Milo') {
        mainCrop = 'Milo';
      } else if (contract.crop === 'IR Beans' || contract.crop === 'DL YSB') {
        mainCrop = 'Soybeans';
      }

      if (mainCrop) {
        cropMap.set(mainCrop, (cropMap.get(mainCrop) || 0) + contract.quantity);
      }
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

  private calculatePlantingByCustomer(): void {
    if (this.customers.length === 0 || this.plantingIntentions.length === 0) return;

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
      'IR Corn': 'success',
      'DL YC': 'success',
      'IR Beans': 'default',
      'DL YSB': 'default',
      'IR HRWW': 'secondary',
      'DL HRWW': 'secondary',
      'IR Milo': 'success',
      'DL Milo': 'success'
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

  private calculateTotalProduction(): void {
    // Reset totals
    this.totalProduction = { wheat: 0, corn: 0, milo: 0, soybeans: 0 };

    // Calculate production for each crop using yieldEstimates property
    for (const intention of this.plantingIntentions) {
      const acres = intention.acres;
      const yield_per_acre = this.yieldEstimates[intention.crop] || 0;
      const production = acres * yield_per_acre;

      // Map crop names to categories
      if (intention.crop === 'IR HRWW' || intention.crop === 'DL HRWW') {
        this.totalProduction.wheat += production;
      } else if (intention.crop === 'IR Corn' || intention.crop === 'DL YC') {
        this.totalProduction.corn += production;
      } else if (intention.crop === 'IR Milo' || intention.crop === 'DL Milo') {
        this.totalProduction.milo += production;
      } else if (intention.crop === 'IR Beans' || intention.crop === 'DL YSB') {
        this.totalProduction.soybeans += production;
      }
    }
  }

  private calculateHarvestHandle(): void {
    // Calculate harvest handle based on total production and market share
    this.harvestHandle.wheat = this.totalProduction.wheat * this.marketShare.wheat;
    this.harvestHandle.corn = this.totalProduction.corn * this.marketShare.corn;
    this.harvestHandle.milo = this.totalProduction.milo * this.marketShare.milo;
    this.harvestHandle.soybeans = this.totalProduction.soybeans * this.marketShare.soybeans;
  }

  // Yield estimates edit methods
  startYieldEdit(): void {
    this.yieldEditMode = true;
    // Copy current values to temp storage
    this.tempYieldEstimates = { ...this.yieldEstimates };
  }

  saveYieldEdit(): void {
    // Save temp values to actual values
    this.yieldEstimates = { ...this.tempYieldEstimates };
    localStorage.setItem('yieldEstimates', JSON.stringify(this.yieldEstimates));
    this.calculateTotalProduction();
    this.calculateHarvestHandle();
    this.yieldEditMode = false;
    this.toastService.success('Yield estimates updated');
  }

  cancelYieldEdit(): void {
    // Discard changes and exit edit mode
    this.yieldEditMode = false;
    this.tempYieldEstimates = {};
  }

  // Market share edit methods
  startMarketShareEdit(): void {
    this.marketShareEditMode = true;
    // Copy current values to temp storage and convert to percentages
    this.tempMarketShare = {
      wheat: this.marketShare.wheat * 100,
      corn: this.marketShare.corn * 100,
      milo: this.marketShare.milo * 100,
      soybeans: this.marketShare.soybeans * 100
    };
  }

  saveMarketShareEdit(): void {
    // Convert percentages to decimals and save
    this.marketShare = {
      wheat: this.tempMarketShare.wheat / 100,
      corn: this.tempMarketShare.corn / 100,
      milo: this.tempMarketShare.milo / 100,
      soybeans: this.tempMarketShare.soybeans / 100
    };
    localStorage.setItem('marketShare', JSON.stringify(this.marketShare));
    this.calculateHarvestHandle();
    this.marketShareEditMode = false;
    this.toastService.success('Market share updated');
  }

  cancelMarketShareEdit(): void {
    // Discard changes and exit edit mode
    this.marketShareEditMode = false;
    this.tempMarketShare = { wheat: 0, corn: 0, milo: 0, soybeans: 0 };
  }

}
