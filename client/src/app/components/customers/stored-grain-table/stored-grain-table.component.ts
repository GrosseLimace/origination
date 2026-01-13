import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
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
    TableCellComponent
  ],
  template: `
    <div class="w-full">
      @if (storedGrain.length === 0) {
        <div class="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
          </svg>
          <p class="mt-2">No grain currently in storage for this customer</p>
        </div>
      } @else {
        <!-- Total Storage Cost Banner -->
        <div class="mb-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium text-blue-900 dark:text-blue-100">Total Accumulated Storage Costs</p>
              <p class="text-sm text-blue-700 dark:text-blue-300">Across {{ storedGrain.length }} storage positions</p>
            </div>
            <div class="text-2xl font-bold text-blue-900 dark:text-blue-100">
              {{ totalStorageCost | currency }}
            </div>
          </div>
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
              <app-table-row>
                <app-table-cell>{{ grain.crop }}</app-table-cell>
                <app-table-cell>{{ grain.quantity | number }}</app-table-cell>
                <app-table-cell>{{ grain.bin }}</app-table-cell>
                <app-table-cell>{{ grain.storageRate | currency:'USD':'symbol':'1.3-3' }}/bu/mo</app-table-cell>
                <app-table-cell>{{ grain.storageStartDate | date:'MMM d, yyyy' }}</app-table-cell>
                <app-table-cell>
                  <span class="text-red-600 dark:text-red-400 font-medium">
                    {{ calculateStorageCost(grain) | currency }}
                  </span>
                </app-table-cell>
              </app-table-row>
            }
          </app-table-body>
        </app-table>
      }
    </div>
  `
})
export class StoredGrainTableComponent {
  @Input() storedGrain: StoredGrain[] = [];
  @Input() customer!: Customer;

  get totalStorageCost(): number {
    return this.storedGrain.reduce((sum, g) => sum + this.calculateStorageCost(g), 0);
  }

  calculateStorageCost(grain: StoredGrain): number {
    const now = new Date();
    const startDate = new Date(grain.storageStartDate);
    const monthsStored = (now.getFullYear() - startDate.getFullYear()) * 12
                       + (now.getMonth() - startDate.getMonth())
                       + (now.getDate() / 30);
    return monthsStored * grain.storageRate * grain.quantity;
  }
}
