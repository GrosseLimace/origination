import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { Contract } from '../../../models';

@Component({
  selector: 'app-contract-pacing-card',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  template: `
    <div class="rounded-xl overflow-hidden" [style]="gradientStyle">
      <div class="p-6">
        <!-- Header -->
        <div class="flex items-center gap-3 mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-white">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
            <polyline points="16 7 22 7 22 13"/>
          </svg>
          <h3 class="text-xl font-semibold text-white">Contract Pacing</h3>
          @if (pacingPercentChange !== null) {
            <span class="ml-auto inline-flex items-center gap-0.5 px-2.5 py-1 rounded-full text-sm font-bold"
              [style]="getPacingBadgeStyle(pacingPercentChange)">
              {{ pacingPercentChange >= 0 ? '▲' : '▼' }}&nbsp;{{ pacingPercentChange | number:'1.0-0' }}% vs last year
            </span>
          }
        </div>

        <!-- Summary stat row -->
        <div class="grid grid-cols-3 gap-4 mb-4">
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div [style]="labelStyle">{{ currentDeliveryYear - 1 }}</div>
            <div class="text-2xl text-white mt-1">{{ totalBushelsLastYear > 0 ? (totalBushelsLastYear | number:'1.0-0') : '—' }}</div>
            <div [style]="sublabelStyle">at same point last year</div>
          </div>
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div [style]="labelStyle">{{ currentDeliveryYear }}</div>
            <div class="text-2xl text-white mt-1">{{ totalBushelsThisYear | number:'1.0-0' }}</div>
            <div [style]="sublabelStyle">bushels contracted</div>
          </div>
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div [style]="labelStyle">Net Change</div>
            <div class="text-2xl text-white mt-1">
              @if (pacingPercentChange !== null) {
                {{ pacingPercentChange >= 0 ? '+' : '' }}{{ pacingPercentChange | number:'1.0-0' }}%
              } @else {
                —
              }
            </div>
            <div [style]="sublabelStyle">year-over-year</div>
          </div>
        </div>

        <!-- Commodity breakdown -->
        @if (pacingByCommodity.length > 0) {
          <div>
            <div class="mb-3" style="height: 1px; background: rgba(148, 163, 184, 0.15);"></div>
            <div class="flex items-center gap-4 mb-3">
              <span class="flex-1" [style]="colHeaderStyle">Commodity</span>
              <span class="w-28 text-right" [style]="colHeaderStyle">{{ currentDeliveryYear - 1 }} (bu)</span>
              <span class="w-28 text-right" [style]="colHeaderStyle">{{ currentDeliveryYear }} (bu)</span>
              <span class="w-20 text-right" [style]="colHeaderStyle">Change</span>
            </div>
            <div class="space-y-2.5">
              @for (row of pacingByCommodity; track row.commodity) {
                <div class="flex items-center gap-4">
                  <span class="flex-1 text-white text-sm font-medium">{{ row.commodity }}</span>
                  <span class="w-28 text-right text-sm tabular-nums font-medium" [style]="sublabelStyle">
                    {{ row.lastYear > 0 ? (row.lastYear | number:'1.0-0') : '—' }}
                  </span>
                  <span class="w-28 text-right text-sm tabular-nums font-bold text-white">
                    {{ row.thisYear | number:'1.0-0' }}
                  </span>
                  <div class="w-20 text-right">
                    @if (row.pct !== null) {
                      <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-bold"
                        [style]="getPacingBadgeStyle(row.pct)">
                        {{ row.pct >= 0 ? '▲' : '▼' }}&nbsp;{{ row.pct | number:'1.0-0' }}%
                      </span>
                    } @else {
                      <span class="inline-flex px-2 py-0.5 rounded text-xs font-bold"
                        style="background: rgba(148,163,184,0.15); color: #cbd5e1;">new</span>
                    }
                  </div>
                </div>
              }
            </div>
            <!-- Total row -->
            <div class="mt-4 pt-3 flex items-center gap-4" style="border-top: 1px solid rgba(148,163,184,0.2);">
              <span class="flex-1" [style]="colHeaderStyle">Total Bushels</span>
              <span class="w-28 text-right text-sm tabular-nums font-semibold" [style]="sublabelStyle">
                {{ totalBushelsLastYear > 0 ? (totalBushelsLastYear | number:'1.0-0') : '—' }}
              </span>
              <span class="w-28 text-right text-sm tabular-nums font-bold text-white">
                {{ totalBushelsThisYear | number:'1.0-0' }}
              </span>
              <div class="w-20 text-right">
                @if (pacingPercentChange !== null) {
                  <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-bold"
                    [style]="getPacingBadgeStyle(pacingPercentChange)">
                    {{ pacingPercentChange >= 0 ? '▲' : '▼' }}&nbsp;{{ pacingPercentChange | number:'1.0-0' }}%
                  </span>
                }
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `
})
export class ContractPacingCardComponent {
  @Input() contracts: Contract[] = [];

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
    for (const c of this.contracts) {
      if (c.deliveryStart) {
        const y = new Date(c.deliveryStart).getFullYear();
        if (y > max) max = y;
      }
    }
    return max > 0 ? max : new Date().getFullYear();
  }

  private get samePointLastYear(): Date {
    const today = new Date();
    return new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  }

  private get contractsThisYear(): Contract[] {
    const year = this.currentDeliveryYear;
    return this.contracts.filter(c =>
      c.deliveryStart && new Date(c.deliveryStart).getFullYear() === year
    );
  }

  private get contractsLastYear(): Contract[] {
    const priorYear = this.currentDeliveryYear - 1;
    const cutoff = this.samePointLastYear;
    return this.contracts.filter(c => {
      if (!c.deliveryStart || new Date(c.deliveryStart).getFullYear() !== priorYear) return false;
      if (!c.contractDate) return true;
      return new Date(c.contractDate) <= cutoff;
    });
  }

  get totalBushelsThisYear(): number {
    return this.contractsThisYear.reduce((sum, c) => sum + c.quantity, 0);
  }

  get totalBushelsLastYear(): number {
    return this.contractsLastYear.reduce((sum, c) => sum + c.quantity, 0);
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
    for (const c of this.contractsThisYear) {
      const commodity = label(c);
      if (commodity) ensureRow(commodity).thisYear += c.quantity;
    }
    for (const c of this.contractsLastYear) {
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
