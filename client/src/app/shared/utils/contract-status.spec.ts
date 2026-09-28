import { describe, it, expect } from 'vitest';
import { Contract } from '@models';
import {
  isContractUnconfirmed,
  isContractCustomerConfirmed,
  isContractOverdueWithUnshippedBu,
  computeHarvestPacePct,
} from './contract-status';

/**
 * Pins the non-obvious rules in contract-status, all of which exist because two call sites once
 * answered the same question differently:
 *  - the two confirmation predicates are deliberately NOT inverses (terminal contracts are neither),
 *  - overdue delegates to the shared delivery stats rather than doing its own ticket math,
 *  - pacing measures against the producer's own max delivery year, counts ALL contracts, and
 *    applies a same-point-last-year cutoff to the prior year only.
 */

/** Fully typed Contract fixture — no `as` cast, so a model change breaks compilation here. */
function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1,
    customerId: 100,
    farmId: '',
    contractNumber: 'PCPL0001',
    quantity: 10_000,
    unit: 'bushels',
    price: 4.25,
    deliveryStart: new Date(2026, 8, 1),
    deliveryEnd: new Date(2026, 10, 30),
    status: 'Active',
    signed: true,
    ...over,
  };
}

/** Mid-crop-year "now": 15 June 2026, so same-point-last-year lands on 15 June 2025. */
const TODAY = new Date(2026, 5, 15);

describe('isContractUnconfirmed', () => {
  it('is false once the customer has confirmed, trimmed and case-insensitively', () => {
    expect(isContractUnconfirmed(contract({ customerConfirmStatus: 'Confirmed' }))).toBe(false);
    expect(isContractUnconfirmed(contract({ customerConfirmStatus: '  confirmed  ' }))).toBe(false);
    expect(isContractUnconfirmed(contract({ customerConfirmStatus: 'CONFIRMED' }))).toBe(false);
  });

  it('is true for any other confirm status on a live contract', () => {
    expect(isContractUnconfirmed(contract({ customerConfirmStatus: 'Pending' }))).toBe(true);
    expect(isContractUnconfirmed(contract({ customerConfirmStatus: '' }))).toBe(true);
    expect(isContractUnconfirmed(contract({ customerConfirmStatus: undefined }))).toBe(true);
  });

  it('is false for terminal contracts — no point chasing a confirmation on a dead contract', () => {
    expect(isContractUnconfirmed(contract({ status: 'Fulfilled', customerConfirmStatus: 'Pending' }))).toBe(false);
    expect(isContractUnconfirmed(contract({ status: 'Cancelled', customerConfirmStatus: 'Pending' }))).toBe(false);
  });

  it('still chases Pending and Overdue contracts', () => {
    expect(isContractUnconfirmed(contract({ status: 'Pending', customerConfirmStatus: 'Pending' }))).toBe(true);
    expect(isContractUnconfirmed(contract({ status: 'Overdue', customerConfirmStatus: 'Pending' }))).toBe(true);
  });
});

describe('isContractCustomerConfirmed', () => {
  it('is true only on a positive confirmation, trimmed and case-insensitively', () => {
    expect(isContractCustomerConfirmed(contract({ customerConfirmStatus: 'Confirmed' }))).toBe(true);
    expect(isContractCustomerConfirmed(contract({ customerConfirmStatus: '  confirmed  ' }))).toBe(true);
    expect(isContractCustomerConfirmed(contract({ customerConfirmStatus: 'Pending' }))).toBe(false);
    expect(isContractCustomerConfirmed(contract({ customerConfirmStatus: undefined }))).toBe(false);
  });

  it('ignores contract status — a Fulfilled contract the customer confirmed is still confirmed', () => {
    expect(isContractCustomerConfirmed(contract({ status: 'Fulfilled', customerConfirmStatus: 'Confirmed' }))).toBe(true);
  });
});

describe('the two confirmation predicates are not inverses', () => {
  it('reports BOTH false for a terminal contract the customer never confirmed', () => {
    // This is the whole reason two functions exist. Collapsing either into `!theOther` would
    // count "Fulfilled and never confirmed" as confirmed and widen every confirmed-contracts query.
    for (const status of ['Fulfilled', 'Cancelled'] as const) {
      const terminal = contract({ status, customerConfirmStatus: 'Pending' });
      expect(isContractUnconfirmed(terminal)).toBe(false);
      expect(isContractCustomerConfirmed(terminal)).toBe(false);
      expect(isContractCustomerConfirmed(terminal)).not.toBe(!isContractUnconfirmed(terminal));
    }
  });

  it('are exact opposites everywhere else, which is why the drift is easy to miss', () => {
    const live = [
      contract({ status: 'Active', customerConfirmStatus: 'Confirmed' }),
      contract({ status: 'Active', customerConfirmStatus: 'Pending' }),
      contract({ status: 'Pending', customerConfirmStatus: undefined }),
      contract({ status: 'Overdue', customerConfirmStatus: 'Confirmed' }),
    ];
    for (const ct of live) {
      expect(isContractCustomerConfirmed(ct)).toBe(!isContractUnconfirmed(ct));
    }
  });
});

describe('isContractOverdueWithUnshippedBu', () => {
  const past = { deliveryEnd: new Date(2026, 3, 30) };   // before TODAY
  const future = { deliveryEnd: new Date(2026, 11, 31) }; // after TODAY

  it('flags a past-due contract that still has unshipped bushels', () => {
    expect(isContractOverdueWithUnshippedBu(
      contract({ ...past, quantity: 10_000, openBalanceQuantity: 4_000 }), TODAY)).toBe(true);
  });

  it('does not flag a contract whose delivery window is still open', () => {
    expect(isContractOverdueWithUnshippedBu(
      contract({ ...future, quantity: 10_000, openBalanceQuantity: 4_000 }), TODAY)).toBe(false);
  });

  it('is not overdue on the delivery end date itself, only after it', () => {
    expect(isContractOverdueWithUnshippedBu(
      contract({ deliveryEnd: TODAY, quantity: 10_000, openBalanceQuantity: 4_000 }), TODAY)).toBe(false);
  });

  it('does not flag a past-due contract that is fully delivered', () => {
    expect(isContractOverdueWithUnshippedBu(
      contract({ ...past, quantity: 10_000, openBalanceQuantity: 0 }), TODAY)).toBe(false);
  });

  it('defers to the shared sub-0.1% completion rule rather than doing its own math', () => {
    // quantity 100,000 → threshold 100. A 50 bu residue is Filled; 150 bu is genuinely short.
    expect(isContractOverdueWithUnshippedBu(
      contract({ ...past, quantity: 100_000, openBalanceQuantity: 50 }), TODAY)).toBe(false);
    expect(isContractOverdueWithUnshippedBu(
      contract({ ...past, quantity: 100_000, openBalanceQuantity: 150 }), TODAY)).toBe(true);
  });

  it('flags a past-due contract whose open balance CTRM has not populated yet', () => {
    // Err on the side of surfacing it rather than silently filing it as complete.
    expect(isContractOverdueWithUnshippedBu(
      contract({ ...past, quantity: 10_000, openBalanceQuantity: undefined }), TODAY)).toBe(true);
  });

  it('only considers Active, Pending and Overdue contracts', () => {
    const shortfall = { ...past, quantity: 10_000, openBalanceQuantity: 4_000 };
    expect(isContractOverdueWithUnshippedBu(contract({ ...shortfall, status: 'Active' }), TODAY)).toBe(true);
    expect(isContractOverdueWithUnshippedBu(contract({ ...shortfall, status: 'Pending' }), TODAY)).toBe(true);
    expect(isContractOverdueWithUnshippedBu(contract({ ...shortfall, status: 'Overdue' }), TODAY)).toBe(true);
    expect(isContractOverdueWithUnshippedBu(contract({ ...shortfall, status: 'Fulfilled' }), TODAY)).toBe(false);
    expect(isContractOverdueWithUnshippedBu(contract({ ...shortfall, status: 'Cancelled' }), TODAY)).toBe(false);
  });

  it('does not flag a contract whose delivery end date is unreadable', () => {
    expect(isContractOverdueWithUnshippedBu(
      contract({ deliveryEnd: new Date('not a date'), openBalanceQuantity: 4_000 }), TODAY)).toBe(false);
  });
});

describe('computeHarvestPacePct', () => {
  it('returns null when the producer has no contracts at all', () => {
    expect(computeHarvestPacePct([], TODAY)).toBeNull();
  });

  it('returns null when no contract carries a readable delivery year', () => {
    expect(computeHarvestPacePct(
      [contract({ deliveryStart: new Date('not a date'), quantity: 60_000 })], TODAY)).toBeNull();
  });

  it('returns null when there is nothing booked in the prior year to compare against', () => {
    expect(computeHarvestPacePct(
      [contract({ deliveryStart: new Date(2026, 8, 1), quantity: 60_000 })], TODAY)).toBeNull();
  });

  it('returns null when the prior year is a gap rather than the previous calendar year', () => {
    // Buckets are strictly maxYear and maxYear − 1; a 2024 contract is not "last year" for 2026.
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 60_000 }),
      contract({ deliveryStart: new Date(2024, 8, 1), quantity: 50_000, contractDate: new Date(2024, 2, 1) }),
    ], TODAY)).toBeNull();
  });

  it('applies a same-point-last-year cutoff to the prior year', () => {
    // 60k booked for 2026 vs 2025's book: 50k booked in March (before 15 Jun) and 40k booked in
    // September (after it). Only the March 50k counts → +20%. Counting the whole 90k prior book
    // would read as −33%, which is the wrong answer to "are they ahead of last year's pace".
    const pace = computeHarvestPacePct([
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 60_000, contractDate: new Date(2026, 1, 1) }),
      contract({ deliveryStart: new Date(2025, 8, 1), quantity: 50_000, contractDate: new Date(2025, 2, 1) }),
      contract({ deliveryStart: new Date(2025, 8, 1), quantity: 40_000, contractDate: new Date(2025, 8, 1) }),
    ], TODAY);
    expect(pace).toBeCloseTo(20, 10);
  });

  it('includes a prior-year contract booked exactly on the cutoff date', () => {
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 60_000 }),
      contract({ deliveryStart: new Date(2025, 8, 1), quantity: 50_000, contractDate: new Date(2025, 5, 15) }),
    ], TODAY)).toBeCloseTo(20, 10);
  });

  it('includes a prior-year contract with no booking date rather than dropping it', () => {
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 60_000 }),
      contract({ deliveryStart: new Date(2025, 8, 1), quantity: 50_000, contractDate: undefined }),
    ], TODAY)).toBeCloseTo(20, 10);
  });

  it('applies the cutoff to the prior year only, never to the current year', () => {
    // The 2026 contract is booked 14 June 2026 — later in the year than the cutoff month/day — and
    // still counts in full. Current-year bushels are "booked so far", by definition.
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 60_000, contractDate: new Date(2026, 5, 14) }),
      contract({ deliveryStart: new Date(2025, 8, 1), quantity: 50_000, contractDate: new Date(2025, 2, 1) }),
    ], TODAY)).toBeCloseTo(20, 10);
  });

  it('reports a negative pace when the producer is behind last year', () => {
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 40_000 }),
      contract({ deliveryStart: new Date(2025, 8, 1), quantity: 50_000, contractDate: new Date(2025, 2, 1) }),
    ], TODAY)).toBeCloseTo(-20, 10);
  });

  it('buckets a contract that straddles the calendar year end by its delivery START', () => {
    // Crop years straddle 1 January. A contract starting 15 Dec 2025 and running to 30 Apr 2026 is
    // last year's crop, even though most of its delivery happens in 2026.
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2026, 0, 5), deliveryEnd: new Date(2026, 5, 30), quantity: 30_000 }),
      contract({
        deliveryStart: new Date(2025, 11, 15), deliveryEnd: new Date(2026, 3, 30),
        quantity: 25_000, contractDate: new Date(2025, 4, 1),
      }),
    ], TODAY)).toBeCloseTo(20, 10);
  });

  it('counts ALL contracts, including Fulfilled and Cancelled ones', () => {
    // Closing or cancelling a contract does not un-book the bushels. Filtering to open contracts is
    // exactly how the free-text pacing query and the refine-panel checkbox drifted apart — and it
    // all but guarantees null, since last year's contracts are closed by now.
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 60_000, status: 'Cancelled' }),
      contract({
        deliveryStart: new Date(2025, 8, 1), quantity: 50_000,
        contractDate: new Date(2025, 2, 1), status: 'Fulfilled',
      }),
    ], TODAY)).toBeCloseTo(20, 10);
  });

  it('paces against the producer max delivery year, not the calendar year', () => {
    // Everything this producer has booked is a year behind TODAY (2026): max delivery year is 2025,
    // so the comparison is 2025 vs 2024 and still resolves instead of returning null.
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2025, 8, 1), quantity: 60_000 }),
      contract({ deliveryStart: new Date(2024, 8, 1), quantity: 50_000 }),
    ], TODAY)).toBeCloseTo(20, 10);
  });

  it('anchors the cutoff to TODAY, not to the max delivery year — a producer booked a year ahead reads null', () => {
    // Documented behaviour, not an endorsement: `samePointLastYear` is today.getFullYear() − 1,
    // while the buckets are maxYear / maxYear − 1. When maxYear runs ahead of the calendar year the
    // two disagree, and dated prior-crop-year contracts fall outside a cutoff that is a full year
    // too early. Max year 2027, prior bucket 2026, cutoff 15 Jun 2025 → the 2026 book is excluded.
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2027, 8, 1), quantity: 30_000, contractDate: new Date(2026, 1, 1) }),
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 20_000, contractDate: new Date(2026, 0, 10) }),
    ], TODAY)).toBeNull();

    // The same producer with no booking dates skips the cutoff entirely and does resolve, so the
    // misalignment shows up only for contracts that carry a contractDate.
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2027, 8, 1), quantity: 30_000 }),
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 20_000 }),
    ], TODAY)).toBeCloseTo(50, 10);
  });

  it('ignores a missing quantity rather than producing NaN', () => {
    expect(computeHarvestPacePct([
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: 50_000 }),
      contract({ deliveryStart: new Date(2026, 8, 1), quantity: undefined as unknown as number }),
      contract({ deliveryStart: new Date(2025, 8, 1), quantity: 50_000 }),
    ], TODAY)).toBe(0);
  });
});
