import { Component, inject, signal, computed, DestroyRef, effect, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { MsalService } from '@azure/msal-angular';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { NlqFilterService, NlqFilterContext } from '@core/services/nlq-filter.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, SavedList, ProducerDetails, ContractPricingLine, DashboardPlantingEstimate, Commodity } from '@models';
import { CustomerListComponent } from '../../components/customer-list/customer-list.component';
import { CustomerProfileComponent } from '../../components/customer-profile/customer-profile.component';
import { CustomerNotesComponent } from '../../components/customer-notes/customer-notes.component';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '@shared/components/card/card.component';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CustomerListComponent,
    CustomerProfileComponent,
    CustomerNotesComponent,
    CardComponent,
    CardContentComponent,
    CardHeaderComponent,
    CardTitleComponent
  ],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly msalService = inject(MsalService);
  private readonly toastService = inject(ToastService);
  private readonly nlqFilterService = inject(NlqFilterService);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _resizeHandler = () => this._checkMobile();
  private _isLoading = false;
  private _customerRequestId = 0;
  private _piRequestId = 0;
  /** Emits whenever the user picks a new customer. Every async call kicked off by
   *  handleSelectCustomer is piped through takeUntil(this) so the prior selection's
   *  in-flight HTTP requests are cancelled the moment a new producer is clicked —
   *  stops stale linked-producer / notes / planting calls from clogging the browser's
   *  connection pool while the newly-selected customer waits for free sockets. */
  private readonly _cancelSelection$ = new Subject<void>();
  /** Customers whose linked-producer BFS has already completed in this session.
   *  Re-clicking a producer that's in this set skips the entire BFS — the cache
   *  is already correct, so there's nothing new to fetch. */
  private readonly _linkedFetchDone = new Set<number>();
  /** Customers whose contracts / tickets / pricing-lines / stored-grain have
   *  already been fetched in this session. Re-clicking skips the four HTTP
   *  calls in _loadCustomerContractsAndTickets — the merged data is still in
   *  the signals from the first visit. Cleared when the user adds/removes a
   *  contract, ticket, or storage record (none of those mutate from this page
   *  today, so the cache is effectively read-only for the session). */
  private readonly _customerLoadDone = new Set<number>();
  /** Per-customer planting-intentions cache. Hydrated from the first visit's
   *  fetch; kept in sync by the add/edit/delete handlers. Subsequent visits to
   *  the same producer skip the network entirely. */
  private readonly _customerPlantingCache = new Map<number, PlantingIntention[]>();
  /** Per-customer pricing-lines cache keyed by scoularId. Pricing lines are
   *  hydrated OUTSIDE the _customerLoadDone short-circuit so that every click
   *  swaps to the right producer's lines (the contracts/tickets/grain short-
   *  circuit returned early before pricing lines were restored, leaving the
   *  panel showing the prior producer's data on re-click). */
  private readonly _customerPricingCache = new Map<string, ContractPricingLine[]>();

  // Public signals — template binds directly to these
  readonly customers = signal<Customer[]>([]);
  readonly contracts = signal<Contract[]>([]);
  readonly tickets = signal<Ticket[]>([]);
  readonly plantingIntentions = signal<PlantingIntention[]>([]);
  readonly notes = signal<Note[]>([]);
  readonly storedGrain = signal<StoredGrain[]>([]);
  readonly savedLists = signal<SavedList[]>([]);
  readonly producerDetailsMap = signal<Map<number, ProducerDetails>>(new Map());

  readonly selectedCustomer = signal<Customer | null>(null);
  /** True when the open-contracts table has its extra columns expanded — drops the Notes
   *  sidebar below the profile so the table gets the full page width. */
  readonly contractsWide = signal(false);
  readonly pendingContractId = signal<number | null>(null);
  readonly pendingTab = signal<string | null>(null);
  readonly pendingPlantingYear = signal<number | null>(null);
  readonly pendingTicketCrop = signal<string | null>(null);
  readonly selectedTradeUnits = signal<string[]>([]);
  readonly customerContracts = signal<Contract[]>([]);
  readonly customerTickets = signal<Ticket[]>([]);
  readonly customerPricingLines = signal<ContractPricingLine[]>([]);
  readonly customerNotes = signal<Note[]>([]);
  readonly customerCodeMap = signal<Map<number, string>>(new Map());
  readonly customerPlantingIntentions = signal<PlantingIntention[]>([]);
  readonly customerStoredGrain = signal<StoredGrain[]>([]);

  readonly allCustomerContracts = signal<Contract[]>([]);
  readonly allCustomerTickets = signal<Ticket[]>([]);
  readonly allCustomerPlantingIntentions = signal<PlantingIntention[]>([]);
  readonly allCustomerStoredGrain = signal<StoredGrain[]>([]);

  readonly yieldEstimateCrops = signal<string[]>([]);
  readonly yieldEstimates = signal<DashboardPlantingEstimate[]>([]);
  readonly commodities = signal<Commodity[]>([]);
  readonly isLoadingYieldData = signal(false);
  readonly isLoadingContracts = signal(false);
  readonly isLoadingTickets = signal(false);
  /** True only while the FAST per-customer unapplied-tickets fetch is in flight. Drives the
   *  spinner on the Unapplied Tickets tab specifically — separate from isLoadingTickets,
   *  which is the slow bulk's flag and stays true for 1–2 min while the contracts-table
   *  Applied Tickets section waits for the bulk to land. Without splitting these, the
   *  Unapplied tab would show a spinner overlaying its already-loaded data the whole time
   *  the bulk was still grinding. */
  readonly isLoadingUnappliedTickets = signal(false);
  /** True while the per-customer unapplied-tickets fetch is in flight AFTER the bulk has
   *  already populated appState. Used by the Applied Tickets section to show a subtle
   *  "more may still be loading" hint instead of a full Loading… state, since whatever's
   *  currently displayed is real (from the bulk) and might grow once the per-customer
   *  call surfaces cross-TU / cross-customer tickets. */
  readonly isBackfillingTickets = signal(false);
  readonly isLoadingPricingLines = signal(false);
  /** Set true once the bulk /api/tickets fetch returns (any result, including empty) for
   *  the current TU. Until it lands, contracts-table treats the Applied Tickets section as
   *  "still loading" so it doesn't show a misleading "(0)" while the bulk is in flight. */
  private _bulkTicketsArrived = false;
  readonly isLoadingStoredGrain = signal(false);
  readonly isLoadingPlanting = signal(true);

  readonly isMobile = signal(false);
  readonly loading = signal(false);

  readonly lastContactedDate = computed(() => {
    const notes = this.customerNotes();
    if (notes.length === 0) return 'Never';
    // Find the most recently CREATED note — don't use notes[0] since pinned notes sort
    // to the top but may have an old createdAt. modifiedAt reflects edits/pins, not contact.
    const lastNote = notes.reduce((latest, note) =>
      this._parseNoteTime(note.createdAt) > this._parseNoteTime(latest.createdAt) ? note : latest,
      notes[0]
    );
    const raw = typeof lastNote.createdAt === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(lastNote.createdAt as any)
      ? (lastNote.createdAt as any) + 'Z' : lastNote.createdAt;
    const date = new Date(raw);
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const noteMidnight = new Date(date);
    noteMidnight.setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.round((todayMidnight.getTime() - noteMidnight.getTime()) / (1000 * 60 * 60 * 24)));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  });


  private _pendingProducerDetails: ProducerDetails[] | null = null;
  // Customers fetched from outside the current trade unit filter (e.g. linked producers in other TUs)
  private readonly _crossTradeUnitCustomers = signal<Map<number, Customer>>(new Map());
  /** Flat array of cross-TU/linked producers fetched for the selected customer. Exposed so the
   *  customer list can resolve last-contacted dates through incoming linked producers when no TU
   *  is selected and the main customer roster is empty. */
  readonly crossTradeUnitCustomers = computed<Customer[]>(() => [...this._crossTradeUnitCustomers().values()]);

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

    // Keep notes in sync with appState — handles the case where the data-preload
    // delivers notes after _restoreStateFromService() already ran (restore path skips
    // _loadAllData so there is no notes subscription to pick up the arriving data).
    effect(() => {
      const stateNotes = this.appState.notes();
      untracked(() => this.notes.set(stateNotes));
    });

    // Mirror appState.tickets() into the home component's local tickets signal.
    // The bulk getTickets fires in both data-preload AND _loadAllData, but only the
    // _loadAllData path writes to this.tickets() directly. When data-preload wins the
    // race (or _loadAllData skips because customers were already cached), this effect
    // picks up the bulk's data, marks the bulk as arrived, and re-filters the selected
    // customer's per-customer ticket subset so applied tickets surface in the contracts
    // table. Without it, customerTickets stays frozen at whatever the per-customer
    // unapplied fetch returned and Applied Tickets renders "(0)".
    effect(() => {
      const stateTickets = this.appState.tickets();
      if (stateTickets.length === 0) return;
      untracked(() => {
        const localIds = new Set(this.tickets().map(t => t.id));
        const fresh = stateTickets.filter(t => !localIds.has(t.id));
        if (fresh.length === 0) return;
        this.tickets.set([...this.tickets(), ...fresh]);
        this._bulkTicketsArrived = true;
        this.isLoadingTickets.set(false);
        const sel = this.selectedCustomer();
        if (sel) this._loadCustomerData(sel.id);
      });
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
      this.tickets.set(this.appState.tickets());
      this.plantingIntentions.set(this.appState.plantingIntentions());
      this.isLoadingPlanting.set(false);
      this.notes.set(this.appState.notes());
      this.storedGrain.set(this.appState.storedGrain());
      this.savedLists.set(this.appState.savedLists());
      this._enrichSavedLists();

      // Stored grain may not have been preloaded yet — fetch if empty
      if (this.appState.storedGrain().length === 0) {
        this.apiService.getStoredGrain().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (data) => {
            this.storedGrain.set(data);
            this.appState.setStoredGrain(data);
          },
          error: () => {}
        });
      }

      const stateSelectedCustomer = this.appState.selectedCustomer();
      if (stateSelectedCustomer) {
        this.selectedCustomer.set(stateSelectedCustomer);
        this.customerPricingLines.set(this.appState.pricingLines());
        this._loadCustomerData(stateSelectedCustomer.id);
        // Re-fetch per-customer planting intentions on navigation back —
        // these are not stored in appState so they must be reloaded.
        this.allCustomerPlantingIntentions.set([]);
        this.customerPlantingIntentions.set([]);
        const piRequestId = ++this._piRequestId;
        this.apiService.getPlantingIntentionsByCustomer(stateSelectedCustomer.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (intentions) => {
              if (piRequestId !== this._piRequestId) return;
              this.allCustomerPlantingIntentions.set(intentions);
              this.customerPlantingIntentions.set(intentions);
            },
            error: () => {}
          });
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
        this.loading.set(false);
        this._isLoading = false;
        this._enrichSavedLists();

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
        this._enrichSavedLists(true);
      },
      error: () => {}
    });

    // Bulk tickets fetch — slow against the ODS view (minutes for some TUs) but runs in
    // the background so the home page is interactive immediately. The per-customer
    // unapplied fetch (kicked off on producer click) gives the user usable applied-tickets-
    // adjacent data fast; this bulk lands later and populates the applied-tickets-per-contract
    // view in contracts-table. data-preload also fires this; whichever returns first wins.
    this.apiService.getTickets(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const list = data ?? [];
        const batchIds = new Set(list.map(t => t.id));
        const fkExtras = this.tickets().filter(t => !batchIds.has(t.id));
        this.tickets.set([...list, ...fkExtras]);
        // Merge into appState rather than overwrite — appState may have cross-TU tickets
        // (linked producers) that aren't in our local copy. Overwriting would drop them
        // and break downstream pages (Insights) that depend on the global ticket set.
        const merged = [...this.tickets()];
        const have = new Set(merged.map(t => t.id));
        for (const t of this.appState.tickets()) {
          if (!have.has(t.id)) merged.push(t);
        }
        this.appState.setTickets(merged);
        // Bulk has landed — any Applied Tickets sections that were gated on
        // isLoadingTickets can stop spinning; the per-customer unapplied fetch (if still
        // in flight) silently backfills cross-TU/cross-customer tickets into the same signal.
        this._bulkTicketsArrived = true;
        this.isLoadingTickets.set(false);
        // If a producer is already selected, refilter their per-customer ticket views from
        // the freshly-arrived bulk. Without this, customerTickets stays frozen at whatever
        // the unapplied-only fetch returned (no applied tickets ever surface in the
        // contracts table when the user selects before the bulk lands).
        const sel = this.selectedCustomer();
        if (sel) this._loadCustomerData(sel.id);
      },
      error: () => {
        this._bulkTicketsArrived = true;
        this.isLoadingTickets.set(false);
      }
    });

    this.apiService.getPlantingIntentions(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const list = data ?? [];
        this.plantingIntentions.set(list);
        this.appState.setPlantingIntentions(list);
        this.isLoadingPlanting.set(false);
      },
      error: () => { this.isLoadingPlanting.set(false); }
    });

    this.apiService.getNotes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const list = data ?? [];
        this.notes.set(list);
        this.appState.setNotes(list);
        // Re-filter customer notes if a customer is already selected when notes arrive
        const sel = this.selectedCustomer();
        if (sel) this._loadCustomerData(sel.id);
      },
      error: () => {}
    });

    this.apiService.getStoredGrain(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const incoming = data ?? [];
        const existing = this.storedGrain();
        const seen = new Set(incoming.map(s => s.id));
        const merged = [...incoming, ...existing.filter(s => !seen.has(s.id))];
        this.storedGrain.set(merged);
        this.appState.setStoredGrain(merged);
        const sel = this.selectedCustomer();
        if (sel) this._loadCustomerData(sel.id);
      },
      error: () => {}
    });

    this._loadYieldData();

    this.apiService.getSavedLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const list = data ?? [];
        this.savedLists.set(list);
        this.appState.setSavedLists(list);
        // Always ensure the query library is in appState so customer-list (which renders the
        // saved list dropdown on this page) can resolve a saved list's prompt category by
        // queryText match. Cached after first fetch — both home and build-list reuse it.
        if (this.appState.queryLibrary().length === 0) {
          this.apiService.getQueryLibrary().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (items) => {
              this.appState.queryLibrary.set(items);
              // Re-evaluate saved lists with the now-available category fallback.
              this._enrichSavedLists(true);
            },
            error: () => this._enrichSavedLists()
          });
        } else {
          this._enrichSavedLists();
        }
      },
      error: () => {}
    });
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
      error: () => {}
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
        return {
          ...customer,
          totalAcres: pd.totalAcres ?? customer.totalAcres,
          binCapacity: pd.binCapacity ?? customer.binCapacity,
          primaryContact: pd.primaryContact ?? customer.primaryContact,
          commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()) : customer.commodities,
          linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : customer.linkedProducerIds
        };
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
        }
      }
    }
  }

  private _loadYieldData(): void {
    const key = [...this.selectedTradeUnits()].sort().join(',');
    if (!key) {
      this.yieldEstimates.set([]);
      this.yieldEstimateCrops.set([]);
      this.commodities.set([]);
      return;
    }

    this.isLoadingYieldData.set(true);
    let pending = 2;
    const done = () => { if (--pending === 0) this.isLoadingYieldData.set(false); };

    // Gather all unique planting years from intentions + contracts so we fetch
    // yield estimates for every year the user might select.
    const yearSet = new Set<number>();
    const currentYear = new Date().getFullYear();
    yearSet.add(currentYear);
    yearSet.add(currentYear - 1);
    for (const pi of this.plantingIntentions()) {
      if (pi.plantingYear) yearSet.add(pi.plantingYear);
    }
    for (const c of this.contracts()) {
      if (c.cropYear) yearSet.add(c.cropYear);
    }

    const yearCalls = [...yearSet].map(y =>
      this.apiService.getDashboardPlantingEstimates(key, y).pipe(catchError(() => of([] as DashboardPlantingEstimate[])))
    );
    forkJoin(yearCalls).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (results) => {
        // Merge all years — later years overwrite earlier for same crop key
        const map = new Map<string, DashboardPlantingEstimate>();
        for (const batch of results) {
          for (const est of batch) {
            // Key by crop + year to keep per-year estimates separate
            map.set(`${est.crop}|${est.plantingYear}`, est);
          }
        }
        const merged = [...map.values()];
        this.yieldEstimates.set(merged);
        this.yieldEstimateCrops.set([...new Set(merged.map(e => e.crop))]);
        done();
      },
      error: () => done()
    });

    this.apiService.getCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => { this.commodities.set(data); done(); },
      error: () => done()
    });
  }

  private _enrichSavedLists(forceRefresh = false): void {
    if (!this.savedLists().length || !this.customers().length) return;
    // Skip if all lists already have cached customerIds — unless forceRefresh is true
    // (e.g., when contracts/tickets/stored grain arrive after initial enrichment).
    if (!forceRefresh) {
      const needsEnrich = this.savedLists().some(l => !l.customerIds?.length);
      if (!needsEnrich) return;
    }

    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0];
    const context: NlqFilterContext = {
      customers: this.customers(),
      contracts: this.contracts(),
      tickets: this.tickets(),
      notes: this.notes(),
      plantingIntentions: this.plantingIntentions(),
      storedGrain: this.storedGrain(),
      commodities: this.appState.commodities(),
      // Thread identity through so saved-list "by me" filters work even when notes' CreatedBy
      // wasn't resolved to a display name on the API side.
      currentUserDisplayName: account?.name ?? '',
      currentUserUsername: account?.username ?? ''
    };
    const queryLibrary = this.appState.queryLibrary();
    this.savedLists.set(this.savedLists().map(list => {
      if (!forceRefresh && list.customerIds?.length) return list; // Already resolved
      // Resolve "I"/"me"/"my" to the user's name so author-based queries work
      const resolvedQuery = this.nlqFilterService.resolveUserReferences(list.query, account?.name ?? '', account?.username ?? '');
      const result = this.nlqFilterService.parseAndFilter(resolvedQuery, context);
      // If no patterns matched, the NLQ returned all customers — don't cache that as valid
      if (result.matchedPatterns.length === 0) return list;
      // Backfill _promptCategory if the saved list pre-dates the hint AND the query library
      // has a match for its queryText. Lets the dimension-aware crops filter in the service
      // still find the right category for older saved lists without requiring a re-save.
      let listFilters = list.filters;
      if (listFilters && !listFilters._promptCategory && queryLibrary.length > 0) {
        const qLower = list.query.trim().toLowerCase();
        const matched = queryLibrary.find(q => q.queryText.trim().toLowerCase() === qLower);
        if (matched?.category) listFilters = { ...listFilters, _promptCategory: matched.category };
      }
      const refined = listFilters
        ? this.nlqFilterService.applyRefinementFilters(result.customers, listFilters, this.contracts(), this.notes(), {
            tickets: this.tickets(),
            storedGrain: this.storedGrain(),
            plantingIntentions: this.plantingIntentions(),
            commodityConversions: this.appState.commodityConversions()
          })
        : result.customers;
      const ids = this.nlqFilterService.applyCustomerOverrides(
        refined.map(c => c.id), list.includedCustomerIds, list.excludedCustomerIds
      );
      return { ...list, customerIds: ids };
    }));
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
    // Clear stale customer list and notes immediately so the old unfiltered list and
    // wrong "last contacted" dates don't show while the new API calls are in flight.
    this.customers.set([]);
    this.appState.setCustomers([]);
    this.notes.set([]);
    this.appState.setNotes([]);
    // Drop the per-customer caches — TU change can include / exclude different
    // customers, and re-clicking a producer that overlaps the new TU must re-fetch
    // contracts/tickets/pricing/grain to reflect the new scope. Without this, the
    // _customerLoadDone short-circuit would serve stale data from the prior TU.
    this._customerLoadDone.clear();
    this._customerPricingCache.clear();
    this._customerPlantingCache.clear();
    this._linkedFetchDone.clear();
    // Cancel any in-flight per-customer requests (pricing lines, contracts, tickets,
    // grain, planting, notes, linked-producers) tied to the prior customer so they
    // don't write into signals after the new TU has loaded. Also clears the loading
    // flags they own so the UI doesn't get stuck showing "Loading…" for data that's
    // no longer arriving.
    this._cancelSelection$.next();
    this.isLoadingPricingLines.set(false);
    this.isBackfillingTickets.set(false);
    this.isLoadingUnappliedTickets.set(false);
    // New TU = new bulk fetch in flight — until it lands, customer clicks should gate
    // Applied Tickets on the bulk's loading state.
    this._bulkTicketsArrived = false;
    // Reset loading flag so an explicit user selection is never blocked by a
    // background load that may still be in-flight.
    this._isLoading = false;
    if (tradeUnits && tradeUnits.length > 0) {
      this._loadAllData(tradeUnits);
    } else {
      // No TU selected (e.g. after Reset) — load all notes without a TU filter so
      // customer list cards show correct "last contacted" dates in search results.
      // Without this, notes stay stale from the previous TU until a customer is clicked.
      this.apiService.getNotes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (data) => {
          // Discard if the user selected a TU while this request was in-flight —
          // _loadAllData will set the correct TU-filtered notes when it completes.
          if (this.selectedTradeUnits().length > 0) return;
          this.notes.set(data);
          this.appState.setNotes(data);
        },
        error: () => {}
      });
    }
  }

  handleSelectCustomer(customer: Customer, fromDeepLink = false): void {
    // Cancel everything still in flight from the prior customer selection so the
    // browser's connection pool isn't blocked by stale linked-producer / notes /
    // planting calls when the user clicks through producers quickly.
    this._cancelSelection$.next();
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
      customer = {
        ...customer,
        totalAcres: pd.totalAcres ?? customer.totalAcres,
        binCapacity: pd.binCapacity ?? customer.binCapacity,
        primaryContact: pd.primaryContact ?? customer.primaryContact,
        commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()) : customer.commodities,
        linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : customer.linkedProducerIds
      };
    } else {
      this.apiService.getProducerDetails(customer.id).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (details) => {
          const map = new Map(this.producerDetailsMap());
          map.set(details.customerId, details);
          this.producerDetailsMap.set(map);
          const sel = this.selectedCustomer();
          if (sel?.id === customer.id) {
            const updated = {
              ...sel,
              totalAcres: details.totalAcres ?? sel.totalAcres,
              binCapacity: details.binCapacity ?? sel.binCapacity,
              primaryContact: details.primaryContact ?? sel.primaryContact,
              commodities: details.commodities ? details.commodities.split(',').map(c => c.trim()) : sel.commodities,
              linkedProducerIds: details.linkedProducerIds ? details.linkedProducerIds.split(',').filter(Boolean) : sel.linkedProducerIds
            };
            this.selectedCustomer.set(updated);
            this._fetchMissingLinkedProducers(updated);
            this._loadCustomerData(updated.id, updated);
          }
        },
        error: () => {}
      });
    }

    this.selectedCustomer.set(customer);
    this.appState.selectCustomer(customer);
    this.isLoadingContracts.set(true);
    // Only show Loading on Applied Tickets (contracts-table) if the bulk fetch hasn't
    // returned yet. The Unapplied Tickets tab has its own flag below — driven by the fast
    // per-customer fetch — so its spinner clears in <1s instead of waiting on the bulk.
    this.isLoadingTickets.set(!this._bulkTicketsArrived);
    this.isLoadingUnappliedTickets.set(true);
    this.isLoadingStoredGrain.set(true);
    this._loadCustomerContractsAndTickets(customer.id, customer.scoularId);
    this._loadCustomerData(customer.id);
    this._fetchMissingLinkedProducers(customer);

    // Fetch planting intentions exactly once per customer selection.
    // _loadCustomerData is called multiple times (contracts, tickets, storedGrain callbacks),
    // so the fetch lives here instead to avoid triple API calls.
    // Cached on _customerPlantingCache after the first visit; subsequent clicks
    // hydrate from cache instead of re-fetching. add/edit/deletePlantingIntention
    // updates the cache alongside the live signals so it stays in sync.
    const cachedPi = this._customerPlantingCache.get(customer.id);
    if (cachedPi) {
      this.allCustomerPlantingIntentions.set(cachedPi);
      this.customerPlantingIntentions.set(cachedPi);
    } else {
      this.allCustomerPlantingIntentions.set([]);
      this.customerPlantingIntentions.set([]);
      const piRequestId = ++this._piRequestId;
      this.apiService.getPlantingIntentionsByCustomer(customer.id)
        .pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (intentions) => {
            if (piRequestId !== this._piRequestId) return;
            this.allCustomerPlantingIntentions.set(intentions);
            this.customerPlantingIntentions.set(intentions);
            this._customerPlantingCache.set(customer.id, intentions);
          },
          error: () => {}
        });
    }

    // When no trade units are active, _loadAllData never ran so notes may be stale or missing.
    // Always refresh notes in this case so the selected customer's notes appear.
    if (this.selectedTradeUnits().length === 0) {
      this.apiService.getNotes().pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (data) => {
          this.notes.set(data);
          this.appState.setNotes(data);
          const sel = this.selectedCustomer();
          if (sel) this._loadCustomerData(sel.id);
        },
        error: () => {}
      });
    }
  }

  /** Applies ProducerDetails enrichment onto a freshly-fetched Customer. */
  private _enrichCustomer(fetched: Customer): Customer {
    const pd = this.producerDetailsMap().get(fetched.id);
    if (!pd) return fetched;
    return {
      ...fetched,
      totalAcres: pd.totalAcres ?? fetched.totalAcres,
      binCapacity: pd.binCapacity ?? fetched.binCapacity,
      primaryContact: pd.primaryContact ?? fetched.primaryContact,
      commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()) : fetched.commodities,
      linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : fetched.linkedProducerIds
    };
  }

  /**
   * Fetches every producer transitively linked to `customer` (forward + reverse) and
   * populates `_crossTradeUnitCustomers` with the full group so `getLinkedGroup()` can
   * surface the whole chain — e.g. if A→B and A→C, viewing B still shows C via A.
   *
   * BFS walks the graph one hop at a time; each newly discovered customer's own links
   * are fetched recursively. `visited` guards against cycles. `MAX_GROUP_SIZE` is a
   * safety cap in case a customer is part of an unexpectedly large link web.
   */
  private _fetchMissingLinkedProducers(customer: Customer, visited: Set<number> = new Set()): void {
    const MAX_GROUP_SIZE = 25;
    if (visited.has(customer.id) || visited.size >= MAX_GROUP_SIZE) return;
    // Already fetched this producer's linked group earlier in the session — the
    // cache is correct, so skip the network round-trip entirely. This is what
    // makes re-clicking a producer (or hopping back and forth in a saved list)
    // instant after the first visit.
    if (this._linkedFetchDone.has(customer.id)) return;
    visited.add(customer.id);

    const linkedIds = customer.linkedProducerIds || [];
    const allCustomers = [...this.customers(), ...this._crossTradeUnitCustomers().values()];
    const missing = linkedIds.filter(sourceId =>
      !allCustomers.some(c => c.scoularId === sourceId)
    );

    // Outgoing: fetch each linked producer id this customer points to.
    const outgoingRequests = missing.map(sourceId =>
      this.apiService.getCustomerBySourceId(sourceId).pipe(catchError(() => of(null as Customer | null)))
    );

    // Incoming: fetch customers that link TO this one (reverse links). Needed so non-
    // loaded producers who reverse-link to this customer still appear in the dropdown.
    const incoming$ = customer.scoularId
      ? this.apiService.getCustomersLinkedTo(customer.scoularId)
      : of([] as Customer[]);

    // Nothing to fetch — skip network entirely.
    if (outgoingRequests.length === 0 && !customer.scoularId) return;

    forkJoin({
      outgoing: outgoingRequests.length > 0 ? forkJoin(outgoingRequests) : of([] as (Customer | null)[]),
      incoming: incoming$
    }).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe(({ outgoing, incoming }) => {
      // BFS finished for this customer — mark done so re-selecting skips the network.
      this._linkedFetchDone.add(customer.id);
      // Merge new fetches into the cache. Use .update() so concurrent BFS branches
      // from different customers don't clobber each other's additions.
      this._crossTradeUnitCustomers.update(current => {
        const next = new Map(current);
        for (const fetched of outgoing) {
          if (!fetched) continue;
          if (!next.has(fetched.id)) next.set(fetched.id, this._enrichCustomer(fetched));
        }
        for (const fetched of incoming) {
          if (!fetched || fetched.id === customer.id) continue;
          if (!next.has(fetched.id)) next.set(fetched.id, this._enrichCustomer(fetched));
        }
        return next;
      });

      const discovered = [...outgoing, ...incoming]
        .filter((c): c is Customer => !!c && !visited.has(c.id));

      // Fetch notes for every newly-discovered cross-TU customer. The bulk
      // /api/notes endpoint scopes by the user's selected TUs, so notes for a
      // linked producer in an unselected TU never come back through that path.
      // The per-customer endpoint has no TU filter — pull the linked producer's
      // notes individually and merge them into the local notes() signal so the
      // selected customer's activity summary, last-contacted, and inline notes
      // all see the linked-group's full history. We skip notes already present
      // (by id) to keep the merge idempotent across concurrent BFS recursions.
      const noteFetches = discovered
        .filter(c => c.id !== customer.id)
        .map(c => this.apiService.getNotesByCustomer(c.id).pipe(catchError(() => of([] as Note[]))));
      if (noteFetches.length > 0) {
        forkJoin(noteFetches).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe(noteLists => {
          const incomingNotes = noteLists.flat();
          if (incomingNotes.length === 0) return;
          this.notes.update(arr => {
            const seen = new Set(arr.map(n => n.id));
            const additions = incomingNotes.filter(n => !seen.has(n.id));
            return additions.length > 0 ? [...arr, ...additions] : arr;
          });
          this.appState.setNotes(this.notes());
          // Refresh the selected customer's note panel if it's the customer
          // whose chain we just expanded — picks up the freshly-fetched links.
          const sel = this.selectedCustomer();
          if (sel?.id === customer.id) this._loadCustomerData(sel.id);
        });
      }

      // Recurse into each newly-discovered customer so their own links (both
      // directions) get fetched too — completes the transitive closure.
      for (const next of discovered) {
        this._fetchMissingLinkedProducers(next, visited);
      }

      const sel = this.selectedCustomer();
      if (sel?.id === customer.id) this._loadCustomerData(sel.id);
    });
  }

  private _propagatePrimaryContact(linkedCustomer: Customer, primaryContact: string): void {
    const existingPd = this.producerDetailsMap().get(linkedCustomer.id);
    // Skip if the linked producer already has a primary contact
    if (existingPd?.primaryContact || linkedCustomer.primaryContact) return;

    this.apiService.saveProducerDetails(linkedCustomer.id, {
      scoularId: linkedCustomer.scoularId || null,
      customerName: linkedCustomer.name,
      totalAcres: existingPd?.totalAcres ?? null,
      binCapacity: existingPd?.binCapacity ?? null,
      primaryContact: primaryContact,
      commodities: existingPd?.commodities ?? null,
      linkedProducerIds: existingPd?.linkedProducerIds ?? ((linkedCustomer.linkedProducerIds || []).join(',') || null)
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (pd) => {
        const map = new Map(this.producerDetailsMap());
        map.set(pd.customerId, pd);
        this.producerDetailsMap.set(map);
        // Update the customer object in local state
        const updated = { ...linkedCustomer, primaryContact };
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
      error: () => {}
    });
  }

  /** Hydrate customerPricingLines for the selected producer. Always called on
   *  every click — independent of _customerLoadDone — so re-clicking a producer
   *  swaps to their pricing lines instead of leaving the prior producer's lines
   *  on screen. Cache hit = instant, no network. Cache miss = single fetch then
   *  populate. */
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
          this.isLoadingPricingLines.set(false);
        },
        error: () => {
          this.customerPricingLines.set([]);
          this.isLoadingPricingLines.set(false);
        }
      });
  }

  private _loadCustomerContractsAndTickets(customerId: number, scoularId?: string): void {
    // Pricing lines are handled OUTSIDE the _customerLoadDone short-circuit so
    // every click hydrates customerPricingLines for the right producer (the
    // short-circuit only covers contracts/tickets/grain). Without this,
    // re-clicking a previously-loaded producer left the panel showing the prior
    // producer's lines.
    this._loadCustomerPricingLines(scoularId);

    // Already fetched this customer's data in this session — the merged signals
    // still hold everything we got the first time. Just clear the loading flags
    // and re-run the local merge so the UI updates with the cached data.
    if (this._customerLoadDone.has(customerId)) {
      this.isLoadingContracts.set(false);
      this.isLoadingTickets.set(false);
      this.isLoadingUnappliedTickets.set(false);
      this.isBackfillingTickets.set(false);
      this.isLoadingStoredGrain.set(false);
      this._loadCustomerData(customerId);
      return;
    }

    let contractsDone = false;
    let ticketsDone = false;
    let grainDone = false;
    const markIfAllDone = () => {
      if (contractsDone && ticketsDone && grainDone) this._customerLoadDone.add(customerId);
    };

    this.apiService.getContractsByCustomer(customerId, scoularId).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (contracts) => {
        const existing = this.contracts();
        const merged = [...existing];
        contracts.forEach(c => { if (!merged.some(e => e.id === c.id)) merged.push(c); });
        this.contracts.set(merged);
        this.appState.setContracts(merged);
        this.isLoadingContracts.set(false);
        this._loadCustomerData(customerId);
        // Re-run auto-save now that we have the complete contract list — tickets may have
        // arrived first and run auto-save before allCustomerContracts was populated.
        const customer = this.customers().find(c => c.id === customerId) || this.selectedCustomer();
        if (customer) this._autoSaveCommodities(customer, this.allCustomerTickets());
        contractsDone = true;
        markIfAllDone();
      },
      error: () => { this.isLoadingContracts.set(false); }
    });

    // FAST per-producer UNAPPLIED-tickets fetch — narrow CustomerCode-scoped query (<1s) so
    // the unapplied tab populates immediately. Deliberately does NOT touch isLoadingTickets
    // or isBackfillingTickets — those are owned by the bulk getTickets in _loadAllData so the
    // contracts table keeps showing "(Loading…)" on Applied Tickets until the bulk lands. The
    // bulk's contract-number branch catches cross-customer / split-entity applied tickets that
    // this narrow CustomerCode-scoped fetch wouldn't see.
    this.apiService.getUnappliedTicketsByCustomer(customerId, scoularId).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (tickets) => {
        const existing = this.tickets();
        const merged = [...existing];
        tickets.forEach(t => { if (!merged.some(e => e.id === t.id)) merged.push(t); });
        this.tickets.set(merged);
        // Merge into appState rather than overwrite — appState carries the bulk's full set
        // (or whatever's arrived so far). Overwriting would drop cross-TU tickets that
        // downstream pages (Insights) depend on.
        const appMerged = [...merged];
        const have = new Set(appMerged.map(t => t.id));
        for (const t of this.appState.tickets()) {
          if (!have.has(t.id)) appMerged.push(t);
        }
        this.appState.setTickets(appMerged);
        // Unapplied tab can stop spinning the moment its narrow fetch returns. Applied
        // Tickets (contracts-table) continues to wait on the bulk via isLoadingTickets.
        this.isLoadingUnappliedTickets.set(false);
        this._loadCustomerData(customerId);

        // Auto-save derives commodities from tickets' ProductCode. The unapplied-only
        // set here is narrower than the full per-customer fetch used to be, but the edit
        // dialog merges in contracts' CommodityCode so it still gets a complete picture.
        const customer = this.customers().find(c => c.id === customerId) || this.selectedCustomer();
        if (customer) this._autoSaveCommodities(customer, tickets);
        ticketsDone = true;
        markIfAllDone();
      },
      error: () => {
        // Don't leave the Unapplied tab stuck spinning if the narrow fetch failed.
        this.isLoadingUnappliedTickets.set(false);
      }
    });

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
  }

  private _loadCustomerData(customerId: number, customer?: Customer): void {
    const currentCustomer = customer || this.selectedCustomer();
    if (!currentCustomer) return;

    const allContracts = this.contracts().filter(c => c.ctrmCustomerId === currentCustomer.scoularId);
    // Include tickets whose CustomerCode matches the customer (covers unapplied + same-customer
    // applied) AND tickets whose CtrmContractNumber is on one of this customer's contracts
    // (covers cross-entity / split-load tickets where the ticket's CustomerCode differs from
    // the contract's CtrmCustomerId — the backend now returns these; this filter must let them through).
    const customerContractIds = new Set(
      allContracts.map(c => c.sourceContractId).filter((s): s is string => !!s)
    );
    const allTickets = this.tickets().filter(t =>
      t.customerCode === currentCustomer.scoularId
      || (!!t.ctrmContractNumber && customerContractIds.has(t.ctrmContractNumber))
    );
    this.allCustomerContracts.set([...allContracts]);
    this.allCustomerTickets.set([...allTickets]);
    this.customerContracts.set([...allContracts]);
    this.customerTickets.set([...allTickets]);

    const allStored = this.storedGrain().filter(s => s.customerId === customerId);
    this.allCustomerStoredGrain.set([...allStored]);
    this.customerStoredGrain.set([...allStored]);

    const linkedGroup = this.getLinkedGroup(currentCustomer);
    const linkedIds = new Set([customerId, ...linkedGroup.map(c => c.id)]);
    const codeMap = new Map<number, string>();
    [currentCustomer, ...linkedGroup].forEach(c => { if (c?.scoularId) codeMap.set(c.id, c.scoularId); });
    this.customerCodeMap.set(codeMap);
    this.customerNotes.set(this._sortNotes(this.notes().filter(n => linkedIds.has(n.customerId))));
  }

  private _autoSaveCommodities(customer: Customer, customerTickets: Ticket[]): void {
    const ticketCommodities = [...new Set(customerTickets.map(t => t.productCode || '').filter(Boolean))];
    const contractCommodities = [...new Set(
      this.allCustomerContracts().map(c => c.commodityCode || '').filter(Boolean)
    )];
    const sourceCommodities = [...new Set([...ticketCommodities, ...contractCommodities])];
    if (sourceCommodities.length === 0) return;

    const storedCommodities = customer.commodities || [];
    const hasNew = sourceCommodities.some(tc => !storedCommodities.includes(tc));
    if (!hasNew) return;

    const merged = [...new Set([...storedCommodities, ...sourceCommodities])].sort();
    const existingPd = this.producerDetailsMap().get(customer.id);
    this.apiService.saveProducerDetails(customer.id, {
      scoularId: customer.scoularId || null,
      customerName: customer.name,
      totalAcres: existingPd?.totalAcres ?? null,
      binCapacity: existingPd?.binCapacity ?? null,
      primaryContact: existingPd?.primaryContact ?? null,
      commodities: merged.join(','),
      linkedProducerIds: existingPd?.linkedProducerIds ?? null
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
        }
        if (this.selectedCustomer()?.id === customer.id) this.selectedCustomer.set(updatedCustomer);
      },
      error: () => {}
    });
  }

  /** Save handler for the edit dialog. Trade-unit assignment (if any) runs FIRST — for an
   *  onboarding candidate that PUT inserts them into dbo.Customer, which the ProducerDetails
   *  save then depends on (FK). Existing customers with no TU change skip straight to the
   *  details save, unchanged. */
  handleSaveCustomer(data: { customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean }): void {
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
        },
        error: () => this.toastService.error('Failed to update trade units')
      });
    } else {
      this._saveProducerDetailsAndLinks(data);
    }
  }

  private _saveProducerDetailsAndLinks(data: { customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean }): void {
    const customers = this.customers();
    const sel = this.selectedCustomer();
    const customer = customers.find(c => c.id === data.customerId)
      || (sel?.id === data.customerId ? sel : null);
    if (!customer) return;

    const ticketCommodities = [...new Set(this.allCustomerTickets().map(t => t.productCode || '').filter(Boolean))];
    const contractCommodities = [...new Set(this.allCustomerContracts().map(c => c.commodityCode || '').filter(Boolean))];
    const allCommodities = [...new Set([...ticketCommodities, ...contractCommodities, ...data.commodities])].sort();

    const updated: Customer = {
      ...customer,
      totalAcres: data.acres,
      binCapacity: data.binCapacity,
      commodities: allCommodities,
      primaryContact: data.primaryContact,
      linkedProducerIds: data.linkedProducerIds,
      eSignEnabled: data.eSignEnabled
    };

    const savedCommodities = allCommodities.length > 0 ? allCommodities.join(',') : null;
    const savedLinkedIds = data.linkedProducerIds.length > 0 ? data.linkedProducerIds.join(',') : null;
    const savePayload = {
      scoularId: customer.scoularId || null,
      customerName: customer.name,
      totalAcres: data.acres || null,
      binCapacity: data.binCapacity || null,
      primaryContact: data.primaryContact || null,
      commodities: savedCommodities,
      linkedProducerIds: savedLinkedIds
    };

    const existingPd = this.producerDetailsMap().get(data.customerId);
    if (existingPd) {
      const map = new Map(this.producerDetailsMap());
      map.set(data.customerId, { ...existingPd, totalAcres: data.acres || undefined, binCapacity: data.binCapacity || undefined, primaryContact: data.primaryContact || undefined, commodities: savedCommodities ?? undefined, linkedProducerIds: savedLinkedIds ?? undefined });
      this.producerDetailsMap.set(map);
    }

    // Linked-producer membership just changed — invalidate the BFS cache so the
    // next visit to the affected customers re-walks the graph. We don't know the
    // full transitive set without re-walking, so the safest cheap fix is to clear
    // everything; the cache will rebuild lazily as the user clicks through.
    this._linkedFetchDone.clear();

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
        binCapacity: existingPd?.binCapacity ?? null,
        primaryContact: existingPd?.primaryContact ?? null,
        commodities: existingPd?.commodities ?? null,
        linkedProducerIds: updatedLinkedIds.length > 0 ? updatedLinkedIds.join(',') : null
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
        error: () => {}
      });
    }

    if (data.primaryContact) {
      // Propagate primary contact to ALL linked producers that don't have one yet
      const allKnown = [...this.customers(), ...this._crossTradeUnitCustomers().values()];
      for (const linkedIdStr of data.linkedProducerIds) {
        const linkedCustomer = allKnown.find(c => c.scoularId === linkedIdStr);
        if (linkedCustomer) {
          this._propagatePrimaryContact(linkedCustomer, data.primaryContact);
        } else {
          // Linked producer not loaded locally — fetch by sourceId then propagate
          this.apiService.getCustomerBySourceId(linkedIdStr).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (fetched) => {
              const cache = new Map(this._crossTradeUnitCustomers());
              cache.set(fetched.id, fetched);
              this._crossTradeUnitCustomers.set(cache);
              this._propagatePrimaryContact(fetched, data.primaryContact);
            },
            error: () => {}
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
  }

  /**
   * Returns every producer transitively linked to `customer` — both forward (customers
   * in `customer.linkedProducerIds`) and reverse (customers whose own `linkedProducerIds`
   * includes `customer.scoularId`) — walked until the connected component is
   * exhausted. Prevents infinite loops with a visited set. Caps at 50 members to avoid
   * worst-case fanout. Relies on `_fetchMissingLinkedProducers` having populated the
   * cache; if a transitively-linked producer isn't loaded yet, it's silently excluded
   * until its fetch completes and triggers a re-render.
   */
  getLinkedGroup(customer: Customer): Customer[] {
    const MAX_GROUP_SIZE = 50;
    const all = [...this.customers(), ...this._crossTradeUnitCustomers().values()];
    const bySourceId = new Map<string, Customer>();
    for (const c of all) {
      if (c.scoularId) bySourceId.set(c.scoularId, c);
    }

    const visited = new Set<number>([customer.id]);
    const result = new Map<number, Customer>();
    const queue: Customer[] = [customer];

    while (queue.length > 0 && visited.size < MAX_GROUP_SIZE) {
      const cur = queue.shift()!;

      // Forward: follow each id in the current customer's linkedProducerIds
      for (const sourceId of cur.linkedProducerIds || []) {
        const neighbor = bySourceId.get(sourceId);
        if (neighbor && !visited.has(neighbor.id)) {
          visited.add(neighbor.id);
          result.set(neighbor.id, neighbor);
          queue.push(neighbor);
        }
      }

      // Reverse: find anyone whose linkedProducerIds mentions the current customer
      const curSource = cur.scoularId || '';
      if (curSource) {
        for (const other of all) {
          if (visited.has(other.id)) continue;
          if ((other.linkedProducerIds || []).includes(curSource)) {
            visited.add(other.id);
            result.set(other.id, other);
            queue.push(other);
          }
        }
      }
    }
    return [...result.values()];
  }

  handleSelectLinkedCustomer(customerId: number): void {
    if (customerId === this.selectedCustomer()?.id) return;
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
      this.allCustomerPlantingIntentions.set([]);
      this.customerPlantingIntentions.set([]);
      const piRequestId = ++this._piRequestId;
      this.apiService.getPlantingIntentionsByCustomer(customer.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (intentions) => {
            if (piRequestId !== this._piRequestId) return;
            this.allCustomerPlantingIntentions.set(intentions);
            this.customerPlantingIntentions.set(intentions);
          },
          error: () => {}
        });
    } else {
      // Linked customer is in a different trade unit — fetch them from the API
      this.apiService.getCustomerById(customerId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (fetched) => {
          // Merge producer details if available
          const pd = this.producerDetailsMap().get(fetched.id);
          if (pd) {
            fetched = {
              ...fetched,
              totalAcres: pd.totalAcres ?? fetched.totalAcres,
              binCapacity: pd.binCapacity ?? fetched.binCapacity,
              primaryContact: pd.primaryContact ?? fetched.primaryContact,
              commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()) : fetched.commodities,
              linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : fetched.linkedProducerIds
            };
          }
          // Cache so getLinkedGroup can find them even though they're outside the TU filter
          const cache = new Map(this._crossTradeUnitCustomers());
          cache.set(fetched.id, fetched);
          this._crossTradeUnitCustomers.set(cache);
          this.selectedCustomer.set(fetched);
          this._fetchMissingLinkedProducers(fetched);
          this._loadCustomerContractsAndTickets(fetched.id, fetched.scoularId);
          this._loadCustomerData(fetched.id);
          this.allCustomerPlantingIntentions.set([]);
          this.customerPlantingIntentions.set([]);
          const piRequestId = ++this._piRequestId;
          this.apiService.getPlantingIntentionsByCustomer(fetched.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (intentions) => {
                if (piRequestId !== this._piRequestId) return;
                this.allCustomerPlantingIntentions.set(intentions);
                this.customerPlantingIntentions.set(intentions);
              },
              error: () => {}
            });
        },
        error: () => {}
      });
    }
    // Notes may not be loaded if no trade units are active — refresh so the linked
    // customer's notes appear even when _loadAllData was never called.
    if (this.selectedTradeUnits().length === 0) {
      this.apiService.getNotes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (data) => {
          this.notes.set(data);
          this.appState.setNotes(data);
          const sel = this.selectedCustomer();
          if (sel) this._loadCustomerData(sel.id);
        },
        error: () => {}
      });
    }
  }

  addPlantingIntention(data: {crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string, doubleCropGroupId?: string}): void {
    const sel = this.selectedCustomer();
    if (!sel) return;
    this.apiService.createPlantingIntention({
      customerId: sel.id, customerName: sel.name, customerCode: sel.scoularId || '',
      tradeUnit: data.tradeUnit, crop: data.crop, category: data.category, type: data.type,
      description: data.description, acres: data.acres, plantingYear: data.plantingYear,
      doubleCropGroupId: data.doubleCropGroupId
    }).subscribe({
      next: (intention) => {
        this.plantingIntentions.update(arr => [...arr, intention]);
        this.appState.setPlantingIntentions(this.plantingIntentions());
        this.customerPlantingIntentions.update(arr => [...arr, intention]);
        this.allCustomerPlantingIntentions.update(arr => [...arr, intention]);
        const cached = this._customerPlantingCache.get(sel.id);
        if (cached) this._customerPlantingCache.set(sel.id, [...cached, intention]);
        this.toastService.success('Planting intention added');
        this._ensureCommodityOnProducerDetails(sel, data.crop);
      },
      error: () => this.toastService.error('Failed to add planting intention')
    });
  }

  editPlantingIntention(data: {intentionId: number, crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number}): void {
    const sel = this.selectedCustomer();
    this.apiService.updatePlantingIntention(data.intentionId, {
      crop: data.crop, category: data.category, type: data.type, description: data.description, acres: data.acres, plantingYear: data.plantingYear
    }).subscribe({
      next: (updated) => {
        const update = (arr: PlantingIntention[]) => arr.map(p => p.id === data.intentionId ? updated : p);
        this.plantingIntentions.update(update);
        this.appState.setPlantingIntentions(this.plantingIntentions());
        this.customerPlantingIntentions.update(update);
        this.allCustomerPlantingIntentions.update(update);
        if (sel) {
          const cached = this._customerPlantingCache.get(sel.id);
          if (cached) this._customerPlantingCache.set(sel.id, update(cached));
        }
        this.toastService.success('Planting intention updated');
        if (sel) this._ensureCommodityOnProducerDetails(sel, data.crop);
      },
      error: () => this.toastService.error('Failed to update planting intention')
    });
  }

  /**
   * If the just-saved planting intention's crop isn't already on the producer's
   * details, persist it there so the producer's commodities list stays in sync.
   * Silent: any failure here is logged but doesn't surface to the user — the
   * intention itself was already saved successfully.
   */
  private _ensureCommodityOnProducerDetails(customer: Customer, cropCode: string): void {
    if (!cropCode) return;
    const existing = customer.commodities ?? [];
    const codeUpper = cropCode.trim().toUpperCase();
    const alreadyPresent = existing.some(c => c.trim().toUpperCase() === codeUpper);
    if (alreadyPresent) return;

    const updated = [...existing, cropCode.trim()];
    this.apiService.saveProducerDetails(customer.id, {
      scoularId: customer.scoularId ?? null,
      customerName: customer.name,
      totalAcres: customer.totalAcres ?? null,
      binCapacity: customer.binCapacity ?? null,
      primaryContact: customer.primaryContact ?? null,
      commodities: updated.join(','),
      linkedProducerIds: (customer.linkedProducerIds ?? []).join(','),
    }).subscribe({
      next: (savedDetails) => {
        // Reflect the new commodity in local state so the UI updates without a refresh.
        const updatedCustomer = { ...customer, commodities: updated };
        this.selectedCustomer.set(updatedCustomer);
        this.customers.update(arr => arr.map(c => c.id === customer.id ? updatedCustomer : c));
        // Keep the producer-details map in sync — same pattern as handleSaveCustomer.
        const map = new Map(this.producerDetailsMap());
        map.set(savedDetails.customerId, savedDetails);
        this.producerDetailsMap.set(map);
      },
      error: () => { /* non-blocking — intention saved successfully */ }
    });
  }

  deletePlantingIntention(intentionId: number): void {
    this.apiService.deletePlantingIntention(intentionId).subscribe({
      next: () => {
        const remove = (arr: PlantingIntention[]) => arr.filter(p => p.id !== intentionId);
        this.plantingIntentions.update(remove);
        this.appState.setPlantingIntentions(this.plantingIntentions());
        this.customerPlantingIntentions.update(remove);
        this.allCustomerPlantingIntentions.update(remove);
        const sel = this.selectedCustomer();
        if (sel) {
          const cached = this._customerPlantingCache.get(sel.id);
          if (cached) this._customerPlantingCache.set(sel.id, remove(cached));
        }
        this.toastService.success('Planting intention deleted');
      },
      error: () => this.toastService.error('Failed to delete planting intention')
    });
  }

  /** True while a createNote request is in flight. Bound to <app-customer-notes
   *  [isSavingNote]> so the textarea + button show a "Saving..." state and ignore
   *  repeat clicks during the round trip. */
  readonly isSavingNote = signal(false);
  /** Increments after each successful createNote. <app-customer-notes> watches
   *  this counter and clears its textarea only when it increments — so if the save
   *  fails, the user's typed content survives and they can retry. */
  readonly noteSaveSucceededCounter = signal(0);

  addNote(content: string): void {
    const sel = this.selectedCustomer();
    if (!sel) return;
    // Not-yet-onboarded producer: there's no dbo.Customer row for a note to attach to
    // (it FKs to Customer). Make them assign a trade unit + Save Changes first.
    if (sel.isOnboardCandidate) {
      this.toastService.error('Assign a trade unit and save this producer before adding notes.');
      return;
    }
    // Guard against overlapping submits at the parent layer too — covers any caller
    // that didn't honor the child's own isSavingNote disable.
    if (this.isSavingNote()) return;
    const tradeUnit = this.selectedTradeUnits().length === 1 ? this.selectedTradeUnits()[0] : undefined;
    this.isSavingNote.set(true);
    this.apiService.createNote(sel.id, content, tradeUnit).subscribe({
      next: (note) => {
        this.notes.update(arr => [...arr, note]);
        this.appState.setNotes(this.notes());
        this.customerNotes.update(arr => this._sortNotes([...arr, note]));
        this.toastService.success('Note added');
        // Increment FIRST so the child clears its textarea, then drop the flag.
        this.noteSaveSucceededCounter.update(n => n + 1);
        this.isSavingNote.set(false);
      },
      error: () => {
        this.toastService.error('Failed to add note');
        // Leave the success counter alone — the child keeps the text so the user
        // can retry. Just clear the in-flight flag so the button re-enables.
        this.isSavingNote.set(false);
      }
    });
  }

  private _parseNoteTime(ts: string | Date): number {
    if (!ts) return 0;
    // API returns bare ISO strings without Z suffix — treat as UTC consistently
    const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
    return new Date(raw).getTime();
  }

  private _sortNotes(notes: Note[]): Note[] {
    return notes.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const aTime = this._parseNoteTime(a.modifiedAt || a.createdAt);
      const bTime = this._parseNoteTime(b.modifiedAt || b.createdAt);
      return bTime - aTime;
    });
  }

  toggleNotePin(note: Note): void {
    this.apiService.toggleNotePin(note.id).subscribe({
      next: (updated) => {
        this.notes.update(arr => arr.map(n => n.id === updated.id ? updated : n));
        this.appState.setNotes(this.notes());
        this.customerNotes.update(arr =>
          this._sortNotes(arr.map(n => n.id === updated.id ? updated : n))
        );
        this.toastService.success(updated.isPinned ? 'Note pinned' : 'Note unpinned');
      },
      error: () => this.toastService.error('Failed to update note')
    });
  }

  editNote(data: { noteId: number; content: string }): void {
    this.apiService.updateNote(data.noteId, data.content).subscribe({
      next: (updated) => {
        this.notes.update(arr => arr.map(n => n.id === updated.id ? updated : n));
        this.appState.setNotes(this.notes());
        this.customerNotes.update(arr =>
          this._sortNotes(arr.map(n => n.id === updated.id ? updated : n))
        );
        this.toastService.success('Note updated');
      },
      error: () => this.toastService.error('Failed to update note')
    });
  }

  deleteNote(noteId: number): void {
    this.apiService.deleteNote(noteId).subscribe({
      next: () => {
        this.notes.update(arr => arr.filter(n => n.id !== noteId));
        this.appState.setNotes(this.notes());
        this.customerNotes.update(arr => arr.filter(n => n.id !== noteId));
        this.toastService.success('Note deleted');
      },
      error: () => this.toastService.error('Failed to delete note')
    });
  }
}
