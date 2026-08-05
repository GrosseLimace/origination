import { Component, input, computed, signal, effect, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { Customer, DpContract } from '@models';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { expandCommodityAliases } from '@shared/utils/commodity-aliases';
import { compareNumericStrings } from '@shared/utils/ticket-sort';
import { dpDeliveryCount, dpTotalBushels, dpUnconvertedCount, dpTotalCharges } from '@shared/utils/dp-aggregate';

export type DpGroupMode = 'both' | 'crop' | 'location';

/** Totals shared by both accordion levels. Bushels are per-delivery; charges are per-row. */
interface DpTotals {
  /** Every charge-type row at this level — one delivery contributes several. */
  positions: DpContract[];
  /** Distinct physical deliveries. NOT positions.length, which counts charge rows. */
  deliveryCount: number;
  /** Bushels counted ONCE per delivery (charge rows repeat the same quantity). */
  totalBushels: number;
  /** Deliveries whose quantity couldn't be converted to bushels, so they're absent from totalBushels. */
  unconvertedCount: number;
  /** Charges summed across ALL rows — charge types are additive. */
  totalCost: number;
  earliestDate: Date;
}

/** Second accordion level: one DP contract, holding the tickets applied to it. */
export interface DpContractSubgroup extends DpTotals {
  key: string;            // unique across the whole table: group key + contract number
  contractNumber: string; // e.g. "PL84649-A"; "No contract" when the row carries none
}

/** First accordion level: a commodity, a location, or both, depending on the group mode. */
export interface DpContractGroup extends DpTotals {
  key: string;       // unique group key (drives expand/collapse); depends on the group mode
  crop: string;      // commodity label (shown in crop / both modes)
  location: string;  // location label (shown in location / both modes), e.g. "Adrian, MO" or "No location"
  /** The contracts inside this group — the tickets hang off these, not off the group. */
  contracts: DpContractSubgroup[];
  contractCount: number;
}

/**
 * DP (delayed-pricing) contract positions for one producer. Structured as a two-level accordion:
 *
 *   commodity (or location, or both)  →  DP contract  →  tickets  →  charge rows
 *
 * The contract level exists because several tickets are typically applied to one DP contract, and
 * originators think in terms of the contract. Where a group holds only ONE contract that contract is
 * auto-expanded, so the extra level never costs a click it doesn't earn.
 *
 * Presentational only — the producer page fetches and passes the rows in.
 *
 * The one behavioural rule that differs from Storage: `bushels` is nullable, and a null must render
 * as a dash and be excluded from totals. It means "we could not convert the source quantity to
 * bushels", so falling back to the raw `quantity` would silently show a figure in the wrong unit.
 * Levels holding such rows disclose the count so a total is never read as complete when it isn't.
 */
@Component({
  selector: 'app-dp-contracts-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent],
  templateUrl: './dp-contracts-table.component.html'
})
export class DpContractsTableComponent {
  private readonly usageTracking = inject(UsageTrackingService);
  public isLoading = input(false);
  public dpContracts = input<DpContract[]>([]);
  public customer = input.required<Customer>();

  searchQuery = signal('');
  expandedGroups = signal(new Set<string>());
  /** Expanded contract keys (second accordion level), independent of the group level. */
  expandedContracts = signal(new Set<string>());

  /** Collapsible "Filter" bar + group-by mode, mirroring the Storage table.
   *  Default 'crop' matches how originators think about DP positions. */
  summaryExpanded = signal(false);
  groupMode = signal<DpGroupMode>('crop');

  currentSortColumn: string | null = null;
  currentSortDirection: 'none' | 'asc' | 'desc' = 'none';

  constructor() {
    // Auto-expand the single group so the user doesn't have to click to open it. With multiple
    // groups, start collapsed so the summary is visible.
    //
    // Contracts follow the same principle one level down: a group holding exactly ONE contract has
    // that contract opened automatically, so the contract level never costs a click to reveal a
    // single child. Groups with several contracts start collapsed so the comparison is visible.
    effect(() => {
      const groups = this.allGroups();
      this.expandedGroups.set(
        groups.length === 1 ? new Set([groups[0].key]) : new Set()
      );
      this.expandedContracts.set(
        new Set(groups.filter(g => g.contracts.length === 1).map(g => g.contracts[0].key))
      );
      this.searchQuery.set('');
    });
  }

  /** Display label for a position's location, or "No location" when the trade unit is unmapped. */
  private _location(d: DpContract): string {
    return d.locationName?.trim() || 'No location';
  }

  /** Date a position is anchored to for "since" display and default ordering. */
  private _startDate(d: DpContract): Date | null {
    const raw = d.chargedFromDate ?? d.storageStartDate;
    return raw ? new Date(raw) : null;
  }

  private readonly allGroups = computed<DpContractGroup[]>(() => {
    const mode = this.groupMode();
    const rowsByGroup = new Map<string, { crop: string; location: string; rows: DpContract[] }>();

    for (const dp of this.dpContracts()) {
      const crop = dp.crop || 'Unknown';
      const location = this._location(dp);
      const key = mode === 'crop' ? crop : mode === 'location' ? location : `${crop}|${location}`;
      const bucket = rowsByGroup.get(key);
      if (bucket) bucket.rows.push(dp);
      else rowsByGroup.set(key, { crop, location, rows: [dp] });
    }

    return [...rowsByGroup.entries()]
      .map(([key, b]) => this._buildGroup(key, b.crop, b.location, b.rows))
      .sort((a, b) => a.crop.localeCompare(b.crop) || a.location.localeCompare(b.location));
  });

  /**
   * Builds one group and its nested contracts from a set of rows. Used for both the unfiltered
   * grouping and the search-narrowed rebuild, so the two can't compute totals differently.
   *
   * Totals are derived from the row set rather than accumulated during grouping: bushels must be
   * counted once per physical delivery (a delivery contributes one row per charge type, each
   * repeating the same quantity), while charges are additive across those rows.
   */
  private _buildGroup(key: string, crop: string, location: string, rows: DpContract[]): DpContractGroup {
    const rowsByContract = new Map<string, DpContract[]>();
    for (const dp of rows) {
      const contract = dp.contractNumber?.trim() || 'No contract';
      const list = rowsByContract.get(contract);
      if (list) list.push(dp); else rowsByContract.set(contract, [dp]);
    }

    // Oldest contract first, by the same "Since" date shown on the row, so the longest-standing DP
    // position leads. Contract number only breaks ties on identical dates.
    const contracts: DpContractSubgroup[] = [...rowsByContract.entries()]
      .map(([contractNumber, contractRows]) => ({
        key: `${key}||${contractNumber}`,
        contractNumber,
        ...this._totals(contractRows),
      }))
      .sort((a, b) =>
        (a.earliestDate.getTime() - b.earliestDate.getTime()) ||
        compareNumericStrings(a.contractNumber, b.contractNumber));

    return { key, crop, location, contracts, contractCount: contracts.length, ...this._totals(rows) };
  }

  /** Totals for one row set — shared by the group and contract levels. */
  private _totals(rows: DpContract[]): DpTotals {
    const dates = rows.map(r => this._startDate(r)).filter((d): d is Date => d !== null);
    return {
      positions: rows,
      deliveryCount: dpDeliveryCount(rows),
      totalBushels: dpTotalBushels(rows),
      unconvertedCount: dpUnconvertedCount(rows),
      totalCost: dpTotalCharges(rows),
      earliestDate: dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date(),
    };
  }

  readonly groups = computed<DpContractGroup[]>(() => {
    const term = this.searchQuery().trim().toLowerCase();
    if (!term) return this.allGroups();

    // Expand search term through commodity aliases (e.g., "milo" → also matches "sorghum")
    const searchTerms = expandCommodityAliases(term);

    // Filter at the position level (works for every group mode): match commodity alias, ticket #,
    // contract #, date, or location, then rebuild the group from the matched positions.
    const result: DpContractGroup[] = [];
    for (const group of this.allGroups()) {
      const matched = group.positions.filter(d =>
        searchTerms.some(t => (d.crop || '').toLowerCase().includes(t)) ||
        d.ticketNumber.toLowerCase().includes(term) ||
        (d.contractNumber || '').toLowerCase().includes(term) ||
        this._formatDate(d.chargedFromDate ?? d.storageStartDate).includes(term) ||
        (d.locationName?.toLowerCase().includes(term) ?? false)
      );
      if (matched.length > 0) {
        // Rebuild through the same path as the unfiltered grouping so contracts and totals narrow
        // together — a contract whose every ticket was filtered out disappears with them.
        result.push(this._buildGroup(group.key, group.crop, group.location, matched));
      }
    }
    return result;
  });

  setGroupMode(mode: DpGroupMode): void {
    this.groupMode.set(mode);
  }

  private _formatDate(d: Date | string | null): string {
    if (!d) return '';
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  toggleGroup(key: string, event: MouseEvent): void {
    const isOpening = !this.expandedGroups().has(key);
    this.expandedGroups.update(set => {
      const next = new Set(set);
      isOpening ? next.add(key) : next.delete(key);
      return next;
    });
    if (isOpening) {
      this.usageTracking.trackDpContractsDropdownOpen();
      // Capture currentTarget synchronously — it becomes null after event dispatch completes
      const header = event.currentTarget as HTMLElement;
      setTimeout(() => {
        const row = header.parentElement; // .border container
        row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }

  isExpanded(key: string): boolean {
    // An active search reveals its matches. Without this, searching a producer whose groups are
    // collapsed returns the right rows but leaves them hidden behind a closed header, so the search
    // looks broken. Only groups that actually matched are in `groups()` by this point.
    if (this.searchQuery().trim()) return true;
    return this.expandedGroups().has(key);
  }

  /** Opens/closes one contract inside a group, scrolling it into view on open. */
  toggleContract(key: string, event: MouseEvent): void {
    event.stopPropagation(); // don't collapse the parent group
    const isOpening = !this.expandedContracts().has(key);
    this.expandedContracts.update(set => {
      const next = new Set(set);
      isOpening ? next.add(key) : next.delete(key);
      return next;
    });
    if (isOpening) {
      // Capture currentTarget synchronously — it becomes null after event dispatch completes.
      const header = event.currentTarget as HTMLElement;
      setTimeout(() => {
        // The contract's wrapper, so the header stays visible above its newly revealed tickets.
        const row = header.parentElement;
        row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }

  isContractExpanded(key: string): boolean {
    // Same reasoning as isExpanded — a search shouldn't leave its matches behind a collapsed row.
    if (this.searchQuery().trim()) return true;
    return this.expandedContracts().has(key);
  }

  handleSort(column: string): void {
    if (this.currentSortColumn === column) {
      if (this.currentSortDirection === 'asc') this.currentSortDirection = 'desc';
      else if (this.currentSortDirection === 'desc') { this.currentSortColumn = null; this.currentSortDirection = 'none'; }
      else this.currentSortDirection = 'asc';
    } else {
      this.currentSortColumn = column;
      this.currentSortDirection = 'asc';
    }
  }

  getSortIconClass(column: string): string {
    return this.currentSortColumn === column ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600';
  }

  /** Charged-from date value for default ordering, falling back to the storage-start date when a
   *  position has no charged-from window yet. Missing dates sort first (0). */
  private _chargedDateValue(d: DpContract): number {
    const raw = d.chargedFromDate ?? d.storageStartDate;
    return raw ? new Date(raw).getTime() : 0;
  }

  /**
   * Orders rows so a ticket's charge lines always sit together, initial charge first.
   *
   * Sorting the flat row list can't do this: the initial charge is dated Aug–Dec while the accruing
   * storage rate is dated Jan–now, so ordering by charged-from date lists EVERY initial charge and
   * then every storage charge, splitting each ticket in half. Instead we sort at the TICKET level and
   * keep each ticket's rows as an adjacent block.
   *
   * Within a ticket, rows are ordered by charged-from date, which puts the initial charge before the
   * accrued one without hard-coding CTRM status codes.
   */
  sortedPositions(positions: DpContract[]): DpContract[] {
    // Group rows into their physical deliveries (a ticket), preserving encounter order.
    const byDelivery = new Map<string, DpContract[]>();
    for (const p of positions) {
      const key = p.ticketKey || p.id;
      const rows = byDelivery.get(key);
      if (rows) rows.push(p); else byDelivery.set(key, [p]);
    }

    // Initial charge (earlier window) above the accrued charge, always — including in desc, where
    // only the ticket ORDER flips, never the lines within a ticket.
    const deliveries = [...byDelivery.values()].map(rows =>
      [...rows].sort((a, b) => this._chargedDateValue(a) - this._chargedDateValue(b)));

    const ticketNumber = (d: DpContract[]) => d[0].ticketNumber;
    const earliestCharged = (d: DpContract[]) => Math.min(...d.map(r => this._chargedDateValue(r)));

    deliveries.sort((a, b) => {
      if (!this.currentSortColumn || this.currentSortDirection === 'none') {
        // Default: earliest charge date, then smallest → largest ticket # within a date.
        return (earliestCharged(a) - earliestCharged(b)) || compareNumericStrings(ticketNumber(a), ticketNumber(b));
      }
      switch (this.currentSortColumn) {
        case 'ticket': return compareNumericStrings(ticketNumber(a), ticketNumber(b));
        case 'commodity': return (a[0].crop || '').localeCompare(b[0].crop || '');
        // Bushels are per-delivery (every charge row repeats the same quantity). Unconvertible
        // deliveries have no figure — sort them below every real number rather than treating them as
        // zero, which would mix them in with genuinely small positions.
        case 'netBu': return (a[0].bushels ?? -1) - (b[0].bushels ?? -1);
        case 'charged': return (earliestCharged(a) - earliestCharged(b)) || compareNumericStrings(ticketNumber(a), ticketNumber(b));
        case 'storageDays': return Math.max(...a.map(r => r.storageDays || 0)) - Math.max(...b.map(r => r.storageDays || 0));
        case 'rate': return Math.max(...a.map(r => r.storageRate || 0)) - Math.max(...b.map(r => r.storageRate || 0));
        // Amount sorts on the delivery's TOTAL across charge types — what the producer actually owes
        // on that ticket — rather than on whichever single line happened to be largest.
        case 'amount': return dpTotalCharges(a) - dpTotalCharges(b);
        default: return 0;
      }
    });

    if (this.currentSortDirection === 'desc') deliveries.reverse();
    return deliveries.flat();
  }
}
