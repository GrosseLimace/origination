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
import { UserRolesService } from '@core/services/user-roles.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, NoteLastContact, StoredGrain, SavedList, ProducerDetails, ContractPricingLine, DashboardPlantingEstimate, Commodity, NoteMention } from '@models';
import { CustomerListComponent } from '../../components/customer-list/customer-list.component';
import { CustomerProfileComponent } from '../../components/customer-profile/customer-profile.component';
import { CustomerNotesComponent } from '../../components/customer-notes/customer-notes.component';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '@shared/components/card/card.component';
import { CalculatorLauncherComponent } from '@features/calculators/components/calculator-launcher.component';
import { environment } from '@env/environment';
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
    CardTitleComponent,
    CalculatorLauncherComponent
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
  private readonly userRoles = inject(UserRolesService);
  private readonly destroyRef = inject(DestroyRef);

  /** Manager = holds the "Admin" app role (same gate as the Usage Dashboard). Enables the
   *  "Team Lists" tab in the Add-to-List dropdown. */
  readonly isManager = this.userRoles.isAdmin;
  /** Gates the floating calculator launcher (Profitability calc + future calculators). */
  readonly calculatorEnabled = environment.calculatorEnabled;
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
  /** Per-customer full-notes cache (Tier 2). Notes are no longer bulk-downloaded; the
   *  selected producer's linked group is fetched via getNotesByCustomer on selection and
   *  cached here for the session. Map.has distinguishes "fetched, zero notes" from "not
   *  fetched yet"; a failed fetch is NOT cached so the next selection retries. Kept in
   *  sync by the note CRUD handlers; cleared on TU change with the other caches. */
  private readonly _customerNotesCache = new Map<number, Note[]>();
  /** Guards the one-per-session background full-notes fetch used by saved-list enrichment. */
  private _notesFetchInFlight = false;
  /** Producer ids whose notes have already been re-fetched during the CURRENT selection.
   *  Reset when a new producer is selected. Lets _ensureCustomerNotes refresh each producer
   *  once per selection (so notes added by other reps show on re-click — stale-while-revalidate)
   *  without the several internal calls per selection (details-arrival, BFS) re-fetching. */
  private readonly _notesRefreshedThisSelection = new Set<number>();

  // Public signals — template binds directly to these
  readonly customers = signal<Customer[]>([]);
  readonly contracts = signal<Contract[]>([]);
  readonly tickets = signal<Ticket[]>([]);
  readonly plantingIntentions = signal<PlantingIntention[]>([]);
  /** Per-customer "last contacted" aggregate — the badge feed for the customer list.
   *  Covers ALL trade units (entitlement-filtered server-side) so linked producers in
   *  unselected TUs are represented without downloading any note bodies. Full notes are
   *  fetched per-producer on selection into _customerNotesCache. */
  readonly noteLastContacts = signal<NoteLastContact[]>([]);
  readonly storedGrain = signal<StoredGrain[]>([]);
  readonly savedLists = signal<SavedList[]>([]);
  /** Manager-only: saved lists tied to the selected TU(s) created by other users (overlap-matched
   *  server-side, enriched locally). Powers the Add-to-List "Team Lists" tab. */
  readonly teamSavedLists = signal<SavedList[]>([]);
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
  /** Saved lists whose trade units EXACTLY match the current selection — these are the lists the
   *  producer can be quick-added to from the profile header. Reads the enriched savedLists() so the
   *  Add-to-List checkboxes stay reactive after a toggle. */
  readonly savedListsForSelectedCustomer = computed<SavedList[]>(() => {
    const sel = this.selectedTradeUnits();
    if (sel.length === 0) return [];
    const set = new Set(sel);
    return this.savedLists().filter(l => {
      if (!l.tradeUnits) return false;
      const u = l.tradeUnits.split(',').map(x => x.trim()).filter(Boolean);
      return u.length === set.size && u.every(x => set.has(x));
    });
  });
  /** Manager-only team lists the producer can be quick-added to. Already TU-scoped (overlap) by the
   *  server; enriched locally so the checkboxes reflect query-derived membership too. */
  readonly teamListsForSelectedCustomer = computed<SavedList[]>(() =>
    this.selectedTradeUnits().length === 0 ? [] : this.teamSavedLists());
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
  /** True only while the FAST per-customer unapplied-tickets fetch is in flight. Drives the
   *  spinner on the Unapplied Tickets tab. */
  readonly isLoadingUnappliedTickets = signal(false);
  readonly isLoadingPricingLines = signal(false);
  readonly isLoadingStoredGrain = signal(false);
  readonly isLoadingPlanting = signal(true);
  /** True while the selected producer's (and linked group's) notes are being fetched.
   *  Drives the notes panel's loading state so a producer with notes doesn't flash
   *  "No notes yet" during the per-customer fetch. */
  readonly isLoadingNotes = signal(false);

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

    // Keep the last-contact aggregate in sync with appState — handles the case where the
    // data-preload delivers it after _restoreStateFromService() already ran (restore path
    // skips _loadAllData so there is no subscription to pick up the arriving data).
    effect(() => {
      const rows = this.appState.noteLastContacts();
      untracked(() => this.noteLastContacts.set(rows));
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
    // changes. Guarded inside _loadTeamLists so non-managers / empty selections clear the set.
    effect(() => {
      this.isManager();
      this.selectedTradeUnits();
      untracked(() => this._loadTeamLists());
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
        // Re-fetch this producer's tickets — they're no longer pre-loaded in appState.
        this.isLoadingUnappliedTickets.set(true);
        this._loadCustomerData(stateSelectedCustomer.id);
        this._loadCustomerTickets(stateSelectedCustomer.id, stateSelectedCustomer.scoularId);
        // Re-fetch the producer's (and linked group's) notes — the per-customer notes
        // cache is component-local, so navigation back must repopulate it (same pattern
        // as the tickets / planting re-fetch on restore).
        this._notesRefreshedThisSelection.clear();
        this._ensureCustomerNotes(stateSelectedCustomer);
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

    // Tickets are no longer bulk-loaded here. They're fetched per-producer on select (applied +
    // unapplied via _loadCustomerTickets) since applied tickets are only ever viewed on a selected
    // producer; list/NLQ ticket queries lazily fetch the TU-wide set themselves when needed.

    this.apiService.getPlantingIntentions(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const list = data ?? [];
        this.plantingIntentions.set(list);
        this.appState.setPlantingIntentions(list);
        this.isLoadingPlanting.set(false);
      },
      error: () => { this.isLoadingPlanting.set(false); }
    });

    // Last-contact aggregate instead of the full note download — the selected producer's
    // full notes load separately via _ensureCustomerNotes on selection.
    this._refreshLastContacts();

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
          grainOnFarm: pd.grainOnFarm ?? customer.grainOnFarm,
          primaryContact: pd.primaryContact ?? customer.primaryContact,
          primaryPhone: pd.primaryPhone ?? customer.primaryPhone,
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
    if (!this.customers().length) return;
    // Own lists: skip if all already have cached customerIds — unless forceRefresh (e.g. when
    // contracts/tickets/stored grain arrive after initial enrichment).
    const ownNeeds = forceRefresh || this.savedLists().some(l => !l.customerIds?.length);
    if (this.savedLists().length && ownNeeds) {
      this.savedLists.set(this._enrichLists(this.savedLists(), forceRefresh));
    }
    // Team lists (manager) follow the same enrichment so their checkboxes reflect query membership.
    const teamNeeds = forceRefresh || this.teamSavedLists().some(l => !l.customerIds?.length);
    if (this.teamSavedLists().length && teamNeeds) {
      this.teamSavedLists.set(this._enrichLists(this.teamSavedLists(), forceRefresh));
    }
    // The full note set (bodies/authors) is only needed for saved lists whose query or refine
    // filters actually read note CONTENT/authors/pinned/counts — recency lists ("not contacted…")
    // and every non-note list resolve from the last-contact aggregate. Only kick off the
    // background full-notes fetch when at least one UNRESOLVED list genuinely needs it, so a user
    // whose lists are all contracts/tickets/etc. never pays the notes download on home load.
    const listNeedsFullNotes = (l: SavedList) =>
      (forceRefresh || !l.customerIds?.length)
      && (this.nlqFilterService.queryNeedsFullNotes(l.query)
          || this.nlqFilterService.refineFiltersNeedFullNotes(l.filters));
    const anyNeedsFullNotes =
      this.savedLists().some(listNeedsFullNotes) || this.teamSavedLists().some(listNeedsFullNotes);
    if (anyNeedsFullNotes && !this.appState.notesLoaded()) {
      this._loadFullNotesForEnrichment();
    }
  }

  /** Background one-shot fetch of the full note set for saved-list NLQ enrichment. */
  private _loadFullNotesForEnrichment(): void {
    if (this._notesFetchInFlight || this.appState.notesLoaded()) return;
    this._notesFetchInFlight = true;
    this.apiService.getNotes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this._notesFetchInFlight = false;
        this.appState.setNotes(data ?? []);
        // Re-evaluate saved lists now that note-based queries have their data.
        this._enrichSavedLists(true);
      },
      error: () => { this._notesFetchInFlight = false; }
    });
  }

  /** Resolve each list's NLQ query + filters + included/excluded overrides into a cached
   *  `customerIds` array, using the page's currently-loaded data. Returns a new array. */
  private _enrichLists(lists: SavedList[], forceRefresh: boolean): SavedList[] {
    if (!lists.length || !this.customers().length) return lists;
    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0];
    const context: NlqFilterContext = {
      customers: this.customers(),
      contracts: this.contracts(),
      tickets: this.tickets(),
      // Full note set from the lazy NLQ cache — empty until a note-based list triggers
      // _loadFullNotesForEnrichment, which re-enriches once it lands.
      notes: this.appState.notes(),
      // Last-contact aggregate (always loaded) — powers recency/"never contacted" resolution
      // without the full note set.
      noteLastContacts: this.appState.noteLastContacts(),
      plantingIntentions: this.plantingIntentions(),
      storedGrain: this.storedGrain(),
      commodities: this.appState.commodities(),
      // Thread identity through so saved-list "by me" filters work even when notes' CreatedBy
      // wasn't resolved to a display name on the API side.
      currentUserDisplayName: account?.name ?? '',
      currentUserUsername: account?.username ?? ''
    };
    const queryLibrary = this.appState.queryLibrary();
    return lists.map(list => {
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
        ? this.nlqFilterService.applyRefinementFilters(result.customers, listFilters, this.contracts(), this.appState.notes(), {
            tickets: this.tickets(),
            storedGrain: this.storedGrain(),
            plantingIntentions: this.plantingIntentions(),
            commodityConversions: this.appState.commodityConversions(),
            noteLastContacts: this.appState.noteLastContacts()
          })
        : result.customers;
      const ids = this.nlqFilterService.applyCustomerOverrides(
        refined.map(c => c.id), list.includedCustomerIds, list.excludedCustomerIds
      );
      return { ...list, customerIds: ids };
    });
  }

  /** Manager-only: fetch the team lists tied to the selected TU(s) and enrich them. Clears the set
   *  for non-managers or when no TU is selected. */
  private _loadTeamLists(): void {
    const tus = this.selectedTradeUnits();
    if (!this.isManager() || tus.length === 0) {
      this.teamSavedLists.set([]);
      return;
    }
    this.apiService.getTeamSavedLists(tus.join(',')).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => this.teamSavedLists.set(this._enrichLists(data ?? [], true)),
      error: () => { /* supplementary view — leave the prior set in place */ }
    });
  }

  /**
   * Apply staged saved-list membership changes for the selected producer (from the profile
   * header's Save). Membership lives in each list's included/excluded arrays; we mutate those
   * (build-list rules), optimistically update + re-enrich locally, then persist each changed list
   * via a full PUT (updateSavedList blanks omitted fields, so every field is sent). One success
   * notification when all succeed; reverts everything on any error.
   */
  handleSaveSavedListMembership(changes: { listId: number; add: boolean }[]): void {
    const customer = this.selectedCustomer();
    if (!customer || changes.length === 0) return;
    const cid = customer.id;
    // A change may target the user's own list OR (for a manager) a team list — snapshot both for
    // revert and resolve each change against whichever set owns the id.
    const ownOriginals = this.savedLists();
    const teamOriginals = this.teamSavedLists();
    const ownWorking = [...ownOriginals];
    const teamWorking = [...teamOriginals];
    let ownChanged = false;
    let teamChanged = false;
    const updates$ = [];

    for (const ch of changes) {
      let working = ownWorking;
      let idx = ownWorking.findIndex(l => l.id === ch.listId);
      let isTeam = false;
      if (idx === -1) {
        idx = teamWorking.findIndex(l => l.id === ch.listId);
        working = teamWorking;
        isTeam = true;
      }
      if (idx === -1) continue;
      const list = working[idx];
      const included = new Set(list.includedCustomerIds ?? []);
      const excluded = new Set(list.excludedCustomerIds ?? []);
      if (ch.add) {
        excluded.delete(cid);
        included.add(cid);
      } else {
        // Mirror build-list: drop a manual add if present, else exclude a query-matched member.
        if (included.has(cid)) included.delete(cid);
        else excluded.add(cid);
      }
      const newIncluded = [...included];
      const newExcluded = [...excluded];
      // Drop cached customerIds so _enrichSavedLists rebuilds this list's membership.
      working[idx] = { ...list, includedCustomerIds: newIncluded, excludedCustomerIds: newExcluded, customerIds: undefined };
      if (isTeam) teamChanged = true; else ownChanged = true;
      updates$.push(this.apiService.updateSavedList(list.id, {
        name: list.name,
        query: list.query,
        tradeUnits: list.tradeUnits,
        filters: list.filters,
        includedCustomerIds: newIncluded,
        excludedCustomerIds: newExcluded,
      }));
    }
    if (updates$.length === 0) return;

    // Optimistic local apply, then persist all changed lists together.
    if (ownChanged) { this.savedLists.set(ownWorking); this.appState.setSavedLists(ownWorking); }
    if (teamChanged) { this.teamSavedLists.set(teamWorking); }
    this._enrichSavedLists(true);

    forkJoin(updates$).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toastService.success(
        updates$.length === 1 ? 'Saved list updated' : `${updates$.length} saved lists updated`
      ),
      error: () => {
        if (ownChanged) { this.savedLists.set(ownOriginals); this.appState.setSavedLists(ownOriginals); }
        if (teamChanged) { this.teamSavedLists.set(teamOriginals); }
        this._enrichSavedLists(true);
        this.toastService.error('Failed to save list changes');
      }
    });
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
    // _customerLoadDone short-circuit would serve stale data from the prior TU.
    // Notes are cleared for freshness parity: the next selection re-fetches, picking up
    // notes other users added since.
    this._customerLoadDone.clear();
    this._customerPricingCache.clear();
    this._customerPlantingCache.clear();
    this._customerNotesCache.clear();
    this._notesRefreshedThisSelection.clear();
    this._linkedFetchDone.clear();
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
      this._refreshLastContacts();
    }
  }

  /** Refreshes the per-customer last-contact aggregate (deduped in ApiService, so a
   *  concurrent data-preload request shares one HTTP call). Tiny payload — one row per
   *  customer with notes, no note bodies. */
  private _refreshLastContacts(): void {
    this.apiService.getNotesLastContact().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (rows) => {
        const list = rows ?? [];
        this.noteLastContacts.set(list);
        this.appState.setNoteLastContacts(list);
      },
      error: () => {}
    });
  }

  /**
   * Ensures the full notes for `customer` AND its currently-known linked group are loaded and
   * fresh, then recomputes the selected producer's notes panel + last-contact badges.
   *
   * Stale-while-revalidate: any cached notes render immediately (re-clicking a producer is
   * instant — no spinner flash), and every group member is re-fetched once per selection via
   * the per-customer endpoint so notes added by OTHER reps appear on re-click. The
   * _notesRefreshedThisSelection guard means the several internal calls per selection
   * (producer-details arrival, BFS completion) don't each re-fetch. The endpoint has no TU
   * filter, so linked producers in unselected trade units are fully covered. Failed fetches
   * aren't cached (and aren't marked refreshed), so they retry on the next trigger.
   */
  private _ensureCustomerNotes(customer: Customer): void {
    const groupIds = [...new Set([customer.id, ...this.getLinkedGroup(customer).map(c => c.id)])];

    // Show whatever's already cached right away — instant re-click, no spinner if we have data.
    const haveAnyCached = groupIds.some(id => this._customerNotesCache.has(id));
    if (haveAnyCached) {
      this.isLoadingNotes.set(false);
      const sel = this.selectedCustomer();
      if (sel) this._loadCustomerData(sel.id);
    }

    // Refresh each group member at most once per selection.
    const toFetch = groupIds.filter(id => !this._notesRefreshedThisSelection.has(id));
    if (toFetch.length === 0) {
      this.isLoadingNotes.set(false);
      return;
    }
    toFetch.forEach(id => this._notesRefreshedThisSelection.add(id));

    // Only show the spinner on a cold selection (nothing cached to display meanwhile).
    if (!haveAnyCached) this.isLoadingNotes.set(true);

    forkJoin(toFetch.map(id =>
      this.apiService.getNotesByCustomer(id).pipe(catchError(() => of(null as Note[] | null)))
    )).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (lists) => {
        lists.forEach((list, i) => {
          if (!list) {
            // Fetch failed — allow a later retry rather than caching a wrong empty.
            this._notesRefreshedThisSelection.delete(toFetch[i]);
            return;
          }
          this._customerNotesCache.set(toFetch[i], list);
          // Keep the list badge in step with the freshly-fetched notes (picks up other reps'
          // adds/deletes for this producer, consistent with the panel).
          this._recomputeLastContactFor(toFetch[i]);
        });
        this.isLoadingNotes.set(false);
        const sel = this.selectedCustomer();
        if (sel) this._loadCustomerData(sel.id);
      },
      error: () => this.isLoadingNotes.set(false)
    });
  }

  handleSelectCustomer(customer: Customer, fromDeepLink = false): void {
    // Cancel everything still in flight from the prior customer selection so the
    // browser's connection pool isn't blocked by stale linked-producer / notes /
    // planting calls when the user clicks through producers quickly.
    this._cancelSelection$.next();
    // New selection — allow each producer's notes to be re-fetched once so other reps' adds show.
    this._notesRefreshedThisSelection.clear();
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
              grainOnFarm: details.grainOnFarm ?? sel.grainOnFarm,
              primaryContact: details.primaryContact ?? sel.primaryContact,
              primaryPhone: details.primaryPhone ?? sel.primaryPhone,
              commodities: details.commodities ? details.commodities.split(',').map(c => c.trim()) : sel.commodities,
              linkedProducerIds: details.linkedProducerIds ? details.linkedProducerIds.split(',').filter(Boolean) : sel.linkedProducerIds
            };
            this.selectedCustomer.set(updated);
            this._fetchMissingLinkedProducers(updated);
            this._loadCustomerData(updated.id, updated);
            // linkedProducerIds may have just arrived/changed — make sure the (possibly
            // expanded) group's notes are cached so the panel shows the full history.
            this._ensureCustomerNotes(updated);
          }
        },
        error: () => {}
      });
    }

    this.selectedCustomer.set(customer);
    this.appState.selectCustomer(customer);
    this.isLoadingContracts.set(true);
    this.isLoadingUnappliedTickets.set(true);
    this.isLoadingStoredGrain.set(true);
    this._loadCustomerContractsAndTickets(customer.id, customer.scoularId);
    this._loadCustomerData(customer.id);
    this._fetchMissingLinkedProducers(customer);
    // Fetch this producer's (and known linked group's) full notes — notes are no longer
    // bulk-downloaded, so selection is what hydrates the notes panel. Cache-hit = instant.
    this._ensureCustomerNotes(customer);

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

    // (No-TU special case removed: the selected producer's notes come from the per-customer
    // fetch above, and the badge aggregate spans all trade units — both are TU-independent.)
  }

  /** Applies ProducerDetails enrichment onto a freshly-fetched Customer. */
  private _enrichCustomer(fetched: Customer): Customer {
    const pd = this.producerDetailsMap().get(fetched.id);
    if (!pd) return fetched;
    return {
      ...fetched,
      totalAcres: pd.totalAcres ?? fetched.totalAcres,
      binCapacity: pd.binCapacity ?? fetched.binCapacity,
      grainOnFarm: pd.grainOnFarm ?? fetched.grainOnFarm,
      primaryContact: pd.primaryContact ?? fetched.primaryContact,
      primaryPhone: pd.primaryPhone ?? fetched.primaryPhone,
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

      // Recurse into each newly-discovered customer so their own links (both
      // directions) get fetched too — completes the transitive closure.
      for (const next of discovered) {
        this._fetchMissingLinkedProducers(next, visited);
      }

      // The selected producer's linked group may have just expanded — top up the
      // per-customer notes cache for any newly-known members (the per-customer
      // endpoint has no TU filter, so linked producers in unselected trade units
      // are fully covered) and recompute the panel. Cache hits skip the network,
      // so BFS levels with no new members cost nothing.
      const sel = this.selectedCustomer();
      if (sel) this._ensureCustomerNotes(sel);
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
      primaryPhone: existingPd?.primaryPhone ?? null,  // preserve — this save only propagates the contact
      commodities: existingPd?.commodities ?? null,
      linkedProducerIds: existingPd?.linkedProducerIds ?? ((linkedCustomer.linkedProducerIds || []).join(',') || null),
      grainOnFarm: existingPd?.grainOnFarm ?? []  // preserve — this save isn't editing grain on farm
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
      this.isLoadingUnappliedTickets.set(false);
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

    // Per-producer ticket fetch (applied + unapplied), scoped to this customer. Replaces the old
    // eager TU-wide bulk: applied tickets are matched server-side by the customer's open contract
    // numbers, so cross-customer / split-entity applied tickets still surface here.
    this._loadCustomerTickets(customerId, scoularId, () => { ticketsDone = true; markIfAllDone(); });

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
          const merged = [...this.tickets()];
          tickets.forEach(t => { if (!merged.some(e => e.id === t.id)) merged.push(t); });
          this.tickets.set(merged);
          this.isLoadingUnappliedTickets.set(false);
          this._loadCustomerData(customerId);
          // Auto-save derives commodities from ticket ProductCodes; the edit dialog also merges
          // contracts' CommodityCode, so the commodity set stays complete.
          const customer = this.customers().find(c => c.id === customerId) || this.selectedCustomer();
          if (customer) this._autoSaveCommodities(customer, tickets);
          onDone?.();
        },
        error: () => {
          this.isLoadingUnappliedTickets.set(false);
        }
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
    // Pure recompute from the per-customer notes cache (hydrated by _ensureCustomerNotes) —
    // safe to call from every data-arrival callback, exactly like the filters above.
    this.customerNotes.set(this._sortNotes(
      [...linkedIds].flatMap(id => this._customerNotesCache.get(id) ?? [])
    ));
  }

  /** Producer ids with an auto-save PUT currently in flight — prevents the concurrent double-save race. */
  private readonly _autoSaveInFlight = new Set<number>();
  /** Producer ids whose auto-save was deferred while one was in flight — re-run once it completes. */
  private readonly _autoSavePending = new Set<number>();

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
      binCapacity: existingPd?.binCapacity ?? null,
      primaryContact: existingPd?.primaryContact ?? null,
      primaryPhone: existingPd?.primaryPhone ?? null,
      commodities: merged.join(','),
      linkedProducerIds: existingPd?.linkedProducerIds ?? null,
      grainOnFarm: existingPd?.grainOnFarm ?? []  // preserve — this save isn't editing grain on farm
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
  handleSaveCustomer(data: { customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; primaryPhone: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean; grainOnFarm: { commodityGroup: string; bushelsOnHand?: number; targetBushels?: number; grade?: string }[] }): void {
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

  private _saveProducerDetailsAndLinks(data: { customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; primaryPhone: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; grainOnFarm: { commodityGroup: string; bushelsOnHand?: number; targetBushels?: number; grade?: string }[] }): void {
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
      grainOnFarm: data.grainOnFarm,
      commodities: allCommodities,
      primaryContact: data.primaryContact,
      primaryPhone: data.primaryPhone,
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
      primaryPhone: data.primaryPhone || null,
      commodities: savedCommodities,
      linkedProducerIds: savedLinkedIds,
      grainOnFarm: data.grainOnFarm
    };

    const existingPd = this.producerDetailsMap().get(data.customerId);
    if (existingPd) {
      const map = new Map(this.producerDetailsMap());
      map.set(data.customerId, { ...existingPd, totalAcres: data.acres || undefined, binCapacity: data.binCapacity || undefined, primaryContact: data.primaryContact || undefined, primaryPhone: data.primaryPhone || undefined, commodities: savedCommodities ?? undefined, linkedProducerIds: savedLinkedIds ?? undefined, grainOnFarm: data.grainOnFarm });
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
      primaryPhone: existingPd?.primaryPhone ?? null,
        commodities: existingPd?.commodities ?? null,
        linkedProducerIds: updatedLinkedIds.length > 0 ? updatedLinkedIds.join(',') : null,
        grainOnFarm: existingPd?.grainOnFarm ?? []  // preserve — this save isn't editing grain on farm
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
    // A newly-linked producer that was ALREADY in the roster never goes through the BFS
    // network path, so make sure the expanded group's notes are cached for the panel.
    this._ensureCustomerNotes(updated);
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
    // New selection — allow each producer's notes to be re-fetched once (other reps' adds show).
    this._notesRefreshedThisSelection.clear();
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
              grainOnFarm: pd.grainOnFarm ?? fetched.grainOnFarm,
              primaryContact: pd.primaryContact ?? fetched.primaryContact,
      primaryPhone: pd.primaryPhone ?? fetched.primaryPhone,
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
          this._ensureCustomerNotes(fetched);
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
    // (No-TU special case removed: _ensureCustomerNotes above hydrates the linked
    // customer's notes via the per-customer endpoint, which is TU-independent.)
  }

  addPlantingIntention(data: {crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}): void {
    const sel = this.selectedCustomer();
    // Make a premature add (before a producer is selected/loaded) visible instead of a silent
    // no-op that reads as "the save did nothing / took two clicks".
    if (!sel) {
      console.warn('[PlantingIntentions] Add attempted with no producer selected — ignoring.');
      this.toastService.error('Select a producer before adding a planting intention.');
      return;
    }
    this.apiService.createPlantingIntention({
      customerId: sel.id, customerName: sel.name, customerCode: sel.scoularId || '',
      tradeUnit: data.tradeUnit, crop: data.crop, category: data.category, type: data.type,
      description: data.description, acres: data.acres, plantingYear: data.plantingYear
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
      error: (e: Error) => this.toastService.error(e?.message || 'Failed to add planting intention')
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
      error: (e: Error) => this.toastService.error(e?.message || 'Failed to update planting intention')
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
      primaryPhone: customer.primaryPhone ?? null,
      commodities: updated.join(','),
      linkedProducerIds: (customer.linkedProducerIds ?? []).join(','),
      grainOnFarm: customer.grainOnFarm ?? []  // preserve — this save isn't editing grain on farm
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

  addNote(payload: { content: string; mentions: NoteMention[] }): void {
    const { content, mentions } = payload;
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
    this.apiService.createNote(sel.id, content, tradeUnit, mentions).subscribe({
      next: (note) => {
        this._applyNoteToCache(note);
        this.customerNotes.update(arr => this._sortNotes([...arr, note]));
        this._recomputeLastContactFor(note.customerId);
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

  /** Inserts or replaces `note` in the per-customer notes cache and, when the full
   *  TU-wide NLQ cache has been lazily loaded, mirrors the change there so saved-list /
   *  build-list queries keep seeing fresh data. */
  private _applyNoteToCache(note: Note): void {
    const cached = this._customerNotesCache.get(note.customerId);
    if (cached) {
      const idx = cached.findIndex(n => n.id === note.id);
      this._customerNotesCache.set(note.customerId,
        idx >= 0 ? cached.map(n => n.id === note.id ? note : n) : [...cached, note]);
    } else {
      this._customerNotesCache.set(note.customerId, [note]);
    }
    if (this.appState.notesLoaded()) {
      const all = this.appState.notes();
      const idx = all.findIndex(n => n.id === note.id);
      this.appState.setNotes(idx >= 0 ? all.map(n => n.id === note.id ? note : n) : [...all, note]);
    }
  }

  /** Removes a note from the per-customer cache and (if loaded) the NLQ cache. */
  private _removeNoteFromCache(noteId: number, customerId: number): void {
    const cached = this._customerNotesCache.get(customerId);
    if (cached) this._customerNotesCache.set(customerId, cached.filter(n => n.id !== noteId));
    if (this.appState.notesLoaded()) {
      this.appState.setNotes(this.appState.notes().filter(n => n.id !== noteId));
    }
  }

  /** Recomputes the last-contact aggregate entry for one customer from the per-customer
   *  notes cache (which the CRUD handlers keep current). A customer whose last note was
   *  deleted drops back to "Never contacted"; a new note raises the badge date. */
  private _recomputeLastContactFor(customerId: number): void {
    const cached = this._customerNotesCache.get(customerId) ?? [];
    this.noteLastContacts.update(rows => {
      const rest = rows.filter(r => r.customerId !== customerId);
      if (cached.length === 0) return rest;
      const lastMs = cached.reduce((m, n) => Math.max(m, this._parseNoteTime(n.createdAt)), 0);
      const row: NoteLastContact = {
        customerId,
        customerCode: cached[0].customerCode,
        lastNoteAt: new Date(lastMs)
      };
      return [...rest, row];
    });
    this.appState.setNoteLastContacts(this.noteLastContacts());
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
        // Pin/unpin doesn't change createdAt, so the last-contact aggregate is untouched.
        this._applyNoteToCache(updated);
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
        // Content edits don't change createdAt, so the last-contact aggregate is untouched.
        this._applyNoteToCache(updated);
        this.customerNotes.update(arr =>
          this._sortNotes(arr.map(n => n.id === updated.id ? updated : n))
        );
        this.toastService.success('Note updated');
      },
      error: () => this.toastService.error('Failed to update note')
    });
  }

  deleteNote(noteId: number): void {
    // Resolve the note's owning customer BEFORE the delete — deletes come from the panel,
    // so the note is in customerNotes (possibly belonging to a linked producer).
    const target = this.customerNotes().find(n => n.id === noteId);
    this.apiService.deleteNote(noteId).subscribe({
      next: () => {
        if (target) {
          this._removeNoteFromCache(noteId, target.customerId);
          this._recomputeLastContactFor(target.customerId);
        }
        this.customerNotes.update(arr => arr.filter(n => n.id !== noteId));
        this.toastService.success('Note deleted');
      },
      error: () => this.toastService.error('Failed to delete note')
    });
  }
}
