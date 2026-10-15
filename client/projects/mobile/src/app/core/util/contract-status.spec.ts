import { describe, expect, it } from 'vitest';

import { contractDeliveryStats, contractStatus, unsettledQuantity } from './contract-status';

describe('contract rules (the desktop’s)', () => {
  it('delivered / remaining / progress from the open balance', () => {
    expect(contractDeliveryStats({ quantity: 10_000, openBalanceQuantity: 2_500 })).toMatchObject({ delivered: 7_500, remaining: 2_500, progressPercent: 75 });
  });

  it('counts a contract complete once less than 0.1% is left', () => {
    expect(contractDeliveryStats({ quantity: 10_000, openBalanceQuantity: 5 })).toMatchObject({ delivered: 10_000, remaining: 0, progressPercent: 100, isEffectivelyComplete: true });
  });

  it('assumes nothing delivered when the open balance is unknown', () => {
    expect(contractDeliveryStats({ quantity: 10_000, openBalanceQuantity: null })).toMatchObject({ delivered: 0, remaining: 10_000, remainingIsUnknown: true });
  });

  it('derives status like the desktop', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    const base = { quantity: 10_000, openBalanceQuantity: 5_000, deliveryStart: '2026-10-01T00:00:00Z', deliveryEnd: '2026-12-31T00:00:00Z' };
    expect(contractStatus({ ...base, openBalanceQuantity: 0 }, now)).toBe('Filled');
    expect(contractStatus({ ...base, status: 'Cancelled' }, now)).toBe('Cancelled');
    expect(contractStatus({ ...base, deliveryEnd: '2026-10-01T00:00:00Z' }, now)).toBe('Past Due');
    expect(contractStatus(base, now)).toBe('Active');
    expect(contractStatus({ ...base, deliveryStart: '2026-11-01T00:00:00Z' }, now)).toBe('To Arrive');
  });

  it('unsettled = delivered − settled, null when not populated', () => {
    expect(unsettledQuantity({ quantity: 10_000, openBalanceQuantity: 4_000, settledQuantity: 5_000 })).toBe(1_000);
    expect(unsettledQuantity({ quantity: 10_000, openBalanceQuantity: null, settledQuantity: 5_000 })).toBeNull();
  });
});
