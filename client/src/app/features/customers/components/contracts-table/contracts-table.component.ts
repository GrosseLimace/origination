import { Component, input, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { Customer, Contract, Ticket, ContractPricingLine } from '@models';

type SortColumn = 'contractNumber' | 'crop' | 'quantity' | 'price' | 'deliveryStart' | 'status';
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
  public contracts = input<Contract[]>([]);
  public tickets = input<Ticket[]>([]);
  public pricingLines = input<ContractPricingLine[]>([]);
  public customer = input.required<Customer>();
  public openContractId = input<number | null>(null);

  expandedRows = new Set<number>();
  expandedTicketSections = new Set<number>();
  pricingLinesMap = new Map<string, ContractPricingLine[]>();
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
      this.pricingLinesMap.clear();
      // Apply openContractId after clearing expandedRows so it always wins
      const openId = this.openContractId();
      if (openId != null) {
        this.expandedRows.add(openId);
      }
    });

    effect(() => {
      // React to pricingLines changing
      const lines = this.pricingLines();
      this.pricingLinesMap.clear();
      for (const line of lines) {
        if (!line.contractId) continue;
        const key = line.contractId;
        if (!this.pricingLinesMap.has(key)) this.pricingLinesMap.set(key, []);
        this.pricingLinesMap.get(key)!.push(line);
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
      const deliveryPeriod = this._formatDeliveryPeriod(c);
      return terms.some(term =>
        c.contractNumber.toLowerCase().includes(term) ||
        (c.commodityDescription || '').toLowerCase().includes(term) ||
        (c.commodityCode || '').toLowerCase().includes(term) ||
        (c.commodityGroup || '').toLowerCase().includes(term) ||
        this.getCalculatedStatus(c).toLowerCase().includes(term) ||
        deliveryPeriod.toLowerCase().includes(term)
      );
    });
  }

  private _formatDeliveryPeriod(contract: Contract): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const start = new Date(contract.deliveryStart);
    const end = new Date(contract.deliveryEnd);
    return `${months[start.getMonth()]} ${start.getFullYear()} ${months[end.getMonth()]} ${end.getFullYear()}`;
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
        case 'contractNumber':
          comparison = a.contractNumber.localeCompare(b.contractNumber);
          break;
        case 'crop':
          comparison = (a.commodityDescription || '').localeCompare(b.commodityDescription || '');
          break;
        case 'quantity':
          comparison = a.quantity - b.quantity;
          break;
        case 'price':
          comparison = a.price - b.price;
          break;
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
    return 'text-gray-300 dark:text-gray-600';
  }

  toggleRow(contractId: number): void {
    if (this.expandedRows.has(contractId)) {
      this.expandedRows.delete(contractId);
      this.expandedTicketSections.delete(contractId);
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

  getSingularUnit(unit: string): string {
    return unit.endsWith('s') ? unit.slice(0, -1) : unit;
  }

  getPricingInfo(contract: Contract): { status: 'UNPRICED' | 'PARTIAL' | 'PRICED' | 'CASH' | 'LOADING'; cashPrice?: number } {
    const key = contract.sourceContractId;
    const lines = key ? this.pricingLinesMap.get(key) : undefined;

    if (lines !== undefined) {
      if (lines.length === 0) return { status: 'UNPRICED' };

      const totalPricedQty = lines.reduce((sum, l) => sum + (l.pricedQty ?? 0), 0);
      const contractQty = lines[0].priceQuantity ?? contract.quantity ?? 0;

      if (totalPricedQty === 0) return { status: 'UNPRICED' };
      if (totalPricedQty < contractQty) return { status: 'PARTIAL' };
      if (lines.length > 1) return { status: 'PRICED' };

      // Single fully-priced line — show cash price
      const cashPrice = lines[0].cashPrice;
      if (cashPrice != null) return { status: 'CASH', cashPrice };
      return { status: 'PRICED' };
    }

    // Fallback: use contract fields before lines are loaded
    const pricedQty = contract.pricedQuantity ?? 0;
    const totalQty = contract.quantity ?? 0;

    if (pricedQty === 0) return { status: 'UNPRICED' };
    if (pricedQty < totalQty) return { status: 'PARTIAL' };
    if (contract.price != null) return { status: 'CASH', cashPrice: contract.price };
    return { status: 'PRICED' };
  }

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

  private _getLbsPerBushel(commodity: string): number {
    const commodityUpper = commodity.toUpperCase();
    if (commodityUpper.includes('CORN')) return 56;
    if (commodityUpper.includes('SOYBEAN') || commodityUpper.includes('SOY')) return 60;
    if (commodityUpper.includes('WHEAT')) return 60;
    return 56;
  }

  getAppliedTickets(contract: Contract): Ticket[] {
    // Only consider tickets that are actually applied (TicketType P or S)
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
      return 'Fulfilled';
    }

    // Check for cancelled status from API
    if (contract.status === 'Cancelled') {
      return 'Cancelled';
    }

    // Check if contract is overdue (past end date and not fulfilled)
    if (now > endDate) {
      return 'Overdue';
    }

    // Check if contract has reached its start date
    if (now >= startDate) {
      return 'Active';
    }

    // Before start date
    return 'Pending';
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Active':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-scoular-green-accessible text-white';
      case 'Fulfilled':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-scoular-blue text-white';
      case 'Pending':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-500 text-white';
      case 'Overdue':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-scoular-red-accessible text-white';
      case 'Cancelled':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-500 text-white';
      default:
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-500 text-white';
    }
  }
}
