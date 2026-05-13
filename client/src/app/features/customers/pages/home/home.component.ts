import { Component, inject, signal, computed, DestroyRef, effect, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
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

    this.apiService.getTickets(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const list = data ?? [];
        const batchIds = new Set(list.map(t => t.id));
        const fkExtras = this.tickets().filter(t => !batchIds.has(t.id));
        this.tickets.set([...list, ...fkExtras]);
        // Merge into appState rather than overwrite — appState may have cross-TU tickets
        // (linked producers) that aren't in our local copy. Overwriting drops them and
        // breaks downstream pages (Insights) that depend on the global ticket set.
        const merged = [...this.tickets()];
        const have = new Set(merged.map(t => t.id));
        for (const t of this.appState.tickets()) {
          if (!have.has(t.id)) merged.push(t);
        }
        this.appState.setTickets(merged);
      },
      error: () => {}
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
        this._enrichSavedLists();
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

    const context: NlqFilterContext = {
      customers: this.customers(),
      contracts: this.contracts(),
      tickets: this.tickets(),
      notes: this.notes(),
      plantingIntentions: this.plantingIntentions(),
      storedGrain: this.storedGrain(),
      commodities: this.appState.commodities()
    };
    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0];
    this.savedLists.set(this.savedLists().map(list => {
      if (!forceRefresh && list.customerIds?.length) return list; // Already resolved
      // Resolve "I"/"me"/"my" to the user's name so author-based queries work
      const resolvedQuery = this.nlqFilterService.resolveUserReferences(list.query, account?.name ?? '', account?.username ?? '');
      const result = this.nlqFilterService.parseAndFilter(resolvedQuery, context);
      // If no patterns matched, the NLQ returned all customers — don't cache that as valid
      if (result.matchedPatterns.length === 0) return list;
      const refined = list.filters
        ? this.nlqFilterService.applyRefinementFilters(result.customers, list.filters, this.contracts(), this.notes())
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
      this.apiService.getProducerDetails(customer.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.isLoadingTickets.set(true);
    this.isLoadingStoredGrain.set(true);
    this._loadCustomerContractsAndTickets(customer.id, customer.scoularId);
    this._loadCustomerData(customer.id);
    this._fetchMissingLinkedProducers(customer);

    // Fetch planting intentions exactly once per customer selection.
    // _loadCustomerData is called multiple times (contracts, tickets, storedGrain callbacks),
    // so the fetch lives here instead to avoid triple API calls.
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

    // When no trade units are active, _loadAllData never ran so notes may be stale or missing.
    // Always refresh notes in this case so the selected customer's notes appear.
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
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ outgoing, incoming }) => {
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

      // Recurse into each newly-discovered customer so their own links (both
      // directions) get fetched too — completes the transitive closure.
      const discovered = [...outgoing, ...incoming]
        .filter((c): c is Customer => !!c && !visited.has(c.id));
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

  private _loadCustomerContractsAndTickets(customerId: number, scoularId?: string): void {
    if (scoularId) {
      this.apiService.getPricingLinesByCustomer(scoularId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (lines) => { this.customerPricingLines.set(lines); this.appState.setPricingLines(lines); },
        error: () => this.customerPricingLines.set([])
      });
    }

    this.apiService.getContractsByCustomer(customerId, scoularId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
      },
      error: () => { this.isLoadingContracts.set(false); }
    });

    this.apiService.getTicketsByCustomer(customerId, scoularId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (tickets) => {
        const existing = this.tickets();
        const merged = [...existing];
        tickets.forEach(t => { if (!merged.some(e => e.id === t.id)) merged.push(t); });
        this.tickets.set(merged);
        // Merge into appState rather than overwrite — see comment in load path above.
        const appMerged = [...merged];
        const have = new Set(appMerged.map(t => t.id));
        for (const t of this.appState.tickets()) {
          if (!have.has(t.id)) appMerged.push(t);
        }
        this.appState.setTickets(appMerged);
        this.isLoadingTickets.set(false);
        this._loadCustomerData(customerId);

        const customer = this.customers().find(c => c.id === customerId) || this.selectedCustomer();
        if (customer) this._autoSaveCommodities(customer, tickets);
      },
      error: () => { this.isLoadingTickets.set(false); }
    });

    this.apiService.getStoredGrainByCustomer(customerId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (grain) => {
        const existing = this.storedGrain();
        const merged = [...existing.filter(s => s.customerId !== customerId), ...grain];
        this.storedGrain.set(merged);
        this.appState.setStoredGrain(merged);
        this.isLoadingStoredGrain.set(false);
        this._loadCustomerData(customerId);
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

  handleSaveCustomer(data: { customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean }): void {
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

  addPlantingIntention(data: {crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}): void {
    const sel = this.selectedCustomer();
    if (!sel) return;
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
        this.toastService.success('Planting intention deleted');
      },
      error: () => this.toastService.error('Failed to delete planting intention')
    });
  }

  addNote(content: string): void {
    const sel = this.selectedCustomer();
    if (!sel) return;
    const tradeUnit = this.selectedTradeUnits().length === 1 ? this.selectedTradeUnits()[0] : undefined;
    this.apiService.createNote(sel.id, content, tradeUnit).subscribe({
      next: (note) => {
        this.notes.update(arr => [...arr, note]);
        this.appState.setNotes(this.notes());
        this.customerNotes.update(arr => this._sortNotes([...arr, note]));
        this.toastService.success('Note added');
      },
      error: () => this.toastService.error('Failed to add note')
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
