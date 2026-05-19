import { Component, input, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { AppStateService } from '@core/services/app-state.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Ticket, Contract } from '@models';
import { expandSearchWithAliases } from '@shared/utils/commodity-aliases';

type SortColumn = 'id' | 'date' | 'crop' | 'location' | 'appliedDockQuantity' | 'moisture' | 'testWeight' | 'protein';
type SortDirection = 'none' | 'asc' | 'desc';
export type GroupMode = 'both' | 'crop' | 'elevator';

interface TicketGroup {
  groupKey: string;        // unique key per group, format depends on groupMode
  productCode: string;     // commodity for the group, or 'All' when grouping by elevator only
  elevatorCode: string;    // elevator code for the group, or 'All' when grouping by crop only
  tickets: Ticket[];
  ticketCount: number;
  avgDate: Date | null;
  totalNetWeight: number;
  totalNetBushels: number | null;  // each ticket converted by its own commodity (handles mixed-commodity elevator groups)
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
  private readonly appState = inject(AppStateService);
  private readonly usageTracking = inject(UsageTrackingService);

  public isLoading = input(false);
  public tickets = input<Ticket[]>([]);
  public contracts = input<Contract[]>([]);
  public customer = input.required<Customer>();
  public openCrop = input<string | null>(null);

  private _conversionMap: Map<string, number> | null = null;

  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';
  cropSortActive = false;
  cropRotation = 0;
  showSearch = false;
  searchQuery = '';
  expandedCommodities = new Set<string>();
  readonly summaryExpanded = signal(false);
  readonly groupMode = signal<GroupMode>('both');

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
        this.expandedCommodities.clear();
      }
      this._previousCustomerId = cust.id;
    });

    // Auto-expand when there's only one group, or when navigating from Insights with a
    // specific crop — in that case we expand every group whose commodity matches.
    effect(() => {
      const tickets = this.tickets();
      const mode = this.groupMode();
      const unapplied = tickets.filter(t => !t.isApplied);
      const allGroupKeys = new Set(unapplied.map(t => this._groupKeyFor(t, mode)));
      const crops = new Set(unapplied.map(t => (t.productCode || 'Unknown').trim()));
      const openCrop = this.openCrop();
      if (openCrop && crops.has(openCrop)) {
        const matches = [...allGroupKeys].filter(k => {
          const [productCode] = k.split('|');
          return mode === 'elevator' ? true : productCode === openCrop;
        });
        this.expandedCommodities = new Set(matches);
      } else if (allGroupKeys.size === 1) {
        this.expandedCommodities = new Set(allGroupKeys);
      }
    });
  }

  private get _uniqueCropCount(): number {
    return new Set(this.unappliedTickets.map(t => t.productCode || 'Unknown')).size;
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.showSearch = false;
  }

  /** Set of ticket IDs that are spot loads — unapplied tickets in the last 30 days.
   *  Unapplied = ContractNumber prefix is U (Unload), L (Loadout), or C (Customer Storage).
   *  Matches Actionable Insights → Spot Loads exactly, so the "Spot" badge on the customer
   *  ticket list lines up with what that producer shows up for on /insights. No contract-date
   *  coverage check — an unapplied ticket is a spot load regardless of what contracts exist
   *  in the same window, because the ticket itself is what tells us it wasn't priced. */
  get spotTicketIds(): Set<number> {
    const ids = new Set<number>();
    // Cutoff snaps to start-of-UTC-day 30 days ago so a ticket dated exactly 30 days
    // ago isn't excluded just because "now" is past midnight.
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    const contracts = this.contracts();
    for (const t of this.tickets()) {
      if (t.isApplied || !t.date) continue;
      const ticketDate = new Date(t.date);
      if (isNaN(ticketDate.getTime()) || ticketDate < cutoff) continue;
      // Match Insights: a spot load is an unapplied ticket with no active,
      // same-commodity contract whose delivery window covers the ticket's date.
      const ticketCommodity = (t.productCode || '').trim().toUpperCase();
      const hasContractCoverage = ticketCommodity && contracts.some(c => {
        if (c.closedDate) return false;  // Closed contracts can't cover a new delivery
        if (c.status === 'Fulfilled' || c.status === 'Cancelled') return false;
        if ((c.commodityCode || '').trim().toUpperCase() !== ticketCommodity) return false;
        const start = new Date(c.deliveryStart);
        const end = new Date(c.deliveryEnd);
        return start <= ticketDate && end >= ticketDate;
      });
      if (!hasContractCoverage) ids.add(t.id);
    }
    return ids;
  }

  get unappliedTickets(): Ticket[] {
    // A ticket is "unapplied" when its contract prefix is U (Unload), L (Loadout), or
    // C (Customer Storage). C-prefix tickets also surface in the Storage view — they're
    // shown in both places so a merchandiser can see uncommitted storage grain alongside
    // unbooked unload/loadout tickets. P, S, B, and no-contract tickets are applied.
    return this.tickets()
      .filter(t => !t.isApplied)
      .sort((a, b) => {
        const da = this._parseTicketDate(a.date)?.getTime() ?? 0;
        const db = this._parseTicketDate(b.date)?.getTime() ?? 0;
        return da - db; // oldest first
      });
  }

  /** Build the group key for a ticket given the active mode. Always uses
   *  "productCode|elevatorCode" format so a single key parser handles all modes. */
  private _groupKeyFor(ticket: Ticket, mode: GroupMode): string {
    const productCode = (ticket.productCode || 'Unknown').trim();
    const elevatorCode = (ticket.elevatorCode || 'Unknown').trim().toUpperCase();
    if (mode === 'crop') return `${productCode}|All`;
    if (mode === 'elevator') return `All|${elevatorCode}`;
    return `${productCode}|${elevatorCode}`;
  }

  get ticketGroups(): TicketGroup[] {
    const q = this.searchQuery.trim().toLowerCase();
    const terms = q ? this._expandWithAliases(q) : [];
    const mode = this.groupMode();

    const groupMap = new Map<string, Ticket[]>();
    for (const ticket of this.unappliedTickets) {
      const key = this._groupKeyFor(ticket, mode);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(ticket);
    }

    const groups: TicketGroup[] = [];
    for (const [groupKey, allTickets] of groupMap) {
      const [productCode, elevatorCode] = groupKey.split('|');
      // Filter tickets by search within each group
      const filtered = !q ? allTickets : allTickets.filter(t => {
        const fmtDate = this._formatTicketDate(t.date);
        const loc = this._formatLocation(t);
        return terms.some(term =>
          t.ticketNumber.toLowerCase().includes(term) ||
          fmtDate.includes(term) ||
          this._matchesDate(t.date, term) ||
          (t.productCode || '').toLowerCase().includes(term) ||
          (t.ctrmContractNumber || '').toLowerCase().includes(term) ||
          (t.organizationCode || '').toLowerCase().includes(term) ||
          loc.includes(term)
        );
      });

      if (filtered.length === 0) continue;

      // Stats reflect the visible (filtered) tickets so the header updates as the user searches
      const statsTickets = filtered;
      const validMoisture = statsTickets.filter(t => typeof t.moisture === 'number' && t.moisture > 0);
      const validTestWeight = statsTickets.filter(t => typeof t.testWeight === 'number' && t.testWeight > 0);
      const validProtein = statsTickets.filter(t => typeof t.proteinPercent === 'number' && t.proteinPercent > 0);
      const validDateMs = statsTickets
        .map(t => this._parseTicketDate(t.date)?.getTime() ?? null)
        .filter((d): d is number => d !== null && !isNaN(d));
      // For elevator-only grouping, productCode is 'All' — derive wheat status from
      // any ticket in the group so the protein column still appears when relevant.
      const isWheat = mode === 'elevator'
        ? statsTickets.some(t => this.isWheatProductCode(t.productCode))
        : this.isWheatProductCode(productCode);

      // Per-ticket bushel total — uses each ticket's own commodity factor so
      // elevator-only groups (mixed crops) total correctly. Null if any ticket
      // can't be converted (commodity missing from GNP024).
      let totalNetBushels: number | null = 0;
      for (const t of statsTickets) {
        const bu = this.toBushels(t.appliedDockQuantity, t.productCode);
        if (bu == null) { totalNetBushels = null; break; }
        totalNetBushels += bu;
      }

      groups.push({
        groupKey,
        productCode,
        elevatorCode,
        tickets: this._sortTicketList(filtered),
        ticketCount: statsTickets.length,
        avgDate: validDateMs.length ? new Date(validDateMs.reduce((s, d) => s + d, 0) / validDateMs.length) : null,
        totalNetWeight: statsTickets.reduce((s, t) => s + (t.appliedDockQuantity || 0), 0),
        totalNetBushels,
        avgMoisture: validMoisture.length ? validMoisture.reduce((s, t) => s + (t.moisture || 0), 0) / validMoisture.length : 0,
        avgTestWeight: validTestWeight.length ? validTestWeight.reduce((s, t) => s + (t.testWeight || 0), 0) / validTestWeight.length : null,
        avgProtein: validProtein.length ? validProtein.reduce((s, t) => s + (t.proteinPercent || 0), 0) / validProtein.length : null,
        isWheat
      });
    }
    // Crop rotation is independent of ticket sort — persists even when another column is active
    if (this.cropSortActive) {
      groups.sort((a, b) =>
        a.productCode.localeCompare(b.productCode) || a.elevatorCode.localeCompare(b.elevatorCode));
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
        case 'location': {
          const locA = (a.elevatorCity || '').toLowerCase();
          const locB = (b.elevatorCity || '').toLowerCase();
          comparison = locA.localeCompare(locB);
          break;
        }
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
    return expandSearchWithAliases(q);
  }

  private static readonly _STATE_NAMES: Record<string, string> = {
    AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
    CO: 'colorado', CT: 'connecticut', DE: 'delaware', FL: 'florida', GA: 'georgia',
    HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
    KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
    MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri',
    MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey',
    NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio',
    OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina',
    SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont',
    VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
  };

  /** Build a searchable location string: "city, state, full state name" */
  private _formatLocation(ticket: Ticket): string {
    const parts: string[] = [];
    if (ticket.elevatorCity) parts.push(ticket.elevatorCity.toLowerCase());
    if (ticket.elevatorState) {
      const abbr = ticket.elevatorState.toUpperCase();
      parts.push(abbr.toLowerCase());
      const fullName = TicketsTableComponent._STATE_NAMES[abbr];
      if (fullName) parts.push(fullName);
    }
    return parts.join(' ');
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
    // Show protein column only if unapplied tickets have protein data or are wheat by product code
    return this.unappliedTickets.some(t =>
      (typeof t.proteinPercent === 'number' && t.proteinPercent > 0)
      || this.isWheatProductCode(t.productCode)
    );
  }

  isWheatProductCode(productCode?: string | null): boolean {
    if (!productCode) return false;
    const upper = productCode.toUpperCase().trim();
    return upper.includes('WHEAT') || upper.includes('WW') ||
      upper.startsWith('HRW') || upper.startsWith('HRS') || upper.startsWith('SRW') ||
      upper.startsWith('DUR') || upper === 'HW';
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

  setGroupMode(mode: GroupMode): void {
    if (this.groupMode() === mode) return;
    this.groupMode.set(mode);
    this.expandedCommodities.clear();
  }

  toggleCommodity(productCode: string): void {
    if (this.expandedCommodities.has(productCode)) {
      this.expandedCommodities.delete(productCode);
    } else {
      this.expandedCommodities.add(productCode);
      this.usageTracking.trackTicketDropdownOpen();
    }
  }

  getSpotCount(group: TicketGroup): number {
    const spots = this.spotTicketIds;
    return group.tickets.filter(t => spots.has(t.id)).length;
  }

  isCommodityExpanded(productCode: string): boolean {
    // Auto-expand all groups when searching
    if (this.searchQuery.trim()) return true;
    return this.expandedCommodities.has(productCode);
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

  /**
   * Looks up lbs-per-bushel from the ODS commodity conversion view (ctrm.vw_GNP024).
   * Returns null if conversions are unavailable or the commodity is not in the view.
   * No hardcoded fallback — callers must handle missing data explicitly.
   */
  getLbsPerBushel(productCode: string | undefined | null): number | null {
    const code = (productCode || '').trim().toUpperCase();
    if (!code) return null;

    const conversions = this.appState.commodityConversions();
    if (conversions.length === 0) return null;

    if (!this._conversionMap || this._conversionMap.size !== conversions.length) {
      this._conversionMap = new Map(conversions.map(c => [c.commodityCode.trim().toUpperCase(), c.lbsPerUnit]));
    }
    const lbs = this._conversionMap.get(code);
    return lbs && lbs > 0 ? lbs : null;
  }

  toBushels(lbs: number | null | undefined, productCode: string | undefined | null): number | null {
    const lbsPerBushel = this.getLbsPerBushel(productCode);
    if (lbsPerBushel == null) return null;
    return (lbs || 0) / lbsPerBushel;
  }
}
