import { Component, input, effect, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { AppStateService } from '@core/services/app-state.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, Ticket, ContractPricingLine } from '@models';
import { expandSearchWithAliases } from '@shared/utils/commodity-aliases';

type SortColumn = 'contractNumber' | 'date' | 'crop' | 'quantity' | 'specialType' | 'price' | 'deliveryStart' | 'status';
type SortDirection = 'none' | 'asc' | 'desc';

@Component({
  selector: 'app-contracts-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableComponent,
    TableHeaderComponent,
    TableBodyComponent,
    TableRowComponent,
    TableHeadComponent,
    TableCellComponent
  ],
  templateUrl: './contracts-table.component.html'
})
export class ContractsTableComponent {
  private readonly appState = inject(AppStateService);
  private readonly usageTracking = inject(UsageTrackingService);
  private _conversionMap: Map<string, number> | null = null;

  public isLoading = input(false);
  public contracts = input<Contract[]>([]);
  public tickets = input<Ticket[]>([]);
  public pricingLines = input<ContractPricingLine[]>([]);
  public customer = input.required<Customer>();
  public openContractId = input<number | null>(null);

  expandedRows = new Set<number>();
  expandedTicketSections = new Set<number>();
  expandedPricingSections = new Set<number>();
  pricingLinesLoaded = computed(() => this.pricingLines() !== undefined);
  pricingLinesMap = computed(() => {
    const map = new Map<string, ContractPricingLine[]>();
    // Initialize empty arrays for all contracts so "no lines" !== "not loaded"
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
  currentSortColumn = signal<SortColumn | null>(null);
  currentSortDirection = signal<SortDirection>('none');
  /** Direction the commodity groups are sorted in. Independent of the row-level
   *  sort — the Crop column header drives this, the rest drive row sort. Groups
   *  are always rendered (no "ungrouped" state); this just flips alphabetical. */
  groupSortDirection = signal<'asc' | 'desc'>('asc');
  showSearch = signal(false);
  searchQuery = signal('');

  /** Full month name for labels like "April Undelivered". */
  readonly currentMonthLabel = computed<string>(() =>
    new Date().toLocaleString('en-US', { month: 'long' })
  );

  /** Compact bushel formatter for the inline commodity pills — e.g. 30,127 → "30K", 1,234 → "1.2K". */
  formatCompactBu(n: number): string {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }

  private _deliveryStatsCache = new Map<number, { deliveredBushels: number; remainingBushels: number; progressPercent: number; computable: boolean }>();
  private _statusCache = new Map<number, string>();

  constructor() {
    // Invalidate per-row caches whenever the underlying contracts or tickets change.
    // Expansion state is intentionally NOT touched here — tickets often arrive a beat
    // after contracts, and clearing expansion on every data tick was collapsing rows
    // the user had just clicked open.
    effect(() => {
      this.contracts();
      this.tickets();
      // Commodity conversions can arrive AFTER contracts — if we don't depend on it here,
      // the first computeDeliveryStats call caches {computable: false} and never recovers.
      this.appState.commodityConversions();
      this._deliveryStatsCache.clear();
      this._statusCache.clear();
      this._conversionMap = null;
    });

    // Reset expansion + search and apply any deep-link openContractId only when the
    // customer changes (or openContractId itself changes). This is what the user
    // experiences as "switching customers".
    effect(() => {
      const _customerId = this.customer()?.id;
      const openId = this.openContractId();
      this.expandedRows.clear();
      this.expandedTicketSections.clear();
      this.expandedPricingSections.clear();
      this.searchQuery.set('');
      if (openId != null) {
        this.expandedRows.add(openId);
        // Defer scroll so contracts render before we try to find the row.
        this._scrollToContract(openId);
      }
    });
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.showSearch.set(false);
  }

  /** Search-filtered + sorted view of open contracts. Memoized as a computed so summary
   *  signals and the template don't re-run the search/filter pipeline on every read. */
  /** Open contracts grouped by commodity. Outer order is alphabetical by
   *  commodity (asc or desc per groupSortDirection); within each group the
   *  contracts preserve the order from displayedContracts() — so whatever
   *  row-level sort the user picked is respected per-group. Empty groups
   *  (filtered out by search) never appear because we build from the
   *  already-filtered list. */
  readonly groupedContracts = computed<Array<{ commodity: string; contracts: Contract[] }>>(() => {
    const list = this.displayedContracts();
    const map = new Map<string, Contract[]>();
    for (const c of list) {
      // Group by commodityCode so same-code rows always share a bucket — e.g.
      // multiple YC variants stay together even if commodityDescription differs.
      // Fall back to description/group/'Other' only when code is missing.
      const key = (c.commodityCode || c.commodityDescription || c.commodityGroup || 'Other').trim();
      const arr = map.get(key);
      if (arr) arr.push(c); else map.set(key, [c]);
    }
    const dir = this.groupSortDirection();
    const groups = [...map.entries()].map(([commodity, contracts]) => ({ commodity, contracts }));
    groups.sort((a, b) => dir === 'asc' ? a.commodity.localeCompare(b.commodity) : b.commodity.localeCompare(a.commodity));
    return groups;
  });

  readonly displayedContracts = computed<Contract[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const sorted = this.sortedContracts;
    if (!q) return sorted;
    const terms = this._expandWithAliases(q);
    return sorted.filter(c => {
      const deliveryStr = this._formatDeliveryPeriod(c.deliveryStart, c.deliveryEnd);
      return terms.some(term =>
        c.contractNumber.toLowerCase().includes(term) ||
        (c.sourceContractId || '').toLowerCase().includes(term) ||
        (c.commodityDescription || '').toLowerCase().includes(term) ||
        (c.commodityCode || '').toLowerCase().includes(term) ||
        (c.commodityGroup || '').toLowerCase().includes(term) ||
        this.getCalculatedStatus(c).toLowerCase().includes(term) ||
        this._matchesDate(c.contractDate, term) ||
        deliveryStr.includes(term) ||
        this._matchesDeliveryPeriod(c.deliveryStart, c.deliveryEnd, term)
      );
    });
  });

  private static readonly _MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  private static readonly _MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /** Check if a date matches a search term. Supports:
   *  - Month names: "July", "Oct", "march"
   *  - Day numbers: "19", "31"
   *  - Years: "2025", "2026"
   *  - Slash/dash dates: "10/1/2025", "1-1-2026", "3/15"
   *  - Natural dates: "Oct 23, 2025", "March 2025", "October 23 2025"
   */
  private _matchesDate(dateVal: Date | string | undefined, term: string): boolean {
    if (!dateVal) return false;
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) return false;
    const month = d.getMonth(), day = d.getDate(), year = d.getFullYear();
    // Month name match (full or abbreviated)
    if (ContractsTableComponent._MONTHS[month].startsWith(term) || ContractsTableComponent._MONTHS_SHORT[month] === term) return true;
    // Exact year match
    if (term === String(year)) return true;
    // Exact day match (only 1-2 digit numbers)
    if (/^\d{1,2}$/.test(term) && parseInt(term, 10) === day) return true;
    // Slash or dash date: M/D/YYYY, M-D-YYYY, M/D, M-D
    const dateParts = term.split(/[/\-]/);
    if (dateParts.length >= 2) {
      const m = parseInt(dateParts[0], 10), dd = parseInt(dateParts[1], 10), yy = dateParts[2] ? parseInt(dateParts[2], 10) : null;
      if (!isNaN(m) && !isNaN(dd)) {
        if (m === month + 1 && dd === day && (yy === null || yy === year)) return true;
      }
    }
    // Natural date string: "Oct 23, 2025", "March 2025", "October 23 2025"
    const parsed = new Date(term.replace(',', ''));
    if (!isNaN(parsed.getTime())) {
      const hasDay = /\d{1,2}[,\s]/.test(term) || /\s\d{1,2}\s/.test(term) || /\s\d{1,2}$/.test(term);
      if (parsed.getMonth() === month && parsed.getFullYear() === year) {
        return !hasDay || parsed.getDate() === day;
      }
    }
    return false;
  }

  /** Check if a delivery period (start–end range) contains a month/year matching the term.
   *  E.g. searching "July" matches a contract with delivery 6/1/2025 - 8/31/2025 because July falls within.
   */
  private _matchesDeliveryPeriod(start: Date | string | undefined, end: Date | string | undefined, term: string): boolean {
    // First check individual dates
    if (this._matchesDate(start, term) || this._matchesDate(end, term)) return true;
    // Then check if a month/year falls within the range
    if (!start || !end) return false;
    const s = start instanceof Date ? start : new Date(start);
    const e = end instanceof Date ? end : new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return false;
    // Check month name — see if that month in any year between start and end is within range
    const monthIdx = ContractsTableComponent._MONTHS.findIndex(m => m.startsWith(term));
    const monthShortIdx = monthIdx === -1 ? ContractsTableComponent._MONTHS_SHORT.indexOf(term) : monthIdx;
    if (monthShortIdx !== -1) {
      for (let y = s.getFullYear(); y <= e.getFullYear(); y++) {
        const monthStart = new Date(y, monthShortIdx, 1);
        const monthEnd = new Date(y, monthShortIdx + 1, 0); // last day of month
        if (monthStart <= e && monthEnd >= s) return true;
      }
    }
    return false;
  }

  /** Format delivery period as "M/D/YYYY - M/D/YYYY" to match the template display. */
  private _formatDeliveryPeriod(start: Date | string | undefined, end: Date | string | undefined): string {
    const fmt = (v: Date | string | undefined): string => {
      if (!v) return '';
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return '';
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    };
    return `${fmt(start)} - ${fmt(end)}`.toLowerCase();
  }

  private _expandWithAliases(q: string): string[] {
    return expandSearchWithAliases(q);
  }

  /** Open contracts only (closedDate is null) — excludes prior-year closed contracts
   *  that are loaded for pacing comparison but shouldn't appear in the table. */
  get openContracts(): Contract[] {
    return this.contracts().filter(c => !c.closedDate);
  }

  get sortedContracts(): Contract[] {
    // When no row sort is active, fall back to the default within-group order:
    // delivery period newest → oldest. Grouping happens after this in
    // groupedContracts, which preserves whatever order this getter produced
    // within each commodity bucket.
    if (!this.currentSortColumn() || this.currentSortDirection() === 'none') {
      return [...this.openContracts].sort((a, b) => {
        const aTime = a.deliveryStart ? new Date(a.deliveryStart).getTime() : 0;
        const bTime = b.deliveryStart ? new Date(b.deliveryStart).getTime() : 0;
        return bTime - aTime;
      });
    }

    const sorted = [...this.openContracts].sort((a, b) => {
      let comparison = 0;
      switch (this.currentSortColumn()) {
        case 'contractNumber': {
          // Sort by letter prefix first, then numerically within the same prefix
          const idA = a.sourceContractId || a.contractNumber;
          const idB = b.sourceContractId || b.contractNumber;
          const prefixA = idA.replace(/[0-9]/g, '');
          const prefixB = idB.replace(/[0-9]/g, '');
          comparison = prefixA.localeCompare(prefixB)
            || (parseInt(idA.replace(/\D/g, ''), 10) || 0) - (parseInt(idB.replace(/\D/g, ''), 10) || 0);
          break;
        }
        case 'date':
          comparison = new Date(a.contractDate || 0).getTime() - new Date(b.contractDate || 0).getTime();
          break;
        case 'crop':
          comparison = (a.commodityDescription || '').localeCompare(b.commodityDescription || '');
          break;
        case 'quantity':
          comparison = (a.quantity ?? 0) - (b.quantity ?? 0);
          break;
        case 'specialType':
          comparison = (a.specialType || '').localeCompare(b.specialType || '');
          break;
        case 'price': {
          // Rank: Deferred(0) → Unpriced(1) → Partial(2) → Priced/badge(3) → Cash price(4+)
          const priceRank = (ct: Contract): number => {
            const info = this.getPricingInfo(ct);
            if (info.status === 'DEFERRED') return 0;
            if (info.status === 'UNPRICED') return 1;
            if (info.status === 'PARTIAL') return 2;
            if (info.status === 'PRICED') return 3;
            if (info.status === 'FLAT' && info.cashPrice != null) return 4 + info.cashPrice;
            return 3;
          };
          comparison = priceRank(a) - priceRank(b);
          break;
        }
        case 'deliveryStart':
          comparison = new Date(a.deliveryStart || 0).getTime() - new Date(b.deliveryStart || 0).getTime();
          break;
        case 'status':
          comparison = this.getCalculatedStatus(a).localeCompare(this.getCalculatedStatus(b));
          break;
      }
      return comparison;
    });

    return this.currentSortDirection() === 'desc' ? sorted.reverse() : sorted;
  }

  handleSort(column: SortColumn): void {
    // The Crop column doesn't sort rows — it flips the commodity-group order.
    // Two-state toggle: alpha asc ↔ alpha desc. The row sort is untouched.
    if (column === 'crop') {
      this.groupSortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
      return;
    }
    if (this.currentSortColumn() === column) {
      if (this.currentSortDirection() === 'none') {
        this.currentSortDirection.set('asc');
      } else if (this.currentSortDirection() === 'asc') {
        this.currentSortDirection.set('desc');
      } else {
        this.currentSortDirection.set('none');
        this.currentSortColumn.set(null);
      }
    } else {
      this.currentSortColumn.set(column);
      this.currentSortDirection.set('asc');
    }
  }

  getSortIconClass(column: SortColumn): string {
    if (this.currentSortColumn() === column) {
      return 'text-gray-600 dark:text-gray-300';
    }
    return 'text-gray-400 dark:text-gray-600';
  }

  private _scrollToContract(contractId: number, attempt = 0): void {
    const el = document.getElementById('contract-row-' + contractId);
    if (el) {
      // Add scroll-margin so scrollIntoView doesn't hide the row behind sticky headers
      el.style.scrollMarginTop = '3rem';
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (attempt < 10) {
      setTimeout(() => this._scrollToContract(contractId, attempt + 1), 100);
    }
  }

  toggleRow(contractId: number): void {
    if (this.expandedRows.has(contractId)) {
      this.expandedRows.delete(contractId);
      this.expandedTicketSections.delete(contractId);
      this.expandedPricingSections.delete(contractId);
    } else {
      this.expandedRows.add(contractId);
      this.usageTracking.trackContractExpand(contractId.toString());
      // Defer scroll so the expanded content renders first
      setTimeout(() => this._scrollToContract(contractId), 0);
    }
  }

  toggleTicketSection(contractId: number): void {
    if (this.expandedTicketSections.has(contractId)) {
      this.expandedTicketSections.delete(contractId);
    } else {
      this.expandedTicketSections.add(contractId);
    }
  }

  togglePricingSection(contractId: number): void {
    if (this.expandedPricingSections.has(contractId)) {
      this.expandedPricingSections.delete(contractId);
    } else {
      this.expandedPricingSections.add(contractId);
    }
  }

  getSingularUnit(unit: string): string {
    return unit.endsWith('s') ? unit.slice(0, -1) : unit;
  }

  // --- NEW: Pricing logic based on PriceTypeCode + pricing lines ---
  // Reference logic from CTRM:
  //   PriceTypeCode 'P' + no pricing line = FLAT (show price)
  //   PriceTypeCode 'P' + pricing line    = FLAT (show price)
  //   PriceTypeCode 'U' = UNPRICED
  //   PriceTypeCode 'D' = DEFERRED
  //   Pricing line exists, priceSequence > 0 = PRICED
  //   Pricing line exists, priceSequence = 0 = PRICED (all)
  getPricingLinesForContract(contract: Contract): ContractPricingLine[] {
    const key = contract.sourceContractId;
    return key ? (this.pricingLinesMap().get(key) ?? []) : [];
  }

  getPricingInfo(contract: Contract): { status: 'UNPRICED' | 'PARTIAL' | 'PRICED' | 'FLAT' | 'DEFERRED' | 'LOADING' | 'ERROR'; cashPrice?: number; basisPrice?: number } {
    const ptc = (contract.priceTypeCode ?? '').trim().toUpperCase();
    const key = contract.sourceContractId;
    const lines = key ? this.pricingLinesMap().get(key) : undefined;

    // Pricing lines not loaded yet — wait
    if (lines === undefined && !this.pricingLinesLoaded()) return { status: 'LOADING' };
    const safeLines = lines ?? [];
    const hasLines = safeLines.length > 0;

    // Flat pricing — PriceTypeCode is 'P', show the cash price from pricing line if available
    if (ptc === 'P') {
      if (hasLines && safeLines[0].flatPrice != null) {
        return { status: 'FLAT', cashPrice: safeLines[0].flatPrice };
      }
      return { status: 'PRICED' };
    }

    // Deferred pricing — special type
    if (ptc === 'D') {
      return { status: 'DEFERRED' };
    }

    // Unpriced — check if pricing has started via pricing lines with sequence > 0
    if (ptc === 'U') {
      if (hasLines) {
        const hasSequence = safeLines.some(l => (l.priceSequence ?? 0) > 0);
        if (hasSequence) {
          const totalPricedQty = safeLines.reduce((sum, l) => sum + (l.priceQuantity ?? 0), 0);
          const contractQty = contract.quantity ?? 0;
          // 1-bushel tolerance — float sums of priceQuantity can miss the contractQty target
          // by epsilon (e.g. 99999.9999 vs 100000) and flip the badge to PARTIAL when it's
          // actually fully priced. One bushel is below merchandiser-meaningful rounding.
          const remaining = contractQty - totalPricedQty;
          if (totalPricedQty > 0 && remaining > 1) return { status: 'PARTIAL' };
          if (remaining <= 1) return { status: 'PRICED' };
        }
      }
      // Single-line unpriced contract with a real basis on file: surface the basis number
      // alongside the UNPRICED state so the user sees the locked-in basis without
      // having to expand the row. Multiple lines still show plain UNPRICED — the
      // line ambiguity is the reason for the badge in the first place. Exclude 0 because
      // CTRM stores no-basis-yet as 0; rendering "$0.00/Bu" would look like a real lock.
      if (safeLines.length === 1 && safeLines[0].basisPrice != null && safeLines[0].basisPrice !== 0) {
        return { status: 'UNPRICED', basisPrice: safeLines[0].basisPrice };
      }
      return { status: 'UNPRICED' };
    }

    // No PriceTypeCode (NULL) — rare, default to unpriced
    return { status: 'UNPRICED' };
  }

  /** Bushels on the contract that still need a price. Only meaningful for
   *  PriceTypeCode='U' (unpriced/partial) — other types return null so the UI
   *  can hide the tile. */
  getUnpricedQty(contract: Contract): number | null {
    const ptc = (contract.priceTypeCode ?? '').trim().toUpperCase();
    if (ptc !== 'U') return null;
    const key = contract.sourceContractId;
    const lines = key ? this.pricingLinesMap().get(key) : undefined;
    if (lines === undefined && !this.pricingLinesLoaded()) return null;
    const safeLines = lines ?? [];
    const totalPriced = safeLines
      .filter(l => (l.priceSequence ?? 0) > 0)
      .reduce((sum, l) => sum + (l.priceQuantity ?? 0), 0);
    const unpriced = (contract.quantity ?? 0) - totalPriced;
    return Math.max(0, unpriced);
  }

  // --- PREVIOUS logic (kept for reference) ---
  // getPricingInfo_old(contract: Contract): { status: 'UNPRICED' | 'PARTIAL' | 'PRICED' | 'CASH' | 'LOADING'; cashPrice?: number } {
  //   const key = contract.sourceContractId;
  //   const lines = key ? this.pricingLinesMap().get(key) : undefined;
  //
  //   if (lines !== undefined) {
  //     if (lines.length === 0) return { status: 'UNPRICED' };
  //
  //     // Single line — check PriceTypeCode: "U" means unpriced (will be priced later)
  //     if (lines.length === 1 && lines[0].cashPrice != null) {
  //       const ptc = (contract.priceTypeCode ?? '').trim().toUpperCase();
  //       if (ptc === 'U') return { status: 'UNPRICED' };
  //       return { status: 'CASH', cashPrice: lines[0].cashPrice };
  //     }
  //
  //     const totalPricedQty = lines.reduce((sum, l) => sum + (l.priceQuantity ?? 0), 0);
  //     const contractQty = contract.quantity ?? 0;
  //
  //     if (totalPricedQty === 0) return { status: 'UNPRICED' };
  //     if (totalPricedQty < contractQty) return { status: 'PARTIAL' };
  //     return { status: 'PRICED' };
  //   }
  //
  //   // Fallback: use contract fields before lines are loaded
  //   if (contract.price != null) return { status: 'CASH', cashPrice: contract.price };
  //
  //   const pricedQty = contract.pricedQuantity ?? 0;
  //   const totalQty = contract.quantity ?? 0;
  //
  //   if (pricedQty === 0) return { status: 'UNPRICED' };
  //   if (pricedQty < totalQty) return { status: 'PARTIAL' };
  //   return { status: 'PRICED' };
  // }

  getDeliveryWindowStatus(contract: Contract): string {
    const now = new Date();
    const start = new Date(contract.deliveryStart);
    const end = new Date(contract.deliveryEnd);

    if (now < start) return 'Not Started';
    if (now > end) return 'Ended';
    return 'Open';
  }

  getDeliveryStats(contract: Contract): { deliveredBushels: number; remainingBushels: number; progressPercent: number; computable: boolean } {
    const cached = this._deliveryStatsCache.get(contract.id);
    if (cached) return cached;
    const result = this._computeDeliveryStats(contract);
    this._deliveryStatsCache.set(contract.id, result);
    return result;
  }

  private _computeDeliveryStats(contract: Contract): { deliveredBushels: number; remainingBushels: number; progressPercent: number; computable: boolean } {
    const appliedTickets = this.getAppliedTickets(contract);
    // Strict match on commodityCode against GNP024.Commodity_Code only. If the code
    // isn't in the view, bail out with computable=false so the UI shows dashes and
    // the status logic can skip its "remaining <= 0 means filled" shortcut.
    const lbsPerBushel = this._getLbsPerBushel(contract.commodityCode || '');

    if (lbsPerBushel == null) {
      return { deliveredBushels: 0, remainingBushels: 0, progressPercent: 0, computable: false };
    }

    // Calculate delivered pounds from tickets (appliedDockQuantity/AppliedNetQuantity is in pounds)
    const deliveredLbs = appliedTickets.reduce((sum, t) => sum + (t.appliedDockQuantity || 0), 0);

    // Convert contract quantity to pounds based on unit type
    const contractLbs = this._convertContractQuantityToPounds(contract.quantity || 0, contract.unit, lbsPerBushel);

    // Calculate delivered and remaining in the contract's original unit
    const deliveredInContractUnits = this._convertPoundsToContractUnits(deliveredLbs, contract.unit, lbsPerBushel);
    const remainingInContractUnits = Math.max(0, (contract.quantity || 0) - deliveredInContractUnits);
    // Treat sub-bushel (or sub-0.1%-of-contract) remainders as fully delivered. The percentage
    // floor scales the threshold for tonnage / CWT contracts where 1 bushel of pounds is a tiny
    // fraction of contract size — without it, a 100-ton contract would stay "Active 99.97%"
    // forever even after 99.9% of the load arrived.
    const remainingLbs = Math.max(0, contractLbs - deliveredLbs);
    const completionThresholdLbs = Math.max(lbsPerBushel, contractLbs * 0.001);
    const isEffectivelyComplete = remainingLbs < completionThresholdLbs;
    const progressPercent = isEffectivelyComplete
      ? 100
      : (contractLbs > 0 ? Math.min(100, (deliveredLbs / contractLbs) * 100) : 0);

    // Always keep 2 decimal places of precision so the template can render to 2dp
    // regardless of unit. The number pipe handles display formatting.
    const round = (n: number) => Math.round(n * 100) / 100;

    return {
      deliveredBushels: round(deliveredInContractUnits),
      remainingBushels: round(remainingInContractUnits),
      progressPercent,
      computable: true
    };
  }

  private _convertContractQuantityToPounds(quantity: number, unit: string, lbsPerBushel: number): number {
    const unitLower = (unit || '').toLowerCase().trim();

    // Convert to pounds based on unit type
    // Check for short tons (ST, ton, tons)
    if (unitLower === 'st' || unitLower.includes('ton')) {
      // Short tons to pounds (1 short ton = 2000 lbs)
      return quantity * 2000;
    } else if (unitLower.includes('bushel') || unitLower === 'bu') {
      // Bushels to pounds (commodity-specific)
      return quantity * lbsPerBushel;
    } else if (unitLower.includes('pound') || unitLower.includes('lb')) {
      // Already in pounds
      return quantity;
    } else if (unitLower === 'cwt' || unitLower.includes('hundredweight')) {
      // Hundredweight to pounds (1 cwt = 100 lbs)
      return quantity * 100;
    }

    // Default: assume bushels for grain contracts
    return quantity * lbsPerBushel;
  }

  private _convertPoundsToContractUnits(pounds: number, unit: string, lbsPerBushel: number): number {
    const unitLower = (unit || '').toLowerCase().trim();

    // Convert from pounds back to contract units
    // Check for short tons (ST, ton, tons)
    if (unitLower === 'st' || unitLower.includes('ton')) {
      // Pounds to short tons
      return pounds / 2000;
    } else if (unitLower.includes('bushel') || unitLower === 'bu') {
      // Pounds to bushels (commodity-specific)
      return pounds / lbsPerBushel;
    } else if (unitLower.includes('pound') || unitLower.includes('lb')) {
      // Already in pounds
      return pounds;
    } else if (unitLower === 'cwt' || unitLower.includes('hundredweight')) {
      // Pounds to hundredweight
      return pounds / 100;
    }

    // Default: assume bushels for grain contracts
    return pounds / lbsPerBushel;
  }

  private _getLbsPerBushel(code: string): number | null {
    return this._lookupLbsPerBushel(code);
  }

  /**
   * Looks up lbs-per-bushel from the ODS commodity conversion view (ctrm.vw_GNP024).
   * Matches strictly on Commodity_Code — if the caller's code isn't in the view, returns null.
   * No description matching, no hardcoded fallback — the UI must show a dash rather than
   * display a potentially wrong number.
   */
  private _lookupLbsPerBushel(productCode: string): number | null {
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

  toBushels(lbs: number | null | undefined, productCode: string | undefined | null): number | null {
    const lbsPerBushel = this._lookupLbsPerBushel(productCode || '');
    if (lbsPerBushel == null) return null;
    return (lbs || 0) / lbsPerBushel;
  }

  getAppliedTickets(contract: Contract): Ticket[] {
    // Only consider tickets that are actually applied (isApplied = prefix is not U or L).
    // The sourceContractId match below further narrows to tickets on this specific P/S contract.
    return this.tickets().filter(t => {
      if (!t.isApplied) return false;

      // Primary: Match Ticket.CtrmContractNumber to Contract.SourceContractId
      if (t.ctrmContractNumber && contract.sourceContractId) {
        return t.ctrmContractNumber.trim() === contract.sourceContractId.trim();
      }

      // Fallback: Match by contractId FK
      if (t.contractId && contract.id) {
        return t.contractId === contract.id;
      }

      return false;
    }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  hasWheatInAppliedTickets(contract: Contract): boolean {
    // Check if the contract's commodity group is wheat
    return this.isWheatContract(contract);
  }

  isWheatContract(contract: Contract): boolean {
    if (contract.commodityGroup && contract.commodityGroup.toUpperCase().includes('WHEAT')) return true;
    if (contract.commodityDescription && contract.commodityDescription.toUpperCase().includes('WHEAT')) return true;
    return false;
  }

  isWheat(ticket: Ticket): boolean {
    // For applied tickets, we already know the contract, so just return true
    // since hasWheatInAppliedTickets already checked if the contract is wheat
    return true;
  }

  getCalculatedStatus(contract: Contract): string {
    const cached = this._statusCache.get(contract.id);
    if (cached !== undefined) return cached;
    const result = this._computeCalculatedStatus(contract);
    this._statusCache.set(contract.id, result);
    return result;
  }

  private _computeCalculatedStatus(contract: Contract): string {
    // Calculate delivery progress to check if contract is fulfilled
    const stats = this.getDeliveryStats(contract);
    const now = new Date();
    const startDate = new Date(contract.deliveryStart);
    const endDate = new Date(contract.deliveryEnd);

    // If delivery is complete, show Filled (overrides everything else).
    // Gated on `computable` so contracts with missing GNP024 conversions — where all
    // three stats default to 0 — can't accidentally be marked Filled. In that case
    // we fall through to pure date-based status (Active / To Arrive / Past Due).
    if (stats.computable && (stats.progressPercent >= 100 || stats.remainingBushels <= 0)) {
      return 'Filled';
    }

    // Check for cancelled status from API
    if (contract.status === 'Cancelled') {
      return 'Cancelled';
    }

    // Check if contract is past due (past end date and not filled)
    if (now > endDate) {
      return 'Past Due';
    }

    // Check if contract has reached its start date
    if (now >= startDate) {
      return 'Active';
    }

    // Before start date
    return 'To Arrive';
  }

  getRowHighlight(contract: Contract): string {
    if (contract.customerConfirmStatus && contract.customerConfirmStatus !== 'Confirmed') {
      return '!bg-amber-100 dark:!bg-amber-500/15 hover:!bg-amber-100 dark:hover:!bg-amber-500/15';
    }
    const status = this.getCalculatedStatus(contract);
    if (status === 'Past Due') {
      return '!bg-red-100 dark:!bg-red-500/15 hover:!bg-red-100 dark:hover:!bg-red-500/15';
    }
    return '';
  }

  getStatusClass(status: string): string {
    const base = 'inline-flex items-center justify-center min-w-[5.25rem] px-3 py-1 rounded-full text-xs font-medium text-white';
    switch (status) {
      case 'Active':    return `${base} bg-scoular-green-accessible`;
      case 'Filled':    return `${base} bg-scoular-blue`;
      case 'To Arrive': return `${base} bg-yellow-500`;
      case 'Past Due':  return `${base} bg-scoular-red-accessible`;
      case 'Cancelled': return `${base} bg-gray-500`;
      default:          return `${base} bg-gray-500`;
    }
  }
}
