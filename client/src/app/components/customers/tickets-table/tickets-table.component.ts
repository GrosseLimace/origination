import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { Customer, Ticket, Contract } from '../../../models';

type SortColumn = 'id' | 'date' | 'crop' | 'appliedDockQuantity' | 'moisture' | 'protein';
type SortDirection = 'none' | 'asc' | 'desc';

interface TicketGroup {
  productCode: string;
  tickets: Ticket[];
  ticketCount: number;
  avgDate: Date | null;
  avgNetWeight: number;
  avgMoisture: number;
  avgProtein: number | null;
  isWheat: boolean;
}

@Component({
  selector: 'app-tickets-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableComponent,
    TableHeaderComponent,
    TableBodyComponent,
    TableRowComponent,
    TableHeadComponent,
    TableCellComponent
  ],
  template: `
    <div class="w-full">
      @if (unappliedTickets.length === 0) {
        <div class="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
          </svg>
          <p class="mt-2">No unapplied delivery tickets found for this customer</p>
        </div>
      } @else {
        <!-- Search toolbar -->
        <div class="flex items-center border-b border-gray-100 dark:border-gray-800 px-3 py-1.5">
          @if (showSearch) {
            <div class="flex items-center w-full gap-2">
              <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input
                type="text"
                [(ngModel)]="searchQuery"
                placeholder="Search by ticket #, date, crop, or 'avg'..."
                class="flex-1 py-1 text-sm bg-transparent focus:outline-none text-gray-900 dark:text-white placeholder-gray-400"
              />
              <button (click)="clearSearch()" title="Clear search" class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          } @else {
            <button (click)="showSearch = true" title="Search tickets" class="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
            </button>
          }
        </div>
        <div class="max-h-[480px] overflow-y-auto overflow-x-auto overscroll-y-none">
        <app-table>
          <app-table-header>
            <app-table-row>
              <app-table-head [sortable]="true" (click)="handleSort('id')">
                <span class="flex items-center justify-center gap-1">
                  Ticket Number
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
                <span class="flex items-center justify-center gap-1">
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
                <span class="flex items-center justify-center gap-1">
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
              <app-table-head [sortable]="true" (click)="handleSort('appliedDockQuantity')">
                <span class="flex items-center justify-center gap-1">
                  Net Weight (lbs)
                  <span [class]="getSortIconClass('appliedDockQuantity')">
                    @if (currentSortColumn === 'appliedDockQuantity' && currentSortDirection === 'asc') {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    } @else if (currentSortColumn === 'appliedDockQuantity' && currentSortDirection === 'desc') {
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
                <span class="flex items-center justify-center gap-1">
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
              @if (hasWheatTickets) {
                <app-table-head [sortable]="true" (click)="handleSort('protein')">
                  <span class="flex items-center justify-center gap-1">
                    Protein %
                    <span [class]="getSortIconClass('protein')">
                      @if (currentSortColumn === 'protein' && currentSortDirection === 'asc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                        </svg>
                      } @else if (currentSortColumn === 'protein' && currentSortDirection === 'desc') {
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
              }
            </app-table-row>
          </app-table-header>
          <app-table-body>
            @for (group of ticketGroups; track group.productCode) {
              @for (ticket of group.tickets; track ticket.id) {
                <app-table-row>
                  <app-table-cell class="text-center">{{ ticket.ticketNumber }}</app-table-cell>
                  <app-table-cell class="text-center">{{ ticket.date | date:'MMM d, yyyy' }}</app-table-cell>
                  <app-table-cell class="text-center">{{ ticket.productCode }}</app-table-cell>
                  <app-table-cell class="text-center">{{ ticket.appliedDockQuantity | number }}</app-table-cell>
                  <app-table-cell class="text-center">{{ ticket.moisture | number:'1.1-1' }}%</app-table-cell>
                  @if (hasWheatTickets) {
                    <app-table-cell class="text-center">
                      @if (ticket.proteinPercent !== null && ticket.proteinPercent !== undefined) {
                        {{ ticket.proteinPercent | number:'1.1-1' }}%
                      } @else {
                        -
                      }
                    </app-table-cell>
                  }
                </app-table-row>
              }
              <!-- Commodity average row -->
              <app-table-row [class]="'border-t-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800/80'">
                <app-table-cell class="text-center">
                  <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Avg</span>
                  <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">({{ group.ticketCount }})</span>
                </app-table-cell>
                <app-table-cell class="text-center">
                  @if (group.avgDate) {
                    <span class="font-bold text-gray-800 dark:text-gray-100">{{ group.avgDate | date:'MMM d, yyyy' }}</span>
                  } @else {
                    <span class="font-bold text-gray-800 dark:text-gray-100">—</span>
                  }
                </app-table-cell>
                <app-table-cell class="text-center">
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ group.productCode }}</span>
                </app-table-cell>
                <app-table-cell class="text-center">
                  <span class="font-bold text-gray-800 dark:text-gray-100">{{ group.avgNetWeight | number:'1.0-0' }}</span>
                </app-table-cell>
                <app-table-cell class="text-center">
                  <span class="font-bold text-gray-800 dark:text-gray-100">{{ group.avgMoisture | number:'1.1-1' }}%</span>
                </app-table-cell>
                @if (hasWheatTickets) {
                  <app-table-cell class="text-center">
                    <span class="font-bold text-gray-800 dark:text-gray-100">
                      @if (group.avgProtein !== null) {
                        {{ group.avgProtein | number:'1.1-1' }}%
                      } @else {
                        —
                      }
                    </span>
                  </app-table-cell>
                }
              </app-table-row>
            }
          </app-table-body>
        </app-table>
        </div>
        @if (ticketGroups.length === 0 && searchQuery.trim()) {
          <div class="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
            No tickets match "<span class="font-medium text-gray-700 dark:text-gray-300">{{ searchQuery }}</span>"
          </div>
        }
      }
    </div>
  `
})
export class TicketsTableComponent implements OnChanges {
  @Input() tickets: Ticket[] = [];
  @Input() contracts: Contract[] = [];
  @Input() customer!: Customer;

  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';
  cropSortActive = false;
  cropRotation = 0;
  showSearch = false;
  searchQuery = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['customer'] && !changes['customer'].firstChange) {
      this.currentSortColumn = null;
      this.currentSortDirection = 'none';
      this.cropSortActive = false;
      this.cropRotation = 0;
      this.searchQuery = '';
      this.showSearch = false;
    }
  }

  private get uniqueCropCount(): number {
    return new Set(this.unappliedTickets.map(t => t.productCode || 'Unknown')).size;
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.showSearch = false;
  }

  get unappliedTickets(): Ticket[] {
    const appliedContractIds = new Set(
      this.contracts
        .map(c => c.sourceContractId)
        .filter((id): id is string => !!id)
    );
    return this.tickets.filter(t =>
      !t.ctrmContractNumber || !appliedContractIds.has(t.ctrmContractNumber.trim())
    );
  }

  get ticketGroups(): TicketGroup[] {
    const q = this.searchQuery.trim().toLowerCase();
    const terms = q ? this.expandWithAliases(q) : [];
    const avgOnly = terms.some(t => t === 'avg' || t === 'average');

    const groupMap = new Map<string, Ticket[]>();
    for (const ticket of this.unappliedTickets) {
      const key = ticket.productCode || 'Unknown';
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(ticket);
    }

    const groups: TicketGroup[] = [];
    for (const [productCode, allTickets] of groupMap) {
      let filtered: Ticket[];
      if (!q || avgOnly) {
        filtered = avgOnly ? [] : allTickets;
      } else {
        filtered = allTickets.filter(t =>
          terms.some(term =>
            t.ticketNumber.toLowerCase().includes(term) ||
            (t.date || '').toLowerCase().includes(term) ||
            (t.productCode || '').toLowerCase().includes(term) ||
            (t.ctrmContractNumber || '').toLowerCase().includes(term) ||
            (t.organizationCode || '').toLowerCase().includes(term)
          )
        );
      }

      if (!avgOnly && filtered.length === 0) continue;

      const ticketsForAvg = avgOnly ? allTickets : filtered;
      const sorted = avgOnly ? [] : this.sortTicketList(filtered);
      const validMoisture = ticketsForAvg.filter(t => typeof t.moisture === 'number' && t.moisture > 0);
      const validProtein = ticketsForAvg.filter(t => typeof t.proteinPercent === 'number' && t.proteinPercent > 0);
      const validDateMs = ticketsForAvg
        .map(t => t.date ? new Date(t.date).getTime() : null)
        .filter((d): d is number => d !== null && !isNaN(d));
      const isWheat = this.isWheatCommodity(undefined, productCode);

      groups.push({
        productCode,
        tickets: sorted,
        ticketCount: ticketsForAvg.length,
        avgDate: validDateMs.length ? new Date(validDateMs.reduce((s, d) => s + d, 0) / validDateMs.length) : null,
        avgNetWeight: ticketsForAvg.reduce((s, t) => s + (t.appliedDockQuantity || 0), 0) / ticketsForAvg.length,
        avgMoisture: validMoisture.length ? validMoisture.reduce((s, t) => s + (t.moisture || 0), 0) / validMoisture.length : 0,
        avgProtein: validProtein.length ? validProtein.reduce((s, t) => s + (t.proteinPercent || 0), 0) / validProtein.length : null,
        isWheat
      });
    }
    // Crop rotation is independent of ticket sort — persists even when another column is active
    if (this.cropSortActive) {
      groups.sort((a, b) => a.productCode.localeCompare(b.productCode));
      if (this.cropRotation > 0) {
        const offset = this.cropRotation % groups.length;
        groups.splice(0, groups.length, ...groups.slice(offset), ...groups.slice(0, offset));
      }
    }

    return groups;
  }

  private sortTicketList(tickets: Ticket[]): Ticket[] {
    if (!this.currentSortColumn || this.currentSortDirection === 'none') return tickets;
    const sorted = [...tickets].sort((a, b) => {
      let comparison = 0;
      switch (this.currentSortColumn) {
        case 'id': comparison = a.id - b.id; break;
        case 'date': comparison = new Date(a.date).getTime() - new Date(b.date).getTime(); break;
        case 'appliedDockQuantity': comparison = (a.appliedDockQuantity || 0) - (b.appliedDockQuantity || 0); break;
        case 'moisture': comparison = (a.moisture || 0) - (b.moisture || 0); break;
        case 'protein': comparison = (a.proteinPercent || 0) - (b.proteinPercent || 0); break;
      }
      return comparison;
    });
    return this.currentSortDirection === 'desc' ? sorted.reverse() : sorted;
  }

  private expandWithAliases(q: string): string[] {
    const aliases: { [key: string]: string[] } = {
      'avg':       ['avg', 'average'],
      'average':   ['avg', 'average'],
      'yc':        ['yc', 'corn', 'yellow corn'],
      'corn':      ['yc', 'corn', 'yellow corn'],
      'yellow corn': ['yc', 'corn', 'yellow corn'],
      'hrw':       ['hrw', 'wheat', 'hard red winter'],
      'hw':        ['hw', 'wheat'],
      'wheat':     ['wheat', 'hrw', 'hw', 'hard red winter'],
      'sb':        ['sb', 'soybeans', 'beans', 'soy'],
      'soybeans':  ['sb', 'soybeans', 'beans', 'soy'],
      'beans':     ['sb', 'soybeans', 'beans', 'soy'],
      'soy':       ['sb', 'soybeans', 'beans', 'soy'],
      'milo':      ['milo', 'sorghum', 'sg'],
      'sorghum':   ['milo', 'sorghum', 'sg'],
      'sg':        ['milo', 'sorghum', 'sg'],
    };
    if (aliases[q]) return aliases[q];
    // Partial prefix match — "yellow" matches "yellow corn" key and expands to corn terms
    const expanded = new Set<string>([q]);
    for (const [key, terms] of Object.entries(aliases)) {
      if (key.startsWith(q)) terms.forEach(t => expanded.add(t));
    }
    return Array.from(expanded);
  }

  get hasWheatTickets(): boolean {
    // Check if any contract has wheat as commodity group or description
    const hasWheat = this.contracts.some(c => this.isWheatCommodity(c.commodityGroup, c.commodityDescription));

    return hasWheat;
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
      return this.unappliedTickets;
    }

    const sorted = [...this.unappliedTickets].sort((a, b) => {
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
    if (column === 'crop') {
      if (!this.cropSortActive) {
        this.cropSortActive = true;
        this.cropRotation = 0;
      } else {
        this.cropRotation++;
        if (this.cropRotation >= this.uniqueCropCount) {
          this.cropSortActive = false;
          this.cropRotation = 0;
        }
      }
      return;
    }

    // Ticket-level sort — crop rotation is untouched
    if (this.currentSortColumn === column) {
      if (this.currentSortDirection === 'asc') {
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
    if (column === 'crop' ? this.cropSortActive : this.currentSortColumn === column) {
      return 'text-gray-600 dark:text-gray-300';
    }
    return 'text-gray-300 dark:text-gray-600';
  }
}
