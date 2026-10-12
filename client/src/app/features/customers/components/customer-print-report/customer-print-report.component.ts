import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MsalService } from '@azure/msal-angular';
import { ToastService } from '@core/services/toast.service';
import { AppStateService } from '@core/services/app-state.service';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '@shared/components/dialog/dialog.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { Customer, Contract, ContractPricingLine, PlantingIntention, StoredGrain, Note, Commodity, DashboardPlantingEstimate, Ticket } from '@models';
import { getContractDeliveryStats } from '@shared/utils/contract-delivery';
import { buildLbsPerBushelMap, findYieldEstimate, sumInBushels } from '@shared/utils/production-coverage';
import { plantingCategory, commodityPlantingCategory } from '@shared/utils/planting-category';
import { binSiteGrainBreakdown, formatLastBid } from '@shared/utils/grain-on-farm';

type PricingStatus = 'UNPRICED' | 'PARTIAL' | 'PRICED' | 'FLAT' | 'DEFERRED' | 'LOADING';

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
  templateUrl: './customer-print-report.component.html'
})
export class CustomerPrintReportComponent {
  private readonly msalService = inject(MsalService);
  private readonly toastService = inject(ToastService);
  private readonly appState = inject(AppStateService);

  readonly noTradeUnit = computed(() => this.appState.selectedTradeUnits().length === 0);

  // Inputs
  public isOpen = input(false);
  public customer = input.required<Customer>();
  public contracts = input<Contract[]>([]);
  public tickets = input<Ticket[]>([]);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public storedGrain = input<StoredGrain[]>([]);
  public notes = input<Note[]>([]);
  public commodities = input<Commodity[]>([]);
  public yieldEstimates = input<DashboardPlantingEstimate[]>([]);
  public pricingLines = input<ContractPricingLine[]>([]);
  public linkedCustomers = input<Customer[]>([]);

  // Output
  public close = output<void>();

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

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (open && !this._defaultsApplied) {
        this._defaultsApplied = true;
        const account = this.msalService.instance.getActiveAccount()
          ?? this.msalService.instance.getAllAccounts()[0];
        if (account) {
          this.originatorName.set(account.name ?? '');
          const username = account.username ?? '';
          this.originatorEmail.set(
            username && !username.includes('@') ? `${username}@scoular.com` : username
          );
        }
        // Default KPI toggles off when value is 0
        untracked(() => {
          this.showTotalAcres.set((this.customer().totalAcres ?? 0) > 0);
          this.showTotalContracted.set(this.totalContracted() > 0);
          this.showContracts.set(this.contracts().filter(c => !c.closedDate).length > 0);
          this.showTickets.set(this.tickets().filter(t => !t.isApplied).length > 0);
          this.showPlanting.set(this.plantingIntentions().length > 0);
          // Every year on by default, so opening the dialog reports what it always has, with the
          // picker collapsed until the user goes looking for it.
          this.selectedPlantingYears.set(this.plantingYears());
          this.plantingYearsExpanded.set(false);
          this.showStorage.set(this.storedGrain().length > 0);
          this.showBinSites.set(this.binSiteGroups().length > 0);
          this.showPricingLines.set(this.visiblePricingLines().length > 0);
        });
      } else if (!open) {
        this._defaultsApplied = false;
      }
    });
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

  // --- Pricing logic mirrors contracts-table.component.ts getPricingInfo ---
  getPricingInfo(contract: Contract): { status: PricingStatus; cashPrice?: number } {
    const ptc = (contract.priceTypeCode ?? '').trim().toUpperCase();
    const lines = contract.sourceContractId ? this.pricingLinesMap().get(contract.sourceContractId) : undefined;
    const safeLines = lines ?? [];
    const hasLines = safeLines.length > 0;

    if (ptc === 'P') {
      if (hasLines && safeLines[0].flatPrice != null) {
        return { status: 'FLAT', cashPrice: safeLines[0].flatPrice };
      }
      return { status: 'PRICED' };
    }
    if (ptc === 'D') return { status: 'DEFERRED' };
    if (ptc === 'U') {
      if (hasLines) {
        const hasSequence = safeLines.some(l => (l.priceSequence ?? 0) > 0);
        if (hasSequence) {
          const totalPricedQty = safeLines.reduce((sum, l) => sum + (l.priceQuantity ?? 0), 0);
          const contractQty = contract.quantity ?? 0;
          if (totalPricedQty > 0 && totalPricedQty < contractQty) return { status: 'PARTIAL' };
          if (totalPricedQty >= contractQty) return { status: 'PRICED' };
        }
      }
      return { status: 'UNPRICED' };
    }
    return { status: 'UNPRICED' };
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

  /** Backwards-compatible alias — legacy name kept so older refs resolve. */
  readonly activeContracts = this.openContracts;

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

  readonly totalStored = computed(() =>
    this.storedGrain().reduce((sum, g) => sum + (g.quantity ?? 0), 0)
  );

  readonly projectedProductionBu = computed(() => {
    const intentions = this.includedPlantingIntentions();
    const commodities = this.commodities();
    const yieldEstimates = this.yieldEstimates();
    if (intentions.length === 0) return 0;
    return intentions.reduce((sum, pi) => {
      const commodity = commodities.find(c => c.code === pi.crop);
      const category = plantingCategory(pi, commodity);
      // Each intention is projected with ITS OWN season's estimate. Previously this matched on crop
      // name alone, so a year with no season target silently borrowed another year's bu/ac — the
      // printed sheet then showed a projection the Growth Opportunity panel refuses to make.
      const est = findYieldEstimate(yieldEstimates, pi.type, category, pi.plantingYear);
      return sum + (pi.acres ?? 0) * (est ?? 0);
    }, 0);
  });

  readonly kpis = computed(() => {
    const items: { label: string; value: string; sub: string }[] = [];
    if (this.showTotalAcres()) {
      const acres = this.customer().totalAcres ?? 0;
      items.push({ label: 'Total Acres', value: acres > 0 ? acres.toLocaleString() : '0', sub: '' });
    }
    if (this.showTotalContracted()) {
      const contracted = this.totalContracted();
      items.push({ label: 'Total Contracted', value: contracted > 0 ? this.formatBu(contracted) : '0 bu', sub: '' });
    }
    return items;
  });

  readonly cropBreakdown = computed(() => {
    const intentions = this.includedPlantingIntentions();
    const contracts = this.openContracts().filter(c => this.getCalculatedStatus(c) !== 'Cancelled');
    const commodities = this.commodities();
    const yieldEstimates = this.yieldEstimates();
    const cropMap = new Map<string, { acres: number; projected: number; contracted: number }>();

    for (const pi of intentions) {
      const commodity = commodities.find(c => c.code === pi.crop);
      // Group and label by the same planting category the dashboard uses, so "Organic Soybeans"
      // gets its own line here instead of folding into "Soybeans".
      const category = plantingCategory(pi, commodity);
      const displayName = category || 'Unknown';
      const entry = cropMap.get(displayName) ?? { acres: 0, projected: 0, contracted: 0 };
      entry.acres += pi.acres ?? 0;
      // Same rule as above: an intention only projects off its own season's estimate.
      const est = findYieldEstimate(yieldEstimates, pi.type, category, pi.plantingYear);
      entry.projected += (pi.acres ?? 0) * (est ?? 0);
      cropMap.set(displayName, entry);
    }
    // Contracts group under the same planting label as the intentions they cover, so an organic
    // contract lands on the "Organic Soybeans" line rather than "Soybeans".
    const codeToName = new Map<string, string>();
    for (const cm of commodities) {
      codeToName.set(cm.code, commodityPlantingCategory(cm) || cm.name || cm.code);
    }
    for (const c of contracts) {
      const displayName = codeToName.get(c.commodityCode || '') || c.commodityDescription || c.commodityCode || 'Unknown';
      const entry = cropMap.get(displayName) ?? { acres: 0, projected: 0, contracted: 0 };
      entry.contracted += c.quantity ?? 0;
      cropMap.set(displayName, entry);
    }
    return [...cropMap.entries()]
      .map(([crop, data]) => ({ crop, ...data }))
      .sort((a, b) => b.contracted - a.contracted);
  });

  readonly cropTotals = computed(() => {
    const rows = this.cropBreakdown();
    return {
      acres: rows.reduce((s, r) => s + r.acres, 0),
      projected: rows.reduce((s, r) => s + r.projected, 0),
      contracted: rows.reduce((s, r) => s + r.contracted, 0)
    };
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
  readonly binSiteGroups = computed(() => binSiteGrainBreakdown(this.customer().binSites, this.customer().grainOnFarm));
  readonly grainOnFarmTotal = computed(() =>
    (this.customer().grainOnFarm ?? []).reduce((sum, g) => sum + (g.bushelsOnHand ?? 0), 0));
  readonly formatLastBid = formatLastBid;

  readonly reportNotes = computed(() => {
    const allNotes = this.notes();
    const pinned = allNotes.filter(n => n.isPinned).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const unpinned = allNotes.filter(n => !n.isPinned).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return [...pinned, ...unpinned].slice(0, 10);
  });

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

  private _conversionMap: Map<string, number> | null = null;

  private _lookupLbsPerBushel(productCode: string | undefined | null): number | null {
    const code = (productCode || '').trim().toUpperCase();
    if (!code) return null;
    const conversions = this.appState.commodityConversions();
    if (conversions.length === 0) return null;
    if (!this._conversionMap || this._conversionMap.size !== conversions.length) {
      this._conversionMap = new Map(conversions.map(c => [c.commodityCode.trim().toUpperCase(), c.lbsPerUnit]));
    }
    const lbs = this._conversionMap.get(code);
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

  getDeliveredBu(ct: Contract): number {
    return this.getDeliveryStats(ct).delivered;
  }

  getDeliveryPct(ct: Contract): number {
    return Math.round(this.getDeliveryStats(ct).progressPercent);
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

  /** Projected bushels for one intention row. Returns 0 when its season has no yield estimate —
   *  the estimate is never taken from a different year (see findYieldEstimate). */
  getPlantingYield(pi: PlantingIntention): number {
    const commodity = this.commodities().find(c => c.code === pi.crop);
    const category = plantingCategory(pi, commodity);
    const est = findYieldEstimate(this.yieldEstimates(), pi.type, category, pi.plantingYear);
    return Math.round((pi.acres ?? 0) * (est ?? 0));
  }

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
          ${c.farm ? `<div style="font-size: 14px; color: #4b5563; margin-top: 2px;">${this._esc(c.farm)}</div>` : ''}
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
        return `<div style="padding:6px 8px 8px 8px;background:#f9fafb;border-top:1px solid #f3f4f6;">
          <table style="width:100%;border-collapse:collapse;font-size:10px;background:#ffffff;border:1px solid #e5e7eb;border-radius:4px;">
            <thead><tr style="background:#f3f4f6;">
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Seq</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Quantity</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Basis</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Hedge</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Flat Price</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Freight Adj</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Price Date</th>
              <th style="text-align:center;padding:4px 6px;font-weight:600;color:#6b7280;">Confirm</th>
            </tr></thead>
            <tbody>
              ${lines.map(line => `<tr>
                <td style="text-align:center;padding:4px 6px;color:#6b7280;">${line.priceSequence ?? ''}</td>
                <td style="text-align:center;padding:4px 6px;">${(line.priceQuantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unit}</td>
                <td style="text-align:center;padding:4px 6px;">${line.basisPrice != null ? this.formatCurrency(line.basisPrice) : '—'}</td>
                <td style="text-align:center;padding:4px 6px;">${line.hedgePrice != null ? this.formatCurrency(line.hedgePrice) : '—'}</td>
                <td style="text-align:center;padding:4px 6px;font-weight:600;">${line.flatPrice != null ? this.formatCurrency(line.flatPrice) : '—'}</td>
                <td style="text-align:center;padding:4px 6px;">${line.freightAdjustment != null ? this.formatCurrency(line.freightAdjustment) : '—'}</td>
                <td style="text-align:center;padding:4px 6px;">${line.priceDate ? this.formatDate(line.priceDate) : '—'}</td>
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
