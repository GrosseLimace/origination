import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { PositionService } from '@core/services/position.service';
import { ToastService } from '@core/services/toast.service';
import { PositionData, HedgePosition } from '@models';
import { CardComponent } from '@shared/components/card/card.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { TabsComponent, TabContentComponent } from '@shared/components/tabs/tabs.component';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';

@Component({
  selector: 'app-position-report',
  standalone: true,
  imports: [CommonModule, CardComponent, BadgeComponent, TabsComponent, TabContentComponent, TradeUnitSelectorComponent],
  templateUrl: './position-report.component.html'
})
export class PositionReportComponent {
  private readonly positionService = inject(PositionService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Raw position data from service */
  private _positions = signal<PositionData[]>([]);
  /** Raw hedge data from service */
  private _hedges = signal<HedgePosition[]>([]);
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
    return this._positions().filter(p => {
      const commodityMatch = !this.selectedCommodity() || p.commodity === this.selectedCommodity();
      const locationMatch = !this.selectedLocation() || p.location === this.selectedLocation();
      return commodityMatch && locationMatch;
    });
  });

  /** Filtered hedges based on selected commodity - cached via computed */
  filteredHedges = computed(() => {
    if (!this.selectedCommodity()) return this._hedges();
    return this._hedges().filter(h => h.commodity === this.selectedCommodity());
  });

  /** Aggregated totals - computed once per filter change instead of per getter call */
  private _positionTotals = computed(() => {
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
  totalPurchased = computed(() => this._positionTotals().purchased);
  /** Total hedged bushels */
  totalHedged = computed(() => this._positionTotals().hedged);
  /** Net unhedged position */
  totalNetPosition = computed(() => this._positionTotals().netPosition);
  /** Total projected profit/loss */
  totalGrossMargin = computed(() => this._positionTotals().grossMargin);
  /** Total open contracts */
  totalContracts = computed(() => this._positionTotals().contracts);
  /** Average basis across positions */
  averageBasis = computed(() => {
    const totals = this._positionTotals();
    return totals.count === 0 ? 0 : totals.basisSum / totals.count;
  });

  /** Total unrealized P&L from hedges */
  totalUnrealizedPL = computed(() => {
    return this.filteredHedges().reduce((sum, h) => sum + h.unrealizedPL, 0);
  });

  constructor() {
    this._loadData();
  }

  private _loadData(): void {
    forkJoin({
      positions: this.positionService.getPositionData(),
      hedges: this.positionService.getHedgePositions()
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this._positions.set(data.positions);
        this._hedges.set(data.hedges);
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
