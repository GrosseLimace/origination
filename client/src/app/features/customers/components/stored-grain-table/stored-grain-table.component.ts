import { Component, input, computed, signal, effect, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { Customer, StoredGrain } from '@models';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { expandCommodityAliases } from '@shared/utils/commodity-aliases';
import { compareNumericStrings } from '@shared/utils/ticket-sort';

export type StorageGroupMode = 'both' | 'crop' | 'location';

export interface CommodityGroup {
  key: string;       // unique group key (drives expand/collapse); depends on the group mode
  crop: string;      // commodity label (shown in crop / both modes)
  location: string;  // location label (shown in location / both modes), e.g. "PRATT, KS" or "No location"
  receipts: StoredGrain[];
  totalBushels: number;
  totalCost: number;
  earliestDate: Date;
}

@Component({
  selector: 'app-stored-grain-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent],
  templateUrl: './stored-grain-table.component.html'
})
export class StoredGrainTableComponent {
  private readonly usageTracking = inject(UsageTrackingService);
  public isLoading = input(false);
  public storedGrain = input<StoredGrain[]>([]);
  public customer = input.required<Customer>();

  searchQuery = signal('');
  expandedCommodities = signal(new Set<string>());

  /** Collapsible "Filter" bar + group-by mode, mirroring the Unapplied Tickets table.
   *  Default 'crop' preserves the historical storage grouping; users can switch to Location or both. */
  summaryExpanded = signal(false);
  groupMode = signal<StorageGroupMode>('crop');

  currentSortColumn: string | null = null;
  currentSortDirection: 'none' | 'asc' | 'desc' = 'none';

  // Commodity aliases are centralized in @shared/utils/commodity-aliases.ts

  constructor() {
    // Auto-expand the single commodity group so the user doesn't have to click
    // to open it. With multiple groups, start collapsed so the summary is visible.
    // Re-runs on a group-mode change too, since the group keys change with the mode.
    effect(() => {
      const groups = this.allCommodityGroups();
      this.expandedCommodities.set(
        groups.length === 1 ? new Set([groups[0].key]) : new Set()
      );
    });
    // A new set of receipts (another producer) drops the previous search; a group-mode change keeps it.
    effect(() => {
      this.storedGrain();
      this.searchQuery.set('');
    });
  }

  private readonly grainById = computed(() =>
    new Map(this.storedGrain().map(g => [g.id, g]))
  );

  /** Display label for a receipt's location (elevator city/state), or "No location" when unresolved. */
  private _grainLocation(g: StoredGrain): string {
    const city = g.locationCity?.trim();
    const state = g.locationState?.trim();
    if (city && state) return `${city}, ${state}`;
    return city || state || 'No location';
  }

  private readonly allCommodityGroups = computed<CommodityGroup[]>(() => {
    const mode = this.groupMode();
    const groupMap = new Map<string, CommodityGroup>();

    for (const grain of this.storedGrain()) {
      const crop = grain.crop || 'Unknown';
      const location = this._grainLocation(grain);
      const key = mode === 'crop' ? crop : mode === 'location' ? location : `${crop}|${location}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          crop,
          location,
          receipts: [],
          totalBushels: 0,
          totalCost: 0,
          earliestDate: new Date(grain.storageStartDate)
        });
      }
      const group = groupMap.get(key)!;
      group.receipts.push(grain);
      group.totalBushels += grain.quantity;
      group.totalCost += grain.receivableAmount;
      const rowDate = new Date(grain.storageStartDate);
      if (rowDate < group.earliestDate) group.earliestDate = rowDate;
    }

    // Order by what the header shows: location alone in Location mode, else crop then location.
    return Array.from(groupMap.values())
      .sort((a, b) => mode === 'location'
        ? a.location.localeCompare(b.location)
        : a.crop.localeCompare(b.crop) || a.location.localeCompare(b.location));
  });

  readonly commodityGroups = computed<CommodityGroup[]>(() => {
    const term = this.searchQuery().trim().toLowerCase();
    if (!term) return this.allCommodityGroups();

    // Expand search term through commodity aliases (e.g., "milo" → also matches "sorghum")
    const searchTerms = expandCommodityAliases(term);

    // Filter at the receipt level (works for every group mode): match commodity alias, ticket #,
    // date, or facility location (city/state), then rebuild the group from the matched receipts.
    const result: CommodityGroup[] = [];
    for (const group of this.allCommodityGroups()) {
      const matchedReceipts = group.receipts.filter(r =>
        searchTerms.some(t => (r.crop || '').toLowerCase().includes(t)) ||
        r.receiptNumber.toLowerCase().includes(term) ||
        this._formatDate(r.storageStartDate).includes(term) ||
        (r.locationCity?.toLowerCase().includes(term) ?? false) ||
        (r.locationState?.toLowerCase().includes(term) ?? false)
      );
      if (matchedReceipts.length > 0) {
        result.push({
          ...group,
          receipts: matchedReceipts,
          totalBushels: matchedReceipts.reduce((s, r) => s + r.quantity, 0),
          totalCost: matchedReceipts.reduce((s, r) => s + r.receivableAmount, 0),
          earliestDate: matchedReceipts.reduce((min, r) => {
            const d = new Date(r.storageStartDate);
            return d < min ? d : min;
          }, new Date(matchedReceipts[0].storageStartDate))
        });
      }
    }
    return result;
  });

  setGroupMode(mode: StorageGroupMode): void {
    this.groupMode.set(mode);
  }

  private _formatDate(d: Date | string): string {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }

  getCost(grainId: string): number {
    return this.grainById().get(grainId)?.receivableAmount ?? 0;
  }

  toggleCommodity(key: string, event: MouseEvent): void {
    const isOpening = !this.expandedCommodities().has(key);
    this.expandedCommodities.update(set => {
      const next = new Set(set);
      isOpening ? next.add(key) : next.delete(key);
      return next;
    });
    if (isOpening) {
      this.usageTracking.trackStorageDropdownOpen();
      // Capture currentTarget synchronously — it becomes null after event dispatch completes
      const header = event.currentTarget as HTMLElement;
      setTimeout(() => {
        const row = header.parentElement; // .border container
        row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }

  isExpanded(key: string): boolean {
    return this.expandedCommodities().has(key);
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

  /** Charged-from date value for default ordering, falling back to the storage-start date when
   *  a receipt has no charged-from window yet. Missing dates sort first (0). */
  private _chargedDateValue(g: StoredGrain): number {
    const d = g.chargedFromDate ?? g.storageStartDate;
    return d ? new Date(d).getTime() : 0;
  }

  sortedReceipts(receipts: StoredGrain[]): StoredGrain[] {
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      // Default: Charged From date ascending, then smallest → largest ticket # within a date.
      return [...receipts].sort((a, b) =>
        (this._chargedDateValue(a) - this._chargedDateValue(b)) ||
        compareNumericStrings(a.receiptNumber, b.receiptNumber));
    }
    const sorted = [...receipts].sort((a, b) => {
      let cmp = 0;
      switch (this.currentSortColumn) {
        case 'ticket': cmp = compareNumericStrings(a.receiptNumber, b.receiptNumber); break;
        case 'commodity': cmp = (a.crop || '').localeCompare(b.crop || ''); break;
        case 'netBu': cmp = (a.quantity || 0) - (b.quantity || 0); break;
        case 'charged': cmp = (new Date(a.chargedFromDate || 0).getTime() - new Date(b.chargedFromDate || 0).getTime()) || compareNumericStrings(a.receiptNumber, b.receiptNumber); break;
        case 'storageDays': cmp = (a.storageDays || 0) - (b.storageDays || 0); break;
        case 'rate': cmp = (a.storageRate || 0) - (b.storageRate || 0); break;
        case 'amount': cmp = (a.receivableAmount || 0) - (b.receivableAmount || 0); break;
      }
      return cmp;
    });
    return this.currentSortDirection === 'desc' ? sorted.reverse() : sorted;
  }
}
