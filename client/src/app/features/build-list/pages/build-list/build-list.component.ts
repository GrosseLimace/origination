import { Component, DestroyRef, inject, effect, untracked, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of, catchError } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppStateService, BuildListState } from '@core/services/app-state.service';
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
  templateUrl: './build-list.component.html'
})
export class BuildListComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly nlqFilterService = inject(NlqFilterService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Trade units captured at init — used to detect changes on destroy
  private _initTradeUnits: string[] = [];
  private _initialized = false;
  private _dataLoadStarted = false;
  // All trade units the user can access (union of all groups from Entitlements DB)
  private _allUserTradeUnits = signal<string[]>([]);

  // effect() runs in the injection context (class field initializer).
  // The initial run fires during construction (initialized = false → skipped).
  // Every subsequent run means TUs changed while the component is alive.
  private _tuEffect = effect(() => {
    this.appState.selectedTradeUnits(); // establish reactive dependency
    if (this._initialized) {
      untracked(() => this.clearQuery());
    }
  });

  customers = signal<Customer[]>([]);
  contracts = signal<Contract[]>([]);
  tickets = signal<Ticket[]>([]);
  plantingIntentions = signal<PlantingIntention[]>([]);
  notes = signal<Note[]>([]);
  storedGrain = signal<StoredGrain[]>([]);
  savedLists = signal<SavedList[]>([]);

  /** Returns the effective trade units — explicit selection if any, otherwise all user-accessible TUs. */
  get effectiveTradeUnits(): string[] {
    const explicit = this.appState.selectedTradeUnits();
    return explicit.length > 0 ? explicit : this._allUserTradeUnits();
  }

  get hasTradeUnits(): boolean {
    return this.effectiveTradeUnits.length > 0;
  }

  get activeRefinementCount(): number {
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
  }

  get displayedCustomers(): Customer[] {
    let list = this.filteredCustomers();
    const r = this.appliedRefinements();

    if (r.noActiveContracts) {
      list = list.filter(c => !this.contracts().some(ct =>
        ct.ctrmCustomerId === c.sourceCustomerId &&
        (ct.status === 'Active' || ct.status === 'Pending' || ct.status === 'Overdue')
      ));
    }
    if (r.hasUnsignedContracts) {
      list = list.filter(c => this.contracts().some(ct =>
        ct.ctrmCustomerId === c.sourceCustomerId && ct.signed === false
      ));
    }
    if (r.hasNegativePacing) {
      list = list.filter(c => {
        const pacing = this._getCustomerPacing(c);
        return pacing !== null && pacing < 0;
      });
    }
    if (r.neverContacted) {
      list = list.filter(c => !this.notes().some(n => n.customerId === c.id));
    } else if (r.notContactedDays != null && r.notContactedDays > 0) {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - r.notContactedDays);
      list = list.filter(c => {
        const lastNote = this.notes()
          .filter(n => n.customerId === c.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        return !lastNote || new Date(lastNote.createdAt) < threshold;
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
  }

  get availableCrops(): string[] {
    const crops = new Set<string>();
    for (const c of this.filteredCustomers()) {
      for (const crop of (c.commodities ?? [])) {
        if (crop.trim()) crops.add(crop.trim());
      }
    }
    return [...crops].sort();
  }

  get availableStates(): string[] {
    const states = new Set<string>();
    for (const c of this.filteredCustomers()) {
      const s = c.extendedStateProvince || c.stateProvince;
      if (s) states.add(s);
    }
    const list = [...states].sort();
    return list.length > 1 ? list : [];
  }

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
  showRefinePanel = signal(false);
  pendingRefinements = signal<RefinementFilters>({});
  appliedRefinements = signal<RefinementFilters>({});
  notContactedDaysInput = signal('');

  private _lastContactCache = new Map<number, { text: string; colorClass: string }>();
  private _customerCropsCache = new Map<number, string[]>();

  exampleQueries = [
    'Top 10 largest operations',
    'Customers with more than 500 acres',
    'Farmers not contacted in over 30 days',
    'Producers with active contracts',
    'Growers who delivered corn this year',
    'Customers with overdue contracts',
    'Farmers with no email',
    'Customers planting soybeans in 2026'
  ];


  constructor() {
    this._initTradeUnits = this.appState.selectedTradeUnits().slice();
    this._initialized = true;

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

    // Load all user-accessible trade units so build-list works without prior home page visit
    this.apiService.getUserTradeUnits().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (groups) => {
        const units = new Set<string>();
        for (const g of groups) {
          g.tradeUnitCodes.forEach(u => units.add(u));
        }
        this._allUserTradeUnits.set([...units].sort());
        // If no data was loaded yet (user came here without selecting TUs on home), load now
        if (this.customers().length === 0) {
          this._loadData();
        }
      }
    });

    // Only load immediately if we already have explicit TU selection or cached data
    if (this.appState.selectedTradeUnits().length > 0 || this.appState.customers().length > 0) {
      this._loadData();
    } else {
      this.loading.set(true); // Show loading state while we wait for user TUs
    }

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
          tradeUnits: this._initTradeUnits
        });
      }
    });
  }

  private _loadData(): void {
    if (this._dataLoadStarted) return;
    this._dataLoadStarted = true;
    this.loading.set(true);

    // Use cached data from AppStateService if already loaded (trade-unit-filtered by home)
    const cachedCustomers = this.appState.customers();
    if (cachedCustomers.length > 0) {
      this.customers.set(cachedCustomers);
      this.contracts.set(this.appState.contracts());
      this.tickets.set(this.appState.tickets());
      this.plantingIntentions.set(this.appState.plantingIntentions());
      this.notes.set(this.appState.notes());
      this.storedGrain.set(this.appState.storedGrain());
      this.savedLists.set(this.appState.savedLists());
      this._rebuildCaches();
      // Restore UI state if we have it
      this._restoreUIState();
      // Load and merge ProducerDetails (commodities, bin capacity, etc.) if not already merged
      this._loadAndMergeProducerDetails();
      return;
    }

    // No cache — load from API using effective trade units
    const tradeUnits = this.effectiveTradeUnits;
    const tuParam = tradeUnits.length > 0 ? tradeUnits : undefined;
    forkJoin({
      customers: this.apiService.getCustomers(tuParam).pipe(catchError(() => of([] as Customer[]))),
      contracts: this.apiService.getContracts(tuParam).pipe(catchError(() => of([] as Contract[]))),
      tickets: this.apiService.getTickets(tuParam).pipe(catchError(() => of([] as Ticket[]))),
      plantingIntentions: this.apiService.getPlantingIntentions().pipe(catchError(() => of([] as PlantingIntention[]))),
      notes: this.apiService.getNotes().pipe(catchError(() => of([] as Note[]))),
      storedGrain: this.apiService.getStoredGrain().pipe(catchError(() => of([] as StoredGrain[]))),
      savedLists: this.apiService.getSavedLists().pipe(catchError(() => of([] as SavedList[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.customers.set(data.customers);
        this.contracts.set(data.contracts);
        this.tickets.set(data.tickets);
        this.plantingIntentions.set(data.plantingIntentions);
        this.notes.set(data.notes);
        this.storedGrain.set(data.storedGrain);
        this.savedLists.set(data.savedLists);
        this.appState.setCustomers(data.customers);
        this.appState.setContracts(data.contracts);
        this.appState.setTickets(data.tickets);
        this.appState.setPlantingIntentions(data.plantingIntentions);
        this.appState.setNotes(data.notes);
        this.appState.setStoredGrain(data.storedGrain);
        this.appState.setSavedLists(data.savedLists);
        this._rebuildCaches();
        this._restoreUIState();
        // Load and merge ProducerDetails (commodities, bin capacity, etc.)
        this._loadAndMergeProducerDetails();
      },
      error: () => {
        this.loading.set(false);
        this.toastService.error('Failed to load data');
      }
    });
  }

  private _loadAndMergeProducerDetails(): void {
    this.apiService.getAllProducerDetails().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (details) => {
        if (details.length === 0) {
          this.loading.set(false);
          return;
        }
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
          this.appState.setCustomers(this.customers());
          this._customerCropsCache.clear();
        }
        // Re-apply the current query with the newly merged customer data
        // (uses cached contracts/tickets/notes — no extra API calls needed here)
        if (this.hasGenerated() && this.queryText().trim()) {
          this._applyNlqFilter();
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  private _restoreUIState(): void {
    const saved = this.appState.buildListState();
    if (!saved) return;

    // If trade units changed since state was saved, clear everything —
    // the user must re-enter and regenerate for the new selection.
    const currentTus = this.effectiveTradeUnits;
    const savedTus = saved.tradeUnits ?? [];
    const tradeUnitsMatch = currentTus.length === savedTus.length &&
      currentTus.every(tu => savedTus.includes(tu));

    if (!tradeUnitsMatch) {
      this.appState.clearBuildListState();
      return;
    }

    this.queryText.set(saved.queryText);
    this.hasGenerated.set(saved.hasGenerated);
    this.showMap.set(saved.showMap);
    this.detectedState.set(saved.detectedState);
    this.queryUnrecognized.set(saved.queryUnrecognized);
    if (saved.hasGenerated && saved.filteredCustomerIds.length > 0) {
      const idSet = new Set(saved.filteredCustomerIds);
      this.filteredCustomers.set(this.customers().filter(c => idSet.has(c.id)));
    }
  }

  toggleMap(): void {
    this.showMap.update(v => !v);
  }

  getMapCustomers(): Customer[] {
    return this.hasGenerated() ? this.displayedCustomers : this.customers();
  }

  clearQuery(): void {
    this.queryText.set('');
    this.hasGenerated.set(false);
    this.filteredCustomers.set([]);
    this.detectedState.set(null);
    this.queryUnrecognized.set(false);
    this.showMap.set(false);
    this.showRefinePanel.set(false);
    this.pendingRefinements.set({});
    this.appliedRefinements.set({});
    this.notContactedDaysInput.set('');
    this.appState.clearBuildListState();
  }

  onQueryChange(query: string): void {
    if (!query.trim()) {
      this.hasGenerated.set(false);
      this.filteredCustomers.set([]);
      this.detectedState.set(null);
      this.queryUnrecognized.set(false);
    }
  }

  onQueryKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (this.hasTradeUnits && this.queryText().trim() && !this.isProcessing() && !this.loading()) {
        this.processQuery();
      }
    }
  }

  useExampleQuery(example: string): void {
    if (this.loading()) return;
    this.detectedState.set(null);
    this.hasGenerated.set(false);
    this.filteredCustomers.set([]);
    this.queryUnrecognized.set(false);
    this.queryText.set(example);
    this.processQuery();
  }

  processQuery(overrideTradeUnits?: string[]): void {
    if (!this.queryText().trim()) return;

    this.isProcessing.set(true);
    const tradeUnits = overrideTradeUnits ?? this.effectiveTradeUnits;
    const tuParam = tradeUnits.length > 0 ? tradeUnits : undefined;

    // Always fetch fresh data before filtering so the query sees the latest
    // notes, contracts, tickets, ProducerDetails, and planting intentions.
    forkJoin({
      customers: this.apiService.getCustomers(tuParam).pipe(catchError(() => of([] as Customer[]))),
      contracts: this.apiService.getContracts(tuParam).pipe(catchError(() => of([] as Contract[]))),
      tickets: this.apiService.getTickets(tuParam).pipe(catchError(() => of([] as Ticket[]))),
      plantingIntentions: this.apiService.getPlantingIntentions().pipe(catchError(() => of([] as PlantingIntention[]))),
      notes: this.apiService.getNotes().pipe(catchError(() => of([] as Note[]))),
      storedGrain: this.apiService.getStoredGrain().pipe(catchError(() => of([] as StoredGrain[]))),
      producerDetails: this.apiService.getAllProducerDetails().pipe(catchError(() => of([] as ProducerDetails[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        // Merge ProducerDetails into customer objects
        const detailsMap = new Map(data.producerDetails.map(d => [d.customerId, d]));
        this.customers.set(data.customers.map(customer => {
          const pd = detailsMap.get(customer.id);
          if (!pd) return customer;
          return {
            ...customer,
            totalAcres: pd.totalAcres ?? customer.totalAcres,
            binCapacity: pd.binCapacity ?? customer.binCapacity,
            primaryContact: pd.primaryContact ?? customer.primaryContact,
            commodities: pd.commodities ? pd.commodities.split(',').map((c: string) => c.trim()) : customer.commodities,
            linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : customer.linkedProducerIds
          };
        }));
        this.contracts.set(data.contracts);
        this.tickets.set(data.tickets);
        this.notes.set(data.notes);
        this.plantingIntentions.set(data.plantingIntentions);
        this.storedGrain.set(data.storedGrain);

        // Update appState cache so other pages see the fresh data too
        this.appState.setCustomers(this.customers());
        this.appState.setContracts(this.contracts());
        this.appState.setTickets(this.tickets());
        this.appState.setNotes(this.notes());
        this.appState.setPlantingIntentions(this.plantingIntentions());
        this.appState.setStoredGrain(this.storedGrain());

        this._rebuildCaches();
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
      storedGrain: this.storedGrain()
    };
    const result = this.nlqFilterService.parseAndFilter(this.queryText(), context);
    this.detectedState.set(result.detectedState);
    this.hasGenerated.set(true);
    this.queryUnrecognized.set(result.matchedPatterns.length === 0);

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

    this._rebuildCaches();
  }


  private _rebuildCaches(): void {
    this._lastContactCache.clear();
    this._customerCropsCache.clear();
  }

  getStateDisplayName(state: string): string {
    return this.nlqFilterService.getStateDisplayName(state);
  }

  loadSavedList(list: SavedList): void {
    if (this.loading()) return;
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
    const customerContracts = this.contracts().filter(ct => ct.ctrmCustomerId === customer.sourceCustomerId);
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

    const tradeUnits = this.effectiveTradeUnits;
    const payload = {
      name: this.newListName(),
      query: this.queryText(),
      tradeUnits: tradeUnits.length > 0 ? tradeUnits.join(',') : undefined,
      filters: this.activeRefinementCount > 0 ? { ...this.appliedRefinements() } : undefined
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
    const cached = this._lastContactCache.get(customerId);
    if (cached !== undefined) {
      return cached;
    }

    const lastNote = this.notes()
      .filter(n => n.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    let result: { text: string; colorClass: string };

    if (!lastNote) {
      result = { text: 'Never contacted', colorClass: 'text-scoular-red' };
    } else {
      const daysAgo = Math.floor((Date.now() - new Date(lastNote.createdAt).getTime()) / (1000 * 60 * 60 * 24));

      if (daysAgo === 0) result = { text: 'Contacted today', colorClass: 'text-scoular-green' };
      else if (daysAgo === 1) result = { text: 'Contacted yesterday', colorClass: 'text-scoular-green' };
      else if (daysAgo < 7) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-green' };
      else if (daysAgo < 30) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-yellow-500' };
      else result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-red' };
    }

    this._lastContactCache.set(customerId, result);
    return result;
  }

  getCustomerCrops(customerId: number): string[] {
    const cached = this._customerCropsCache.get(customerId);
    if (cached !== undefined) {
      return cached;
    }

    const customer = this.customers().find(c => c.id === customerId);
    // Farmer detail commodities (ProducerDetails) — primary source
    const detailCrops = customer?.commodities?.length ? [...customer.commodities] : [];
    // Contract commodities (ODS data) — supplemental source
    const contractCrops = customer?.sourceCustomerId
      ? [...new Set(
          this.contracts()
            .filter(c => c.ctrmCustomerId === customer.sourceCustomerId)
            .map(c => c.commodityCode)
            .filter((crop): crop is string => !!crop)
        )]
      : [];
    // Planting intentions as supplemental source
    const intentionCrops = [...new Set(
      this.plantingIntentions().filter(p => p.customerId === customerId).map(p => p.crop)
    )];
    const result = [...new Set([...detailCrops, ...contractCrops, ...intentionCrops])].slice(0, 5);

    this._customerCropsCache.set(customerId, result);
    return result;
  }
}
