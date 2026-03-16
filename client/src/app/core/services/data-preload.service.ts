import { Injectable, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, merge, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, switchMap, take, tap } from 'rxjs/operators';
import { MsalBroadcastService } from '@azure/msal-angular';
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

  constructor() {
    const msalBroadcast = inject(MsalBroadcastService);

    // Build the TU-change stream in the injection context (required for toObservable)
    const tuChanges$ = toObservable(this.appState.selectedTradeUnits).pipe(
      distinctUntilChanged((a, b) => [...a].sort().join(',') === [...b].sort().join(','))
    );

    // Wait for MSAL to confirm auth is complete before making any API calls.
    // inProgress$ is a BehaviorSubject so it replays the current status immediately —
    // if auth is already done (None), the preload starts right away.
    msalBroadcast.inProgress$.pipe(
      filter(s => s === InteractionStatus.None),
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

        // Core group — customers/contracts/tickets/notes are all that Insights and the home
        // page need. Clear the loading flag as soon as these four arrive so those screens
        // can render without waiting for the slower secondary group.
        const core$ = forkJoin({
          customers: this.apiService.getCustomers(tradeUnits).pipe(catchError(() => of([] as Customer[]))),
          contracts: this.apiService.getContracts(tradeUnits).pipe(catchError(() => of([] as Contract[]))),
          tickets: this.apiService.getTickets(tradeUnits).pipe(catchError(() => of([] as Ticket[]))),
          notes: this.apiService.getNotes().pipe(catchError(() => of([] as Note[]))),
        }).pipe(tap(core => {
          this.appState.setCustomers(core.customers);
          this.appState.setContracts(core.contracts);
          this.appState.setTickets(core.tickets);
          this.appState.setNotes(core.notes);
          this.appState.setDataLoading(false);
        }));

        // Secondary group — needed by Dashboard, Build a List, etc. Runs in parallel with
        // core but does not block the dataLoading flag.
        const secondary$ = forkJoin({
          plantingIntentions: this.apiService.getPlantingIntentions().pipe(catchError(() => of([] as PlantingIntention[]))),
          storedGrain: this.apiService.getStoredGrain().pipe(catchError(() => of([] as StoredGrain[]))),
          savedLists: this.apiService.getSavedLists().pipe(catchError(() => of([] as SavedList[]))),
          commodities: this.apiService.getCommodities().pipe(catchError(() => of([] as Commodity[]))),
          producerDetails: this.apiService.getAllProducerDetails().pipe(catchError(() => of([] as ProducerDetails[]))),
        }).pipe(tap(sec => {
          this.appState.setPlantingIntentions(sec.plantingIntentions);
          this.appState.setStoredGrain(sec.storedGrain);
          this.appState.setSavedLists(sec.savedLists);
          this.appState.setCommodities(sec.commodities);
          this.appState.setProducerDetails(sec.producerDetails);
        }));

        return merge(core$, secondary$);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }
}
