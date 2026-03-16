import { Injectable, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, switchMap, take } from 'rxjs/operators';
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

        return forkJoin({
          customers: this.apiService.getCustomers(tradeUnits).pipe(catchError(() => of([] as Customer[]))),
          contracts: this.apiService.getContracts(tradeUnits).pipe(catchError(() => of([] as Contract[]))),
          tickets: this.apiService.getTickets(tradeUnits).pipe(catchError(() => of([] as Ticket[]))),
          notes: this.apiService.getNotes().pipe(catchError(() => of([] as Note[]))),
          plantingIntentions: this.apiService.getPlantingIntentions().pipe(catchError(() => of([] as PlantingIntention[]))),
          storedGrain: this.apiService.getStoredGrain().pipe(catchError(() => of([] as StoredGrain[]))),
          savedLists: this.apiService.getSavedLists().pipe(catchError(() => of([] as SavedList[]))),
          commodities: this.apiService.getCommodities().pipe(catchError(() => of([] as Commodity[]))),
          producerDetails: this.apiService.getAllProducerDetails().pipe(catchError(() => of([] as ProducerDetails[])))
        });
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (!result) return;
      this.appState.setCustomers(result.customers);
      this.appState.setContracts(result.contracts);
      this.appState.setTickets(result.tickets);
      this.appState.setNotes(result.notes);
      this.appState.setPlantingIntentions(result.plantingIntentions);
      this.appState.setStoredGrain(result.storedGrain);
      this.appState.setSavedLists(result.savedLists);
      this.appState.setCommodities(result.commodities);
      this.appState.setProducerDetails(result.producerDetails);
      this.appState.setDataLoading(false);
    });
  }
}
