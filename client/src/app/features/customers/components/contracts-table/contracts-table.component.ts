import { Component, input, effect, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { AppStateService } from '@core/services/app-state.service';
import { Customer, Contract, Ticket, ContractPricingLine } from '@models';

type SortColumn = 'contractNumber' | 'date' | 'crop' | 'quantity' | 'price' | 'deliveryStart' | 'status';
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
  showSearch = signal(false);
  searchQuery = signal('');

  private _deliveryStatsCache = new Map<number, { deliveredBushels: number; remainingBushels: number; progressPercent: number }>();
  private _statusCache = new Map<number, string>();

  constructor() {
    effect(() => {
      // React to contracts or tickets changing
      const _contracts = this.contracts();
      const _tickets = this.tickets();
      this._deliveryStatsCache.clear();
      this._statusCache.clear();
      this.expandedRows.clear();
      this.expandedTicketSections.clear();
      this.expandedPricingSections.clear();
      this.searchQuery.set('');
      // Apply openContractId after clearing expandedRows so it always wins
      const openId = this.openContractId();
      if (openId != null && _contracts.length > 0) {
        this.expandedRows.add(openId);
        // Poll for the rendered element — Angular may not have flushed the DOM yet
        this._scrollToContract(openId);
      }
    });
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.showSearch.set(false);
  }

  get displayedContracts(): Contract[] {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return this.sortedContracts;
    const terms = this._expandWithAliases(q);
    return this.sortedContracts.filter(c => {
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
  }

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
    const aliases: { [key: string]: string[] } = {
      'yc':        ['yc', 'corn', 'yellow corn'],
      'corn':      ['yc', 'corn', 'yellow corn'],
      'yellow corn': ['yc', 'corn', 'yellow corn'],
      'hrw':       ['hrw', 'wheat', 'hard red winter'],
      'hw':        ['hw', 'wheat'],
      'wheat':     ['wheat', 'hrw', 'hw', 'hard red winter'],
      'sb':        ['sb', 'soybeans', 'beans', 'soy'],
      'soybeans':  ['sb', 'soybeans', 'beans', 'soy'],
      'beans':     ['sb', 'soybeans', 'beans', 'soy'],
      'soy':       ['sb', 'soybeans', 'beans', 'soy'],
      'milo':      ['milo', 'sorghum', 'sg'],
      'sorghum':   ['milo', 'sorghum', 'sg'],
      'sg':        ['milo', 'sorghum', 'sg'],
    };
    if (aliases[q]) return aliases[q];
    // Partial prefix match — "yellow" matches "yellow corn" key and expands to corn terms
    const expanded = new Set<string>([q]);
    for (const [key, terms] of Object.entries(aliases)) {
      if (key.startsWith(q)) terms.forEach(t => expanded.add(t));
    }
    return Array.from(expanded);
  }

  get sortedContracts(): Contract[] {
    // Contracts are already filtered by parent component (home.component.ts)
    if (!this.currentSortColumn() || this.currentSortDirection() === 'none') {
      return this.contracts();
    }

    const sorted = [...this.contracts()].sort((a, b) => {
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
          comparison = a.quantity - b.quantity;
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
          comparison = new Date(a.deliveryStart).getTime() - new Date(b.deliveryStart).getTime();
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

  getPricingInfo(contract: Contract): { status: 'UNPRICED' | 'PARTIAL' | 'PRICED' | 'FLAT' | 'DEFERRED' | 'LOADING' | 'ERROR'; cashPrice?: number } {
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
          if (totalPricedQty > 0 && totalPricedQty < contractQty) return { status: 'PARTIAL' };
          if (totalPricedQty >= contractQty) return { status: 'PRICED' };
        }
      }
      return { status: 'UNPRICED' };
    }

    // No PriceTypeCode (NULL) — rare, default to unpriced
    return { status: 'UNPRICED' };
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

  getDeliveryStats(contract: Contract): { deliveredBushels: number; remainingBushels: number; progressPercent: number } {
    const cached = this._deliveryStatsCache.get(contract.id);
    if (cached) return cached;
    const result = this._computeDeliveryStats(contract);
    this._deliveryStatsCache.set(contract.id, result);
    return result;
  }

  private _computeDeliveryStats(contract: Contract): { deliveredBushels: number; remainingBushels: number; progressPercent: number } {
    const appliedTickets = this.getAppliedTickets(contract);
    const lbsPerBushel = this._getLbsPerBushel(contract.commodityDescription || contract.commodityCode || '');

    // Calculate delivered pounds from tickets (appliedDockQuantity/AppliedNetQuantity is in pounds)
    const deliveredLbs = appliedTickets.reduce((sum, t) => sum + (t.appliedDockQuantity || 0), 0);

    // Convert contract quantity to pounds based on unit type
    const contractLbs = this._convertContractQuantityToPounds(contract.quantity || 0, contract.unit, lbsPerBushel);

    // Calculate delivered and remaining in the contract's original unit
    const deliveredInContractUnits = this._convertPoundsToContractUnits(deliveredLbs, contract.unit, lbsPerBushel);
    const remainingInContractUnits = Math.max(0, (contract.quantity || 0) - deliveredInContractUnits);
    const progressPercent = contractLbs > 0 ? Math.min(100, (deliveredLbs / contractLbs) * 100) : 0;

    // Determine precision based on unit type
    const unitLower = (contract.unit || '').toLowerCase().trim();
    const isTons = unitLower === 'st' || unitLower.includes('ton');

    // Apply appropriate precision: 2 decimals for tons, whole numbers for bushels/pounds
    const delivered = isTons
      ? Math.round(deliveredInContractUnits * 100) / 100  // 2 decimals for tons
      : Math.round(deliveredInContractUnits);             // Whole numbers for bushels/pounds

    const remaining = isTons
      ? Math.round(remainingInContractUnits * 100) / 100  // 2 decimals for tons
      : Math.round(remainingInContractUnits);             // Whole numbers for bushels/pounds

    return {
      deliveredBushels: delivered,
      remainingBushels: remaining,
      progressPercent
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

  private _getLbsPerBushel(code: string): number {
    return this._lookupLbsPerBushel(code);
  }

  private _lookupLbsPerBushel(productCode: string): number {
    const code = (productCode || '').trim().toUpperCase();
    if (!code) return 56;

    const conversions = this.appState.commodityConversions();
    if (conversions.length > 0) {
      if (!this._conversionMap || this._conversionMap.size !== conversions.length) {
        this._conversionMap = new Map(conversions.map(c => [c.commodityCode.trim().toUpperCase(), c.lbsPerUnit]));
      }
      const lbs = this._conversionMap.get(code);
      if (lbs && lbs > 0) return lbs;
    }

    // Fallback
    if (code.includes('CORN') || code.includes('YC'))                              return 56;
    if (code.includes('SOY') || code.includes('BEAN') || code.includes('SB'))      return 60;
    if (code.includes('WHEAT') || code.includes('HRW') || code.includes('HRS') ||
        code.includes('HWS') || code.includes('SRW') || code.includes('WW'))       return 60;
    if (code.includes('SORGHUM') || code.includes('MILO') || code.includes('SOR') || code.includes('SG'))  return 56;
    if (code.includes('BARLEY'))                                                    return 48;
    if (code.includes('OAT'))                                                       return 32;
    if (code.includes('RYE'))                                                       return 56;
    return 56;
  }

  toBushels(lbs: number | null | undefined, productCode: string | undefined | null): number {
    return (lbs || 0) / this._lookupLbsPerBushel(productCode || '');
  }

  getAppliedTickets(contract: Contract): Ticket[] {
    // Only consider tickets that are actually applied (contract prefix type 'P' or 'S' in ctrmContractNumber)
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

    // If delivery is complete, always show Fulfilled (overrides everything)
    // Check both percentage and remaining quantity to handle rounding edge cases
    if (stats.progressPercent >= 100 || stats.remainingBushels <= 0) {
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
    if (contract.customerConfirmStatus && contract.customerConfirmStatus !== 'Confirmed') return '!bg-amber-100 dark:!bg-amber-500/15';
    const status = this.getCalculatedStatus(contract);
    if (status === 'Past Due') return '!bg-red-100 dark:!bg-red-500/15';
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
