import { describe, it, expect } from 'vitest';
import { computeCancelRoll } from './cancel-roll.calc';
import { CancelRollInputs } from './models/calculator.model';

// Example values from the Cancel-Roll Math sheet.
const SHEET: CancelRollInputs = {
  cashPriceToday: 5.95,
  contractAvgPrice: 5.92,
  cancelFee: 0.20,
  bushels: 2335,
  cashPriceNextYear: 6.24,
  hedgeCost: 0.12,
  contractCashPrice: 5.92,
};

describe('computeCancelRoll', () => {
  it('Option 1 — Cost to Cancel and $ to Buy Out match the sheet', () => {
    const r = computeCancelRoll(SHEET);
    expect(r.costToCancel).toBeCloseTo(0.23, 2);     // 5.95 − 5.92 + 0.20
    expect(r.buyOut).toBeCloseTo(537.05, 2);         // 0.23 × 2335
  });

  it('Option 2 — Cost to Roll is negative (a benefit) and raises the new cash price', () => {
    const r = computeCancelRoll(SHEET);
    expect(r.costToRoll).toBeCloseTo(-0.17, 2);          // 5.95 − 6.24 + 0.12
    expect(r.newCashPriceNextYear).toBeCloseTo(6.09, 2); // 5.92 − (−0.17)
  });

  it('a positive Cost to Roll lowers the new cash price', () => {
    const r = computeCancelRoll({ ...SHEET, cashPriceNextYear: 5.80 });
    expect(r.costToRoll).toBeCloseTo(0.27, 2);           // 5.95 − 5.80 + 0.12
    expect(r.newCashPriceNextYear).toBeCloseTo(5.65, 2); // 5.92 − 0.27
  });

  it('treats blank/zero inputs as 0 (no NaN)', () => {
    const r = computeCancelRoll({
      cashPriceToday: 0, contractAvgPrice: 0, cancelFee: 0, bushels: 0,
      cashPriceNextYear: 0, hedgeCost: 0, contractCashPrice: 0,
    });
    expect(r.costToCancel).toBe(0);
    expect(r.buyOut).toBe(0);
    expect(r.costToRoll).toBe(0);
    expect(r.newCashPriceNextYear).toBe(0);
  });
});
