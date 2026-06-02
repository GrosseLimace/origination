import { Injectable, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, merge, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, switchMap, take, tap } from 'rxjs/operators';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';
import { Customer, Contract, Ticket, Note, PlantingIntention, StoredGrain, SavedList, Commodity, CommodityConversion, HarvestWindow, DashboardSummary } from '@models';
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

    // Universal lookups — load once after sign-in regardless of trade-unit selection.
    // These drive features (delivery progress, commodity resolution) that work even when
    // no TU is selected, so they can't sit inside the TU-gated pipeline below.
    msalBroadcast.inProgress$.pipe(
      filter(s => s === InteractionStatus.None && msalService.instance.getAllAccounts().length > 0),
      take(1),
      switchMap(() => this.apiService.getCommodityConversions().pipe(
        catchError(() => of([] as CommodityConversion[]))
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(data => this.appState.commodityConversions.set(data));

    msalBroadcast.inProgress$.pipe(
      filter(s => s === InteractionStatus.None && msalService.instance.getAllAccounts().length > 0),
      take(1),
      switchMap(() => tuChanges$),
      switchMap(tradeUnits => {
        if (tradeUnits.length === 0) {
          this.appState.setDataLoading(false);
          this.appState.customersLoading.set(false);
          this.appState.contractsLoading.set(false);
          this.appState.todaysTicketsLoading.set(false);
          return of(null);
        }

        this.appState.setDataLoading(true);
        // Per-dataset flags — each flips false in its own tap below, so screens/categories
        // render as soon as their data lands rather than waiting on the slowest core query.
        this.appState.customersLoading.set(true);
        this.appState.contractsLoading.set(true);
        this.appState.todaysTicketsLoading.set(true);
        this.appState.clearDashboardCache();
        this.appState.clearPreloadedDashboardSummary();

        // Core group — dataLoading clears when all three are ready so that
        // Unconfirmed Contracts, Spot Loads, and Unshipped Bushels all appear
        // simultaneously. todaysTickets$ is a fast query (today's date filter)
        // and resolves in roughly the same time as customers + contracts.
        // The full ticket set IS also pre-loaded (tickets$ below) but in the
        // background — it can take minutes against the slow ODS view and must
        // not block the dataLoading signal.
        let coreArrived = { customers: false, contracts: false, todaysTickets: false };

        const customers$ = this.apiService.getCustomers(tradeUnits).pipe(
          catchError(() => of([] as Customer[])),
          tap(data => {
            this.appState.setCustomers(data);
            this.appState.customersLoading.set(false);
            coreArrived.customers = true;
            if (coreArrived.contracts && coreArrived.todaysTickets) this.appState.setDataLoading(false);
          })
        );
        const contracts$ = this.apiService.getContracts(tradeUnits).pipe(
          catchError(() => of([] as Contract[])),
          tap(data => {
            this.appState.setContracts(data);
            this.appState.contractsLoading.set(false);
            coreArrived.contracts = true;
            if (coreArrived.customers && coreArrived.todaysTickets) this.appState.setDataLoading(false);
          })
        );
        const todaysTickets$ = this.apiService.getTodaysTickets(tradeUnits).pipe(
          catchError(() => of([] as Ticket[])),
          tap(data => {
            this.appState.setTodaysTickets(data);
            this.appState.todaysTicketsLoading.set(false);
            coreArrived.todaysTickets = true;
            if (coreArrived.customers && coreArrived.contracts) this.appState.setDataLoading(false);
          })
        );
        // Bulk tickets load — fires in the background after the page is already interactive.
        // The full ticket set against vw_CurrentTickets is slow (minutes for some TUs) because
        // the view doesn't seek on ContractNumber; per-customer queries against it have an even
        // worse plan, so a single background scan that fills appState is the practical answer
        // until a local synced ticket table replaces this. The home page reads from appState
        // for applied-tickets-per-contract once this lands.
        const tickets$ = this.apiService.getTickets(tradeUnits).pipe(
          catchError(() => of([] as Ticket[])),
          tap(data => {
            this.appState.setTickets(data);
          })
        );
        const notes$ = this.apiService.getNotes().pipe(
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
        const harvestWindows$ = this.apiService.getHarvestWindows().pipe(
          catchError(() => of([] as HarvestWindow[])),
          tap(data => {
            this.appState.harvestWindows.set(data);
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

        return merge(customers$, contracts$, todaysTickets$, tickets$, notes$, plantingIntentions$, storedGrain$, savedLists$, commodities$, harvestWindows$, producerDetails$, dashboardSummary$);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }
}
