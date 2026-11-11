import { Injectable, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, merge, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, switchMap, take, tap } from 'rxjs/operators';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { Commodity, CommodityConversion, HarvestWindow } from '@models';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { ModuleRegistry } from '@core/modules/module-registry';

@Injectable({ providedIn: 'root' })
export class DataPreloadService {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly tradeUnitContext = inject(TradeUnitContext);
  private readonly moduleRegistry = inject(ModuleRegistry);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _forceReload$ = new Subject<string[]>();

  /** Re-run the full data load with the current trade units, cancelling any in-progress load. */
  forceReload(): void {
    const tradeUnits = this.tradeUnitContext.selectedTradeUnits();
    if (tradeUnits.length === 0) return;
    this._forceReload$.next(tradeUnits);
  }

  constructor() {
    const msalBroadcast = inject(MsalBroadcastService);
    const msalService = inject(MsalService);

    const tuChanges$ = merge(
      toObservable(this.tradeUnitContext.selectedTradeUnits).pipe(
        distinctUntilChanged((a, b) => [...a].sort().join(',') === [...b].sort().join(','))
      ),
      this._forceReload$
    );

    // Universal lookups — load once after sign-in regardless of trade-unit selection.
    // These drive features (delivery progress, commodity resolution) that work even when
    // no TU is selected, so they can't sit inside the TU-gated pipeline below.
    msalBroadcast.inProgress$.pipe(
      filter(s => s === InteractionStatus.None && msalService.instance.getAllAccounts().length > 0),
      take(1),
      switchMap(() => this.apiService.getCommodityConversions().pipe(
        // Loaded once per sign-in, so a failure lasts the session: record it rather than let every
        // non-bushel contract silently drop out of the bushel totals.
        tap(() => this.appState.setCommodityConversionsLoadFailed(false)),
        catchError(() => { this.appState.setCommodityConversionsLoadFailed(true); return of([] as CommodityConversion[]); }),
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(data => this.appState.setCommodityConversions(data));

    msalBroadcast.inProgress$.pipe(
      filter(s => s === InteractionStatus.None && msalService.instance.getAllAccounts().length > 0),
      take(1),
      switchMap(() => tuChanges$),
      switchMap(tradeUnits => {
        if (tradeUnits.length === 0) return of(null);

        // A new trade-unit load: the last one's failures no longer describe anything. The modules' preloads (below)
        // keep their own loading flags and failures: the customers', the contracts' and today's tickets', the trade
        // units' planting and DP, and the last-contact summary's and the user's follow-ups'.
        this.appState.clearLoadFailures();

        // Secondary group — each result streams into AppState as it arrives.
        // Using merge (not forkJoin) so fast calls like getCommodities don't wait
        // for slower ones.
        const commodities$ = this.apiService.getCommodities().pipe(
          catchError(() => of([] as Commodity[])),
          tap(data => {
            this.appState.setCommodities(data);
          })
        );
        const harvestWindows$ = this.apiService.getHarvestWindows().pipe(
          tap(() => this.appState.setHarvestWindowsLoadFailed(false)),
          catchError(() => { this.appState.setHarvestWindowsLoadFailed(true); return of([] as HarvestWindow[]); }),
          tap(data => {
            this.appState.setHarvestWindows(data);
          })
        );
        // Each module's own preload (the trade unit's customers; their contracts and today's tickets; Producers'
        // dashboard summary, every producer's details, and the trade units' planting, stored grain, DP and yield
        // estimates; Engagement's last-contact summary and the user's follow-ups; Lists' saved lists), cancelled with
        // the rest by the next trade-unit change.
        const modulePreloads = this.moduleRegistry.preloads(tradeUnits);

        return merge(commodities$, harvestWindows$, ...modulePreloads);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }
}
