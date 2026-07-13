import { describe, it, expect } from 'vitest';
import { computeCheck } from './check.calc';
import { CheckInputs } from './models/calculator.model';

// Column C (HRWW) from the Check Calculator sheet.
const COLUMN_C: CheckInputs = {
  commodity: 'HRWW',
  bushels: 2000,
  basis: -0.70,
  futurePrice: 5.57,
  checkOffMode: 'percent',
  checkOffValue: 0.02,           // 2%
  avgDeliveryDate: '2025-06-27',
  settlementDate: '2025-12-02',
  freightPerBushel: 0,
  dailyDpFee: 0.002,
};

describe('computeCheck', () => {
  it('matches the sheet: cash price, gross, days, DP fee, DP deduction', () => {
    const r = computeCheck(COLUMN_C);
    expect(r.cashPrice).toBeCloseTo(4.87, 2);            // 5.57 + (−0.70)
    expect(r.totalBeforeFees).toBeCloseTo(9740, 2);      // 2000 × 4.87
    expect(r.daysSinceDelivery).toBe(158);               // 6/27 → 12/2
    expect(r.dailyDpFee).toBeCloseTo(0.002, 6);          // 0.06 / 30
    expect(r.totalDpFees).toBeCloseTo(-632, 2);          // −(158 × 0.002 × 2000)
    expect(r.totalFreight).toBeCloseTo(0, 2);            // blank freight
  });

  it('check-off as PERCENT of gross value', () => {
    const r = computeCheck(COLUMN_C);
    expect(r.totalCheckOff).toBeCloseTo(-194.8, 2);      // −(9740 × 0.02)
    expect(r.total).toBeCloseTo(8913.2, 2);              // 9740 − 194.80 − 632
  });

  it('check-off in $ mode applies the entered decimal to gross value', () => {
    const r = computeCheck({ ...COLUMN_C, checkOffMode: 'perBushel', checkOffValue: 0.01 });
    expect(r.totalCheckOff).toBeCloseTo(-97.4, 2);       // −(9740 × 0.01)
    expect(r.total).toBeCloseTo(9010.6, 2);              // 9740 − 97.4 − 632
  });

  it('subtracts freight when provided', () => {
    const r = computeCheck({ ...COLUMN_C, freightPerBushel: 0.10 });
    expect(r.totalFreight).toBeCloseTo(-200, 2);         // −(0.10 × 2000)
  });

  it('never charges negative DP days (settlement before delivery) or on blank dates', () => {
    expect(computeCheck({ ...COLUMN_C, settlementDate: '2025-06-01' }).daysSinceDelivery).toBe(0);
    expect(computeCheck({ ...COLUMN_C, avgDeliveryDate: '' }).daysSinceDelivery).toBe(0);
  });
});
