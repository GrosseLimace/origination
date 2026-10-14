import { Component, input, output, inject, effect, computed, linkedSignal, ChangeDetectionStrategy, ViewChild, ElementRef, signal, DestroyRef, HostListener } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ApiService } from '@core/services/api.service';
import { ThemeService } from '@core/services/theme.service';
import { ContractsTableComponent } from '../contracts-table/contracts-table.component';
import { TicketsTableComponent } from '../tickets-table/tickets-table.component';
import { PlantingIntentionsTableComponent } from '../planting-intentions-table/planting-intentions-table.component';
import { StoredGrainTableComponent } from '../stored-grain-table/stored-grain-table.component';
import { DpContractsTableComponent } from '../dp-contracts-table/dp-contracts-table.component';
import { ProducerInsightsComponent } from '../producer-insights/producer-insights.component';
import { ContractPacingCardComponent } from '../contract-pacing-card/contract-pacing-card.component';
import { GrowthOpportunityComponent } from '../growth-opportunity/growth-opportunity.component';
import { ActivitySummaryComponent } from '../activity-summary/activity-summary.component';
import { EditCustomerDialogComponent } from '../edit-customer-dialog/edit-customer-dialog.component';
import { CustomerPrintReportComponent } from '../customer-print-report/customer-print-report.component';
import { AppStateService } from '@core/services/app-state.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, Ticket, PlantingIntention, StoredGrain, DpContract, Note, ContractPricingLine, DashboardPlantingEstimate, Commodity, HarvestWindow, SavedList, ProducerContactItem, GrainOnFarmItem } from '@models';
import { buildCropGroupLookup } from '@shared/utils/crop-group-match';
import { formatLastBid, grainOnFarmTitle, indexCommoditiesByCode } from '@shared/utils/grain-on-farm';
import { dpContractCount } from '@shared/utils/dp-aggregate';
import { isOrganicSectionVisible } from '@shared/utils/organic-visibility';
import { formatPhoneDisplay } from '@shared/utils/phone';
import { resolveCustomerAddress, formatAddressLine, googleMapsSearchUrl, googleMapsCoordinatesUrl } from '@shared/utils/address';
import { binSiteHasCoordinates } from '@shared/utils/coordinates';
import { buildProductionCoverage } from '@shared/utils/production-coverage';

/** One tab in the producer profile's tab strip, with its count badge. */
interface ProfileTab {
  id: string;
  label: string;
  shortLabel: string;
  count: number;
}

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
    DpContractsTableComponent,
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

  // ── Grain on Farm (per-commodity total + sold + target) ──────────────────────
  /** Grain-on-farm rows with a positive total or sold, a target or last bid, or a grade entered —
   *  grouped by bin site in the sites' order (rows not tied to a site last), total desc within a site. */
  readonly grainOnFarmRows = computed(() => {
    const siteOrder = new Map((this.customer().binSites ?? []).map((b, i) => [b.siteKey, i]));
    const orderOf = (key: string | null | undefined) => (key ? siteOrder.get(key) : undefined) ?? Number.MAX_SAFE_INTEGER;
    return (this.customer().grainOnFarm ?? [])
      .filter(g => (g.bushelsOnHand ?? 0) > 0 || (g.bushelsSold ?? 0) > 0 || g.targetBushels != null || g.lastBid != null || !!(g.grade ?? '').trim())
      .sort((a, b) => orderOf(a.binSiteKey) - orderOf(b.binSiteKey) || (b.bushelsOnHand ?? 0) - (a.bushelsOnHand ?? 0));
  });
  /** The rows grouped by bin site for the table: one group per site in site order, then the rows not
   *  tied to a site. The label is the site name; the unlinked group is labelled only when sites are
   *  present too, so a producer with no linked grain shows a plain table as before. */
  readonly grainOnFarmGroups = computed(() => {
    const groups: { key: string | null; label: string; rows: GrainOnFarmItem[] }[] = [];
    for (const g of this.grainOnFarmRows()) {
      const key = g.binSiteKey ?? null;
      let group = groups.find(x => x.key === key);
      if (!group) {
        group = { key, label: key ? (g.binSiteName?.trim() || 'Bin site') : '', rows: [] };
        groups.push(group);
      }
      group.rows.push(g);
    }
    const unlinked = groups.find(x => x.key === null);
    if (unlinked && groups.length > 1) unlinked.label = 'Not tied to a bin site';
    return groups;
  });
  /** With grain at more than one bin site, each site is a closed line ("North Bins · 2 crops · 35,000 bu")
   *  until the user opens it (user 2026-10-12: a producer with many bins showed too much at once). With one
   *  site — or no sites — the table shows open, as before. */
  readonly grainGroupsCollapsible = computed(() => this.grainOnFarmGroups().length > 1);
  /** Open site groups, by index into grainOnFarmGroups (site order). All closed again when the producer changes. */
  readonly openGrainGroups = linkedSignal<number, ReadonlySet<number>>({ source: () => this.customer().id, computation: () => new Set() });
  isGrainGroupOpen(index: number): boolean {
    return !this.grainGroupsCollapsible() || this.openGrainGroups().has(index);
  }
  toggleGrainGroup(index: number): void {
    this.openGrainGroups.update(open => {
      const next = new Set(open);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }
  /** The crop column headings show once there is a row to label. */
  readonly anyGrainGroupOpen = computed(() => !this.grainGroupsCollapsible() || this.openGrainGroups().size > 0);
  /** A closed site's line: "2 crops · 35,000 bu". */
  grainGroupSummary(rows: readonly GrainOnFarmItem[]): string {
    const bushels = rows.reduce((sum, g) => sum + (g.bushelsOnHand ?? 0), 0);
    return `${rows.length} crop${rows.length === 1 ? '' : 's'} · ${bushels.toLocaleString('en-US')} bu`;
  }
  /** Total bushels currently on the farm (sum of per-commodity on-hand). */
  readonly grainOnFarmTotal = computed(() =>
    (this.customer().grainOnFarm ?? []).reduce((sum, g) => sum + (g.bushelsOnHand ?? 0), 0));
  // The two dropdowns remember an explicit close in localStorage (same pattern and reasons as
  // ActivitySummaryComponent: the profile is torn down between producers, and someone who closed a
  // section expects it to stay closed after a reload). Open by default.
  private static readonly GRAIN_COLLAPSED_KEY = 'origination.profile.grainOnFarm.collapsed';
  private static readonly BIN_SITES_COLLAPSED_KEY = 'origination.profile.binSites.collapsed';

  private static readCollapsed(key: string): boolean {
    try {
      return localStorage.getItem(key) === 'true';
    } catch {
      return false;
    }
  }

  private static writeCollapsed(key: string, collapsed: boolean): void {
    try {
      localStorage.setItem(key, collapsed ? 'true' : 'false');
    } catch {
      // Private browsing / storage disabled — the toggle still works for this session.
    }
  }

  /** Whether the grain-on-farm breakdown is expanded in the profile header. Open by default and left however
   *  the user set it — across producers and reloads, like the Activity Summary (user 2026-10-12); only an
   *  explicit close is remembered. */
  showGrainOnFarm = signal(!CustomerProfileComponent.readCollapsed(CustomerProfileComponent.GRAIN_COLLAPSED_KEY));
  /** The breakdown is on screen: expanded and something to show. The template also widens the grid
   *  for it (Contact spans both rows while the table spans Farm Details + Harvest Contract Pace). */
  readonly grainOnFarmOpen = computed(() => this.showGrainOnFarm() && this.grainOnFarmRows().length > 0);
  /** Expand/collapse the breakdown — only when there's something to show. (Editing the values
   *  lives in the Edit Producer dialog; this is a read-only summary.) */
  toggleGrainOnFarm(): void {
    if (this.grainOnFarmRows().length === 0) return;
    this.showGrainOnFarm.update(v => !v);
    CustomerProfileComponent.writeCollapsed(CustomerProfileComponent.GRAIN_COLLAPSED_KEY, !this.showGrainOnFarm());
  }

  // Rows hold a commodity code (or a legacy crop-group name); hover on the Crop cell shows the
  // commodity name. Lazy computeds, so reading the `commodities` input declared further down is safe.
  private readonly _grainLookup = computed(() => buildCropGroupLookup(this.commodities()));
  private readonly _grainByCode = computed(() => indexCommoditiesByCode(this.commodities()));
  /** Hover text for a grain-on-farm crop: the commodity name, or the legacy-row note. */
  grainChipTitle(value: string): string {
    return grainOnFarmTitle(value, this._grainByCode(), this._grainLookup());
  }
  /** Last Bid as typed: no "$", no padded decimals. */
  readonly formatLastBid = formatLastBid;
  public selectedTradeUnits = input<string[]>([]);
  public contracts = input<Contract[]>([]);
  public tickets = input<Ticket[]>([]);
  public pricingLines = input<ContractPricingLine[]>([]);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public storedGrain = input<StoredGrain[]>([]);
  public dpContracts = input<DpContract[]>([]);
  public notes = input<Note[]>([]);
  public yieldEstimates = input<DashboardPlantingEstimate[]>([]);
  public commodities = input<Commodity[]>([]);
  public isLoadingEstimates = input(false);
  public isLoadingContracts = input(false);
  public isLoadingUnappliedTickets = input(false);

  /** Non-null when the read FAILED rather than returning nothing - forwarded to the tables so they can
   *  say so instead of showing their empty state. */
  /** True when this producer's prior-year pacing history could not be read. Forwarded to the pacing
   *  card so it can say the comparison is incomplete instead of showing it as flat. */
  readonly historicalContractsFailed = signal(false);

  public contractsLoadError = input<string | null>(null);
  public ticketsLoadError = input<string | null>(null);
  public pricingLinesLoadError = input<string | null>(null);

  /** Bubbled up from the tables' Retry buttons. */
  public retryContracts = output<void>();
  public retryTickets = output<void>();
  public isLoadingPricingLines = input(false);
  public isLoadingPlanting = input(false);
  public isLoadingStoredGrain = input(false);
  public isLoadingDpContracts = input(false);

  // Unfiltered data for Activity Summary
  public allCustomerContracts = input<Contract[]>([]);
  public allCustomerTickets = input<Ticket[]>([]);
  public allCustomerPlantingIntentions = input<PlantingIntention[]>([]);
  public allCustomerStoredGrain = input<StoredGrain[]>([]);
  public allCustomerDpContracts = input<DpContract[]>([]);

  public onAddPlanting = output<{crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}>();
  public onEditPlanting = output<{intentionId: number, crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit?: string}>();
  public onDeletePlanting = output<number>();
  /** True when the contracts table wants the page at full width (columns expanded on the
   *  contracts tab) so the host page can drop the Notes sidebar below the profile. */
  public onContractsWideChange = output<boolean>();
  /** The user's own saved lists (enriched) the current producer can be quick-added to. Saved lists
   *  are originator-owned, so every list is offered regardless of the trade-unit selection. */
  public savedListsForCustomer = input<SavedList[]>([]);
  /** Manager-only: team lists (all lists tied to the TU, any creator) for the Add-to-List Team tab. */
  public teamListsForCustomer = input<SavedList[]>([]);
  /** True when the current user is a manager — gates the Add-to-List "Team Lists" tab. */
  public isManager = input(false);
  /** Save staged saved-list membership changes for the current producer; the host persists them. */
  public onSaveSavedListMembership = output<{ listId: number; add: boolean }[]>();
  public onAddNote = output<string>();
  public onTogglePin = output<Note>();
  public onSaveCustomer = output<{ customerId: number; acres: number; commodities: string[]; primaryContact: string; primaryPhone: string; contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[]; binSites: { siteKey: string; name: string; latitude?: number; longitude?: number; capacity?: number }[]; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean; grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number; bushelsSold?: number; targetBushels?: number; lastBid?: number; grade?: string }[] }>();
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

  trackMapClick(): void {
    this.usageTracking.trackMapClick(this.customer().id.toString());
  }

  trackBinSiteMapClick(): void {
    this.usageTracking.trackBinSiteMapClick(this.customer().id.toString());
  }

  /** Bin sites as rows of the compact table under the "Bin Sites (N)" toggle in Contact, in saved order, every
   *  cell already formatted ("50,000", or "—" when empty). The coordinates aren't a column: the pin
   *  opens them in Google Maps at full precision — or there's no pin when the site has none. */
  readonly binSiteRows = computed(() => {
    const bushels = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US'));
    return (this.customer().binSites ?? []).map(site => ({
      name: site.name?.trim() || 'Bin site',
      capacity: bushels(site.capacity),
      url: binSiteHasCoordinates(site) ? googleMapsCoordinatesUrl(site.latitude, site.longitude) : null,
    }));
  });

  /** A producer with exactly one bin site: that site, shown on its own line in Contact (name · capacity ·
   *  map pin) instead of a "Bin Sites (1)" toggle (user 2026-10-12). Null with none or several. */
  readonly singleBinSite = computed(() => {
    const rows = this.binSiteRows();
    return rows.length === 1 ? rows[0] : null;
  });

  /** With two or more bin sites, the "▸ Bin Sites (N)" table — open by default and left however the user
   *  set it, across producers and reloads (user 2026-10-12); only an explicit close is remembered. */
  readonly binSitesExpanded = signal(!CustomerProfileComponent.readCollapsed(CustomerProfileComponent.BIN_SITES_COLLAPSED_KEY));

  toggleBinSites(): void {
    this.binSitesExpanded.update(open => !open);
    CustomerProfileComponent.writeCollapsed(CustomerProfileComponent.BIN_SITES_COLLAPSED_KEY, !this.binSitesExpanded());
  }

  // Local state - signals
  activeTab = signal('contracts');
  showProducerInsights = signal(false);
  showESignRecipients = signal(false);
  showOrganicDetail = signal(false);
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
      this.showOrganicDetail.set(false);
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

      // Cleared as the fetch is kicked, so a previous producer's failure never shows against this one.
      this.historicalContractsFailed.set(false);

      if (id == null) { this.historicalContracts.set([]); return; }
      this.apiService.getHistoricalContractsForPacing(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: contracts => { this.historicalContracts.set(contracts); this.historicalContractsFailed.set(false); },
          error: () => {
            // Producer-scoped, so it stays local: the trade-unit-wide flag drives Build-a-List's banner
            // and this read says nothing about that list. Cleared to [] rather than left stale so the
            // pacing card cannot present another producer's history as this one's.
            this.historicalContracts.set([]);
            this.historicalContractsFailed.set(true);
          }
        });
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
        { id: 'storage', label: 'Storage', shortLabel: 'Stor', count: new Set(this.storedGrain().map(g => g.crop || 'Unknown')).size },
        // Badge is distinct CONTRACTS, not commodities (which Storage uses) and not charge rows.
        // A producer with 8 contracts across 2 commodities reads as 8.
        { id: 'dpContracts', label: 'DP Contracts', shortLabel: 'DP', count: dpContractCount(this.dpContracts()) }
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
    if (tabId === 'dpContracts') this.usageTracking.trackDpContractsDropdownOpen(this.customer().id.toString());
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

  private _tabs: ProfileTab[] = [];
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

  handleSaveCustomer(data: { customerId: number; acres: number; commodities: string[]; primaryContact: string; primaryPhone: string; contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[]; binSites: { siteKey: string; name: string; latitude?: number; longitude?: number; capacity?: number }[]; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean; grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number; bushelsSold?: number; targetBushels?: number; lastBid?: number; grade?: string }[] }): void {
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

  /** Whether the organic badge shows for this producer. Two producer-level conditions OR'd —
   *  the CTRM organic industry code, or a real NOP id on file. See @shared/utils/organic-visibility
   *  for why both are needed when they overlap almost completely. */
  readonly showOrganicBadge = computed(() => isOrganicSectionVisible({
    industryCode2: this.customer()?.industryCode2,
    nopId: this.customer()?.nopId,
  }));

  /** True while either expandable header panel is open. Drives the spacing on the farm line below
   *  them — before the organic panel existed that binding keyed on eSign alone, which would have
   *  left the farm name jammed against an open organic panel. */
  readonly anyHeaderPanelOpen = computed(() =>
    (this.customer()?.eSignEnabled === true && this.showESignRecipients()) || this.showOrganicDetail()
  );

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

  /** The current customer's ScoularView recipients, parsed once per customer for the eSign panel. */
  readonly scoularViewRecipientList = computed(() => {
    const raw = this.customer().scoularViewRecipients;
    return raw ? this.parseRecipients(raw) : [];
  });

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

  /** Displayed producer address. Extended fields win over Merchandising and the ZIP is included,
   *  so the text matches the address the producer map actually pins. */
  getContactAddress(): string {
    return formatAddressLine(resolveCustomerAddress(this.customer()));
  }

  /** Google Maps deep link for the displayed address, or null when there is too little to search on. */
  getMapsUrl(): string | null {
    return googleMapsSearchUrl(resolveCustomerAddress(this.customer()));
  }

  /** User-entered contacts, primary first then saved order. Older cached customers without a
   *  contacts array fall back to a synthesized row from the legacy primary fields. A computed, so the
   *  copy-and-sort runs once per customer rather than on every change-detection pass of the template. */
  readonly sortedContacts = computed<ProducerContactItem[]>(() => {
    const c = this.customer();
    if (c.contacts && c.contacts.length > 0) {
      return [...c.contacts].sort((a, b) =>
        (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    if (c.primaryContact || c.primaryPhone) {
      return [{ name: c.primaryContact || 'Primary Contact', phone: c.primaryPhone, isPrimary: true }];
    }
    return [];
  });

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
    return formatPhoneDisplay(this.getCustomerPhone());
  }
}
