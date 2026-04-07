import { Component, ChangeDetectionStrategy, DestroyRef, inject, effect, untracked, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of, catchError, timeout } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
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
  private readonly msalService = inject(MsalService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Trade units captured at init — used to detect changes on destroy
  private _initTradeUnits: string[] = [];
  private _initialized = false;
  private _ticketsReady = signal(false);
  private _loadRequestId = 0;
  private _queryGenId = 0;
  private _pendingIncludedIds: number[] = [];
  // True once the forkJoin (or cache restore) has populated all core data signals.
  // Guards processQuery() and example chips from running against partial/empty data.
  readonly coreDataLoaded = signal(false);
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
      list = list.filter(c => {
        const info = contactMap.get(c.id);
        if (!info) return true; // never contacted → include
        return info.daysAgo >= r.notContactedDays!;
      });
    }
    if (r.crops && r.crops.length > 0) {
      // Expand selected crops with aliases (e.g., "Milo" also matches "Sorghum")
      const aliasMap: Record<string, string[]> = {
        'milo': ['milo', 'sorghum'], 'sorghum': ['milo', 'sorghum'],
        'beans': ['beans', 'soybeans', 'soy'], 'soybeans': ['soybeans', 'beans', 'soy'], 'soy': ['soy', 'soybeans', 'beans'],
      };
      const expandedCrops = new Set<string>();
      for (const crop of r.crops) {
        const lower = crop.trim().toLowerCase();
        for (const alias of (aliasMap[lower] ?? [lower])) expandedCrops.add(alias);
      }
      list = list.filter(c => (c.commodities ?? []).some(crop => expandedCrops.has(crop.trim().toLowerCase())));
    }
    if (r.states && r.states.length > 0) {
      list = list.filter(c => {
        const state = c.extendedStateProvince || c.stateProvince;
        return !!state && r.states!.includes(state);
      });
    }
    // Apply manual member overrides: exclude removed, add included
    const excludedIds = this.manuallyExcludedCustomerIds();
    if (excludedIds.size > 0) {
      list = list.filter(c => !excludedIds.has(c.id));
    }
    const includedCustomers = this.manuallyIncludedCustomers();
    if (includedCustomers.length > 0) {
      const existingIds = new Set(list.map(c => c.id));
      const toAdd = includedCustomers.filter(c => !existingIds.has(c.id) && !excludedIds.has(c.id));
      if (toAdd.length > 0) list = [...list, ...toAdd];
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
  waitingForTickets = signal(false);
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
  matchedPatterns = signal<string[]>([]);

  // ── Manage Members ──────────────────────────────────────────────────────
  showManageMembersPanel = signal(false);
  manuallyIncludedCustomers = signal<Customer[]>([]);
  manuallyExcludedCustomerIds = signal<Set<number>>(new Set());
  memberSearchTerm = signal('');
  memberSearchResults = signal<Customer[]>([]);
  memberSearchLoading = signal(false);
  private _memberSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly memberOverrideCount = computed(() =>
    this.manuallyIncludedCustomers().length + this.manuallyExcludedCustomerIds().size
  );

  /** Excluded customers as an array for template iteration. */
  readonly excludedCustomersList = computed(() => {
    const ids = [...this.manuallyExcludedCustomerIds()];
    const customerMap = new Map(this.customers().map(c => [c.id, c]));
    return ids.map(id => customerMap.get(id)).filter((c): c is Customer => !!c);
  });

  // ── Pattern display name map for user-facing feedback ────────────────────
  private readonly _patternDisplayNames: { [key: string]: string } = {
    state_filter: 'State', acres_more: 'Acres (min)', acres_less: 'Acres (max)', acres_between: 'Acres (range)',
    large_farm: 'Large operations', small_farm: 'Small operations', not_contacted: 'Not contacted',
    recently_contacted: 'Recently contacted', storage: 'Has storage', no_storage: 'No storage',
    storage_duration: 'Storage duration', planting: 'Planting', no_planting: 'No planting',
    planting_year: 'Planting year', planting_type: 'Planting type',
    active_contract: 'Active contracts', no_contract: 'No contracts',
    unsigned_contract: 'Unsigned contracts', negative_pacing: 'Behind on pacing',
    positive_pacing: 'Ahead on pacing', contract_unconfirmed: 'Unconfirmed contracts',
    contract_confirmed: 'Confirmed contracts', contract_priced: 'Pricing status',
    contract_quantity: 'Contract quantity', contract_value: 'Contract value',
    contract_open_balance: 'Open balance', fulfillment_ratio: 'Fulfillment %',
    commodity_contract: 'Commodity contracts', has_deliveries: 'Has deliveries',
    no_deliveries: 'No deliveries', delivery_commodity: 'Delivery commodity',
    delivery_quantity: 'Delivery quantity', ticket_unapplied: 'Unapplied tickets',
    ticket_unsettled: 'Unsettled tickets', has_phone: 'Has phone', no_phone: 'No phone',
    has_email: 'Has email', no_email: 'No email', commodities_match: 'Commodity match', crop_count: 'Crop count',
    top_n: 'Top N ranking', customer_search: 'Name search', region_filter: 'Region',
    multi_commodity: 'Multiple crops (AND)', multi_commodity_or: 'Multiple crops (OR)',
    cross_contract_no_delivery: 'Contracted, not delivered',
    cross_planting_no_contract: 'Planting, no contracts',
    cross_delivery_no_contract: 'Delivered, no contracts',
    note_contains: 'Notes containing',
  };

  readonly matchedPatternLabels = computed(() =>
    this.matchedPatterns()
      .map(p => this._patternDisplayNames[p] || null)
      .filter((label): label is string => label !== null)
      // Deduplicate labels
      .filter((v, i, a) => a.indexOf(v) === i)
  );

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

  /** Most recent note per customer — pre-indexed for O(1) template lookup.
   *  Matches home page logic: indexes notes by customerCode (source ID), resolves
   *  linked producer notes bidirectionally (outgoing + incoming links). */
  readonly lastContactByCustomer = computed(() => {
    const map = new Map<number, { text: string; colorClass: string; daysAgo: number }>();

    // Index notes by customerCode (source customer ID) — same as home page
    const notesByCode = new Map<string, { time: number }>();
    for (const n of this.notes()) {
      if (!n.customerCode) continue;
      const time = new Date(n.createdAt).getTime();
      const existing = notesByCode.get(n.customerCode);
      if (!existing || time > existing.time) {
        notesByCode.set(n.customerCode, { time });
      }
    }

    // Build bidirectional linked-producer map (outgoing + incoming)
    const allCustomers = this.customers();
    const linkedById = new Map<number, string[]>();
    for (const c of allCustomers) {
      if (c.linkedProducerIds?.length) linkedById.set(c.id, c.linkedProducerIds);
    }
    const incomingCodeLinks = new Map<string, Set<string>>();
    for (const c of allCustomers) {
      if (!c.sourceCustomerId) continue;
      for (const linkedCode of (c.linkedProducerIds || [])) {
        if (!incomingCodeLinks.has(linkedCode)) incomingCodeLinks.set(linkedCode, new Set());
        incomingCodeLinks.get(linkedCode)!.add(c.sourceCustomerId);
      }
    }

    // Resolve latest note time per customer including linked producers
    const latestNotes = new Map<number, { time: number }>();
    for (const customer of allCustomers) {
      const freshLinked = linkedById.get(customer.id) ?? customer.linkedProducerIds ?? [];
      const allCodes = new Set<string>();
      if (customer.sourceCustomerId) allCodes.add(customer.sourceCustomerId);
      for (const linkedCode of freshLinked) allCodes.add(linkedCode);
      for (const incomingCode of (incomingCodeLinks.get(customer.sourceCustomerId || '') || new Set<string>())) {
        allCodes.add(incomingCode);
      }
      let latestTime = 0;
      for (const code of allCodes) {
        const entry = notesByCode.get(code);
        if (entry && entry.time > latestTime) latestTime = entry.time;
      }
      if (latestTime > 0) latestNotes.set(customer.id, { time: latestTime });
    }

    const now = Date.now();
    for (const [customerId, { time }] of latestNotes) {
      const daysAgo = Math.max(0, Math.floor((now - time) / 86400000));
      let result: { text: string; colorClass: string; daysAgo: number };
      if (daysAgo === 0) result = { text: 'Contacted today', colorClass: 'text-scoular-green', daysAgo };
      else if (daysAgo === 1) result = { text: 'Contacted yesterday', colorClass: 'text-scoular-green', daysAgo };
      else if (daysAgo < 7) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-green', daysAgo };
      else if (daysAgo < 30) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-yellow-500', daysAgo };
      else result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-red', daysAgo };
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

    // Pre-index stored grain crops by customerId
    const storedGrainCropsByCustomer = new Map<number, Set<string>>();
    for (const sg of this.storedGrain()) {
      if (!sg.customerId || !sg.crop) continue;
      if (!storedGrainCropsByCustomer.has(sg.customerId)) {
        storedGrainCropsByCustomer.set(sg.customerId, new Set());
      }
      storedGrainCropsByCustomer.get(sg.customerId)!.add(sg.crop);
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
      const storageCrops = [...(storedGrainCropsByCustomer.get(customer.id) || [])];
      map.set(customer.id, [...new Set([...detailCrops, ...contractCrops, ...intentionCrops, ...ticketCrops, ...storageCrops])].slice(0, 5));
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
    'Grain stored for over 60 days',
    'Notes mentioning beans in the bin'
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
          showRefinePanel: this.showRefinePanel(),
          manuallyIncludedCustomerIds: this.manuallyIncludedCustomers().map(c => c.id),
          manuallyExcludedCustomerIds: [...this.manuallyExcludedCustomerIds()],
          showManageMembersPanel: this.showManageMembersPanel()
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

    const currentTus = this.appState.selectedTradeUnits();
    const cachedCustomers = this.appState.customers();

    // If appState already has customer data (loaded by home page or a previous visit),
    // use it immediately for fast display, then do a background refresh to fill in
    // any data the preload service hadn't finished (tickets, stored grain, etc.).
    if (currentTus.length > 0 && cachedCustomers.length > 0) {
      this.customers.set(cachedCustomers);
      this.contracts.set(this.appState.contracts());
      this.tickets.set(this.appState.tickets());
      this.plantingIntentions.set(this.appState.plantingIntentions());
      this.notes.set(this.appState.notes());
      this.storedGrain.set(this.appState.storedGrain());
      this.savedLists.set(this.appState.savedLists());
      // Don't set _ticketsReady from cache — ticket data may be stale or from a
      // different TU. The background refresh will set it when fresh tickets arrive.
      // Ticket-dependent queries will wait via the "Loading delivery data..." path,
      // ensuring they always use fresh data.
      if (this.appState.producerDetails().length > 0) {
        this._mergeProducerDetails(this.appState.producerDetails());
      }

      // Restore filtered results if we had a previous query for the same TUs
      const saved = this.appState.buildListState();
      const savedTus = saved?.tradeUnits ?? [];
      const tusMatch = savedTus.length === currentTus.length
        && currentTus.every(tu => savedTus.includes(tu));
      if (tusMatch && saved?.hasGenerated && saved.filteredCustomerIds.length > 0) {
        const idSet = new Set(saved.filteredCustomerIds);
        this.filteredCustomers.set(this.customers().filter(c => idSet.has(c.id)));
      }

      this.loading.set(false);
      this.coreDataLoaded.set(true);
      this._resolvePendingIncludes();

      // Background refresh: the home page preload may not have finished loading all
      // data (tickets, stored grain load as secondary/background). Fetch fresh data
      // without clearing current signals so the UI stays responsive.
      this._loadFresh(false);
    } else if (currentTus.length > 0) {
      // No cached data — fetch fresh from API
      this._loadFresh();
    } else {
      this.loading.set(false);
    }
  }

  /** Fetches all data fresh from the API for the current trade units.
   *  @param clearSignals If true, clears data signals immediately (TU change). If false, keeps them for display (background refresh). */
  private _loadFresh(clearSignals = false): void {
    const requestId = ++this._loadRequestId;
    this._ticketsReady.set(false);
    // Only reset coreDataLoaded when clearing signals (TU change / initial load).
    // For background refreshes (clearSignals=false with existing data), keep it true
    // so the UI stays interactive while fresh data loads behind the scenes.
    if (clearSignals || this.customers().length === 0) {
      this.coreDataLoaded.set(false);
    }

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
        this.coreDataLoaded.set(true);

        // Don't auto-run queries on background refresh completion.
        // Restored queries show their cached results (if hasGenerated was saved).
        // New queries require the user to click Generate or select an example.
      },
      error: () => {
        if (requestId !== this._loadRequestId) return;
        this.loading.set(false);
        this.coreDataLoaded.set(true); // Mark loaded even on error so UI isn't stuck
        this.toastService.error('Failed to load data');
      }
    });

    // Tickets load in background — processQuery waits for them only if the query needs tickets
    this.apiService.getTickets(tuParam).pipe(
      timeout(60000),
      catchError(() => of([] as Ticket[])),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(tickets => {
      if (requestId !== this._loadRequestId) return;
      this.tickets.set(tickets);
      this.appState.setTickets(tickets);
      this._ticketsReady.set(true);
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
    if (saved.manuallyExcludedCustomerIds?.length) {
      this.manuallyExcludedCustomerIds.set(new Set(saved.manuallyExcludedCustomerIds));
    }
    if (saved.manuallyIncludedCustomerIds?.length) {
      // Store as pending — resolved to full Customer objects after data loads in _initLoad
      this._pendingIncludedIds = saved.manuallyIncludedCustomerIds;
    }
    if (saved.showManageMembersPanel) this.showManageMembersPanel.set(true);
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
    this.waitingForTickets.set(false);
    this.queryText.set('');
    this.hasGenerated.set(false);
    this.filteredCustomers.set([]);
    this.matchedPatterns.set([]);
    this.detectedState.set(null);
    this.queryUnrecognized.set(false);
    this.queryReturnedNoMatches.set(false);
    this.showMap.set(false);
    this.showRefinePanel.set(false);
    this.pendingRefinements.set({});
    this.appliedRefinements.set({});
    this.notContactedDaysInput.set('');
    this.showManageMembersPanel.set(false);
    this.manuallyIncludedCustomers.set([]);
    this.manuallyExcludedCustomerIds.set(new Set());
    this.memberSearchTerm.set('');
    this.memberSearchResults.set([]);
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
    // Reset non-visual state from any previous query or saved list.
    // Keep hasGenerated and filteredCustomers intact so the old results stay visible
    // until the new NLQ filter runs — prevents a flash of empty state between queries.
    this._queryGenId++;
    this.isProcessing.set(false);
    this.waitingForTickets.set(false);
    this.queryUnrecognized.set(false);
    this.queryReturnedNoMatches.set(false);
    this.showRefinePanel.set(false);
    this.pendingRefinements.set({});
    this.appliedRefinements.set({});
    this.notContactedDaysInput.set('');
    this.showManageMembersPanel.set(false);
    this.manuallyIncludedCustomers.set([]);
    this.manuallyExcludedCustomerIds.set(new Set());
    this.memberSearchTerm.set('');
    this.memberSearchResults.set([]);
    this.memberInResultsMatches.set([]);
    this.activeSavedList.set(null);

    this.queryText.set(example);
    if (this.coreDataLoaded() && !this.loading()) {
      // If query needs data that isn't ready, go through processQuery()
      // which handles the wait path. Otherwise run synchronously to avoid flash.
      const needsTickets = this.nlqFilterService.queryInvolvesTickets(example);
      const needsStorage = this.nlqFilterService.queryInvolvesStorage(example);
      const needsNotes = this.nlqFilterService.queryInvolvesContact(example);
      if ((needsTickets && !this._ticketsReady()) || (needsStorage && this.storedGrain().length === 0) || (needsNotes && this.notes().length === 0)) {
        this.processQuery();
      } else {
        this._applyNlqFilter();
        this.isProcessing.set(false);
      }
    }
    // If loading: text is staged; _loadFresh auto-runs processQuery() on completion
  }

  processQuery(overrideTradeUnits?: string[]): void {
    if (!this.queryText().trim()) return;
    // Don't run if core data hasn't loaded yet — the staged query will auto-run when data arrives
    // (hasGenerated stays false so _loadFresh's auto-run at completion picks it up)
    if (!this.coreDataLoaded()) {
      this.hasGenerated.set(false);
      return;
    }

    const queryGen = ++this._queryGenId;
    this.isProcessing.set(true);
    this.waitingForTickets.set(false); // Reset — will be set to true below only if this query needs tickets

    // Saved lists always re-fetch to ensure fresh data
    if (overrideTradeUnits && overrideTradeUnits.length > 0) {
      this._fetchAndFilter(overrideTradeUnits);
      return;
    }

    // If query involves tickets and tickets haven't loaded yet, wait for them
    const needsTickets = this.nlqFilterService.queryInvolvesTickets(this.queryText());
    if (needsTickets && !this._ticketsReady()) {
      this.waitingForTickets.set(true);
      const tuParam = this.appState.selectedTradeUnits();
      this.apiService.getTickets(tuParam.length > 0 ? tuParam : undefined).pipe(
        timeout(60000),
        catchError(() => of([] as Ticket[])),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe(tickets => {
        if (queryGen !== this._queryGenId) return;
        this.tickets.set(tickets);
        this._ticketsReady.set(true);
        this.waitingForTickets.set(false);
        this._applyNlqFilter();
        this.isProcessing.set(false);
      });
      return;
    }

    // Run NLQ on the next tick so the "Generating..." spinner renders on re-runs.
    // Without this, synchronous execution means Angular never shows the processing state.
    if (this.hasGenerated()) {
      this.filteredCustomers.set([]);
    }
    setTimeout(() => {
      if (queryGen !== this._queryGenId) return;
      this._applyNlqFilter();
      this.isProcessing.set(false);
    });
  }

  /** Fetches fresh data for specific trade units and runs the NLQ filter. */
  private _fetchAndFilter(tradeUnits: string[]): void {
    const queryGen = this._queryGenId; // Capture to detect if a newer query supersedes this one

    // Fast path: if requested TUs match what's already loaded AND all data the query
    // needs is ready, skip the fetch and run NLQ directly against in-memory data.
    const currentTus = this.appState.selectedTradeUnits();
    const tusMatch = tradeUnits.length === currentTus.length
      && tradeUnits.every(tu => currentTus.includes(tu));
    const query = this.queryText().toLowerCase();
    const needsTickets = this.nlqFilterService.queryInvolvesTickets(query);
    const needsStorage = this.nlqFilterService.queryInvolvesStorage(query);
    const needsNotes = this.nlqFilterService.queryInvolvesContact(query);
    const ticketsOk = !needsTickets || this._ticketsReady();
    const storageOk = !needsStorage || this.storedGrain().length > 0;
    const notesOk = !needsNotes || this.notes().length > 0;
    if (tusMatch && this.coreDataLoaded() && this.customers().length > 0 && ticketsOk && storageOk && notesOk) {
      this._resolvePendingIncludes();
      this._applyNlqFilter();
      this.isProcessing.set(false);
      return;
    }

    const tuParam = tradeUnits.length > 0 ? tradeUnits : undefined;
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
        if (queryGen !== this._queryGenId) return; // Superseded by a newer query
        this.customers.set(data.customers);
        this._mergeProducerDetails(data.producerDetails);
        this.contracts.set(data.contracts);
        this.tickets.set(data.tickets);
        this.notes.set(data.notes);
        this.plantingIntentions.set(data.plantingIntentions);
        this.storedGrain.set(data.storedGrain);
        this._ticketsReady.set(true);
        this.coreDataLoaded.set(true);
        this._resolvePendingIncludes();

        this._applyNlqFilter();
        this.isProcessing.set(false);
      },
      error: () => {
        if (queryGen !== this._queryGenId) return;
        this.toastService.error('Failed to load data for query');
        this.isProcessing.set(false);
      }
    });
  }

  /**
   * Resolves first-person references ("me", "my", "I") in a query to the current user's
   * display name or username so note author searches work with self-referencing queries
   * like "notes by me", "customers I have contacted", "my notes".
   */
  /** Resolves pending included customer IDs to full Customer objects from the now-loaded data. */
  private _resolvePendingIncludes(): void {
    if (this._pendingIncludedIds.length === 0) return;
    const customerMap = new Map(this.customers().map(c => [c.id, c]));
    this.manuallyIncludedCustomers.set(
      this._pendingIncludedIds.map(id => customerMap.get(id)).filter((c): c is Customer => !!c)
    );
    this._pendingIncludedIds = [];
    // Auto-open panel now that included customers are resolved
    if (this.manuallyIncludedCustomers().length > 0) {
      this.showManageMembersPanel.set(true);
    }
  }

  private _resolveUserReferences(query: string): string {
    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0];
    if (!account) return query;

    // Use first name from display name (e.g., "Caden Egr" → "Caden"),
    // or fall back to the username prefix (e.g., "caden.egr@scoular.com" → "caden.egr")
    const displayName = account.name ?? '';
    const firstName = displayName.split(' ')[0] || '';
    const username = (account.username ?? '').split('@')[0] || '';
    const replacement = firstName || username;
    if (!replacement) return query;

    // Replace self-references with the user's name. More specific patterns FIRST
    // so "I have left" matches before the generic "I have" replacement.
    return query
      .replace(/\bby me\b/gi, `by ${replacement}`)
      .replace(/\bmy notes?\b/gi, `${replacement}'s notes`)
      .replace(/\bmy customers?\b/gi, `${replacement}'s customers`)
      // Full phrase replacements — "Notes I have left" → "notes entered by Caden"
      .replace(/\bnotes?\s+I\s+(?:have\s+)?(?:wrote|left|made|placed|entered|created|added)\b/gi, `notes entered by ${replacement}`)
      .replace(/\bI\s+(?:have\s+)?(?:wrote|left|made|placed|entered|created|added)\b/gi, `entered by ${replacement}`)
      // Contact phrases — "Customers I contacted" → "customers contacted by Caden"
      .replace(/\bwho\s+have\s+I\s+(?:contacted|called|reached|noted)\b/gi, `who has ${replacement} contacted`)
      .replace(/\bI\s+(?:have\s+)?(?:contacted|called|reached|noted)\b/gi, `contacted by ${replacement}`)
      // Generic "I have" / "I've" — only matches if not already caught above
      .replace(/\bI have\b/gi, `${replacement} has`)
      .replace(/\bI've\b/gi, `${replacement} has`)
      .replace(/\bwho\s+have\s+I\s+(?:entered|placed|written|left|made)\s+(?:a\s+)?notes?\s+for\b/gi, `customers ${replacement} has entered a note for`)
      .replace(/\bnoted by me\b/gi, `noted by ${replacement}`)
      .replace(/\bcontacted by me\b/gi, `contacted by ${replacement}`)
      .replace(/\bplaced by me\b/gi, `entered by ${replacement}`)
      .replace(/\bentered by me\b/gi, `entered by ${replacement}`)
      .replace(/\bwritten by me\b/gi, `entered by ${replacement}`)
      .replace(/\bmade by me\b/gi, `entered by ${replacement}`)
      .replace(/\bleft by me\b/gi, `entered by ${replacement}`);
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
    const resolvedQuery = this._resolveUserReferences(this.queryText());
    const result = this.nlqFilterService.parseAndFilter(resolvedQuery, context);
    this.detectedState.set(result.detectedState);
    this.matchedPatterns.set(result.matchedPatterns);
    this.hasGenerated.set(true);
    this.queryUnrecognized.set(result.matchedPatterns.length === 0);
    // Don't show "no match" if tickets are still loading and the query needs them
    const ticketsPending = this.nlqFilterService.queryInvolvesTickets(this.queryText()) && !this._ticketsReady();
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
    // Restore manual member overrides — excluded IDs can be set immediately (just numbers).
    // Included customers need full Customer objects, which are resolved after data loads
    // (in case the saved list uses different TUs than what's currently loaded).
    this.manuallyExcludedCustomerIds.set(new Set(list.excludedCustomerIds || []));
    this._pendingIncludedIds = list.includedCustomerIds ?? [];
    this.manuallyIncludedCustomers.set([]);
    // Open the panel automatically so the user can see the active filters
    if (this.hasAnyRefinement(this.appliedRefinements())) {
      this.showRefinePanel.set(true);
    }
    if (this._pendingIncludedIds.length > 0 || this.manuallyExcludedCustomerIds().size > 0) {
      this.showManageMembersPanel.set(true);
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
    // Setting appliedRefinements is sufficient — displayedCustomers computed signal
    // automatically recalculates when appliedRefinements() changes. No need to re-run
    // the full NLQ parse/filter pipeline since the base filteredCustomers hasn't changed.
    this.appliedRefinements.set({ ...this.pendingRefinements() });
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

  // ── Manage Members methods ─────────────────────────────────────────────

  /** Matches from current displayed results (available to exclude). */
  memberInResultsMatches = signal<Customer[]>([]);

  searchMembers(term: string): void {
    if (this._memberSearchTimeout) clearTimeout(this._memberSearchTimeout);
    if (!term.trim() || term.trim().length < 2) {
      this.memberSearchResults.set([]);
      this.memberInResultsMatches.set([]);
      this.memberSearchLoading.set(false);
      return;
    }

    // Immediately filter current results for exclude candidates (client-side, instant)
    const lower = term.trim().toLowerCase();
    const excludedIds = this.manuallyExcludedCustomerIds();
    this.memberInResultsMatches.set(
      this.displayedCustomers()
        .filter(c =>
          !excludedIds.has(c.id) &&
          (c.name.toLowerCase().includes(lower) ||
           (c.sourceCustomerId || '').toLowerCase().includes(lower) ||
           (c.farm || '').toLowerCase().includes(lower))
        )
        .slice(0, 5)
    );

    // Debounced API search for add candidates
    this.memberSearchLoading.set(true);
    this._memberSearchTimeout = setTimeout(() => {
      const tus = this.effectiveTradeUnits();
      this.apiService.searchCustomers(term, tus.length > 0 ? tus : undefined)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (results) => {
            const includedIds = new Set(this.manuallyIncludedCustomers().map(c => c.id));
            const displayedIds = new Set(this.displayedCustomers().map(c => c.id));
            this.memberSearchResults.set(
              results.filter(c => !includedIds.has(c.id) && !displayedIds.has(c.id)).slice(0, 5)
            );
            this.memberSearchLoading.set(false);
          },
          error: () => {
            this.memberSearchResults.set([]);
            this.memberSearchLoading.set(false);
          }
        });
    }, 300);
  }

  addCustomerToList(customer: Customer): void {
    // Remove from excluded if they were previously excluded
    const excluded = this.manuallyExcludedCustomerIds();
    if (excluded.has(customer.id)) {
      const updated = new Set(excluded);
      updated.delete(customer.id);
      this.manuallyExcludedCustomerIds.set(updated);
    }
    // Add to included if not already there
    if (!this.manuallyIncludedCustomers().some(c => c.id === customer.id)) {
      this.manuallyIncludedCustomers.update(list => [...list, customer]);
    }
    // Clear search
    this.memberSearchTerm.set('');
    this.memberSearchResults.set([]);
    this.memberInResultsMatches.set([]);
  }

  excludeCustomerFromList(customerId: number): void {
    // If this was a manually added customer, just remove the add
    const wasManualAdd = this.manuallyIncludedCustomers().some(c => c.id === customerId);
    if (wasManualAdd) {
      this.manuallyIncludedCustomers.update(list => list.filter(c => c.id !== customerId));
    } else {
      // Add to excluded set (for NLQ-matched customers)
      this.manuallyExcludedCustomerIds.update(set => {
        const updated = new Set(set);
        updated.add(customerId);
        return updated;
      });
    }
    // Clear search so user can immediately search for another
    this.memberSearchTerm.set('');
    this.memberSearchResults.set([]);
    this.memberInResultsMatches.set([]);
  }

  restoreCustomer(customerId: number): void {
    this.manuallyExcludedCustomerIds.update(set => {
      const updated = new Set(set);
      updated.delete(customerId);
      return updated;
    });
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
    if (!this.newListName().trim() || this.displayedCustomers().length === 0) return;

    const tradeUnits = this.effectiveTradeUnits();
    const includedIds = this.manuallyIncludedCustomers().map(c => c.id);
    const excludedIds = [...this.manuallyExcludedCustomerIds()];
    const payload = {
      name: this.newListName(),
      query: this.queryText(),
      tradeUnits: tradeUnits.length > 0 ? tradeUnits.join(',') : undefined,
      filters: this.activeRefinementCount() > 0 ? { ...this.appliedRefinements() } : undefined,
      includedCustomerIds: includedIds.length > 0 ? includedIds : undefined,
      excludedCustomerIds: excludedIds.length > 0 ? excludedIds : undefined,
    };

    const request$ = this.activeSavedList()
      ? this.apiService.updateSavedList(this.activeSavedList()!.id, payload)
      : this.apiService.createSavedList(payload);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.success(`List "${this.newListName()}" saved`);
        this.showSaveDialog.set(false);
        this._refreshSavedLists();
        this.clearQuery();
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

  getLastContactInfo(customerId: number): { text: string; colorClass: string; daysAgo: number } {
    return this.lastContactByCustomer().get(customerId)
      ?? { text: 'Never contacted', colorClass: 'text-scoular-red', daysAgo: Infinity };
  }

  getCustomerCrops(customerId: number): string[] {
    return this.cropsByCustomer().get(customerId) ?? [];
  }
}
