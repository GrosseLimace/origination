import { Component, Input, OnInit, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { Contract } from '../../../models';

interface YearData {
  year: string;
  volume: number;
  revenue: number;
}

@Component({
  selector: 'app-year-over-year-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
      <!-- Header -->
      <div class="p-5 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-2 mb-1">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #3b82f6;">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
            <polyline points="16 7 22 7 22 13"/>
          </svg>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Year-over-Year Performance</h3>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400">Contract volume and revenue trends over time</p>
      </div>

      <!-- Chart -->
      <div class="p-6">
        <div class="h-[300px] flex items-end justify-center gap-8">
          @for (data of chartData; track data.year) {
            <div class="flex flex-col items-center gap-2">
              <div class="flex items-end gap-2 h-[220px]">
                <!-- Volume bar (green) -->
                <div class="w-12 rounded-t-md bg-gradient-to-t from-green-600 to-green-400 transition-all duration-300"
                     [style.height.px]="getBarHeight(data.volume, maxVolume)">
                </div>
                <!-- Revenue bar (blue) -->
                <div class="w-12 rounded-t-md bg-gradient-to-t from-blue-600 to-blue-400 transition-all duration-300"
                     [style.height.px]="getBarHeight(data.revenue, maxRevenue)">
                </div>
              </div>
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ data.year }}</span>
            </div>
          }
        </div>

        <!-- Legend -->
        <div class="flex justify-center gap-6 mt-6">
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded bg-gradient-to-t from-green-600 to-green-400"></div>
            <span class="text-sm text-gray-600 dark:text-gray-400">Volume (bu)</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded bg-gradient-to-t from-blue-600 to-blue-400"></div>
            <span class="text-sm text-gray-600 dark:text-gray-400">Revenue ($)</span>
          </div>
        </div>

        <!-- Summary Stats -->
        <div class="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div class="text-center">
            <div class="text-2xl font-bold text-green-600">{{ totalVolume | number }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">Total Bushels</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-600">\${{ formatRevenue(totalRevenue) }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">Total Revenue</div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class YearOverYearChartComponent implements OnInit, OnChanges {
  @Input() contracts: Contract[] = [];

  private themeService = inject(ThemeService);

  chartData: YearData[] = [];
  maxVolume = 0;
  maxRevenue = 0;
  totalVolume = 0;
  totalRevenue = 0;

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  ngOnInit(): void {
    this.loadChartData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['contracts']) {
      this.loadChartData();
    }
  }

  private loadChartData(): void {
    // Group contracts by year and calculate totals
    const grouped = this.contracts.reduce((acc, contract) => {
      const year = new Date(contract.deliveryStart).getFullYear().toString();
      if (!acc[year]) {
        acc[year] = { year, volume: 0, revenue: 0 };
      }
      acc[year].volume += contract.quantity;
      acc[year].revenue += contract.quantity * contract.price;
      return acc;
    }, {} as Record<string, YearData>);

    this.chartData = Object.values(grouped).sort((a, b) => a.year.localeCompare(b.year));

    // If no data, show current year with zeros
    if (this.chartData.length === 0) {
      this.chartData = [{
        year: new Date().getFullYear().toString(),
        volume: 0,
        revenue: 0
      }];
    }

    // Calculate max values for scaling
    this.maxVolume = Math.max(...this.chartData.map(d => d.volume), 1);
    this.maxRevenue = Math.max(...this.chartData.map(d => d.revenue), 1);

    // Calculate totals
    this.totalVolume = this.chartData.reduce((sum, d) => sum + d.volume, 0);
    this.totalRevenue = this.chartData.reduce((sum, d) => sum + d.revenue, 0);
  }

  getBarHeight(value: number, max: number): number {
    if (max === 0) return 10;
    const minHeight = 10;
    const maxHeight = 200;
    return Math.max(minHeight, (value / max) * maxHeight);
  }

  formatRevenue(amount: number): string {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${Math.floor(amount / 1000)}K`;
    }
    return amount.toLocaleString();
  }
}
