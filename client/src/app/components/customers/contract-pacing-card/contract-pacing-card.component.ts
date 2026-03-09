import { Component, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { Contract } from '../../../models';

@Component({
  selector: 'app-contract-pacing-card',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  templateUrl: './contract-pacing-card.component.html'
})
export class ContractPacingCardComponent {
  public contracts = input<Contract[]>([]);

  private themeService = inject(ThemeService);

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  get gradientStyle(): string {
    return this.isDarkMode
      ? 'background: linear-gradient(145deg, #1e293b 0%, #334155 20%, #1e293b 50%, #0f172a 100%);'
      : 'background: linear-gradient(145deg, #64748b 0%, #475569 35%, #334155 65%, #1e293b 100%);';
  }

  get cardStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(51, 65, 85, 0.35); border: 1px solid rgba(100, 116, 139, 0.4);'
      : 'background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(148, 163, 184, 0.3);';
  }

  get labelStyle(): string {
    return 'color: #e2e8f0; font-size: 0.875rem;';
  }

  get sublabelStyle(): string {
    return 'color: #cbd5e1; font-size: 0.75rem;';
  }

  get colHeaderStyle(): string {
    return 'color: #cbd5e1; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700;';
  }

  getPacingBadgeStyle(pct: number): string {
    return pct >= 0
      ? 'background: rgba(74, 222, 128, 0.15); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3);'
      : 'background: rgba(248, 113, 113, 0.15); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3);';
  }

  /** Most recent delivery year seen across all contracts. */
  get currentDeliveryYear(): number {
    let max = 0;
    for (const c of this.contracts()) {
      if (c.deliveryStart) {
        const y = new Date(c.deliveryStart).getFullYear();
        if (y > max) max = y;
      }
    }
    return max > 0 ? max : new Date().getFullYear();
  }

  private get _samePointLastYear(): Date {
    const today = new Date();
    return new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  }

  private get _contractsThisYear(): Contract[] {
    const year = this.currentDeliveryYear;
    return this.contracts().filter(c =>
      c.deliveryStart && new Date(c.deliveryStart).getFullYear() === year
    );
  }

  private get _contractsLastYear(): Contract[] {
    const priorYear = this.currentDeliveryYear - 1;
    const cutoff = this._samePointLastYear;
    return this.contracts().filter(c => {
      if (!c.deliveryStart || new Date(c.deliveryStart).getFullYear() !== priorYear) return false;
      if (!c.contractDate) return true;
      return new Date(c.contractDate) <= cutoff;
    });
  }

  get totalBushelsThisYear(): number {
    return this._contractsThisYear.reduce((sum, c) => sum + c.quantity, 0);
  }

  get totalBushelsLastYear(): number {
    return this._contractsLastYear.reduce((sum, c) => sum + c.quantity, 0);
  }

  get pacingPercentChange(): number | null {
    if (this.totalBushelsLastYear === 0) return null;
    return ((this.totalBushelsThisYear - this.totalBushelsLastYear) / this.totalBushelsLastYear) * 100;
  }

  get pacingByCommodity(): { commodity: string; thisYear: number; lastYear: number; pct: number | null }[] {
    const label = (c: Contract) => c.commodityDescription || c.commodityGroup || '';
    const rowMap = new Map<string, { thisYear: number; lastYear: number }>();
    const ensureRow = (commodity: string) => {
      if (!rowMap.has(commodity)) rowMap.set(commodity, { thisYear: 0, lastYear: 0 });
      return rowMap.get(commodity)!;
    };
    for (const c of this._contractsThisYear) {
      const commodity = label(c);
      if (commodity) ensureRow(commodity).thisYear += c.quantity;
    }
    for (const c of this._contractsLastYear) {
      const commodity = label(c);
      if (commodity) ensureRow(commodity).lastYear += c.quantity;
    }
    return Array.from(rowMap.entries())
      .map(([commodity, row]) => ({
        commodity,
        thisYear: row.thisYear,
        lastYear: row.lastYear,
        pct: row.lastYear > 0 ? ((row.thisYear - row.lastYear) / row.lastYear) * 100 : null
      }))
      .sort((a, b) => b.thisYear - a.thisYear);
  }
}
