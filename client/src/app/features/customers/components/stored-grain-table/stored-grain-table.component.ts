import { Component, input, computed, signal, ChangeDetectionStrategy } from '@angular/core';
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

  private readonly costCache = computed(() => {
    const cache = new Map<string, { totalCost: number; monthsStored: number }>();
    const now = new Date();
    for (const grain of this.storedGrain()) {
      const start = new Date(grain.storageStartDate);
      const monthsStored = (now.getFullYear() - start.getFullYear()) * 12
                         + (now.getMonth() - start.getMonth())
                         + (now.getDate() / 30);
      cache.set(grain.id, { totalCost: monthsStored * grain.storageRate * grain.quantity, monthsStored });
    }
    return cache;
  });

  private readonly allCommodityGroups = computed<CommodityGroup[]>(() => {
    const cache = this.costCache();
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
      group.totalCost += cache.get(grain.id)?.totalCost ?? 0;
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
        const cache = this.costCache();
        result.push({
          ...group,
          receipts: matchedReceipts,
          totalBushels: matchedReceipts.reduce((s, r) => s + r.quantity, 0),
          totalCost: matchedReceipts.reduce((s, r) => s + (cache.get(r.id)?.totalCost ?? 0), 0)
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
    return this.costCache().get(grainId)?.totalCost ?? 0;
  }

  getMonths(grainId: string): number {
    return this.costCache().get(grainId)?.monthsStored ?? 0;
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
