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
                  @if (contract.price !== null && contract.price !== undefined) {
                    <span [class]="!contract.signed ? 'text-red-600 dark:text-red-400' : ''">{{ contract.price | currency:'USD':'symbol':'1.2-2' }}/{{ getSingularUnit(contract.unit) }}</span>
                  } @else {
                    <span class="text-gray-400">N/A</span>
                  }
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
                    <div class="block w-full py-6" style="display: block; width: 100%;">
                      <!-- Delivery Progress at top -->
                      <div class="mb-8 w-full">
                        <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Delivery Progress</p>
                        <!-- Custom progress bar: green for delivered, gray for remaining -->
                        <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden w-full">
                          <div
                            class="h-full bg-green-500 rounded-full transition-all"
                            [style.width.%]="getDeliveryStats(contract).progressPercent"
                          ></div>
                        </div>
                        <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-2">
                          <span>{{ getDeliveryStats(contract).deliveredBushels | number }} {{ contract.unit }} delivered</span>
                          <span>{{ getDeliveryStats(contract).remainingBushels | number }} {{ contract.unit }} remaining</span>
                        </div>
                      </div>

                      <!-- Two column layout using flexbox -->
                      <div class="flex flex-row gap-16 w-full" style="display: flex; width: 100%; gap: 4rem;">
                        <!-- Left column -->
                        <div class="flex-1 space-y-5" style="flex: 1; min-width: 0;">
                          <div class="flex flex-col">
                            <span class="text-sm text-gray-500 dark:text-gray-400 mb-1">Contract Value</span>
                            <span class="font-medium text-gray-900 dark:text-gray-100">
                              {{ contract.totalValue !== null && contract.totalValue !== undefined ? (contract.totalValue | currency:'USD':'symbol':'1.2-2') : 'N/A' }}
                            </span>
                          </div>
                          <div class="flex flex-col">
                            <span class="text-sm text-gray-500 dark:text-gray-400 mb-1">Price per Bushel</span>
                            <span class="font-medium text-gray-900 dark:text-gray-100">
                              {{ contract.price !== null && contract.price !== undefined ? (contract.price | currency:'USD':'symbol':'1.2-2') : 'N/A' }}
                            </span>
                          </div>
                          <div class="flex flex-col">
                            <span class="text-sm text-gray-500 dark:text-gray-400 mb-1">End Date</span>
                            <span class="font-medium text-gray-900 dark:text-gray-100">{{ contract.deliveryEnd | date:'M/d/yyyy' }}</span>
                          </div>
                          <div class="flex flex-col">
                            <span class="text-sm text-gray-500 dark:text-gray-400 mb-1">Total Delivered</span>
                            <span class="font-medium text-gray-900 dark:text-gray-100">{{ getDeliveryStats(contract).deliveredBushels | number }} {{ contract.unit }}</span>
                          </div>
                          <div class="flex flex-col">
                            <span class="text-sm text-gray-500 dark:text-gray-400 mb-1">Delivery Progress</span>
                            <span class="font-medium text-gray-900 dark:text-gray-100">{{ getDeliveryStats(contract).progressPercent | number:'1.0-0' }}%</span>
                          </div>
                        </div>

                        <!-- Right column -->
                        <div class="flex-1 space-y-5" style="flex: 1; min-width: 0;">
                          <div class="flex flex-col">
                            <span class="text-sm text-gray-500 dark:text-gray-400 mb-1">Delivery Window</span>
                            <span class="font-medium text-gray-900 dark:text-gray-100">{{ getDeliveryWindowStatus(contract) }}</span>
                          </div>
                          <div class="flex flex-col">
                            <span class="text-sm text-gray-500 dark:text-gray-400 mb-1">Start Date</span>
                            <span class="font-medium text-gray-900 dark:text-gray-100">{{ contract.deliveryStart | date:'M/d/yyyy' }}</span>
                          </div>
                          <div class="flex flex-col">
                            <span class="text-sm text-gray-500 dark:text-gray-400 mb-1">Unit Type</span>
                            <span class="font-medium text-gray-900 dark:text-gray-100">{{ contract.unit || 'N/A' }}</span>
                          </div>
                          <div class="flex flex-col">
                            <span class="text-sm text-gray-500 dark:text-gray-400 mb-1">Remaining Quantity</span>
                            <span class="font-medium text-gray-900 dark:text-gray-100">{{ getDeliveryStats(contract).remainingBushels | number }} {{ contract.unit }}</span>
                          </div>
                        </div>
                      </div>

                      <!-- Applied Tickets Section -->
                      <div class="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                        <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">Applied Tickets ({{ getAppliedTickets(contract).length }})</p>

                        @if (getAppliedTickets(contract).length > 0) {
                          @for (ticket of getAppliedTickets(contract); track ticket.id) {
                            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 mb-3">
                              <!-- Row 1 -->
                              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Shipment Ticket Number</p>
                                  <p class="font-medium text-gray-900 dark:text-gray-100">{{ ticket.shipmentTicketNumber || ((ticket.ticketPrefix || '') + ticket.ticketNumber + (ticket.ticketSuffix || '')) }}</p>
                                </div>
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Date</p>
                                  <p class="font-medium text-gray-900 dark:text-gray-100">{{ ticket.date }}</p>
                                </div>
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Net Weight</p>
                                  <p class="font-medium text-gray-900 dark:text-gray-100">{{ ticket.appliedDockQuantity | number }} lbs</p>
                                </div>
                              </div>
                              <!-- Row 2 -->
                              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Product Code</p>
                                  <p class="font-medium text-gray-900 dark:text-gray-100">{{ ticket.productCode || 'N/A' }}</p>
                                </div>
                                <div>
                                  <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Contract Number</p>
                                  <p class="font-medium text-gray-900 dark:text-gray-100">{{ ticket.ctrmContractNumber || 'N/A' }}</p>
                                </div>
                                <div>
                                  <!-- Empty space for layout balance -->
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

  expandedRows = new Set<number>();
  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['contracts']) {
      this.expandedRows.clear();
    }
  }

  get sortedContracts(): Contract[] {
    // Contracts are already filtered by parent component (home.component.ts)
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

  toggleRow(contractId: number): void {
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

    // DEBUG: Log ticket information
    console.log(`\n=== CONTRACT ${contract.contractNumber} (${contract.commodityDescription || contract.commodityCode}) ===`);
    console.log(`Contract Quantity: ${contract.quantity} ${contract.unit}`);
    console.log(`Applied Tickets Count: ${appliedTickets.length}`);
    appliedTickets.forEach((t, idx) => {
      console.log(`  Ticket ${idx + 1}: appliedDockQuantity = ${t.appliedDockQuantity}`);
    });

    // Calculate delivered pounds from tickets (appliedDockQuantity/AppliedNetQuantity is in pounds)
    const deliveredLbs = appliedTickets.reduce((sum, t) => sum + (t.appliedDockQuantity || 0), 0);
    console.log(`Total deliveredLbs: ${deliveredLbs}`);

    // Convert contract quantity to pounds based on unit type
    const contractLbs = this.convertContractQuantityToPounds(contract.quantity || 0, contract.unit, lbsPerBushel);
    console.log(`Contract in pounds: ${contractLbs} lbs (using unit: "${contract.unit}")`);

    // Calculate delivered and remaining in the contract's original unit
    const deliveredInContractUnits = this.convertPoundsToContractUnits(deliveredLbs, contract.unit, lbsPerBushel);
    console.log(`Delivered in contract units: ${deliveredInContractUnits} ${contract.unit}`);
    const remainingInContractUnits = Math.max(0, (contract.quantity || 0) - deliveredInContractUnits);
    const progressPercent = contractLbs > 0 ? Math.min(100, (deliveredLbs / contractLbs) * 100) : 0;
    console.log(`Progress: ${progressPercent.toFixed(2)}%\n`);

    // Determine precision based on unit type
    const unitLower = (contract.unit || '').toLowerCase().trim();
    const isTons = unitLower === 'st' || unitLower.includes('ton');

    // Apply appropriate precision: 2 decimals for tons, whole numbers for bushels/pounds
    const delivered = isTons
      ? Math.round(deliveredInContractUnits * 100) / 100  // 2 decimals for tons
      : Math.round(deliveredInContractUnits);             // Whole numbers for bushels/pounds

    const remaining = isTons
      ? Math.round(remainingInContractUnits * 100) / 100  // 2 decimals for tons
      : Math.round(remainingInContractUnits);             // Whole numbers for bushels/pounds

    return {
      deliveredBushels: delivered,
      remainingBushels: remaining,
      progressPercent
    };
  }

  private convertContractQuantityToPounds(quantity: number, unit: string, lbsPerBushel: number): number {
    const unitLower = (unit || '').toLowerCase().trim();

    // Convert to pounds based on unit type
    // Check for short tons (ST, ton, tons)
    if (unitLower === 'st' || unitLower.includes('ton')) {
      // Short tons to pounds (1 short ton = 2000 lbs)
      return quantity * 2000;
    } else if (unitLower.includes('bushel') || unitLower === 'bu') {
      // Bushels to pounds (commodity-specific)
      return quantity * lbsPerBushel;
    } else if (unitLower.includes('pound') || unitLower.includes('lb')) {
      // Already in pounds
      return quantity;
    } else if (unitLower === 'cwt' || unitLower.includes('hundredweight')) {
      // Hundredweight to pounds (1 cwt = 100 lbs)
      return quantity * 100;
    }

    // Default: assume bushels for grain contracts
    return quantity * lbsPerBushel;
  }

  private convertPoundsToContractUnits(pounds: number, unit: string, lbsPerBushel: number): number {
    const unitLower = (unit || '').toLowerCase().trim();

    // Convert from pounds back to contract units
    // Check for short tons (ST, ton, tons)
    if (unitLower === 'st' || unitLower.includes('ton')) {
      // Pounds to short tons
      return pounds / 2000;
    } else if (unitLower.includes('bushel') || unitLower === 'bu') {
      // Pounds to bushels (commodity-specific)
      return pounds / lbsPerBushel;
    } else if (unitLower.includes('pound') || unitLower.includes('lb')) {
      // Already in pounds
      return pounds;
    } else if (unitLower === 'cwt' || unitLower.includes('hundredweight')) {
      // Pounds to hundredweight
      return pounds / 100;
    }

    // Default: assume bushels for grain contracts
    return pounds / lbsPerBushel;
  }

  private getLbsPerBushel(commodity: string): number {
    const commodityUpper = commodity.toUpperCase();
    if (commodityUpper.includes('CORN')) return 56;
    if (commodityUpper.includes('SOYBEAN') || commodityUpper.includes('SOY')) return 60;
    if (commodityUpper.includes('WHEAT')) return 60;
    return 56;
  }

  getAppliedTickets(contract: Contract): Ticket[] {
    // Match tickets to contracts using the correct ODS field mapping
    // Ticket.ContractNumber (DB) → Contract.SourceContractId (DB)
    return this.tickets.filter(t => {
      // Primary: Match Ticket.CtrmContractNumber to Contract.SourceContractId (trim whitespace for comparison)
      if (t.ctrmContractNumber && contract.sourceContractId) {
        return t.ctrmContractNumber.trim() === contract.sourceContractId.trim();
      }

      // Fallback: Match by contractId FK (if populated in some cases)
      if (t.contractId && contract.id) {
        return t.contractId === contract.id;
      }

      return false;
    }).sort((a, b) => {
      // Sort by date (string comparison should work for ISO date strings)
      return (a.date || '').localeCompare(b.date || '');
    });
  }

  getCalculatedStatus(contract: Contract): string {
    // Calculate delivery progress to check if contract is fulfilled
    const stats = this.getDeliveryStats(contract);
    const now = new Date();
    const startDate = new Date(contract.deliveryStart);
    const endDate = new Date(contract.deliveryEnd);

    // If delivery is complete, always show Fulfilled (overrides everything)
    // Check both percentage and remaining quantity to handle rounding edge cases
    if (stats.progressPercent >= 100 || stats.remainingBushels <= 0) {
      return 'Fulfilled';
    }

    // Check for cancelled status from API
    if (contract.status === 'Cancelled') {
      return 'Cancelled';
    }

    // Check if contract is overdue (past end date and not fulfilled)
    if (now > endDate) {
      return 'Overdue';
    }

    // Check if contract has reached its start date
    if (now >= startDate) {
      return 'Active';
    }

    // Before start date
    return 'Pending';
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Active':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-600 text-white';
      case 'Fulfilled':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-600 text-white';
      case 'Pending':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-500 text-white';
      case 'Overdue':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-600 text-white';
      case 'Cancelled':
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-500 text-white';
      default:
        return 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-500 text-white';
    }
  }
}
