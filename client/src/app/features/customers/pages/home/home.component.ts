import { Component, inject, signal, computed, DestroyRef, effect, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { NlqFilterService, NlqFilterContext } from '@core/services/nlq-filter.service';
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
  templateUrl: './home.component.html'
})
export class HomeComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly nlqFilterService = inject(NlqFilterService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);

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
      this.handleSelectCustomer(customer);
    } else {
      const checkInterval = setInterval(() => {
        const c = this.customers().find(cust => cust.id === customerIdNum);
        if (c) {
          clearInterval(checkInterval);
          this.handleSelectCustomer(c);
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
        this.customers.set(data);
        this.appState.setCustomers(data);
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
        const batchIds = new Set(data.map(c => c.id));
        const fkExtras = this.contracts().filter(c => !batchIds.has(c.id));
        this.contracts.set([...data, ...fkExtras]);
        this.appState.setContracts(this.contracts());
      },
      error: () => {}
    });

    this.apiService.getTickets(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const batchIds = new Set(data.map(t => t.id));
        const fkExtras = this.tickets().filter(t => !batchIds.has(t.id));
        this.tickets.set([...data, ...fkExtras]);
        this.appState.setTickets(this.tickets());
      },
      error: () => {}
    });

    this.apiService.getPlantingIntentions(this.selectedTradeUnits()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.plantingIntentions.set(data);
        this.appState.setPlantingIntentions(data);
        this.isLoadingPlanting.set(false);
      },
      error: () => { this.isLoadingPlanting.set(false); }
    });

    this.apiService.getNotes(this.selectedTradeUnits()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.notes.set(data);
        this.appState.setNotes(data);
        // Re-filter customer notes if a customer is already selected when notes arrive
        const sel = this.selectedCustomer();
        if (sel) this._loadCustomerData(sel.id);
      },
      error: () => {}
    });

    this.apiService.getStoredGrain(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.storedGrain.set(data);
        this.appState.setStoredGrain(data);
        // Re-filter stored grain if a customer is already selected when data arrives
        const sel = this.selectedCustomer();
        if (sel) this._loadCustomerData(sel.id);
      },
      error: () => {}
    });

    this._loadYieldData();

    this.apiService.getSavedLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.savedLists.set(data);
        this.appState.setSavedLists(data);
        this._enrichSavedLists();
      },
      error: () => {}
    });
  }

  private _loadProducerDetails(): void {
    this.apiService.getAllProducerDetails().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (details) => {
        const map = new Map(this.producerDetailsMap());
        details.forEach(d => map.set(d.customerId, d));
        this.producerDetailsMap.set(map);

        if (this.customers().length > 0) {
          this._mergeProducerDetails(details);
        } else {
          this._pendingProducerDetails = details;
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

  private _enrichSavedLists(): void {
    if (!this.savedLists().length || !this.customers().length) return;
    const context: NlqFilterContext = {
      customers: this.customers(),
      contracts: this.contracts(),
      tickets: this.tickets(),
      notes: this.notes(),
      plantingIntentions: this.plantingIntentions(),
      storedGrain: this.storedGrain()
    };
    this.savedLists.set(this.savedLists().map(list => {
      const nlqCustomers = this.nlqFilterService.parseAndFilter(list.query, context).customers;
      const refined = list.filters
        ? this.nlqFilterService.applyRefinementFilters(nlqCustomers, list.filters, this.contracts(), this.notes())
        : nlqCustomers;
      return { ...list, customerIds: refined.map(c => c.id) };
    }));
  }

  handleClearSelection(): void {
    this.selectedCustomer.set(null);
    this.appState.selectCustomer(null);
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

  handleSelectCustomer(customer: Customer): void {
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
    this._loadCustomerContractsAndTickets(customer.id, customer.sourceCustomerId);
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

  private _fetchMissingLinkedProducers(customer: Customer): void {
    const linkedIds = customer.linkedProducerIds || [];
    if (linkedIds.length === 0) return;

    const allCustomers = [...this.customers(), ...this._crossTradeUnitCustomers().values()];
    const missing = linkedIds.filter(sourceId =>
      !allCustomers.some(c => c.sourceCustomerId === sourceId)
    );
    if (missing.length === 0) return;

    // Fetch all missing linked producers in parallel, update UI once when all resolve
    const requests = missing.map(sourceId =>
      this.apiService.getCustomerBySourceId(sourceId).pipe(catchError(() => of(null as Customer | null)))
    );
    forkJoin(requests).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(results => {
      const cache = new Map(this._crossTradeUnitCustomers());
      for (let fetched of results) {
        if (!fetched) continue;
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
        cache.set(fetched.id, fetched);
      }
      this._crossTradeUnitCustomers.set(cache);
      const sel = this.selectedCustomer();
      if (sel?.id === customer.id) this._loadCustomerData(sel.id);
    });
  }

  private _propagatePrimaryContact(linkedCustomer: Customer, primaryContact: string): void {
    const existingPd = this.producerDetailsMap().get(linkedCustomer.id);
    // Skip if the linked producer already has a primary contact
    if (existingPd?.primaryContact || linkedCustomer.primaryContact) return;

    this.apiService.saveProducerDetails(linkedCustomer.id, {
      sourceCustomerId: linkedCustomer.sourceCustomerId || null,
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

  private _loadCustomerContractsAndTickets(customerId: number, sourceCustomerId?: string): void {
    if (sourceCustomerId) {
      this.apiService.getPricingLinesByCustomer(sourceCustomerId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (lines) => { this.customerPricingLines.set(lines); this.appState.setPricingLines(lines); },
        error: () => this.customerPricingLines.set([])
      });
    }

    this.apiService.getContractsByCustomer(customerId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

    this.apiService.getTicketsByCustomer(customerId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (tickets) => {
        const existing = this.tickets();
        const merged = [...existing];
        tickets.forEach(t => { if (!merged.some(e => e.id === t.id)) merged.push(t); });
        this.tickets.set(merged);
        this.appState.setTickets(merged);
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

    const allContracts = this.contracts().filter(c => c.ctrmCustomerId === currentCustomer.sourceCustomerId);
    const allTickets = this.tickets().filter(t => t.customerCode === currentCustomer.sourceCustomerId);
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
    [currentCustomer, ...linkedGroup].forEach(c => { if (c?.sourceCustomerId) codeMap.set(c.id, c.sourceCustomerId); });
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
      sourceCustomerId: customer.sourceCustomerId || null,
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
      sourceCustomerId: customer.sourceCustomerId || null,
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
        this.toastService.success('Customer updated successfully');
      },
      error: () => this.toastService.error('Failed to save producer details')
    });

    for (const linkedIdStr of data.removedIncomingIds) {
      const linkedCustomer = this.customers().find(c => c.sourceCustomerId === linkedIdStr);
      if (!linkedCustomer) continue;
      const currentSourceId = customer.sourceCustomerId || '';
      const updatedLinkedIds = (linkedCustomer.linkedProducerIds || []).filter(id => id !== currentSourceId);
      const linkedId = linkedCustomer.id;
      const existingPd = this.producerDetailsMap().get(linkedId);
      this.apiService.saveProducerDetails(linkedId, {
        sourceCustomerId: linkedCustomer.sourceCustomerId || null,
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
          const idx = this.customers().findIndex(c => c.id === linkedId);
          if (idx >= 0) {
            const arr = [...this.customers()];
            arr[idx] = updatedLinkedCustomer;
            this.customers.set(arr);
            this.appState.setCustomers(arr);
          }
        },
        error: () => {}
      });
    }

    if (data.primaryContact) {
      // Propagate primary contact to ALL linked producers that don't have one yet
      const allKnown = [...this.customers(), ...this._crossTradeUnitCustomers().values()];
      for (const linkedIdStr of data.linkedProducerIds) {
        const linkedCustomer = allKnown.find(c => c.sourceCustomerId === linkedIdStr);
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

    this.selectedCustomer.set(updated);
    this.appState.setCustomers(this.customers());
    this.appState.selectCustomer(updated);

    // Fetch any newly linked producers that aren't loaded yet so the dropdown updates immediately
    this._fetchMissingLinkedProducers(updated);
    this._loadCustomerData(updated.id, updated);
  }

  getLinkedGroup(customer: Customer): Customer[] {
    const all = [...this.customers(), ...this._crossTradeUnitCustomers().values()];
    const outgoing = (customer.linkedProducerIds || [])
      .map(id => all.find(c => c.sourceCustomerId === id))
      .filter((c): c is Customer => !!c);
    const incoming = all.filter(c =>
      c.id !== customer.id &&
      (c.linkedProducerIds || []).includes(customer.sourceCustomerId || '')
    );
    return [...new Map([...outgoing, ...incoming].map(c => [c.id, c])).values()];
  }

  handleSelectLinkedCustomer(customerId: number): void {
    if (customerId === this.selectedCustomer()?.id) return;
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
      this._loadCustomerContractsAndTickets(customer.id, customer.sourceCustomerId);
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
          this._loadCustomerContractsAndTickets(fetched.id, fetched.sourceCustomerId);
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

  addPlantingIntention(data: {crop: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}): void {
    const sel = this.selectedCustomer();
    if (!sel) return;
    this.apiService.createPlantingIntention({
      customerId: sel.id, customerName: sel.name, customerCode: sel.sourceCustomerId || '',
      tradeUnit: data.tradeUnit, crop: data.crop, type: data.type,
      description: data.description, acres: data.acres, plantingYear: data.plantingYear
    }).subscribe({
      next: (intention) => {
        this.plantingIntentions.update(arr => [...arr, intention]);
        this.appState.setPlantingIntentions(this.plantingIntentions());
        this.customerPlantingIntentions.update(arr => [...arr, intention]);
        this.allCustomerPlantingIntentions.update(arr => [...arr, intention]);
        this.toastService.success('Planting intention added');
      },
      error: () => this.toastService.error('Failed to add planting intention')
    });
  }

  editPlantingIntention(data: {intentionId: number, crop: string, type?: string, description?: string, acres: number, plantingYear: number}): void {
    this.apiService.updatePlantingIntention(data.intentionId, {
      crop: data.crop, type: data.type, description: data.description, acres: data.acres, plantingYear: data.plantingYear
    }).subscribe({
      next: (updated) => {
        const update = (arr: PlantingIntention[]) => arr.map(p => p.id === data.intentionId ? updated : p);
        this.plantingIntentions.update(update);
        this.appState.setPlantingIntentions(this.plantingIntentions());
        this.customerPlantingIntentions.update(update);
        this.allCustomerPlantingIntentions.update(update);
        this.toastService.success('Planting intention updated');
      },
      error: () => this.toastService.error('Failed to update planting intention')
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
