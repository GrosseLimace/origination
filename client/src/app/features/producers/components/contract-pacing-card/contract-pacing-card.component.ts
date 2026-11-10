import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@core/services/theme.service';
import { AppStateService } from '@core/services/app-state.service';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { ContractPacingHistoryStore } from '../../data-access/contract-pacing-history.store';
import { ProducerInsightsPanels } from '../producer-insights/producer-insights-panels.state';
import { Contract, HarvestWindow } from '@models';

type PacingDirection = 'up' | 'down' | 'flat';

interface CommodityPacingRow {
  commodity: string;
  thisYear: number;
  lastYear: number;
  direction: PacingDirection;
  /** Pre-formatted harvest window range, e.g. "Jul 1 – Aug 31". Shown in the row tooltip. */
  windowLabel: string;
}

/**
 * The Contract Pacing card, under the profile header while the Producer Insights panels are open: bushels contracted
 * for delivery in each harvest window this year against last, by commodity. Its element takes no space, so the card is
 * the profile's own item, and nothing is there while the panels are closed.
 */
@Component({
  selector: 'app-contract-pacing-card',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'contents' },
  templateUrl: './contract-pacing-card.component.html',
  // The template reads signals, computeds, and style getters over the theme's isDarkMode signal. The
  // history arrives (or fails) as a signal, so it marks the view after the first render.
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContractPacingCardComponent {
  private readonly themeService = inject(ThemeService);
  private readonly appState = inject(AppStateService);
  private readonly pacing = inject(ContractPacingHistoryStore);

  /** Shown while the Producer Insights panels are open. */
  readonly open = inject(ProducerInsightsPanels).open;
  private readonly customer = inject(SelectedCustomerContext).customer;
  private readonly customerId = computed(() => this.customer()?.id ?? null);
  /** The producer's open contracts. */
  readonly contracts = inject(SelectedProducerActivity).contracts;
  /** The harvest windows the figures are measured in. */
  readonly harvestWindows = this.appState.harvestWindows;
  /** The producer's closed contracts, read once for every pacing figure on the profile. */
  readonly historicalContracts = this.pacing.contractsFor(this.customerId);

  /** True when this producer's prior-year history could not be read, so the year-over-year comparison
   *  is understated rather than genuinely flat. Producer-scoped: never the trade-unit-wide flag. */
  readonly historyUnavailable = this.pacing.failedFor(this.customerId);

  /** The harvest windows failed to load. Every figure here is measured inside them, so without them
   *  both years read "—" — as if the producer had contracted nothing. */
  readonly harvestWindowsUnavailable = computed(() =>
    this.appState.harvestWindowsLoadFailed() && this.harvestWindows().length === 0);

  constructor() {
    effect(() => {
      const id = this.customerId();
      untracked(() => this.pacing.load(id));
    });
  }

  /** Open + historical merged for pacing calculations. */
  private readonly allContracts = computed<Contract[]>(() => {
    const open = this.contracts() || [];
    const historical = this.historicalContracts();
    const seen = new Set<number>(open.map(c => c.id));
    const merged = [...open];
    for (const h of historical) {
      if (!seen.has(h.id)) {
        merged.push(h);
        seen.add(h.id);
      }
    }
    return merged;
  });

  // ── Style getters (unchanged) ──────────────────────────────────────────────

  get isDarkMode(): boolean { return this.themeService.isDarkMode(); }

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

  get labelStyle(): string { return 'color: #e2e8f0; font-size: 0.875rem;'; }
  get sublabelStyle(): string { return 'color: #cbd5e1; font-size: 0.75rem;'; }
  get colHeaderStyle(): string {
    return 'color: #cbd5e1; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700;';
  }

  getArrowStyle(direction: PacingDirection): string {
    if (direction === 'up') {
      return 'color: #4ade80;'; // green
    }
    if (direction === 'down') {
      return 'color: #f87171;'; // red
    }
    return 'color: #94a3b8;'; // neutral gray
  }

  // ── Harvest window matching ────────────────────────────────────────────────

  /** Calendar year drives the harvest-window comparison.
   *  "This year" = current calendar year, "last year" = current year - 1. */
  readonly currentCropYear = computed(() => new Date().getFullYear());

  /**
   * Returns true if the contract's delivery period overlaps the harvest window
   * for `hw.commodity` in `cropYear`.
   */
  private contractMatchesHarvestWindow(c: Contract, hw: HarvestWindow, cropYear: number): boolean {
    if (!c.deliveryStart && !c.deliveryEnd) return false;
    const windowStart = new Date(cropYear, hw.deliveryStartMonth - 1, hw.deliveryStartDay);
    const windowEnd = new Date(cropYear, hw.deliveryEndMonth - 1, hw.deliveryEndDay);
    windowEnd.setHours(23, 59, 59, 999); // include the full end day

    const delStart = c.deliveryStart ? new Date(c.deliveryStart) : new Date(c.deliveryEnd!);
    const delEnd = c.deliveryEnd ? new Date(c.deliveryEnd) : new Date(c.deliveryStart!);
    return delStart <= windowEnd && delEnd >= windowStart;
  }

  /** Match contract's commodity to a harvest window's commodity (case-insensitive, group or description). */
  private contractMatchesCommodity(c: Contract, hwCommodity: string): boolean {
    const target = hwCommodity.trim().toUpperCase();
    if (!target) return false;
    const group = (c.commodityGroup || '').trim().toUpperCase();
    if (group && group === target) return true;
    const desc = (c.commodityDescription || '').trim().toUpperCase();
    if (desc && desc.includes(target)) return true;
    const code = (c.commodityCode || '').trim().toUpperCase();
    if (code && code.includes(target)) return true;
    return false;
  }

  /** Format a harvest window's start/end as "Mon D – Mon D" for tooltip display. */
  private formatHarvestWindow(hw: HarvestWindow): string {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const startMon = months[hw.deliveryStartMonth - 1] ?? '';
    const endMon = months[hw.deliveryEndMonth - 1] ?? '';
    return `${startMon} ${hw.deliveryStartDay} – ${endMon} ${hw.deliveryEndDay}`;
  }

  /** Compute pacing direction from two totals. */
  private direction(thisYear: number, lastYear: number): PacingDirection {
    if (thisYear > lastYear) return 'up';
    if (thisYear < lastYear) return 'down';
    return 'flat';
  }

  // ── Computed rollups ───────────────────────────────────────────────────────

  readonly pacingByCommodity = computed<CommodityPacingRow[]>(() => {
    const windows = this.harvestWindows().filter(hw => hw.isActive !== false);
    const year = this.currentCropYear();
    const priorYear = year - 1;
    const contracts = this.allContracts();
    const rows: CommodityPacingRow[] = [];

    for (const hw of windows) {
      let thisYear = 0;
      let lastYear = 0;
      for (const c of contracts) {
        if (!this.contractMatchesCommodity(c, hw.commodity)) continue;
        if (this.contractMatchesHarvestWindow(c, hw, year)) thisYear += c.quantity;
        if (this.contractMatchesHarvestWindow(c, hw, priorYear)) lastYear += c.quantity;
      }
      if (thisYear > 0 || lastYear > 0) {
        rows.push({
          commodity: hw.commodity,
          thisYear,
          lastYear,
          direction: this.direction(thisYear, lastYear),
          windowLabel: this.formatHarvestWindow(hw)
        });
      }
    }
    return rows.sort((a, b) => b.thisYear - a.thisYear);
  });

  readonly totalBushelsThisYear = computed(() =>
    this.pacingByCommodity().reduce((sum, r) => sum + r.thisYear, 0)
  );

  readonly totalBushelsLastYear = computed(() =>
    this.pacingByCommodity().reduce((sum, r) => sum + r.lastYear, 0)
  );

  readonly totalDirection = computed<PacingDirection>(() =>
    this.direction(this.totalBushelsThisYear(), this.totalBushelsLastYear())
  );
}
