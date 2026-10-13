import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { YearOverYearChartComponent } from './year-over-year-chart.component';
import { ThemeService } from '@core/services/theme.service';
import { Contract } from '@models';

// Behaviour safety net for the Year-over-Year chart: contracts bucketed by the YEAR of their
// delivery start, columns in ascending year order, volume (Σ quantity) and revenue (Σ quantity ×
// price) per year, bar heights as a percentage of the tallest year with a 5% floor, the single
// zero column for the current year when there is no data, and the summary totals (bushels with
// thousands separators, revenue abbreviated to K / M). The chart is plain divs — no canvas — so the
// real template renders. The aggregation runs in an effect that writes plain fields, which is
// exactly what an OnPush conversion can break; every test therefore asserts on the rendered DOM
// after a setInput, including one that changes the input a second time.
//
// Revenue assertions match the WHOLE text. The template once wrote `\${{ … }}` (an escape carried
// over from an inline backtick template), so the page rendered a literal backslash, "\$1K". Fixed
// 2026-10-13; the exact match is what keeps it fixed.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Frozen "now" (Date only) — the empty chart shows the current year. */
const NOW = new Date('2026-10-13T12:00:00');

/** Noon local time on a calendar date (1-based month). */
function on(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** 1,000 BU at $4.00 delivering in spring 2026. */
function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 42, farmId: 'F1', contractNumber: '100',
    commodityCode: 'YC', commodityDescription: 'Corn', commodityGroup: 'Corn',
    quantity: 1000, unit: 'BU', price: 4,
    deliveryStart: on(2026, 4, 1), deliveryEnd: on(2026, 6, 30),
    status: 'Active', signed: true, ...over,
  };
}

// ── Harness ───────────────────────────────────────────────────────────────────

describe('YearOverYearChartComponent', () => {
  let fixture: ComponentFixture<YearOverYearChartComponent>;
  let ref: ComponentRef<YearOverYearChartComponent>;

  function setContracts(contracts: Contract[]): void {
    ref.setInput('contracts', contracts);
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const textOf = (el: Element | null): string => (el?.textContent ?? '').trim();

  interface Column { year: string; volumeHeight: string; revenueHeight: string }
  /** One entry per rendered year column: its label and the two bar heights (inline style). */
  const columns = (): Column[] =>
    Array.from(host().querySelectorAll<HTMLElement>('.flex.flex-col.items-center.gap-2')).map(col => {
      const [volume, revenue] = Array.from(col.querySelectorAll<HTMLElement>('.rounded-t-md'));
      return { year: textOf(col.querySelector('span')), volumeHeight: volume.style.height, revenueHeight: revenue.style.height };
    });

  /** The two summary figures: [Total Bushels, Total Revenue]. */
  const summary = (): { bushels: string; revenue: string } => {
    const figures = Array.from(host().querySelectorAll('.text-2xl.font-bold')).map(textOf);
    return { bushels: figures[0], revenue: figures[1] };
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await TestBed.configureTestingModule({
      imports: [YearOverYearChartComponent],
      providers: [{ provide: ThemeService, useValue: { isDarkMode: signal(false) } }],
    }).compileComponents();
    fixture = TestBed.createComponent(YearOverYearChartComponent);
    ref = fixture.componentRef;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws one column per delivery-start year, oldest first, whatever order the contracts arrive in', () => {
    setContracts([
      makeContract({ id: 1, deliveryStart: on(2026, 3, 1) }),
      makeContract({ id: 2, deliveryStart: on(2024, 3, 1) }),
      makeContract({ id: 3, deliveryStart: on(2025, 3, 1) }),
      makeContract({ id: 4, deliveryStart: on(2024, 11, 1) }),
    ]);

    expect(columns().map(c => c.year)).toEqual(['2024', '2025', '2026']);
  });

  it('buckets by the delivery START year, even when delivery runs into the next year', () => {
    setContracts([
      makeContract({ id: 1, quantity: 500, deliveryStart: on(2025, 12, 1), deliveryEnd: on(2026, 2, 28) }),
      makeContract({ id: 2, quantity: 300, deliveryStart: on(2026, 1, 1), deliveryEnd: on(2026, 2, 28) }),
    ]);

    expect(columns().map(c => c.year)).toEqual(['2025', '2026']);
    expect(summary().bushels).toBe('800');
  });

  it('scales volume and revenue bars independently, each against its own tallest year', () => {
    setContracts([
      makeContract({ id: 1, quantity: 2000, price: 5, deliveryStart: on(2025, 4, 1) }), // vol 2,000  rev 10,000
      makeContract({ id: 2, quantity: 1000, price: 4, deliveryStart: on(2026, 4, 1) }), // vol 1,000  rev  4,000
      makeContract({ id: 3, quantity: 500, price: 6, deliveryStart: on(2026, 9, 1) }),  // vol +500   rev +3,000
    ]);

    // 2026: volume 1,500 / 2,000 = 75%; revenue (4,000 + 3,000) / 10,000 = 70%.
    expect(columns()).toEqual([
      { year: '2025', volumeHeight: '100%', revenueHeight: '100%' },
      { year: '2026', volumeHeight: '75%', revenueHeight: '70%' },
    ]);
    expect(summary().bushels).toBe('3,500');
    expect(summary().revenue).toMatch(/^\$17K$/);
  });

  it('floors a short bar at 5% so a small year stays visible', () => {
    setContracts([
      makeContract({ id: 1, quantity: 100000, price: 4, deliveryStart: on(2025, 4, 1) }),
      makeContract({ id: 2, quantity: 2000, price: 4, deliveryStart: on(2026, 4, 1) }),  // 2% of max
      makeContract({ id: 3, quantity: 25000, price: 0, deliveryStart: on(2024, 4, 1) }), // 25% volume, zero revenue
    ]);

    expect(columns()).toEqual([
      { year: '2024', volumeHeight: '25%', revenueHeight: '5%' },
      { year: '2025', volumeHeight: '100%', revenueHeight: '100%' },
      { year: '2026', volumeHeight: '5%', revenueHeight: '5%' },
    ]);
  });

  it('totals bushels across every year with thousands separators', () => {
    setContracts([
      makeContract({ id: 1, quantity: 12500, deliveryStart: on(2025, 4, 1) }),
      makeContract({ id: 2, quantity: 7500, deliveryStart: on(2026, 4, 1) }),
    ]);

    expect(summary().bushels).toBe('20,000');
  });

  it('totals revenue as quantity × price, abbreviated to whole thousands (floored) or one-decimal millions', () => {
    setContracts([makeContract({ quantity: 999, price: 1 })]);
    expect(summary().revenue).toMatch(/^\$999$/);

    setContracts([makeContract({ quantity: 1000, price: 1.999 })]);   // 1,999 → floored, not rounded
    expect(summary().revenue).toMatch(/^\$1K$/);

    setContracts([
      makeContract({ id: 1, quantity: 300000, price: 4.5, deliveryStart: on(2025, 4, 1) }), // 1,350,000
      makeContract({ id: 2, quantity: 250000, price: 4, deliveryStart: on(2026, 4, 1) }),   // 1,000,000
    ]);
    expect(summary().revenue).toMatch(/^\$2\.4M$/);                    // 2,350,000 → toFixed(1)
  });

  it('shows a single zero column for the current year, with floor-height bars, when there are no contracts', () => {
    setContracts([]);

    expect(columns()).toEqual([{ year: '2026', volumeHeight: '5%', revenueHeight: '5%' }]);
    expect(summary().bushels).toBe('0');
    expect(summary().revenue).toMatch(/^\$0$/);
  });

  it('re-aggregates and re-renders when the contracts input is replaced', () => {
    setContracts([makeContract({ id: 1, quantity: 1000, deliveryStart: on(2024, 4, 1) })]);
    expect(columns().map(c => c.year)).toEqual(['2024']);
    expect(summary().bushels).toBe('1,000');

    setContracts([
      makeContract({ id: 2, quantity: 3000, deliveryStart: on(2025, 4, 1) }),
      makeContract({ id: 3, quantity: 6000, deliveryStart: on(2026, 4, 1) }),
    ]);
    expect(columns().map(c => [c.year, c.volumeHeight])).toEqual([['2025', '50%'], ['2026', '100%']]);
    expect(summary().bushels).toBe('9,000');

    setContracts([]);
    expect(columns().map(c => c.year)).toEqual(['2026']);
    expect(summary().bushels).toBe('0');
  });

  it('labels the year from a delivery start that arrives as an ISO string off the wire', () => {
    // The API hands dates over as strings at runtime; the component wraps them in new Date(...).
    const wire = JSON.parse(JSON.stringify(makeContract({ deliveryStart: on(2023, 7, 15) }))) as Contract;
    setContracts([wire]);

    expect(columns().map(c => c.year)).toEqual(['2023']);
  });
});
