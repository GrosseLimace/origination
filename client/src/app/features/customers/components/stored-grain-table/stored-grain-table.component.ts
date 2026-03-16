import { Component, input, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Customer, StoredGrain } from '@models';

export interface ReceiptGroup {
  receiptNumber: string;
  rows: StoredGrain[];
  totalQuantity: number;
  totalCost: number;
  storageStartDate: Date;
}

@Component({
  selector: 'app-stored-grain-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './stored-grain-table.component.html'
})
export class StoredGrainTableComponent {
  public isLoading = input(false);
  public storedGrain = input<StoredGrain[]>([]);
  public customer = input.required<Customer>();

  expandedReceipts = new Set<string>();
  storageCostCache = new Map<string, { totalCost: number; monthsStored: number }>();

  constructor() {
    effect(() => {
      const _grain = this.storedGrain();
      this._rebuildCache();
    });
  }

  private _rebuildCache(): void {
    this.storageCostCache.clear();
    const now = new Date();
    for (const grain of this.storedGrain()) {
      const startDate = new Date(grain.storageStartDate);
      const monthsStored = (now.getFullYear() - startDate.getFullYear()) * 12
                         + (now.getMonth() - startDate.getMonth())
                         + (now.getDate() / 30);
      const totalCost = monthsStored * grain.storageRate * grain.quantity;
      this.storageCostCache.set(grain.id, { totalCost, monthsStored });
    }
  }

  get totalStorageCost(): number {
    let sum = 0;
    for (const val of this.storageCostCache.values()) sum += val.totalCost;
    return sum;
  }

  get receiptGroups(): ReceiptGroup[] {
    const groupMap = new Map<string, ReceiptGroup>();
    for (const grain of this.storedGrain()) {
      const key = grain.receiptNumber || grain.id.split('|')[0];
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          receiptNumber: key,
          rows: [],
          totalQuantity: 0,
          totalCost: 0,
          storageStartDate: new Date(grain.storageStartDate)
        });
      }
      const group = groupMap.get(key)!;
      group.rows.push(grain);
      group.totalQuantity += grain.quantity;
      group.totalCost += this.storageCostCache.get(grain.id)?.totalCost ?? 0;
      // Use the earliest start date as the group date
      const rowDate = new Date(grain.storageStartDate);
      if (rowDate < group.storageStartDate) group.storageStartDate = rowDate;
    }
    return Array.from(groupMap.values())
      .sort((a, b) => a.receiptNumber.localeCompare(b.receiptNumber));
  }

  toggleReceipt(receiptNumber: string): void {
    if (this.expandedReceipts.has(receiptNumber)) {
      this.expandedReceipts.delete(receiptNumber);
    } else {
      this.expandedReceipts.add(receiptNumber);
    }
  }

  isReceiptExpanded(receiptNumber: string): boolean {
    return this.expandedReceipts.has(receiptNumber);
  }
}
