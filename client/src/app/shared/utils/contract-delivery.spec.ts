import { describe, it, expect } from 'vitest';
import { Contract } from '@models';
import { getContractDeliveryStats } from './contract-delivery';

/**
 * getContractDeliveryStats is the single source of Delivered / Remaining / Progress for every
 * screen (contracts table, activity summary, print report, insights, past-due, unshipped bushels).
 * This pins the rules those screens rely on agreeing about:
 *  - a missing (null/undefined) openBalanceQuantity means "CTRM hasn't populated it" → nothing delivered, flagged unknown,
 *  - a remainder under 0.1% of the contract (floored at 0.01) counts as Filled and folds into Delivered,
 *  - over-delivery surfaces the real delivered amount rather than capping at quantity,
 *  - numbers are rounded to 2dp, and Delivered + Remaining always reconciles to quantity.
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
    openBalanceQuantity: 10_000,
    ...over,
  };
}

describe('getContractDeliveryStats', () => {
  it('derives delivered, remaining and progress from the CTRM open balance', () => {
    const s = getContractDeliveryStats(contract({ quantity: 10_000, openBalanceQuantity: 2_500 }));

    expect(s.delivered).toBe(7_500);
    expect(s.remaining).toBe(2_500);
    expect(s.progressPercent).toBe(75);
    expect(s.isEffectivelyComplete).toBe(false);
    expect(s.remainingIsUnknown).toBe(false);
  });

  it('treats an untouched contract as 0% delivered', () => {
    const s = getContractDeliveryStats(contract({ quantity: 10_000, openBalanceQuantity: 10_000 }));

    expect(s.delivered).toBe(0);
    expect(s.remaining).toBe(10_000);
    expect(s.progressPercent).toBe(0);
  });

  it.each([null, undefined])('assumes nothing delivered when CTRM has not populated the open balance (%s), and says so', (missing) => {
    // The API sends JSON null for an unpopulated aggregate; undefined (field absent) takes the same `== null` path.
    const s = getContractDeliveryStats(contract({ quantity: 5_000, openBalanceQuantity: missing }));

    expect(s.remainingIsUnknown).toBe(true);
    expect(s.delivered).toBe(0);
    expect(s.remaining).toBe(5_000);
    expect(s.isEffectivelyComplete).toBe(false);
  });

  it('a zero open balance is fully delivered and NOT unknown', () => {
    const s = getContractDeliveryStats(contract({ quantity: 5_000, openBalanceQuantity: 0 }));

    expect(s.remainingIsUnknown).toBe(false);
    expect(s.isEffectivelyComplete).toBe(true);
    expect(s.delivered).toBe(5_000);
    expect(s.remaining).toBe(0);
    expect(s.progressPercent).toBe(100);
  });

  it('counts a sub-0.1% residue as Filled and folds it into Delivered', () => {
    // 0.1% of 10,000 = 10 bu. 9.99 bu left is "done"; the 99.9% contract must not sit Active forever.
    const s = getContractDeliveryStats(contract({ quantity: 10_000, openBalanceQuantity: 9.99 }));

    expect(s.isEffectivelyComplete).toBe(true);
    expect(s.remaining).toBe(0);
    expect(s.delivered).toBe(10_000);
    expect(s.progressPercent).toBe(100);
  });

  it('a residue of exactly 0.1% is still open (the threshold is strict)', () => {
    const s = getContractDeliveryStats(contract({ quantity: 10_000, openBalanceQuantity: 10 }));

    expect(s.isEffectivelyComplete).toBe(false);
    expect(s.remaining).toBe(10);
    expect(s.delivered).toBe(9_990);
    expect(s.progressPercent).toBeCloseTo(99.9, 10);
    expect(s.progressPercent).toBeLessThan(100);
  });

  it('floors the completion threshold at 0.01 so tiny contracts are not filled by rounding', () => {
    // 0.1% of 5 bu = 0.005, but the floor is 0.01: 0.009 left is complete, 0.02 left is not.
    expect(getContractDeliveryStats(contract({ quantity: 5, openBalanceQuantity: 0.009 })).isEffectivelyComplete).toBe(true);
    expect(getContractDeliveryStats(contract({ quantity: 5, openBalanceQuantity: 0.02 })).isEffectivelyComplete).toBe(false);
  });

  it('a zero-quantity contract with no open balance data reads complete but stays flagged unknown', () => {
    const s = getContractDeliveryStats(contract({ quantity: 0, openBalanceQuantity: undefined }));

    // rawRemaining falls back to qty (0), which is under the 0.01 floor, so it reads as complete.
    // Intended: there are no bushels to chase, so it stays off Unshipped Bushels and the past-due
    // gates. (The source comment used to claim the floor stops this; it was the comment that was wrong.)
    expect(s.isEffectivelyComplete).toBe(true);
    expect(s.remainingIsUnknown).toBe(true);
    expect(s.delivered).toBe(0);
    expect(s.remaining).toBe(0);
  });

  it('a zero-quantity contract with a zero open balance is complete, not left open at 0%', () => {
    const s = getContractDeliveryStats(contract({ quantity: 0, openBalanceQuantity: 0 }));

    // The 0.01 floor is what does this: a threshold of 0.1% of 0 would be 0, and 0 < 0 is false.
    expect(s.isEffectivelyComplete).toBe(true);
    expect(s.remaining).toBe(0);
    expect(s.progressPercent).toBe(100);
  });

  it('a zero-quantity contract with an open balance reports 0% instead of dividing by zero', () => {
    const s = getContractDeliveryStats(contract({ quantity: 0, openBalanceQuantity: 50 }));

    expect(s.isEffectivelyComplete).toBe(false);
    expect(s.delivered).toBe(0);
    expect(s.remaining).toBe(50);
    expect(s.progressPercent).toBe(0);
    expect(Number.isFinite(s.progressPercent)).toBe(true);
  });

  it('surfaces the real delivered amount when CTRM has the contract over-delivered', () => {
    const s = getContractDeliveryStats(contract({ quantity: 10_000, openBalanceQuantity: -250 }));

    expect(s.isEffectivelyComplete).toBe(true);
    expect(s.delivered).toBe(10_250);
    expect(s.remaining).toBe(0);
    expect(s.progressPercent).toBe(100);
  });

  it('rounds delivered and remaining to 2dp while keeping them reconciled to quantity', () => {
    const s = getContractDeliveryStats(contract({ quantity: 1_000, openBalanceQuantity: 333.3333 }));

    expect(s.remaining).toBe(333.33);
    expect(s.delivered).toBe(666.67);
    expect(s.delivered + s.remaining).toBeCloseTo(1_000, 10);
  });

  it('never reports negative delivered when the open balance exceeds quantity', () => {
    const s = getContractDeliveryStats(contract({ quantity: 1_000, openBalanceQuantity: 1_200 }));

    expect(s.delivered).toBe(0);
    expect(s.remaining).toBe(1_200);
    expect(s.progressPercent).toBe(0);
  });
});
