import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { StoredGrainTableComponent } from './stored-grain-table.component';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, StoredGrain } from '@models';

// Behaviour safety net for the Storage tab: the loading / empty states, grouping receipts by
// crop / location / both (with the "No location" fallback), the per-group header totals
// (ticket count, earliest date, bushels, accumulated cost, cents per bushel), the auto-expand of a
// lone group and click-to-expand (tracked + scrolled into view), the receipt rows and their
// default Charged-From ordering, header sorting, and the search filter (commodity aliases, receipt
// number, facility city/state, date) with its re-totalled groups. Everything is driven through the
// signal inputs and the rendered DOM — the component is already OnPush, so every interaction here
// goes through a real DOM event exactly as a user's would; nothing calls a method directly.
//
// The component is purely input-driven: no ApiService. UsageTrackingService only records group opens.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Noon local time so no date can straddle midnight in any timezone. */
const day = (iso: string): Date => new Date(`${iso}T12:00:00`);

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: 'Sample Farms', location: 'Pratt, KS',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

/** A 1,000 BU corn warehouse receipt at the Pratt facility that has accrued $50.00 of storage. */
function makeGrain(over: Partial<StoredGrain> = {}): StoredGrain {
  const receiptNumber = over.receiptNumber ?? '1001';
  return {
    id: `${receiptNumber}|PRT`,
    receiptNumber,
    customerId: 42,
    customerCode: 'SAMPFRM',
    crop: 'Corn',
    quantity: 1000,
    grossQuantity: 1000,
    storageStartDate: day('2026-03-15'),
    storageRate: 0.035,
    bin: 'B1',
    receivableAmount: 50,
    storageDays: 30,
    chargedFromDate: day('2026-04-01'),
    chargedThruDate: day('2026-05-01'),
    locationCity: 'PRATT',
    locationState: 'KS',
    bushels: 1000,
    dateReceived: day('2026-03-15'),
    ...over,
  };
}

// ── Harness ───────────────────────────────────────────────────────────────────

describe('StoredGrainTableComponent', () => {
  let fixture: ComponentFixture<StoredGrainTableComponent>;
  let ref: ComponentRef<StoredGrainTableComponent>;
  let trackStorageDropdownOpen: ReturnType<typeof vi.fn>;
  let scrollIntoView: MockInstance<Element['scrollIntoView']>;

  function setInputs(inputs: { storedGrain?: StoredGrain[]; isLoading?: boolean; customer?: Customer }): void {
    for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
    fixture.detectChanges();
  }

  const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => norm(host().textContent);
  const buttonByText = (label: string): HTMLButtonElement =>
    Array.from(host().querySelectorAll('button')).find(b => norm(b.textContent) === label) as HTMLButtonElement;

  /** One bordered card per receipt group. */
  const groups = (): HTMLElement[] => Array.from(host().querySelectorAll<HTMLElement>('div.rounded-lg.border'));
  const groupTitles = (): string[] => groups().map(g => norm(g.querySelector('p.font-semibold')?.textContent));
  const groupByTitle = (title: string): HTMLElement => groups().find(g => norm(g.querySelector('p.font-semibold')?.textContent) === title)!;
  const subtitle = (g: HTMLElement): string => norm(g.querySelector('div.min-w-0 p.text-xs')?.textContent);
  const groupHeader = (g: HTMLElement): HTMLElement => g.querySelector<HTMLElement>('div.cursor-pointer.select-none')!;
  /** A header total by its label, e.g. stat(g, 'Bushels') → '1,000 bu'. */
  const stat = (g: HTMLElement, label: string): string | undefined => {
    const box = Array.from(g.querySelectorAll('div.text-center')).find(d => norm(d.querySelector('p')?.textContent) === label);
    return box ? norm(box.querySelectorAll('p')[1]?.textContent) : undefined;
  };
  const rows = (g: HTMLElement): HTMLTableRowElement[] => Array.from(g.querySelectorAll('tbody tr'));
  const cells = (row: HTMLTableRowElement): string[] => Array.from(row.querySelectorAll('td')).map(td => norm(td.textContent));
  const receiptCol = (g: HTMLElement): string[] => rows(g).map(r => cells(r)[0]);
  const headerCell = (g: HTMLElement, label: string): HTMLElement =>
    Array.from(g.querySelectorAll<HTMLElement>('thead th')).find(th => norm(th.textContent) === label)!;

  function click(el: HTMLElement): void {
    el.click();
    fixture.detectChanges();
  }

  function typeSearch(q: string): void {
    const input = host().querySelector<HTMLInputElement>('input[placeholder="Search storage..."]')!;
    input.value = q;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function chooseGroupMode(label: 'Crop & Location' | 'Crop' | 'Location'): void {
    if (!buttonByText(label)) click(buttonByText('Filter Storage'));
    click(buttonByText(label));
  }

  beforeEach(async () => {
    // setTimeout is faked too: opening a group scrolls it into view 50 ms later.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(day('2026-10-13'));
    scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    trackStorageDropdownOpen = vi.fn();
    await TestBed.configureTestingModule({
      imports: [StoredGrainTableComponent],
      providers: [{ provide: UsageTrackingService, useValue: { trackStorageDropdownOpen } }],
    }).compileComponents();
    fixture = TestBed.createComponent(StoredGrainTableComponent);
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer());
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    scrollIntoView.mockRestore();
  });

  // ── Loading / empty ───────────────────────────────────────────────────────

  it('shows the spinner while loading (even with receipts), and the empty state once loaded with none', () => {
    setInputs({ isLoading: true, storedGrain: [makeGrain()] });
    expect(text()).toContain('Loading storage...');
    expect(groups()).toHaveLength(0);

    setInputs({ isLoading: false, storedGrain: [] });
    expect(text()).not.toContain('Loading storage...');
    expect(text()).toContain('No grain currently in storage for this producer');
    expect(host().querySelector('input[placeholder="Search storage..."]')).toBeNull();
  });

  // ── Grouping & header totals ──────────────────────────────────────────────

  describe('grouping', () => {
    it('groups by crop by default, alphabetically, with count, earliest date, bushels, cost and cents/bu', () => {
      setInputs({
        storedGrain: [
          makeGrain({ receiptNumber: '1', crop: 'Soybeans', quantity: 400, receivableAmount: 10 }),
          makeGrain({ receiptNumber: '2', crop: 'Corn', quantity: 1000, receivableAmount: 50, storageStartDate: day('2026-03-15') }),
          makeGrain({ receiptNumber: '3', crop: 'Corn', quantity: 500, receivableAmount: 25.5, storageStartDate: day('2026-02-01'), locationCity: 'HAYS' }),
          makeGrain({ receiptNumber: '4', crop: '', quantity: 0, receivableAmount: 0 }),
        ],
      });

      expect(groupTitles()).toEqual(['Corn', 'Soybeans', 'Unknown']);

      const corn = groupByTitle('Corn');
      expect(subtitle(corn)).toBe('2 tickets · Since 2/1/2026');           // earliest storage start, any location
      expect(stat(corn, 'Bushels')).toBe('1,500 bu');
      expect(stat(corn, 'Accumulated Cost')).toBe('$75.50');
      expect(stat(corn, 'Cents/Bu')).toBe('5.03¢');                         // 75.50 / 1,500 × 100

      expect(subtitle(groupByTitle('Soybeans'))).toBe('1 ticket · Since 3/15/2026');
      expect(stat(groupByTitle('Unknown'), 'Cents/Bu')).toBe('—');          // no bushels → no divide-by-zero
    });

    it('regroups by location or crop & location from the Filter bar, with a "No location" fallback', () => {
      setInputs({
        storedGrain: [
          makeGrain({ receiptNumber: '1', crop: 'Corn' }),
          makeGrain({ receiptNumber: '2', crop: 'Soybeans' }),
          makeGrain({ receiptNumber: '3', crop: 'Corn', locationCity: 'HAYS', locationState: ' ' }),   // city only
          makeGrain({ receiptNumber: '4', crop: 'Corn', locationCity: '', locationState: '' }),
        ],
      });

      chooseGroupMode('Location');
      // Sorted as a set: in Location mode the order follows each group's first crop, not the location.
      expect([...groupTitles()].sort()).toEqual(['HAYS', 'No location', 'PRATT, KS']);
      expect(subtitle(groupByTitle('PRATT, KS'))).toBe('2 tickets · Since 3/15/2026');
      expect(stat(groupByTitle('PRATT, KS'), 'Bushels')).toBe('2,000 bu');

      chooseGroupMode('Crop & Location');
      expect(groupTitles()).toEqual(['Corn · HAYS', 'Corn · No location', 'Corn · PRATT, KS', 'Soybeans · PRATT, KS']);

      chooseGroupMode('Crop');
      expect(groupTitles()).toEqual(['Corn', 'Soybeans']);
    });
  });

  // ── Expand / collapse ─────────────────────────────────────────────────────

  describe('expand / collapse', () => {
    it('auto-expands a lone group', () => {
      setInputs({ storedGrain: [makeGrain({ receiptNumber: '1' }), makeGrain({ receiptNumber: '2' })] });

      expect(receiptCol(groups()[0])).toEqual(['1', '2']);
      expect(trackStorageDropdownOpen).not.toHaveBeenCalled();
    });

    it('starts several groups collapsed; a header click opens one (tracked, scrolled into view) and a second click closes it', () => {
      setInputs({ storedGrain: [makeGrain({ receiptNumber: '1', crop: 'Corn' }), makeGrain({ receiptNumber: '2', crop: 'Soybeans' })] });
      expect(groups().every(g => rows(g).length === 0)).toBe(true);

      const beans = groupByTitle('Soybeans');
      click(groupHeader(beans));
      expect(rows(groupByTitle('Soybeans'))).toHaveLength(1);
      expect(rows(groupByTitle('Corn'))).toHaveLength(0);
      expect(trackStorageDropdownOpen).toHaveBeenCalledTimes(1);

      expect(scrollIntoView).not.toHaveBeenCalled();
      vi.advanceTimersByTime(50);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(beans);               // the whole card, not just its header

      click(groupHeader(groupByTitle('Soybeans')));
      expect(rows(groupByTitle('Soybeans'))).toHaveLength(0);
      expect(trackStorageDropdownOpen).toHaveBeenCalledTimes(1);          // closing is not tracked
    });
  });

  // ── Receipt rows & sorting ────────────────────────────────────────────────

  describe('receipt rows', () => {
    it('renders the charged window, facility, bushels, days, rate and the receipt\'s own cost', () => {
      setInputs({
        storedGrain: [
          makeGrain({ receiptNumber: '1001', quantity: 1234, storageDays: 30.46, storageRate: 0.05, receivableAmount: 52.4 }),
          makeGrain({ receiptNumber: '1002', locationCity: '', locationState: 'KS', chargedFromDate: day('2026-04-02'), chargedThruDate: day('2026-05-02') }),
          makeGrain({ receiptNumber: '1003', locationCity: '', locationState: '', chargedFromDate: day('2026-04-03') }),
        ],
      });

      const [first, second, third] = rows(groups()[0]);
      expect(cells(first)).toEqual(['1001', '4/1/26 – 5/1/26', 'PRATT, KS', '1,234', '30.5', '$0.050', '$52.40']);
      expect(cells(second)[2]).toBe('KS');
      expect(cells(third)[2]).toBe('—');
    });

    it('orders receipts by Charged From (falling back to storage start), then numeric receipt #', () => {
      setInputs({
        storedGrain: [
          makeGrain({ receiptNumber: '7', chargedFromDate: day('2026-04-05') }),
          makeGrain({ receiptNumber: '1000', chargedFromDate: day('2026-04-01') }),
          makeGrain({ receiptNumber: '999', chargedFromDate: day('2026-04-01') }),
          makeGrain({ receiptNumber: '50', chargedFromDate: null, storageStartDate: day('2026-04-03') }),
        ],
      });

      expect(receiptCol(groups()[0])).toEqual(['999', '1000', '50', '7']);
    });

    it('cycles a column header through ascending, descending and back to the default order', () => {
      setInputs({
        storedGrain: [
          makeGrain({ receiptNumber: '1', receivableAmount: 20, chargedFromDate: day('2026-04-01') }),
          makeGrain({ receiptNumber: '2', receivableAmount: 90, chargedFromDate: day('2026-04-02') }),
          makeGrain({ receiptNumber: '3', receivableAmount: 5, chargedFromDate: day('2026-04-03') }),
        ],
      });

      const order: string[][] = [];
      for (let i = 0; i < 3; i++) {
        click(headerCell(groups()[0], 'Storage Amount'));
        order.push(receiptCol(groups()[0]));
      }
      expect(order).toEqual([
        ['3', '1', '2'],
        ['2', '1', '3'],
        ['1', '2', '3'],   // sort cleared → Charged From order
      ]);
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  describe('search', () => {
    const receipts = (): StoredGrain[] => [
      makeGrain({ receiptNumber: '1001', crop: 'Corn', quantity: 1000, receivableAmount: 50 }),
      makeGrain({ receiptNumber: '1002', crop: 'Corn', quantity: 500, receivableAmount: 20, locationCity: 'HAYS', storageStartDate: day('2026-01-20') }),
      makeGrain({ receiptNumber: '2001', crop: 'Sorghum', locationCity: 'BEATRICE', locationState: 'NE' }),
    ];

    it('matches commodity aliases, receipt number, facility city / state and storage date', () => {
      setInputs({ storedGrain: receipts() });

      const cases: [string, string[]][] = [
        ['milo', ['Sorghum']],         // alias → Sorghum
        ['1002', ['Corn']],            // receipt number
        ['beatrice', ['Sorghum']],     // facility city
        ['ne', ['Sorghum']],           // facility state
        ['1/20/2026', ['Corn']],       // storage start date, M/D/YYYY
      ];
      const results = cases.map(([query]) => { typeSearch(query); return groupTitles(); });
      expect(results).toEqual(cases.map(([, expected]) => expected));
    });

    it('re-totals a group from its matching receipts, says when nothing matched, and the clear button restores all', () => {
      setInputs({ storedGrain: receipts() });

      typeSearch('hays');
      const corn = groupByTitle('Corn');
      expect(subtitle(corn)).toContain('1 ticket ·');
      expect(stat(corn, 'Bushels')).toBe('500 bu');
      expect(stat(corn, 'Accumulated Cost')).toBe('$20.00');
      expect(stat(corn, 'Cents/Bu')).toBe('4.00¢');

      typeSearch('canola');
      expect(groups()).toHaveLength(0);
      expect(text()).toContain('No storage matches "canola"');

      click(host().querySelector<HTMLButtonElement>('button[title="Clear search"]')!);
      expect(groupTitles()).toEqual(['Corn', 'Sorghum']);
      expect(stat(groupByTitle('Corn'), 'Bushels')).toBe('1,500 bu');
      expect(text()).not.toContain('No storage matches');
    });

    it('drops the search and re-applies auto-expand when a new set of receipts arrives', () => {
      setInputs({ storedGrain: receipts() });
      typeSearch('canola');
      expect(groups()).toHaveLength(0);

      setInputs({ customer: makeCustomer({ id: 43 }), storedGrain: [makeGrain({ receiptNumber: '9' })] });

      expect(text()).not.toContain('No storage matches');
      expect(host().querySelector('button[title="Clear search"]')).toBeNull();
      expect(receiptCol(groupByTitle('Corn'))).toEqual(['9']);
    });
  });
});
