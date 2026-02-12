import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableCellComponent } from '../../ui/table/table.component';
import { Customer, Ticket, Contract } from '../../../models';

type SortColumn = 'id' | 'date' | 'crop' | 'appliedDockQuantity' | 'moisture' | 'protein';
type SortDirection = 'none' | 'asc' | 'desc';

interface ColumnDefinition {
  id: SortColumn;
  label: string;
  getValue: (ticket: Ticket) => any;
  render: (ticket: Ticket, component: TicketsTableComponent) => string;
  showWhenWheat?: boolean; // Optional: only show this column when there are wheat contracts
}

@Component({
  selector: 'app-tickets-table',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    TableComponent,
    TableHeaderComponent,
    TableBodyComponent,
    TableRowComponent,
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
            <tr cdkDropList cdkDropListOrientation="horizontal" cdkDropListLockAxis="x" (cdkDropListDropped)="dropColumn($event)" class="border-b border-gray-200 dark:border-gray-700 select-none">
              @for (column of visibleColumns; track column.id) {
                <th
                  cdkDrag
                  class="h-12 px-4 text-left align-middle font-medium text-gray-500 dark:text-gray-400 group cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800">

                  <div class="flex items-center gap-2">
                    <!-- Drag handle icon (visible on hover) -->
                    <div cdkDragHandle class="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing hover:bg-gray-200 dark:hover:bg-gray-700 rounded p-0.5 transition-all flex-shrink-0">
                      <svg class="w-4 h-4 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
                      </svg>
                    </div>

                    <!-- Column label and sort (clickable for sorting) -->
                    <span class="flex items-center gap-1 cursor-pointer" (click)="handleSort(column.id)">
                      {{ column.label }}
                      <span [class]="getSortIconClass(column.id)">
                        @if (currentSortColumn === column.id && currentSortDirection === 'asc') {
                          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                          </svg>
                        } @else if (currentSortColumn === column.id && currentSortDirection === 'desc') {
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
                  </div>

                  <!-- Custom drag preview -->
                  <div *cdkDragPreview class="px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg">
                    {{ column.label }}
                  </div>

                  <!-- Placeholder shown when dragging -->
                  <div *cdkDragPlaceholder class="bg-gray-100 dark:bg-gray-700 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded min-h-[40px]"></div>
                </th>
              }
            </tr>
          </app-table-header>
          <app-table-body>
            @for (ticket of sortedTickets; track ticket.id) {
              <app-table-row>
                @for (column of visibleColumns; track column.id) {
                  <app-table-cell [innerHTML]="column.render(ticket, this)"></app-table-cell>
                }
              </app-table-row>
            }
          </app-table-body>
        </app-table>
      }
    </div>
  `
})
export class TicketsTableComponent implements OnInit {
  @Input() tickets: Ticket[] = [];
  @Input() contracts: Contract[] = [];
  @Input() customer!: Customer;

  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';

  private readonly STORAGE_KEY = 'tickets-column-order';

  // Define all available columns
  private readonly allColumns: ColumnDefinition[] = [
    {
      id: 'id',
      label: 'Ticket Number',
      getValue: (t) => t.id,
      render: (t, comp) => `${t.ticketNumber}`
    },
    {
      id: 'date',
      label: 'Date',
      getValue: (t) => t.date,
      render: (t, comp) => {
        const date = new Date(t.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    },
    {
      id: 'crop',
      label: 'Crop',
      getValue: (t) => t.productCode,
      render: (t, comp) => `${t.productCode}`
    },
    {
      id: 'appliedDockQuantity',
      label: 'Net Weight (lbs)',
      getValue: (t) => t.appliedDockQuantity,
      render: (t, comp) => (t.appliedDockQuantity || 0).toLocaleString()
    },
    {
      id: 'moisture',
      label: 'Moisture %',
      getValue: (t) => t.moisture,
      render: (t, comp) => `${(t.moisture || 0).toFixed(1)}%`
    },
    {
      id: 'protein',
      label: 'Protein %',
      getValue: (t) => t.proteinPercent,
      render: (t, comp) => {
        if (t.proteinPercent !== null && t.proteinPercent !== undefined) {
          return `${t.proteinPercent.toFixed(1)}%`;
        }
        return '-';
      },
      showWhenWheat: true
    }
  ];

  displayColumns: ColumnDefinition[] = [];

  ngOnInit(): void {
    this.loadColumnOrder();
  }

  get visibleColumns(): ColumnDefinition[] {
    // Filter columns based on wheat ticket presence
    return this.displayColumns.filter(col => {
      if (col.showWhenWheat) {
        return this.hasWheatTickets;
      }
      return true;
    });
  }

  get hasWheatTickets(): boolean {
    // Check if any contract has wheat as commodity group or description
    return this.contracts.some(c => this.isWheatCommodity(c.commodityGroup, c.commodityDescription));
  }

  private loadColumnOrder(): void {
    const savedOrder = localStorage.getItem(this.STORAGE_KEY);
    if (savedOrder) {
      try {
        const columnIds: SortColumn[] = JSON.parse(savedOrder);
        // Reorder columns based on saved order
        this.displayColumns = columnIds
          .map(id => this.allColumns.find(col => col.id === id))
          .filter((col): col is ColumnDefinition => col !== undefined);

        // Add any new columns that weren't in saved order
        const existingIds = new Set(this.displayColumns.map(c => c.id));
        const newColumns = this.allColumns.filter(col => !existingIds.has(col.id));
        this.displayColumns.push(...newColumns);
      } catch (e) {
        // If parsing fails, use default order
        this.displayColumns = [...this.allColumns];
      }
    } else {
      // No saved order, use default
      this.displayColumns = [...this.allColumns];
    }
  }

  private saveColumnOrder(): void {
    const columnIds = this.displayColumns.map(col => col.id);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(columnIds));
  }

  dropColumn(event: CdkDragDrop<ColumnDefinition[]>): void {
    moveItemInArray(this.displayColumns, event.previousIndex, event.currentIndex);
    this.saveColumnOrder();
  }

  isWheatCommodity(commodityGroup: string | undefined, commodityDescription?: string | undefined): boolean {
    if (commodityGroup && commodityGroup.toUpperCase().includes('WHEAT')) return true;
    if (commodityDescription && commodityDescription.toUpperCase().includes('WHEAT')) return true;
    return false;
  }

  isWheat(ticket: Ticket): boolean {
    // A ticket can be applied to MULTIPLE contracts, so check ALL matching contracts
    const matchingContracts: Contract[] = [];

    // Try matching by contractId (FK) first
    if (ticket.contractId) {
      const contract = this.contracts.find(c => c.id === ticket.contractId);
      if (contract) matchingContracts.push(contract);
    }

    // Also check legacy string matching: ticket.ctrmContractNumber === contract.sourceContractId
    // This can match multiple contracts if a ticket is split across them
    if (ticket.ctrmContractNumber) {
      const stringMatches = this.contracts.filter(c => c.sourceContractId === ticket.ctrmContractNumber);
      stringMatches.forEach(contract => {
        // Avoid duplicates (in case both FK and string match point to same contract)
        if (!matchingContracts.some(c => c.id === contract.id)) {
          matchingContracts.push(contract);
        }
      });
    }

    if (matchingContracts.length === 0) {
      return false;
    }

    // Return true if ANY of the matching contracts is wheat
    return matchingContracts.some(contract =>
      this.isWheatCommodity(contract.commodityGroup, contract.commodityDescription)
    );
  }

  get sortedTickets(): Ticket[] {
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      return this.tickets;
    }

    const sorted = [...this.tickets].sort((a, b) => {
      let comparison = 0;
      const column = this.currentSortColumn!;

      switch (column) {
        case 'id':
          comparison = a.id - b.id;
          break;
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'crop':
          comparison = (a.productCode || '').localeCompare(b.productCode || '');
          break;
        case 'appliedDockQuantity':
          comparison = (a.appliedDockQuantity || 0) - (b.appliedDockQuantity || 0);
          break;
        case 'moisture':
          comparison = (a.moisture || 0) - (b.moisture || 0);
          break;
        case 'protein':
          comparison = (a.proteinPercent || 0) - (b.proteinPercent || 0);
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
