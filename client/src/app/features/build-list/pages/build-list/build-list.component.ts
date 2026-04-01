import { Component, ChangeDetectionStrategy, DestroyRef, inject, effect, untracked, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of, catchError, timeout } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppStateService, BuildListState } from '@core/services/app-state.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { ToastService } from '@core/services/toast.service';
import { NlqFilterService, NlqFilterContext } from '@core/services/nlq-filter.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, SavedList, ProducerDetails, RefinementFilters } from '@models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '@shared/components/card/card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '@shared/components/dialog/dialog.component';
import { InputComponent } from '@shared/components/input/input.component';
import { CustomerMapComponent } from '@features/customers/components/map/customer-map.component';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';

@Component({
  selector: 'app-build-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    CardContentComponent,
    CardHeaderComponent,
    CardTitleComponent,
    CardDescriptionComponent,
    ButtonComponent,
    BadgeComponent,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogContentComponent,
    DialogFooterComponent,
    InputComponent,
    CustomerMapComponent,
    TradeUnitSelectorComponent
  ],
  templateUrl: './build-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BuildListComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly dataPreloadService = inject(DataPreloadService);
  private readonly toastService = inject(ToastService);
  private readonly nlqFilterService = inject(NlqFilterService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Trade units captured at init — used to detect changes on destroy
  private _initTradeUnits: string[] = [];
  private _initialized = false;
  private _ticketsReady = false;
  private _loadRequestId = 0;
  private _queryGenId = 0;
  // All trade units the user can access (union of all groups from Entitlements DB)
  private _allUserTradeUnits = signal<string[]>([]);

  private _tuEffect = effect(() => {
    this.appState.selectedTradeUnits();
    if (!this._initialized) {
      this._initialized = true;
      return;
    }
    untracked(() => {
      this.clearQuery();
      const tus = this.appState.selectedTradeUnits();
      this._initTradeUnits = tus.slice(); // Update so destroy handler saves state correctly
      if (tus.length > 0) {
        this._loadFresh(true); // TU changed — clear stale data
      }
    });
  });

  customers = signal<Customer[]>([]);
  contracts = signal<Contract[]>([]);
  tickets = signal<Ticket[]>([]);
  plantingIntentions = signal<PlantingIntention[]>([]);
  notes = signal<Note[]>([]);
  storedGrain = signal<StoredGrain[]>([]);
  savedLists = signal<SavedList[]>([]);

  /** Returns the effective trade units — explicit selection if any, otherwise all user-accessible TUs. */
  readonly effectiveTradeUnits = computed(() => {
    const explicit = this.appState.selectedTradeUnits();
    return explicit.length > 0 ? explicit : this._allUserTradeUnits();
  });


  readonly hasTradeUnits = computed(() => this.effectiveTradeUnits().length > 0);

  /** Only show saved lists whose trade units exactly match the currently selected TUs. */
  readonly visibleSavedLists = computed(() => {
    const selectedTus = this.appState.selectedTradeUnits();
    if (selectedTus.length === 0) return [];
    const selectedSet = new Set(selectedTus);
    return this.savedLists().filter(list => {
      if (!list.tradeUnits) return false;
      const listTus = list.tradeUnits.split(',').map(t => t.trim()).filter(Boolean);
      if (listTus.length !== selectedSet.size) return false;
      return listTus.every(tu => selectedSet.has(tu));
    });
  });

  readonly activeRefinementCount = computed(() => {
    const r = this.appliedRefinements();
    return [
      r.noActiveContracts,
      r.hasUnsignedContracts,
      r.hasNegativePacing,
      r.neverContacted,
      r.notContactedDays != null && r.notContactedDays > 0,
      r.crops && r.crops.length > 0,
      r.states && r.states.length > 0
    ].filter(Boolean).length;
  });

  readonly displayedCustomers = computed(() => {
    let list = this.filteredCustomers();
    const r = this.appliedRefinements();
    const contractMap = this._contractsByCustomer();
    const contactMap = this.lastContactByCustomer();

    if (r.noActiveContracts) {
      list = list.filter(c => {
        const contracts = contractMap.get(c.sourceCustomerId!) || [];
        return !contracts.some(ct => ct.status === 'Active' || ct.status === 'Pending' || ct.status === 'Overdue');
      });
    }
    if (r.hasUnsignedContracts) {
      list = list.filter(c => {
        const contracts = contractMap.get(c.sourceCustomerId!) || [];
        return contracts.some(ct => ct.signed === false);
      });
    }
    if (r.hasNegativePacing) {
      list = list.filter(c => {
        const pacing = this._getCustomerPacing(c);
        return pacing !== null && pacing < 0;
      });
    }
    if (r.neverContacted) {
      list = list.filter(c => !contactMap.has(c.id));
    } else if (r.notContactedDays != null && r.notContactedDays > 0) {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - r.notContactedDays);
      list = list.filter(c => {
        const info = contactMap.get(c.id);
        if (!info) return true; // never contacted → include
        // Parse days from the cached text to avoid re-scanning notes
        const match = info.text.match(/(\d+) days ago/);
        if (match) return parseInt(match[1], 10) >= r.notContactedDays!;
        if (info.text === 'Never contacted') return true;
        return false; // "today" or "yesterday" → contacted recently
      });
    }
    if (r.crops && r.crops.length > 0) {
      list = list.filter(c => (c.commodities ?? []).some(crop => r.crops!.includes(crop.trim())));
    }
    if (r.states && r.states.length > 0) {
      list = list.filter(c => {
        const state = c.extendedStateProvince || c.stateProvince;
        return !!state && r.states!.includes(state);
      });
    }
    return list;
  });

  readonly availableCrops = computed(() => {
    const crops = new Set<string>();
    for (const c of this.filteredCustomers()) {
      for (const crop of (c.commodities ?? [])) {
        if (crop.trim()) crops.add(crop.trim());
      }
    }
    return [...crops].sort();
  });

  readonly availableStates = computed(() => {
    const states = new Set<string>();
    for (const c of this.filteredCustomers()) {
      const s = c.extendedStateProvince || c.stateProvince;
      if (s) states.add(s);
    }
    const list = [...states].sort();
    return list.length > 1 ? list : [];
  });

  queryText = signal('');
  filteredCustomers = signal<Customer[]>([]);
  showSaveDialog = signal(false);
  activeSavedList = signal<SavedList | null>(null);
  showDeleteDialog = signal(false);
  deleteListId = signal<number | null>(null);
  newListName = signal('');
  isProcessing = signal(false);
  hasGenerated = signal(false);
  showMap = signal(false);
  loading = signal(false);
  loadingSavedLists = signal(false);
  detectedState = signal<string | null>(null);
  queryUnrecognized = signal(false);
  queryReturnedNoMatches = signal(false);
  showRefinePanel = signal(false);
  pendingRefinements = signal<RefinementFilters>({});
  appliedRefinements = signal<RefinementFilters>({});
  notContactedDaysInput = signal('');

  // ── Pre-indexed computed signals for O(1) lookups ────────────────────────

  /** Contracts grouped by ctrmCustomerId — used by displayedCustomers refinements and pacing. */
  private readonly _contractsByCustomer = computed(() => {
    const map = new Map<string, Contract[]>();
    for (const c of this.contracts()) {
      if (!c.ctrmCustomerId) continue;
      const arr = map.get(c.ctrmCustomerId);
      if (arr) arr.push(c); else map.set(c.ctrmCustomerId, [c]);
    }
    return map;
  });

  /** Most recent note per customer — pre-indexed for O(1) template lookup. */
  readonly lastContactByCustomer = computed(() => {
    const map = new Map<number, { text: string; colorClass: string }>();
    // Pre-index: find most recent note per customer, parsing Date once per note
    const latestNotes = new Map<number, { time: number }>();
    for (const n of this.notes()) {
      const time = new Date(n.createdAt).getTime();
      const existing = latestNotes.get(n.customerId);
      if (!existing || time > existing.time) {
        latestNotes.set(n.customerId, { time });
      }
    }
    const now = Date.now();
    for (const [customerId, { time }] of latestNotes) {
      const daysAgo = Math.floor((now - time) / 86400000);
      let result: { text: string; colorClass: string };
      if (daysAgo === 0) result = { text: 'Contacted today', colorClass: 'text-scoular-green' };
      else if (daysAgo === 1) result = { text: 'Contacted yesterday', colorClass: 'text-scoular-green' };
      else if (daysAgo < 7) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-green' };
      else if (daysAgo < 30) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-yellow-500' };
      else result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-red' };
      map.set(customerId, result);
    }
    return map;
  });

  /** Crops per customer — merged from ProducerDetails, contracts, intentions. */
  readonly cropsByCustomer = computed(() => {
    const map = new Map<number, string[]>();
    const contractMap = this._contractsByCustomer();

    // Pre-index intention crops by customerId — O(intentions) instead of O(customers × intentions)
    const intentionCropsByCustomer = new Map<number, Set<string>>();
    for (const p of this.plantingIntentions()) {
      if (!intentionCropsByCustomer.has(p.customerId)) {
        intentionCropsByCustomer.set(p.customerId, new Set());
      }
      intentionCropsByCustomer.get(p.customerId)!.add(p.crop);
    }

    // Pre-index ticket product codes by customerId
    const ticketCropsByCustomer = new Map<number, Set<string>>();
    for (const t of this.tickets()) {
      if (!t.customerId || !t.productCode) continue;
      if (!ticketCropsByCustomer.has(t.customerId)) {
        ticketCropsByCustomer.set(t.customerId, new Set());
      }
      ticketCropsByCustomer.get(t.customerId)!.add(t.productCode);
    }

    for (const customer of this.customers()) {
      const detailCrops = customer.commodities?.length ? [...customer.commodities] : [];
      const contractCrops = customer.sourceCustomerId
        ? [...new Set(
            (contractMap.get(customer.sourceCustomerId) || [])
              .map(c => c.commodityCode)
              .filter((crop): crop is string => !!crop)
          )]
        : [];
      const intentionCrops = [...(intentionCropsByCustomer.get(customer.id) || [])];
      const ticketCrops = [...(ticketCropsByCustomer.get(customer.id) || [])];
      map.set(customer.id, [...new Set([...detailCrops, ...contractCrops, ...intentionCrops, ...ticketCrops])].slice(0, 5));
    }
    return map;
  });

  exampleQueries = [
    'Top 10 largest operations',
    'Customers with corn or soybeans contracts',
    'Farmers not contacted in over 30 days',
    'Producers with contracts but no deliveries',
    'Customers planting soybeans in 2026',
    'Growers with unapplied tickets',
    'Customers with unconfirmed contracts',
    'Grain stored for over 60 days'
  ];


  constructor() {
    this._initTradeUnits = this.appState.selectedTradeUnits().slice();

    // Load saved lists eagerly — they're user-scoped, not TU-dependent
    const cachedSavedLists = this.appState.savedLists();
    if (cachedSavedLists.length > 0) {
      this.savedLists.set(cachedSavedLists);
    } else {
      this.loadingSavedLists.set(true);
      this.apiService.getSavedLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (lists) => {
          this.savedLists.set(lists);
          this.appState.setSavedLists(lists);
          this.loadingSavedLists.set(false);
        },
        error: () => { this.loadingSavedLists.set(false); }
      });
    }

    // Load all user-accessible trade units so the TU selector works without prior home page visit
    this.apiService.getUserTradeUnits().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (groups) => {
        const units = new Set<string>();
        for (const g of groups) {
          g.tradeUnitCodes.forEach(u => units.add(u));
        }
        this._allUserTradeUnits.set([...units].sort());
      }
    });

    // Try to restore from cache first, otherwise load fresh
    this._initLoad();

    this.destroyRef.onDestroy(() => {
      // If trade units changed while this component was alive, discard state entirely
      // so re-mounting shows a blank query for the new selection.
      const currentTus = this.appState.selectedTradeUnits();
      const tradeUnitsChanged = currentTus.length !== this._initTradeUnits.length ||
        currentTus.some(tu => !this._initTradeUnits.includes(tu));

      if (tradeUnitsChanged) {
        this.appState.clearBuildListState();
      } else {
        this.appState.setBuildListState({
          queryText: this.queryText(),
          filteredCustomerIds: this.filteredCustomers().map(c => c.id),
          hasGenerated: this.hasGenerated(),
          showMap: this.showMap(),
          detectedState: this.detectedState(),
          queryUnrecognized: this.queryUnrecognized(),
          tradeUnits: this._initTradeUnits,
          appliedRefinements: this.appliedRefinements(),
          notContactedDaysInput: this.notContactedDaysInput(),
          showRefinePanel: this.showRefinePanel()
        });
      }
    });
  }

  // =========================================================================
  // Data Loading — Two clear paths: _initLoad (restore) and _loadFresh (fetch)
  // =========================================================================

  /** Called once on mount. Restores UI state, shows cached results, then fetches fresh data. */
  private _initLoad(): void {
    // Restore UI state (query text, refinements, etc.) — this is safe, never corrupted
    this._restoreUIState();

    // If we have saved results, show them instantly while fresh data loads
    const saved = this.appState.buildListState();
    const currentTus = this.appState.selectedTradeUnits();
    const savedTus = saved?.tradeUnits ?? [];
    const tusMatch = currentTus.length > 0 && savedTus.length > 0
      && currentTus.length === savedTus.length
      && currentTus.every(tu => savedTus.includes(tu));

    if (tusMatch && saved?.hasGenerated && saved.filteredCustomerIds.length > 0) {
      // Temporarily restore data signals from appState so computed properties
      // (cropsByCustomer, lastContactByCustomer, etc.) work while cached results display.
      // _loadFresh will overwrite these with fresh data when it completes.
      const cachedCustomers = this.appState.customers();
      if (cachedCustomers.length > 0) {
        this.customers.set(cachedCustomers);
        this.contracts.set(this.appState.contracts());
        this.tickets.set(this.appState.tickets());
        this.plantingIntentions.set(this.appState.plantingIntentions());
        this.notes.set(this.appState.notes());
        this.storedGrain.set(this.appState.storedGrain());
        this._ticketsReady = this.appState.tickets().length > 0;
        if (this.appState.producerDetails().length > 0) {
          this._mergeProducerDetails(this.appState.producerDetails());
        }
        const idSet = new Set(saved.filteredCustomerIds);
        this.filteredCustomers.set(this.customers().filter(c => idSet.has(c.id)));
      }
    }

    // Always fetch fresh data — appState may have been corrupted by the home page
    if (currentTus.length > 0) {
      this._loadFresh();
    } else {
      this.loading.set(false);
    }
  }

  /** Fetches all data fresh from the API for the current trade units.
   *  @param clearSignals If true, clears data signals immediately (TU change). If false, keeps them for display (background refresh). */
  private _loadFresh(clearSignals = false): void {
    const requestId = ++this._loadRequestId;
    this._ticketsReady = false;

    if (clearSignals) {
      // TU changed — clear everything to prevent stale data from previous TU
      this.customers.set([]);
      this.contracts.set([]);
      this.tickets.set([]);
      this.plantingIntentions.set([]);
      this.notes.set([]);
      this.storedGrain.set([]);
      this.loading.set(true);
    } else if (this.customers().length === 0) {
      // No cached data to display — show loading
      this.loading.set(true);
    }

    // Use explicitly selected TUs only
    const tus = this.appState.selectedTradeUnits();
    const tuParam = tus.length > 0 ? tus : undefined;

    // Fetch core data (everything except tickets — those are slow and load in background)
    forkJoin({
      customers: this.apiService.getCustomers(tuParam).pipe(catchError(() => of([] as Customer[]))),
      contracts: this.apiService.getContracts(tuParam).pipe(catchError(() => of([] as Contract[]))),
      plantingIntentions: this.apiService.getPlantingIntentions(tuParam).pipe(catchError(() => of([] as PlantingIntention[]))),
      notes: this.apiService.getNotes().pipe(catchError(() => of([] as Note[]))),
      storedGrain: this.apiService.getStoredGrain(tuParam).pipe(catchError(() => of([] as StoredGrain[]))),
      savedLists: this.apiService.getSavedLists().pipe(catchError(() => of([] as SavedList[]))),
      producerDetails: this.apiService.getAllProducerDetails().pipe(catchError(() => of([] as ProducerDetails[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        // Ignore stale response from a previous TU's load
        if (requestId !== this._loadRequestId) return;

        this.customers.set(data.customers);
        this.contracts.set(data.contracts);
        this.plantingIntentions.set(data.plantingIntentions);
        this.notes.set(data.notes);
        this.storedGrain.set(data.storedGrain);
        this.savedLists.set(data.savedLists);
        // Merge producer details into customer objects, then write to appState
        if (data.producerDetails.length > 0) this.appState.setProducerDetails(data.producerDetails);
        this._mergeProducerDetails(data.producerDetails);
        // Write to appState so other pages and restore path can use it
        this.appState.setCustomers(this.customers());
        this.appState.setContracts(data.contracts);
        this.appState.setPlantingIntentions(data.plantingIntentions);
        this.appState.setNotes(data.notes);
        this.appState.setStoredGrain(data.storedGrain);
        this.appState.setSavedLists(data.savedLists);

        this.loading.set(false);

        // Auto-run query if not already showing results.
        // If hasGenerated is true, results are cached from a previous run (possibly a saved list
        // with different TUs) — don't overwrite with a re-run against current TUs.
        if (this.queryText().trim() && !this.hasGenerated()) {
          this.processQuery();
        }
      },
      error: () => {
        if (requestId !== this._loadRequestId) return;
        this.loading.set(false);
        this.toastService.error('Failed to load data');
      }
    });

    // Tickets load in background — processQuery waits for them only if the query needs tickets
    this.apiService.getTickets(tuParam).pipe(
      catchError(() => of([] as Ticket[])),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(tickets => {
      if (requestId !== this._loadRequestId) return;
      this.tickets.set(tickets);
      this.appState.setTickets(tickets);
      this._ticketsReady = true;
    });
  }

  /** Merge ProducerDetails into customer objects (commodities, bin capacity, etc.). */
  private _mergeProducerDetails(details: ProducerDetails[]): void {
    if (details.length === 0) return;
    const detailsMap = new Map(details.map(d => [d.customerId, d]));
    let changed = false;
    const merged = this.customers().map(customer => {
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
      this.customers.set([...merged]);
      // cropsByCustomer computed auto-invalidates when customers() changes
    }
  }

  private _restoreUIState(): void {
    const saved = this.appState.buildListState();
    if (!saved) return;

    // If trade units changed since state was saved, clear everything —
    // the user must re-enter and regenerate for the new selection.
    const currentTus = this.appState.selectedTradeUnits();
    const savedTus = saved.tradeUnits ?? [];
    const tradeUnitsMatch = currentTus.length > 0 && savedTus.length > 0
      && currentTus.length === savedTus.length
      && currentTus.every(tu => savedTus.includes(tu));

    if (!tradeUnitsMatch) {
      this.appState.clearBuildListState();
      return;
    }

    this.queryText.set(saved.queryText);
    this.hasGenerated.set(saved.hasGenerated);
    this.showMap.set(saved.showMap);
    this.detectedState.set(saved.detectedState);
    this.queryUnrecognized.set(saved.queryUnrecognized);
    if (saved.appliedRefinements) {
      this.appliedRefinements.set(saved.appliedRefinements);
      this.pendingRefinements.set(saved.appliedRefinements);
    }
    if (saved.notContactedDaysInput) this.notContactedDaysInput.set(saved.notContactedDaysInput);
    if (saved.showRefinePanel) this.showRefinePanel.set(saved.showRefinePanel);
    // Note: filteredCustomers are restored by _initLoad after data signals are set
  }

  toggleMap(): void {
    this.showMap.update(v => !v);
  }

  readonly mapCustomers = computed(() =>
    this.hasGenerated() ? this.displayedCustomers() : this.customers()
  );

  clearQuery(): void {
    this._queryGenId++;
    this.isProcessing.set(false);
    this.queryText.set('');
    this.hasGenerated.set(false);
    this.filteredCustomers.set([]);
    this.detectedState.set(null);
    this.queryUnrecognized.set(false);
    this.queryReturnedNoMatches.set(false);
    this.showMap.set(false);
    this.showRefinePanel.set(false);
    this.pendingRefinements.set({});
    this.appliedRefinements.set({});
    this.notContactedDaysInput.set('');
    this.activeSavedList.set(null);
    this.appState.clearBuildListState();
  }

  onQueryChange(query: string): void {
    if (!query.trim()) {
      this.hasGenerated.set(false);
      this.filteredCustomers.set([]);
      this.detectedState.set(null);
      this.queryUnrecognized.set(false);
      this.queryReturnedNoMatches.set(false);
    }
  }

  onQueryKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (this.hasTradeUnits() && this.queryText().trim() && !this.isProcessing()) {
        if (!this.loading()) {
          this.processQuery();
        }
        // If loading: text is staged; _loadData() auto-runs processQuery() on completion
      }
    }
  }

  useExampleQuery(example: string): void {
    this.detectedState.set(null);
    this.hasGenerated.set(false);
    this.filteredCustomers.set([]);
    this.queryUnrecognized.set(false);
    this.queryReturnedNoMatches.set(false);
    this.queryText.set(example);
    if (!this.loading()) {
      this.processQuery();
    }
    // If loading: text is staged; _loadFresh auto-runs processQuery() on completion
  }

  processQuery(overrideTradeUnits?: string[]): void {
    if (!this.queryText().trim()) return;
    // Don't run if core data hasn't loaded yet — the staged query will auto-run when data arrives
    if (this.customers().length === 0) return;

    const queryGen = ++this._queryGenId;
    this.isProcessing.set(true);

    // Saved lists always re-fetch to ensure fresh data
    if (overrideTradeUnits && overrideTradeUnits.length > 0) {
      this._fetchAndFilter(overrideTradeUnits);
      return;
    }

    // If query involves tickets and tickets haven't loaded yet, wait for them
    const needsTickets = this.nlqFilterService.queryInvolvesTickets(this.queryText());
    if (needsTickets && (!this._ticketsReady || this.tickets().length === 0)) {
      const tuParam = this.appState.selectedTradeUnits();
      this.apiService.getTickets(tuParam.length > 0 ? tuParam : undefined).pipe(
        timeout(60000),
        catchError(() => of([] as Ticket[])),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe(tickets => {
        if (queryGen !== this._queryGenId) return;
        this.tickets.set(tickets);
        this._ticketsReady = true;
        this._applyNlqFilter();
        this.isProcessing.set(false);
      });
      return;
    }

    // Run NLQ immediately — uses local signals directly (set by _initLoad or _loadFresh)
    this._applyNlqFilter();
    this.isProcessing.set(false);
  }

  /** Fetches fresh data for specific trade units and runs the NLQ filter. */
  private _fetchAndFilter(tradeUnits: string[]): void {
    const tuParam = tradeUnits.length > 0 ? tradeUnits : undefined;
    // TU filter for customers and operational data. Notes global for accurate "last contacted".
    forkJoin({
      customers: this.apiService.getCustomers(tuParam).pipe(catchError(() => of([] as Customer[]))),
      contracts: this.apiService.getContracts(tuParam).pipe(catchError(() => of([] as Contract[]))),
      tickets: this.apiService.getTickets(tuParam).pipe(catchError(() => of([] as Ticket[]))),
      plantingIntentions: this.apiService.getPlantingIntentions(tuParam).pipe(catchError(() => of([] as PlantingIntention[]))),
      notes: this.apiService.getNotes().pipe(catchError(() => of([] as Note[]))),
      storedGrain: this.apiService.getStoredGrain(tuParam).pipe(catchError(() => of([] as StoredGrain[]))),
      producerDetails: (this.appState.producerDetails().length > 0 ? of(this.appState.producerDetails()) : this.apiService.getAllProducerDetails()).pipe(catchError(() => of([] as ProducerDetails[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.customers.set(data.customers);
        this._mergeProducerDetails(data.producerDetails);
        this.contracts.set(data.contracts);
        this.tickets.set(data.tickets);
        this.notes.set(data.notes);
        this.plantingIntentions.set(data.plantingIntentions);
        this.storedGrain.set(data.storedGrain);

    
        this._applyNlqFilter();
        this.isProcessing.set(false);
      },
      error: () => {
        this.toastService.error('Failed to load data for query');
        this.isProcessing.set(false);
      }
    });
  }

  /** Runs the NLQ filter against the current in-memory data and updates filteredCustomers. */
  private _applyNlqFilter(): void {
    const context: NlqFilterContext = {
      customers: this.customers(),
      contracts: this.contracts(),
      tickets: this.tickets(),
      notes: this.notes(),
      plantingIntentions: this.plantingIntentions(),
      storedGrain: this.storedGrain(),
      commodities: this.appState.commodities()
    };
    const result = this.nlqFilterService.parseAndFilter(this.queryText(), context);
    this.detectedState.set(result.detectedState);
    this.hasGenerated.set(true);
    this.queryUnrecognized.set(result.matchedPatterns.length === 0);
    // Don't show "no match" if tickets are still loading and the query needs them
    const ticketsPending = this.nlqFilterService.queryInvolvesTickets(this.queryText()) && !this._ticketsReady;
    this.queryReturnedNoMatches.set(result.matchedPatterns.length > 0 && result.customers.length === 0 && !ticketsPending);

    if (this.queryUnrecognized()) {
      // Unrecognized query: if other refinements are active use all customers as the
      // base; otherwise show 0 (avoid dumping all customers on a meaningless query).
      this.filteredCustomers.set(
        this.hasAnyRefinement(this.appliedRefinements()) ? result.customers : []
      );
    } else {
      this.filteredCustomers.set(result.customers);
    }

    // If the query mentions pacing, apply direction filtering here at the component level
    // using getCustomerPacing() so the result is definitive regardless of NLQ internals.
    const lq = this.queryText().toLowerCase();
    if (lq.includes('pacing') || lq.includes('contract pace')) {
      const isNegative = lq.includes('negative') || lq.includes('behind') || lq.includes('below') || lq.includes('slower');
      const isPositive = lq.includes('positive') || lq.includes('ahead') || lq.includes('above') || lq.includes('faster');
      if (isNegative || isPositive) {
        this.filteredCustomers.update(list => list.filter(c => {
          const pacing = this._getCustomerPacing(c);
          if (pacing === null) return false;
          return isNegative ? pacing < 0 : pacing >= 0;
        }));
      }
    }


  }



  getStateDisplayName(state: string): string {
    return this.nlqFilterService.getStateDisplayName(state);
  }

  loadSavedList(list: SavedList): void {
    if (this.loading() || this.isProcessing()) return;
    this.activeSavedList.set(list);
    this.queryText.set(list.query);
    this.pendingRefinements.set(list.filters ? { ...list.filters } : {});
    this.appliedRefinements.set({ ...this.pendingRefinements() });
    this.notContactedDaysInput.set(
      this.appliedRefinements().notContactedDays != null
        ? this.appliedRefinements().notContactedDays!.toString()
        : ''
    );
    // Open the panel automatically so the user can see the active filters
    if (this.hasAnyRefinement(this.appliedRefinements())) {
      this.showRefinePanel.set(true);
    }
    // Clear stale results before fetching so no intermediate render fires with the
    // enriched cache that home page customer visits leave in appState.contracts.
    this.filteredCustomers.set([]);
    this.hasGenerated.set(false);
    // Always use the trade units saved with the list, not the current UI selection.
    // This ensures the results are deterministic regardless of what trade units are
    // currently selected in the header — the list was built against specific trade units.
    const savedTradeUnits = list.tradeUnits
      ? list.tradeUnits.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    this.processQuery(savedTradeUnits);
  }

  clearRefinements(): void {
    this.pendingRefinements.set({});
    this.appliedRefinements.set({});
    this.notContactedDaysInput.set('');
  }

  applyNotContactedDays(): void {
    const days = parseInt(this.notContactedDaysInput(), 10);
    this.pendingRefinements.update(r => ({ ...r, notContactedDays: isNaN(days) || days <= 0 ? null : days }));
  }

  applyFilters(): void {
    this.appliedRefinements.set({ ...this.pendingRefinements() });
    // Re-run the NLQ filter so hasNegativePacing (and any other refinement that
    // affects the base customer set) uses the correct set of customers.
    if (this.hasGenerated()) {
      this._applyNlqFilter();
    }
  }

  togglePendingCrop(crop: string): void {
    const current = this.pendingRefinements().crops ?? [];
    const updated = current.includes(crop) ? current.filter(c => c !== crop) : [...current, crop];
    this.pendingRefinements.update(r => ({ ...r, crops: updated.length > 0 ? updated : undefined }));
  }

  togglePendingState(state: string): void {
    const current = this.pendingRefinements().states ?? [];
    const updated = current.includes(state) ? current.filter(s => s !== state) : [...current, state];
    this.pendingRefinements.update(r => ({ ...r, states: updated.length > 0 ? updated : undefined }));
  }

  isCropSelected(crop: string): boolean {
    return !!(this.pendingRefinements().crops?.includes(crop));
  }

  isStateSelected(state: string): boolean {
    return !!(this.pendingRefinements().states?.includes(state));
  }

  private _getCustomerPacing(customer: Customer): number | null {
    const customerContracts = this._contractsByCustomer().get(customer.sourceCustomerId!) || [];
    if (customerContracts.length === 0) return null;
    let maxYear = 0;
    for (const c of customerContracts) {
      if (c.deliveryStart) {
        const y = new Date(c.deliveryStart).getFullYear();
        if (y > maxYear) maxYear = y;
      }
    }
    if (maxYear === 0) return null;
    // Same-point-last-year cutoff: only count prior-year contracts that were
    // booked on or before this calendar date last year (apples-to-apples comparison).
    const today = new Date();
    const samePointLastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    const thisYearBu = customerContracts
      .filter(c => c.deliveryStart && new Date(c.deliveryStart).getFullYear() === maxYear)
      .reduce((sum, c) => sum + (c.quantity ?? 0), 0);
    const lastYearBu = customerContracts
      .filter(c => {
        if (!c.deliveryStart || new Date(c.deliveryStart).getFullYear() !== maxYear - 1) return false;
        if (!c.contractDate) return true;
        return new Date(c.contractDate) <= samePointLastYear;
      })
      .reduce((sum, c) => sum + (c.quantity ?? 0), 0);
    if (lastYearBu === 0) return null;
    return ((thisYearBu - lastYearBu) / lastYearBu) * 100;
  }

  hasAnyRefinement(filters: RefinementFilters): boolean {
    return !!(
      filters.noActiveContracts ||
      filters.hasUnsignedContracts ||
      filters.hasNegativePacing ||
      filters.neverContacted ||
      (filters.notContactedDays != null && filters.notContactedDays > 0) ||
      (filters.crops && filters.crops.length > 0) ||
      (filters.states && filters.states.length > 0)
    );
  }

  openSaveDialog(): void {
    this.showSaveDialog.set(true);
    this.newListName.set(this.activeSavedList()?.name ?? '');
  }

  closeSaveDialog(): void {
    this.showSaveDialog.set(false);
  }

  saveList(): void {
    if (!this.newListName().trim() || this.filteredCustomers().length === 0) return;

    const tradeUnits = this.effectiveTradeUnits();
    const payload = {
      name: this.newListName(),
      query: this.queryText(),
      tradeUnits: tradeUnits.length > 0 ? tradeUnits.join(',') : undefined,
      filters: this.activeRefinementCount() > 0 ? { ...this.appliedRefinements() } : undefined
    };

    const request$ = this.activeSavedList()
      ? this.apiService.updateSavedList(this.activeSavedList()!.id, payload)
      : this.apiService.createSavedList(payload);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (savedList) => {
        this.toastService.success(`List "${this.newListName()}" saved`);
        this.newListName.set('');
        this.showSaveDialog.set(false);
        this.activeSavedList.set(savedList);
        this._refreshSavedLists();
      },
      error: () => {
        this.toastService.error('Failed to save list');
      }
    });
  }

  deleteList(listId: number): void {
    this.deleteListId.set(listId);
    this.showDeleteDialog.set(true);
  }

  closeDeleteDialog(): void {
    this.showDeleteDialog.set(false);
    this.deleteListId.set(null);
  }

  confirmDeleteList(): void {
    if (!this.deleteListId()) return;
    const listId = this.deleteListId()!;
    this.closeDeleteDialog();

    // Remove from local array immediately for instant UI feedback
    this.savedLists.update(lists => lists.filter(l => l.id !== listId));
    this.appState.setSavedLists(this.savedLists());
    if (this.activeSavedList()?.id === listId) {
      this.activeSavedList.set(null);
    }

    this.apiService.deleteSavedList(listId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.info('List deleted');
      },
      error: () => {
        this.toastService.error('Failed to delete list');
        this._refreshSavedLists(); // Re-fetch on error to restore
      }
    });
  }

  private _refreshSavedLists(): void {
    this.apiService.getSavedLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.savedLists.set(data);
        this.appState.setSavedLists(data);
      },
      error: () => this.toastService.error('Failed to refresh lists')
    });
  }

  selectCustomer(customer: Customer): void {
    this.router.navigate(['/'], { queryParams: { customerId: customer.id } });
  }

  getInitials(name: string): string {
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return '??';
  }

  getFormattedLocation(customer: Customer): string {
    if (customer.extendedCity && customer.extendedStateProvince) {
      return `${customer.extendedCity}, ${customer.extendedStateProvince}`;
    }
    if (customer.location && customer.stateProvince) {
      return `${customer.location}, ${customer.stateProvince}`;
    }
    return customer.extendedCity || customer.location || customer.stateProvince || '';
  }

  getLastContactInfo(customerId: number): { text: string; colorClass: string } {
    return this.lastContactByCustomer().get(customerId)
      ?? { text: 'Never contacted', colorClass: 'text-scoular-red' };
  }

  getCustomerCrops(customerId: number): string[] {
    return this.cropsByCustomer().get(customerId) ?? [];
  }
}
