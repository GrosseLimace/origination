import { Component, input, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@core/services/theme.service';
import { Contract } from '@models';

interface YearData {
  year: string;
  volume: number;
  revenue: number;
}

@Component({
  selector: 'app-year-over-year-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './year-over-year-chart.component.html'
})
export class YearOverYearChartComponent {
  public contracts = input<Contract[]>([]);

  private themeService = inject(ThemeService);

  chartData: YearData[] = [];
  maxVolume = 0;
  maxRevenue = 0;
  totalVolume = 0;
  totalRevenue = 0;

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  constructor() {
    effect(() => {
      const _contracts = this.contracts();
      this._loadChartData();
    });
  }

  private _loadChartData(): void {
    // Group contracts by year and calculate totals
    const grouped = this.contracts().reduce((acc, contract) => {
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

  /** Bar height as a percentage of the plot area. Percent, not pixels, so the
   *  chart can change height without this needing to know the pixel value. */
  getBarHeight(value: number, max: number): number {
    const minPercent = 5;
    if (max === 0) return minPercent;
    return Math.max(minPercent, (value / max) * 100);
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
