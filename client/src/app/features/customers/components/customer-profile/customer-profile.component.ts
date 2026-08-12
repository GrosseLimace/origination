import { Component, input, output, inject, effect, computed, ChangeDetectionStrategy, ViewChild, ElementRef, signal, DestroyRef, HostListener } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ApiService } from '@core/services/api.service';
import { ThemeService } from '@core/services/theme.service';
import { ContractsTableComponent } from '../contracts-table/contracts-table.component';
import { TicketsTableComponent } from '../tickets-table/tickets-table.component';
import { PlantingIntentionsTableComponent } from '../planting-intentions-table/planting-intentions-table.component';
import { StoredGrainTableComponent } from '../stored-grain-table/stored-grain-table.component';
import { ProducerInsightsComponent } from '../producer-insights/producer-insights.component';
import { ContractPacingCardComponent } from '../contract-pacing-card/contract-pacing-card.component';
import { GrowthOpportunityComponent } from '../growth-opportunity/growth-opportunity.component';
import { ActivitySummaryComponent } from '../activity-summary/activity-summary.component';
import { EditCustomerDialogComponent } from '../edit-customer-dialog/edit-customer-dialog.component';
import { CustomerPrintReportComponent } from '../customer-print-report/customer-print-report.component';
import { AppStateService } from '@core/services/app-state.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, Ticket, PlantingIntention, StoredGrain, Note, ContractPricingLine, DashboardPlantingEstimate, Commodity, HarvestWindow, SavedList } from '@models';
import { commodityChipClass } from '@shared/utils/commodity-color';
import { buildProductionCoverage } from '@shared/utils/production-coverage';

@Component({
  selector: 'app-customer-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ContractsTableComponent,
    TicketsTableComponent,
    PlantingIntentionsTableComponent,
    StoredGrainTableComponent,
    ProducerInsightsComponent,
    ContractPacingCardComponent,
    GrowthOpportunityComponent,
    ActivitySummaryComponent,
    EditCustomerDialogComponent,
    CustomerPrintReportComponent
  ],
  templateUrl: './customer-profile.component.html'
})
export class CustomerProfileComponent {
  private readonly appState = inject(AppStateService);
  private readonly apiService = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  /** Harvest windows from app state — exposed for pacing card template binding. */
  readonly harvestWindows = this.appState.harvestWindows;

  /**
   * Historical closed contracts from base.Contract for this customer.
   * Fetched ONCE per customer (api.service dedupes anyway) and shared across
   * the pacing card and producer-insights so we don't hit the endpoint twice.
   */
  readonly historicalContracts = signal<Contract[]>([]);

  public customer = input.required<Customer>();
  public allCustomers = input<Customer[]>([]);

  // ── Grain on Farm (per-commodity on-hand + target) ──────────────────────
  /** Grain-on-farm rows with a positive on-hand or target, or a grade entered — sorted by on-hand desc. */
  readonly grainOnFarmRows = computed(() =>
    (this.customer().grainOnFarm ?? [])
      .filter(g => (g.bushelsOnHand ?? 0) > 0 || (g.targetBushels ?? 0) > 0 || !!(g.grade ?? '').trim())
      .sort((a, b) => (b.bushelsOnHand ?? 0) - (a.bushelsOnHand ?? 0)));
  /** Total bushels currently on the farm (sum of per-commodity on-hand). */
  readonly grainOnFarmTotal = computed(() =>
    (this.customer().grainOnFarm ?? []).reduce((sum, g) => sum + (g.bushelsOnHand ?? 0), 0));
  /** Whether the per-commodity grain-on-farm breakdown is expanded in the profile header. */
  showGrainOnFarm = signal(false);
  /** Expand/collapse the breakdown — only when there's something to show. (Editing the values
   *  lives in the Edit Producer dialog; this is a read-only summary.) */
  toggleGrainOnFarm(): void {
    if (this.grainOnFarmRows().length > 0) this.showGrainOnFarm.update(v => !v);
  }
  /** Tailwind chip classes for a grain-on-farm commodity — the shared per-crop color. */
  grainChipClass(commodity: string): string {
    return commodityChipClass(commodity);
  }
  public selectedTradeUnits = input<string[]>([]);
  public contracts = input<Contract[]>([]);
  public tickets = input<Ticket[]>([]);
  public pricingLines = input<ContractPricingLine[]>([]);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public storedGrain = input<StoredGrain[]>([]);
  public notes = input<Note[]>([]);
  public yieldEstimates = input<DashboardPlantingEstimate[]>([]);
  public commodities = input<Commodity[]>([]);
  public isLoadingEstimates = input(false);
  public isLoadingContracts = input(false);
  public isLoadingUnappliedTickets = input(false);
  public isLoadingPricingLines = input(false);
  public isLoadingPlanting = input(false);
  public isLoadingStoredGrain = input(false);

  // Unfiltered data for Activity Summary
  public allCustomerContracts = input<Contract[]>([]);
  public allCustomerTickets = input<Ticket[]>([]);
  public allCustomerPlantingIntentions = input<PlantingIntention[]>([]);
  public allCustomerStoredGrain = input<StoredGrain[]>([]);

  public onAddPlanting = output<{crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}>();
  public onEditPlanting = output<{intentionId: number, crop: string, type?: string, description?: string, acres: number, plantingYear: number}>();
  public onDeletePlanting = output<number>();
  /** True when the contracts table wants the page at full width (columns expanded on the
   *  contracts tab) so the host page can drop the Notes sidebar below the profile. */
  public onContractsWideChange = output<boolean>();
  /** Saved lists (already TU-matched + enriched) the current producer can be quick-added to. */
  public savedListsForCustomer = input<SavedList[]>([]);
  /** Manager-only: team lists (all lists tied to the TU, any creator) for the Add-to-List Team tab. */
  public teamListsForCustomer = input<SavedList[]>([]);
  /** True when the current user is a manager — gates the Add-to-List "Team Lists" tab. */
  public isManager = input(false);
  /** Save staged saved-list membership changes for the current producer; the host persists them. */
  public onSaveSavedListMembership = output<{ listId: number; add: boolean }[]>();
  public onAddNote = output<string>();
  public onTogglePin = output<Note>();
  public onSaveCustomer = output<{ customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; primaryPhone: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean; grainOnFarm: { commodityGroup: string; bushelsOnHand?: number; targetBushels?: number; grade?: string }[] }>();
  public linkedCustomers = input<Customer[]>([]);
  public onSelectLinkedCustomer = output<number>();
  public openContractId = input<number | null>(null);
  public openTab = input<string | null>(null);
  public openTicketCrop = input<string | null>(null);
  public openPlantingYear = input<number | null>(null);

  @ViewChild(PlantingIntentionsTableComponent) private plantingTable?: PlantingIntentionsTableComponent;
  @ViewChild('tabsSection') private tabsSectionRef?: ElementRef<HTMLElement>;

  private readonly themeService = inject(ThemeService);
  private readonly usageTracking = inject(UsageTrackingService);

  trackCallClick(): void {
    this.usageTracking.trackCallClick(this.customer().id.toString());
  }

  trackEmailClick(): void {
    this.usageTracking.trackEmailClick(this.customer().id.toString());
  }

  // Local state - signals
  activeTab = signal('contracts');
  showProducerInsights = signal(false);
  showESignRecipients = signal(false);
  showEditDialog = signal(false);
  showPrintReport = signal(false);
  showAddToListMenu = signal(false); // "Add to List" header dropdown open state
  /** Which tab the Add-to-List dropdown is showing: the user's own lists or (managers) team lists. */
  addToListTab = signal<'saved' | 'team'>('saved');
  /** Staged desired membership while the menu is open (listId -> member?). Applied on Save,
   *  discarded on Cancel. Initialized from current membership each time the menu opens. */
  stagedMembership = signal<Map<number, boolean>>(new Map());

  /** Lists shown in the dropdown for the active tab. */
  readonly activeAddToLists = computed<SavedList[]>(() =>
    this.addToListTab() === 'team' ? this.teamListsForCustomer() : this.savedListsForCustomer());

  /** All lists the menu can stage changes against — own + (manager) team. Used when seeding the
   *  staged map and computing the save diff so toggles persist across tab switches. */
  private allAddToLists(): SavedList[] {
    return this.isManager()
      ? [...this.savedListsForCustomer(), ...this.teamListsForCustomer()]
      : this.savedListsForCustomer();
  }
  selectedPlantingYear = signal(0); // 0 = auto (newest)
  private _yearUserSelected = false; // true only when user explicitly clicks a year tab

  /** Whether the current producer is currently (persisted) a member of the given saved list.
   *  Excluded wins, then a manual include, then the enriched query-derived membership (covers
   *  lists whose NLQ query matched no patterns and therefore have no cached customerIds). */
  isInList(list: SavedList): boolean {
    const id = this.customer().id;
    if (list.excludedCustomerIds?.includes(id)) return false;
    if (list.includedCustomerIds?.includes(id)) return true;
    return (list.customerIds ?? []).includes(id);
  }

  /** The staged (checkbox) membership for a list — staged value if set, else current membership. */
  isStagedMember(list: SavedList): boolean {
    const staged = this.stagedMembership().get(list.id);
    return staged ?? this.isInList(list);
  }

  /** Open the menu, seeding staged state from current membership; or cancel-close it. */
  toggleAddToListMenu(): void {
    if (this.showAddToListMenu()) { this.cancelAddToList(); return; }
    const seed = new Map<number, boolean>();
    for (const l of this.allAddToLists()) seed.set(l.id, this.isInList(l));
    this.stagedMembership.set(seed);
    this.addToListTab.set('saved');
    this.showAddToListMenu.set(true);
  }

  /** Toggle a single list's staged checkbox (no persistence until Save). */
  toggleStaged(list: SavedList): void {
    const next = new Map(this.stagedMembership());
    next.set(list.id, !this.isStagedMember(list));
    this.stagedMembership.set(next);
  }

  /** True when any staged value differs from current membership (enables the Save button).
   *  Spans both own and team lists so a staged change on either tab counts. */
  hasStagedChanges(): boolean {
    return this.allAddToLists().some(l => this.isStagedMember(l) !== this.isInList(l));
  }

  /** Apply staged changes across both tabs: emit the diff for the host to persist, then close. */
  saveAddToList(): void {
    const changes = this.allAddToLists()
      .filter(l => this.isStagedMember(l) !== this.isInList(l))
      .map(l => ({ listId: l.id, add: this.isStagedMember(l) }));
    if (changes.length > 0) this.onSaveSavedListMembership.emit(changes);
    this.cancelAddToList();
  }

  /** Close the menu and discard staged changes. */
  cancelAddToList(): void {
    this.showAddToListMenu.set(false);
    this.addToListTab.set('saved');
    this.stagedMembership.set(new Map());
  }

  /** Close (discard) on any outside click or Escape (the dropdown container stops propagation). */
  @HostListener('document:click')
  onDocumentClick(): void { if (this.showAddToListMenu()) this.cancelAddToList(); }

  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.showAddToListMenu()) this.cancelAddToList(); }
  /** True while the contracts table's optional columns are expanded (set from its output). */
  contractsColumnsExpanded = signal(false);

  constructor() {
    effect(() => {
      // Contracts wants full width only while its columns are expanded AND we're on the
      // Contracts tab. Leaving the tab destroys the contracts-table (which comes back
      // collapsed), so reset the flag on tab-leave and let the page revert to the sidebar.
      const onContracts = this.activeTab() === 'contracts';
      if (!onContracts && this.contractsColumnsExpanded()) {
        this.contractsColumnsExpanded.set(false); // re-triggers this effect, which then emits false
        return;
      }
      this.onContractsWideChange.emit(onContracts && this.contractsColumnsExpanded());
    });

    effect(() => {
      // When arriving from Insights with a specific contract, switch to contracts tab
      // (contracts-table handles scrolling to the specific row)
      const openContractId = this.openContractId();
      if (openContractId != null) {
        this.activeTab.set('contracts');
      }
    });

    effect(() => {
      // When arriving from Insights with a requested tab (e.g. 'tickets' for Spot Loads), switch to it
      const tab = this.openTab();
      if (tab) {
        this.activeTab.set(tab);
        setTimeout(() => {
          this.tabsSectionRef?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      }
    });

    effect(() => {
      // When arriving from the dashboard with a planting year, honor it instead of the auto-newest pick.
      const year = this.openPlantingYear();
      if (year && year > 0) {
        this._yearUserSelected = true;
        this.selectedPlantingYear.set(year);
      }
    });

    effect(() => {
      // Reset eSign recipients panel and year selection when switching customers.
      // If we arrived with an explicit openPlantingYear (e.g. from the dashboard), keep it.
      const _customer = this.customer();
      this.showESignRecipients.set(false);
      this.showGrainOnFarm.set(false); // collapse the grain-on-farm breakdown — default closed per producer
      this.cancelAddToList();
      const pendingYear = this.openPlantingYear();
      if (pendingYear && pendingYear > 0) {
        this._yearUserSelected = true;
        this.selectedPlantingYear.set(pendingYear);
      } else {
        this._yearUserSelected = false;
        this.selectedPlantingYear.set(0);
      }
    });

    // Fetch historical closed contracts (base.Contract) once per customer.
    // Shared with both contract-pacing-card and producer-insights via inputs so the
    // endpoint is only hit once. ApiService also dedupes by `contracts-pacing:{id}` key.
    effect(() => {
      const id = this.customer()?.id;
      if (id == null) { this.historicalContracts.set([]); return; }
      this.apiService.getHistoricalContractsForPacing(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(contracts => this.historicalContracts.set(contracts));
    });

    // Effect: auto-select the newest planting year when data changes.
    // Kept as an effect (not computed) because it writes to selectedPlantingYear.
    effect(() => {
      // If the user explicitly chose a year (or arrived with one from the dashboard),
      // honor it even if there's no data for that year — don't silently jump to newest.
      if (this._yearUserSelected) return;

      const best = this.plantingYearOptions()[0] || 0;
      if (best !== this.selectedPlantingYear()) {
        this.selectedPlantingYear.set(best);
      }
    });

    effect(() => {
      const contracts = this.contracts();

      // Update unapplied ticket count — a ticket is unapplied only when its contract prefix is U or L
      const tickets = this.tickets();
      this._unappliedTicketCount = tickets.filter(t => !t.isApplied).length;

      // Update tabs cache
      this._tabs = [
        { id: 'contracts', label: 'Open Contracts', shortLabel: 'Cont', count: contracts.filter(c => !c.closedDate).length },
        { id: 'tickets', label: 'Unapplied Tickets', shortLabel: 'Tick', count: this._unappliedTicketCount },
        // Newest season only, not every year on record — the tab badge should answer "how many
        // crops are planned for the season I'm looking at", not "how many rows exist in total".
        { id: 'planting', label: 'Planting', shortLabel: 'Plan', count: this.newestSeasonIntentionCount() },
        { id: 'storage', label: 'Storage', shortLabel: 'Stor', count: new Set(this.storedGrain().map(g => g.crop || 'Unknown')).size }
      ];
    });

    effect(() => {
      // Rebuild effective commodities from tickets + user-added
      const tickets = this.tickets();
      const customer = this.customer();
      const ticketCommodities = [...new Set(
        tickets.map(t => t.productCode || '').filter(Boolean)
      )];
      const userCommodities = customer?.commodities || [];
      this._effectiveCommodities = [...new Set([...ticketCommodities, ...userCommodities])].sort();
    });
  }

  selectTab(tabId: string): void {
    this.activeTab.set(tabId);
    // Track tab clicks for usage dashboard
    if (tabId === 'planting') this.usageTracking.trackPlantingTabClick();
    if (tabId === 'storage') this.usageTracking.trackStorageDropdownOpen(this.customer().id.toString());
    // Defer scroll until after Angular renders the new tab content — otherwise the DOM
    // still shows the old (tall) tab and the scroll position doesn't update correctly.
    setTimeout(() => {
      const el = this.tabsSectionRef?.nativeElement;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  }

  // Projected production vs. contracted volume, per commodity. The arithmetic lives in a shared
  // pure util so it can be unit-tested and so the other places that recompute it can converge on
  // one implementation. Still a computed(), so it re-derives whenever any input signal changes and
  // OnPush re-renders on its own.
  readonly contractMetrics = computed(() => buildProductionCoverage({
    intentions: this.plantingIntentions(),
    contracts: this.contracts(),
    commodities: this.commodities(),
    yieldEstimates: this.yieldEstimates(),
    harvestWindows: this.appState.harvestWindows(),
    year: this.selectedPlantingYear(),
  }));

  /** How many crop years the profile surfaces. Producers accumulate seasons indefinitely, but only
   *  the current and prior one are actionable, so older years are hidden rather than paged. */
  private static readonly MaxPlantingYears = 2;

  /** The crop years this profile offers, newest first — the most recent
   *  {@link MaxPlantingYears} the producer has planting intentions for. Contract crop years are only
   *  a fallback, for a producer who has contracts but hasn't declared any intentions yet. */
  readonly plantingYearOptions = computed(() => {
    const intentionYears = [...new Set(
      this.plantingIntentions().map(pi => pi.plantingYear).filter((y): y is number => !!y)
    )].sort((a, b) => b - a);

    if (intentionYears.length > 0) {
      return intentionYears.slice(0, CustomerProfileComponent.MaxPlantingYears);
    }

    return [...new Set(
      this.contracts().map(c => c.cropYear).filter((y): y is number => !!y)
    )].sort((a, b) => b - a).slice(0, CustomerProfileComponent.MaxPlantingYears);
  });

  /** Number of intentions in the most recent season the producer has planted — what the Planting
   *  tab badge counts. */
  readonly newestSeasonIntentionCount = computed(() => {
    const newest = this.plantingYearOptions()[0];
    if (!newest) return this.plantingIntentions().length;
    return this.plantingIntentions().filter(pi => pi.plantingYear === newest).length;
  });

  /** Planting intentions scoped to the years the profile shows, so the table and the Growth
   *  Opportunity picker agree on which seasons exist. */
  readonly visiblePlantingIntentions = computed(() => {
    const years = new Set(this.availablePlantingYears);
    if (years.size === 0) return this.plantingIntentions();
    return this.plantingIntentions().filter(pi => years.has(pi.plantingYear));
  });

  private _tabs: any[] = [];
  private _unappliedTicketCount = 0;
  private _effectiveCommodities: string[] = [];

  toggleProducerInsights(): void {
    this.showProducerInsights.update(v => !v);
  }

  openEditDialog(): void {
    this.showEditDialog.set(true);
  }

  closeEditDialog(): void {
    this.showEditDialog.set(false);
  }

  openAddPlanting(): void {
    this.plantingTable?.openAddDialog();
  }

  handleSaveCustomer(data: { customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; primaryPhone: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean; grainOnFarm: { commodityGroup: string; bushelsOnHand?: number; targetBushels?: number; grade?: string }[] }): void {
    this.usageTracking.trackProducerDetailsEdit(data.customerId.toString());
    this.onSaveCustomer.emit(data);
    this.closeEditDialog();
  }

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  get tabs() {
    return this._tabs;
  }

  getTabClass(tabId: string): string {
    const isActive = this.activeTab() === tabId;
    const baseClass = 'flex-1 text-center px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 border-0 outline-none';

    if (isActive) {
      return `${baseClass} bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm`;
    }
    return `${baseClass} bg-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white`;
  }

  /** Year options for the picker. A year deep-linked from the dashboard is included even when it
   *  falls outside the most-recent window, so the active selection is never missing from the list. */
  get availablePlantingYears(): number[] {
    const options = this.plantingYearOptions();
    const selected = this.selectedPlantingYear();
    return selected > 0 && !options.includes(selected)
      ? [selected, ...options].sort((a, b) => b - a)
      : options;
  }

  selectPlantingYear(year: number): void {
    this._yearUserSelected = true;
    this.selectedPlantingYear.set(year);
  }

  /** Feeds the printed summary boxes below. (contractYear / totalProjectedYield /
   *  marketSharePercentage were dropped when the coverage breakdown moved to Growth Opportunity —
   *  that panel reads the same computed directly.) */
  get totalContracted(): number { return this.contractMetrics().totalContracted; }

  getCustomerAddress(): string {
    const c = this.customer();
    return [c.addressLine1, c.location, c.stateProvince, c.postalCode].filter(v => !!v).join(', ');
  }

  /** Splits ScoularView recipients string into individual entries.
   *  Handles commas inside names (e.g., "Ade, Clay 785-555-1234") by only splitting
   *  on commas that separate complete name+phone pairs. */
  parseRecipients(raw: string): string[] {
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    const results: string[] = [];
    let buffer = '';
    for (const part of parts) {
      if (buffer) {
        buffer += ', ' + part;
      } else {
        buffer = part;
      }
      // A complete recipient has a phone number (3+ consecutive digits)
      if (/\d{3}/.test(buffer)) {
        results.push(buffer);
        buffer = '';
      }
    }
    // If anything remains without a phone number, attach it to the last entry or add as-is
    if (buffer) {
      if (results.length > 0) {
        results[results.length - 1] += ', ' + buffer;
      } else {
        results.push(buffer);
      }
    }
    return results;
  }
  get bushelsAvailable(): number { return this.contractMetrics().bushelsAvailable; }

  /**
   * Harvest-window-based pacing direction summary for the top-of-profile pace card.
   * Mirrors the per-commodity logic in contract-pacing-card: for each active harvest window,
   * sum bushels whose delivery period overlaps the window in this year vs last year.
   * Returns 'down' if ANY commodity is down, 'up' if at least one has data and none are down,
   * 'flat' if there's commodity data but no movement, 'none' if no data to evaluate.
   */
  readonly harvestPacingSummary = computed<{ direction: 'up' | 'down' | 'flat' | 'none'; year: number }>(() => {
    const contracts = this.contracts();
    const windows = this.harvestWindows().filter(hw => hw.isActive !== false);
    const year = new Date().getFullYear();
    if (contracts.length === 0 || windows.length === 0) return { direction: 'none', year };

    let anyDown = false;
    let anyData = false;
    let anyMovement = false;
    for (const hw of windows) {
      let thisYear = 0;
      let lastYear = 0;
      for (const c of contracts) {
        if (!this._contractMatchesPacingCommodity(c, hw.commodity)) continue;
        if (this._contractOverlapsHarvestWindow(c, hw, year)) thisYear += c.quantity;
        if (this._contractOverlapsHarvestWindow(c, hw, year - 1)) lastYear += c.quantity;
      }
      if (thisYear === 0 && lastYear === 0) continue;
      anyData = true;
      if (thisYear < lastYear) { anyDown = true; anyMovement = true; }
      else if (thisYear > lastYear) { anyMovement = true; }
    }
    if (!anyData) return { direction: 'none', year };
    if (anyDown) return { direction: 'down', year };
    return { direction: anyMovement ? 'up' : 'flat', year };
  });

  /** Arrow glyph for the harvest pacing card. */
  get harvestPacingArrow(): string {
    const d = this.harvestPacingSummary().direction;
    return d === 'up' ? '▲' : d === 'down' ? '▼' : '—';
  }

  /** Box classes for the Harvest Contract Pace card based on commodity-level direction. */
  get harvestPacingBoxClass(): string {
    const d = this.harvestPacingSummary().direction;
    if (d === 'up') return 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400';
    if (d === 'down') return 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400';
    return 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400';
  }

  private _contractOverlapsHarvestWindow(c: Contract, hw: HarvestWindow, cropYear: number): boolean {
    if (!c.deliveryStart && !c.deliveryEnd) return false;
    const windowStart = new Date(cropYear, hw.deliveryStartMonth - 1, hw.deliveryStartDay);
    const windowEnd = new Date(cropYear, hw.deliveryEndMonth - 1, hw.deliveryEndDay);
    windowEnd.setHours(23, 59, 59, 999);
    const delStart = c.deliveryStart ? new Date(c.deliveryStart) : new Date(c.deliveryEnd!);
    const delEnd = c.deliveryEnd ? new Date(c.deliveryEnd) : new Date(c.deliveryStart!);
    return delStart <= windowEnd && delEnd >= windowStart;
  }

  private _contractMatchesPacingCommodity(c: Contract, hwCommodity: string): boolean {
    const target = hwCommodity.trim().toUpperCase();
    if (!target) return false;
    const group = (c.commodityGroup || '').trim().toUpperCase();
    if (group && group === target) return true;
    const desc = (c.commodityDescription || '').trim().toUpperCase();
    if (desc && desc.includes(target)) return true;
    const code = (c.commodityCode || '').trim().toUpperCase();
    if (code && code.includes(target)) return true;
    return false;
  }

  get unappliedTicketCount(): number {
    return this._unappliedTicketCount;
  }

  getEffectiveCommodities(): string[] {
    return this._effectiveCommodities;
  }

  private _escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Opens a print dialog with formatted customer information */
  printCustomerInfo(): void {
    const activeContracts = this.contracts().filter(c => c.status === 'Active' || c.status === 'Pending');

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Customer Info - ${this._escapeHtml(this.customer().name)}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 40px; color: #000; }
          h1 { font-size: 24px; margin-bottom: 8px; color: #000; }
          h2 { font-size: 18px; margin-top: 24px; margin-bottom: 12px; border-bottom: 2px solid #000; padding-bottom: 4px; color: #000; }
          h3 { font-size: 14px; margin-top: 16px; margin-bottom: 8px; color: #000; }
          .header { margin-bottom: 24px; }
          .farm-name { color: #000; font-size: 14px; margin-bottom: 4px; }
          .print-date { color: #000; font-size: 12px; }
          .section { margin-bottom: 20px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          .info-item { margin-bottom: 8px; }
          .label { font-weight: bold; color: #000; font-size: 12px; text-transform: uppercase; }
          .value { font-size: 14px; margin-top: 2px; color: #000; }
          .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 12px; }
          .summary-box { border: 1px solid #000; border-radius: 4px; padding: 12px; text-align: center; }
          .summary-value { font-size: 20px; font-weight: bold; color: #000; }
          .summary-label { font-size: 12px; color: #000; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
          th { background: #fff; text-align: left; padding: 10px 8px; font-weight: 600; border-bottom: 2px solid #000; color: #000; }
          td { padding: 10px 8px; border-bottom: 1px solid #000; color: #000; }
          .status { font-size: 12px; font-weight: 500; color: #000; }
          .text-right { text-align: right; }
          @media print {
            body { padding: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${this._escapeHtml(this.customer().name)}</h1>
          <div class="farm-name">${this._escapeHtml(this.customer().farm ?? '')}</div>
          <div class="print-date">Printed: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>

        <h2>Customer Information</h2>
        <div class="grid">
          <div>
            <h3>Contact</h3>
            <div class="info-item">
              <div class="label">Location</div>
              <div class="value">${this._escapeHtml(this.getFormattedLocation())}</div>
            </div>
            ${this.getCustomerPhone() ? `
            <div class="info-item">
              <div class="label">Phone</div>
              <div class="value">${this._escapeHtml(this.getFormattedPhone())}</div>
            </div>
            ` : ''}
            ${this.getCustomerEmail() ? `
            <div class="info-item">
              <div class="label">Email</div>
              <div class="value">${this._escapeHtml(this.getCustomerEmail() ?? '')}</div>
            </div>
            ` : ''}
          </div>
          <div>
            <h3>Farm Details</h3>
            <div class="info-item">
              <div class="label">Total Acres</div>
              <div class="value">${(this.customer().totalAcres || 0).toLocaleString()} acres</div>
            </div>
            ${(this.customer().binCapacity || 0) > 0 ? `
            <div class="info-item">
              <div class="label">Bin Capacity</div>
              <div class="value">${(this.customer().binCapacity || 0).toLocaleString()} bushels</div>
            </div>
            ` : ''}
            <div class="info-item">
              <div class="label">eSign Status</div>
              <div class="value">${this.customer().eSignEnabled ? 'Enrolled' : 'Not Enrolled'}</div>
            </div>
            ${this.customer().guild ? `
            <div class="info-item">
              <div class="label">Guild</div>
              <div class="value">${this._escapeHtml(this.customer().guild ?? '')}</div>
            </div>
            ` : ''}
          </div>
        </div>

        <h2>Contract Summary</h2>
        <div class="summary-grid">
          <div class="summary-box">
            <div class="summary-value">${this.totalContracted.toLocaleString()}</div>
            <div class="summary-label">Total Contracted Bushels</div>
          </div>
          <div class="summary-box">
            <div class="summary-value">${this.bushelsAvailable.toLocaleString()}</div>
            <div class="summary-label">Available Bushels</div>
          </div>
        </div>

        <h2>Active Contracts</h2>
        <div class="section">
          ${activeContracts.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>Contract #</th>
                <th>Crop</th>
                <th class="text-right">Quantity</th>
                <th class="text-right">Price</th>
                <th>Delivery Period</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${activeContracts.map(contract => `
              <tr>
                <td>${this._escapeHtml(contract.contractNumber)}</td>
                <td>${this._escapeHtml(contract.commodityDescription || contract.commodityCode || '')}</td>
                <td class="text-right">${contract.quantity.toLocaleString()} bu</td>
                <td class="text-right">$${contract.price.toFixed(2)}</td>
                <td>${this._escapeHtml(this._formatDeliveryPeriod(contract.deliveryStart, contract.deliveryEnd))}</td>
                <td><span class="status">${this._escapeHtml(contract.status ?? '')}</span></td>
              </tr>
              `).join('')}
            </tbody>
          </table>
          ` : '<p>No active contracts</p>'}
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  }

  /** Formats delivery period for print display */
  private _formatDeliveryPeriod(start: Date, end: Date): string {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `${startMonth} - ${endMonth}`;
  }

  getContactAddress(): string {
    const c = this.customer();
    return [c.addressLine1, c.location, c.stateProvince].filter(v => !!v).join(', ');
  }

  getFormattedLocation(): string {
    const c = this.customer();
    if (!c.location && !c.stateProvince) {
      return '';
    }
    if (c.location && c.stateProvince) {
      return `${c.location}, ${c.stateProvince}`;
    }
    return c.location || c.stateProvince || '';
  }

  getCustomerPhone(): string {
    const c = this.customer();
    // Use primary phone, fallback to extended phone if primary is empty
    return c.phone || c.extendedPrimaryPhone || '';
  }

  getCustomerEmail(): string {
    const c = this.customer();
    // Use primary email, fallback to supplemental email if primary is empty
    return c.email || c.supplementalEmail || '';
  }

  getFormattedPhone(): string {
    const phone = this.getCustomerPhone();
    if (!phone) return '';
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    // Format as (XXX) XXX-XXXX
    if (cleaned.length === 10) {
      return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
    }
    // Return original if not 10 digits
    return phone;
  }
}
