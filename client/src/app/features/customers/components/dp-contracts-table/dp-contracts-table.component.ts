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

export interface DpContractGroup {
  key: string;       // unique group key (drives expand/collapse); depends on the group mode
  crop: string;      // commodity label (shown in crop / both modes)
  location: string;  // location label (shown in location / both modes), e.g. "Adrian, MO" or "No location"
  /** Every charge-type row in this group — one delivery can contribute several. */
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

/**
 * DP (delayed-pricing) contract positions for one producer, presented as the Storage tab is: an
 * accordion of commodity/location groups over a sortable per-ticket table.
 *
 * Presentational only — the producer page fetches and passes the rows in.
 *
 * The one behavioural rule that differs from Storage: `bushels` is nullable, and a null must render
 * as a dash and be excluded from group totals. It means "we could not convert the source quantity to
 * bushels", so falling back to the raw `quantity` would silently show a figure in the wrong unit.
 * Groups holding such rows disclose the count so a total is never read as complete when it isn't.
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

  /** Collapsible "Filter" bar + group-by mode, mirroring the Storage table.
   *  Default 'crop' matches how originators think about DP positions. */
  summaryExpanded = signal(false);
  groupMode = signal<DpGroupMode>('crop');

  currentSortColumn: string | null = null;
  currentSortDirection: 'none' | 'asc' | 'desc' = 'none';

  constructor() {
    // Auto-expand the single group so the user doesn't have to click to open it. With multiple
    // groups, start collapsed so the summary is visible.
    effect(() => {
      const groups = this.allGroups();
      this.expandedGroups.set(
        groups.length === 1 ? new Set([groups[0].key]) : new Set()
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
    const groupMap = new Map<string, DpContractGroup>();

    for (const dp of this.dpContracts()) {
      const crop = dp.crop || 'Unknown';
      const location = this._location(dp);
      const key = mode === 'crop' ? crop : mode === 'location' ? location : `${crop}|${location}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          crop,
          location,
          positions: [],
          deliveryCount: 0,
          totalBushels: 0,
          unconvertedCount: 0,
          totalCost: 0,
          earliestDate: this._startDate(dp) ?? new Date()
        });
      }
      const group = groupMap.get(key)!;
      group.positions.push(dp);
      const rowDate = this._startDate(dp);
      if (rowDate && rowDate < group.earliestDate) group.earliestDate = rowDate;
    }

    // Totals are computed AFTER grouping, not accumulated per row: bushels must be counted once per
    // physical delivery (a delivery contributes one row per charge type, each repeating the same
    // quantity), while charges are additive across those rows.
    for (const group of groupMap.values()) this._applyTotals(group);

    return Array.from(groupMap.values())
      .sort((a, b) => a.crop.localeCompare(b.crop) || a.location.localeCompare(b.location));
  });

  /** Recomputes a group's totals from its current `positions`. */
  private _applyTotals(group: DpContractGroup): void {
    group.deliveryCount = dpDeliveryCount(group.positions);
    group.totalBushels = dpTotalBushels(group.positions);
    group.unconvertedCount = dpUnconvertedCount(group.positions);
    group.totalCost = dpTotalCharges(group.positions);
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
        const narrowed: DpContractGroup = { ...group, positions: matched };
        this._applyTotals(narrowed);
        result.push(narrowed);
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
    return this.expandedGroups().has(key);
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

  sortedPositions(positions: DpContract[]): DpContract[] {
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      // Default: Charged From date ascending, then smallest → largest ticket # within a date.
      return [...positions].sort((a, b) =>
        (this._chargedDateValue(a) - this._chargedDateValue(b)) ||
        compareNumericStrings(a.ticketNumber, b.ticketNumber));
    }
    const sorted = [...positions].sort((a, b) => {
      let cmp = 0;
      switch (this.currentSortColumn) {
        case 'ticket': cmp = compareNumericStrings(a.ticketNumber, b.ticketNumber); break;
        case 'commodity': cmp = (a.crop || '').localeCompare(b.crop || ''); break;
        // Unconvertible rows have no bushel figure — sort them below every real number rather than
        // treating them as zero, which would mix them in with genuinely small positions.
        case 'netBu': cmp = (a.bushels ?? -1) - (b.bushels ?? -1); break;
        case 'charged': cmp = (this._chargedDateValue(a) - this._chargedDateValue(b)) || compareNumericStrings(a.ticketNumber, b.ticketNumber); break;
        case 'storageDays': cmp = (a.storageDays || 0) - (b.storageDays || 0); break;
        case 'rate': cmp = (a.storageRate || 0) - (b.storageRate || 0); break;
        case 'amount': cmp = (a.receivableAmount || 0) - (b.receivableAmount || 0); break;
      }
      return cmp;
    });
    return this.currentSortDirection === 'desc' ? sorted.reverse() : sorted;
  }
}
