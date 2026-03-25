import { Injectable, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, merge, of, ReplaySubject } from 'rxjs';
import { catchError, distinctUntilChanged, filter, switchMap, take, tap } from 'rxjs/operators';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';
import { Customer, Contract, Ticket, Note, PlantingIntention, StoredGrain, SavedList, Commodity, DashboardSummary } from '@models';
import { ProducerDetails } from '../../models/producer-details.model';

@Injectable({ providedIn: 'root' })
export class DataPreloadService {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _forceReload$ = new Subject<string[]>();

  /** In-flight ticket pre-load — non-null while loading, survives component navigation. */
  private _ticketPreload$: ReplaySubject<void> | null = null;

  /**
   * Ensures tickets are loaded into AppState. If already loaded, resolves immediately.
   * If a load is already in flight (e.g. started before navigating away), subscribes to
   * the existing one instead of starting a duplicate request.
   */
  ensureTicketsLoaded(tradeUnits: string[]): ReplaySubject<void> {
    if (this.appState.tickets().length > 0) {
      const done = new ReplaySubject<void>(1);
      done.next();
      done.complete();
      return done;
    }
    if (this._ticketPreload$) return this._ticketPreload$;

    this._ticketPreload$ = new ReplaySubject<void>(1);
    const tuParam = tradeUnits.length > 0 ? tradeUnits : undefined;
    this.apiService.getTickets(tuParam).pipe(
      catchError(() => of([] as import('@models').Ticket[])),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(tickets => {
      this.appState.setTickets(tickets);
      this._ticketPreload$!.next();
      this._ticketPreload$!.complete();
      this._ticketPreload$ = null;
    });
    return this._ticketPreload$;
  }

  /** Re-run the full data load with the current trade units, cancelling any in-progress load. */
  forceReload(): void {
    const tradeUnits = this.appState.selectedTradeUnits();
    if (tradeUnits.length === 0) return;
    this._forceReload$.next(tradeUnits);
  }

  constructor() {
    const msalBroadcast = inject(MsalBroadcastService);
    const msalService = inject(MsalService);

    const tuChanges$ = merge(
      toObservable(this.appState.selectedTradeUnits).pipe(
        distinctUntilChanged((a, b) => [...a].sort().join(',') === [...b].sort().join(','))
      ),
      this._forceReload$
    );

    msalBroadcast.inProgress$.pipe(
      filter(s => s === InteractionStatus.None && msalService.instance.getAllAccounts().length > 0),
      take(1),
      switchMap(() => tuChanges$),
      switchMap(tradeUnits => {
        if (tradeUnits.length === 0) {
          this.appState.setDataLoading(false);
          return of(null);
        }

        this.appState.setDataLoading(true);
        this.appState.clearInsightsCache();
        this.appState.clearDashboardCache();
        this.appState.clearPreloadedDashboardSummary();

        // Pre-wire _ticketPreload$ to this load cycle so ensureTicketsLoaded()
        // callers share this load's result instead of spawning a duplicate HTTP call.
        // A duplicate concurrent getTickets() against the same slow ODS view causes
        // DB contention and race conditions (one call may return empty and overwrite
        // good data from the other).
        if (!this._ticketPreload$) {
          this._ticketPreload$ = new ReplaySubject<void>(1);
        }

        // Core group — each result streams into AppState as it arrives.
        // dataLoading clears when customers + contracts are ready (enough for
        // Insights to render Unconfirmed Contracts & Unshipped Bushels).
        // Spot Loads populate when tickets + notes arrive shortly after.
        let coreArrived = { customers: false, contracts: false };

        const customers$ = this.apiService.getCustomers(tradeUnits).pipe(
          catchError(() => of([] as Customer[])),
          tap(data => {
            this.appState.setCustomers(data);
            coreArrived.customers = true;
            if (coreArrived.contracts) this.appState.setDataLoading(false);
          })
        );
        const contracts$ = this.apiService.getContracts(tradeUnits).pipe(
          catchError(() => of([] as Contract[])),
          tap(data => {
            this.appState.setContracts(data);
            coreArrived.contracts = true;
            if (coreArrived.customers) this.appState.setDataLoading(false);
          })
        );
        const tickets$ = this.apiService.getTickets(tradeUnits).pipe(
          catchError(() => of([] as Ticket[])),
          tap(data => {
            this.appState.setTickets(data);
            // Resolve any ensureTicketsLoaded() waiters — they share this load.
            if (this._ticketPreload$) {
              this._ticketPreload$.next();
              this._ticketPreload$.complete();
              this._ticketPreload$ = null;
            }
          })
        );
        const notes$ = this.apiService.getNotes(tradeUnits).pipe(
          catchError(() => of([] as Note[])),
          tap(data => {
            this.appState.setNotes(data);
          })
        );

        // Secondary group — each result streams into AppState as it arrives.
        // Using merge (not forkJoin) so fast calls like getCommodities don't wait
        // for slower calls like getPlantingIntentions to complete.
        const plantingIntentions$ = this.apiService.getPlantingIntentions(tradeUnits).pipe(
          catchError(() => of([] as PlantingIntention[])),
          tap(data => {
            this.appState.setPlantingIntentions(data);
          })
        );
        const storedGrain$ = this.apiService.getStoredGrain(tradeUnits).pipe(
          catchError(() => of([] as StoredGrain[])),
          tap(data => {
            this.appState.setStoredGrain(data);
          })
        );
        const savedLists$ = this.apiService.getSavedLists().pipe(
          catchError(() => of([] as SavedList[])),
          tap(data => {
            this.appState.setSavedLists(data);
          })
        );
        const commodities$ = this.apiService.getCommodities().pipe(
          catchError(() => of([] as Commodity[])),
          tap(data => {
            this.appState.setCommodities(data);
          })
        );
        const producerDetails$ = this.apiService.getAllProducerDetails().pipe(
          catchError(() => of([] as ProducerDetails[])),
          tap(data => {
            this.appState.setProducerDetails(data);
          })
        );

        // Pre-fetch dashboard summary for the current year so the Dashboard page
        // renders immediately when the user navigates to it (no extra API round-trip).
        const tuKey = [...tradeUnits].sort().join(',');
        const currentYear = new Date().getFullYear();
        const emptySummary: DashboardSummary = { estimates: [], marketShares: [], actualHarvest: [] };
        const dashboardSummary$ = this.apiService.getDashboardSummary(tuKey, currentYear).pipe(
          catchError(() => of(emptySummary)),
          tap(summary => {
            this.appState.setPreloadedDashboardSummary(tuKey, currentYear, summary);
          })
        );

        return merge(customers$, contracts$, tickets$, notes$, plantingIntentions$, storedGrain$, savedLists$, commodities$, producerDetails$, dashboardSummary$);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }
}
