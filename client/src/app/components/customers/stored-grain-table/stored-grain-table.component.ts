import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { BadgeComponent } from '../../ui/badge/badge.component';
import { Customer, StoredGrain } from '../../../models';

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
    TableCellComponent,
    BadgeComponent
  ],
  template: `
    @if (storedGrain.length === 0) {
      <div class="text-center py-8 text-gray-500 dark:text-gray-400">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
        </svg>
        <p class="mt-2">No stored grain found</p>
      </div>
    } @else {
      <!-- Total Storage Cost Banner -->
      <div class="mb-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
        <p class="text-sm text-blue-600 dark:text-blue-400">Total Accumulated Storage Costs</p>
        <p class="text-2xl font-semibold text-blue-700 dark:text-blue-300">{{ totalStorageCost | currency }}</p>
      </div>

      <app-table>
        <app-table-header>
          <app-table-row>
            <app-table-head>Crop</app-table-head>
            <app-table-head>Quantity (bu)</app-table-head>
            <app-table-head>Bin</app-table-head>
            <app-table-head>Storage Rate</app-table-head>
            <app-table-head>Start Date</app-table-head>
            <app-table-head>Accumulated Cost</app-table-head>
          </app-table-row>
        </app-table-header>
        <app-table-body>
          @for (grain of storedGrain; track grain.id) {
            <!-- Main Row - Clickable -->
            <app-table-row
              [clickable]="true"
              (rowClick)="toggleRow(grain.id)"
            >
              <app-table-cell>
                <div class="flex items-center gap-2">
                  <svg
                    class="w-4 h-4 text-gray-400 transition-transform"
                    [class.rotate-180]="expandedRows.has(grain.id)"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                  </svg>
                  <span class="font-medium">{{ grain.crop }}</span>
                </div>
              </app-table-cell>
              <app-table-cell>{{ grain.quantity | number }}</app-table-cell>
              <app-table-cell>{{ grain.bin }}</app-table-cell>
              <app-table-cell>{{ grain.storageRate | currency:'USD':'symbol':'1.3-3' }}/bu/mo</app-table-cell>
              <app-table-cell>{{ grain.storageStartDate | date:'MMM d, y' }}</app-table-cell>
              <app-table-cell class="text-red-600 dark:text-red-400 font-medium">
                {{ calculateStorageCost(grain).totalCost | currency }}
              </app-table-cell>
            </app-table-row>

            <!-- Expanded Row -->
            @if (expandedRows.has(grain.id)) {
              <app-table-row>
                <app-table-cell [attr.colspan]="6">
                  <div class="py-4 bg-gray-50 dark:bg-gray-800/50 -mx-4 px-4">
                    <div class="grid grid-cols-2 gap-8">
                      <!-- Left Column -->
                      <div class="space-y-4">
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Storage Start Date</p>
                          <p class="font-medium">{{ grain.storageStartDate | date:'MMMM d, y' }}</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Monthly Charge</p>
                          <p class="font-medium">{{ grain.storageRate * grain.quantity | currency }}</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Storage Rate</p>
                          <p class="font-medium">{{ grain.storageRate | currency:'USD':'symbol':'1.3-3' }} per bushel per month</p>
                        </div>
                      </div>

                      <!-- Right Column -->
                      <div class="space-y-4">
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Time in Storage</p>
                          <p class="font-medium">{{ calculateStorageCost(grain).monthsStored | number:'1.1-1' }} months</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Total Bushels</p>
                          <p class="font-medium">{{ grain.quantity | number }} bushels</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Total Cost to Date</p>
                          <p class="font-medium text-red-600 dark:text-red-400">{{ calculateStorageCost(grain).totalCost | currency }}</p>
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

      <!-- Summary -->
      <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p class="text-gray-500 dark:text-gray-400">Total Stored</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ totalQuantity | number }} bu</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Locations</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ uniqueLocations }}</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Commodities</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ uniqueCommodities }}</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Est. Value</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ estimatedValue | currency }}</p>
          </div>
        </div>
      </div>
    }
  `
})
export class StoredGrainTableComponent implements OnChanges {
  @Input() storedGrain: StoredGrain[] = [];
  @Input() customer!: Customer;

  expandedRows = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    // Reset expanded rows when stored grain changes (new customer selected)
    if (changes['storedGrain']) {
      this.expandedRows.clear();
    }
  }

  toggleRow(grainId: string): void {
    if (this.expandedRows.has(grainId)) {
      this.expandedRows.delete(grainId);
    } else {
      this.expandedRows.add(grainId);
    }
  }

  get totalQuantity(): number {
    return this.storedGrain.reduce((sum, g) => sum + g.quantity, 0);
  }

  get uniqueLocations(): number {
    return new Set(this.storedGrain.map(g => g.bin)).size;
  }

  get uniqueCommodities(): number {
    return new Set(this.storedGrain.map(g => g.crop)).size;
  }

  get estimatedValue(): number {
    // Rough estimate: $5/bu average
    return this.totalQuantity * 5;
  }

  get totalStorageCost(): number {
    return this.storedGrain.reduce((sum, g) => sum + this.calculateStorageCost(g).totalCost, 0);
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

  getDaysStored(storageDate: Date): number {
    const stored = new Date(storageDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - stored.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}
