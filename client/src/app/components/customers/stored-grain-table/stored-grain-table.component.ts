import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { Customer, StoredGrain } from '../../../models';

type SortColumn = 'crop' | 'quantity' | 'bin' | 'storageRate' | 'startDate' | 'accumulatedCost';
type SortDirection = 'none' | 'asc' | 'desc';

@Component({
  selector: 'app-stored-grain-table',
  standalone: true,
  imports: [
    CommonModule,
    TableComponent,
    TableHeaderComponent,
    TableBodyComponent,
    TableRowComponent,
    TableHeadComponent,
    TableCellComponent
  ],
  template: `
    <div class="w-full space-y-4">
      @if (storedGrain.length === 0) {
        <div class="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg class="mx-auto h-12 w-12 text-gray-400 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
          </svg>
          <p class="mt-4">No grain currently in storage for this customer</p>
        </div>
      } @else {
        <!-- Total Storage Cost Banner -->
        <div class="mt-2 mb-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <p class="text-sm text-blue-600 dark:text-blue-400">Total Accumulated Storage Costs</p>
          <p class="text-2xl text-blue-700 dark:text-blue-300">\${{ totalStorageCost.toFixed(2) }}</p>
        </div>

        <!-- Mobile Card View -->
        <div class="md:hidden space-y-3">
          @for (grain of sortedGrain; track grain.id) {
            <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
              <div class="flex items-start justify-between mb-3">
                <div class="flex-1">
                  <div class="font-medium text-gray-900 dark:text-white">{{ grain.crop }}</div>
                  <div class="text-sm text-gray-500 dark:text-gray-400">{{ grain.bin }}</div>
                </div>
                <div class="text-sm font-medium text-red-600 dark:text-red-400">
                  \${{ calculateStorageCost(grain).totalCost.toFixed(2) }}
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Quantity</div>
                  <div class="text-sm text-gray-900 dark:text-white">{{ grain.quantity | number }} bu</div>
                </div>
                <div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Storage Rate</div>
                  <div class="text-sm text-gray-900 dark:text-white">\${{ grain.storageRate.toFixed(3) }}/bu/mo</div>
                </div>
                <div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Start Date</div>
                  <div class="text-sm text-gray-900 dark:text-white">{{ grain.storageStartDate | date:'MMM d, yyyy' }}</div>
                </div>
                <div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Time in Storage</div>
                  <div class="text-sm text-gray-900 dark:text-white">{{ calculateStorageCost(grain).monthsStored.toFixed(1) }} mo</div>
                </div>
              </div>
            </div>
          }
        </div>

        <!-- Desktop Table View -->
        <div class="hidden md:block">
          <app-table>
            <app-table-header>
              <app-table-row>
                <app-table-head [sortable]="true" (click)="handleSort('crop')">
                  <span class="flex items-center gap-1">
                    Crop
                    <span [innerHTML]="getSortIcon('crop')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('quantity')">
                  <span class="flex items-center gap-1">
                    Quantity (bu)
                    <span [innerHTML]="getSortIcon('quantity')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('bin')">
                  <span class="flex items-center gap-1">
                    Bin
                    <span [innerHTML]="getSortIcon('bin')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('storageRate')">
                  <span class="flex items-center gap-1">
                    Storage Rate
                    <span [innerHTML]="getSortIcon('storageRate')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('startDate')">
                  <span class="flex items-center gap-1">
                    Start Date
                    <span [innerHTML]="getSortIcon('startDate')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('accumulatedCost')">
                  <span class="flex items-center gap-1">
                    Accumulated Cost
                    <span [innerHTML]="getSortIcon('accumulatedCost')"></span>
                  </span>
                </app-table-head>
              </app-table-row>
            </app-table-header>
            <app-table-body>
              @for (grain of sortedGrain; track grain.id) {
                <app-table-row [clickable]="true" (rowClick)="toggleRow(grain.id)">
                  <app-table-cell>
                    <div class="flex items-center gap-2">
                      <span class="text-gray-400">
                        @if (isExpanded(grain.id)) {
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                          </svg>
                        } @else {
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                          </svg>
                        }
                      </span>
                      <span class="font-medium">{{ grain.crop }}</span>
                    </div>
                  </app-table-cell>
                  <app-table-cell>{{ grain.quantity | number }}</app-table-cell>
                  <app-table-cell>{{ grain.bin }}</app-table-cell>
                  <app-table-cell>\${{ grain.storageRate.toFixed(3) }}/bu/mo</app-table-cell>
                  <app-table-cell>{{ grain.storageStartDate | date:'MMM d, yyyy' }}</app-table-cell>
                  <app-table-cell class="text-red-600 dark:text-red-400 font-medium">
                    \${{ calculateStorageCost(grain).totalCost.toFixed(2) }}
                  </app-table-cell>
                </app-table-row>

                @if (isExpanded(grain.id)) {
                  <app-table-row class="bg-gray-50 dark:bg-gray-800/50">
                    <app-table-cell [colspan]="6">
                      <div class="py-4">
                        <div class="grid grid-cols-2 gap-8">
                          <!-- Left column -->
                          <div class="space-y-6">
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Storage Start Date</p>
                              <p class="text-gray-900 dark:text-gray-100">{{ grain.storageStartDate | date:'MMMM d, yyyy' }}</p>
                            </div>
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Monthly Charge</p>
                              <p class="text-gray-900 dark:text-gray-100">\${{ (grain.storageRate * grain.quantity).toFixed(2) }}</p>
                            </div>
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Storage Rate</p>
                              <p class="text-gray-900 dark:text-gray-100">\${{ grain.storageRate.toFixed(3) }} per bushel per month</p>
                            </div>
                          </div>

                          <!-- Right column -->
                          <div class="space-y-6">
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Time in Storage</p>
                              <p class="text-gray-900 dark:text-gray-100">{{ calculateStorageCost(grain).monthsStored.toFixed(1) }} months</p>
                            </div>
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Total Bushels</p>
                              <p class="text-gray-900 dark:text-gray-100">{{ grain.quantity | number }} bushels</p>
                            </div>
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Total Cost to Date</p>
                              <p class="text-red-600 dark:text-red-400 font-medium">\${{ calculateStorageCost(grain).totalCost.toFixed(2) }}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </app-table-cell>
                  </app-table-row>
                }
              }
            </app-table-body>
          </app-table>
        </div>
      }
    </div>
  `
})
export class StoredGrainTableComponent {
  @Input() storedGrain: StoredGrain[] = [];
  @Input() customer!: Customer;

  expandedRows = new Set<string>();
  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';

  get totalStorageCost(): number {
    return this.storedGrain.reduce((sum, g) => sum + this.calculateStorageCost(g).totalCost, 0);
  }

  get sortedGrain(): StoredGrain[] {
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      return this.storedGrain;
    }

    const sorted = [...this.storedGrain].sort((a, b) => {
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
          comparison = this.calculateStorageCost(a).totalCost - this.calculateStorageCost(b).totalCost;
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

  getSortIcon(column: SortColumn): string {
    if (this.currentSortColumn !== column) {
      return '<svg class="h-3 w-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>';
    }
    if (this.currentSortDirection === 'asc') {
      return '<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>';
    }
    if (this.currentSortDirection === 'desc') {
      return '<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';
    }
    return '<svg class="h-3 w-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>';
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

  calculateStorageCost(grain: StoredGrain): { totalCost: number; monthsStored: number } {
    const now = new Date();
    const startDate = new Date(grain.storageStartDate);
    const monthsStored = (now.getFullYear() - startDate.getFullYear()) * 12
                       + (now.getMonth() - startDate.getMonth())
                       + (now.getDate() / 30);
    const totalCost = monthsStored * grain.storageRate * grain.quantity;
    return { totalCost, monthsStored };
  }
}
