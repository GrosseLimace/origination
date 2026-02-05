import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { Customer, Contract, Ticket } from '../../../models';

type SortColumn = 'contractNumber' | 'crop' | 'quantity' | 'price' | 'deliveryStart' | 'status';
type SortDirection = 'none' | 'asc' | 'desc';

@Component({
  selector: 'app-contracts-table',
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
      @if (contracts.length === 0) {
        <div class="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg class="mx-auto h-12 w-12 text-gray-400 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p>No contracts found for this customer</p>
        </div>
      } @else {
        <app-table>
          <app-table-header>
            <app-table-row>
              <app-table-head [sortable]="true" (click)="handleSort('contractNumber')">
                <span class="flex items-center gap-1">
                  Contract ID
                  <span [class]="getSortIconClass('contractNumber')">
                    @if (currentSortColumn === 'contractNumber' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'contractNumber' && currentSortDirection === 'desc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                      </svg>
                    } @else {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                      </svg>
                    }
                  </span>
                </span>
              </app-table-head>
              <app-table-head [sortable]="true" (click)="handleSort('crop')">
                <span class="flex items-center gap-1">
                  Crop
                  <span [class]="getSortIconClass('crop')">
                    @if (currentSortColumn === 'crop' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'crop' && currentSortDirection === 'desc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                      </svg>
                    } @else {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                      </svg>
                    }
                  </span>
                </span>
              </app-table-head>
              <app-table-head [sortable]="true" (click)="handleSort('quantity')">
                <span class="flex items-center gap-1">
                  Quantity
                  <span [class]="getSortIconClass('quantity')">
                    @if (currentSortColumn === 'quantity' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'quantity' && currentSortDirection === 'desc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                      </svg>
                    } @else {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                      </svg>
                    }
                  </span>
                </span>
              </app-table-head>
              <app-table-head [sortable]="true" (click)="handleSort('price')">
                <span class="flex items-center gap-1">
                  Price
                  <span [class]="getSortIconClass('price')">
                    @if (currentSortColumn === 'price' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'price' && currentSortDirection === 'desc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                      </svg>
                    } @else {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                      </svg>
                    }
                  </span>
                </span>
              </app-table-head>
              <app-table-head [sortable]="true" (click)="handleSort('deliveryStart')">
                <span class="flex items-center gap-1">
                  Delivery Period
                  <span [class]="getSortIconClass('deliveryStart')">
                    @if (currentSortColumn === 'deliveryStart' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'deliveryStart' && currentSortDirection === 'desc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                      </svg>
                    } @else {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                      </svg>
                    }
                  </span>
                </span>
              </app-table-head>
              <app-table-head [sortable]="true" (click)="handleSort('status')">
                <span class="flex items-center gap-1">
                  Status
                  <span [class]="getSortIconClass('status')">
                    @if (currentSortColumn === 'status' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'status' && currentSortDirection === 'desc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                      </svg>
                    } @else {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                      </svg>
                    }
                  </span>
                </span>
              </app-table-head>
            </app-table-row>
          </app-table-header>
          <app-table-body>
            @for (contract of sortedContracts; track contract.id) {
              <!-- Main Row -->
              <app-table-row
                [highlighted]="!contract.signed"
                [clickable]="true"
                (rowClick)="toggleRow(contract.id)"
              >
                <app-table-cell>
                  <div class="flex items-center gap-2">
                    <span class="text-gray-400">
                      @if (expandedRows.has(contract.id)) {
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                        </svg>
                      } @else {
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                      }
                    </span>
                    <span [class]="!contract.signed ? 'font-medium text-red-600 dark:text-red-400' : 'font-medium'">
                      {{ contract.contractNumber }}
                    </span>
                  </div>
                </app-table-cell>
                <app-table-cell>
                  <span [class]="!contract.signed ? 'text-red-600 dark:text-red-400' : ''">{{ contract.commodityDescription || contract.commodityCode }}</span>
                </app-table-cell>
                <app-table-cell>
                  <span [class]="!contract.signed ? 'text-red-600 dark:text-red-400' : ''">{{ contract.quantity | number }} {{ contract.unit }}</span>
                </app-table-cell>
                <app-table-cell>
                  <span [class]="!contract.signed ? 'text-red-600 dark:text-red-400' : ''">{{ contract.price | currency:'USD':'symbol':'1.2-2' }}/{{ getSingularUnit(contract.unit) }}</span>
                </app-table-cell>
                <app-table-cell>
                  <span [class]="!contract.signed ? 'text-red-600 dark:text-red-400' : ''">{{ contract.deliveryStart | date:'M/d/yyyy' }} - {{ contract.deliveryEnd | date:'M/d/yyyy' }}</span>
                </app-table-cell>
                <app-table-cell>
                  <span [class]="getStatusClass(getCalculatedStatus(contract))">
                    {{ getCalculatedStatus(contract) }}
                  </span>
                </app-table-cell>
              </app-table-row>

              <!-- Expanded Row -->
              @if (expandedRows.has(contract.id)) {
                <app-table-row [class]="'bg-gray-50 dark:bg-gray-800/50'">
                  <app-table-cell [colspan]="6">
                    <div class="py-4">
                      <!-- Delivery Progress at top -->
                      <div class="mb-10">
                        <p class="text-sm text-gray-500 dark:text-gray-400 mb-2">Delivery Progress</p>
                        <!-- Custom progress bar: green for delivered, gray for remaining -->
                        <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden w-full">
                          <div
                            class="h-full bg-green-500 rounded-full"
                            [style.width.%]="getDeliveryStats(contract).progressPercent"
                          ></div>
                        </div>
                        <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-2 mb-6">
                          <span>{{ getDeliveryStats(contract).deliveredBushels | number }} delivered</span>
                          <span>{{ getDeliveryStats(contract).remainingBushels | number }} remaining</span>
                        </div>
                      </div>

                      <!-- Two column layout -->
                      <div class="grid grid-cols-2 gap-8">
                        <!-- Left column -->
                        <div class="space-y-6">
                          <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Contract Value</p>
                            <p>{{ contract.quantity * contract.price | currency:'USD':'symbol':'1.2-2' }}</p>
                          </div>
                          <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Price per Bushel</p>
                            <p>{{ contract.price | currency:'USD':'symbol':'1.2-2' }}</p>
                          </div>
                          <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">End Date</p>
                            <p>{{ contract.deliveryEnd | date:'M/d/yyyy' }}</p>
                          </div>
                          <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Total Delivered</p>
                            <p>{{ getDeliveryStats(contract).deliveredBushels | number }} {{ contract.unit }}</p>
                          </div>
                          <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Delivery Progress</p>
                            <p>{{ getDeliveryStats(contract).progressPercent | number:'1.0-0' }}%</p>
                          </div>
                        </div>

                        <!-- Right column -->
                        <div class="space-y-6">
                          <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Delivery Window</p>
                            <p>{{ getDeliveryWindowStatus(contract) }}</p>
                          </div>
                          <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Start Date</p>
                            <p>{{ contract.deliveryStart | date:'M/d/yyyy' }}</p>
                          </div>
                          <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Unit Type</p>
                            <p>{{ contract.unit }}</p>
                          </div>
                          <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Remaining Quantity</p>
                            <p>{{ getDeliveryStats(contract).remainingBushels | number }} {{ contract.unit }}</p>
                          </div>
                        </div>
                      </div>

                      <!-- Applied Tickets Section -->
                      <div class="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                        <p class="text-sm mb-4">Applied Tickets ({{ getAppliedTickets(contract).length }})</p>

                        @if (getAppliedTickets(contract).length > 0) {
                          @for (ticket of getAppliedTickets(contract); track ticket.id) {
                            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 mb-3">
                              <!-- Row 1 -->
                              <div class="grid grid-cols-3 gap-4 mb-4">
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400">Ticket ID</p>
                                  <p>{{ ticket.id }}</p>
                                </div>
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400">Date</p>
                                  <p>{{ ticket.date | date:'M/d/yyyy' }}</p>
                                </div>
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400">Net Weight</p>
                                  <p>{{ ticket.netWeight | number }} lbs</p>
                                </div>
                              </div>
                              <!-- Row 2 -->
                              <div class="grid grid-cols-3 gap-4">
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400">Moisture</p>
                                  <p>{{ ticket.moisture | number:'1.1-1' }}%</p>
                                </div>
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400">Test Weight</p>
                                  <p>{{ ticket.testWeight | number:'1.1-1' }} lbs/bu</p>
                                </div>
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400">Product</p>
                                  <p>{{ ticket.productCode }}</p>
                                </div>
                              </div>
                            </div>
                          }
                        } @else {
                          <p class="text-gray-500 dark:text-gray-400 text-sm">No tickets applied to this contract yet.</p>
                        }
                      </div>
                    </div>
                  </app-table-cell>
                </app-table-row>
              }
            }
          </app-table-body>
        </app-table>
      }
    </div>
  `
})
export class ContractsTableComponent implements OnChanges {
  @Input() contracts: Contract[] = [];
  @Input() tickets: Ticket[] = [];
  @Input() customer!: Customer;

  expandedRows = new Set<string>();
  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['contracts']) {
      this.expandedRows.clear();
    }
  }

  get sortedContracts(): Contract[] {
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      return this.contracts;
    }

    const sorted = [...this.contracts].sort((a, b) => {
      let comparison = 0;
      switch (this.currentSortColumn) {
        case 'contractNumber':
          comparison = a.contractNumber.localeCompare(b.contractNumber);
          break;
        case 'crop':
          comparison = (a.commodityDescription || '').localeCompare(b.commodityDescription || '');
          break;
        case 'quantity':
          comparison = a.quantity - b.quantity;
          break;
        case 'price':
          comparison = a.price - b.price;
          break;
        case 'deliveryStart':
          comparison = new Date(a.deliveryStart).getTime() - new Date(b.deliveryStart).getTime();
          break;
        case 'status':
          comparison = this.getCalculatedStatus(a).localeCompare(this.getCalculatedStatus(b));
          break;
      }
      return comparison;
    });

    return this.currentSortDirection === 'desc' ? sorted.reverse() : sorted;
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

  getSortIconClass(column: SortColumn): string {
    if (this.currentSortColumn === column) {
      return 'text-gray-600 dark:text-gray-300';
    }
    return 'text-gray-300 dark:text-gray-600';
  }

  toggleRow(contractId: string): void {
    if (this.expandedRows.has(contractId)) {
      this.expandedRows.delete(contractId);
    } else {
      this.expandedRows.add(contractId);
    }
  }

  getSingularUnit(unit: string): string {
    return unit.endsWith('s') ? unit.slice(0, -1) : unit;
  }

  getDeliveryWindowStatus(contract: Contract): string {
    const now = new Date();
    const start = new Date(contract.deliveryStart);
    const end = new Date(contract.deliveryEnd);

    if (now < start) return 'Not Started';
    if (now > end) return 'Ended';
    return 'Open';
  }

  getDeliveryStats(contract: Contract): { deliveredBushels: number; remainingBushels: number; progressPercent: number } {
    const appliedTickets = this.getAppliedTickets(contract);
    const lbsPerBushel = this.getLbsPerBushel(contract.commodityDescription || contract.commodityCode || '');

    const deliveredLbs = appliedTickets.reduce((sum, t) => sum + t.netWeight, 0);
    const deliveredBushels = Math.floor(deliveredLbs / lbsPerBushel);
    const remainingBushels = Math.max(0, (contract.quantity || 0) - deliveredBushels);
    const progressPercent = (contract.quantity || 0) > 0 ? (deliveredBushels / (contract.quantity || 1)) * 100 : 0;

    return { deliveredBushels, remainingBushels, progressPercent };
  }

  private getLbsPerBushel(commodity: string): number {
    const commodityUpper = commodity.toUpperCase();
    if (commodityUpper.includes('CORN')) return 56;
    if (commodityUpper.includes('SOYBEAN') || commodityUpper.includes('SOY')) return 60;
    if (commodityUpper.includes('WHEAT')) return 60;
    return 56;
  }

  getAppliedTickets(contract: Contract): Ticket[] {
    return this.tickets.filter(t =>
      t.productCode === (contract.commodityCode || contract.commodityDescription) &&
      t.farmId === contract.farmId &&
      new Date(t.date) >= new Date(contract.deliveryStart) &&
      new Date(t.date) <= new Date(contract.deliveryEnd)
    ).sort((a, b) => a.id.localeCompare(b.id));
  }

  getCalculatedStatus(contract: Contract): string {
    const stats = this.getDeliveryStats(contract);

    if (stats.progressPercent >= 100) {
      return 'Fulfilled';
    }

    if (stats.progressPercent === 0) {
      return 'Pending';
    }

    return 'Active';
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Active':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-600 text-white';
      case 'Fulfilled':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-600 text-white';
      case 'Pending':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-500 text-white';
      default:
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-500 text-white';
    }
  }
}
