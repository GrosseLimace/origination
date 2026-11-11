import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DashboardPlantingEstimate } from '@models';
import { PermissionService } from '@core/access/permission.service';
import { SessionReset } from '@core/auth/session-reset.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { mergeYieldEstimates } from '../utils/production-reads';
import { ProducersApiService } from './producers-api.service';

/**
 * The selected trade units' yield estimates per crop and year, which project a producer's production from their
 * planting intentions. Each year is read once per trade-unit selection, when something asks for it: Producers' preload
 * for this year and last, and the selected producer's production for the years their profile offers. Read only for a
 * user who may read planting estimates; a failed year reads as none.
 */
@Injectable({ providedIn: 'root' })
export class YieldEstimateStore {
  private readonly api = inject(ProducersApiService);
  private readonly access = inject(PermissionService);
  private readonly tradeUnits = inject(TradeUnitContext);

  /** The trade units the estimates held are for, as a sorted key. */
  private key = '';
  private readonly byYear = new Map<number, DashboardPlantingEstimate[]>();
  private readonly requested = new Set<number>();
  private readonly _estimates = signal<DashboardPlantingEstimate[]>([]);
  private readonly _pending = signal(0);

  /** The estimates read so far for the trade units, one per crop and year. */
  readonly estimates = this._estimates.asReadonly();
  /** True while a read is running. */
  readonly isLoading = computed(() => this._pending() > 0);

  constructor() {
    inject(SessionReset).onReset(() => this.reset(''));
  }

  /** Reads the trade units' estimates for those of the years not read yet. A new selection of trade units drops what
   *  was read for the last one first. */
  load(years: readonly number[]): void {
    const key = [...this.tradeUnits.selectedTradeUnits()].sort().join(',');
    if (key !== this.key) this.reset(key);
    if (!key || !this.access.has('planting-estimates:read')) return;
    const missing = [...new Set(years)].filter(year => year > 0 && !this.requested.has(year));
    if (missing.length === 0) return;
    missing.forEach(year => this.requested.add(year));

    this._pending.update(n => n + 1);
    forkJoin(missing.map(year => this.api.getDashboardPlantingEstimates(key, year).pipe(
      catchError(() => of([] as DashboardPlantingEstimate[])),
    ))).subscribe(results => {
      this._pending.update(n => n - 1);
      // Read for trade units no longer selected: the new selection reads its own.
      if (key !== this.key) return;
      missing.forEach((year, i) => this.byYear.set(year, results[i]));
      this._estimates.set(mergeYieldEstimates([...this.byYear.values()]));
    });
  }

  private reset(key: string): void {
    this.key = key;
    this.byYear.clear();
    this.requested.clear();
    this._estimates.set([]);
  }
}
