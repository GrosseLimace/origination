import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { Customer, Ticket } from '../../../models';

type SortColumn = 'id' | 'date' | 'crop' | 'netWeight' | 'moisture' | 'testWeight';
type SortDirection = 'none' | 'asc' | 'desc';

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
              <app-table-head [sortable]="true" (click)="handleSort('id')">
                <span class="flex items-center gap-1">
                  Ticket ID
                  <span [class]="getSortIconClass('id')">
                    @if (currentSortColumn === 'id' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'id' && currentSortDirection === 'desc') {
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
              <app-table-head [sortable]="true" (click)="handleSort('date')">
                <span class="flex items-center gap-1">
                  Date
                  <span [class]="getSortIconClass('date')">
                    @if (currentSortColumn === 'date' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'date' && currentSortDirection === 'desc') {
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
              <app-table-head [sortable]="true" (click)="handleSort('netWeight')">
                <span class="flex items-center gap-1">
                  Net Weight (lbs)
                  <span [class]="getSortIconClass('netWeight')">
                    @if (currentSortColumn === 'netWeight' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'netWeight' && currentSortDirection === 'desc') {
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
              <app-table-head [sortable]="true" (click)="handleSort('moisture')">
                <span class="flex items-center gap-1">
                  Moisture %
                  <span [class]="getSortIconClass('moisture')">
                    @if (currentSortColumn === 'moisture' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'moisture' && currentSortDirection === 'desc') {
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
              <app-table-head [sortable]="true" (click)="handleSort('testWeight')">
                <span class="flex items-center gap-1">
                  Test Weight
                  <span [class]="getSortIconClass('testWeight')">
                    @if (currentSortColumn === 'testWeight' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'testWeight' && currentSortDirection === 'desc') {
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
            @for (ticket of sortedTickets; track ticket.id) {
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

  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';

  get sortedTickets(): Ticket[] {
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      return this.tickets;
    }

    const sorted = [...this.tickets].sort((a, b) => {
      let comparison = 0;
      const column = this.currentSortColumn!;

      switch (column) {
        case 'id':
          comparison = a.id.localeCompare(b.id);
          break;
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'crop':
          comparison = a.crop.localeCompare(b.crop);
          break;
        case 'netWeight':
          comparison = a.netWeight - b.netWeight;
          break;
        case 'moisture':
          comparison = a.moisture - b.moisture;
          break;
        case 'testWeight':
          comparison = a.testWeight - b.testWeight;
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
}
