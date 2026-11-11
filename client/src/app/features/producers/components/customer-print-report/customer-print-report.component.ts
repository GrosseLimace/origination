import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MsalService } from '@azure/msal-angular';
import { ToastService } from '@core/services/toast.service';
import { AppStateService } from '@core/services/app-state.service';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '@shared/components/dialog/dialog.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { Customer, Contract, ContractPricingLine, PlantingIntention, Ticket } from '@models';
import { getContractDeliveryStats } from '@shared/utils/contract-delivery';
import { contractPricingInfo, ContractPricingInfo } from '@shared/utils/contract-pricing-status';
import { buildLbsPerBushelMap, sumInBushels } from '@shared/utils/production-coverage';
import { plantingCategory } from '@shared/utils/planting-category';
import { binSiteGrainBreakdown, formatLastBid, grainOnFarmColorKey, indexCommoditiesByCode } from '@shared/utils/grain-on-farm';
import { buildCropGroupLookup } from '@shared/utils/crop-group-match';
import { PermissionService } from '@core/access/permission.service';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { SelectedProducerProduction } from '@core/context/selected-producer-production';
import { ProducerProfiles } from '@core/context/producer-profiles';


/** The report's include toggles whose default depends on the data. */
type SectionKey = 'totalAcres' | 'totalContracted' | 'contracts' | 'tickets' | 'planting' | 'storage' | 'binSites' | 'pricingLines';

interface TicketCommoditySummary {
  productCode: string;
  ticketCount: number;
  totalNetWeight: number;
  totalBushels: number | null;
  avgDate: Date | null;
  avgMoisture: number | null;
  avgTestWeight: number | null;
  avgProtein: number | null;
  isWheat: boolean;
}

/**
 * The Producer Summary Report: a preview with the sections to include beside it, and Print, which writes the same
 * report to a print window. Opened by Producers' Print button in the profile header, for the producer on screen. It
 * reads their contracts, tickets and pricing lines from SelectedProducerActivity, and their planting intentions and
 * stored grain from the profile's SelectedProducerProduction.
 */
@Component({
  selector: 'app-customer-print-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogContentComponent,
    DialogFooterComponent,
    ButtonComponent
  ],
  // The printed HTML formats pricing lines with the same pipes the preview template uses.
  providers: [CurrencyPipe, DatePipe],
  // The dialog is a fixed overlay, so its element takes no space in the header's button row while it's closed.
  host: { class: 'contents' },
  templateUrl: './customer-print-report.component.html'
})
export class CustomerPrintReportComponent {
  private readonly msalService = inject(MsalService);
  private readonly toastService = inject(ToastService);
  private readonly appState = inject(AppStateService);
  private readonly permissions = inject(PermissionService);
  private readonly currencyPipe = inject(CurrencyPipe);
  private readonly datePipe = inject(DatePipe);
  private readonly activity = inject(SelectedProducerActivity);
  private readonly production = inject(SelectedProducerProduction);
  private readonly profiles = inject(ProducerProfiles);

  /** Opened by the Print button, for the customer on screen. */
  public isOpen = input(false);
  public customer = input.required<Customer>();
  /** The customer's saved producer details: their acres, bin sites and grain on farm. */
  readonly profile = computed(() => this.profiles.profileOf(this.customer().id));
  public close = output<void>();

  // The producer's data, as the rest of the customer screen reads it.
  readonly contracts = this.activity.contracts;
  readonly tickets = this.activity.tickets;
  readonly pricingLines = this.activity.pricingLines;
  /** Every crop year's intentions; the sidebar picks the years the report includes. */
  readonly plantingIntentions = this.production.plantingIntentions;
  readonly storedGrain = this.production.storedGrain;
  readonly commodities = this.appState.commodities;

  /**
   * The sections and summary figures the user may read. One they can't is left out: no checkbox, nothing in the
   * preview or on the printed page. The header and footer need only the customer.
   */
  readonly readable = computed<Record<SectionKey, boolean>>(() => {
    const contracts = this.permissions.has('contracts:read');
    const producerDetails = this.permissions.has('producer-details:read');
    return {
      totalAcres: producerDetails,
      totalContracted: contracts,
      contracts,
      pricingLines: contracts,
      tickets: this.permissions.has('tickets:read'),
      planting: this.permissions.has('planting-intentions:read'),
      storage: this.permissions.has('stored-grain:read'),
      binSites: producerDetails,
    };
  });

  // Section toggles — initialized in the effect when dialog opens
  showTotalAcres = signal(true);
  showTotalContracted = signal(true);
  showContracts = signal(true);
  showPricingLines = signal(true);
  showTickets = signal(true);
  showPlanting = signal(true);
  showStorage = signal(true);
  /** Bin Sites & Grain on Farm section (user 2026-10-12). */
  showBinSites = signal(true);

  // Originator info
  originatorName = signal('');
  originatorTitle = signal('');
  originatorPhone = signal('');
  originatorEmail = signal('');

  // Accent color
  readonly accentColor = signal('#00875F');
  readonly accentLight = computed(() => this.accentColor() + '18');
  private _defaultsApplied = false;

  /** The toggles whose default depends on the data, by the key the sidebar reports a hand edit under. */
  private readonly _sections: Record<SectionKey, WritableSignal<boolean>> = {
    totalAcres: this.showTotalAcres,
    totalContracted: this.showTotalContracted,
    contracts: this.showContracts,
    tickets: this.showTickets,
    planting: this.showPlanting,
    storage: this.showStorage,
    binSites: this.showBinSites,
    pricingLines: this.showPricingLines,
  };
  /** Toggles (and the crop-year picker) the user has set by hand since the dialog opened. Defaults
   *  keep following the data until then, so a section whose data lands after the dialog opens (the
   *  profile loads each on its own request, and Print is clickable meanwhile) still defaults on —
   *  but a choice the user made is never overridden. Cleared on every open. */
  private readonly _touched = new Set<SectionKey | 'plantingYears'>();

  /** Each section's default: on when it has something to show and the user may read it. With no checkbox, a section
   *  the user may not read stays at this default, off. */
  private readonly _sectionDefaults = computed<Record<SectionKey, boolean>>(() => {
    const readable = this.readable();
    return {
      totalAcres: readable.totalAcres && (this.profile()?.totalAcres ?? 0) > 0,
      totalContracted: readable.totalContracted && this.totalContracted() > 0,
      contracts: readable.contracts && this.contracts().filter(c => !c.closedDate).length > 0,
      tickets: readable.tickets && this.tickets().filter(t => !t.isApplied).length > 0,
      planting: readable.planting && this.plantingIntentions().length > 0,
      storage: readable.storage && this.storedGrain().length > 0,
      binSites: readable.binSites && this.binSiteGroups().length > 0,
      pricingLines: readable.pricingLines && this.visiblePricingLines().length > 0,
    };
  });

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (!open) {
        this._defaultsApplied = false;
        return;
      }
      if (!this._defaultsApplied) {
        this._defaultsApplied = true;
        this._touched.clear();
        const account = this.msalService.instance.getActiveAccount()
          ?? this.msalService.instance.getAllAccounts()[0];
        if (account) {
          this.originatorName.set(account.name ?? '');
          const username = account.username ?? '';
          this.originatorEmail.set(
            username && !username.includes('@') ? `${username}@scoular.com` : username
          );
        }
        this.plantingYearsExpanded.set(false);
      }
      // Tracked: re-runs whenever the data behind a default changes while the dialog is open.
      const defaults = this._sectionDefaults();
      const years = this.plantingYears();
      // Default a toggle off when its section has nothing to show — unless the user set it by hand.
      untracked(() => {
        for (const key of Object.keys(this._sections) as SectionKey[]) {
          if (!this._touched.has(key)) this._sections[key].set(defaults[key]);
        }
        // Every year on by default, so opening the dialog reports what it always has, with the
        // picker collapsed until the user goes looking for it.
        if (!this._touched.has('plantingYears')) this.selectedPlantingYears.set(years);
      });
    });
  }

  /** A sidebar checkbox for a section: records the hand edit so late data won't undo it. */
  setSection(key: SectionKey, value: boolean): void {
    this._touched.add(key);
    this._sections[key].set(value);
  }

  // Pricing lines indexed by sourceContractId
  readonly pricingLinesMap = computed(() => {
    const map = new Map<string, ContractPricingLine[]>();
    for (const c of this.contracts()) {
      if (c.sourceContractId) map.set(c.sourceContractId, []);
    }
    for (const line of this.pricingLines()) {
      if (!line.contractId) continue;
      if (!map.has(line.contractId)) map.set(line.contractId, []);
      map.get(line.contractId)!.push(line);
    }
    return map;
  });

  // --- Pricing: the same rule the contracts table uses (shared util, not a copy) ---
  getPricingInfo(contract: Contract): ContractPricingInfo {
    const lines = contract.sourceContractId ? this.pricingLinesMap().get(contract.sourceContractId) : undefined;
    return contractPricingInfo(contract, lines, this.pricingLines() !== undefined);
  }

  getPricingLinesForContract(contract: Contract): ContractPricingLine[] {
    const key = contract.sourceContractId;
    // Sequence 0 is a placeholder/summary row (it carries the flat price used by getPricingInfo,
    // but shouldn't be listed as its own pricing line) — keep it in the map, hide it from display.
    return key ? (this.pricingLinesMap().get(key) ?? []).filter(l => l.priceSequence !== 0) : [];
  }

  /** Pricing lines that belong to the contracts shown in this report (openContracts).
   *  Used for the sidebar toggle count so it matches what actually prints. */
  readonly visiblePricingLines = computed(() =>
    this.openContracts().flatMap(ct => this.getPricingLinesForContract(ct))
  );

  getContractPrice(ct: Contract): string {
    const info = this.getPricingInfo(ct);
    if (info.status === 'FLAT' && info.cashPrice != null) return this.formatCurrency(info.cashPrice);
    if (info.status === 'PRICED') return 'Priced';
    if (info.status === 'PARTIAL') return 'Partial';
    if (info.status === 'DEFERRED') return 'Deferred';
    if (info.status === 'UNPRICED') return 'Unpriced';
    return '—';
  }

  // Computed data — open contracts (matches the Contracts tab's openContracts filter)
  readonly openContracts = computed(() =>
    this.contracts()
      .filter(c => !c.closedDate)
      // Mirror the on-page contracts table's default order: soonest delivery first.
      // Contracts with no delivery start sink to the bottom (Infinity) rather than
      // floating to the top. This order is preserved within each commodity group.
      .sort((a, b) => {
        const aTime = a.deliveryStart ? new Date(a.deliveryStart).getTime() : Infinity;
        const bTime = b.deliveryStart ? new Date(b.deliveryStart).getTime() : Infinity;
        return aTime - bTime;
      })
  );

  /** Contracts grouped by commodity for print display. Mirrors the contracts table:
   *  bucket by commodityCode so same-code variants stay together (fall back to
   *  description/group/'Other'), order the groups alphabetically by that key, and
   *  preserve the soonest-delivery-first order from openContracts() within each group.
   *  The header still shows the friendly description label. */
  readonly contractsByCommodity = computed(() => {
    const map = new Map<string, { label: string; contracts: Contract[] }>();
    for (const ct of this.openContracts()) {
      const key = (ct.commodityCode || ct.commodityDescription || ct.commodityGroup || 'Other').trim();
      const label = ct.commodityDescription || ct.commodityCode || ct.commodityGroup || 'Other';
      const bucket = map.get(key);
      if (bucket) bucket.contracts.push(ct);
      else map.set(key, { label, contracts: [ct] });
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, { label, contracts }]) => ({
        commodity: label,
        contracts,
        // Total contracted quantity for the commodity — shown on the group band header.
        totalQuantity: contracts.reduce((sum, c) => sum + (c.quantity ?? 0), 0),
        unit: contracts[0]?.unit || 'bu',
      }));
  });

  /** Crop years this producer has intentions for, newest first. */
  readonly plantingYears = computed(() =>
    [...new Set(this.plantingIntentions().map(pi => pi.plantingYear).filter(Boolean))]
      .sort((a, b) => b - a)
  );

  /** Years the printed report includes. Defaults to all of them when the dialog opens; unchecking a
   *  year drops it from the acres, the projection and the crop breakdown alike — otherwise a
   *  multi-season producer's totals silently blend seasons that aren't comparable. */
  readonly selectedPlantingYears = signal<number[]>([]);

  /** The year checkboxes are collapsed until asked for — most reports want every year, and an
   *  always-open list pushes the other detail sections out of view. */
  readonly plantingYearsExpanded = signal(false);

  isPlantingYearSelected(year: number): boolean {
    return this.selectedPlantingYears().includes(year);
  }

  togglePlantingYear(year: number, include: boolean): void {
    this._touched.add('plantingYears');
    this.selectedPlantingYears.update(years =>
      include ? [...new Set([...years, year])].sort((a, b) => b - a) : years.filter(y => y !== year));
  }

  /** Intentions limited to the chosen years — the single source every planting figure below reads. */
  readonly includedPlantingIntentions = computed(() => {
    const years = new Set(this.selectedPlantingYears());
    return this.plantingIntentions().filter(pi => years.has(pi.plantingYear));
  });

  /** Planting intentions grouped by crop then sorted by planting year desc */
  readonly plantingByCrop = computed(() => {
    const commodities = this.commodities();
    const map = new Map<string, { crop: string; intentions: PlantingIntention[] }>();
    const sorted = [...this.includedPlantingIntentions()].sort((a, b) => b.plantingYear - a.plantingYear);
    for (const pi of sorted) {
      const commodity = commodities.find(c => c.code === pi.crop);
      const category = plantingCategory(pi, commodity);
      if (!map.has(category)) map.set(category, { crop: category, intentions: [] });
      map.get(category)!.intentions.push(pi);
    }
    // Carry total acres per crop for the group band label.
    return Array.from(map.values()).map(g => ({
      ...g,
      totalAcres: g.intentions.reduce((sum, pi) => sum + (pi.acres ?? 0), 0),
    }));
  });

  /** Contracted volume in BUSHELS. Not a raw quantity sum — a producer's commodity groups carry
   *  processed products priced by weight (soybean meal in short tons, popcorn by the pound), and
   *  adding those in produced a "bushels" KPI that disagreed with the Growth Opportunity panel for
   *  the same producer. Same helper, same answer. */
  readonly totalContracted = computed(() =>
    sumInBushels(this.openContracts(), buildLbsPerBushelMap(this.appState.commodityConversions())).contracted
  );

  /** Open contracts left out of Total Contracted because the conversions failed to load — not
   *  because of their unit. Zero unless the load failed; with no conversions in hand, everything
   *  not already in bushels is left out. */
  readonly contractsMissingConversions = computed(() => {
    if (!this.appState.commodityConversionsLoadFailed() || this.appState.commodityConversions().length > 0) return 0;
    return sumInBushels(this.openContracts(), new Map()).excludedContracts;
  });

  readonly kpis = computed(() => {
    const items: { label: string; value: string; sub: string }[] = [];
    if (this.showTotalAcres()) {
      const acres = this.profile()?.totalAcres ?? 0;
      items.push({ label: 'Total Acres', value: acres > 0 ? acres.toLocaleString() : '0', sub: '' });
    }
    if (this.showTotalContracted()) {
      const contracted = this.totalContracted();
      // Rides in the tile's sub-line, so it reaches the preview and the printed page alike.
      const missing = this.contractsMissingConversions();
      const sub = missing > 0
        ? `${missing} contract${missing === 1 ? '' : 's'} left out — bushel conversions couldn't be loaded`
        : '';
      items.push({ label: 'Total Contracted', value: contracted > 0 ? this.formatBu(contracted) : '0 bu', sub });
    }
    return items;
  });

  readonly storageGroups = computed(() => {
    const groupMap = new Map<string, { crop: string; totalBushels: number; totalCost: number; earliestDate: Date; totalDays: number }>();
    for (const g of this.storedGrain()) {
      const key = g.crop || 'Unknown';
      if (!groupMap.has(key)) {
        groupMap.set(key, { crop: key, totalBushels: 0, totalCost: 0, earliestDate: new Date(g.storageStartDate), totalDays: 0 });
      }
      const group = groupMap.get(key)!;
      group.totalBushels += g.quantity ?? 0;
      group.totalCost += g.receivableAmount ?? 0;
      group.totalDays = Math.max(group.totalDays, g.storageDays ?? 0);
      const rowDate = new Date(g.storageStartDate);
      if (rowDate < group.earliestDate) group.earliestDate = rowDate;
    }
    return [...groupMap.values()].sort((a, b) => a.crop.localeCompare(b.crop));
  });

  /** The producer's bin sites in saved order (name and capacity — no coordinates on paper) with the grain
   *  stored there — the same grouping the producer page and Build a List use. */
  readonly binSiteGroups = computed(() => binSiteGrainBreakdown(this.profile()?.binSites, this.profile()?.grainOnFarm));
  readonly grainOnFarmTotal = computed(() =>
    (this.profile()?.grainOnFarm ?? []).reduce((sum, g) => sum + (g.bushelsOnHand ?? 0), 0));
  readonly formatLastBid = formatLastBid;
  private readonly _cropGroupLookup = computed(() => buildCropGroupLookup(this.commodities()));
  private readonly _commodityByCode = computed(() => indexCommoditiesByCode(this.commodities()));
  /** Band tint for a grain-on-farm row. The rows hold commodity CODES (YC, HRWW), which the keyword
   *  matcher in commodityBandColor cannot read, so resolve the code to its crop group first (YC → Corn →
   *  yellow), then fall back to the commodity name, then the code. The index is keyed by LOWER-cased code. */
  grainBandColor(code: string | null | undefined): string {
    const group = grainOnFarmColorKey(code, this._cropGroupLookup());
    const name = this._commodityByCode().get((code || '').trim().toLowerCase())?.name;
    return this.commodityBandColor(group !== (code || '').trim() ? group : (name || group));
  }

  readonly today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Helpers
  formatBu(val: number): string {
    if (val >= 1000) return `${(val / 1000).toFixed(0)}K bu`;
    return `${val.toLocaleString()} bu`;
  }

  formatCurrency(val: number): string {
    return '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatDate(d: string | Date | undefined | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** Light background tint for a commodity's band row in the Contracts table. The four primary
   *  crops use the colors originators expect (Wheat = red, Corn = yellow, Sorghum/Milo = orange,
   *  Soybeans = blue); other Scoular commodities get hand-picked light tints; anything unlisted
   *  gets a stable, distinct light tint (hashed off the name) so no band is ever left plain gray.
   *  Matched on keywords so code/description variants (e.g. "Grain Sorghum", "Soft White Wheat") hit. */
  commodityBandColor(commodity: string): string {
    const c = (commodity || '').toLowerCase();
    // Primary crops
    if (c.includes('wheat')) return '#f8d7da';                          // red
    if (c.includes('corn')) return '#fff3cd';                           // yellow
    if (c.includes('milo') || c.includes('sorghum')) return '#ffe5cc';  // orange
    if (c.includes('soybean') || c.includes('soy')) return '#d6e8f7';   // blue
    // Other commodities — distinct light tints (check soy above before the generic "bean")
    if (c.includes('barley')) return '#ece5d0';
    if (c.includes('oat')) return '#f2ead9';
    if (c.includes('canola')) return '#e2f0d3';
    if (c.includes('millet')) return '#f5edcf';
    if (c.includes('sunflower')) return '#f6e2c4';
    if (c.includes('rye')) return '#e9e0f2';
    if (c.includes('flax')) return '#dce8ef';
    if (c.includes('peanut')) return '#efe4d3';
    if (c.includes('pea')) return '#e0efd6';
    if (c.includes('lentil')) return '#efe1d2';
    if (c.includes('chickpea') || c.includes('garbanzo')) return '#efe8d0';
    if (c.includes('bean')) return '#dbe9f6';                           // edible/dry beans
    if (c.includes('cotton')) return '#f3f0e9';
    if (c.includes('rice')) return '#eef0e6';
    // Fallback: deterministic light tint keyed off the name so the same commodity is always
    // the same color and nothing shows up as plain gray.
    const palette = ['#e6eef7', '#e9f2e2', '#f7ece0', '#f0e7f5', '#fdf0d5', '#e2f0ee', '#f5e6ea', '#eae7d6'];
    let hash = 0;
    for (let i = 0; i < c.length; i++) hash = (hash + c.charCodeAt(i)) % palette.length;
    return palette[hash];
  }

  // --- Delivery / status / conversion logic mirrors contracts-table.component.ts ---

  /** Commodity code → lbs per bushel. Derived from the signal, so any replacement of the conversion
   *  list rebuilds it (it used to be cached until the list's length changed). */
  private readonly _conversionMap = computed(() =>
    new Map(this.appState.commodityConversions().map(c => [c.commodityCode.trim().toUpperCase(), c.lbsPerUnit])));

  private _lookupLbsPerBushel(productCode: string | undefined | null): number | null {
    const code = (productCode || '').trim().toUpperCase();
    if (!code) return null;
    const lbs = this._conversionMap().get(code);
    return lbs && lbs > 0 ? lbs : null;
  }

  getDeliveryStats(contract: Contract): { delivered: number; remaining: number; progressPercent: number } {
    // Delegates to the shared util — same numbers contracts-table / activity-summary /
    // insights show. Driven off CTRM's openBalanceQuantity (no ticket sum, no
    // lbs↔bushel conversion). Tonnage / cwt / pound contracts work natively because
    // openBalanceQuantity is already in the contract's unit.
    const s = getContractDeliveryStats(contract);
    return { delivered: s.delivered, remaining: s.remaining, progressPercent: s.progressPercent };
  }

  getCalculatedStatus(contract: Contract): string {
    const stats = this.getDeliveryStats(contract);
    const now = new Date();
    const startDate = new Date(contract.deliveryStart);
    const endDate = new Date(contract.deliveryEnd);
    if (stats.progressPercent >= 100 || stats.remaining <= 0) return 'Filled';
    if (contract.status === 'Cancelled') return 'Cancelled';
    if (now > endDate) return 'Past Due';
    if (now >= startDate) return 'Active';
    return 'To Arrive';
  }

  /** Returns {bg, color} inline-style values for the status badge — matches the tab's colors. */
  getStatusStyles(status: string): { bg: string; color: string } {
    switch (status) {
      case 'Active':    return { bg: '#00875F', color: '#ffffff' };
      case 'Filled':    return { bg: '#1E40AF', color: '#ffffff' };
      case 'To Arrive': return { bg: '#eab308', color: '#ffffff' };
      case 'Past Due':  return { bg: '#DF3410', color: '#ffffff' };
      case 'Cancelled': return { bg: '#6b7280', color: '#ffffff' };
      default:          return { bg: '#6b7280', color: '#ffffff' };
    }
  }

  // --- Unapplied tickets (mirrors tickets-table.component.ts) ---

  readonly unappliedTickets = computed(() =>
    this.tickets()
      .filter(t => !t.isApplied)
      .sort((a, b) => {
        const da = a.date ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date + 'T12:00:00' : a.date).getTime() : 0;
        const db = b.date ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date + 'T12:00:00' : b.date).getTime() : 0;
        return da - db;
      })
  );

  private _isWheatProductCode(productCode?: string | null): boolean {
    if (!productCode) return false;
    const u = productCode.toUpperCase().trim();
    return u.includes('WHEAT') || u.includes('WW') ||
      u.startsWith('HRW') || u.startsWith('HRS') || u.startsWith('SRW') ||
      u.startsWith('DUR') || u === 'HW';
  }

  readonly ticketsByCommodity = computed<TicketCommoditySummary[]>(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of this.unappliedTickets()) {
      const key = t.productCode || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    const groups: TicketCommoditySummary[] = [];
    for (const [productCode, list] of map) {
      const totalNetWeight = list.reduce((s, t) => s + (t.appliedDockQuantity || 0), 0);
      const lbsPerBushel = this._lookupLbsPerBushel(productCode);
      const totalBushels = lbsPerBushel ? totalNetWeight / lbsPerBushel : null;
      const validMoisture = list.filter(t => typeof t.moisture === 'number' && t.moisture! > 0);
      const validTW = list.filter(t => typeof t.testWeight === 'number' && t.testWeight! > 0);
      const validProt = list.filter(t => typeof t.proteinPercent === 'number' && t.proteinPercent! > 0);
      const validDates = list
        .map(t => t.date ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date + 'T12:00:00' : t.date).getTime() : NaN)
        .filter(n => !isNaN(n));
      groups.push({
        productCode,
        ticketCount: list.length,
        totalNetWeight,
        totalBushels,
        avgDate: validDates.length ? new Date(validDates.reduce((s, d) => s + d, 0) / validDates.length) : null,
        avgMoisture: validMoisture.length ? validMoisture.reduce((s, t) => s + (t.moisture || 0), 0) / validMoisture.length : null,
        avgTestWeight: validTW.length ? validTW.reduce((s, t) => s + (t.testWeight || 0), 0) / validTW.length : null,
        avgProtein: validProt.length ? validProt.reduce((s, t) => s + (t.proteinPercent || 0), 0) / validProt.length : null,
        isWheat: this._isWheatProductCode(productCode)
      });
    }
    return groups.sort((a, b) => a.productCode.localeCompare(b.productCode));
  });

  readonly anyTicketWheat = computed(() => this.ticketsByCommodity().some(g => g.isWheat || g.avgProtein != null));

  formatDeliveryPeriod(start?: Date | string, end?: Date | string): string {
    if (!start && !end) return '—';
    const fmt = (d: Date | string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (start && end) return `${fmt(start)} – ${fmt(end)}`;
    if (start) return `From ${fmt(start)}`;
    return `Until ${fmt(end!)}`;
  }

  getCustomerPhone(): string {
    const c = this.customer();
    return (c.phone && c.phone.trim()) || (c.extendedPrimaryPhone && c.extendedPrimaryPhone.trim()) || '';
  }

  getCustomerEmail(): string {
    const c = this.customer();
    return (c.email && c.email.trim()) || (c.supplementalEmail && c.supplementalEmail.trim()) || '';
  }

  getCustomerLocation(): string {
    const c = this.customer();
    const parts = [c.location, c.stateProvince].filter(Boolean);
    return parts.join(', ') || '—';
  }

  // Security
  private _esc(str: string | undefined | null): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Print
  printReport(): void {
    const html = this._buildPrintHtml();
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      this.toastService.success('Print dialog opened');
    } else {
      this.toastService.warning('Unable to open print window. Check pop-up blocker settings.');
    }
  }

  private _buildPrintHtml(): string {
    const c = this.customer();
    const accent = this.accentColor();
    const accentLight = accent + '18';

    let html = `<!DOCTYPE html><html><head>
      <title>Producer Report - ${this._esc(c.name)}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Open Sans', 'Segoe UI', system-ui, sans-serif; color: #1a1a1a; line-height: 1.5; padding: 0.5in; }
        @page { margin: 0.5in; size: letter; }
        @media print { body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
        th { text-align: center; padding: 10px 14px; font-weight: 600; color: #374151; vertical-align: middle; }
        td { padding: 10px 14px; text-align: center; vertical-align: middle; word-wrap: break-word; overflow-wrap: break-word; }
        .section { margin-bottom: 28px; }
        .section-title { font-size: 14px; font-weight: 700; color: ${accent}; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 14px; }
        .table-wrap { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
        .table-header { background: ${accentLight}; }
        .table-row-border { border-top: 1px solid #f3f4f6; }
        .kpi-box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; border-top: 3px solid ${accent}; }
        .note-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; border-left: 3px solid ${accent}; margin-bottom: 10px; }
      </style>
    </head><body>`;

    // Header
    const logoUrl = `${window.location.origin}/assets/images/scoular-logo-dark.webp`;
    html += `<div style="border-bottom: 3px solid ${accent}; padding-bottom: 24px; margin-bottom: 28px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
        <img src="${logoUrl}" alt="Scoular" style="height: 44px; object-fit: contain;" />
        <div style="text-align: right; font-size: 11px; color: #6b7280;">
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: ${accent}; font-weight: 600; margin-bottom: 4px;">Producer Summary Report</div>
          <div>${this._esc(this.today)}</div>
          <div style="margin-top: 6px;">Prepared by ${this._esc(this.originatorName())}</div>
          ${this.originatorTitle() ? `<div>${this._esc(this.originatorTitle())}</div>` : ''}
        </div>
      </div>
      <div style="background: ${accentLight}; border-radius: 10px; padding: 18px 22px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-size: 24px; font-weight: 700; color: #111;">${this._esc(c.name)}</div>
        </div>
        <div style="display: flex; gap: 24px; font-size: 12px; color: #4b5563;">
          <div>
            <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Location</div>
            <div>${this._esc(this.getCustomerLocation())}</div>
          </div>
          ${this.getCustomerPhone() ? `<div>
            <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Phone</div>
            <div>${this._esc(this.getCustomerPhone())}</div>
          </div>` : ''}
          ${this.getCustomerEmail() ? `<div>
            <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Email</div>
            <div>${this._esc(this.getCustomerEmail())}</div>
          </div>` : ''}
        </div>
      </div>
    </div>`;

    // Executive Summary KPIs (reuse the computed signal)
    const kpiItems = this.kpis();
    if (kpiItems.length > 0) {
      html += `<div class="section">
        <div class="section-title">Executive Summary</div>
        <div style="display: grid; grid-template-columns: repeat(${kpiItems.length}, 1fr); gap: 14px;">
          ${kpiItems.map(k => `<div class="kpi-box">
            <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">${this._esc(k.label)}</div>
            <div style="font-size: 22px; font-weight: 700; color: #111;">${this._esc(k.value)}</div>
            ${k.sub ? `<div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${this._esc(k.sub)}</div>` : ''}
          </div>`).join('')}
        </div>
      </div>`;
    }



    // Contracts (grouped by commodity — each contract gets its own header + body so
    // multiple contracts for the same commodity are easier to read in print).
    if (this.showContracts() && this.openContracts().length > 0) {
      const contractColgroup = `<colgroup>
        <col style="width: 16%;" />
        <col style="width: 14%;" />
        <col style="width: 12%;" />
        <col style="width: 13%;" />
        <col style="width: 14%;" />
        <col style="width: 18%;" />
        <col style="width: 13%;" />
      </colgroup>`;
      // Single gridlined header row shown once at the top of the Contracts section.
      const contractThead = `<thead><tr class="table-header">
        <th style="padding:6px 8px;border:1px solid #e5e7eb;">Contract #</th><th style="padding:6px 8px;border:1px solid #e5e7eb;">Quantity</th><th style="padding:6px 8px;border:1px solid #e5e7eb;">Price</th><th style="padding:6px 8px;border:1px solid #e5e7eb;">Special Type</th><th style="padding:6px 8px;border:1px solid #e5e7eb;">Basis Location</th><th style="padding:6px 8px;border:1px solid #e5e7eb;">Delivery Window</th><th style="padding:6px 8px;border:1px solid #e5e7eb;">Status</th>
      </tr></thead>`;

      // One contract's 7-cell row (borderCells = draw gridlines around each cell, for the flat view).
      const contractRow = (ct: Contract, borderCells: boolean): string => {
        const status = this.getCalculatedStatus(ct);
        const styles = this.getStatusStyles(status);
        const unit = this._esc(ct.unit || 'bu');
        const b = borderCells ? 'border:1px solid #e5e7eb;' : '';
        return `<td style="padding:4px 8px;font-weight:500;${b}">${this._esc(ct.sourceContractId || ct.contractNumber)}</td>
          <td style="padding:4px 8px;${b}">${(ct.quantity ?? 0).toLocaleString()} ${unit}</td>
          <td style="padding:4px 8px;${b}">${this._esc(this.getContractPrice(ct))}</td>
          <td style="padding:4px 8px;${b}">${this._esc(ct.specialType || '—')}</td>
          <td style="padding:4px 8px;${b}">${this._esc(ct.basisLocation || '—')}</td>
          <td style="padding:4px 8px;font-size:10px;${b}">${this._esc(this.formatDeliveryPeriod(ct.deliveryStart, ct.deliveryEnd))}</td>
          <td style="padding:4px 8px;${b}"><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:600;background:${styles.bg};color:${styles.color};">${this._esc(status)}</span></td>`;
      };

      // A contract's pricing-lines table (used inside the grouped card).
      const pricingTable = (ct: Contract): string => {
        const lines = this.getPricingLinesForContract(ct);
        if (lines.length === 0) return '';
        const unit = this._esc(ct.unit || 'bu');
        // Same columns, order and formats as the preview's pricing-line table (the same pipes and
        // arguments), so the page matches what was previewed: up to 4 decimals, short date.
        const linePrice = (v: number | null | undefined): string =>
          v != null ? (this.currencyPipe.transform(v, 'USD', 'symbol', '1.2-4') ?? '—') : '—';
        return `<div style="padding:6px 8px 8px 8px;background:#f9fafb;border-top:1px solid #f3f4f6;">
          <table style="width:100%;border-collapse:collapse;font-size:10px;background:#ffffff;border:1px solid #e5e7eb;border-radius:4px;">
            <thead><tr style="background:#f3f4f6;">
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Seq</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Quantity</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Hedge</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Basis</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Freight Adj</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Flat Price</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Price Date</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Confirm</th>
            </tr></thead>
            <tbody>
              ${lines.map(line => `<tr>
                <td style="text-align:center;padding:4px 6px;color:#6b7280;">${line.priceSequence ?? ''}</td>
                <td style="text-align:center;padding:4px 6px;">${(line.priceQuantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unit}</td>
                <td style="text-align:center;padding:4px 6px;">${this._esc(linePrice(line.hedgePrice))}</td>
                <td style="text-align:center;padding:4px 6px;">${this._esc(linePrice(line.basisPrice))}</td>
                <td style="text-align:center;padding:4px 6px;">${this._esc(linePrice(line.freightAdjustment))}</td>
                <td style="text-align:center;padding:4px 6px;font-weight:600;">${this._esc(linePrice(line.flatPrice))}</td>
                <td style="text-align:center;padding:4px 6px;">${line.priceDate ? this._esc(this.datePipe.transform(line.priceDate, 'M/d/yy')) : '—'}</td>
                <td style="text-align:center;padding:4px 6px;">${this._esc(line.customerConfirmStatus || '—')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      };

      const grouped = this.showPricingLines();
      // Plain (borderless) header for the grouped view; gridlined header for the flat view.
      const groupedHeader = `<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;margin-bottom:6px;">${contractColgroup}<thead><tr class="table-header"><th style="padding:5px 8px;">Contract #</th><th style="padding:5px 8px;">Quantity</th><th style="padding:5px 8px;">Price</th><th style="padding:5px 8px;">Special Type</th><th style="padding:5px 8px;">Basis Location</th><th style="padding:5px 8px;">Delivery Window</th><th style="padding:5px 8px;">Status</th></tr></thead></table>`;
      // Column header shown ONCE at the top of the Contracts section, above the commodity bands.
      const sharedHeader = grouped
        ? groupedHeader
        : `<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;margin-bottom:6px;">${contractColgroup}${contractThead}</table>`;
      html += `<div class="section">
        <div class="section-title">Contracts</div>
        ${sharedHeader}
        ${this.contractsByCommodity().map((group) => {
          return `
          <div style="margin-bottom: 14px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px;font-weight:700;color:#374151;padding:6px 10px;background:${this.commodityBandColor(group.commodity)};border:1px solid #e5e7eb;border-radius:8px 8px 0 0;">
              <span>${this._esc(group.commodity)}</span>
              <span style="color:#6b7280;">Total: ${group.totalQuantity.toLocaleString()} ${this._esc(group.unit)}</span>
            </div>
            ${grouped
              ? `<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:6px;">
                  ${group.contracts.map(ct => `
                    <div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-top:6px;page-break-inside:avoid;">
                      <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;">${contractColgroup}<tbody><tr>${contractRow(ct, false)}</tr></tbody></table>
                      ${pricingTable(ct)}
                    </div>`).join('')}
                </div>`
              : `<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                  ${contractColgroup}
                  <tbody>
                    ${group.contracts.map(ct => `<tr style="page-break-inside:avoid;">${contractRow(ct, true)}</tr>`).join('')}
                  </tbody>
                </table>`}
          </div>`;
        }).join('')}
      </div>`;
    }

    // Unapplied Tickets (grouped by commodity — mirrors the Unapplied Tickets tab)
    const ticketGroups = this.ticketsByCommodity();
    if (this.showTickets() && ticketGroups.length > 0) {
      const showProtein = this.anyTicketWheat();
      const fmtNum = (n: number, d: number) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
      html += `<div class="section">
        <div class="section-title">Unapplied Tickets</div>
        <div class="table-wrap"><table>
          <thead><tr class="table-header">
            <th style="padding:5px 8px;border:1px solid #e5e7eb;">Crop</th><th style="padding:5px 8px;border:1px solid #e5e7eb;"># Tickets</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Total Net</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Avg Date</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Avg Moisture</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Avg Test Wt</th>${showProtein ? '<th style="padding:5px 8px;border:1px solid #e5e7eb;">Avg Protein</th>' : ''}
          </tr></thead>
          <tbody>
            ${ticketGroups.map(g => {
              const totalDisplay = g.totalBushels != null
                ? `${Math.round(g.totalBushels).toLocaleString()} bu`
                : `${Math.round(g.totalNetWeight).toLocaleString()} lbs`;
              return `<tr style="background:${this.commodityBandColor(g.isWheat ? 'wheat' : g.productCode)};">
                <td style="padding:4px 8px;font-weight:500;border:1px solid #e5e7eb;">${this._esc(g.productCode)}</td>
                <td style="padding:4px 8px;border:1px solid #e5e7eb;">${g.ticketCount}</td>
                <td style="padding:4px 8px;border:1px solid #e5e7eb;">${totalDisplay}</td>
                <td style="padding:4px 8px;border:1px solid #e5e7eb;">${g.avgDate ? this.formatDate(g.avgDate) : '—'}</td>
                <td style="padding:4px 8px;border:1px solid #e5e7eb;">${g.avgMoisture != null ? fmtNum(g.avgMoisture, 1) + '%' : '—'}</td>
                <td style="padding:4px 8px;border:1px solid #e5e7eb;">${g.avgTestWeight != null ? fmtNum(g.avgTestWeight, 1) : '—'}</td>
                ${showProtein ? `<td style="padding:4px 8px;border:1px solid #e5e7eb;">${g.avgProtein != null ? fmtNum(g.avgProtein, 1) + '%' : '—'}</td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>`;
    }

    // Planting Intentions (grouped by crop; crop band + total acres, header once)
    if (this.showPlanting() && this.includedPlantingIntentions().length > 0) {
      const plantingColgroup = `<colgroup><col style="width:40%;" /><col style="width:30%;" /><col style="width:30%;" /></colgroup>`;
      const plantingThead = `<thead><tr class="table-header">
        <th style="padding:5px 8px;border:1px solid #e5e7eb;">Type</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Acres</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Crop Year</th>
      </tr></thead>`;
      // Column header shown ONCE above all crops (gridlined, matching the body tables).
      const plantingHeader = `<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;margin-bottom:6px;">${plantingColgroup}${plantingThead}</table>`;
      html += `<div class="section">
        <div class="section-title">Planting Intentions</div>
        ${plantingHeader}
        ${this.plantingByCrop().map((group) => {
          return `
          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px;font-weight:700;color:#374151;padding:6px 10px;background:${this.commodityBandColor(group.crop)};border:1px solid #e5e7eb;border-radius:8px 8px 0 0;">
              <span>${this._esc(group.crop)}</span>
              <span style="color:#6b7280;">Total: ${group.totalAcres.toLocaleString()} acres</span>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
              ${plantingColgroup}
              <tbody>
                ${group.intentions.map(pi => `<tr>
                  <td style="padding:4px 8px;font-weight:500;border:1px solid #e5e7eb;">${this._esc(pi.type || '—')}</td>
                  <td style="padding:4px 8px;border:1px solid #e5e7eb;">${(pi.acres ?? 0).toLocaleString()}</td>
                  <td style="padding:4px 8px;border:1px solid #e5e7eb;">${pi.plantingYear}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
        }).join('')}
      </div>`;
    }

    // Stored Grain (grouped by crop)
    const storageGrps = this.storageGroups();
    if (this.showStorage() && storageGrps.length > 0) {
      html += `<div class="section">
        <div class="section-title">Grain in Storage</div>
        <div class="table-wrap"><table>
          <thead><tr class="table-header">
            <th style="text-align:center;padding:5px 8px;border:1px solid #e5e7eb;">Crop</th><th style="text-align:center;padding:5px 8px;border:1px solid #e5e7eb;">Quantity</th><th style="text-align:center;padding:5px 8px;border:1px solid #e5e7eb;">Storage Since</th><th style="text-align:center;padding:5px 8px;border:1px solid #e5e7eb;">Storage Days</th><th style="text-align:center;padding:5px 8px;border:1px solid #e5e7eb;">Accumulated Cost</th>
          </tr></thead>
          <tbody>
            ${storageGrps.map(g => `<tr style="background:${this.commodityBandColor(g.crop)};">
              <td style="text-align:center;padding:4px 8px;font-weight:500;border:1px solid #e5e7eb;">${this._esc(g.crop)}</td>
              <td style="text-align:center;padding:4px 8px;border:1px solid #e5e7eb;">${g.totalBushels.toLocaleString()} bu</td>
              <td style="text-align:center;padding:4px 8px;border:1px solid #e5e7eb;">${this.formatDate(g.earliestDate)}</td>
              <td style="text-align:center;padding:4px 8px;border:1px solid #e5e7eb;">${g.totalDays}</td>
              <td style="text-align:center;padding:4px 8px;border:1px solid #e5e7eb;">${this.formatCurrency(g.totalCost)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
    }

    // Bin Sites & Grain on Farm (a band per site, then the grain stored there — mirrors the preview)
    const binSites = this.binSiteGroups();
    if (this.showBinSites() && binSites.length > 0) {
      const onFarm = this.grainOnFarmTotal();
      const cell = 'padding:4px 8px;text-align:center;border:1px solid #e5e7eb;';
      html += `<div class="section">
        <div class="section-title">Bin Sites &amp; Grain on Farm${onFarm > 0 ? `<span style="font-weight:500;letter-spacing:0;text-transform:none;color:#6b7280;"> · ${this._esc(onFarm.toLocaleString())} bu on farm</span>` : ''}</div>
        <div class="table-wrap"><table>
          <thead><tr class="table-header">
            <th style="text-align:left;padding:5px 8px;border:1px solid #e5e7eb;">Crop</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">On Farm</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Sold</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Grade</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Target</th><th style="padding:5px 8px;border:1px solid #e5e7eb;">Last Bid</th>
          </tr></thead>
          <tbody>
            ${binSites.map(site => `<tr style="background:#f9fafb;">
              <td colspan="6" style="padding:5px 8px;text-align:left;font-weight:600;color:#374151;border:1px solid #e5e7eb;">${this._esc(site.name)}${site.capacity != null ? `<span style="font-weight:400;color:#6b7280;"> · ${this._esc(site.capacity.toLocaleString())} bu capacity</span>` : ''}</td>
            </tr>${site.rows.length > 0
              ? site.rows.map(g => `<tr style="background:${this.grainBandColor(g.commodityCode)};">
                <td style="${cell}text-align:left;font-weight:500;">${this._esc(g.commodityCode)}</td>
                <td style="${cell}">${this._esc((g.bushelsOnHand ?? 0).toLocaleString())} bu</td>
                <td style="${cell}">${(g.bushelsSold ?? 0) > 0 ? `${this._esc((g.bushelsSold ?? 0).toLocaleString())} bu` : '—'}</td>
                <td style="${cell}">${this._esc(g.grade?.trim() || '—')}</td>
                <td style="${cell}">${g.targetBushels != null ? this._esc(this.formatCurrency(g.targetBushels)) : '—'}</td>
                <td style="${cell}">${this._esc(this.formatLastBid(g.lastBid))}</td>
              </tr>`).join('')
              : `<tr><td colspan="6" style="padding:4px 8px;text-align:left;color:#9ca3af;font-style:italic;border:1px solid #e5e7eb;">No grain on farm recorded</td></tr>`}`).join('')}
          </tbody>
        </table></div>
      </div>`;
    }

    // Footer
    html += `<div style="border-top: 2px solid ${accent}; padding-top: 16px; margin-top: 32px; display: flex; justify-content: space-between; align-items: flex-end;">
      <div style="font-size: 11px; color: #6b7280;">
        <div style="font-weight: 600; color: #374151;">The Scoular Company</div>
        <div>Grain Origination</div>
        <div style="margin-top: 6px;">Report generated ${this._esc(this.today)}</div>
        <div style="font-size: 10px; color: #9ca3af; margin-top: 4px;">This report is confidential and intended for the named recipient only.</div>
      </div>
      <div style="text-align: right; font-size: 11px; color: #6b7280;">
        <div style="font-weight: 600; color: #374151;">${this._esc(this.originatorName())}</div>
        ${this.originatorTitle() ? `<div>${this._esc(this.originatorTitle())}</div>` : ''}
        ${this.originatorPhone() ? `<div>${this._esc(this.originatorPhone())}</div>` : ''}
        <div>${this._esc(this.originatorEmail())}</div>
      </div>
    </div>`;

    html += `</body></html>`;
    return html;
  }
}
