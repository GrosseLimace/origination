import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
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
    TableCellComponent
  ],
  template: `
    <div class="w-full">
      @if (tickets.length === 0) {
        <div class="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
          </svg>
          <p class="mt-2">No delivery tickets found for this customer</p>
        </div>
      } @else {
        <app-table>
          <app-table-header>
            <app-table-row>
              <app-table-head>Ticket ID</app-table-head>
              <app-table-head>Date</app-table-head>
              <app-table-head>Crop</app-table-head>
              <app-table-head>Net Weight (lbs)</app-table-head>
              <app-table-head>Moisture %</app-table-head>
              <app-table-head>Test Weight</app-table-head>
            </app-table-row>
          </app-table-header>
          <app-table-body>
            @for (ticket of tickets; track ticket.id) {
              <app-table-row>
                <app-table-cell>{{ ticket.id }}</app-table-cell>
                <app-table-cell>{{ ticket.date | date:'MMM d, yyyy' }}</app-table-cell>
                <app-table-cell>{{ ticket.crop }}</app-table-cell>
                <app-table-cell>{{ ticket.netWeight | number }}</app-table-cell>
                <app-table-cell>{{ ticket.moisture | number:'1.1-1' }}%</app-table-cell>
                <app-table-cell>{{ ticket.testWeight | number:'1.1-1' }} lbs/bu</app-table-cell>
              </app-table-row>
            }
          </app-table-body>
        </app-table>
      }
    </div>
  `
})
export class TicketsTableComponent {
  @Input() tickets: Ticket[] = [];
  @Input() customer!: Customer;
}
