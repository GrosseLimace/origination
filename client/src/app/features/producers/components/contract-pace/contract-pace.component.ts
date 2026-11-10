import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { AppStateService } from '@core/services/app-state.service';
import { Contract, HarvestWindow } from '@models';
import { ContractPacingHistoryStore } from '../../data-access/contract-pacing-history.store';
import { ProducerInsightsPanels } from '../producer-insights/producer-insights-panels.state';

/** Which way the producer's harvest contracting is heading, against last year; 'none' with nothing to compare. */
export type PaceDirection = 'up' | 'down' | 'flat' | 'none';

/** Whether the contract's delivery period overlaps the harvest window in that crop year. */
function overlapsHarvestWindow(c: Contract, hw: HarvestWindow, cropYear: number): boolean {
  if (!c.deliveryStart && !c.deliveryEnd) return false;
  const windowStart = new Date(cropYear, hw.deliveryStartMonth - 1, hw.deliveryStartDay);
  const windowEnd = new Date(cropYear, hw.deliveryEndMonth - 1, hw.deliveryEndDay);
  windowEnd.setHours(23, 59, 59, 999);
  const delStart = c.deliveryStart ? new Date(c.deliveryStart) : new Date(c.deliveryEnd!);
  const delEnd = c.deliveryEnd ? new Date(c.deliveryEnd) : new Date(c.deliveryStart!);
  return delStart <= windowEnd && delEnd >= windowStart;
}

/** Whether the contract is for the harvest window's commodity: its group, or its description or code containing it. */
function matchesPacingCommodity(c: Contract, hwCommodity: string): boolean {
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

/**
 * The direction for the Harvest Contract Pace box. Mirrors the per-commodity logic in the Contract Pacing card: for
 * each active harvest window, the bushels whose delivery period overlaps the window this year against last year.
 * 'down' if ANY commodity is down, 'up' if at least one has data and none are down, 'flat' if there's commodity data
 * but no movement, 'none' if there's nothing to compare.
 */
export function harvestPace(contracts: readonly Contract[], harvestWindows: readonly HarvestWindow[], year: number): PaceDirection {
  const windows = harvestWindows.filter(hw => hw.isActive !== false);
  if (contracts.length === 0 || windows.length === 0) return 'none';

  let anyDown = false;
  let anyData = false;
  let anyMovement = false;
  for (const hw of windows) {
    let thisYear = 0;
    let lastYear = 0;
    for (const c of contracts) {
      if (!matchesPacingCommodity(c, hw.commodity)) continue;
      if (overlapsHarvestWindow(c, hw, year)) thisYear += c.quantity;
      if (overlapsHarvestWindow(c, hw, year - 1)) lastYear += c.quantity;
    }
    if (thisYear === 0 && lastYear === 0) continue;
    anyData = true;
    if (thisYear < lastYear) { anyDown = true; anyMovement = true; }
    else if (thisYear > lastYear) { anyMovement = true; }
  }
  if (!anyData) return 'none';
  if (anyDown) return 'down';
  return anyMovement ? 'up' : 'flat';
}

/**
 * Harvest Contract Pace in the profile's details row: an arrow for which way the producer's harvest contracting is
 * heading against last year. Clicking it opens and closes the Producer Insights panels, as their button does. Its
 * element takes no space, so it is a grid item of the details row.
 */
@Component({
  selector: 'app-contract-pace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  templateUrl: './contract-pace.component.html',
})
export class ContractPaceComponent {
  readonly panels = inject(ProducerInsightsPanels);
  private readonly appState = inject(AppStateService);
  private readonly activity = inject(SelectedProducerActivity);
  private readonly pacing = inject(ContractPacingHistoryStore);
  private readonly customer = inject(SelectedCustomerContext).customer;
  private readonly customerId = computed(() => this.customer()?.id ?? null);

  /** Non-null when the producer's contract read FAILED rather than returning nothing. */
  readonly contractsLoadError = this.activity.contractsLoadError;
  /** The producer's prior-year history could not be read. Pace compares this year against last, so with either read
   *  missing, "no contract data" would read as a producer who has contracted nothing. */
  readonly historyFailed = this.pacing.failedFor(this.customerId);
  /** The harvest windows failed to load. Pace is measured inside them, so with none the box would say "No contract
   *  data available" about a producer who may well have contracts. */
  readonly harvestWindowsUnavailable = computed(() =>
    this.appState.harvestWindowsLoadFailed() && this.appState.harvestWindows().length === 0);

  /** The calendar year: this year against last. */
  readonly year = new Date().getFullYear();
  readonly direction = computed(() => harvestPace(this.activity.contracts(), this.appState.harvestWindows(), this.year));
  readonly arrow = computed(() => {
    const d = this.direction();
    return d === 'up' ? '▲' : d === 'down' ? '▼' : '—';
  });
  /** Green when up, red when down, grey otherwise. */
  readonly boxClass = computed(() => {
    const d = this.direction();
    if (d === 'up') return 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400';
    if (d === 'down') return 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400';
    return 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400';
  });

  constructor() {
    effect(() => {
      const id = this.customerId();
      untracked(() => this.pacing.load(id));
    });
  }
}
