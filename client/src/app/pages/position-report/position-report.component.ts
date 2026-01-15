import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PositionService } from '../../services/position.service';
import { ToastService } from '../../services/toast.service';
import { PositionData, HedgePosition } from '../../models';
import { CardComponent } from '../../components/ui/card/card.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';
import { TabsComponent, TabContentComponent } from '../../components/ui/tabs/tabs.component';

@Component({
  selector: 'app-position-report',
  standalone: true,
  imports: [CommonModule, CardComponent, BadgeComponent, TabsComponent, TabContentComponent],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Daily Position & Basis Report</h2>
          <p class="text-gray-500 dark:text-gray-400 mt-2">Combined cash grain position with basis analysis and risk management</p>
        </div>
        <div class="flex items-center gap-3">
          <!-- Commodity Filter -->
          <select
            class="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
            [value]="selectedCommodity()"
            (change)="onCommodityChange($event)"
          >
            <option value="">All Commodities</option>
            @for (commodity of commodities; track commodity) {
              <option [value]="commodity">{{ commodity }}</option>
            }
          </select>
          <!-- Location Filter -->
          <select
            class="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
            [value]="selectedLocation()"
            (change)="onLocationChange($event)"
          >
            <option value="">All Locations</option>
            @for (location of locations; track location) {
              <option [value]="location">{{ location }}</option>
            }
          </select>
        </div>
      </div>

      <!-- Key Metrics -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Total Purchased -->
        <app-card class="p-4">
          <div class="flex items-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-500 dark:text-gray-400">
              <path d="m21 16-4 4-4-4"/>
              <path d="M17 20V4"/>
              <path d="m3 8 4-4 4 4"/>
              <path d="M7 4v16"/>
            </svg>
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Purchased</div>
          </div>
          <div class="text-2xl font-bold text-gray-900 dark:text-white">{{ formatNumber(totalPurchased()) }}</div>
          <div class="text-sm text-gray-500 dark:text-gray-400">bushels</div>
        </app-card>

        <!-- Net Position -->
        <app-card class="p-4">
          <div class="flex items-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="totalNetPosition() > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">Net Position</div>
          </div>
          <div [class]="'text-2xl font-bold ' + (totalNetPosition() > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400')">
            {{ totalNetPosition() > 0 ? '+' : '' }}{{ formatNumber(totalNetPosition()) }} bu
          </div>
          <div [class]="'text-sm ' + (totalNetPosition() > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400')">{{ totalNetPosition() > 0 ? 'Long/Unhedged' : totalNetPosition() < 0 ? 'Short' : 'Flat' }}</div>
        </app-card>

        <!-- Total Gross Margin -->
        <app-card class="p-4">
          <div class="flex items-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-400">
              <line x1="12" x2="12" y1="2" y2="22"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Gross Margin</div>
          </div>
          <div [class]="'text-2xl font-bold ' + (totalGrossMargin() >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')">{{ formatCurrency(totalGrossMargin()) }}</div>
          <div class="text-sm text-gray-500 dark:text-gray-400">Projected {{ totalGrossMargin() >= 0 ? 'Profit' : 'Loss' }}</div>
        </app-card>

        <!-- Risk Exposure -->
        <app-card class="p-4">
          <div class="flex items-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-600 dark:text-red-400">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
              <line x1="12" x2="12" y1="9" y2="13"/>
              <line x1="12" x2="12.01" y1="17" y2="17"/>
            </svg>
            <div class="text-sm font-medium text-gray-500 dark:text-gray-400">Risk Exposure</div>
          </div>
          <div [class]="'text-2xl font-bold ' + (totalNetPosition() > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white')">
            {{ formatNumber(totalNetPosition() > 0 ? totalNetPosition() : 0) }}
          </div>
          <div class="text-sm text-gray-500 dark:text-gray-400">Unhedged Bushels</div>
        </app-card>
      </div>

      <!-- Tabs -->
      <app-tabs [tabs]="tabs" defaultTab="position" (tabChange)="onTabChange($event)">
        <!-- Position Tab -->
        <app-tab-content tabId="position" [activeTab]="activeTab()">
          <app-card class="overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full">
                <thead class="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Commodity</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Delivery</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Location</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Purchased</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Hedged</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Net Position</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Contracts</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Gross Margin</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  @for (position of filteredPositions(); track position.commodity + position.deliveryWindow + position.location) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td class="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{{ position.commodity }}</td>
                      <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{{ position.deliveryWindow }}</td>
                      <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 hidden md:table-cell">{{ position.location }}</td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ formatNumber(position.purchasedBushels) }}</td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ formatNumber(position.hedgedBushels) }}</td>
                      <td class="px-4 py-3 text-sm text-right">
                        <span [class]="position.netPosition > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-green-600 dark:text-green-400'">
                          {{ position.netPosition > 0 ? '+' : '' }}{{ formatNumber(position.netPosition) }}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right hidden md:table-cell">{{ position.openContracts }}</td>
                      <td class="px-4 py-3 text-sm text-green-600 dark:text-green-400 text-right hidden md:table-cell">{{ formatCurrency(position.grossMargin) }}</td>
                    </tr>
                  }
                </tbody>
                <tfoot class="bg-gray-100 dark:bg-gray-700">
                  <tr class="font-semibold">
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white" colspan="3">Totals</td>
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ formatNumber(totalPurchased()) }}</td>
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ formatNumber(totalHedged()) }}</td>
                    <td class="px-4 py-3 text-sm text-right">
                      <span [class]="totalNetPosition() > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'">
                        {{ totalNetPosition() > 0 ? '+' : '' }}{{ formatNumber(totalNetPosition()) }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right hidden md:table-cell">{{ totalContracts() }}</td>
                    <td class="px-4 py-3 text-sm text-green-600 dark:text-green-400 text-right hidden md:table-cell">{{ formatCurrency(totalGrossMargin()) }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </app-card>

          <!-- Risk Alert -->
          @if (totalNetPosition() > 0) {
            <div class="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
              <div class="flex items-start gap-3">
                <div class="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-lg flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-600 dark:text-amber-400">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                    <line x1="12" x2="12" y1="9" y2="13"/>
                    <line x1="12" x2="12.01" y1="17" y2="17"/>
                  </svg>
                </div>
                <div class="flex-1">
                  <h4 class="font-semibold text-amber-800 dark:text-amber-300">Unhedged Position Alert</h4>
                  <p class="text-sm text-amber-700 dark:text-amber-400 mt-1">
                    You have {{ formatNumber(totalNetPosition()) }} bushels of unhedged grain exposure. Consider placing hedge orders to reduce market risk.
                  </p>
                  <button
                    type="button"
                    class="mt-3 inline-flex items-center justify-center rounded-md font-medium h-10 px-4 py-2 border border-amber-600 dark:border-amber-500 bg-white dark:bg-gray-800 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                  >
                    Place Hedge Order
                  </button>
                </div>
              </div>
            </div>
          }
        </app-tab-content>

        <!-- Basis Tab -->
        <app-tab-content tabId="basis" [activeTab]="activeTab()">
          <app-card class="overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full">
                <thead class="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Commodity</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Delivery</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Location</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cash Bid</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Futures</th>
                    <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Basis</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Avg Purchase</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Margin/Bu</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  @for (position of filteredPositions(); track position.commodity + position.deliveryWindow + position.location) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td class="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{{ position.commodity }}</td>
                      <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{{ position.deliveryWindow }}</td>
                      <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 hidden md:table-cell">{{ position.location }}</td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ formatPrice(position.cashBid) }}</td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ formatPrice(position.futuresPrice) }}</td>
                      <td class="px-4 py-3 text-center">
                        <app-badge [class]="position.basis >= -0.15 ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'">
                          {{ formatBasis(position.basis) }}
                        </app-badge>
                      </td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right hidden md:table-cell">{{ formatPrice(position.averagePurchasePrice) }}</td>
                      <td class="px-4 py-3 text-sm text-green-600 dark:text-green-400 text-right hidden md:table-cell">{{ formatPrice(getMarginPerBushel(position)) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card>

          <!-- Basis Info Card -->
          <app-card class="mt-4 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
            <div class="p-4">
              <div class="flex items-start gap-3">
                <div class="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-600 dark:text-blue-400">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4"/>
                    <path d="M12 8h.01"/>
                  </svg>
                </div>
                <div>
                  <h4 class="font-semibold text-blue-800 dark:text-blue-300">Basis Analysis</h4>
                  <p class="text-sm text-blue-700 dark:text-blue-400 mt-1">
                    Current basis levels are {{ averageBasis() >= -0.20 ? 'stronger than' : 'weaker than' }} historical averages.
                    {{ averageBasis() >= -0.20 ? 'Consider locking in basis on unpriced bushels.' : 'Monitor for basis improvement opportunities.' }}
                  </p>
                </div>
              </div>
            </div>
          </app-card>
        </app-tab-content>

        <!-- Hedges Tab -->
        <app-tab-content tabId="hedges" [activeTab]="activeTab()">
          <app-card class="overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full">
                <thead class="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Commodity</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Contract Month</th>
                    <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Position</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Contracts</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Bushels</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Entry Price</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Current Price</th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Unrealized P&L</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  @for (hedge of filteredHedges(); track hedge.id) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td class="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{{ hedge.commodity }}</td>
                      <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{{ hedge.contractMonth }}</td>
                      <td class="px-4 py-3 text-center">
                        <app-badge [class]="hedge.position === 'Short' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'">
                          {{ hedge.position }}
                        </app-badge>
                      </td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ hedge.contracts }}</td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right hidden md:table-cell">{{ formatNumber(hedge.bushels) }}</td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ formatPrice(hedge.entryPrice) }}</td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white text-right">{{ formatPrice(hedge.currentPrice) }}</td>
                      <td class="px-4 py-3 text-sm text-right">
                        <span [class]="hedge.unrealizedPL >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                          {{ formatCurrency(hedge.unrealizedPL) }}
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot class="bg-gray-100 dark:bg-gray-700">
                  <tr class="font-semibold">
                    <td class="px-4 py-3 text-sm text-gray-900 dark:text-white" colspan="7">Total Unrealized P&L</td>
                    <td class="px-4 py-3 text-sm text-right">
                      <span [class]="totalUnrealizedPL() >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                        {{ formatCurrency(totalUnrealizedPL()) }}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </app-card>

          <!-- Hedge Performance Card -->
          <app-card class="mt-4 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20">
            <div class="p-4">
              <div class="flex items-start gap-3">
                <div class="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-purple-600 dark:text-purple-400">
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
                    <polyline points="16 7 22 7 22 13"/>
                  </svg>
                </div>
                <div>
                  <h4 class="font-semibold text-purple-800 dark:text-purple-300">Hedge Performance</h4>
                  <p class="text-sm text-purple-700 dark:text-purple-400 mt-1">
                    {{ totalUnrealizedPL() < 0 ? 'Current hedge positions show unrealized losses due to rising futures prices. These losses are offset by gains in physical grain value.' : 'Current hedge positions are performing well with unrealized gains.' }}
                  </p>
                </div>
              </div>
            </div>
          </app-card>
        </app-tab-content>
      </app-tabs>
    </div>
  `
})
export class PositionReportComponent implements OnInit, OnDestroy {
  private positionService = inject(PositionService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  /** Raw position data from service */
  private positions = signal<PositionData[]>([]);
  /** Raw hedge data from service */
  private hedges = signal<HedgePosition[]>([]);
  /** Available filter options */
  locations: string[] = [];
  commodities: string[] = [];

  /** Filter state */
  selectedCommodity = signal('');
  selectedLocation = signal('');
  activeTab = signal('position');

  /** Tab configuration */
  tabs = [
    { id: 'position', label: 'Position' },
    { id: 'basis', label: 'Basis' },
    { id: 'hedges', label: 'Hedges' }
  ];

  /** Filtered positions based on selected commodity and location - cached via computed */
  filteredPositions = computed(() => {
    return this.positions().filter(p => {
      const commodityMatch = !this.selectedCommodity() || p.commodity === this.selectedCommodity();
      const locationMatch = !this.selectedLocation() || p.location === this.selectedLocation();
      return commodityMatch && locationMatch;
    });
  });

  /** Filtered hedges based on selected commodity - cached via computed */
  filteredHedges = computed(() => {
    if (!this.selectedCommodity()) return this.hedges();
    return this.hedges().filter(h => h.commodity === this.selectedCommodity());
  });

  /** Aggregated totals - computed once per filter change instead of per getter call */
  private positionTotals = computed(() => {
    const positions = this.filteredPositions();
    return positions.reduce((acc, p) => ({
      purchased: acc.purchased + p.purchasedBushels,
      hedged: acc.hedged + p.hedgedBushels,
      netPosition: acc.netPosition + p.netPosition,
      grossMargin: acc.grossMargin + p.grossMargin,
      contracts: acc.contracts + p.openContracts,
      basisSum: acc.basisSum + p.basis,
      count: acc.count + 1
    }), { purchased: 0, hedged: 0, netPosition: 0, grossMargin: 0, contracts: 0, basisSum: 0, count: 0 });
  });

  /** Total purchased bushels */
  totalPurchased = computed(() => this.positionTotals().purchased);
  /** Total hedged bushels */
  totalHedged = computed(() => this.positionTotals().hedged);
  /** Net unhedged position */
  totalNetPosition = computed(() => this.positionTotals().netPosition);
  /** Total projected profit/loss */
  totalGrossMargin = computed(() => this.positionTotals().grossMargin);
  /** Total open contracts */
  totalContracts = computed(() => this.positionTotals().contracts);
  /** Average basis across positions */
  averageBasis = computed(() => {
    const totals = this.positionTotals();
    return totals.count === 0 ? 0 : totals.basisSum / totals.count;
  });

  /** Total unrealized P&L from hedges */
  totalUnrealizedPL = computed(() => {
    return this.filteredHedges().reduce((sum, h) => sum + h.unrealizedPL, 0);
  });

  ngOnInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadData(): void {
    forkJoin({
      positions: this.positionService.getPositionData(),
      hedges: this.positionService.getHedgePositions()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.positions.set(data.positions);
        this.hedges.set(data.hedges);
        this.locations = this.positionService.getLocations();
        this.commodities = this.positionService.getCommodities();
      },
      error: () => {
        this.toastService.error('Failed to load position data');
      }
    });
  }

  onCommodityChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.selectedCommodity.set(target.value);
  }

  onLocationChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.selectedLocation.set(target.value);
  }

  onTabChange(tabId: string): void {
    this.activeTab.set(tabId);
  }

  formatNumber(value: number): string {
    return value.toLocaleString();
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  formatPrice(value: number): string {
    return '$' + value.toFixed(2);
  }

  formatBasis(value: number): string {
    const sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(2);
  }

  /** Calculates margin per bushel, safely handling division by zero */
  getMarginPerBushel(position: PositionData): number {
    if (position.purchasedBushels === 0) return 0;
    return position.grossMargin / position.purchasedBushels;
  }
}
