import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { TicketsTableComponent } from './tickets-table.component';
import { AppStateService } from '@core/services/app-state.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { CommodityConversion, Contract, Customer, Ticket } from '@models';

// Behaviour safety net for the Unapplied Tickets tab: the loading / load-error / empty states,
// the applied-vs-unapplied split, grouping by crop & elevator / crop / elevator, the per-group
// header stats (avg date, lbs → bushel conversion, quality averages, wheat-only protein), the
// auto-expand rules (single group, openCrop from Insights, search), the search filter (aliases,
// dates, states, shipment numbers), row ordering and header sorting, the crop-rotation sort,
// the Spot-load badge, and the reset on customer change. Everything is driven through the signal
// inputs, the rendered DOM and (only where the template exposes no trigger) a public method —
// so these specs survive an OnPush / signals conversion of the component's internals.
//
// The component is purely input-driven: no ApiService. AppStateService only supplies the
// commodity conversions (lbs per bushel) and UsageTrackingService only records group opens.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Frozen clock (Date only — timers stay real) so the 30-day Spot-load window never drifts. */
const NOW = new Date('2026-10-13T12:00:00');

const DAY = 24 * 60 * 60 * 1000;
function daysFromNow(n: number): Date {
  const d = new Date(NOW.getTime() + n * DAY);
  d.setHours(12, 0, 0, 0);
  return d;
}

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: 'Sample Farms', location: 'Pratt, KS',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

/** An UNAPPLIED (unload) corn ticket at the Pratt elevator, delivered well outside the Spot window. */
function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    farmId: 'F1',
    ticketNumber: '500',
    ctrmContractNumber: 'UNL500',
    productCode: 'YC',
    elevatorCode: 'PRT',
    elevatorCity: 'Pratt',
    elevatorState: 'KS',
    date: '2026-05-10',
    grossWeight: 60000,
    tareWeight: 4000,
    netWeight: 56000,
    appliedDockQuantity: 56000,
    moisture: 15,
    testWeight: 56,
    isApplied: false,
    isActive: true,
    ...over,
  };
}

/** An open corn purchase contract whose delivery window brackets "now" by 30 days either side. */
function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1,
    customerId: 42,
    sourceContractId: 'PCW100',
    farmId: 'F1',
    contractNumber: '100',
    commodityCode: 'YC',
    quantity: 10000,
    unit: 'bushels',
    price: 0,
    deliveryStart: daysFromNow(-30),
    deliveryEnd: daysFromNow(30),
    status: 'Active',
    signed: true,
    ...over,
  };
}

const CONVERSIONS: CommodityConversion[] = [
  { commodityCode: 'YC', lbsPerUnit: 56 },
  { commodityCode: 'HRW', lbsPerUnit: 60 },
  { commodityCode: 'SG', lbsPerUnit: 56 },
];

// ── Harness ───────────────────────────────────────────────────────────────────

describe('TicketsTableComponent', () => {
  let fixture: ComponentFixture<TicketsTableComponent>;
  let component: TicketsTableComponent;
  let ref: ComponentRef<TicketsTableComponent>;
  let trackTicketDropdownOpen: ReturnType<typeof vi.fn>;
  const commodityConversions = signal<CommodityConversion[]>([]);

  function setInputs(inputs: {
    tickets?: Ticket[]; contracts?: Contract[]; customer?: Customer; isLoading?: boolean;
    loadError?: string | null; openCrop?: string | null;
  }): void {
    for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
    fixture.detectChanges();
  }

  /** Re-render after calling a method directly (a real DOM event marks the view dirty itself). */
  function render(): void {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => norm(host().textContent);
  const buttonByText = (label: string): HTMLButtonElement =>
    Array.from(host().querySelectorAll('button')).find(b => norm(b.textContent) === label) as HTMLButtonElement;

  /** One bordered card per ticket group. */
  const groups = (): HTMLElement[] => Array.from(host().querySelectorAll<HTMLElement>('div.rounded-lg.border'));
  const groupTitles = (): string[] => groups().map(g => norm(g.querySelector('p.font-semibold')?.textContent));
  const groupByTitle = (title: string): HTMLElement => groups().find(g => norm(g.querySelector('p.font-semibold')?.textContent) === title)!;
  const subtitle = (g: HTMLElement): string => norm(g.querySelector('div.min-w-0 p.text-xs')?.textContent);
  const groupHeader = (g: HTMLElement): HTMLElement => g.querySelector<HTMLElement>('div.cursor-pointer.select-none')!;
  /** A header stat value by its label, e.g. stat(g, 'Avg Moisture') → '15.0%'; undefined when the stat is not rendered. */
  const stat = (g: HTMLElement, label: string): string | undefined => {
    const box = Array.from(g.querySelectorAll('div.text-center')).find(d => norm(d.querySelector('p')?.textContent) === label);
    return box ? norm(box.querySelectorAll('p')[1]?.textContent) : undefined;
  };
  const rows = (g: HTMLElement): HTMLTableRowElement[] => Array.from(g.querySelectorAll('tbody tr'));
  const cells = (row: HTMLTableRowElement): string[] => Array.from(row.querySelectorAll('td')).map(td => norm(td.textContent));
  const ticketCol = (g: HTMLElement): string[] => rows(g).map(r => cells(r)[0]);
  const columnHeaders = (g: HTMLElement): string[] => Array.from(g.querySelectorAll('thead th')).map(th => norm(th.textContent));
  const headerCell = (g: HTMLElement, label: string): HTMLElement =>
    Array.from(g.querySelectorAll<HTMLElement>('thead th')).find(th => norm(th.textContent) === label)!;

  function typeSearch(q: string): void {
    const input = host().querySelector<HTMLInputElement>('input[placeholder="Search tickets..."]')!;
    input.value = q;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function chooseGroupMode(label: 'Crop & Elevator' | 'Crop' | 'Elevator'): void {
    if (!buttonByText(label)) {
      buttonByText('Filter Unapplied Tickets').click();
      fixture.detectChanges();
    }
    buttonByText(label).click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    trackTicketDropdownOpen = vi.fn();
    commodityConversions.set(CONVERSIONS);
    await TestBed.configureTestingModule({
      imports: [TicketsTableComponent],
      providers: [
        { provide: AppStateService, useValue: { commodityConversions } },
        { provide: UsageTrackingService, useValue: { trackTicketDropdownOpen } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TicketsTableComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Loading / error / empty states ────────────────────────────────────────

  describe('page states', () => {
    it('shows the spinner while loading, then the empty state when every ticket turns out applied', () => {
      setInputs({ isLoading: true, tickets: [makeTicket({ id: 1 })] });
      expect(text()).toContain('Loading tickets...');
      expect(groups()).toHaveLength(0);

      setInputs({ isLoading: false, tickets: [makeTicket({ id: 1, isApplied: true }), makeTicket({ id: 2, isApplied: true })] });
      expect(text()).not.toContain('Loading tickets...');
      expect(text()).toContain('No unapplied delivery tickets found for this producer');
      expect(groups()).toHaveLength(0);
    });

    it('shows a load failure (never the empty state) and Retry asks the parent to reload', () => {
      const retry = vi.fn();
      component.retryLoad.subscribe(retry);
      setInputs({ loadError: 'Gateway timed out', tickets: [] });

      expect(text()).toContain('Tickets could not be loaded');
      expect(text()).toContain('Gateway timed out');
      expect(text()).not.toContain('No unapplied delivery tickets found');

      buttonByText('Retry').click();
      expect(retry).toHaveBeenCalledTimes(1);
    });
  });

  // ── Grouping ──────────────────────────────────────────────────────────────

  describe('grouping', () => {
    const mixed = (): Ticket[] => [
      makeTicket({ id: 1, productCode: 'YC', elevatorCode: 'PRT', date: '2026-05-10' }),
      makeTicket({ id: 2, productCode: 'YC', elevatorCode: ' prt ', date: '2026-05-11' }),   // trimmed + upper-cased
      makeTicket({ id: 3, productCode: 'YC', elevatorCode: 'HAY', date: '2026-05-12' }),
      makeTicket({ id: 4, productCode: 'SB', elevatorCode: 'PRT', date: '2026-05-13' }),
      makeTicket({ id: 5, productCode: 'SB', elevatorCode: 'PRT', isApplied: true }),        // applied → excluded
      makeTicket({ id: 6, productCode: undefined, elevatorCode: undefined, date: '2026-05-14' }),
    ];

    it('groups only unapplied tickets by crop & elevator by default, oldest group first', () => {
      setInputs({ tickets: mixed() });

      expect(groupTitles()).toEqual(['YC · PRT', 'YC · HAY', 'SB · PRT', 'Unknown · UNKNOWN']);
      expect(subtitle(groupByTitle('YC · PRT'))).toBe('2 tickets');
      expect(subtitle(groupByTitle('SB · PRT'))).toBe('1 ticket');
    });

    it('switches to crop-only and elevator-only grouping from the Filter bar, collapsing open groups', () => {
      setInputs({ tickets: mixed() });
      groupHeader(groupByTitle('YC · PRT')).click();
      fixture.detectChanges();
      expect(rows(groupByTitle('YC · PRT'))).toHaveLength(2);

      chooseGroupMode('Crop');
      expect(groups().every(g => rows(g).length === 0)).toBe(true);
      expect(groupTitles()).toEqual(['YC', 'SB', 'Unknown']);
      expect(subtitle(groupByTitle('YC'))).toBe('3 tickets');

      chooseGroupMode('Elevator');
      expect(groupTitles()).toEqual(['PRT', 'HAY', 'UNKNOWN']);
      expect(subtitle(groupByTitle('PRT'))).toBe('3 tickets');
    });
  });

  // ── Group header stats ────────────────────────────────────────────────────

  describe('group header stats', () => {
    it('averages date, moisture and test weight over valid values and converts lbs to bushels', () => {
      setInputs({
        tickets: [
          makeTicket({ id: 1, date: '2026-05-10', appliedDockQuantity: 56000, moisture: 14, testWeight: 55 }),
          makeTicket({ id: 2, date: '2026-05-12', appliedDockQuantity: 28000, moisture: 0, testWeight: undefined }), // 0 / missing ignored
          makeTicket({ id: 3, productCode: 'SB', date: '2026-05-20', testWeight: undefined }),
        ],
      });

      const corn = groupByTitle('YC · PRT');
      expect(stat(corn, 'Avg Date')).toBe('5/11/2026');
      expect(stat(corn, 'Total Net Bu')).toBe('1,500.00');            // (56,000 + 28,000) / 56
      expect(stat(corn, 'Avg Moisture')).toBe('14.0%');
      expect(stat(corn, 'Avg Test Wt')).toBe('55.0 lb/bu');

      const beans = groupByTitle('SB · PRT');
      expect(stat(beans, 'Total Net Bu')).toBe('—');                   // SB has no GNP024 conversion
      expect(stat(beans, 'Avg Test Wt')).toBe('—');
    });

    it('shows protein (header stat and column) only for wheat groups, per ticket in elevator mode', () => {
      setInputs({
        tickets: [
          makeTicket({ id: 1, productCode: 'HRW', proteinPercent: 11 }),
          makeTicket({ id: 2, productCode: 'HRW', proteinPercent: 13, date: '2026-05-11' }),
          makeTicket({ id: 3, productCode: 'YC', proteinPercent: undefined, date: '2026-05-12' }),
        ],
      });

      const wheat = groupByTitle('HRW · PRT');
      const corn = groupByTitle('YC · PRT');
      expect(stat(wheat, 'Avg Protein')).toBe('12.0%');
      expect(stat(corn, 'Avg Protein')).toBeUndefined();

      groupHeader(wheat).click();
      groupHeader(corn).click();
      fixture.detectChanges();
      expect(columnHeaders(groupByTitle('HRW · PRT'))).toContain('Protein %');
      expect(columnHeaders(groupByTitle('YC · PRT'))).not.toContain('Protein %');

      // Elevator-only groups mix crops: protein shows when ANY ticket is wheat, and bushels
      // convert each ticket by its own crop (2 × 56,000/60 + 56,000/56).
      setInputs({ tickets: [...component.tickets(), makeTicket({ id: 4, productCode: 'YC', elevatorCode: 'HAY', date: '2026-05-13' })] });
      chooseGroupMode('Elevator');
      expect(stat(groupByTitle('PRT'), 'Avg Protein')).toBe('12.0%');
      expect(stat(groupByTitle('PRT'), 'Total Net Bu')).toBe('2,866.67');
      expect(stat(groupByTitle('HAY'), 'Avg Protein')).toBeUndefined();
    });

    it('converts with the new factors when the conversion list is replaced by one of the same length', () => {
      setInputs({ tickets: [makeTicket({ id: 1, appliedDockQuantity: 56000 })] });
      expect(stat(groupByTitle('YC · PRT'), 'Total Net Bu')).toBe('1,000.00');  // 56,000 / 56

      // The lookup map used to be cached until the list's LENGTH changed, so this kept dividing by 56.
      commodityConversions.set(CONVERSIONS.map(c => c.commodityCode === 'YC' ? { ...c, lbsPerUnit: 50 } : c));
      render();
      expect(stat(groupByTitle('YC · PRT'), 'Total Net Bu')).toBe('1,120.00');  // 56,000 / 50
    });
  });

  // ── Expand / collapse ─────────────────────────────────────────────────────

  describe('expand / collapse', () => {
    it('auto-expands a lone group, keeps it open when more groups arrive, and a header click opens (tracked) then closes one', () => {
      setInputs({ tickets: [makeTicket({ id: 1 }), makeTicket({ id: 2, ticketNumber: '501' })] });
      expect(ticketCol(groups()[0])).toEqual(['500', '501']);
      expect(trackTicketDropdownOpen).not.toHaveBeenCalled();

      // A refresh that adds a second group neither collapses the open one nor opens the new one.
      setInputs({ tickets: [makeTicket({ id: 1 }), makeTicket({ id: 2, productCode: 'SB' })] });
      expect(rows(groupByTitle('YC · PRT'))).toHaveLength(1);
      expect(rows(groupByTitle('SB · PRT'))).toHaveLength(0);

      groupHeader(groupByTitle('SB · PRT')).click();
      fixture.detectChanges();
      expect(rows(groupByTitle('SB · PRT'))).toHaveLength(1);
      expect(rows(groupByTitle('YC · PRT'))).toHaveLength(1);   // groups open independently
      expect(trackTicketDropdownOpen).toHaveBeenCalledTimes(1);

      groupHeader(groupByTitle('SB · PRT')).click();
      fixture.detectChanges();
      expect(rows(groupByTitle('SB · PRT'))).toHaveLength(0);
      expect(trackTicketDropdownOpen).toHaveBeenCalledTimes(1); // closing is not tracked
    });

    it('expands every group of the openCrop commodity when arriving from Insights', () => {
      setInputs({
        openCrop: 'YC',
        tickets: [
          makeTicket({ id: 1, elevatorCode: 'PRT' }),
          makeTicket({ id: 2, elevatorCode: 'HAY' }),
          makeTicket({ id: 3, productCode: 'SB' }),
        ],
      });

      expect(rows(groupByTitle('YC · PRT'))).toHaveLength(1);
      expect(rows(groupByTitle('YC · HAY'))).toHaveLength(1);
      expect(rows(groupByTitle('SB · PRT'))).toHaveLength(0);
    });
  });

  // ── Rows & sorting ────────────────────────────────────────────────────────

  describe('rows and sorting', () => {
    it('renders the full shipment ticket number, location fallback, bushels and missing test weight', () => {
      setInputs({
        tickets: [
          makeTicket({ id: 1, ticketNumber: '999', shipmentTicketNumber: 'PRT-0999-A', appliedDockQuantity: 28000, moisture: 13.25 }),
          makeTicket({ id: 2, ticketNumber: '1000', shipmentTicketNumber: '  ', elevatorCity: undefined, elevatorState: undefined, testWeight: undefined, date: '2026-05-11' }),
        ],
      });

      const [first, second] = rows(groups()[0]);
      expect(cells(first)).toEqual(['PRT-0999-A', '5/10/2026', 'YC', 'Pratt, KS', '500.00', '13.3%', '56.0 lb/bu']);
      expect(cells(second)).toEqual(['1000', '5/11/2026', 'YC', '—', '1,000.00', '15.0%', '-']);
    });

    it('orders rows oldest first then by numeric ticket number, and a header click cycles asc → desc → default', () => {
      setInputs({
        tickets: [
          makeTicket({ id: 1, ticketNumber: '7', date: '2026-05-12', appliedDockQuantity: 56000 }),
          makeTicket({ id: 2, ticketNumber: '1000', date: '2026-05-10', appliedDockQuantity: 28000 }),
          makeTicket({ id: 3, ticketNumber: '999', date: '2026-05-10', appliedDockQuantity: 112000 }),
        ],
      });
      expect(ticketCol(groups()[0])).toEqual(['999', '1000', '7']); // not the string order "1000" < "999"

      const order: string[][] = [];
      for (let i = 0; i < 3; i++) {
        headerCell(groups()[0], 'Net Bu').click();
        fixture.detectChanges();
        order.push(ticketCol(groups()[0]));
      }
      expect(order).toEqual([
        ['1000', '7', '999'],   // 28,000 / 56,000 / 112,000 lbs
        ['999', '7', '1000'],
        ['999', '1000', '7'],   // sort cleared → default order
      ]);
    });

    it('rotates group order alphabetically through each crop, then returns to the date order', () => {
      setInputs({
        tickets: [
          makeTicket({ id: 1, productCode: 'SB', date: '2026-05-10' }),
          makeTicket({ id: 2, productCode: 'YC', date: '2026-06-10' }),
          makeTicket({ id: 3, productCode: 'HRW', date: '2026-07-10' }),
        ],
      });
      chooseGroupMode('Crop');
      expect(groupTitles()).toEqual(['SB', 'YC', 'HRW']);

      const rotations: string[][] = [];
      for (let i = 0; i < 4; i++) {
        component.handleSort('crop');
        render();
        rotations.push(groupTitles());
      }
      expect(rotations).toEqual([
        ['HRW', 'SB', 'YC'],
        ['SB', 'YC', 'HRW'],
        ['YC', 'HRW', 'SB'],
        ['SB', 'YC', 'HRW'],    // rotated past the last crop → crop sort switched off
      ]);
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  describe('search', () => {
    const searchable = (): Ticket[] => [
      makeTicket({ id: 1, ticketNumber: '100', productCode: 'YC', elevatorCode: 'PRT', date: '2026-05-10' }),
      makeTicket({ id: 2, ticketNumber: '200', shipmentTicketNumber: 'HAY-0200-01', productCode: 'SG', elevatorCode: 'HAY', elevatorCity: 'Hays', date: '2026-06-20' }),
      makeTicket({ id: 3, ticketNumber: '300', productCode: 'SB', elevatorCode: 'KRN', elevatorCity: 'Kearney', elevatorState: 'NE', date: '2026-07-04' }),
      makeTicket({ id: 4, ticketNumber: '101', productCode: 'YC', elevatorCode: 'PRT', date: '2026-05-11' }),
    ];

    const visibleTickets = (): string[] => groups().flatMap(g => ticketCol(g));

    it('filters by alias, shipment number, state name and date, auto-expanding the matching groups', () => {
      setInputs({ tickets: searchable() });
      expect(visibleTickets()).toEqual([]); // several groups → all collapsed before searching

      const cases: [string, string[]][] = [
        ['milo', ['HAY-0200-01']],        // commodity alias → SG
        ['hay-0200', ['HAY-0200-01']],    // full shipment number
        ['200', ['HAY-0200-01']],         // bare ticket sequence
        ['nebraska', ['300']],            // full state name from the abbreviation
        ['july', ['300']],                // month name
        ['5/10', ['100']],                // M/D date
      ];
      const results = cases.map(([query]) => { typeSearch(query); return visibleTickets(); });
      expect(results).toEqual(cases.map(([, expected]) => expected));
    });

    it('recomputes headers from the matches, says when nothing matched, and clear restores every group', () => {
      setInputs({ tickets: searchable() });
      expect(subtitle(groupByTitle('YC · PRT'))).toBe('2 tickets');

      typeSearch('101');

      expect(groupTitles()).toEqual(['YC · PRT']);
      expect(subtitle(groupByTitle('YC · PRT'))).toBe('1 ticket');
      expect(stat(groupByTitle('YC · PRT'), 'Avg Date')).toBe('5/11/2026');

      typeSearch('canola');
      expect(groups()).toHaveLength(0);
      expect(text()).toContain('No tickets match "canola"');

      host().querySelector<HTMLButtonElement>('button[title="Clear search"]')!.click();
      fixture.detectChanges();
      expect(groups()).toHaveLength(3);
      expect(visibleTickets()).toEqual([]);
      expect(text()).not.toContain('No tickets match');
    });
  });

  // ── Spot loads ────────────────────────────────────────────────────────────

  describe('spot loads', () => {
    it('flags recent unapplied tickets with no open, same-commodity contract covering their date', () => {
      setInputs({
        contracts: [
          makeContract({ id: 1, commodityCode: 'YC' }),
          makeContract({ id: 2, commodityCode: 'HRW', status: 'Fulfilled' }),
          makeContract({ id: 3, commodityCode: 'SG', closedDate: daysFromNow(-1) }),
        ],
        tickets: [
          makeTicket({ id: 1, productCode: 'SB', date: '2026-10-05' }),                  // no SB contract → Spot
          makeTicket({ id: 2, productCode: 'YC', date: '2026-10-06' }),                  // covered → not Spot
          makeTicket({ id: 3, productCode: 'HRW', date: '2026-10-06' }),                 // only a Fulfilled contract → Spot
          makeTicket({ id: 4, productCode: 'SG', date: '2026-10-06' }),                  // only a closed contract → Spot
          makeTicket({ id: 5, productCode: 'SB', ticketNumber: '9', date: '2026-08-01' }), // older than 30 days → not Spot
        ],
      });

      expect([...component.spotTicketIds()].sort()).toEqual([1, 3, 4]);
      expect(subtitle(groupByTitle('SB · PRT'))).toBe('2 tickets · 1 Spot');
      expect(subtitle(groupByTitle('YC · PRT'))).toBe('1 ticket');

      groupHeader(groupByTitle('SB · PRT')).click();
      fixture.detectChanges();
      const [old, recent] = rows(groupByTitle('SB · PRT'));
      expect(old.className).not.toContain('bg-amber-100');
      expect(recent.className).toContain('bg-amber-100');
    });
  });

  // ── Customer change ───────────────────────────────────────────────────────

  describe('customer change', () => {
    it('clears search, sort and expanded groups when a different producer is shown', () => {
      const tickets = [makeTicket({ id: 1, ticketNumber: '1', appliedDockQuantity: 112000 }),
        makeTicket({ id: 2, ticketNumber: '2', appliedDockQuantity: 56000, date: '2026-05-11' }),
        makeTicket({ id: 3, productCode: 'SB' })];
      setInputs({ tickets });
      groupHeader(groupByTitle('YC · PRT')).click();
      fixture.detectChanges();
      headerCell(groupByTitle('YC · PRT'), 'Net Bu').click();
      fixture.detectChanges();
      expect(ticketCol(groupByTitle('YC · PRT'))).toEqual(['2', '1']);
      typeSearch('yc');

      setInputs({ customer: makeCustomer({ id: 43 }) });

      expect(component.searchQuery).toBe('');
      expect(groups()).toHaveLength(2);
      expect(groups().every(g => rows(g).length === 0)).toBe(true);
      groupHeader(groupByTitle('YC · PRT')).click();
      fixture.detectChanges();
      expect(ticketCol(groupByTitle('YC · PRT'))).toEqual(['1', '2']); // default order again

      // The group mode is a user preference, not per-producer state — it survives the switch.
      chooseGroupMode('Elevator');
      setInputs({ customer: makeCustomer({ id: 44 }) });
      expect(groupTitles()).toEqual(['PRT']);
    });
  });
});
