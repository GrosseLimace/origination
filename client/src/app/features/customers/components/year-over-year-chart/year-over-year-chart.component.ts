import { ChangeDetectionStrategy, Component, computed, input, inject } from '@angular/core';
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
  templateUrl: './year-over-year-chart.component.html',
  // Everything the template reads is derived from the contracts input through computed signals.
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class YearOverYearChartComponent {
  public contracts = input<Contract[]>([]);

  private themeService = inject(ThemeService);

  /** One column per delivery-start year, oldest first; a single zero column for the current year
   *  when there are no contracts. */
  readonly chartData = computed<YearData[]>(() => {
    const grouped = this.contracts().reduce((acc, contract) => {
      const year = new Date(contract.deliveryStart).getFullYear().toString();
      if (!acc[year]) {
        acc[year] = { year, volume: 0, revenue: 0 };
      }
      acc[year].volume += contract.quantity;
      acc[year].revenue += contract.quantity * contract.price;
      return acc;
    }, {} as Record<string, YearData>);

    const data = Object.values(grouped).sort((a, b) => a.year.localeCompare(b.year));
    return data.length > 0 ? data : [{ year: new Date().getFullYear().toString(), volume: 0, revenue: 0 }];
  });

  // Max values for scaling
  readonly maxVolume = computed(() => Math.max(...this.chartData().map(d => d.volume), 1));
  readonly maxRevenue = computed(() => Math.max(...this.chartData().map(d => d.revenue), 1));

  readonly totalVolume = computed(() => this.chartData().reduce((sum, d) => sum + d.volume, 0));
  readonly totalRevenue = computed(() => this.chartData().reduce((sum, d) => sum + d.revenue, 0));

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
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
