import { describe, it, expect } from 'vitest';

import { Commodity, Contract, DashboardActualHarvest, PlantingIntention } from '@models';
import { commodityColor } from '@shared/utils/commodity-color';
import {
  availableHarvestCropCategories, buildActualHarvestRows, buildActualMarketShareRows, buildAvailableCrops, buildCategoryRows,
  buildCropBreakdown, buildCropDetailsRows, buildYieldEstimateMap, buildYieldRows, cropDistributionGradient, filterIntentionsForYear,
  groupIntentionsByCropKey, inPlantingScope, inScopeAcresForYear, intentionProductionPairs, plantingYearsDescending,
  projectedProduction, weightedAverageYield,
} from './dashboard-planting';

const COMMODITY_LIST: Commodity[] = [
  { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true },
  { id: 2, code: 'SB', name: 'Soybeans', category: 'Soybeans', isActive: true },
  { id: 3, code: 'YSBO', name: 'Organic Soybeans', category: 'Soybeans', plantingCategory: 'Organic Soybeans', isActive: true },
  { id: 4, code: 'FRT', name: 'Freight', category: 'Transportation', isActive: true },
  { id: 5, code: 'HRW', name: 'Hard Red Winter Wheat', category: 'Wheat', isActive: true },
];
const COMMODITIES = new Map(COMMODITY_LIST.map(c => [c.code, c]));

function pi(over: Partial<PlantingIntention>): PlantingIntention {
  return {
    id: 0, customerId: 1, customerName: 'Alpha', customerCode: 'ALPHA', tradeUnit: '2090',
    plantingYear: 2026, crop: 'YC', acres: 0, createdAt: '2026-01-01', createdBy: 'test', ...over,
  };
}

const CUSTOMERS = new Set([1, 2]);
const TU = new Set(['2090']);

const INTENTIONS = [
  pi({ id: 1, crop: 'YC', type: 'Irrigated', acres: 100 }),
  pi({ id: 2, crop: 'YC', type: 'Dryland', acres: 50 }),
  pi({ id: 3, customerId: 2, crop: 'SB', acres: 200 }),
  pi({ id: 4, customerId: 2, crop: 'YC', type: 'Dryland', acres: 30, tradeUnit: '3811' }), // other trade unit
  pi({ id: 5, crop: 'YC', type: 'Irrigated', acres: 80, plantingYear: 2025 }),
  pi({ id: 6, customerId: 99, crop: 'YC', acres: 500 }), // producer not loaded
  pi({ id: 7, customerId: 2, crop: 'YSBO', acres: 10, plantingYear: '2026' as unknown as number }), // year as a string
];
const ids = (ps: PlantingIntention[]) => ps.map(p => p.id);

describe('scope and year filters', () => {
  it('counts a row only for a loaded producer and a selected trade unit; no trade units means all', () => {
    expect(inPlantingScope(INTENTIONS[0], CUSTOMERS, TU)).toBe(true);
    expect(inPlantingScope(INTENTIONS[3], CUSTOMERS, TU)).toBe(false);
    expect(inPlantingScope(INTENTIONS[3], CUSTOMERS, new Set())).toBe(true);
    expect(inPlantingScope(INTENTIONS[5], CUSTOMERS, new Set())).toBe(false);
  });

  it('keeps one year (string or number) in scope, narrowed to the top crop filter by category', () => {
    expect(ids(filterIntentionsForYear(INTENTIONS, 2026, CUSTOMERS, TU, '', COMMODITIES))).toEqual([1, 2, 3, 7]);
    expect(ids(filterIntentionsForYear(INTENTIONS, 2026, CUSTOMERS, TU, 'Corn', COMMODITIES))).toEqual([1, 2]);
    expect(ids(filterIntentionsForYear(INTENTIONS, 2026, CUSTOMERS, TU, 'Organic Soybeans', COMMODITIES))).toEqual([7]);
    expect(ids(filterIntentionsForYear(INTENTIONS, 2025, CUSTOMERS, TU, '', COMMODITIES))).toEqual([5]);
  });

  it('totals in-scope acres for a year, ignoring the crop filter', () => {
    expect(inScopeAcresForYear(INTENTIONS, 2025, CUSTOMERS, TU)).toBe(80);
    expect(inScopeAcresForYear(INTENTIONS, 2024, CUSTOMERS, TU)).toBe(0);
  });

  it('lists distinct planting years newest first', () => {
    expect(plantingYearsDescending([pi({ plantingYear: 2024 }), pi({ plantingYear: 2026 }), pi({ plantingYear: 2024 }), pi({ plantingYear: 2025 })]))
      .toEqual([2026, 2025, 2024]);
  });
});

describe('production and yield', () => {
  const yieldMap = buildYieldEstimateMap([
    { id: 1, tradeUnitKey: '2090', crop: 'Irrigated Corn', plantingYear: 2026, yieldEstimate: 200 },
    { id: 2, tradeUnitKey: '2090', crop: 'Soybeans', plantingYear: 2026, yieldEstimate: 50 },
    { id: 3, tradeUnitKey: '2090', crop: 'Dryland Corn', plantingYear: 2026, yieldEstimate: undefined },
  ]);

  it('maps estimates by crop key, with a missing estimate as null', () => {
    expect([...yieldMap.entries()]).toEqual([['Irrigated Corn', 200], ['Soybeans', 50], ['Dryland Corn', null]]);
  });

  it('pairs acres with the estimate for each intention\'s type + category key', () => {
    const pairs = intentionProductionPairs(INTENTIONS.slice(0, 3), yieldMap, COMMODITIES);
    expect(pairs).toEqual([{ acres: 100, yieldEst: 200 }, { acres: 50, yieldEst: null }, { acres: 200, yieldEst: 50 }]);
    // 100*200 + 200*50; the 50 unestimated acres count toward neither figure.
    expect(projectedProduction(pairs)).toBe(30000);
    expect(weightedAverageYield(pairs)).toBe(100);
  });

  it('reads no estimates as zero production and a zero average', () => {
    const pairs = [{ acres: 10, yieldEst: null }];
    expect(projectedProduction(pairs)).toBe(0);
    expect(weightedAverageYield(pairs)).toBe(0);
    expect(weightedAverageYield([])).toBe(0);
  });

  it('rounds the weighted average', () => {
    expect(weightedAverageYield([{ acres: 100, yieldEst: 200 }, { acres: 50, yieldEst: 120 }])).toBe(173);
  });
});

describe('buildAvailableCrops', () => {
  it('merges in-scope planting categories with title-cased contract groups, de-duplicated and sorted', () => {
    const contracts = [
      { commodityGroup: 'CORN', commodityDescription: 'YELLOW CORN' },
      { commodityGroup: '', commodityDescription: 'HARD RED WINTER WHEAT' },
      { commodityGroup: '', commodityDescription: '' },
    ] as Contract[];
    expect(buildAvailableCrops(INTENTIONS, CUSTOMERS, TU, COMMODITIES, contracts))
      .toEqual(['Corn', 'Hard Red Winter Wheat', 'Organic Soybeans', 'Soybeans']);
  });
});

describe('By Crop', () => {
  const year = filterIntentionsForYear(INTENTIONS, 2026, CUSTOMERS, TU, '', COMMODITIES);

  it('groups by category with no top filter, and by type + category with one', () => {
    expect([...groupIntentionsByCropKey(year, false, COMMODITIES).entries()].map(([k, v]) => [k, ids(v)]))
      .toEqual([['Corn', [1, 2]], ['Soybeans', [3]], ['Organic Soybeans', [7]]]);
    expect([...groupIntentionsByCropKey(year, true, COMMODITIES).keys()])
      .toEqual(['Irrigated Corn', 'Dryland Corn', 'Soybeans', 'Organic Soybeans']);
  });

  it('breaks acres down largest first with rounded shares, coloured by the crop', () => {
    const rows = buildCropBreakdown(year, false, COMMODITIES);
    expect(rows.map(r => [r.name, r.acres, r.pct])).toEqual([['Soybeans', 200, 56], ['Corn', 150, 42], ['Organic Soybeans', 10, 3]]);
    expect(rows[1]).toMatchObject({ barColor: commodityColor('Corn').bar, dotColor: commodityColor('Corn').bar, hex: commodityColor('Corn').hex });
    // Split by type once a crop is picked, but still coloured as the crop.
    const split = buildCropBreakdown(year.filter(p => p.crop === 'YC'), true, COMMODITIES);
    expect(split.map(r => [r.name, r.pct, r.hex])).toEqual([
      ['Irrigated Corn', 67, commodityColor('Corn').hex], ['Dryland Corn', 33, commodityColor('Corn').hex],
    ]);
    expect(buildCropBreakdown([], false, COMMODITIES)).toEqual([]);
  });

  it('builds the donut gradient, filling any rounding gap with the first crop and greying an empty chart', () => {
    expect(cropDistributionGradient([])).toBe('conic-gradient(#e5e7eb 0deg 360deg)');
    expect(cropDistributionGradient([{ pct: 50, hex: '#a' }, { pct: 49, hex: '#b' }]))
      .toBe('conic-gradient(#a 0deg 180deg, #b 180deg 356.4deg, #a 356.4deg 360deg)');
    expect(cropDistributionGradient([{ pct: 100, hex: '#a' }])).toBe('conic-gradient(#a 0deg 360deg)');
  });

  it('derives acre-weighted yield, production and growers per breakdown row', () => {
    const yieldMap = new Map<string, number | null>([['Irrigated Corn', 200], ['Dryland Corn', 120]]);
    const breakdown = buildCropBreakdown(year, false, COMMODITIES);
    const rows = buildCropDetailsRows(breakdown, groupIntentionsByCropKey(year, false, COMMODITIES), yieldMap, COMMODITIES);
    expect(rows).toEqual([
      { name: 'Soybeans', acres: 200, avgYield: null, production: null, growers: 1, dotColor: breakdown[0].dotColor },
      { name: 'Corn', acres: 150, avgYield: 173, production: 26000, growers: 1, dotColor: breakdown[1].dotColor },
      { name: 'Organic Soybeans', acres: 10, avgYield: null, production: null, growers: 1, dotColor: breakdown[2].dotColor },
    ]);
  });
});

describe('Season Targets rows', () => {
  it('builds yield rows per type + crop, grouped by commodity, with saved estimates', () => {
    const rows = buildYieldRows(
      [...INTENTIONS.slice(0, 3), pi({ crop: 'YC', type: 'Irrigated', acres: 5 }), pi({ crop: 'ZZ', acres: 1 }), pi({ crop: 'SB', type: 'Dryland', acres: 7 })],
      COMMODITIES,
      new Map<string, number | null>([['Irrigated Corn', 200], ['Soybeans', null]]),
    );
    expect(rows).toEqual([
      { cropCode: 'Dryland Corn', cropName: 'Dryland Corn', category: 'Corn', totalAcres: 50, yieldEstimate: null },
      { cropCode: 'Irrigated Corn', cropName: 'Irrigated Corn', category: 'Corn', totalAcres: 105, yieldEstimate: 200 },
      // All of a commodity together: "Dryland Soybeans" sorts after "Irrigated Corn", not before it.
      { cropCode: 'Dryland Soybeans', cropName: 'Dryland Soybeans', category: 'Soybeans', totalAcres: 7, yieldEstimate: null },
      { cropCode: 'Soybeans', cropName: 'Soybeans', category: 'Soybeans', totalAcres: 200, yieldEstimate: null },
      // Unknown code: the code stands in as the category.
      { cropCode: 'ZZ', cropName: 'ZZ', category: 'ZZ', totalAcres: 1, yieldEstimate: null },
    ]);
  });

  it('sums production per category and applies the saved market share', () => {
    const rows = buildCategoryRows(
      [
        { cropCode: 'Dryland Corn', cropName: 'Dryland Corn', category: 'Corn', totalAcres: 50, yieldEstimate: 120 },
        { cropCode: 'Irrigated Corn', cropName: 'Irrigated Corn', category: 'Corn', totalAcres: 100, yieldEstimate: 200 },
        { cropCode: 'Soybeans', cropName: 'Soybeans', category: 'Soybeans', totalAcres: 200, yieldEstimate: null },
        { cropCode: 'Wheat', cropName: 'Wheat', category: 'Wheat', totalAcres: 0, yieldEstimate: 60 },
      ],
      [
        { id: 1, tradeUnitKey: '2090', cropCategory: 'Corn', plantingYear: 2026, marketSharePct: 10 },
        { id: 2, tradeUnitKey: '2090', cropCategory: 'Soybeans', plantingYear: 2026, marketSharePct: 25 },
      ],
    );
    expect(rows).toEqual([
      { category: 'Corn', totalEstimatedProduction: 26000, marketSharePct: 10, estimatedHarvestHandle: 2600 },
      // A share with no production gives no handle.
      { category: 'Soybeans', totalEstimatedProduction: 0, marketSharePct: 25, estimatedHarvestHandle: 0 },
      { category: 'Wheat', totalEstimatedProduction: 0, marketSharePct: null, estimatedHarvestHandle: 0 },
    ]);
  });
});

describe('actual harvest', () => {
  const h = (id: number, cropCategory: string, bushels: number, over: Partial<DashboardActualHarvest> = {}): DashboardActualHarvest =>
    ({ id, tradeUnitKey: '2090', cropCategory, plantingYear: 2025, bushels, ...over });

  it('keeps last season\'s rows for this trade-unit key, sorted by crop', () => {
    const saved = [h(1, 'Wheat', 5), h(2, 'Corn', 13), h(3, 'Corn', 9, { tradeUnitKey: '3811' }), h(4, 'Corn', 7, { plantingYear: 2024 })];
    expect(buildActualHarvestRows(saved, '2090', 2025)).toEqual([
      { id: 2, cropCategory: 'Corn', bushels: 13 },
      { id: 1, cropCategory: 'Wheat', bushels: 5 },
    ]);
    expect(saved.map(x => x.id)).toEqual([1, 2, 3, 4]); // not sorted in place
  });

  it('offers only unused, crop-like commodity categories for a new harvest row', () => {
    expect(availableHarvestCropCategories(
      [...COMMODITY_LIST, { id: 9, code: 'X', name: 'X', category: 'CURRENCY', isActive: true }, { id: 10, code: 'Y', name: 'Y', isActive: true } as Commodity],
      new Set(['Wheat']),
    )).toEqual(['Corn', 'Soybeans']);
  });

  it('compares harvest to estimated production, with a null share when nothing was estimated', () => {
    expect(buildActualMarketShareRows(
      [{ cropCategory: 'Corn', bushels: 13000 }, { cropCategory: 'Wheat', bushels: 5000 }],
      [{ category: 'Corn', totalEstimatedProduction: 26000 }, { category: 'Soybeans', totalEstimatedProduction: 10000 }],
    )).toEqual([
      { cropCategory: 'Corn', harvestBushels: 13000, totalEstimatedProduction: 26000, pct: 50 },
      { cropCategory: 'Soybeans', harvestBushels: 0, totalEstimatedProduction: 10000, pct: 0 },
      { cropCategory: 'Wheat', harvestBushels: 5000, totalEstimatedProduction: 0, pct: null },
    ]);
  });
});
