import { Injectable, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, merge, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, switchMap, take, tap } from 'rxjs/operators';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';
import { Customer, Contract, Ticket, Note, PlantingIntention, StoredGrain, SavedList, Commodity } from '@models';
import { ProducerDetails } from '../../models/producer-details.model';

@Injectable({ providedIn: 'root' })
export class DataPreloadService {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _forceReload$ = new Subject<string[]>();

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

        return merge(customers$, contracts$, tickets$, notes$, plantingIntentions$, storedGrain$, savedLists$, commodities$, producerDetails$);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }
}
