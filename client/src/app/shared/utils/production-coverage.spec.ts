import { describe, it, expect } from 'vitest';
import { buildProductionCoverage, findYieldEstimate } from './production-coverage';
import { Commodity, Contract, DashboardPlantingEstimate, HarvestWindow, PlantingIntention } from '@models';

/**
 * Pins the four corrections made when this calculation moved out of CustomerProfileComponent:
 * CropYear beats harvest-window overlap, units are never summed together, a missing yield estimate
 * is null rather than zero, and the commodity join goes through Commodities.Category.
 */

const commodities = [
  { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true },
  { id: 2, code: 'HRWW', name: 'Hard Red Winter Wheat', category: 'Wheat', isActive: true },
  { id: 3, code: 'CANP', name: 'Canola', category: 'Canola', isActive: true },
] as Commodity[];

const harvestWindows = [
  { id: 1, commodity: 'Corn', deliveryStartMonth: 9, deliveryStartDay: 1, deliveryEndMonth: 12, deliveryEndDay: 31, isActive: true },
] as HarvestWindow[];

function intention(over: Partial<PlantingIntention> = {}): PlantingIntention {
  return {
    id: 1, customerId: 100, customerName: 'Acme', customerCode: 'A1', tradeUnit: 'TU1',
    plantingYear: 2026, crop: 'YC', acres: 1000, createdAt: new Date(), createdBy: 'x',
    ...over,
  } as PlantingIntention;
}

function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 100, farmId: '', contractNumber: 'C1', commodityCode: 'YC',
    quantity: 50_000, unit: 'bu', price: 0, cropYear: 2026,
    deliveryStart: new Date('2026-10-01'), deliveryEnd: new Date('2026-11-30'),
    status: 'Active', signed: true,
    ...over,
  } as Contract;
}

const yieldFor = (crop: string, yieldEstimate: number, plantingYear = 2026): DashboardPlantingEstimate =>
  ({ id: 1, tradeUnitKey: 'TU1', crop, plantingYear, yieldEstimate });

const build = (over: Partial<Parameters<typeof buildProductionCoverage>[0]> = {}) =>
  buildProductionCoverage({
    intentions: [intention()],
    contracts: [contract()],
    commodities,
    yieldEstimates: [yieldFor('Corn', 180)],
    harvestWindows,
    year: 2026,
    ...over,
  });

describe('buildProductionCoverage', () => {
  it('projects acres x yield and measures contracted against it', () => {
    const result = build();
    const corn = result.byCommodity[0];

    expect(corn.commodity).toBe('Corn');
    expect(corn.projectedYield).toBe(180_000);       // 1000 ac x 180 bu/ac
    expect(corn.contracted).toBe(50_000);
    expect(corn.percentage).toBeCloseTo(27.78, 1);
    expect(corn.available).toBe(130_000);
  });

  it('joins a planting-intention crop CODE to a contract via Commodities.Category', () => {
    // Intention carries "HRWW"; the contract carries a different wheat code. Both resolve to "Wheat".
    const result = build({
      intentions: [intention({ crop: 'HRWW' })],
      contracts: [contract({ commodityCode: 'HRWW', quantity: 10_000 })],
      yieldEstimates: [yieldFor('Wheat', 60)],
    });

    expect(result.byCommodity[0].commodity).toBe('Wheat');
    expect(result.byCommodity[0].contracted).toBe(10_000);
  });

  // ── Missing yield is unknown, not zero ────────────────────────────────────────────────────
  it('returns null projection when no yield estimate matches, not 0', () => {
    const corn = build({ yieldEstimates: [] }).byCommodity[0];

    expect(corn.projectedYield).toBeNull();
    expect(corn.percentage).toBeNull();   // 0% would read as "sold nothing"
    expect(corn.available).toBeNull();
    expect(corn.contracted).toBe(50_000); // contracted volume is still known
  });

  it('does not project a new crop year off the previous year\'s estimate', () => {
    // Adding 2027 acres when only 2026 has a season target must NOT silently reuse 2026's yield.
    const result = build({
      intentions: [intention({ plantingYear: 2027 })],
      yieldEstimates: [yieldFor('Corn', 180, 2026)],
      contracts: [contract({ cropYear: 2027 })],
      year: 2027,
    });

    expect(result.byCommodity[0].projectedYield).toBeNull();
    expect(result.byCommodity[0].percentage).toBeNull();
    expect(result.byCommodity[0].contracted).toBe(50_000);   // contracts are still real
  });

  // ── CropYear is authoritative ─────────────────────────────────────────────────────────────
  it('matches on cropYear, ignoring delivery dates outside the harvest window', () => {
    // Delivery is in March — nowhere near the Sep-Dec corn window — but CTRM says it's the 2026 crop.
    const result = build({
      contracts: [contract({
        cropYear: 2026,
        deliveryStart: new Date('2027-03-01'),
        deliveryEnd: new Date('2027-03-31'),
      })],
    });

    expect(result.byCommodity[0].contracted).toBe(50_000);
  });

  it('excludes a contract from another crop year even when its delivery overlaps the window', () => {
    const result = build({
      contracts: [contract({
        cropYear: 2025,
        deliveryStart: new Date('2026-10-01'),
        deliveryEnd: new Date('2026-11-30'),
      })],
    });

    expect(result.byCommodity[0].contracted).toBe(0);
  });

  it('counts a contract spanning two seasons exactly once', () => {
    // Delivery Nov 2026 - Feb 2027 overlaps both the 2026 and 2027 corn windows. Under the old
    // harvest-window rule this contract was counted in both seasons.
    const straddling = contract({
      cropYear: 2026,
      deliveryStart: new Date('2026-11-01'),
      deliveryEnd: new Date('2027-02-28'),
    });

    const in2026 = build({ contracts: [straddling], year: 2026 });
    const in2027 = build({
      contracts: [straddling],
      intentions: [intention({ plantingYear: 2027 })],
      yieldEstimates: [yieldFor('Corn', 180, 2027)],
      year: 2027,
    });

    expect(in2026.byCommodity[0].contracted).toBe(50_000);
    expect(in2027.byCommodity[0].contracted).toBe(0);
  });

  it('falls back to harvest-window overlap only when the contract has no cropYear', () => {
    const noCropYear = { cropYear: undefined } as Partial<Contract>;

    const inWindow = build({
      contracts: [contract({ ...noCropYear, deliveryStart: new Date('2026-10-01'), deliveryEnd: new Date('2026-10-31') })],
    });
    const outOfWindow = build({
      contracts: [contract({ ...noCropYear, deliveryStart: new Date('2026-03-01'), deliveryEnd: new Date('2026-03-31') })],
    });

    expect(inWindow.byCommodity[0].contracted).toBe(50_000);
    expect(outOfWindow.byCommodity[0].contracted).toBe(0);
  });

  // ── Units are never added together ────────────────────────────────────────────────────────
  it('carries the contract unit through instead of assuming bushels', () => {
    const result = build({
      intentions: [intention({ crop: 'CANP' })],
      contracts: [contract({ commodityCode: 'CANP', unit: 'CWT', quantity: 2_000 })],
      yieldEstimates: [yieldFor('Canola', 40)],
    });

    expect(result.byCommodity[0].unit).toBe('CWT');
    expect(result.byCommodity[0].contracted).toBe(2_000);
  });

  it('does not sum across units within one commodity, and flags the mix', () => {
    const result = build({
      contracts: [
        contract({ id: 1, unit: 'bu', quantity: 50_000 }),
        contract({ id: 2, unit: 'CWT', quantity: 900 }),
      ],
    });
    const corn = result.byCommodity[0];

    expect(corn.hasMixedUnits).toBe(true);
    expect(corn.contracted).toBe(50_000);          // the dominant unit's total, NOT 50,900
    expect(corn.unit).toBe('bu');
  });

  it('suppresses the overall percentage when commodities use different units', () => {
    const result = build({
      intentions: [intention({ id: 1, crop: 'YC' }), intention({ id: 2, crop: 'CANP', acres: 500 })],
      contracts: [
        contract({ id: 1, commodityCode: 'YC', unit: 'bu', quantity: 50_000 }),
        contract({ id: 2, commodityCode: 'CANP', unit: 'CWT', quantity: 2_000 }),
      ],
      yieldEstimates: [yieldFor('Corn', 180), yieldFor('Canola', 40)],
    });

    expect(result.hasMixedUnits).toBe(true);
    expect(result.totalUnit).toBeNull();
    expect(result.marketSharePercentage).toBeNull();  // bushels + hundredweight is not a number
  });

  it('reports a single shared unit and a real total when everything is bushels', () => {
    const result = build({
      intentions: [intention({ id: 1, crop: 'YC' }), intention({ id: 2, crop: 'HRWW', acres: 500 })],
      contracts: [
        contract({ id: 1, commodityCode: 'YC', quantity: 50_000 }),
        contract({ id: 2, commodityCode: 'HRWW', quantity: 10_000 }),
      ],
      yieldEstimates: [yieldFor('Corn', 180), yieldFor('Wheat', 60)],
    });

    expect(result.hasMixedUnits).toBe(false);
    expect(result.totalUnit).toBe('bu');
    expect(result.totalContracted).toBe(60_000);
    expect(result.totalProjectedYield).toBe(210_000);       // 180,000 + 30,000
    expect(result.marketSharePercentage).toBeCloseTo(28.57, 1);
    expect(result.bushelsAvailable).toBe(150_000);
  });

  // ── Edges ─────────────────────────────────────────────────────────────────────────────────
  it('keeps over-contracted percentages above 100 rather than clamping', () => {
    const corn = build({ contracts: [contract({ quantity: 200_000 })] }).byCommodity[0];

    expect(corn.percentage).toBeGreaterThan(100);
    expect(corn.available).toBe(0);   // available still floors at zero
  });

  it('ignores intentions from other planting years', () => {
    const result = build({ intentions: [intention({ plantingYear: 2025 })] });

    expect(result.byCommodity).toHaveLength(0);
  });
});

describe('findYieldEstimate', () => {
  const estimates = [
    yieldFor('Dryland Corn', 150),
    yieldFor('Corn', 180),
    yieldFor('Corn', 210, 2025),
  ];

  it('prefers the type-prefixed key for the requested year', () => {
    expect(findYieldEstimate(estimates, 'Dryland', 'Corn', 2026)).toBe(150);
  });

  it('falls back to the bare category within the same year', () => {
    expect(findYieldEstimate(estimates, 'Double Crop', 'Corn', 2026)).toBe(180);
  });

  it('NEVER borrows another year\'s estimate', () => {
    // 2027 has no estimate at all. Returning 2026's 180 would invent a projection nobody entered
    // and hide the fact that this season's target is missing.
    expect(findYieldEstimate(estimates, 'Dryland', 'Corn', 2027)).toBeNull();
  });

  it('matches the requested year, not merely the first entry for the crop', () => {
    expect(findYieldEstimate(estimates, undefined, 'Corn', 2025)).toBe(210);
    expect(findYieldEstimate(estimates, undefined, 'Corn', 2026)).toBe(180);
  });

  it('returns null when nothing matches', () => {
    expect(findYieldEstimate(estimates, 'Dryland', 'Sorghum', 2026)).toBeNull();
  });

  it('matches on crop alone when no season is specified', () => {
    expect(findYieldEstimate(estimates, 'Dryland', 'Corn', 0)).toBe(150);
  });
});
