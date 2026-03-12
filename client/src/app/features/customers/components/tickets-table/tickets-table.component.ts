import { Component, input, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { Customer, Ticket, Contract } from '@models';

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
  templateUrl: './tickets-table.component.html'
})
export class TicketsTableComponent {
  public tickets = input<Ticket[]>([]);
  public contracts = input<Contract[]>([]);
  public customer = input.required<Customer>();

  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';
  cropSortActive = false;
  cropRotation = 0;
  showSearch = false;
  searchQuery = '';

  private _previousCustomerId: number | null = null;

  constructor() {
    effect(() => {
      const cust = this.customer();
      if (this._previousCustomerId !== null && this._previousCustomerId !== cust.id) {
        this.currentSortColumn = null;
        this.currentSortDirection = 'none';
        this.cropSortActive = false;
        this.cropRotation = 0;
        this.searchQuery = '';
        this.showSearch = false;
      }
      this._previousCustomerId = cust.id;
    });
  }

  private get _uniqueCropCount(): number {
    return new Set(this.unappliedTickets.map(t => t.productCode || 'Unknown')).size;
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.showSearch = false;
  }

  get unappliedTickets(): Ticket[] {
    // TicketType determines applied status: P (Purchase) and S (Sale) are applied to contracts.
    // U (Unload), L (Loadout), B (Booking) are unapplied. Server computes isApplied from TicketType.
    return this.tickets().filter(t => !t.isApplied);
  }

  get ticketGroups(): TicketGroup[] {
    const q = this.searchQuery.trim().toLowerCase();
    const terms = q ? this._expandWithAliases(q) : [];
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
      const sorted = avgOnly ? [] : this._sortTicketList(filtered);
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

  private _sortTicketList(tickets: Ticket[]): Ticket[] {
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

  private _expandWithAliases(q: string): string[] {
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
    const hasWheat = this.contracts().some(c => this.isWheatCommodity(c.commodityGroup, c.commodityDescription));

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
      const contract = this.contracts().find(c => c.id === ticket.contractId);
      if (contract) matchingContracts.push(contract);
    }

    // Also check legacy string matching: ticket.ctrmContractNumber === contract.sourceContractId
    // This can match multiple contracts if a ticket is split across them
    if (ticket.ctrmContractNumber) {
      const stringMatches = this.contracts().filter(c => c.sourceContractId === ticket.ctrmContractNumber);
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
        if (this.cropRotation >= this._uniqueCropCount) {
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
