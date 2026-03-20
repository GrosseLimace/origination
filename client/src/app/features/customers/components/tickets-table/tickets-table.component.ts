import { Component, input, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { Customer, Ticket, Contract } from '@models';

type SortColumn = 'id' | 'date' | 'crop' | 'appliedDockQuantity' | 'moisture' | 'testWeight' | 'protein';
type SortDirection = 'none' | 'asc' | 'desc';

interface TicketGroup {
  productCode: string;
  tickets: Ticket[];
  ticketCount: number;
  avgDate: Date | null;
  avgNetWeight: number;
  avgMoisture: number;
  avgTestWeight: number | null;
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
  public isLoading = input(false);
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
    // isApplied = first char of ctrmContractNumber is 'P' or 'S' (contract prefix type) — server-computed.
    // TicketType alone is unreliable: a U-type ticket can legitimately be applied to a contract.
    return this.tickets()
      .filter(t => !t.isApplied)
      .sort((a, b) => {
        const da = this._parseTicketDate(a.date)?.getTime() ?? 0;
        const db = this._parseTicketDate(b.date)?.getTime() ?? 0;
        return da - db; // oldest first
      });
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
        filtered = allTickets.filter(t => {
          const fmtDate = this._formatTicketDate(t.date);
          return terms.some(term =>
            t.ticketNumber.toLowerCase().includes(term) ||
            fmtDate.includes(term) ||
            this._matchesDate(t.date, term) ||
            (t.productCode || '').toLowerCase().includes(term) ||
            (t.ctrmContractNumber || '').toLowerCase().includes(term) ||
            (t.organizationCode || '').toLowerCase().includes(term)
          );
        });
      }

      if (!avgOnly && filtered.length === 0) continue;

      const ticketsForAvg = avgOnly ? allTickets : filtered;
      const sorted = avgOnly ? [] : this._sortTicketList(filtered);
      const validMoisture = ticketsForAvg.filter(t => typeof t.moisture === 'number' && t.moisture > 0);
      const validTestWeight = ticketsForAvg.filter(t => typeof t.testWeight === 'number' && t.testWeight > 0);
      const validProtein = ticketsForAvg.filter(t => typeof t.proteinPercent === 'number' && t.proteinPercent > 0);
      const validDateMs = ticketsForAvg
        .map(t => this._parseTicketDate(t.date)?.getTime() ?? null)
        .filter((d): d is number => d !== null && !isNaN(d));
      const isWheat = this.isWheatCommodity(undefined, productCode);

      groups.push({
        productCode,
        tickets: sorted,
        ticketCount: ticketsForAvg.length,
        avgDate: validDateMs.length ? new Date(validDateMs.reduce((s, d) => s + d, 0) / validDateMs.length) : null,
        avgNetWeight: ticketsForAvg.reduce((s, t) => s + (t.appliedDockQuantity || 0), 0) / ticketsForAvg.length,
        avgMoisture: validMoisture.length ? validMoisture.reduce((s, t) => s + (t.moisture || 0), 0) / validMoisture.length : 0,
        avgTestWeight: validTestWeight.length ? validTestWeight.reduce((s, t) => s + (t.testWeight || 0), 0) / validTestWeight.length : null,
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
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      // Default: oldest to newest within each crop group
      return [...tickets].sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        return da - db;
      });
    }
    const sorted = [...tickets].sort((a, b) => {
      let comparison = 0;
      switch (this.currentSortColumn) {
        case 'id': comparison = a.id - b.id; break;
        case 'date': comparison = (this._parseTicketDate(a.date)?.getTime() ?? 0) - (this._parseTicketDate(b.date)?.getTime() ?? 0); break;
        case 'appliedDockQuantity': comparison = (a.appliedDockQuantity || 0) - (b.appliedDockQuantity || 0); break;
        case 'moisture': comparison = (a.moisture || 0) - (b.moisture || 0); break;
        case 'testWeight': comparison = (a.testWeight || 0) - (b.testWeight || 0); break;
        case 'protein': comparison = (a.proteinPercent || 0) - (b.proteinPercent || 0); break;
      }
      return comparison;
    });
    return this.currentSortDirection === 'desc' ? sorted.reverse() : sorted;
  }

  /** Parse a ticket date string into a local-time Date, avoiding the UTC-midnight
   *  off-by-one bug: ISO date-only strings ("YYYY-MM-DD") are treated as UTC by
   *  the JS spec, which shifts the calendar date backwards by one day in US timezones.
   *  Appending T12:00:00 forces noon local time so the date is always preserved. */
  private _parseTicketDate(dateStr: string | undefined): Date | null {
    if (!dateStr) return null;
    const s = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr + 'T12:00:00' : dateStr;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Format ticket date as "Oct 23, 2025" and "10/23/2025" for searchable text. */
  private _formatTicketDate(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const d = this._parseTicketDate(dateStr);
    if (!d) return '';
    const m = d.getMonth(), day = d.getDate(), year = d.getFullYear();
    const short = TicketsTableComponent._MONTHS_SHORT[m];
    const full = TicketsTableComponent._MONTHS[m];
    // Include multiple formats so "oct", "october", "10/23/2025", "10/23" all match
    return `${short} ${day}, ${year} ${full} ${day}, ${year} ${m + 1}/${day}/${year}`.toLowerCase();
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

  private static readonly _MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  private static readonly _MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /** Check if a ticket date matches a search term. Supports:
   *  - Month names: "July", "Oct", "march"
   *  - Day numbers: "19", "31"
   *  - Years: "2025", "2026"
   *  - Slash/dash dates: "10/1/2025", "1-1-2026", "3/15"
   *  - Natural dates: "Oct 23, 2025", "March 2025", "October 23 2025"
   *  - Raw ISO match: "2026-03-15"
   */
  private _matchesDate(dateStr: string | undefined, term: string): boolean {
    if (!dateStr) return false;
    if (dateStr.toLowerCase().includes(term)) return true;
    const d = this._parseTicketDate(dateStr);
    if (!d) return false;
    const month = d.getMonth(), day = d.getDate(), year = d.getFullYear();
    // Month name match (full or abbreviated)
    if (TicketsTableComponent._MONTHS[month].startsWith(term) || TicketsTableComponent._MONTHS_SHORT[month] === term) return true;
    // Exact year match
    if (term === String(year)) return true;
    // Exact day match (only 1-2 digit numbers)
    if (/^\d{1,2}$/.test(term) && parseInt(term, 10) === day) return true;
    // Slash or dash date: M/D/YYYY, M-D-YYYY, M/D, M-D
    const dateParts = term.split(/[/\-]/);
    if (dateParts.length >= 2) {
      const m = parseInt(dateParts[0], 10), dd = parseInt(dateParts[1], 10), yy = dateParts[2] ? parseInt(dateParts[2], 10) : null;
      if (!isNaN(m) && !isNaN(dd)) {
        if (m === month + 1 && dd === day && (yy === null || yy === year)) return true;
      }
    }
    // Natural date string: "Oct 23, 2025", "March 2025", "October 23 2025"
    const parsed = new Date(term.replace(',', ''));
    if (!isNaN(parsed.getTime())) {
      // If term has no day component (e.g. "March 2025"), match month+year only
      const hasDay = /\d{1,2}[,\s]/.test(term) || /\s\d{1,2}\s/.test(term) || /\s\d{1,2}$/.test(term);
      if (parsed.getMonth() === month && parsed.getFullYear() === year) {
        return !hasDay || parsed.getDate() === day;
      }
    }
    return false;
  }

  get hasWheatTickets(): boolean {
    // Show protein column if any ticket actually has protein data, or if any contract is wheat
    return this.unappliedTickets.some(t => typeof t.proteinPercent === 'number' && t.proteinPercent > 0)
      || this.contracts().some(c => this.isWheatCommodity(c.commodityGroup, c.commodityDescription));
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
          comparison = (this._parseTicketDate(a.date)?.getTime() ?? 0) - (this._parseTicketDate(b.date)?.getTime() ?? 0);
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
        case 'testWeight':
          comparison = (a.testWeight || 0) - (b.testWeight || 0);
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
    return 'text-gray-400 dark:text-gray-600';
  }

  // Standard U.S. grain conversions (lbs per bushel).
  // TODO: replace with a per-commodity table from the database when available.
  getLbsPerBushel(productCode: string | undefined | null): number {
    const code = (productCode || '').toUpperCase();
    if (code.includes('CORN') || code.includes('YC'))                              return 56;
    if (code.includes('SOY') || code.includes('BEAN') || code.includes('SB'))      return 60;
    if (code.includes('WHEAT') || code.includes('HRW') || code.includes('HRS') ||
        code.includes('HWS') || code.includes('SRW') || code.includes('WW'))       return 60;
    if (code.includes('SORGHUM') || code.includes('MILO') || code.includes('SOR') || code.includes('SG'))  return 56;
    if (code.includes('BARLEY'))                                                    return 48;
    if (code.includes('OAT'))                                                       return 32;
    if (code.includes('RYE'))                                                       return 56;
    if (code.includes('RICE'))                                                      return 45;
    return 1; // unknown crop — show raw value
  }

  toBushels(lbs: number | null | undefined, productCode: string | undefined | null): number {
    return (lbs || 0) / this.getLbsPerBushel(productCode);
  }
}
