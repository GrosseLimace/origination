import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { BadgeComponent } from '../../ui/badge/badge.component';
import { Customer, Contract, Ticket } from '../../../models';

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
    TableCellComponent,
    BadgeComponent
  ],
  template: `
    @if (contracts.length === 0) {
      <div class="text-center py-8 text-gray-500 dark:text-gray-400">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <p class="mt-2">No contracts found</p>
      </div>
    } @else {
      <app-table>
        <app-table-header>
          <app-table-row>
            <app-table-head>Contract #</app-table-head>
            <app-table-head>Crop</app-table-head>
            <app-table-head>Quantity</app-table-head>
            <app-table-head>Price</app-table-head>
            <app-table-head>Delivery Period</app-table-head>
            <app-table-head>Status</app-table-head>
          </app-table-row>
        </app-table-header>
        <app-table-body>
          @for (contract of contracts; track contract.id) {
            <!-- Main Row - Clickable -->
            <app-table-row
              [clickable]="true"
              [highlighted]="!contract.signed"
              (rowClick)="toggleRow(contract.id)"
            >
              <app-table-cell>
                <div class="flex items-center gap-2">
                  <svg
                    class="w-4 h-4 text-gray-400 transition-transform"
                    [class.rotate-180]="expandedRows.has(contract.id)"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                  </svg>
                  <span class="font-medium" [class.text-red-600]="!contract.signed">
                    {{ contract.contractNumber }}
                  </span>
                </div>
              </app-table-cell>
              <app-table-cell [class.text-red-600]="!contract.signed">{{ contract.crop }}</app-table-cell>
              <app-table-cell [class.text-red-600]="!contract.signed">{{ contract.quantity | number }} bu</app-table-cell>
              <app-table-cell [class.text-red-600]="!contract.signed">{{ contract.price | currency }}/bu</app-table-cell>
              <app-table-cell [class.text-red-600]="!contract.signed">
                {{ contract.deliveryStart | date:'MMM d' }} - {{ contract.deliveryEnd | date:'MMM d, y' }}
              </app-table-cell>
              <app-table-cell>
                <app-badge [variant]="getStatusVariant(contract.status)">
                  {{ contract.status }}
                </app-badge>
              </app-table-cell>
            </app-table-row>

            <!-- Expanded Row -->
            @if (expandedRows.has(contract.id)) {
              <app-table-row>
                <app-table-cell [attr.colspan]="6">
                  <div class="py-4 bg-gray-50 dark:bg-gray-800/50 -mx-4 px-4">
                    <div class="grid grid-cols-2 gap-8">
                      <!-- Left Column -->
                      <div class="space-y-4">
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Delivery Progress</p>
                          <div class="mt-2">
                            <div class="flex justify-between text-sm mb-1">
                              <span>{{ getDeliveryStats(contract).deliveredBushels | number }} delivered</span>
                              <span>{{ getDeliveryStats(contract).progressPercent | number:'1.0-0' }}%</span>
                            </div>
                            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                class="bg-green-600 h-2 rounded-full transition-all"
                                [style.width.%]="getDeliveryStats(contract).progressPercent"
                              ></div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Total Delivered</p>
                          <p class="font-medium">{{ getDeliveryStats(contract).deliveredBushels | number }} bushels</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Remaining Quantity</p>
                          <p class="font-medium">{{ getDeliveryStats(contract).remainingBushels | number }} bushels</p>
                        </div>
                      </div>

                      <!-- Right Column -->
                      <div class="space-y-4">
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Contract Value</p>
                          <p class="font-medium">{{ contract.quantity * contract.price | currency }}</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Delivery Period</p>
                          <p class="font-medium">{{ contract.deliveryStart | date:'MMMM d, y' }} - {{ contract.deliveryEnd | date:'MMMM d, y' }}</p>
                        </div>
                        @if (!contract.signed) {
                          <div class="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
                            <p class="text-sm text-red-600 dark:text-red-400 font-medium">⚠️ Contract awaiting signature</p>
                          </div>
                        }
                      </div>
                    </div>

                    <!-- Applied Tickets -->
                    @if (getAppliedTickets(contract).length > 0) {
                      <div class="mt-6">
                        <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Applied Tickets</p>
                        <div class="space-y-2">
                          @for (ticket of getAppliedTickets(contract); track ticket.id) {
                            <div class="flex justify-between text-sm bg-white dark:bg-gray-700 p-2 rounded">
                              <span>{{ ticket.ticketNumber }}</span>
                              <span>{{ ticket.netWeight | number }} lbs</span>
                              <span>{{ ticket.date | date:'MMM d, y' }}</span>
                            </div>
                          }
                        </div>
                      </div>
                    }
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
            <p class="text-gray-500 dark:text-gray-400">Total Contracts</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ contracts.length }}</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Total Bushels</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ totalBushels | number }}</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Open Contracts</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ openContracts }}</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Avg Price</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ avgPrice | currency }}/bu</p>
          </div>
        </div>
      </div>
    }
  `
})
export class ContractsTableComponent implements OnChanges {
  @Input() contracts: Contract[] = [];
  @Input() tickets: Ticket[] = [];
  @Input() customer!: Customer;

  expandedRows = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    // Reset expanded rows when contracts change (new customer selected)
    if (changes['contracts']) {
      this.expandedRows.clear();
    }
  }

  toggleRow(contractId: string): void {
    if (this.expandedRows.has(contractId)) {
      this.expandedRows.delete(contractId);
    } else {
      this.expandedRows.add(contractId);
    }
  }

  getDeliveryStats(contract: Contract): { deliveredBushels: number; remainingBushels: number; progressPercent: number } {
    // Calculate actual delivery from tickets
    // Convert ticket net weight (lbs) to bushels based on crop type
    // Standard: Corn = 56 lbs/bu, Soybeans = 60 lbs/bu, Wheat = 60 lbs/bu
    const appliedTickets = this.getAppliedTickets(contract);
    const lbsPerBushel = this.getLbsPerBushel(contract.crop);

    const deliveredLbs = appliedTickets.reduce((sum, t) => sum + t.netWeight, 0);
    const deliveredBushels = Math.floor(deliveredLbs / lbsPerBushel);
    const remainingBushels = Math.max(0, contract.quantity - deliveredBushels);
    const progressPercent = contract.quantity > 0 ? (deliveredBushels / contract.quantity) * 100 : 0;

    return { deliveredBushels, remainingBushels, progressPercent };
  }

  getAppliedTickets(contract: Contract): Ticket[] {
    // Get tickets matching crop and farm within delivery period
    return this.tickets.filter(t =>
      t.crop === contract.crop &&
      t.farmId === contract.farmId &&
      new Date(t.date) >= new Date(contract.deliveryStart) &&
      new Date(t.date) <= new Date(contract.deliveryEnd)
    ).sort((a, b) => a.ticketNumber.localeCompare(b.ticketNumber));
  }

  private getLbsPerBushel(crop: string): number {
    switch (crop.toLowerCase()) {
      case 'corn': return 56;
      case 'soybeans': return 60;
      case 'wheat': return 60;
      default: return 56;
    }
  }

  get totalBushels(): number {
    return this.contracts.reduce((sum, c) => sum + c.quantity, 0);
  }

  get openContracts(): number {
    return this.contracts.filter(c => c.status === 'Active' || c.status === 'Pending').length;
  }

  get avgPrice(): number {
    if (this.contracts.length === 0) return 0;
    return this.contracts.reduce((sum, c) => sum + c.price, 0) / this.contracts.length;
  }

  getStatusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' {
    switch (status.toLowerCase()) {
      case 'active':
        return 'success';
      case 'pending':
        return 'warning';
      case 'fulfilled':
        return 'default';
      case 'cancelled':
        return 'danger';
      default:
        return 'default';
    }
  }
}
