import { Injectable, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, merge, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, switchMap, take, tap, timeout } from 'rxjs/operators';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';
import { Customer, Contract, Ticket, NoteLastContact, ReminderDue, PlantingIntention, StoredGrain, DpContract, SavedList, Commodity, CommodityConversion, HarvestWindow, DashboardSummary } from '@models';
import { ProducerDetails } from '../../models/producer-details.model';
import { environment } from '@env/environment';

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
        this.appState.contractsLoadFailed.set(false);
        this.appState.ticketsLoadFailed.set(false);
        this.appState.todaysTicketsLoading.set(true);
        this.appState.clearDashboardCache();
        this.appState.clearPreloadedDashboardSummary();
        // The TU-wide ticket set is no longer eagerly bulk-loaded — it's lazily fetched by the
        // list/NLQ consumers (customer-list, build-list) when a ticket query needs it. Clear it on
        // TU change so those consumers re-fetch for the new TU instead of reusing the prior TU's set.
        this.appState.clearTicketsCache();
        // Same for the full note set: NLQ/saved-list consumers fetch it lazily when a note
        // query needs it. Badges use the noteLastContacts aggregate below instead.
        this.appState.clearNotesCache();
        // DP too: it IS preloaded below, but the loaded flag must drop first or a DP query fired
        // between the TU change and the preload landing would run against the prior TU's rows.
        this.appState.clearDpContractsCache();

        // Core group — dataLoading clears when all three are ready so that
        // Unconfirmed Contracts, Spot Loads, and Unshipped Bushels all appear
        // simultaneously. todaysTickets$ is a fast query (today's date filter)
        // and resolves in roughly the same time as customers + contracts.
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
          // Cleared HERE, ahead of the catchError, so only a real emission clears it. Doing it inside
          // setContracts meant the [] fallback below cleared the flag the catchError had just set.
          tap(() => this.appState.setContractsLoadFailed(false)),
          // Still resolves to [] so the rest of the page loads, but the failure is RECORDED - otherwise
          // every contract-based prompt reports "no producers found" for what is actually an outage.
          catchError(() => { this.appState.setContractsLoadFailed(true); return of([] as Contract[]); }),
          tap(data => {
            this.appState.setContracts(data);
            this.appState.contractsLoading.set(false);
            coreArrived.contracts = true;
            if (coreArrived.customers && coreArrived.todaysTickets) this.appState.setDataLoading(false);
          })
        );
        const todaysTickets$ = this.apiService.getTodaysTickets(tradeUnits).pipe(
          // Above the honest cold time for this read (measured 3-5s, and the server now serves it
          // stale-while-revalidate so a caller should rarely wait at all), but bounded so the Spot Loads
          // skeleton cannot spin forever if the gateway stalls.
          timeout(60000),
          tap(() => {
            this.appState.setTicketsLoadFailed(false);
            this.appState.setSourceLoadPending(false);
          }),
          // A TIMEOUT is not a failure: the server keeps working and caches the result, so a retry shortly
          // after succeeds. Saying "could not be loaded from CTRM" for it would be false - same distinction
          // the trade-unit ticket read makes in build-list.
          catchError((err) => {
            if (err?.name === 'TimeoutError') this.appState.setSourceLoadPending(true);
            else this.appState.setTicketsLoadFailed(true);
            return of([] as Ticket[]);
          }),
          tap(data => {
            this.appState.setTodaysTickets(data);
            this.appState.todaysTicketsLoading.set(false);
            coreArrived.todaysTickets = true;
            if (coreArrived.customers && coreArrived.contracts) this.appState.setDataLoading(false);
          })
        );
        // Last-contact aggregate instead of the full note download: tiny rows (one per
        // customer with notes, all trade units) that feed the list badges. Full note
        // bodies load per-producer on selection or lazily for NLQ.
        const notes$ = this.apiService.getNotesLastContact().pipe(
          catchError(() => of([] as NoteLastContact[])),
          tap(data => {
            this.appState.setNoteLastContacts(data);
          })
        );

        // The signed-in user's own open follow-ups — the same shape of feed as the last-contact
        // aggregate above and just as cheap, so the reminder badge is ready with the list rather
        // than popping in later. Skipped entirely while the feature is flagged off, so a build
        // without calendar consent makes no reminder calls at all.
        const reminders$ = environment.remindersEnabled
          ? this.apiService.getMyReminders().pipe(
              catchError(() => of([] as ReminderDue[])),
              tap(data => {
                this.appState.setMyReminders(data);
              })
            )
          : of([] as ReminderDue[]);

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
        const dpContracts$ = this.apiService.getDpContracts(tradeUnits).pipe(
          catchError(() => of([] as DpContract[])),
          tap(data => {
            this.appState.setDpContracts(data);
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

        return merge(customers$, contracts$, todaysTickets$, notes$, reminders$, plantingIntentions$, storedGrain$, dpContracts$, savedLists$, commodities$, harvestWindows$, producerDetails$, dashboardSummary$);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }
}
