import { describe, it, expect } from 'vitest';
import { computeProfitability } from './profitability.calc';
import { ProfitabilityInputs } from './models/calculator.model';

// Oracle values come from the reference prototype's default inputs.
const PROTOTYPE_DEFAULTS: ProfitabilityInputs = {
  farmName: 'Test Farm',
  commodity: 'corn',
  totalAcres: 120,
  yieldPerAcre: 180,
  pricePerBushel: 5.5,
  fertilizer: 50,
  pesticides: 30,
  seed: 60,
  drying: 20,
  storage: 15,
  cropInsurance: 25,
  rent: 200,
  harvesting: 25,
  freightPerBushel: 0.1,
  repairs: 2000,
};

describe('computeProfitability', () => {
  it('matches the reference prototype for its default inputs', () => {
    const r = computeProfitability(PROTOTYPE_DEFAULTS);
    expect(r.totalRevenue).toBeCloseTo(118_800, 2);
    expect(r.totalVariableCost).toBeCloseTo(53_160, 2);
    expect(r.totalFixedCost).toBeCloseTo(2_000, 2);
    expect(r.totalCost).toBeCloseTo(55_160, 2);
    expect(r.profit).toBeCloseTo(63_640, 2);
    expect(r.costPerAcre).toBeCloseTo(459.6667, 3);
    expect(r.breakevenPerBushel).toBeCloseTo(2.5537, 4);
  });

  it('converts freight $/bushel to $/acre using yield', () => {
    const base = { ...PROTOTYPE_DEFAULTS, freightPerBushel: 0 };
    const withFreight = { ...PROTOTYPE_DEFAULTS, freightPerBushel: 0.1 };
    // freight adds 0.1 * 180 = $18/acre × 120 acres = $2,160 of variable cost
    expect(computeProfitability(base).totalVariableCost).toBeCloseTo(51_000, 2);
    expect(computeProfitability(withFreight).totalVariableCost).toBeCloseTo(53_160, 2);
  });

  it('returns zeros (no divide-by-zero) when acres/yield are zero', () => {
    const r = computeProfitability({ ...PROTOTYPE_DEFAULTS, totalAcres: 0, yieldPerAcre: 0 });
    expect(r.totalRevenue).toBe(0);
    expect(r.costPerAcre).toBe(0);
    expect(r.breakevenPerBushel).toBe(0);
    expect(r.profit).toBe(-2000); // only the fixed repairs cost remains
  });
});
