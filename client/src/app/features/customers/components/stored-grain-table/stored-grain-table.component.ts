import { Component, input, computed, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Customer, StoredGrain } from '@models';

export interface CommodityGroup {
  crop: string;
  receipts: StoredGrain[];
  totalBushels: number;
  totalCost: number;
  earliestDate: Date;
}

@Component({
  selector: 'app-stored-grain-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './stored-grain-table.component.html'
})
export class StoredGrainTableComponent {
  public isLoading = input(false);
  public storedGrain = input<StoredGrain[]>([]);
  public customer = input.required<Customer>();

  showSearch = signal(false);
  searchQuery = signal('');
  expandedCommodities = signal(new Set<string>());

  constructor() {
    // Auto-expand the single commodity group so the user doesn't have to click
    // to open it. With multiple groups, start collapsed so the summary is visible.
    effect(() => {
      const groups = this.allCommodityGroups();
      this.expandedCommodities.set(
        groups.length === 1 ? new Set([groups[0].crop]) : new Set()
      );
    });
  }

  private readonly grainById = computed(() =>
    new Map(this.storedGrain().map(g => [g.id, g]))
  );

  private readonly allCommodityGroups = computed<CommodityGroup[]>(() => {
    const groupMap = new Map<string, CommodityGroup>();

    for (const grain of this.storedGrain()) {
      const key = grain.crop || 'Unknown';
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          crop: key,
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

    return Array.from(groupMap.values()).sort((a, b) => a.crop.localeCompare(b.crop));
  });

  readonly commodityGroups = computed<CommodityGroup[]>(() => {
    const term = this.searchQuery().trim().toLowerCase();
    if (!term) return this.allCommodityGroups();

    const result: CommodityGroup[] = [];
    for (const group of this.allCommodityGroups()) {
      // Commodity name matches
      if (group.crop.toLowerCase().includes(term)) {
        result.push(group);
        continue;
      }
      // Filter to receipts matching ticket # or date
      const matchedReceipts = group.receipts.filter(r =>
        r.receiptNumber.toLowerCase().includes(term) ||
        this._formatDate(r.storageStartDate).includes(term)
      );
      if (matchedReceipts.length > 0) {
        result.push({
          ...group,
          receipts: matchedReceipts,
          totalBushels: matchedReceipts.reduce((s, r) => s + r.quantity, 0),
          totalCost: matchedReceipts.reduce((s, r) => s + r.receivableAmount, 0)
        });
      }
    }
    return result;
  });

  readonly totalStorageCost = computed(() =>
    this.allCommodityGroups().reduce((sum, g) => sum + g.totalCost, 0)
  );

  private _formatDate(d: Date | string): string {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }

  getCost(grainId: string): number {
    return this.grainById().get(grainId)?.receivableAmount ?? 0;
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.showSearch.set(false);
  }

  toggleCommodity(crop: string, event: MouseEvent): void {
    const isOpening = !this.expandedCommodities().has(crop);
    this.expandedCommodities.update(set => {
      const next = new Set(set);
      isOpening ? next.add(crop) : next.delete(crop);
      return next;
    });
    if (isOpening) {
      // Capture currentTarget synchronously — it becomes null after event dispatch completes
      const header = event.currentTarget as HTMLElement;
      setTimeout(() => {
        const row = header.parentElement; // .border container
        row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }

  isExpanded(crop: string): boolean {
    return this.expandedCommodities().has(crop);
  }
}
