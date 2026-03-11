import { Component, input, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { Customer, StoredGrain } from '@models';

type SortColumn = 'crop' | 'quantity' | 'bin' | 'storageRate' | 'startDate' | 'accumulatedCost';
type SortDirection = 'none' | 'asc' | 'desc';

@Component({
  selector: 'app-stored-grain-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    TableComponent,
    TableHeaderComponent,
    TableBodyComponent,
    TableRowComponent,
    TableHeadComponent,
    TableCellComponent
  ],
  templateUrl: './stored-grain-table.component.html'
})
export class StoredGrainTableComponent {
  public storedGrain = input<StoredGrain[]>([]);
  public customer = input.required<Customer>();

  expandedRows = new Set<string>();
  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';
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

  get sortedGrain(): StoredGrain[] {
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      return this.storedGrain();
    }

    const sorted = [...this.storedGrain()].sort((a, b) => {
      let comparison = 0;
      switch (this.currentSortColumn) {
        case 'crop':
          comparison = a.crop.localeCompare(b.crop);
          break;
        case 'quantity':
          comparison = a.quantity - b.quantity;
          break;
        case 'bin':
          comparison = a.bin.localeCompare(b.bin);
          break;
        case 'storageRate':
          comparison = a.storageRate - b.storageRate;
          break;
        case 'startDate':
          comparison = new Date(a.storageStartDate).getTime() - new Date(b.storageStartDate).getTime();
          break;
        case 'accumulatedCost':
          comparison = (this.storageCostCache.get(a.id)?.totalCost ?? 0) - (this.storageCostCache.get(b.id)?.totalCost ?? 0);
          break;
      }
      return this.currentSortDirection === 'desc' ? -comparison : comparison;
    });

    return sorted;
  }

  handleSort(column: SortColumn): void {
    if (this.currentSortColumn === column) {
      if (this.currentSortDirection === 'none') {
        this.currentSortDirection = 'asc';
      } else if (this.currentSortDirection === 'asc') {
        this.currentSortDirection = 'desc';
      } else {
        this.currentSortDirection = 'none';
        this.currentSortColumn = null;
      }
    } else {
      this.currentSortColumn = column;
      this.currentSortDirection = 'asc';
    }
  }

  toggleRow(id: string): void {
    if (this.expandedRows.has(id)) {
      this.expandedRows.delete(id);
    } else {
      this.expandedRows.add(id);
    }
  }

  isExpanded(id: string): boolean {
    return this.expandedRows.has(id);
  }
}
