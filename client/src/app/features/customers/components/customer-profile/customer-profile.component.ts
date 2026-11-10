import { Component, forwardRef, input, output, inject, effect, computed, ChangeDetectionStrategy, ViewChild, ElementRef, signal, HostListener, Injector, Signal, runInInjectionContext, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@core/services/theme.service';
import { EditCustomerDialogComponent } from '../edit-customer-dialog/edit-customer-dialog.component';
import { CustomerPrintReportComponent } from '../customer-print-report/customer-print-report.component';
import { AppStateService } from '@core/services/app-state.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, Ticket, PlantingIntention, PlantingIntentionDraft, PlantingIntentionEdit, StoredGrain, DpContract, Note, ContractPricingLine, DashboardPlantingEstimate, Commodity, SavedList } from '@models';
import { formatPhoneDisplay } from '@shared/utils/phone';
import { resolveCustomerAddress, formatAddressLine, googleMapsSearchUrl } from '@shared/utils/address';
import { buildProductionCoverage } from '@shared/utils/production-coverage';
import { SelectedProducerProduction } from '@core/context/selected-producer-production';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { CustomerTab } from '@core/modules/module-manifest';
import { ModuleRegistry } from '@core/modules/module-registry';
import { CustomerContributionComponent } from '@core/modules/customer-contribution.component';
import { CustomerSlotComponent } from '@core/modules/customer-slot.component';

/** One tab in the producer profile's tab strip, with its count badge. */
interface ProfileTab {
  id: string;
  label: string;
  shortLabel: string;
  /** The count beside the label, or null for none. */
  count: number | null;
  /** Position in the strip, lowest first. */
  order: number;
  /** The module tab this is. */
  contribution: CustomerTab;
}

@Component({
  selector: 'app-customer-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    CustomerContributionComponent,
    CustomerSlotComponent,
    EditCustomerDialogComponent,
    CustomerPrintReportComponent
  ],
  templateUrl: './customer-profile.component.html',
  // What it shows of the producer's production (planting intentions and the year being looked at, stored grain, DP
  // contracts) is SelectedProducerProduction for the tabs and panels rendered inside it.
  providers: [{ provide: SelectedProducerProduction, useExisting: forwardRef(() => CustomerProfileComponent) }],
})
export class CustomerProfileComponent implements SelectedProducerProduction {
  private readonly appState = inject(AppStateService);
  /** The saved lists failed to load, so an empty Add to List menu does not mean none match. */
  readonly savedListsLoadFailed = this.appState.savedListsLoadFailed;

  public customer = input.required<Customer>();
  public allCustomers = input<Customer[]>([]);

  public selectedTradeUnits = input<string[]>([]);
  /** The page's trade-unit save for this producer is still running; the edit dialog keeps Save off meanwhile. */
  public isSavingTradeUnits = input(false);
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

  public isLoadingPlanting = input(false);
  public isLoadingStoredGrain = input(false);
  public isLoadingDpContracts = input(false);

  /** The producer's contracts for the Edit Producer dialog, which offers their commodities. */
  public allCustomerContracts = input<Contract[]>([]);

  public onAddPlanting = output<PlantingIntentionDraft>();
  public onEditPlanting = output<PlantingIntentionEdit>();
  public onDeletePlanting = output<number>();
  /** True when the contracts table wants the page at full width (columns expanded on the
   *  contracts tab) so the host page can drop the Notes sidebar below the profile. */
  public onContractsWideChange = output<boolean>();
  /** The user's own saved lists (enriched) the current producer can be quick-added to. Saved lists
   *  are originator-owned, so every list is offered regardless of the trade-unit selection. */
  public savedListsForCustomer = input<SavedList[]>([]);
  /** Team lists (all lists tied to the TU, any creator) for the Add-to-List Team tab. */
  public teamListsForCustomer = input<SavedList[]>([]);
  /** True when the user may add producers to teammates' lists: gates the Add-to-List "Team Lists" tab. */
  public canEditTeamLists = input(false);
  /** Save staged saved-list membership changes for the current producer; the host persists them. */
  public onSaveSavedListMembership = output<{ listId: number; add: boolean }[]>();
  public onSaveCustomer = output<{ customerId: number; acres: number; commodities: string[]; primaryContact: string; primaryPhone: string; contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[]; binSites: { siteKey: string; name: string; latitude?: number; longitude?: number; capacity?: number }[]; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean; grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number; bushelsSold?: number; targetBushels?: number; lastBid?: number; grade?: string }[] }>();
  public linkedCustomers = input<Customer[]>([]);
  public onSelectLinkedCustomer = output<number>();
  public openTab = input<string | null>(null);
  public openPlantingYear = input<number | null>(null);

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

  // Local state - signals
  activeTab = signal('contracts');
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

  /** All lists the menu can stage changes against — own, plus team lists when allowed. Used when seeding the
   *  staged map and computing the save diff so toggles persist across tab switches. */
  private allAddToLists(): SavedList[] {
    return this.canEditTeamLists()
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
  private readonly registry = inject(ModuleRegistry);
  private readonly context = inject(SelectedCustomerContext);
  private readonly injector = inject(Injector);

  constructor() {
    effect(() => {
      // A tab that needs the page's full width (the contracts table with its extra columns open) says so through the
      // context, and clears it when it closes; the page drops its sidebar meanwhile.
      this.onContractsWideChange.emit(this.context.wideContent());
    });

    effect(() => {
      // When arriving from Insights with a specific contract, switch to contracts tab
      // (contracts-table handles scrolling to the specific row)
      const openContractId = this.context.link().contractId;
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

  /** Planting intentions scoped to the years the profile shows, so the table and the Growth
   *  Opportunity picker agree on which seasons exist. */
  readonly visiblePlantingIntentions = computed(() => {
    const years = new Set(this.availablePlantingYears);
    if (years.size === 0) return this.plantingIntentions();
    return this.plantingIntentions().filter(pi => years.has(pi.plantingYear));
  });

  /** Each module tab's count, created once, in the profile's injection context. */
  private readonly tabBadges = new Map<CustomerTab, Signal<number | null>>();

  private badgeOf(tab: CustomerTab): Signal<number | null> | null {
    if (!tab.badge) return null;
    let badge = this.tabBadges.get(tab);
    if (!badge) {
      badge = untracked(() => runInInjectionContext(this.injector, tab.badge!));
      this.tabBadges.set(tab, badge);
    }
    return badge;
  }

  /** The tab strip: the modules' tabs the user may see for this customer, in order. */
  readonly tabs = computed<ProfileTab[]>(() => this.registry.customerTabs()
    .filter(tab => this.context.appliesTo(tab))
    .map(tab => ({ id: tab.id, label: tab.label, shortLabel: tab.shortLabel, count: this.badgeOf(tab)?.() ?? null, order: tab.order, contribution: tab })));

  /** The tab shown: the one picked, or the first when the picked one isn't in the strip (its module's tab isn't
   *  shown to this user or for this customer). */
  readonly shownTab = computed(() => {
    const tabs = this.tabs();
    const picked = this.activeTab();
    return tabs.some(tab => tab.id === picked) ? picked : (tabs[0]?.id ?? null);
  });

  /** The tab being shown, or null when the strip is empty. */
  readonly shownContribution = computed(() => this.tabs().find(tab => tab.id === this.shownTab())?.contribution ?? null);

  openEditDialog(): void {
    this.showEditDialog.set(true);
  }

  closeEditDialog(): void {
    this.showEditDialog.set(false);
  }

  handleSaveCustomer(data: { customerId: number; acres: number; commodities: string[]; primaryContact: string; primaryPhone: string; contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[]; binSites: { siteKey: string; name: string; latitude?: number; longitude?: number; capacity?: number }[]; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; tradeUnitCodes: string[]; reconcileTradeUnits: boolean; grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number; bushelsSold?: number; targetBushels?: number; lastBid?: number; grade?: string }[] }): void {
    this.usageTracking.trackProducerDetailsEdit(data.customerId.toString());
    this.onSaveCustomer.emit(data);
    this.closeEditDialog();
  }

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  getTabClass(tabId: string): string {
    const isActive = this.shownTab() === tabId;
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

  // ── SelectedProducerProduction ───────────────────────────────────────────────

  /** Commodity codes the producer deals in: their tickets' and those on their profile. */
  readonly commodityCodes = computed(() => {
    const ticketCommodities = [...new Set(this.tickets().map(t => t.productCode || '').filter(Boolean))];
    const userCommodities = this.customer()?.commodities || [];
    return [...new Set([...ticketCommodities, ...userCommodities])].sort();
  });

  /** The crop years offered, as the year picker shows them. */
  readonly plantingYears = computed(() => this.availablePlantingYears);

  /** The trade units the user is working in. */
  readonly tradeUnits = this.selectedTradeUnits;

  addPlantingIntention(intention: PlantingIntentionDraft): void {
    this.onAddPlanting.emit(intention);
  }

  editPlantingIntention(edit: PlantingIntentionEdit): void {
    this.onEditPlanting.emit(edit);
  }

  deletePlantingIntention(intentionId: number): void {
    this.onDeletePlanting.emit(intentionId);
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
