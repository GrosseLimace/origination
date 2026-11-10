import { ChangeDetectionStrategy, Component, inject, signal, computed, DestroyRef, effect, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { applyAdoptedCustomerId } from './adopt-assigned-customer';
import { applyProducerDetails } from '@shared/utils/apply-producer-details';
import { catchError, finalize, takeUntil } from 'rxjs/operators';
import { alreadyShown } from '@core/http/shown-errors';
import { ApiService } from '@core/services/api.service';
import { CustomerStore } from '../../data-access/customer.store';
import { CustomersApiService } from '../../data-access/customers-api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, ProducerDetails, DashboardPlantingEstimate } from '@models';
import { CustomerListComponent } from '../../components/customer-list/customer-list.component';
import { CustomerProfileComponent } from '../../components/customer-profile/customer-profile.component';
import { CustomerSlotComponent } from '@core/modules/customer-slot.component';
import { CalculatorLauncherComponent } from '@features/calculators';
import { environment } from '@env/environment';
import {
  commodityCodesFrom, linkedGroupOf, mergeIncomingById, mergeYieldEstimates,
  yieldEstimateYears
} from './home-derivations';
import { HomeBackgroundFailures } from './home-background-failures';
import { HomePageState } from './home-page.state';
import { homeScreenSource } from './home-screen-source';
import { HomeEngagement } from './home-engagement';
import { HomeRemindersStore } from './home-reminders.store';
import { HomeNotesStore } from './home-notes.store';
import { HomeSavedListsStore } from './home-saved-lists.store';
import { HomeLinkedProducersStore } from './home-linked-producers.store';
import { HomePlantingStore } from './home-planting.store';
import { HomeProducerActivityStore } from './home-producer-activity.store';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { CUSTOMER_SCREEN_SOURCE, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { SelectedProducerEngagement } from '@core/context/selected-producer-engagement';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CustomerListComponent,
    CustomerProfileComponent,
    CustomerSlotComponent,
    CalculatorLauncherComponent
  ],
  templateUrl: './home.component.html',
  // Page-scoped state and behaviour, one instance per visit to the page. SelectedCustomerContext is the customer
  // the page shows, and SelectedProducerActivity their contracts, tickets and pricing, for the panels and tabs the
  // modules add to it.
  providers: [
    HomePageState, HomeBackgroundFailures, HomeRemindersStore, HomeNotesStore, HomeSavedListsStore, HomeLinkedProducersStore,
    HomePlantingStore, HomeProducerActivityStore, SelectedCustomerContext,
    { provide: SelectedProducerActivity, useExisting: HomeProducerActivityStore },
    HomeEngagement,
    { provide: SelectedProducerEngagement, useExisting: HomeEngagement },
    { provide: CUSTOMER_SCREEN_SOURCE, useFactory: homeScreenSource },
  ],
  // The template reads only signals, computeds, getLinkedGroup() (which reads signals) and two
  // constant flags, and every async writer (API callbacks, effects, the resize listener, the
  // deep-link poll) writes signals - home.component.render.spec.ts renders each of those paths.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly customerStore = inject(CustomerStore);
  private readonly customersApi = inject(CustomersApiService);
  private readonly tradeUnitContext = inject(TradeUnitContext);
  private readonly toastService = inject(ToastService);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly destroyRef = inject(DestroyRef);

  /** Throttled toast + dev log for background loads that fail (see HomeBackgroundFailures). */
  private readonly backgroundFailures = inject(HomeBackgroundFailures);
  /** Signals shared with the page-scoped stores (see HomePageState). */
  private readonly page = inject(HomePageState);
  /** Personal follow-up reminders (see HomeRemindersStore). */
  private readonly reminders = inject(HomeRemindersStore);
  /** Notes cache, notes panel and last-contact badge feed (see HomeNotesStore). */
  private readonly notes = inject(HomeNotesStore);
  /** Own and team saved lists, their resolution and Add-to-List saves (see HomeSavedListsStore). */
  private readonly lists = inject(HomeSavedListsStore);
  /** Cross-trade-unit linked producers and the walk that fetches them (see HomeLinkedProducersStore). */
  private readonly linked = inject(HomeLinkedProducersStore);
  /** The selected producer's planting intentions and their handlers (see HomePlantingStore). */
  private readonly planting = inject(HomePlantingStore);
  /** The selected producer's contracts, tickets, pricing, stored grain and DP (see HomeProducerActivityStore). */
  private readonly activity = inject(HomeProducerActivityStore);

  /** Enables the "Team Lists" tab in the Add-to-List dropdown (see HomeSavedListsStore). */
  readonly canEditTeamLists = this.lists.canEditTeamLists;
  /** Gates the floating calculator launcher (Profitability calc + future calculators). */
  readonly calculatorEnabled = environment.calculatorEnabled;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _resizeHandler = () => this._checkMobile();
  private _isLoading = false;
  private _customerRequestId = 0;
  /** Cancels the prior selection's in-flight requests (see HomePageState.cancelSelection$). */
  private readonly _cancelSelection$ = this.page.cancelSelection$;
  /** How long a trade-unit save runs before the page says it is still working. */
  static readonly SLOW_TRADE_UNIT_SAVE_MS = 15_000;


  // Public signals — template binds directly to these
  readonly customers = this.page.customers;
  readonly contracts = this.page.contracts;
  readonly tickets = this.page.tickets;
  readonly plantingIntentions = this.page.plantingIntentions;
  /** Per-customer "last contacted" aggregate, all trade units — the list's badge feed (see HomeNotesStore). */
  readonly noteLastContacts = this.notes.noteLastContacts;
  /** The signed-in user's own open follow-ups across all producers (see HomeRemindersStore). */
  readonly myReminders = this.reminders.myReminders;
  readonly storedGrain = this.page.storedGrain;
  readonly dpContracts = this.page.dpContracts;
  /** The user's own lists and a manager's team lists, resolved (see HomeSavedListsStore). */
  readonly savedLists = this.lists.savedLists;
  readonly teamSavedLists = this.lists.teamSavedLists;
  readonly producerDetailsMap = this.page.producerDetailsMap;

  readonly selectedCustomer = this.page.selectedCustomer;
  /** True when the open-contracts table has its extra columns expanded — drops the Notes
   *  sidebar below the profile so the table gets the full page width. */
  readonly contractsWide = signal(false);
  /** Where a deep link asked the profile to open (see HomePageState); the screen's pieces read it through SelectedCustomerContext. */
  readonly pendingContractId = this.page.pendingContractId;
  readonly pendingTab = this.page.pendingTab;
  readonly pendingPlantingYear = this.page.pendingPlantingYear;
  readonly pendingTicketCrop = this.page.pendingTicketCrop;
  readonly selectedTradeUnits = this.page.selectedTradeUnits;
  /** The own and team lists the selected producer can be quick-added to from the profile header. */
  readonly savedListsForSelectedCustomer = this.lists.savedListsForSelectedCustomer;
  readonly teamListsForSelectedCustomer = this.lists.teamListsForSelectedCustomer;
  /** The selected producer's contracts, tickets, pricing lines, stored grain and DP contracts, with their loading and
   *  error state (see HomeProducerActivityStore). */
  readonly customerContracts = this.activity.customerContracts;
  readonly customerTickets = this.activity.customerTickets;
  readonly customerPricingLines = this.activity.customerPricingLines;
  readonly customerCodeMap = this.activity.customerCodeMap;
  readonly customerStoredGrain = this.activity.customerStoredGrain;
  readonly customerDpContracts = this.activity.customerDpContracts;
  readonly allCustomerContracts = this.activity.allCustomerContracts;
  readonly allCustomerTickets = this.activity.allCustomerTickets;
  readonly allCustomerStoredGrain = this.activity.allCustomerStoredGrain;
  readonly allCustomerDpContracts = this.activity.allCustomerDpContracts;
  readonly isLoadingContracts = this.activity.isLoadingContracts;
  readonly contractsLoadError = this.activity.contractsLoadError;
  readonly isLoadingUnappliedTickets = this.activity.isLoadingUnappliedTickets;
  readonly ticketsLoadError = this.activity.ticketsLoadError;
  readonly pricingLinesLoadError = this.activity.pricingLinesLoadError;
  readonly isLoadingPricingLines = this.activity.isLoadingPricingLines;
  readonly isLoadingStoredGrain = this.activity.isLoadingStoredGrain;
  readonly isLoadingDpContracts = this.activity.isLoadingDpContracts;
  /** The selected producer's notes panel and the note form's state (see HomeNotesStore). */
  readonly customerNotes = this.notes.customerNotes;
  readonly isLoadingNotes = this.notes.isLoadingNotes;
  readonly isSavingNote = this.notes.isSavingNote;

  /** Producer ids whose trade-unit save (PUT .../trade-units) is still running. */
  private readonly _tradeUnitSavesInFlight = signal<ReadonlySet<number>>(new Set());
  /** The selected producer's trade-unit save is still running - the edit dialog keeps Save off meanwhile. */
  readonly isSavingTradeUnits = computed(() => {
    const sel = this.selectedCustomer();
    return !!sel && this._tradeUnitSavesInFlight().has(sel.id);
  });
  readonly noteSaveSucceededCounter = this.notes.noteSaveSucceededCounter;
  /** The selected producer's follow-ups and the reminder card's state (see HomeRemindersStore). */
  readonly customerReminders = this.reminders.customerReminders;
  readonly isLoadingReminders = this.reminders.isLoadingReminders;
  readonly isSavingReminder = this.reminders.isSavingReminder;
  readonly reminderSaveSucceededCounter = this.reminders.reminderSaveSucceededCounter;
  /** The selected producer's planting intentions (see HomePlantingStore). */
  readonly customerPlantingIntentions = this.planting.customerPlantingIntentions;

  readonly allCustomerPlantingIntentions = this.planting.allCustomerPlantingIntentions;

  readonly yieldEstimates = signal<DashboardPlantingEstimate[]>([]);
  readonly isLoadingYieldData = signal(false);
  readonly isLoadingPlanting = signal(true);

  readonly isMobile = signal(false);
  readonly loading = signal(false);



  private _pendingProducerDetails: ProducerDetails[] | null = null;
  // Customers fetched from outside the current trade unit filter (e.g. linked producers in other TUs)
  private readonly _crossTradeUnitCustomers = this.linked.crossTradeUnitCustomersById;
  /** Flat array of the cross-TU/linked producers (see HomeLinkedProducersStore). */
  readonly crossTradeUnitCustomers = this.linked.crossTradeUnitCustomers;

  // Track last trade unit key to avoid duplicate loads triggered by the effect
  private _lastTradeUnitKey = '';
  private _initialized = false;

  constructor() {
    this._checkMobile();
    window.addEventListener('resize', this._resizeHandler);
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', this._resizeHandler));

    this._restoreStateFromService();
    this._loadProducerDetails();

    // Only fetch from API if appState has no cached customers — otherwise use the cache.
    // This prevents a full reload every time the user navigates back from another page.
    if (this.customerStore.customers().length === 0) {
      this._loadAllData(this.selectedTradeUnits());
    }
    this._lastTradeUnitKey = [...this.selectedTradeUnits()].sort().join(',');
    this._initialized = true;

    // Keep the last-contact aggregate in sync with appState — handles the case where the
    // data-preload delivers it after _restoreStateFromService() already ran (restore path
    // skips _loadAllData so there is no subscription to pick up the arriving data).
    effect(() => {
      const rows = this.appState.noteLastContacts();
      untracked(() => this.noteLastContacts.set(rows));
    });

    // Same for the caller's own open follow-ups, which the preload delivers alongside it.
    effect(() => {
      const rows = this.appState.myReminders();
      untracked(() => this.myReminders.set(rows));
    });

    // React to global trade unit changes made via TradeUnitSelectorComponent
    effect(() => {
      const tradeUnits = this.tradeUnitContext.selectedTradeUnits();
      if (!this._initialized) return;
      const key = [...tradeUnits].sort().join(',');
      if (key === this._lastTradeUnitKey) return;
      this._lastTradeUnitKey = key;
      untracked(() => this._onTradeUnitsChanged(tradeUnits));
    });

    // (Re)load the team lists whenever the permissions load or the TU selection changes. Guarded
    // inside loadTeamLists, so a user without the team permissions or an empty selection clears the set.
    effect(() => {
      this.canEditTeamLists();
      this.selectedTradeUnits();
      untracked(() => this.lists.loadTeamLists());
    });

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const customerId = params['customerId'];
      if (customerId) {
        const contractId = params['contractId'];
        this.pendingContractId.set(contractId ? parseInt(contractId, 10) : null);
        this.pendingTab.set(params['tab'] ?? null);
        this.pendingTicketCrop.set(params['ticketCrop'] ?? null);
        const yearParam = params['year'];
        const yearNum = yearParam ? parseInt(yearParam, 10) : NaN;
        this.pendingPlantingYear.set(Number.isFinite(yearNum) && yearNum > 0 ? yearNum : null);
        this._selectCustomerById(customerId);
      }
    });
  }

  private _restoreStateFromService(): void {
    this.selectedTradeUnits.set(this.tradeUnitContext.selectedTradeUnits());

    const stateCustomers = this.customerStore.customers();
    if (stateCustomers.length > 0) {
      this.customers.set(stateCustomers);
      this.contracts.set(this.appState.contracts());
      // Tickets are loaded per-producer, not held TU-wide, so don't reseed from appState.tickets
      // (which is now only the lazy list/NLQ cache). The selected customer's tickets are re-fetched
      // below; selecting any producer re-fetches theirs.
      this.tickets.set([]);
      this.plantingIntentions.set(this.appState.plantingIntentions());
      this.isLoadingPlanting.set(false);
      this.noteLastContacts.set(this.appState.noteLastContacts());
      this.myReminders.set(this.appState.myReminders());
      this.storedGrain.set(this.appState.storedGrain());
      this.dpContracts.set(this.appState.dpContracts());
      this.savedLists.set(this.appState.savedLists());
      this.lists.enrichSavedLists();

      // Stored grain may not have been preloaded yet — fetch if empty
      if (this.appState.storedGrain().length === 0) {
        this.apiService.getStoredGrain().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (data) => {
            this.storedGrain.set(data);
            this.appState.setStoredGrain(data);
          },
          error: (err) => this.backgroundFailures.report('load stored grain', err)
        });
      }

      // Same for DP contracts — the preload may not have landed yet. Gate on the loaded flag, not
      // length: a per-producer merge can leave rows present without a TU-wide load having happened,
      // and a TU with genuinely zero DP would otherwise re-fetch on every pass.
      if (!this.appState.dpContractsLoaded()) {
        this.apiService.getDpContracts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (data) => {
            this.dpContracts.set(data);
            this.appState.setDpContracts(data);
          },
          error: (err) => this.backgroundFailures.report('load DP contracts', err)
        });
      }

      const stateSelectedCustomer = this.appState.selectedCustomer();
      if (stateSelectedCustomer) {
        this.selectedCustomer.set(stateSelectedCustomer);
        this.customerPricingLines.set(this.appState.pricingLines());
        // Re-fetch this producer's tickets — they're no longer pre-loaded in appState.
        this.isLoadingUnappliedTickets.set(true);
        this.activity.loadCustomerData(stateSelectedCustomer.id);
        this.activity.loadCustomerTickets(stateSelectedCustomer.id, stateSelectedCustomer.scoularId);
        // Re-fetch the producer's (and linked group's) notes — the per-customer notes
        // cache is component-local, so navigation back must repopulate it (same pattern
        // as the tickets / planting re-fetch on restore).
        this.notes.startSelection();
        this._ensureCustomerNotes(stateSelectedCustomer);
        // Re-fetch per-customer planting intentions on navigation back —
        // these are not stored in appState so they must be reloaded.
        this.planting.loadWithoutCache(stateSelectedCustomer.id);
      }
      // Reload yield estimates — not stored in appState so
      // they are lost on navigation away and must be re-fetched on return.
      this._loadYieldData();
    }
  }

  private _checkMobile(): void {
    this.isMobile.set(window.innerWidth < 1024);
  }

  private _selectCustomerById(customerId: string): void {
    const customerIdNum = parseInt(customerId, 10);
    const customer = this.customers().find(c => c.id === customerIdNum);
    if (customer) {
      this.handleSelectCustomer(customer, true); // fromDeepLink=true, preserve pending state
    } else {
      const checkInterval = setInterval(() => {
        const c = this.customers().find(cust => cust.id === customerIdNum);
        if (c) {
          clearInterval(checkInterval);
          this.handleSelectCustomer(c, true); // fromDeepLink=true
        }
      }, 100);
      setTimeout(() => clearInterval(checkInterval), 5000);
    }
  }

  private _loadAllData(tradeUnits?: string[]): void {
    // Increment request ID so any in-flight customer request from a previous
    // trade unit selection is ignored when it eventually resolves.
    const requestId = ++this._customerRequestId;
    this._isLoading = true;
    this.loading.set(true);

    this.customersApi.getCustomers(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        // Discard result if a newer request has already been issued.
        if (requestId !== this._customerRequestId) return;
        const list = data ?? [];
        this.customers.set(list);
        this.customerStore.setCustomers(list);
        this.customerStore.setCustomersLoadFailed(false);
        this.loading.set(false);
        this._isLoading = false;
        this.lists.enrichSavedLists();

        const pdMap = this.producerDetailsMap();
        if (this._pendingProducerDetails) {
          this._mergeProducerDetails(this._pendingProducerDetails);
          this._pendingProducerDetails = null;
        } else if (pdMap.size > 0) {
          this._mergeProducerDetails(Array.from(pdMap.values()));
        }
      },
      error: () => {
        if (requestId !== this._customerRequestId) return;
        // The producer list shows "Couldn't load producers" from this rather than "No producers found".
        this.customerStore.setCustomersLoadFailed(true);
        this.loading.set(false);
        this._isLoading = false;
      }
    });

    this.apiService.getContracts(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const list = data ?? [];
        const batchIds = new Set(list.map(c => c.id));
        const fkExtras = this.contracts().filter(c => !batchIds.has(c.id));
        this.contracts.set([...list, ...fkExtras]);
        this.appState.setContracts(this.contracts());
        // Re-enrich saved lists now that contracts are loaded — the initial enrichment
        // may have run before contracts arrived, producing wrong customerIds.
        this.lists.enrichSavedLists(true);
      },
      error: (err) => this.backgroundFailures.report('load contracts', err)
    });

    // Tickets are no longer bulk-loaded here. They're fetched per-producer on select (applied +
    // unapplied via HomeProducerActivityStore.loadCustomerTickets) since applied tickets are only ever viewed on a selected
    // producer; list/NLQ ticket queries lazily fetch the TU-wide set themselves when needed.

    this.apiService.getPlantingIntentions(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const list = data ?? [];
        this.plantingIntentions.set(list);
        this.appState.setPlantingIntentions(list);
        this.appState.setPlantingIntentionsLoadFailed(false);
        this.isLoadingPlanting.set(false);
      },
      error: () => { this.appState.setPlantingIntentionsLoadFailed(true); this.isLoadingPlanting.set(false); }
    });

    // Last-contact aggregate instead of the full note download — the selected producer's
    // full notes load separately via _ensureCustomerNotes on selection.
    this.notes.refreshLastContacts();

    this.apiService.getStoredGrain(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const merged = mergeIncomingById(data ?? [], this.storedGrain());
        this.storedGrain.set(merged);
        this.appState.setStoredGrain(merged);
        const sel = this.selectedCustomer();
        if (sel) this.activity.loadCustomerData(sel.id);
      },
      error: (err) => this.backgroundFailures.report('load stored grain', err)
    });

    // Merge (not replace) for the same reason storage does: the TU-wide fetch and the per-producer
    // fetch both write this signal, so a late TU response must not drop rows already loaded for the
    // selected producer.
    this.apiService.getDpContracts(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const merged = mergeIncomingById(data ?? [], this.dpContracts());
        this.dpContracts.set(merged);
        this.appState.setDpContracts(merged);
        const sel = this.selectedCustomer();
        if (sel) this.activity.loadCustomerData(sel.id);
      },
      error: (err) => this.backgroundFailures.report('load DP contracts', err)
    });

    this._loadYieldData();

    this.lists.loadSavedLists();
  }

  private _loadProducerDetails(): void {
    this.apiService.getAllProducerDetails().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (details) => {
        const list = details ?? [];
        const map = new Map(this.producerDetailsMap());
        list.forEach(d => map.set(d.customerId, d));
        this.producerDetailsMap.set(map);

        if (this.customers().length > 0) {
          this._mergeProducerDetails(list);
        } else {
          this._pendingProducerDetails = list;
        }
      },
      error: (err) => this.backgroundFailures.report('load producer details', err)
    });
  }

  private _mergeProducerDetails(details: ProducerDetails[]): void {
    if (details.length === 0) return;
    const map = new Map(this.producerDetailsMap());
    details.forEach(d => map.set(d.customerId, d));
    this.producerDetailsMap.set(map);

    const detailsMap = new Map(details.map(d => [d.customerId, d]));
    let changed = false;
    const updated = this.customers().map(customer => {
      const pd = detailsMap.get(customer.id);
      if (pd) {
        changed = true;
        return applyProducerDetails(customer, pd);
      }
      return customer;
    });

    if (changed) {
      this.customers.set(updated);
      this.customerStore.setCustomers(updated);
      const sel = this.selectedCustomer();
      if (sel) {
        const updatedSel = updated.find(c => c.id === sel.id);
        if (updatedSel) {
          this.selectedCustomer.set(updatedSel);
          this._fetchMissingLinkedProducers(updatedSel);
          this.activity.loadCustomerData(updatedSel.id, updatedSel);
          // linkedProducerIds may have changed with the merged details — make sure the
          // (possibly expanded) group's notes are cached.
          this._ensureCustomerNotes(updatedSel);
        }
      }
    }
  }

  private _loadYieldData(): void {
    const key = [...this.selectedTradeUnits()].sort().join(',');
    if (!key) {
      this.yieldEstimates.set([]);
      return;
    }

    this.isLoadingYieldData.set(true);
    const done = () => this.isLoadingYieldData.set(false);

    // Gather all unique planting years from intentions + contracts so we fetch
    // yield estimates for every year the user might select.
    const years = yieldEstimateYears(new Date().getFullYear(), this.plantingIntentions(), this.contracts());

    const yearCalls = years.map(y =>
      this.apiService.getDashboardPlantingEstimates(key, y).pipe(catchError(() => of([] as DashboardPlantingEstimate[])))
    );
    forkJoin(yearCalls).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (results) => {
        // Merge all years — later years overwrite earlier for same crop key
        this.yieldEstimates.set(mergeYieldEstimates(results));
        done();
      },
      error: () => done()
    });
  }

  /** Applies the profile header's staged Add-to-List changes for the selected producer
   *  (see HomeSavedListsStore.saveMembership). */
  handleSaveSavedListMembership(changes: { listId: number; add: boolean }[]): void {
    this.lists.saveMembership(changes);
  }

  handleClearSelection(): void {
    this.selectedCustomer.set(null);
    this.appState.selectCustomer(null);
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  private _onTradeUnitsChanged(tradeUnits: string[]): void {
    this.selectedTradeUnits.set(tradeUnits);
    this.selectedCustomer.set(null);
    this.appState.selectCustomer(null);
    this._crossTradeUnitCustomers.set(new Map());
    // Clear the stale customer list immediately so the old roster doesn't show while the
    // new API calls are in flight. The last-contact aggregate is NOT cleared — it covers
    // all trade units, so it stays correct across TU switches (it refreshes in the
    // background via _loadAllData / data-preload for freshness).
    this.customers.set([]);
    this.customerStore.setCustomers([]);
    // Per-producer tickets accumulate in the local signal across selections, so clear them on TU
    // change to drop the prior TU's producers' tickets. (appState.tickets — the TU-wide list/NLQ
    // cache — is cleared separately by data-preload's clearTicketsCache.)
    this.tickets.set([]);
    // Drop the per-customer caches — TU change can include / exclude different
    // customers, and re-clicking a producer that overlaps the new TU must re-fetch
    // contracts/tickets/pricing/grain to reflect the new scope. Without this, the
    // HomeProducerActivityStore's loaded-at short-circuit would serve stale data from the prior TU.
    // Notes are cleared for freshness parity: the next selection re-fetches, picking up
    // notes other users added since.
    this.activity.forgetAll();
    this.planting.forgetAll();
    this.notes.forgetAll();
    this.linked.forgetWalks();
    // Cancel any in-flight per-customer requests (pricing lines, contracts, tickets,
    // grain, planting, notes, linked-producers) tied to the prior customer so they
    // don't write into signals after the new TU has loaded. Also clears the loading
    // flags they own so the UI doesn't get stuck showing "Loading…" for data that's
    // no longer arriving.
    this._cancelSelection$.next();
    this.isLoadingPricingLines.set(false);
    this.isLoadingUnappliedTickets.set(false);
    this.notes.stopLoading();
    // Reset loading flag so an explicit user selection is never blocked by a
    // background load that may still be in-flight.
    this._isLoading = false;
    if (tradeUnits && tradeUnits.length > 0) {
      this._loadAllData(tradeUnits);
    } else {
      // No TU selected (e.g. after Reset) — data-preload skips its pipeline entirely in
      // this state, so refresh the last-contact aggregate here so customer list cards
      // show correct "last contacted" dates in search results. The aggregate spans all
      // trade units, so the same call serves the no-TU flow.
      this.notes.refreshLastContacts();
    }
  }

  /**
   * Ensures the full notes for `customer` AND its currently-known linked group are loaded and
   * fresh, then recomputes the selected producer's notes panel + last-contact badges. The caching
   * (stale-while-revalidate, once per selection, failures not cached) is HomeNotesStore's.
   */
  private _ensureCustomerNotes(customer: Customer): void {
    const groupIds = [...new Set([customer.id, ...this.getLinkedGroup(customer).map(c => c.id)])];
    this.notes.ensureCustomerNotes(groupIds, () => {
      const sel = this.selectedCustomer();
      if (sel) this.activity.loadCustomerData(sel.id);
    });
  }

  handleSelectCustomer(customer: Customer, fromDeepLink = false): void {
    // Cancel everything still in flight from the prior customer selection so the
    // browser's connection pool isn't blocked by stale linked-producer / notes /
    // planting calls when the user clicks through producers quickly.
    this._cancelSelection$.next();
    // New selection — allow each producer's notes to be re-fetched once so other reps' adds show.
    this.notes.startSelection();
    // Reset navigation context when user manually selects (but NOT when coming from a deep link)
    if (!fromDeepLink) {
      this.pendingContractId.set(null);
      this.pendingTab.set(null);
      this.pendingTicketCrop.set(null);
    }
    this.usageTracking.trackProfileOpened(customer.id.toString());
    const pdMap = this.producerDetailsMap();
    const pd = pdMap.get(customer.id);
    if (pd) {
      customer = applyProducerDetails(customer, pd);
      this._refreshSelectedProducerDetails(customer.id, pd);
    } else {
      this.apiService.getProducerDetails(customer.id).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (details) => {
          const map = new Map(this.producerDetailsMap());
          map.set(details.customerId, details);
          this.producerDetailsMap.set(map);
          const sel = this.selectedCustomer();
          if (sel?.id === customer.id) {
            const updated = applyProducerDetails(sel, details);
            this.selectedCustomer.set(updated);
            this._fetchMissingLinkedProducers(updated);
            this.activity.loadCustomerData(updated.id, updated);
            // linkedProducerIds may have just arrived/changed — make sure the (possibly
            // expanded) group's notes are cached so the panel shows the full history.
            this._ensureCustomerNotes(updated);
          }
        },
        error: (err) => this.backgroundFailures.report('refresh producer details', err)
      });
    }

    this.selectedCustomer.set(customer);
    this.appState.selectCustomer(customer);
    this.isLoadingContracts.set(true);
    this.isLoadingUnappliedTickets.set(true);
    this.contractsLoadError.set(null);
    this.ticketsLoadError.set(null);
    this.pricingLinesLoadError.set(null);
    this.isLoadingStoredGrain.set(true);
    this.isLoadingDpContracts.set(true);
    this.activity.loadCustomerContractsAndTickets(customer.id, customer.scoularId);
    this.activity.loadCustomerData(customer.id);
    this._fetchMissingLinkedProducers(customer);
    // Fetch this producer's (and known linked group's) full notes — notes are no longer
    // bulk-downloaded, so selection is what hydrates the notes panel. Cache-hit = instant.
    this._ensureCustomerNotes(customer);
    this.reminders.loadCustomerReminders(customer.id);

    // Fetch planting intentions exactly once per customer selection.
    // HomeProducerActivityStore.loadCustomerData is called multiple times (contracts, tickets, storedGrain callbacks),
    // so the fetch lives here instead to avoid triple API calls.
    // Cached after the first visit; subsequent clicks hydrate from cache instead of re-fetching
    // (see HomePlantingStore.loadForSelection).
    this.planting.loadForSelection(customer.id);

    // (No-TU special case removed: the selected producer's notes come from the per-customer
    // fetch above, and the badge aggregate spans all trade units — both are TU-independent.)
  }

  /**
   * Re-reads the clicked producer's details in the background and applies them if they changed since
   * the page loaded them — e.g. a teammate added grain on farm (QA, RUNDMAP, 2026-10-12: the list showed
   * none while Build a List, which reads fresh, showed 50,000 bu). The profile already shows the cached
   * copy, so this only matters when something changed; then the map, the list row and the profile update.
   */
  private _refreshSelectedProducerDetails(customerId: number, cached: ProducerDetails): void {
    this.apiService.getProducerDetails(customerId).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (details) => {
        if (JSON.stringify(details) === JSON.stringify(cached)) return;
        const linkedBefore = cached.linkedProducerIds ?? '';
        this._mergeProducerDetails([details]);
        const sel = this.selectedCustomer();
        // _mergeProducerDetails updates the profile when the producer is in this trade unit's list; one
        // opened from outside it (a linked producer in another trade unit) is updated here.
        if (sel?.id === customerId && !this.customers().some(c => c.id === customerId)) {
          const updated = applyProducerDetails(sel, details);
          this.selectedCustomer.set(updated);
          if ((details.linkedProducerIds ?? '') !== linkedBefore) {
            this._fetchMissingLinkedProducers(updated);
            this._ensureCustomerNotes(updated);
          }
        }
      },
      error: (err) => this.backgroundFailures.report('refresh producer details', err)
    });
  }

  /**
   * Fetches every producer transitively linked to `customer` that isn't loaded yet (see
   * HomeLinkedProducersStore), topping up the selected producer's notes as each level lands.
   */
  private _fetchMissingLinkedProducers(customer: Customer): void {
    this.linked.fetchMissingLinkedProducers(customer, () => {
      const sel = this.selectedCustomer();
      if (sel) this._ensureCustomerNotes(sel);
    });
  }

  private _propagatePrimaryContact(linkedCustomer: Customer, primary: { name: string; phone?: string; email?: string }): void {
    const existingPd = this.producerDetailsMap().get(linkedCustomer.id);
    // Skip if the linked producer already has a primary contact
    if (existingPd?.primaryContact || linkedCustomer.primaryContact) return;

    this.apiService.saveProducerDetails(linkedCustomer.id, {
      scoularId: linkedCustomer.scoularId || null,
      customerName: linkedCustomer.name,
      totalAcres: existingPd?.totalAcres ?? null,
      primaryContact: primary.name,
      primaryPhone: primary.phone ?? null,
      commodities: existingPd?.commodities ?? null,
      linkedProducerIds: existingPd?.linkedProducerIds ?? ((linkedCustomer.linkedProducerIds || []).join(',') || null),
      // grainOnFarm intentionally omitted — this save isn't editing grain on farm, and the server
      // preserves the existing rows when it is absent (a cached copy could be older than a teammate's edit).
      // Preserve any existing contact rows; otherwise seed the full primary row (name + phone +
      // email) so the linked producer gets the same contact card (never wipes rows).
      contacts: existingPd?.contacts && existingPd.contacts.length > 0
        ? existingPd.contacts.map(c => ({ name: c.name, phone: c.phone, email: c.email, isPrimary: c.isPrimary }))
        : [{ name: primary.name, phone: primary.phone, email: primary.email, isPrimary: true }]
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (pd) => {
        const map = new Map(this.producerDetailsMap());
        map.set(pd.customerId, pd);
        this.producerDetailsMap.set(map);
        // Update the customer object in local state (server response already updated the pd map).
        const updated = { ...linkedCustomer, primaryContact: primary.name, primaryPhone: primary.phone, contacts: pd.contacts };
        const idx = this.customers().findIndex(c => c.id === linkedCustomer.id);
        if (idx >= 0) {
          const arr = [...this.customers()];
          arr[idx] = updated;
          this.customers.set(arr);
          this.customerStore.setCustomers(arr);
        } else {
          const cache = new Map(this._crossTradeUnitCustomers());
          cache.set(linkedCustomer.id, updated);
          this._crossTradeUnitCustomers.set(cache);
        }
      },
      error: (err) => this.backgroundFailures.report('update the linked producer contact', err)
    });
  }

  /** Warms one producer's data on hover so the click renders from memory (see HomeProducerActivityStore.prefetch). */
  handlePrefetchCustomer(customer: Customer): void {
    this.activity.prefetch(customer);
  }

  /** Save handler for the edit dialog. Trade-unit assignment (if any) runs FIRST — for an
   *  onboarding candidate that PUT inserts them into dbo.Customer, which the ProducerDetails
   *  save then depends on (FK). Existing customers with no TU change skip straight to the
   *  details save, unchanged. */
  handleSaveCustomer(data: { customerId: number; scoularId?: string; acres: number; commodities: string[]; primaryContact: string; primaryPhone: string; contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[]; binSites: { siteKey: string; name: string; latitude?: number; longitude?: number; capacity?: number }[]; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean; grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number; bushelsSold?: number; targetBushels?: number; lastBid?: number; grade?: string }[]; intentionMoves?: { from: string; to: string }[] }): void {
    // Only call the trade-unit reconcile when the dialog flagged it safe + meaningful
    // (onboarding a candidate, or the manual TU set actually changed). A pure details edit
    // skips it entirely, and a failed TU-load never reconciles (so manual TUs can't be wiped).
    if (data.reconcileTradeUnits) {
      // The dialog closes at once, so a slow save looked like a dead one: nothing changed on screen, the
      // rep saved again, and the browser eventually reported a failure for a save the server went on to
      // finish (PROD 2026-10-28, four saves of one onboarding). Mark it busy, and say so if it runs long.
      const savingId = data.customerId;
      this._tradeUnitSavesInFlight.update(ids => new Set(ids).add(savingId));
      const slowNotice = setTimeout(
        () => this.toastService.info('Still saving trade units — this can take up to a minute. No need to save again.', 8000),
        HomeComponent.SLOW_TRADE_UNIT_SAVE_MS);
      this.customersApi.assignTradeUnits(data.customerId, data.tradeUnitCodes ?? [], data.scoularId).pipe(
        finalize(() => {
          clearTimeout(slowNotice);
          this._tradeUnitSavesInFlight.update(ids => {
            const next = new Set(ids);
            next.delete(savingId);
            return next;
          });
        })
      ).subscribe({
        next: (customer) => {
          // The server may have adopted an existing row for the same producer (matched by ScoularId);
          // everything below must use the id it actually wrote the trade units to.
          const effective = applyAdoptedCustomerId(data, customer);
          // A candidate from the CTRM search carries a negative placeholder id; the server mints the
          // real one, so a changed id there is a brand-new row, not an adoption.
          const minted = data.customerId < 0;
          const adopted = !minted && effective.customerId !== data.customerId;
          const sel = this.selectedCustomer();
          if (adopted) {
            // Select the returned record first so _saveProducerDetailsAndLinks can find it (the list may not hold it).
            this.toastService.success('That producer was already in the Workbench — trade units were added to the existing record.');
            this.selectedCustomer.set({ ...customer, isManual: true, isOnboardCandidate: false });
          } else if (sel?.id === data.customerId && sel.isOnboardCandidate) {
            // A brand-new onboarding: they're now in dbo.Customer — clear the candidate flag on
            // the selected record so we stay on this producer and notes / details unlock. The
            // returned record carries the real id (minted for a CTRM candidate).
            this.toastService.success('Producer added and trade units assigned. Select that trade unit or group to see them.');
            this.selectedCustomer.set({ ...sel, ...customer, isManual: true, isOnboardCandidate: false });
          }
          this._saveProducerDetailsAndLinks(effective);
          this.planting.movePlantingIntentions(effective.customerId, effective.intentionMoves ?? []);
        },
        error: err => { if (!alreadyShown(err)) this.toastService.error('Failed to update trade units'); }
      });
    } else {
      this._saveProducerDetailsAndLinks(data);
      this.planting.movePlantingIntentions(data.customerId, data.intentionMoves ?? []);
    }
  }

  private _saveProducerDetailsAndLinks(data: { customerId: number; acres: number; commodities: string[]; primaryContact: string; primaryPhone: string; contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[]; binSites: { siteKey: string; name: string; latitude?: number; longitude?: number; capacity?: number }[]; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number; bushelsSold?: number; targetBushels?: number; lastBid?: number; grade?: string }[] }): void {
    const customers = this.customers();
    const sel = this.selectedCustomer();
    const customer = customers.find(c => c.id === data.customerId)
      || (sel?.id === data.customerId ? sel : null);
    if (!customer) return;

    const allCommodities = [...new Set([
      ...commodityCodesFrom(this.allCustomerTickets(), this.allCustomerContracts()), ...data.commodities
    ])].sort();

    const optimisticContacts = data.contacts.map((c, i) => ({ ...c, sortOrder: i }));
    const optimisticBinSites = data.binSites.map((b, i) => ({ ...b, sortOrder: i }));
    // The profile shows each grain row's site by name; fill it in from the sites being saved.
    const siteNames = new Map(data.binSites.map(b => [b.siteKey, b.name]));
    const optimisticGrain = data.grainOnFarm.map(g => ({ ...g, binSiteName: g.binSiteKey ? siteNames.get(g.binSiteKey) ?? null : null }));
    const updated: Customer = {
      ...customer,
      totalAcres: data.acres,
      grainOnFarm: optimisticGrain,
      commodities: allCommodities,
      primaryContact: data.primaryContact,
      primaryPhone: data.primaryPhone,
      contacts: optimisticContacts,
      binSites: optimisticBinSites,
      linkedProducerIds: data.linkedProducerIds,
      eSignEnabled: data.eSignEnabled
    };

    const savedCommodities = allCommodities.length > 0 ? allCommodities.join(',') : null;
    const savedLinkedIds = data.linkedProducerIds.length > 0 ? data.linkedProducerIds.join(',') : null;
    const savePayload = {
      scoularId: customer.scoularId || null,
      customerName: customer.name,
      totalAcres: data.acres || null,
      primaryContact: data.primaryContact || null,
      primaryPhone: data.primaryPhone || null,
      commodities: savedCommodities,
      linkedProducerIds: savedLinkedIds,
      grainOnFarm: data.grainOnFarm,
      contacts: data.contacts,
      binSites: data.binSites
    };

    const existingPd = this.producerDetailsMap().get(data.customerId);
    if (existingPd) {
      const map = new Map(this.producerDetailsMap());
      map.set(data.customerId, { ...existingPd, totalAcres: data.acres || undefined, primaryContact: data.primaryContact || undefined, primaryPhone: data.primaryPhone || undefined, commodities: savedCommodities ?? undefined, linkedProducerIds: savedLinkedIds ?? undefined, grainOnFarm: optimisticGrain, contacts: optimisticContacts, binSites: optimisticBinSites });
      this.producerDetailsMap.set(map);
    }

    // Linked-producer membership just changed — invalidate the BFS cache so the
    // next visit to the affected customers re-walks the graph. We don't know the
    // full transitive set without re-walking, so the safest cheap fix is to clear
    // everything; the cache will rebuild lazily as the user clicks through.
    this.linked.forgetWalks();

    this.apiService.saveProducerDetails(data.customerId, savePayload).subscribe({
      next: (pd) => {
        const map = new Map(this.producerDetailsMap());
        map.set(pd.customerId, pd);
        this.producerDetailsMap.set(map);
        this.toastService.success('Producer updated successfully');
      },
      error: err => { if (!alreadyShown(err)) this.toastService.error('Failed to save producer details'); }
    });

    for (const linkedIdStr of data.removedIncomingIds) {
      // Look in BOTH the main customer roster and the cross-TU cache — linked customers
      // outside the currently-selected trade units live in the cross-TU cache and would
      // be silently skipped otherwise.
      const linkedCustomer = this.customers().find(c => c.scoularId === linkedIdStr)
        ?? [...this._crossTradeUnitCustomers().values()].find(c => c.scoularId === linkedIdStr);
      if (!linkedCustomer) continue;
      const currentSourceId = customer.scoularId || '';
      const updatedLinkedIds = (linkedCustomer.linkedProducerIds || []).filter(id => id !== currentSourceId);
      const linkedId = linkedCustomer.id;
      const existingPd = this.producerDetailsMap().get(linkedId);
      this.apiService.saveProducerDetails(linkedId, {
        scoularId: linkedCustomer.scoularId || null,
        customerName: linkedCustomer.name,
        totalAcres: existingPd?.totalAcres ?? null,
        primaryContact: existingPd?.primaryContact ?? null,
      primaryPhone: existingPd?.primaryPhone ?? null,
        commodities: existingPd?.commodities ?? null,
        linkedProducerIds: updatedLinkedIds.length > 0 ? updatedLinkedIds.join(',') : null,
        // grainOnFarm intentionally omitted — this save isn't editing grain on farm, and the server
        // preserves the existing rows when it is absent (a cached copy could be older than a teammate's edit).
        // `contacts` intentionally omitted — the server preserves existing rows when absent.
      }).subscribe({
        next: (pd) => {
          const map = new Map(this.producerDetailsMap());
          map.set(pd.customerId, pd);
          this.producerDetailsMap.set(map);
          const updatedLinkedCustomer: Customer = { ...linkedCustomer, linkedProducerIds: updatedLinkedIds };
          // Update whichever store the linked customer lives in so the transitive BFS
          // sees the new state immediately (no stale A→C edge lingering after removal).
          const idx = this.customers().findIndex(c => c.id === linkedId);
          if (idx >= 0) {
            const arr = [...this.customers()];
            arr[idx] = updatedLinkedCustomer;
            this.customers.set(arr);
            this.customerStore.setCustomers(arr);
          }
          if (this._crossTradeUnitCustomers().has(linkedId)) {
            this._crossTradeUnitCustomers.update(cache => {
              const next = new Map(cache);
              next.set(linkedId, updatedLinkedCustomer);
              return next;
            });
          }
        },
        error: (err) => this.backgroundFailures.report('update the linked producer', err)
      });
    }

    if (data.primaryContact) {
      // Propagate the FULL primary contact row (name + phone + email) to ALL linked producers
      // that don't have one yet.
      const primaryRow = data.contacts.find(c => c.isPrimary)
        ?? { name: data.primaryContact, phone: data.primaryPhone || undefined, isPrimary: true };
      const allKnown = [...this.customers(), ...this._crossTradeUnitCustomers().values()];
      for (const linkedIdStr of data.linkedProducerIds) {
        const linkedCustomer = allKnown.find(c => c.scoularId === linkedIdStr);
        if (linkedCustomer) {
          this._propagatePrimaryContact(linkedCustomer, primaryRow);
        } else {
          // Linked producer not loaded locally — fetch by sourceId then propagate
          this.customersApi.getCustomerBySourceId(linkedIdStr).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (fetched) => {
              const cache = new Map(this._crossTradeUnitCustomers());
              cache.set(fetched.id, fetched);
              this._crossTradeUnitCustomers.set(cache);
              this._propagatePrimaryContact(fetched, primaryRow);
            },
            error: (err) => this.backgroundFailures.report('load a linked producer', err)
          });
        }
      }
    }

    const index = customers.findIndex(c => c.id === updated.id);
    if (index >= 0) {
      const arr = [...customers];
      arr[index] = updated;
      this.customers.set(arr);
    } else {
      this.customers.set([...customers, updated]);
    }

    // Keep the cross-TU cache in sync too — a customer viewed across TU boundaries may
    // live there instead of the main roster. Without this, the transitive BFS could
    // still hit a stale copy with the pre-edit linkedProducerIds.
    if (this._crossTradeUnitCustomers().has(updated.id)) {
      this._crossTradeUnitCustomers.update(cache => {
        const next = new Map(cache);
        next.set(updated.id, updated);
        return next;
      });
    }

    this.selectedCustomer.set(updated);
    this.customerStore.setCustomers(this.customers());
    this.appState.selectCustomer(updated);

    // Fetch any newly linked producers that aren't loaded yet so the dropdown updates
    // immediately. Recursive BFS (transitive) so newly added edges extend the group.
    this._fetchMissingLinkedProducers(updated);
    this.activity.loadCustomerData(updated.id, updated);
    // A newly-linked producer that was ALREADY in the roster never goes through the BFS
    // network path, so make sure the expanded group's notes are cached for the panel.
    this._ensureCustomerNotes(updated);
  }

  /**
   * Every producer transitively linked to `customer`, forward and reverse (see linkedGroupOf), among
   * the roster and the cross-trade-unit cache. Relies on `_fetchMissingLinkedProducers` having
   * populated the cache; if a transitively-linked producer isn't loaded yet, it's silently excluded
   * until its fetch completes and triggers a re-render.
   */
  getLinkedGroup(customer: Customer): Customer[] {
    return linkedGroupOf(customer, [...this.customers(), ...this._crossTradeUnitCustomers().values()]);
  }

  handleSelectLinkedCustomer(customerId: number): void {
    if (customerId === this.selectedCustomer()?.id) return;
    // Cancel the previous selection's in-flight per-customer fetches, exactly as
    // handleSelectCustomer and _onTradeUnitsChanged do. Without this, clicking linked producer B
    // then C left B's fetches running; whichever resolved last won, so C's profile could get
    // overwritten with B's contracts/tickets/notes.
    this._cancelSelection$.next();
    // New selection — allow each producer's notes to be re-fetched once (other reps' adds show).
    this.notes.startSelection();
    // Reset navigation context — user is manually selecting a linked producer
    this.pendingContractId.set(null);
    this.pendingTab.set(null);
    this.pendingTicketCrop.set(null);
    // Cache the departing customer so getLinkedGroup can still find it for reverse-link
    // lookups after the new customer is selected (prevents the dropdown from disappearing).
    const departing = this.selectedCustomer();
    if (departing && !this.customers().some(c => c.id === departing.id)) {
      const cache = new Map(this._crossTradeUnitCustomers());
      cache.set(departing.id, departing);
      this._crossTradeUnitCustomers.set(cache);
    }
    const customer = this.customers().find(c => c.id === customerId);
    if (customer) {
      this.selectedCustomer.set(customer);
      this._fetchMissingLinkedProducers(customer);
      this.activity.loadCustomerContractsAndTickets(customer.id, customer.scoularId);
      this.activity.loadCustomerData(customer.id);
      this._ensureCustomerNotes(customer);
      this.planting.loadWithoutCache(customer.id);
    } else {
      // Linked customer is in a different trade unit — fetch them from the API
      this.customersApi.getCustomerById(customerId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (fetched) => {
          // Merge producer details if available
          const pd = this.producerDetailsMap().get(fetched.id);
          if (pd) fetched = applyProducerDetails(fetched, pd);
          // Cache so getLinkedGroup can find them even though they're outside the TU filter
          const cache = new Map(this._crossTradeUnitCustomers());
          cache.set(fetched.id, fetched);
          this._crossTradeUnitCustomers.set(cache);
          this.selectedCustomer.set(fetched);
          this._fetchMissingLinkedProducers(fetched);
          this.activity.loadCustomerContractsAndTickets(fetched.id, fetched.scoularId);
          this.activity.loadCustomerData(fetched.id);
          this._ensureCustomerNotes(fetched);
          this.planting.loadWithoutCache(fetched.id);
        },
        error: (err) => this.backgroundFailures.report('load the selected producer', err)
      });
    }
    // (No-TU special case removed: _ensureCustomerNotes above hydrates the linked
    // customer's notes via the per-customer endpoint, which is TU-independent.)
  }

  // ==========================================================================
  // Planting intentions — delegated to HomePlantingStore
  // ==========================================================================

  addPlantingIntention(data: {crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}): void {
    this.planting.addPlantingIntention(data);
  }

  editPlantingIntention(data: {intentionId: number, crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit?: string}): void {
    this.planting.editPlantingIntention(data);
  }

  deletePlantingIntention(intentionId: number): void {
    this.planting.deletePlantingIntention(intentionId);
  }
}
