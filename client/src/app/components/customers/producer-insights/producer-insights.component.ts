import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain } from '../../../models';

@Component({
  selector: 'app-producer-insights',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  template: `
    <div class="rounded-xl overflow-hidden" [style]="gradientStyle">
      <div class="p-6 pb-8">
        <!-- Header Row -->
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-white">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
              <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
            </svg>
            <h3 class="text-xl font-semibold text-white">Producer Insights</h3>
          </div>
          @if (customer.eSignEnabled) {
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium" [style]="badgeStyle">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              eSign Enabled
            </span>
          }
        </div>

        <!-- Subtitle -->
        <p [style]="subtitleStyle">
          {{ customer.name }} - Performance Analytics & Growth Metrics
        </p>

        <!-- Spacer -->
        <div class="h-8"></div>

        <!-- Stats Grid - Single Row of 4 -->
        <div class="grid grid-cols-4 gap-4">
          <!-- Total Volume -->
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div class="flex items-center justify-between mb-3">
              <span [style]="labelStyle">Total Volume</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style]="iconStyle">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              </svg>
            </div>
            <div class="text-2xl text-white mb-1">
              {{ totalContracted | number }}
            </div>
            <div [style]="sublabelStyle">bushels contracted</div>
          </div>

          <!-- Contract Pacing -->
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div class="flex items-center justify-between mb-3">
              <span [style]="labelStyle">Contract Pacing</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style]="iconStyle">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
                <polyline points="16 7 22 7 22 13"/>
              </svg>
            </div>
            <div class="text-2xl text-white mb-1">
              {{ totalBushelsThisYear | number:'1.0-0' }}
            </div>
            <div class="flex items-center gap-1.5" [style]="sublabelStyle">
              <span>{{ currentDeliveryYear }} delivery</span>
              @if (pacingPercentChange !== null) {
                <span [style]="getPacingChangeStyle(pacingPercentChange)">
                  {{ pacingPercentChange >= 0 ? '↑' : '↓' }}{{ pacingPercentChange | number:'1.0-0' }}%
                </span>
              }
            </div>
          </div>

          <!-- Average Contract Size -->
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div class="flex items-center justify-between mb-3">
              <span [style]="labelStyle">Avg Contract</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style]="iconStyle">
                <line x1="12" x2="12" y1="20" y2="10"/>
                <line x1="18" x2="18" y1="20" y2="4"/>
                <line x1="6" x2="6" y1="20" y2="16"/>
              </svg>
            </div>
            <div class="text-2xl text-white mb-1">
              {{ averageContractSize | number:'1.0-0' }}
            </div>
            <div [style]="sublabelStyle">bushels per contract</div>
          </div>

          <!-- Engagement -->
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div class="flex items-center justify-between mb-3">
              <span [style]="labelStyle">Engagement</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style]="iconStyle">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <div class="text-2xl text-white mb-1">
              {{ totalInteractions }}
            </div>
            <div [style]="sublabelStyle">total interactions</div>
          </div>
        </div>

        <!-- Contract Pacing — Commodity × Delivery Window Breakdown -->
        @if (pacingByCommodity.length > 0) {
          <div class="mt-6">
            <div class="mb-4" style="height: 1px; background: rgba(134, 239, 172, 0.15);"></div>

            <!-- Column labels -->
            <div class="flex items-center gap-4 mb-3">
              <span class="flex-1" [style]="colHeaderStyle">Commodity</span>
              <span class="w-28 text-right" [style]="colHeaderStyle">{{ currentDeliveryYear - 1 }} (bu)</span>
              <span class="w-28 text-right" [style]="colHeaderStyle">{{ currentDeliveryYear }} (bu)</span>
              <span class="w-20 text-right" [style]="colHeaderStyle">Change</span>
            </div>

            <!-- Commodity rows -->
            <div class="space-y-2.5">
              @for (row of pacingByCommodity; track row.commodity) {
                <div class="flex items-center gap-4">
                  <span class="flex-1 text-white text-sm font-medium">{{ row.commodity }}</span>

                  <!-- Last year -->
                  <span class="w-28 text-right text-sm tabular-nums font-medium" [style]="sublabelStyle">
                    {{ row.lastYear > 0 ? (row.lastYear | number:'1.0-0') : '—' }}
                  </span>

                  <!-- This year -->
                  <span class="w-28 text-right text-sm tabular-nums font-bold text-white">
                    {{ row.thisYear | number:'1.0-0' }}
                  </span>

                  <!-- Change badge -->
                  <div class="w-20 text-right">
                    @if (row.pct !== null) {
                      <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-bold"
                        [style]="getPacingBadgeStyle(row.pct)">
                        {{ row.pct >= 0 ? '▲' : '▼' }}&nbsp;{{ row.pct | number:'1.0-0' }}%
                      </span>
                    } @else {
                      <span class="inline-flex px-2 py-0.5 rounded text-xs font-bold"
                        style="background: rgba(134,239,172,0.1); color: #86efac;">new</span>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Total divider + row -->
            <div class="mt-4 pt-3 flex items-center gap-4" style="border-top: 1px solid rgba(134,239,172,0.2);">
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
export class ProducerInsightsComponent {
  @Input() customer!: Customer;
  @Input() contracts: Contract[] = [];
  @Input() tickets: Ticket[] = [];
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() notes: Note[] = [];
  @Input() storedGrain: StoredGrain[] = [];

  private themeService = inject(ThemeService);

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  get gradientStyle(): string {
    return this.isDarkMode
      ? 'background: linear-gradient(145deg, #166534 0%, #15803d 20%, #14532d 50%, #052e16 100%);'
      : 'background: linear-gradient(145deg, #22c55e 0%, #16a34a 35%, #15803d 65%, #166534 100%);';
  }

  get subtitleStyle(): string {
    return this.isDarkMode
      ? 'color: #86efac; font-size: 0.875rem;'
      : 'color: #bbf7d0; font-size: 0.875rem;';
  }

  get cardStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(21, 128, 61, 0.3); border: 1px solid rgba(34, 197, 94, 0.4);'
      : 'background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(134, 239, 172, 0.3);';
  }

  get labelStyle(): string {
    return this.isDarkMode
      ? 'color: #86efac; font-size: 0.875rem;'
      : 'color: #bbf7d0; font-size: 0.875rem;';
  }

  get iconStyle(): string {
    return this.isDarkMode
      ? 'color: #4ade80;'
      : 'color: #86efac;';
  }

  get sublabelStyle(): string {
    return 'color: #86efac; font-size: 0.75rem;';
  }

  get badgeStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4);'
      : 'background: rgba(255, 255, 255, 0.15); color: white; border: 1px solid rgba(255, 255, 255, 0.3);';
  }

  getPacingChangeStyle(pct: number): string {
    return pct >= 0 ? 'color: #4ade80;' : 'color: #f87171;';
  }

  getPacingBadgeStyle(pct: number): string {
    return pct >= 0
      ? 'background: rgba(74, 222, 128, 0.15); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3);'
      : 'background: rgba(248, 113, 113, 0.15); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3);';
  }

  get pacingRowStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(15, 100, 45, 0.3);'
      : 'background: rgba(255, 255, 255, 0.05);';
  }

  get colHeaderStyle(): string {
    return 'color: #86efac; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700;';
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  get totalContracted(): number {
    return this.contracts.reduce((sum, c) => sum + c.quantity, 0);
  }

  get averageContractSize(): number {
    if (this.contracts.length === 0) return 0;
    return this.totalContracted / this.contracts.length;
  }

  get totalInteractions(): number {
    return this.notes.length + this.tickets.length;
  }

  // ─── Contract Pacing ──────────────────────────────────────────────────────

  /**
   * Current delivery year = max year found in deliveryStart across all contracts.
   * Using deliveryStart (not cropYear) correctly separates old crop bin bushels
   * (delivering Jan–Mar 2026) from new crop forward sales (delivering Oct–Nov 2026).
   */
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

  /**
   * "Same calendar date last year" cutoff used to make a fair apples-to-apples
   * comparison: only count prior-year contracts booked by this point last year.
   */
  private get samePointLastYear(): Date {
    const today = new Date();
    return new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  }

  /** Contracts delivering in the current delivery year. */
  private get contractsThisYear(): Contract[] {
    const year = this.currentDeliveryYear;
    return this.contracts.filter(c =>
      c.deliveryStart && new Date(c.deliveryStart).getFullYear() === year
    );
  }

  /**
   * Contracts delivering in the prior delivery year that were booked on or before
   * the same calendar date last year — true apples-to-apples pacing baseline.
   */
  private get contractsLastYear(): Contract[] {
    const priorYear = this.currentDeliveryYear - 1;
    const cutoff = this.samePointLastYear;
    return this.contracts.filter(c => {
      if (!c.deliveryStart || new Date(c.deliveryStart).getFullYear() !== priorYear) return false;
      if (!c.contractDate) return true; // include if booking date unavailable
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

  /**
   * Per-commodity pacing rows comparing this delivery year vs last delivery year.
   * The prior-year column only counts contracts booked by this date last year.
   */
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

  formatBu(bu: number): string {
    if (bu >= 1_000_000) return `${(bu / 1_000_000).toFixed(1)}M`;
    if (bu >= 1_000) return `${Math.round(bu / 1_000)}K`;
    return bu.toLocaleString();
  }

  formatRevenue(amount: number): string {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `${Math.floor(amount / 1000)}K`;
    return amount.toLocaleString();
  }
}
