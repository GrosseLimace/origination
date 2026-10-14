import { Component, inject, signal, computed, DestroyRef, effect, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of, timer } from 'rxjs';
import { mergeProducerRows } from './merge-producer-rows';
import { applyProducerDetails } from '@shared/utils/apply-producer-details';
import { catchError, takeUntil } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, Ticket, Note, Reminder, StoredGrain, DpContract, ProducerDetails, ContractPricingLine, DashboardPlantingEstimate, Commodity, NoteMention } from '@models';
import { CustomerListComponent } from '../../components/customer-list/customer-list.component';
import { CustomerProfileComponent } from '../../components/customer-profile/customer-profile.component';
import { CustomerNotesComponent } from '../../components/customer-notes/customer-notes.component';
import { CustomerRemindersComponent, ReminderDraft } from '../../components/customer-reminders/customer-reminders.component';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '@shared/components/card/card.component';
import { CalculatorLauncherComponent } from '@features/calculators/components/calculator-launcher.component';
import { environment } from '@env/environment';
import {
  commodityCodesFrom, describeLastContacted, linkedGroupOf, mergeIncomingById, mergeYieldEstimates,
  producerContractsAndTickets, readFailureMessage, yieldEstimateYears
} from './home-derivations';
import { HomeBackgroundFailures } from './home-background-failures';
import { HomePageState } from './home-page.state';
import { HomeRemindersStore } from './home-reminders.store';
import { HomeNotesStore } from './home-notes.store';
import { HomeSavedListsStore } from './home-saved-lists.store';
import { HomeLinkedProducersStore } from './home-linked-producers.store';
import { HomePlantingStore } from './home-planting.store';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CustomerListComponent,
    CustomerProfileComponent,
    CustomerNotesComponent,
    CustomerRemindersComponent,
    CardComponent,
    CardContentComponent,
    CardHeaderComponent,
    CardTitleComponent,
    CalculatorLauncherComponent
  ],
  templateUrl: './home.component.html',
  // Page-scoped state and behaviour, one instance per visit to the page.
  providers: [HomePageState, HomeBackgroundFailures, HomeRemindersStore, HomeNotesStore, HomeSavedListsStore, HomeLinkedProducersStore, HomePlantingStore],
})
export class HomeComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
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

  /** Manager = holds the "Admin" app role. Enables the "Team Lists" tab in the Add-to-List dropdown. */
  readonly isManager = this.lists.isManager;
  /** Gates the floating calculator launcher (Profitability calc + future calculators). */
  readonly calculatorEnabled = environment.calculatorEnabled;
  /** Gates the personal follow-up reminders card and the producer-list reminder badge. */
  readonly remindersEnabled = this.reminders.remindersEnabled;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _resizeHandler = () => this._checkMobile();
  private _isLoading = false;
  private _customerRequestId = 0;
  /** Cancels the prior selection's in-flight requests (see HomePageState.cancelSelection$). */
  private readonly _cancelSelection$ = this.page.cancelSelection$;
  /** Customers whose contracts / tickets / pricing-lines / stored-grain have
   *  already been fetched, and WHEN.
   *
   *  Re-clicking shows the cached rows immediately - they are still in the signals from the first visit -
   *  and refetches in the background if they are older than {@link CUSTOMER_DATA_MAX_AGE_MS}, swapping
   *  them when the response lands. It used to be a plain Set with no age, which meant the first click of
   *  a session was the only one that ever hit the network: a load applied afterwards, or a contract that
   *  closed, stayed invisible until the user changed trade units. That is the wrong default for a screen
   *  people leave open through a harvest day.
   *
   *  Cleared when the user adds/removes a contract, ticket, or storage record. */
  private readonly _customerLoadedAt = new Map<number, number>();

  /** How long a producer's cached contracts/tickets are served without a refetch. Matched to the
   *  server's own per-producer cache (Ctrm:LiveCacheSeconds, 60s): refetching sooner would usually be
   *  answered from that cache anyway, so it would cost a round trip for the same bytes. */
  private static readonly CUSTOMER_DATA_MAX_AGE_MS = 60_000;

  /** How long after a FIRST load of a producer the silent convergence refresh fires.
   *
   *  The server may answer a first click instantly from the warm trade-unit cache (rows up to a few
   *  minutes old) while it starts the live read behind the answer. This one-shot refresh re-reads once
   *  that live read has had time to land, so anything added or closed in CTRM in the gap appears within
   *  seconds of the click - the user never has to leave and come back. When the first answer was already
   *  live, the refresh hits the server's 60s per-producer cache and costs one ~50ms round trip. */
  private static readonly CLICK_CONVERGENCE_MS = 4_000;

  /** The contract and ticket ids each producer's last read returned.
   *
   *  A refresh has to be able to make a row DISAPPEAR or CHANGE, and merging by id alone cannot:
   *  the synthetic ticket id is built from prefix/number/suffix/BL date/product/sequence and does NOT
   *  include the contract number or the status, so a ticket applied to a contract, settled, or cancelled
   *  since the first read has the SAME id. Merging "only if unseen" dropped the new row and left the stale
   *  one on screen for the session; merging by replacement still could not remove a row that had fallen
   *  out of the result entirely. So the refresh removes exactly the ids the previous read contributed,
   *  then merges the new rows.
   *
   *  Keyed on the previous ids rather than on customerCode on purpose: an applied split-load row can carry
   *  another producer's code, so filtering by code would drop rows this producer legitimately owns. */
  private readonly _customerRowIds = new Map<number, { contracts: Set<number>; tickets: Set<number> }>();
  /** Per-customer pricing-lines cache keyed by scoularId. Pricing lines are
   *  hydrated OUTSIDE the _customerLoadedAt short-circuit so that every click
   *  swaps to the right producer's lines (the contracts/tickets/grain short-
   *  circuit returned early before pricing lines were restored, leaving the
   *  panel showing the prior producer's data on re-click). */
  private readonly _customerPricingCache = new Map<string, ContractPricingLine[]>();

  /** When each producer's pricing lines were read. Same 60s rule as the contracts and tickets: without an
   *  age, a contract priced after the first click kept its UNPRICED badge for the rest of the session,
   *  which is a wrong number on screen rather than merely an old one. */
  private readonly _customerPricingLoadedAt = new Map<string, number>();

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
  readonly pendingContractId = signal<number | null>(null);
  readonly pendingTab = signal<string | null>(null);
  readonly pendingPlantingYear = signal<number | null>(null);
  readonly pendingTicketCrop = signal<string | null>(null);
  readonly selectedTradeUnits = this.page.selectedTradeUnits;
  /** The own and team lists the selected producer can be quick-added to from the profile header. */
  readonly savedListsForSelectedCustomer = this.lists.savedListsForSelectedCustomer;
  readonly teamListsForSelectedCustomer = this.lists.teamListsForSelectedCustomer;
  readonly customerContracts = signal<Contract[]>([]);
  readonly customerTickets = signal<Ticket[]>([]);
  readonly customerPricingLines = signal<ContractPricingLine[]>([]);
  /** The selected producer's notes panel and the note form's state (see HomeNotesStore). */
  readonly customerNotes = this.notes.customerNotes;
  readonly isLoadingNotes = this.notes.isLoadingNotes;
  readonly isSavingNote = this.notes.isSavingNote;
  readonly noteSaveSucceededCounter = this.notes.noteSaveSucceededCounter;
  /** The selected producer's follow-ups and the reminder card's state (see HomeRemindersStore). */
  readonly customerReminders = this.reminders.customerReminders;
  readonly isLoadingReminders = this.reminders.isLoadingReminders;
  readonly isSavingReminder = this.reminders.isSavingReminder;
  readonly reminderSaveSucceededCounter = this.reminders.reminderSaveSucceededCounter;
  readonly customerCodeMap = signal<Map<number, string>>(new Map());
  /** The selected producer's planting intentions (see HomePlantingStore). */
  readonly customerPlantingIntentions = this.planting.customerPlantingIntentions;
  readonly customerStoredGrain = signal<StoredGrain[]>([]);
  readonly customerDpContracts = signal<DpContract[]>([]);

  readonly allCustomerContracts = signal<Contract[]>([]);
  readonly allCustomerTickets = signal<Ticket[]>([]);
  readonly allCustomerPlantingIntentions = this.planting.allCustomerPlantingIntentions;
  readonly allCustomerStoredGrain = signal<StoredGrain[]>([]);
  readonly allCustomerDpContracts = signal<DpContract[]>([]);

  readonly yieldEstimates = signal<DashboardPlantingEstimate[]>([]);
  readonly commodities = signal<Commodity[]>([]);
  readonly isLoadingYieldData = signal(false);
  readonly isLoadingContracts = signal(false);

  /** Message when the producer's CONTRACT read failed, as opposed to returning nothing. Kept separate
   *  from the loading flag because "empty" and "failed" render identically otherwise, and a CTRM
   *  timeout showing as "no contracts found" is how a grower's book appears empty. */
  readonly contractsLoadError = signal<string | null>(null);
  /** True only while the FAST per-customer unapplied-tickets fetch is in flight. Drives the
   *  spinner on the Unapplied Tickets tab. */
  readonly isLoadingUnappliedTickets = signal(false);

  /** Message when the producer's TICKET read failed. See contractsLoadError. */
  readonly ticketsLoadError = signal<string | null>(null);

  /** Message when the producer's PRICING-LINE read failed. Separate from the contract error because the
   *  contract rows can be perfectly good while their prices are missing - and an empty pricing set renders
   *  as "this contract has no priced lines", which is a wrong number rather than an absent one. */
  readonly pricingLinesLoadError = signal<string | null>(null);
  readonly isLoadingPricingLines = signal(false);
  readonly isLoadingStoredGrain = signal(false);
  readonly isLoadingDpContracts = signal(false);
  readonly isLoadingPlanting = signal(true);

  readonly isMobile = signal(false);
  readonly loading = signal(false);

  readonly lastContactedDate = computed(() => describeLastContacted(this.customerNotes()));


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
    if (this.appState.customers().length === 0) {
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
      const tradeUnits = this.appState.selectedTradeUnits();
      if (!this._initialized) return;
      const key = [...tradeUnits].sort().join(',');
      if (key === this._lastTradeUnitKey) return;
      this._lastTradeUnitKey = key;
      untracked(() => this._onTradeUnitsChanged(tradeUnits));
    });

    // (Re)load the manager team lists whenever admin status resolves (/api/me) or the TU selection
    // changes. Guarded inside loadTeamLists so non-managers / empty selections clear the set.
    effect(() => {
      this.isManager();
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
    this.selectedTradeUnits.set(this.appState.selectedTradeUnits());

    const stateCustomers = this.appState.customers();
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
        this._loadCustomerData(stateSelectedCustomer.id);
        this._loadCustomerTickets(stateSelectedCustomer.id, stateSelectedCustomer.scoularId);
        // Re-fetch the producer's (and linked group's) notes — the per-customer notes
        // cache is component-local, so navigation back must repopulate it (same pattern
        // as the tickets / planting re-fetch on restore).
        this.notes.startSelection();
        this._ensureCustomerNotes(stateSelectedCustomer);
        // Re-fetch per-customer planting intentions on navigation back —
        // these are not stored in appState so they must be reloaded.
        this.planting.loadWithoutCache(stateSelectedCustomer.id);
      }
      // Reload yield estimates and commodities — not stored in appState so
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

    this.apiService.getCustomers(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        // Discard result if a newer request has already been issued.
        if (requestId !== this._customerRequestId) return;
        const list = data ?? [];
        this.customers.set(list);
        this.appState.setCustomers(list);
        this.appState.setCustomersLoadFailed(false);
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
        this.appState.setCustomersLoadFailed(true);
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
    // unapplied via _loadCustomerTickets) since applied tickets are only ever viewed on a selected
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
        if (sel) this._loadCustomerData(sel.id);
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
        if (sel) this._loadCustomerData(sel.id);
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
      this.appState.setCustomers(updated);
      const sel = this.selectedCustomer();
      if (sel) {
        const updatedSel = updated.find(c => c.id === sel.id);
        if (updatedSel) {
          this.selectedCustomer.set(updatedSel);
          this._fetchMissingLinkedProducers(updatedSel);
          this._loadCustomerData(updatedSel.id, updatedSel);
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
      this.commodities.set([]);
      return;
    }

    this.isLoadingYieldData.set(true);
    let pending = 2;
    const done = () => { if (--pending === 0) this.isLoadingYieldData.set(false); };

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

    this.apiService.getCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => { this.commodities.set(data); done(); },
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
    this.appState.setCustomers([]);
    // Per-producer tickets accumulate in the local signal across selections, so clear them on TU
    // change to drop the prior TU's producers' tickets. (appState.tickets — the TU-wide list/NLQ
    // cache — is cleared separately by data-preload's clearTicketsCache.)
    this.tickets.set([]);
    // Drop the per-customer caches — TU change can include / exclude different
    // customers, and re-clicking a producer that overlaps the new TU must re-fetch
    // contracts/tickets/pricing/grain to reflect the new scope. Without this, the
    // _customerLoadedAt short-circuit would serve stale data from the prior TU.
    // Notes are cleared for freshness parity: the next selection re-fetches, picking up
    // notes other users added since.
    this._customerLoadedAt.clear();
    this._customerRowIds.clear();
    this._customerPricingCache.clear();
    this._customerPricingLoadedAt.clear();
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
    this.isLoadingNotes.set(false);
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
      if (sel) this._loadCustomerData(sel.id);
    });
  }

  // ==========================================================================
  // Personal follow-up reminders — delegated to HomeRemindersStore
  // ==========================================================================

  /** Create or edit, depending on whether the draft carries an id. */
  saveReminder(draft: ReminderDraft): void {
    this.reminders.saveReminder(draft);
  }

  toggleReminderComplete(reminder: Reminder): void {
    this.reminders.toggleReminderComplete(reminder);
  }

  deleteReminder(reminder: Reminder): void {
    this.reminders.deleteReminder(reminder);
  }

  /** Retry path for a reminder saved while Outlook was unavailable or consent was declined. */
  addReminderToOutlook(reminder: Reminder): void {
    this.reminders.addReminderToOutlook(reminder);
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
            this._loadCustomerData(updated.id, updated);
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
    this._loadCustomerContractsAndTickets(customer.id, customer.scoularId);
    this._loadCustomerData(customer.id);
    this._fetchMissingLinkedProducers(customer);
    // Fetch this producer's (and known linked group's) full notes — notes are no longer
    // bulk-downloaded, so selection is what hydrates the notes panel. Cache-hit = instant.
    this._ensureCustomerNotes(customer);
    this.reminders.loadCustomerReminders(customer.id);

    // Fetch planting intentions exactly once per customer selection.
    // _loadCustomerData is called multiple times (contracts, tickets, storedGrain callbacks),
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
          this.appState.setCustomers(arr);
        } else {
          const cache = new Map(this._crossTradeUnitCustomers());
          cache.set(linkedCustomer.id, updated);
          this._crossTradeUnitCustomers.set(cache);
        }
      },
      error: (err) => this.backgroundFailures.report('update the linked producer contact', err)
    });
  }

  /** Hydrate customerPricingLines for the selected producer. Always called on
   *  every click — independent of _customerLoadedAt — so re-clicking a producer
   *  swaps to their pricing lines instead of leaving the prior producer's lines
   *  on screen. Cache hit = instant, no network. Cache miss = single fetch then
   *  populate. */
  /**
   * Refetches a producer's pricing lines behind badges already on screen.
   *
   * Silent, like the contract and ticket refresh: a failed refresh leaves the visible badges alone rather
   * than blanking a correct panel. Replaces the cached set outright - a line repriced since the first read
   * keeps its sequence, so merging by key would preserve the stale price.
   */
  private _refreshCustomerPricingLines(scoularId: string): void {
    this.apiService.getPricingLinesByCustomer(scoularId)
      .pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lines) => {
          // Only apply if the user is still on this producer.
          if (this.selectedCustomer()?.scoularId !== scoularId) return;

          this._customerPricingCache.set(scoularId, lines);
          this._customerPricingLoadedAt.set(scoularId, Date.now());
          this.pricingLinesLoadError.set(null);
          this.customerPricingLines.set(lines);
          this.appState.setPricingLines(lines);
        },
        error: () => { /* keep the visible badges; the failure is recorded server-side and logged */ }
      });
  }

  private _loadCustomerPricingLines(scoularId?: string): void {
    if (!scoularId) {
      this.customerPricingLines.set([]);
      this.isLoadingPricingLines.set(false);
      return;
    }
    const cached = this._customerPricingCache.get(scoularId);
    if (cached) {
      this.customerPricingLines.set(cached);
      this.appState.setPricingLines(cached);
      this.isLoadingPricingLines.set(false);
      this.pricingLinesLoadError.set(null);

      // Refresh behind the visible badges when the copy has aged out. No spinner, same reasoning as the
      // contract and ticket refresh: what is on screen is real, so a flicker would be a downgrade.
      const loadedAt = this._customerPricingLoadedAt.get(scoularId) ?? 0;
      if (Date.now() - loadedAt >= HomeComponent.CUSTOMER_DATA_MAX_AGE_MS)
        this._refreshCustomerPricingLines(scoularId);

      return;
    }
    // Cache miss — clear any prior producer's lines so the table doesn't show
    // stale data during the fetch, raise the loading flag, then issue the API call.
    this.customerPricingLines.set([]);
    this.isLoadingPricingLines.set(true);
    this.apiService.getPricingLinesByCustomer(scoularId)
      .pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lines) => {
          this.customerPricingLines.set(lines);
          this.appState.setPricingLines(lines);
          this._customerPricingCache.set(scoularId, lines);
          this._customerPricingLoadedAt.set(scoularId, Date.now());
          this.isLoadingPricingLines.set(false);
        },
        error: (err) => {
          this.customerPricingLines.set([]);
          this.isLoadingPricingLines.set(false);
          this.pricingLinesLoadError.set(readFailureMessage(err));
        }
      });
  }

  /**
   * Refetches a producer's contracts and tickets behind rows that are already on screen.
   *
   * Deliberately silent: no loading flags, no error state. The visible data is real - it is what the
   * first read returned - so a failed refresh should leave it alone rather than replace a correct screen
   * with an error. The failure is still recorded server-side (provenance) and in the log. The timestamp
   * is only advanced when BOTH reads succeed, so a partial failure retries on the next click rather than
   * pretending the data is fresh.
   */
  private _refreshCustomerContractsAndTickets(customerId: number, scoularId?: string): void {
    forkJoin({
      contracts: this.apiService.getContractsByCustomer(customerId, scoularId).pipe(catchError(() => of(null))),
      tickets: this.apiService.getTicketsByCustomer(customerId, scoularId).pipe(catchError(() => of(null)))
    })
      .pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ contracts, tickets }) => {
        // Only swap if the user is still on this producer - a refresh that lands after they have moved on
        // would otherwise write one producer's rows into another's view.
        if (this.selectedCustomer()?.id !== customerId) return;

        if (contracts) this._applyCustomerContracts(customerId, contracts, /* isRefresh */ true);
        if (tickets) this._applyCustomerTickets(customerId, tickets, /* isRefresh */ true);

        if (contracts && tickets) this._customerLoadedAt.set(customerId, Date.now());
      });
  }

  private _loadCustomerContractsAndTickets(customerId: number, scoularId?: string): void {
    // Pricing lines are handled OUTSIDE the _customerLoadedAt short-circuit so
    // every click hydrates customerPricingLines for the right producer (the
    // short-circuit only covers contracts/tickets/grain). Without this,
    // re-clicking a previously-loaded producer left the panel showing the prior
    // producer's lines.
    this._loadCustomerPricingLines(scoularId);

    // Already fetched this customer's data — the merged signals still hold it, so show that immediately
    // rather than making the user watch a spinner for rows we already have.
    const loadedAt = this._customerLoadedAt.get(customerId);
    if (loadedAt !== undefined) {
      this.isLoadingContracts.set(false);
      this.isLoadingUnappliedTickets.set(false);
      this.isLoadingStoredGrain.set(false);
      this.isLoadingDpContracts.set(false);
      this._loadCustomerData(customerId);

      // ...and if that copy has aged out, refresh it BEHIND the visible rows. No spinner: the screen is
      // already populated and correct as of the first read, so a flicker would be a downgrade. The swap
      // happens when the response lands.
      if (Date.now() - loadedAt >= HomeComponent.CUSTOMER_DATA_MAX_AGE_MS)
        this._refreshCustomerContractsAndTickets(customerId, scoularId);

      return;
    }

    let contractsDone = false;
    let ticketsDone = false;
    let grainDone = false;
    let dpDone = false;
    const markIfAllDone = () => {
      if (contractsDone && ticketsDone && grainDone && dpDone) this._customerLoadedAt.set(customerId, Date.now());
    };

    // One-shot convergence pass behind the first paint. The server may have answered from its warm
    // trade-unit cache (instant, but up to a few minutes old) with the live read started behind it;
    // re-reading once that read has landed swaps in anything that changed, silently, via the same
    // retract-then-replace path every background refresh uses. Cancelled if the user moves on.
    // Gated with the hover prefetch: there is nothing to converge on unless the backend answered from
    // a warm trade-unit cache with a live read behind it, which only the CTRM path does. Against ODS
    // the first answer is already the live one, so this would just read everything a second time.
    if (environment.ctrmReadAheadEnabled) {
      timer(HomeComponent.CLICK_CONVERGENCE_MS)
        .pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          if (this.selectedCustomer()?.id !== customerId) return;
          this._refreshCustomerContractsAndTickets(customerId, scoularId);
        });
    }

    // A hover prefetch may already hold this producer's contracts and tickets. They are applied through
    // the SAME functions the network path uses, so the only difference is that the click pays no round
    // trip. Bounded by age: anything older than the server's own live cache is discarded and refetched.
    const prefetched = this._takePrefetched(customerId);

    if (prefetched?.contracts) {
      this._applyCustomerContracts(customerId, prefetched.contracts);
      contractsDone = true;
      markIfAllDone();
    } else {
      this.apiService.getContractsByCustomer(customerId, scoularId).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (contracts) => {
          this._applyCustomerContracts(customerId, contracts);
          contractsDone = true;
          markIfAllDone();
        },
        error: (err) => {
          this.isLoadingContracts.set(false);
          this.contractsLoadError.set(readFailureMessage(err));
        }
      });
    }


    // Per-producer ticket fetch (applied + unapplied), scoped to this customer. Replaces the old
    // eager TU-wide bulk: applied tickets are matched server-side by the customer's open contract
    // numbers, so cross-customer / split-entity applied tickets still surface here.
    if (prefetched?.tickets) {
      this._applyCustomerTickets(customerId, prefetched.tickets);
      ticketsDone = true;
      markIfAllDone();
    } else {
      this._loadCustomerTickets(customerId, scoularId, () => { ticketsDone = true; markIfAllDone(); });
    }

    this.apiService.getStoredGrainByCustomer(customerId).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (grain) => {
        const existing = this.storedGrain();
        const merged = [...existing.filter(s => s.customerId !== customerId), ...grain];
        this.storedGrain.set(merged);
        this.appState.setStoredGrain(merged);
        this.isLoadingStoredGrain.set(false);
        this._loadCustomerData(customerId);
        grainDone = true;
        markIfAllDone();
      },
      error: () => { this.isLoadingStoredGrain.set(false); }
    });

    this.apiService.getDpContractsByCustomer(customerId).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (dp) => {
        // Per-producer merge, NOT a TU-wide load: it must not flip dpContractsLoaded, or Build A List
        // would treat this one producer's rows as the whole trade unit's DP set.
        this.appState.mergeCustomerDpContracts(customerId, dp);
        this.dpContracts.set(this.appState.dpContracts());
        this.isLoadingDpContracts.set(false);
        this._loadCustomerData(customerId);
        dpDone = true;
        markIfAllDone();
      },
      error: () => { this.isLoadingDpContracts.set(false); }
    });
  }

  /** Producers the pointer rested on, with their contracts and tickets already fetched. Consumed by the
   *  next click on that producer; anything older than the server's live cache is discarded unused. */
  private readonly _prefetched = new Map<number, { at: number; contracts?: Contract[]; tickets?: Ticket[] }>();
  private readonly _prefetchInFlight = new Set<number>();
  private static readonly PREFETCH_MAX_AGE_MS = 60_000;
  /** Two at once keeps ahead of a reader and stays small enough not to compete with the click. */
  private static readonly PREFETCH_MAX_IN_FLIGHT = 2;

  /** Warms one producer's data on hover so the click renders from memory. Deliberately touches no
   *  signal and no loading flag: results sit in a side map until the producer is actually selected, so a
   *  prefetch can never repaint the screen for a producer the user is not looking at. */
  handlePrefetchCustomer(customer: Customer): void {
    // Only worth a round trip when the backend is reading CTRM. Against ODS this is one extra read
    // per hovered row for no gain, on a page where scanning a list touches many rows.
    if (!environment.ctrmReadAheadEnabled) return;

    const id = customer.id;
    if (this.selectedCustomer()?.id === id) return;
    if (this._customerLoadedAt.has(id) || this._prefetched.has(id) || this._prefetchInFlight.has(id)) return;
    if (this._prefetchInFlight.size >= HomeComponent.PREFETCH_MAX_IN_FLIGHT) return;

    this._prefetchInFlight.add(id);
    const scoularId = customer.scoularId ?? undefined;
    forkJoin({
      contracts: this.apiService.getContractsByCustomer(id, scoularId).pipe(catchError(() => of(null))),
      tickets: this.apiService.getTicketsByCustomer(id, scoularId).pipe(catchError(() => of(null))),
      pricing: scoularId
        ? this.apiService.getPricingLinesByCustomer(scoularId).pipe(catchError(() => of(null)))
        : of(null),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(r => {
      this._prefetchInFlight.delete(id);
      // The user clicked before we finished; the real load has already run and owns the state.
      if (this._customerLoadedAt.has(id)) return;
      if (r.contracts || r.tickets) {
        this._prefetched.set(id, { at: Date.now(), contracts: r.contracts ?? undefined, tickets: r.tickets ?? undefined });
      }
      // Pricing lines already have a per-producer cache that the click path consults first.
      if (scoularId && r.pricing) {
        this._customerPricingCache.set(scoularId, r.pricing);
        this._customerPricingLoadedAt.set(scoularId, Date.now());
      }
    });
  }

  private _takePrefetched(customerId: number): { contracts?: Contract[]; tickets?: Ticket[] } | undefined {
    const entry = this._prefetched.get(customerId);
    this._prefetched.delete(customerId);
    if (!entry || Date.now() - entry.at > HomeComponent.PREFETCH_MAX_AGE_MS) return undefined;
    return entry;
  }

  /** Merges one producer's live contract read into the pool and re-derives the per-customer views.
   *  The per-customer response is a LIVE read with no date window; the pool it merges into is a cached
   *  window snapshot. So on an id collision the incoming row is the fresher of the two and must WIN. */
  private _applyCustomerContracts(customerId: number, contracts: Contract[], isRefresh = false): void {
    // Retract-then-replace, so a refresh can drop a contract that has closed out of the list as well as
    // update the ones still in it. See mergeProducerRows for why merging alone is not enough.
    const merged = mergeProducerRows(
      this.contracts(), contracts, this._customerRowIds.get(customerId)?.contracts, isRefresh);
    this._rememberRowIds(customerId, 'contracts', contracts.map(c => c.id));
    this.contracts.set(merged);
    this.appState.setContracts(merged);
    this.isLoadingContracts.set(false);
    this._loadCustomerData(customerId);
    // Re-run auto-save now that we have the complete contract list — tickets may have arrived first
    // and run auto-save before allCustomerContracts was populated.
    const customer = this.customers().find(c => c.id === customerId) || this.selectedCustomer();
    if (customer) this._autoSaveCommodities(customer, this.allCustomerTickets());
  }

  /** Merges one producer's ticket read into the LOCAL ticket signal and re-derives the views.
   *
   *  Replaces on id collision rather than skipping. The old version only pushed ids it had not seen,
   *  which meant a row already present from an earlier read - or from a TU-wide load - was never updated:
   *  a ticket applied to a contract or settled since then kept its stale status on screen, because the
   *  synthetic id does not change when the status does. */
  private _applyCustomerTickets(customerId: number, tickets: Ticket[], isRefresh = false): void {
    // Retract-then-replace. A ticket's synthetic id does not change when its status does, so replacement
    // is what lets an applied or settled ticket stop showing as unapplied.
    const merged = mergeProducerRows(
      this.tickets(), tickets, this._customerRowIds.get(customerId)?.tickets, isRefresh);
    this._rememberRowIds(customerId, 'tickets', tickets.map(t => t.id));
    this.tickets.set(merged);
    this.isLoadingUnappliedTickets.set(false);
    this._loadCustomerData(customerId);
    // Auto-save derives commodities from ticket ProductCodes; the edit dialog also merges
    // contracts' CommodityCode, so the commodity set stays complete.
    const customer = this.customers().find(c => c.id === customerId) || this.selectedCustomer();
    if (customer) this._autoSaveCommodities(customer, tickets);
  }
  /** Records which ids a producer's read contributed, so the next refresh can retract exactly those. */
  private _rememberRowIds(customerId: number, kind: 'contracts' | 'tickets', ids: number[]): void {
    const entry = this._customerRowIds.get(customerId)
      ?? { contracts: new Set<number>(), tickets: new Set<number>() };
    entry[kind] = new Set(ids);
    this._customerRowIds.set(customerId, entry);
  }

  /** Retries the producer's contract read after a failure, from the table's Retry button. */
  retryCustomerContracts(): void {
    const customer = this.selectedCustomer();
    if (!customer) return;
    this.contractsLoadError.set(null);
    this.isLoadingContracts.set(true);
    this.apiService.getContractsByCustomer(customer.id, customer.scoularId)
      .pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (contracts) => this._applyCustomerContracts(customer.id, contracts),
        error: (err) => {
          this.isLoadingContracts.set(false);
          this.contractsLoadError.set(readFailureMessage(err));
        }
      });
  }

  /** Retries the producer's ticket read after a failure, from the table's Retry button. */
  retryCustomerTickets(): void {
    const customer = this.selectedCustomer();
    if (!customer) return;
    this.ticketsLoadError.set(null);
    this.isLoadingUnappliedTickets.set(true);
    this._loadCustomerTickets(customer.id, customer.scoularId);
  }

  /** Loads one producer's tickets (applied + unapplied) into the LOCAL ticket signal and re-filters
   *  the per-customer views. Used on producer select and on navigation-restore. Deliberately does
   *  NOT write to appState.tickets — that signal is the TU-wide cache for list/NLQ queries only;
   *  polluting it with one producer's tickets would make the customer-list/build-list NLQ guard
   *  think the full TU set is loaded. Applied tickets are matched server-side by the customer's open
   *  contract numbers, so split / cross-CustomerCode applied tickets are included. */
  private _loadCustomerTickets(customerId: number, scoularId: string | undefined, onDone?: () => void): void {
    this.apiService.getTicketsByCustomer(customerId, scoularId)
      .pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tickets) => {
          this._applyCustomerTickets(customerId, tickets);
          onDone?.();
        },
        error: (err) => {
          this.isLoadingUnappliedTickets.set(false);
          this.ticketsLoadError.set(readFailureMessage(err));
        }
      });
  }

  private _loadCustomerData(customerId: number, customer?: Customer): void {
    const currentCustomer = customer || this.selectedCustomer();
    if (!currentCustomer) return;

    const { contracts: allContracts, tickets: allTickets } =
      producerContractsAndTickets(currentCustomer, this.contracts(), this.tickets());
    this.allCustomerContracts.set([...allContracts]);
    this.allCustomerTickets.set([...allTickets]);
    this.customerContracts.set([...allContracts]);
    this.customerTickets.set([...allTickets]);

    const allStored = this.storedGrain().filter(s => s.customerId === customerId);
    this.allCustomerStoredGrain.set([...allStored]);
    this.customerStoredGrain.set([...allStored]);

    const allDp = this.dpContracts().filter(d => d.customerId === customerId);
    this.allCustomerDpContracts.set([...allDp]);
    this.customerDpContracts.set([...allDp]);

    const linkedGroup = this.getLinkedGroup(currentCustomer);
    const linkedIds = new Set([customerId, ...linkedGroup.map(c => c.id)]);
    const codeMap = new Map<number, string>();
    [currentCustomer, ...linkedGroup].forEach(c => { if (c?.scoularId) codeMap.set(c.id, c.scoularId); });
    this.customerCodeMap.set(codeMap);
    // Pure recompute from the per-customer notes cache (hydrated by _ensureCustomerNotes) —
    // safe to call from every data-arrival callback, exactly like the filters above.
    this.notes.showNotesFor(linkedIds);
  }

  /** Producer ids with an auto-save PUT currently in flight — prevents the concurrent double-save race. */
  private readonly _autoSaveInFlight = new Set<number>();
  /** Producer ids whose auto-save was deferred while one was in flight — re-run once it completes. */
  private readonly _autoSavePending = new Set<number>();

  private _autoSaveCommodities(customer: Customer, customerTickets: Ticket[]): void {
    const sourceCommodities = commodityCodesFrom(customerTickets, this.allCustomerContracts());
    if (sourceCommodities.length === 0) return;

    const storedCommodities = customer.commodities || [];
    const hasNew = sourceCommodities.some(tc => !storedCommodities.includes(tc));
    if (!hasNew) return;

    // Serialize auto-saves per producer. This fires from BOTH the contracts- and tickets-arrival
    // callbacks on select; firing two PUTs concurrently races the upsert's child-row rebuild
    // (each deletes rows the other already deleted → 500). If one is already in flight for this
    // producer, defer and re-run once it finishes with the freshly-merged commodity set.
    if (this._autoSaveInFlight.has(customer.id)) {
      this._autoSavePending.add(customer.id);
      return;
    }
    this._autoSaveInFlight.add(customer.id);

    const merged = [...new Set([...storedCommodities, ...sourceCommodities])].sort();
    const existingPd = this.producerDetailsMap().get(customer.id);
    this.apiService.saveProducerDetails(customer.id, {
      scoularId: customer.scoularId || null,
      customerName: customer.name,
      totalAcres: existingPd?.totalAcres ?? null,
      primaryContact: existingPd?.primaryContact ?? null,
      primaryPhone: existingPd?.primaryPhone ?? null,
      commodities: merged.join(','),
      linkedProducerIds: existingPd?.linkedProducerIds ?? null,
      // grainOnFarm intentionally omitted — this save isn't editing grain on farm, and the server
      // preserves the existing rows when it is absent (a cached copy could be older than a teammate's edit).
    }).subscribe({
      next: (pd) => {
        const map = new Map(this.producerDetailsMap());
        map.set(pd.customerId, pd);
        this.producerDetailsMap.set(map);
        const updatedCustomer = { ...customer, commodities: merged };
        const customers = this.customers();
        const index = customers.findIndex(c => c.id === customer.id);
        if (index >= 0) {
          const updated = [...customers];
          updated[index] = updatedCustomer;
          this.customers.set(updated);
          // Mirror into the shared cache too. This local signal duplicates appState.customers, and
          // every other write site pushes both; this one didn't — so build-list, insights and
          // unshipped-bushels kept serving the pre-merge commodity list until the next full
          // trade-unit reload happened to overwrite it.
          this.appState.setCustomers(updated);
        }
        if (this.selectedCustomer()?.id === customer.id) this.selectedCustomer.set(updatedCustomer);
        this._autoSaveInFlight.delete(customer.id);
        // A deferred call arrived while this save was in flight — re-run once, now serialized, with
        // the freshly-merged customer so commodities from the later callback (e.g. contracts that
        // arrived after tickets) still get persisted.
        if (this._autoSavePending.delete(customer.id)) {
          const latest = this.customers().find(c => c.id === customer.id) || updatedCustomer;
          this._autoSaveCommodities(latest, this.allCustomerTickets());
        }
      },
      error: () => {
        this._autoSaveInFlight.delete(customer.id);
        this._autoSavePending.delete(customer.id);
      }
    });
  }

  /** Save handler for the edit dialog. Trade-unit assignment (if any) runs FIRST — for an
   *  onboarding candidate that PUT inserts them into dbo.Customer, which the ProducerDetails
   *  save then depends on (FK). Existing customers with no TU change skip straight to the
   *  details save, unchanged. */
  handleSaveCustomer(data: { customerId: number; acres: number; commodities: string[]; primaryContact: string; primaryPhone: string; contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[]; binSites: { siteKey: string; name: string; latitude?: number; longitude?: number; capacity?: number }[]; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean; grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number; bushelsSold?: number; targetBushels?: number; lastBid?: number; grade?: string }[]; intentionMoves?: { from: string; to: string }[] }): void {
    // Only call the trade-unit reconcile when the dialog flagged it safe + meaningful
    // (onboarding a candidate, or the manual TU set actually changed). A pure details edit
    // skips it entirely, and a failed TU-load never reconciles (so manual TUs can't be wiped).
    if (data.reconcileTradeUnits) {
      this.apiService.assignTradeUnits(data.customerId, data.tradeUnitCodes ?? []).subscribe({
        next: () => {
          // A brand-new onboarding: they're now in dbo.Customer — clear the candidate flag on
          // the selected record so we stay on this producer and notes / details unlock.
          const sel = this.selectedCustomer();
          if (sel?.id === data.customerId && sel.isOnboardCandidate) {
            this.toastService.success('Producer added and trade units assigned. Select that trade unit or group to see them.');
            this.selectedCustomer.set({ ...sel, isManual: true, isOnboardCandidate: false });
          }
          this._saveProducerDetailsAndLinks(data);
          this.planting.movePlantingIntentions(data.customerId, data.intentionMoves ?? []);
        },
        error: () => this.toastService.error('Failed to update trade units')
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
      error: () => this.toastService.error('Failed to save producer details')
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
            this.appState.setCustomers(arr);
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
          this.apiService.getCustomerBySourceId(linkedIdStr).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.appState.setCustomers(this.customers());
    this.appState.selectCustomer(updated);

    // Fetch any newly linked producers that aren't loaded yet so the dropdown updates
    // immediately. Recursive BFS (transitive) so newly added edges extend the group.
    this._fetchMissingLinkedProducers(updated);
    this._loadCustomerData(updated.id, updated);
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
      this._loadCustomerContractsAndTickets(customer.id, customer.scoularId);
      this._loadCustomerData(customer.id);
      this._ensureCustomerNotes(customer);
      this.planting.loadWithoutCache(customer.id);
    } else {
      // Linked customer is in a different trade unit — fetch them from the API
      this.apiService.getCustomerById(customerId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
          this._loadCustomerContractsAndTickets(fetched.id, fetched.scoularId);
          this._loadCustomerData(fetched.id);
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

  // ==========================================================================
  // Notes — delegated to HomeNotesStore
  // ==========================================================================

  addNote(payload: { content: string; mentions: NoteMention[] }): void {
    this.notes.addNote(payload);
  }

  toggleNotePin(note: Note): void {
    this.notes.toggleNotePin(note);
  }

  editNote(data: { noteId: number; content: string; mentions: NoteMention[] }): void {
    this.notes.editNote(data);
  }

  deleteNote(noteId: number): void {
    this.notes.deleteNote(noteId);
  }
}
