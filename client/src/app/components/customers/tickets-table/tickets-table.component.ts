import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { BadgeComponent } from '../../ui/badge/badge.component';
import { Customer, Ticket } from '../../../models';

@Component({
  selector: 'app-tickets-table',
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
    @if (tickets.length === 0) {
      <div class="text-center py-8 text-gray-500 dark:text-gray-400">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/>
        </svg>
        <p class="mt-2">No tickets found</p>
      </div>
    } @else {
      <app-table>
        <app-table-header>
          <app-table-row>
            <app-table-head>Ticket #</app-table-head>
            <app-table-head>Date</app-table-head>
            <app-table-head>Commodity</app-table-head>
            <app-table-head>Gross Weight</app-table-head>
            <app-table-head>Net Weight</app-table-head>
            <app-table-head>Moisture</app-table-head>
            <app-table-head>Status</app-table-head>
          </app-table-row>
        </app-table-header>
        <app-table-body>
          @for (ticket of tickets; track ticket.id) {
            <app-table-row>
              <app-table-cell>
                <span class="font-medium">{{ ticket.ticketNumber }}</span>
              </app-table-cell>
              <app-table-cell>{{ ticket.date | date:'MMM d, y' }}</app-table-cell>
              <app-table-cell>{{ ticket.commodity }}</app-table-cell>
              <app-table-cell>{{ ticket.grossWeight | number }} lbs</app-table-cell>
              <app-table-cell>{{ ticket.netWeight | number }} lbs</app-table-cell>
              <app-table-cell>{{ ticket.moisture | number:'1.1-1' }}%</app-table-cell>
              <app-table-cell>
                <app-badge [variant]="getStatusVariant(ticket.status)">
                  {{ ticket.status }}
                </app-badge>
              </app-table-cell>
            </app-table-row>
          }
        </app-table-body>
      </app-table>

      <!-- Summary -->
      <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p class="text-gray-500 dark:text-gray-400">Total Tickets</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ tickets.length }}</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Total Net Weight</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ totalNetWeight | number }} lbs</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Avg Moisture</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ avgMoisture | number:'1.1-1' }}%</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Bushels (est.)</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ estimatedBushels | number }}</p>
          </div>
        </div>
      </div>
    }
  `
})
export class TicketsTableComponent {
  @Input() tickets: Ticket[] = [];
  @Input() customer!: Customer;

  get totalNetWeight(): number {
    return this.tickets.reduce((sum, t) => sum + t.netWeight, 0);
  }

  get avgMoisture(): number {
    if (this.tickets.length === 0) return 0;
    return this.tickets.reduce((sum, t) => sum + t.moisture, 0) / this.tickets.length;
  }

  get estimatedBushels(): number {
    // Rough estimate: 56 lbs per bushel for corn
    return Math.round(this.totalNetWeight / 56);
  }

  getStatusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'settled':
        return 'success';
      case 'pending':
        return 'warning';
      case 'cancelled':
        return 'danger';
      default:
        return 'default';
    }
  }
}
