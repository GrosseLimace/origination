import { describe, it, expect } from 'vitest';
import { buildProductionCoverage, findYieldEstimate } from './production-coverage';
import { Commodity, CommodityConversion, Contract, DashboardPlantingEstimate, HarvestWindow, PlantingIntention } from '@models';

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

  // ── Mass units are converted to bushels ───────────────────────────────────────────────────
  // ~3% of soybean contracts are written in short tons, so tonnage has to count toward coverage
  // rather than being dropped or added into a figure mislabelled "bu".
  const soyConversion = [{ commodityCode: 'YSB', lbsPerUnit: 60 }] as CommodityConversion[];

  it('converts short tons to bushels using lb-per-bushel', () => {
    const result = build({
      contracts: [contract({ commodityCode: 'YSB', unit: 'ST', quantity: 300 })],
      conversions: [{ commodityCode: 'YSB', lbsPerUnit: 60 }] as CommodityConversion[],
      intentions: [intention({ crop: 'YSB' })],
      commodities: [...commodities, { id: 4, code: 'YSB', name: 'Soybeans', category: 'Soybeans', isActive: true } as Commodity],
      yieldEstimates: [yieldFor('Soybeans', 55)],
    });

    // 300 ST x 2000 lb ÷ 60 lb/bu = 10,000 bu
    expect(result.byCommodity[0].contracted).toBeCloseTo(10_000, 4);
    expect(result.byCommodity[0].unit).toBe('bu');
    expect(result.byCommodity[0].excludedContracts).toBe(0);
  });

  it('adds converted and native-bushel contracts together', () => {
    const result = build({
      intentions: [intention({ crop: 'YSB' })],
      commodities: [...commodities, { id: 4, code: 'YSB', name: 'Soybeans', category: 'Soybeans', isActive: true } as Commodity],
      yieldEstimates: [yieldFor('Soybeans', 55)],
      conversions: soyConversion,
      contracts: [
        contract({ id: 1, commodityCode: 'YSB', unit: 'BU', quantity: 40_000 }),
        contract({ id: 2, commodityCode: 'YSB', unit: 'ST', quantity: 150 }),   // = 5,000 bu
      ],
    });

    expect(result.byCommodity[0].contracted).toBeCloseTo(45_000, 4);
    expect(result.byCommodity[0].excludedContracts).toBe(0);
  });

  it.each([
    ['LB', 60_000, 1_000],      // 60,000 lb ÷ 60
    ['CW', 600, 1_000],         // 600 cwt x 100 lb ÷ 60
    ['MT', 100, 3_674.371],     // 100 t x 2204.6226 ÷ 60
    ['KG', 60_000, 2_204.6226], // 60,000 kg x 2.2046226 ÷ 60
  ])('converts %s to bushels', (unit, quantity, expected) => {
    const result = build({
      intentions: [intention({ crop: 'YSB' })],
      commodities: [...commodities, { id: 4, code: 'YSB', name: 'Soybeans', category: 'Soybeans', isActive: true } as Commodity],
      yieldEstimates: [yieldFor('Soybeans', 55)],
      conversions: soyConversion,
      contracts: [contract({ commodityCode: 'YSB', unit, quantity })],
    });

    expect(result.byCommodity[0].contracted).toBeCloseTo(expected, 2);
  });

  it('excludes units with no bushel equivalent rather than guessing', () => {
    // Gallons / each / railcars only ever appear on Feed & Fert, Currency and Transportation
    // contracts, which can't match a planting crop — but if one ever did, it must not be invented.
    const result = build({
      conversions: [{ commodityCode: 'YC', lbsPerUnit: 56 }] as CommodityConversion[],
      contracts: [
        contract({ id: 1, unit: 'BU', quantity: 50_000 }),
        contract({ id: 2, unit: 'GL', quantity: 900 }),
      ],
    });

    expect(result.byCommodity[0].contracted).toBe(50_000);
    expect(result.byCommodity[0].excludedContracts).toBe(1);
    expect(result.excludedContracts).toBe(1);
  });

  it('does not count soybean MEAL tonnage as soybean bushels', () => {
    // The real shape of production data: 480M (soybean meal) sits in the SOYBEANS commodity group
    // and is contracted in short tons, with a GNP024 factor of 2000 — pounds per its OWN standard
    // unit (ST), not per bushel. Converting with it would pass 318 tons of meal through as 318
    // bushels of beans. Before this branch that volume was summed in as bushels outright.
    const result = build({
      intentions: [intention({ crop: 'YSB' })],
      commodities: [
        ...commodities,
        { id: 4, code: 'YSB', name: 'Soybeans', category: 'Soybeans', isActive: true } as Commodity,
        { id: 5, code: '480M', name: 'Soybean Meal', category: 'Soybeans', isActive: true } as Commodity,
      ],
      yieldEstimates: [yieldFor('Soybeans', 55)],
      conversions: [
        { commodityCode: 'YSB', lbsPerUnit: 60 },      // real bushels
        { commodityCode: '480M', lbsPerUnit: 2000 },   // lbs per SHORT TON, its own std unit
      ] as CommodityConversion[],
      contracts: [
        contract({ id: 1, commodityCode: 'YSB', unit: 'BU', quantity: 40_000 }),
        contract({ id: 2, commodityCode: '480M', unit: 'ST', quantity: 318 }),
      ],
    });

    expect(result.byCommodity[0].contracted).toBe(40_000);   // beans only
    expect(result.byCommodity[0].excludedContracts).toBe(1); // the meal, reported not hidden
  });

  it('refuses a lb-per-bushel factor outside the plausible grain range', () => {
    // GNP024's column is documented as "lbs-per-bushel (OR per-unit)". A value of 2000 means it is
    // not lbs-per-bushel here, and converting with it would understate by ~33x.
    const result = build({
      conversions: [{ commodityCode: 'YC', lbsPerUnit: 2000 }] as CommodityConversion[],
      contracts: [contract({ unit: 'ST', quantity: 300 })],
    });

    expect(result.byCommodity[0].contracted).toBe(0);
    expect(result.byCommodity[0].excludedContracts).toBe(1);
  });

  it('excludes a mass contract when no conversion factor is available at all', () => {
    const result = build({
      conversions: [],
      contracts: [contract({ unit: 'ST', quantity: 300 })],
    });

    expect(result.byCommodity[0].excludedContracts).toBe(1);
  });

  it('treats a missing unit as bushels', () => {
    const result = build({ contracts: [contract({ unit: '' as unknown as string, quantity: 1_000 })] });
    expect(result.byCommodity[0].contracted).toBe(1_000);
  });

  it.each(['BU', 'bu', 'Bushels', 'BUS'])('recognises %s as bushels', (unit) => {
    // A bushel spelling we failed to recognise would be treated as unconvertible and its volume
    // would silently drop out of the total — the expensive direction to get wrong.
    const result = build({ contracts: [contract({ unit, quantity: 1_000 })] });
    expect(result.byCommodity[0].contracted).toBe(1_000);
    expect(result.byCommodity[0].excludedContracts).toBe(0);
  });

  it('reports totals in bushels across commodities', () => {
    const result = build({
      intentions: [intention({ id: 1, crop: 'YC' }), intention({ id: 2, crop: 'HRWW', acres: 500 })],
      contracts: [
        contract({ id: 1, commodityCode: 'YC', quantity: 50_000 }),
        contract({ id: 2, commodityCode: 'HRWW', quantity: 10_000 }),
      ],
      yieldEstimates: [yieldFor('Corn', 180), yieldFor('Wheat', 60)],
    });

    expect(result.excludedContracts).toBe(0);
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
