import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ContractPacingCardComponent } from './contract-pacing-card.component';
import { ThemeService } from '@core/services/theme.service';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { Contract, HarvestWindow } from '@models';

// Behaviour safety net for the Harvest Contract Pace card: which contracts land in this year's vs
// last year's harvest window (commodity matching by group / description / code, inclusive date
// overlap), the per-commodity rows and their sort, the up / down / flat arrows, the open +
// historical merge (deduped by id), the self-fetch fallback when the parent supplies no history, and
// the "Unavailable" note when either side failed to read prior-year history. Everything is driven
// through the signal inputs and asserted on the rendered DOM, so the card can move to OnPush
// without this file changing.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Frozen "now" (Date only) — the card compares the CURRENT calendar year against the one before. */
const NOW = new Date('2026-10-13T12:00:00');
const THIS_YEAR = 2026;
const LAST_YEAR = 2025;

/** Noon local time on a calendar date — month is 1-based to read like the harvest windows. */
function on(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function makeWindow(over: Partial<HarvestWindow> = {}): HarvestWindow {
  return {
    id: 1, commodity: 'Corn',
    deliveryStartMonth: 9, deliveryStartDay: 1,
    deliveryEndMonth: 11, deliveryEndDay: 30,
    isActive: true, ...over,
  };
}

/** A 10,000 BU corn contract delivering squarely inside this year's corn harvest window. */
function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 42, farmId: 'F1', contractNumber: '100',
    commodityCode: 'YC', commodityDescription: 'Yellow Corn', commodityGroup: 'Corn',
    quantity: 10000, unit: 'BU', price: 0,
    deliveryStart: on(THIS_YEAR, 10, 1), deliveryEnd: on(THIS_YEAR, 10, 31),
    status: 'Active', signed: true, ...over,
  };
}

/** Soybean variant of {@link makeContract}. */
function makeSoyContract(over: Partial<Contract> = {}): Contract {
  return makeContract({ commodityGroup: 'Soybeans', commodityDescription: 'Soybeans', commodityCode: 'SB', ...over });
}

const CORN = makeWindow({ id: 1, commodity: 'Corn' });
const SOYBEANS = makeWindow({ id: 2, commodity: 'Soybeans', deliveryStartMonth: 9, deliveryStartDay: 15, deliveryEndMonth: 11, deliveryEndDay: 15 });
const WHEAT = makeWindow({ id: 3, commodity: 'Wheat', deliveryStartMonth: 6, deliveryStartDay: 1, deliveryEndMonth: 7, deliveryEndDay: 31 });

// ── Harness ───────────────────────────────────────────────────────────────────

describe('ContractPacingCardComponent', () => {
  let fixture: ComponentFixture<ContractPacingCardComponent>;
  let ref: ComponentRef<ContractPacingCardComponent>;
  let getHistoricalContractsForPacing: ReturnType<typeof vi.fn>;

  function setInputs(inputs: {
    contracts?: Contract[]; harvestWindows?: HarvestWindow[]; customerId?: number | null;
    historicalContracts?: Contract[]; parentHistoryLoadFailed?: boolean;
  }): void {
    for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const textOf = (el: Element): string => (el.textContent ?? '').trim();

  interface RenderedRow { commodity: string; lastYear: string; thisYear: string; arrow: string; tooltip: string }
  /** Each commodity row, read off the DOM. The commodity cell is the one carrying the window tooltip. */
  const rows = (): RenderedRow[] =>
    Array.from(host().querySelectorAll<HTMLElement>('[title^="Harvest window:"]')).map(cell => {
      const cells = Array.from(cell.parentElement!.children);
      return {
        commodity: textOf(cell),
        lastYear: textOf(cells[1]),
        thisYear: textOf(cells[2]),
        arrow: textOf(cells[3]),
        tooltip: cell.getAttribute('title') ?? '',
      };
    });

  /** The two summary stat cards: [last year, this year]. */
  const statCards = (): { label: string; value: string }[] =>
    Array.from(host().querySelectorAll<HTMLElement>('.grid.grid-cols-2 > div')).map(card => {
      const [label, value] = Array.from(card.children);
      return { label: textOf(label), value: textOf(value) };
    });

  /** The total row, found by its label. Empty when the breakdown isn't rendered. */
  const totalRow = (): string[] => {
    const label = Array.from(host().querySelectorAll('span')).find(s => textOf(s) === 'Total Bushels');
    return label ? Array.from(label.parentElement!.children).map(textOf) : [];
  };

  /** The big arrow beside the card title (only rendered when there is something to compare). */
  const headerArrow = (): string | null => {
    const span = host().querySelector('h3 + span');
    return span ? textOf(span) : null;
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    getHistoricalContractsForPacing = vi.fn(() => of<Contract[]>([]));
    await TestBed.configureTestingModule({
      imports: [ContractPacingCardComponent],
      providers: [
        { provide: ThemeService, useValue: { isDarkMode: signal(false) } },
        { provide: ApiService, useValue: { getHistoricalContractsForPacing } },
        { provide: AppStateService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ContractPacingCardComponent);
    ref = fixture.componentRef;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Year bucketing ────────────────────────────────────────────────────────

  it('totals each commodity\'s contracts into this year\'s and last year\'s harvest window and shows the trend', () => {
    setInputs({
      harvestWindows: [CORN],
      contracts: [
        makeContract({ id: 1, quantity: 10000 }),
        makeContract({ id: 2, quantity: 2500, deliveryStart: on(THIS_YEAR, 11, 1), deliveryEnd: on(THIS_YEAR, 12, 15) }), // overlaps the tail
        makeContract({ id: 3, quantity: 4000, deliveryStart: on(LAST_YEAR, 9, 10), deliveryEnd: on(LAST_YEAR, 10, 10) }),
        makeContract({ id: 4, quantity: 99999, deliveryStart: on(THIS_YEAR, 1, 1), deliveryEnd: on(THIS_YEAR, 3, 31) }),  // off-window
      ],
    });

    expect(rows()).toEqual([
      { commodity: 'Corn', lastYear: '4,000', thisYear: '12,500', arrow: '▲', tooltip: 'Harvest window: Sep 1 – Nov 30' },
    ]);
    expect(statCards()).toEqual([
      { label: String(LAST_YEAR), value: '4,000' },
      { label: String(THIS_YEAR), value: '12,500' },
    ]);
    expect(totalRow()).toEqual(['Total Bushels', '4,000', '12,500', '▲']);
    expect(headerArrow()).toBe('▲');
  });

  it('treats the window as inclusive on both ends and counts a contract spanning both seasons in each', () => {
    setInputs({
      harvestWindows: [CORN],
      contracts: [
        // Ends on the window's first day → overlaps.
        makeContract({ id: 1, quantity: 100, deliveryStart: on(THIS_YEAR, 8, 1), deliveryEnd: on(THIS_YEAR, 9, 1) }),
        // Starts late on the window's last day → still inside (the whole end day is included).
        makeContract({ id: 2, quantity: 200, deliveryStart: new Date(THIS_YEAR, 10, 30, 23, 0), deliveryEnd: on(THIS_YEAR, 12, 31) }),
        // Ends the day before the window opens → out.
        makeContract({ id: 3, quantity: 400, deliveryStart: on(THIS_YEAR, 8, 1), deliveryEnd: on(THIS_YEAR, 8, 31) }),
        // A multi-year contract overlaps both seasons and is counted in both.
        makeContract({ id: 4, quantity: 1000, deliveryStart: on(LAST_YEAR, 10, 1), deliveryEnd: on(THIS_YEAR, 10, 1) }),
      ],
    });

    expect(rows().map(r => [r.lastYear, r.thisYear])).toEqual([['1,000', '1,300']]);
  });

  it('uses a single delivery date as both ends and skips contracts with no delivery dates at all', () => {
    setInputs({
      harvestWindows: [CORN],
      contracts: [
        makeContract({ id: 1, quantity: 300, deliveryStart: undefined, deliveryEnd: on(THIS_YEAR, 10, 5) }),
        makeContract({ id: 2, quantity: 700, deliveryStart: on(LAST_YEAR, 10, 5), deliveryEnd: undefined }),
        makeContract({ id: 3, quantity: 50000, deliveryStart: undefined, deliveryEnd: undefined }),
      ],
    });

    expect(rows().map(r => [r.lastYear, r.thisYear])).toEqual([['700', '300']]);
  });

  // ── Commodity matching ────────────────────────────────────────────────────

  it('matches a window\'s commodity by group (exact), description (contains) or code (contains), ignoring case', () => {
    const june = { deliveryStart: on(THIS_YEAR, 6, 10), deliveryEnd: on(THIS_YEAR, 6, 20) };
    setInputs({
      harvestWindows: [makeWindow({ commodity: ' WHEAT ', deliveryStartMonth: 6, deliveryStartDay: 1, deliveryEndMonth: 7, deliveryEndDay: 31 })],
      contracts: [
        makeContract({ id: 1, quantity: 1, commodityGroup: 'wheat', commodityDescription: 'x', commodityCode: 'x', ...june }),
        makeContract({ id: 2, quantity: 10, commodityGroup: undefined, commodityDescription: 'Hard Red Winter Wheat', commodityCode: 'HRW', ...june }),
        makeContract({ id: 3, quantity: 100, commodityGroup: '', commodityDescription: '', commodityCode: 'wheatsrw', ...june }),
        // Group is NOT a contains-match: "Wheat Feed" ≠ "WHEAT", and nothing else on it mentions wheat.
        makeContract({ id: 4, quantity: 1000, commodityGroup: 'Wheat Feed', commodityDescription: 'Mill feed', commodityCode: 'MF', ...june }),
      ],
    });

    expect(rows()).toHaveLength(1);
    expect(rows()[0].commodity).toBe('WHEAT');
    expect(rows()[0].thisYear).toBe('111');
  });

  // ── Rows: filtering, sort, direction ──────────────────────────────────────

  it('sorts rows by this year\'s bushels, drops commodities with nothing in either year and ignores inactive windows', () => {
    setInputs({
      harvestWindows: [WHEAT, CORN, SOYBEANS, makeWindow({ id: 9, commodity: 'Sorghum', isActive: false })],
      contracts: [
        makeContract({ id: 1, quantity: 5000 }),
        makeSoyContract({ id: 2, quantity: 20000 }),
        makeSoyContract({ id: 3, quantity: 9000, deliveryStart: on(LAST_YEAR, 10, 1), deliveryEnd: on(LAST_YEAR, 10, 31) }),
        makeContract({ id: 4, quantity: 7777, commodityGroup: 'Sorghum', commodityDescription: 'Milo', commodityCode: 'MI' }), // inactive window
        // No wheat contracts → no wheat row.
      ],
    });

    expect(rows().map(r => r.commodity)).toEqual(['Soybeans', 'Corn']);
    expect(totalRow()).toEqual(['Total Bushels', '9,000', '25,000', '▲']);
  });

  it('shows a down arrow when behind last year and a flat dash when level, with em-dashes for empty years', () => {
    setInputs({
      harvestWindows: [CORN, SOYBEANS],
      contracts: [
        makeContract({ id: 1, quantity: 3000, deliveryStart: on(LAST_YEAR, 10, 1), deliveryEnd: on(LAST_YEAR, 10, 31) }), // corn: last year only
        makeSoyContract({ id: 2, quantity: 500 }),
        makeSoyContract({ id: 3, quantity: 500, deliveryStart: on(LAST_YEAR, 10, 1), deliveryEnd: on(LAST_YEAR, 10, 31) }),
      ],
    });

    expect(rows()).toEqual([
      expect.objectContaining({ commodity: 'Soybeans', lastYear: '500', thisYear: '500', arrow: '—' }),
      expect.objectContaining({ commodity: 'Corn', lastYear: '3,000', thisYear: '—', arrow: '▼' }),
    ]);
    expect(totalRow()).toEqual(['Total Bushels', '3,500', '500', '▼']);
    expect(headerArrow()).toBe('▼');
  });

  it('renders the empty state — no breakdown, no header arrow, em-dashes in both stat cards — when nothing matches', () => {
    setInputs({ harvestWindows: [CORN], contracts: [makeContract({ deliveryStart: on(THIS_YEAR, 1, 1), deliveryEnd: on(THIS_YEAR, 2, 1) })] });

    expect(rows()).toEqual([]);
    expect(totalRow()).toEqual([]);
    expect(headerArrow()).toBeNull();
    expect(statCards().map(c => c.value)).toEqual(['—', '—']);
  });

  // ── Historical contracts ──────────────────────────────────────────────────

  it('merges parent-supplied historical contracts into last year, deduped by id, and does not self-fetch', () => {
    const lastOctober = { deliveryStart: on(LAST_YEAR, 10, 1), deliveryEnd: on(LAST_YEAR, 10, 31) };
    setInputs({
      customerId: 42,
      harvestWindows: [CORN],
      contracts: [makeContract({ id: 1, quantity: 10000 })],
      historicalContracts: [
        makeContract({ id: 1, quantity: 10000 }),                // same id as an open contract → not double-counted
        makeContract({ id: 50, quantity: 8000, ...lastOctober }),
        makeContract({ id: 50, quantity: 8000, ...lastOctober }), // duplicated within the history itself
      ],
    });

    expect(getHistoricalContractsForPacing).not.toHaveBeenCalled();
    expect(rows().map(r => [r.lastYear, r.thisYear])).toEqual([['8,000', '10,000']]);
  });

  it('self-fetches the producer\'s history when the parent supplies none, and merges it into the comparison', () => {
    getHistoricalContractsForPacing.mockReturnValue(of([
      makeContract({ id: 70, quantity: 15000, deliveryStart: on(LAST_YEAR, 9, 1), deliveryEnd: on(LAST_YEAR, 11, 30) }),
    ]));

    setInputs({ customerId: 42, harvestWindows: [CORN], contracts: [makeContract({ id: 1, quantity: 10000 })] });
    fixture.detectChanges();

    expect(getHistoricalContractsForPacing).toHaveBeenCalledWith(42);
    expect(rows().map(r => [r.lastYear, r.thisYear, r.arrow])).toEqual([['15,000', '10,000', '▼']]);
  });

  it('does not self-fetch without a customer id', () => {
    setInputs({ customerId: null, harvestWindows: [CORN], contracts: [makeContract()] });

    expect(getHistoricalContractsForPacing).not.toHaveBeenCalled();
    expect(statCards()[0].value).toBe('—');
  });

  it('labels last year "Unavailable" when the self-fetch fails, instead of an em-dash that reads as zero', () => {
    getHistoricalContractsForPacing.mockReturnValue(throwError(() => new Error('CTRM down')));

    setInputs({ customerId: 42, harvestWindows: [CORN], contracts: [makeContract({ quantity: 10000 })] });
    fixture.detectChanges();

    expect(statCards()).toEqual([
      { label: String(LAST_YEAR), value: 'Unavailable' },
      { label: String(THIS_YEAR), value: '10,000' },
    ]);
  });

  it('labels last year "Unavailable" while the parent reports its own history read failed', () => {
    setInputs({
      harvestWindows: [CORN],
      contracts: [makeContract({ quantity: 10000 })],
      historicalContracts: [makeContract({ id: 9, quantity: 1, deliveryStart: on(LAST_YEAR, 10, 1), deliveryEnd: on(LAST_YEAR, 10, 2) })],
      parentHistoryLoadFailed: true,
    });

    expect(statCards()[0].value).toBe('Unavailable');

    setInputs({ parentHistoryLoadFailed: false });
    expect(statCards()[0].value).toBe('1');
  });

  it('recomputes when the contracts input changes', () => {
    setInputs({ harvestWindows: [CORN], contracts: [makeContract({ id: 1, quantity: 1000 })] });
    expect(statCards()[1].value).toBe('1,000');

    setInputs({ contracts: [makeContract({ id: 1, quantity: 1000 }), makeContract({ id: 2, quantity: 2000 })] });
    expect(statCards()[1].value).toBe('3,000');
    expect(rows()[0].thisYear).toBe('3,000');
  });
});
