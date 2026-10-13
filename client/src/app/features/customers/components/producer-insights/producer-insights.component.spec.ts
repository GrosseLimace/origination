import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { ProducerInsightsComponent } from './producer-insights.component';
import { ThemeService } from '@core/services/theme.service';
import { AppStateService } from '@core/services/app-state.service';
import { CommodityConversion, Contract, Customer, Note } from '@models';

// Behaviour safety net for the Producer Insights card: the eSign / ACH-vs-Check payment pills, the
// producer name in the subtitle, and the three stat cards — Total Volume (bushels contracted on
// contracts delivering in the CURRENT calendar year, open + historical deduped by id, with tonnage
// converted through the GNP024 lb/bu factors and inconvertible units left out), Avg Contract, and
// Engagement (notes logged). The card reads everything through getters over signal inputs, so these
// tests drive the inputs and read the rendered DOM — they must keep passing after an OnPush switch.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Frozen "now" (Date only) — the card reports on the current calendar year. */
const NOW = new Date('2026-10-13T12:00:00');

/** Noon local time on a calendar date (1-based month). */
function on(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: 'Sample Farms', location: 'Pratt, KS',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

/** A 10,000 BU corn contract delivering this October. */
function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 42, farmId: 'F1', contractNumber: '100',
    commodityCode: 'YC', commodityDescription: 'Corn', commodityGroup: 'Corn',
    quantity: 10000, unit: 'BU', price: 0,
    deliveryStart: on(2026, 10, 1), deliveryEnd: on(2026, 10, 31),
    status: 'Active', signed: true, ...over,
  };
}

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: 1, customerId: 42, customerName: 'Sample Farms', content: 'Called about harvest.',
    isPinned: false, createdBy: 'someone', createdAt: on(2026, 9, 1), ...over,
  };
}

// ── Harness ───────────────────────────────────────────────────────────────────

describe('ProducerInsightsComponent', () => {
  let fixture: ComponentFixture<ProducerInsightsComponent>;
  let ref: ComponentRef<ProducerInsightsComponent>;
  const commodityConversions = signal<CommodityConversion[]>([]);

  function setInputs(inputs: {
    customer?: Customer; contracts?: Contract[]; historicalContracts?: Contract[]; notes?: Note[];
  }): void {
    for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  /** The pills in the header's right-hand cluster. */
  const pills = (): string[] => Array.from(host().querySelectorAll('span.rounded-full')).map(textOf);

  /** A stat card by its label: its big value and the sublabel beneath it. */
  const stat = (label: 'Total Volume' | 'Avg Contract' | 'Engagement'): { value: string; sublabel: string } => {
    const card = Array.from(host().querySelectorAll<HTMLElement>('.rounded-xl.p-4'))
      .find(c => textOf(c.querySelector('span')) === label);
    if (!card) throw new Error(`No "${label}" card rendered`);
    return { value: textOf(card.querySelector('.text-2xl')), sublabel: textOf(card.lastElementChild) };
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    commodityConversions.set([]);
    await TestBed.configureTestingModule({
      imports: [ProducerInsightsComponent],
      providers: [
        { provide: ThemeService, useValue: { isDarkMode: signal(false) } },
        { provide: AppStateService, useValue: { commodityConversions } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProducerInsightsComponent);
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Header pills + subtitle ───────────────────────────────────────────────

  it('shows the eSign pill only for enrolled producers', () => {
    setInputs({ customer: makeCustomer({ eSignEnabled: true }) });
    expect(pills()).toContain('eSign Enrolled');

    setInputs({ customer: makeCustomer({ eSignEnabled: false }) });
    expect(pills()).not.toContain('eSign Enrolled');
  });

  it('shows "ACH Payment" for ACH producers and "Check Payment" otherwise — never both', () => {
    setInputs({ customer: makeCustomer({ achEnabled: true }) });
    expect(pills()).toEqual(['ACH Payment']);

    setInputs({ customer: makeCustomer({ achEnabled: false, eSignEnabled: true }) });
    expect(pills()).toEqual(['eSign Enrolled', 'Check Payment']);
  });

  it('names the producer in the subtitle and follows a customer switch', () => {
    setInputs({ customer: makeCustomer({ name: 'Prairie Acres' }) });
    expect(textOf(host().querySelector('p'))).toBe('Prairie Acres - Performance Analytics & Growth Metrics');

    setInputs({ customer: makeCustomer({ id: 43, name: 'Other Farm' }) });
    expect(textOf(host().querySelector('p'))).toContain('Other Farm');
  });

  // ── Total Volume ──────────────────────────────────────────────────────────

  it('totals only contracts whose delivery period touches the current calendar year, and says which year', () => {
    setInputs({
      contracts: [
        makeContract({ id: 1, quantity: 10000 }),                                                            // this year
        makeContract({ id: 2, quantity: 2000, deliveryStart: on(2025, 11, 1), deliveryEnd: on(2026, 1, 15) }), // straddles into this year
        makeContract({ id: 3, quantity: 3000, deliveryStart: on(2026, 12, 1), deliveryEnd: on(2027, 2, 1) }),  // straddles into next year
        makeContract({ id: 4, quantity: 40000, deliveryStart: on(2025, 9, 1), deliveryEnd: on(2025, 12, 31) }), // last year only
        makeContract({ id: 5, quantity: 50000, deliveryStart: on(2027, 1, 1), deliveryEnd: on(2027, 3, 1) }),   // next year only
      ],
    });

    expect(stat('Total Volume')).toEqual({ value: '15,000', sublabel: 'bushels contracted · 2026 deliveries' });
  });

  it('uses a lone delivery date for both ends and ignores contracts with no delivery dates', () => {
    setInputs({
      contracts: [
        makeContract({ id: 1, quantity: 600, deliveryStart: undefined, deliveryEnd: on(2026, 3, 1) }),
        makeContract({ id: 2, quantity: 400, deliveryStart: on(2026, 5, 1), deliveryEnd: undefined }),
        makeContract({ id: 3, quantity: 90000, deliveryStart: undefined, deliveryEnd: undefined }),
      ],
    });

    expect(stat('Total Volume').value).toBe('1,000');
    expect(stat('Avg Contract').value).toBe('500');
  });

  it('merges historical contracts into the total, deduped by id against the open list', () => {
    setInputs({
      contracts: [makeContract({ id: 1, quantity: 10000 })],
      historicalContracts: [
        makeContract({ id: 1, quantity: 10000 }),                                                         // already open → counted once
        makeContract({ id: 2, quantity: 5000, deliveryStart: on(2026, 6, 1), deliveryEnd: on(2026, 7, 1) }), // closed earlier this year
        makeContract({ id: 3, quantity: 8000, deliveryStart: on(2025, 6, 1), deliveryEnd: on(2025, 7, 1) }), // last year → excluded
      ],
    });

    expect(stat('Total Volume').value).toBe('15,000');
    expect(stat('Avg Contract').value).toBe('7,500');
  });

  it('converts tonnage contracts to bushels through the lb-per-bushel factor and leaves out units it cannot convert', () => {
    commodityConversions.set([{ commodityCode: 'SB', lbsPerUnit: 60 }, { commodityCode: 'SBM', lbsPerUnit: 2000 }]);
    setInputs({
      contracts: [
        makeContract({ id: 1, quantity: 1000, unit: 'bushels' }),                     // long-form bushels pass through
        makeContract({ id: 2, quantity: 30, unit: 'ST', commodityCode: 'SB' }),        // 30 × 2000 ÷ 60 = 1,000 bu
        makeContract({ id: 3, quantity: 318, unit: 'ST', commodityCode: 'SBM' }),      // meal: implausible factor → excluded
        makeContract({ id: 4, quantity: 500, unit: 'GL', commodityCode: 'SB' }),       // gallons have no bushel equivalent → excluded
      ],
    });

    expect(stat('Total Volume').value).toBe('2,000');
  });

  it('keeps fractional bushels from a conversion (default number pipe, up to 3 decimals)', () => {
    commodityConversions.set([{ commodityCode: 'SB', lbsPerUnit: 60 }]);
    setInputs({ contracts: [makeContract({ quantity: 100, unit: 'ST', commodityCode: 'SB' })] }); // 3,333.33… bu

    expect(stat('Total Volume').value).toBe('3,333.333');
    expect(stat('Avg Contract').value).toBe('3,333');
  });

  it('shows zero volume and a zero average when there are no current-year contracts', () => {
    setInputs({ contracts: [makeContract({ deliveryStart: on(2024, 1, 1), deliveryEnd: on(2024, 2, 1) })] });

    expect(stat('Total Volume').value).toBe('0');
    expect(stat('Avg Contract').value).toBe('0');
  });

  // ── Avg Contract ──────────────────────────────────────────────────────────

  it('averages bushels over the current-year contracts, rounded to whole bushels', () => {
    setInputs({
      contracts: [
        makeContract({ id: 1, quantity: 1000 }),
        makeContract({ id: 2, quantity: 1000 }),
        makeContract({ id: 3, quantity: 1001 }),
      ],
    });

    expect(stat('Avg Contract')).toEqual({ value: '1,000', sublabel: 'bushels per contract' });
  });

  it('PINS CURRENT BEHAVIOUR: an inconvertible contract is left out of the total but still counted in the average\'s denominator', () => {
    // Suspected bug, reported rather than fixed: averageContractSize = totalContracted ÷ currentYearContracts.length,
    // and the excluded contract is only dropped from the numerator. If this is ever corrected, update this test.
    setInputs({
      contracts: [
        makeContract({ id: 1, quantity: 9000 }),
        makeContract({ id: 2, quantity: 500, unit: 'GL' }),
      ],
    });

    expect(stat('Total Volume').value).toBe('9,000');
    expect(stat('Avg Contract').value).toBe('4,500');
  });

  // ── Engagement ────────────────────────────────────────────────────────────

  it('counts every note logged for the producer as engagement', () => {
    setInputs({ notes: [] });
    expect(stat('Engagement')).toEqual({ value: '0', sublabel: 'notes logged' });

    setInputs({ notes: [makeNote({ id: 1 }), makeNote({ id: 2 }), makeNote({ id: 3, isPinned: true })] });
    expect(stat('Engagement').value).toBe('3');
  });
});
