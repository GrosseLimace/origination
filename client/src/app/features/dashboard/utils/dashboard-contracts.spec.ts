import { describe, it, expect } from 'vitest';

import { Commodity, Contract } from '@models';
import { buildLbsPerBushelMap } from '@shared/utils/production-coverage';
import {
  DASHBOARD_CHART_COLORS, buildContractCommodityLegend, buildContractCoverageRows, buildContractStatus,
  buildCropDistribution, buildHarvestTimeline, buildSalesOpportunities, contractedBushelsByCategory, filterContractsForYear,
} from './dashboard-contracts';

const COMMODITIES = new Map<string, Commodity>([
  ['YC', { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }],
  ['SB', { id: 2, code: 'SB', name: 'Soybeans', category: 'Soybeans', isActive: true }],
  ['YSBO', { id: 3, code: 'YSBO', name: 'Organic Soybeans', category: 'Soybeans', plantingCategory: 'Organic Soybeans', isActive: true }],
]);

/** SB weighs 60 lb/bu, so 30 short tons is 1,000 bu. */
const LBS = buildLbsPerBushelMap([{ commodityCode: 'SB', lbsPerUnit: 60 }]);

function contract(over: Partial<Contract>): Contract {
  return {
    id: 0, customerId: 1, ctrmCustomerId: 'ALPHA', sourceContractId: 'P0', farmId: 'F1', contractNumber: '0',
    contractPrefixType: 'P', commodityCode: 'YC', commodityDescription: 'Corn', commodityGroup: 'Corn',
    quantity: 0, unit: 'BU', price: 0, cropYear: 2026,
    deliveryStart: new Date(2026, 9, 15, 12), deliveryEnd: new Date(2026, 11, 31, 12),
    status: 'Active', signed: true, ...over,
  };
}

const soy = (over: Partial<Contract>) => contract({ commodityCode: 'SB', commodityDescription: 'Soybeans', commodityGroup: 'Soybeans', ...over });

describe('filterContractsForYear', () => {
  const contracts = [
    contract({ id: 1 }),
    soy({ id: 2 }),
    contract({ id: 3, cropYear: 2025 }),
    contract({ id: 4, commodityCode: 'YSBO', commodityDescription: 'SOYBEANS', commodityGroup: 'SOYBEANS' }),
    contract({ id: 5, commodityCode: 'HRW', commodityDescription: 'HARD RED WINTER WHEAT', commodityGroup: undefined }),
  ];
  const ids = (cs: Contract[]) => cs.map(c => c.id);

  it('keeps only the selected crop year when no crop filter is set', () => {
    expect(ids(filterContractsForYear(contracts, 2026, '', COMMODITIES))).toEqual([1, 2, 4, 5]);
    expect(ids(filterContractsForYear(contracts, 2025, '', COMMODITIES))).toEqual([3]);
  });

  it('matches the filter against the commodity group text, case-insensitively and by substring', () => {
    expect(ids(filterContractsForYear(contracts, 2026, 'Corn', COMMODITIES))).toEqual([1]);
    expect(ids(filterContractsForYear(contracts, 2026, 'soybeans', COMMODITIES))).toEqual([2, 4]);
    // No group, so the description stands in.
    expect(ids(filterContractsForYear(contracts, 2026, 'Wheat', COMMODITIES))).toEqual([5]);
  });

  it('also matches a planting label that no group text contains, through the commodity lookup', () => {
    expect(ids(filterContractsForYear(contracts, 2026, 'Organic Soybeans', COMMODITIES))).toEqual([4]);
  });
});

describe('buildHarvestTimeline / buildContractCommodityLegend', () => {
  it('buckets purchase-contract quantity by delivery month, scaled to the busiest month', () => {
    const months = buildHarvestTimeline([
      contract({ id: 1, sourceContractId: 'P1', quantity: 4000 }), // Oct
      contract({ id: 2, sourceContractId: 'P2', quantity: 6000, deliveryStart: new Date(2026, 9, 1, 12) }), // Oct
      soy({ id: 3, sourceContractId: 'P3', quantity: 30, deliveryStart: new Date(2026, 10, 2, 12) }), // Nov, raw quantity
      contract({ id: 4, sourceContractId: 'S4', quantity: 99999 }), // sale — excluded
      contract({ id: 5, sourceContractId: 'P5', quantity: 5, deliveryStart: undefined as unknown as Date }), // no date — excluded
    ]);

    expect(months).toHaveLength(12);
    expect(months.map(m => m.month)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    expect(months[9]).toMatchObject({ monthIndex: 9, total: 10000, barHeightPct: 100 });
    expect(months[9].segments).toEqual([{ commodity: 'Corn', bushels: 10000, hex: DASHBOARD_CHART_COLORS[0].hex }]);
    expect(months[10]).toMatchObject({ total: 30, barHeightPct: 0.3 });
    expect(months[10].segments[0].hex).toBe(DASHBOARD_CHART_COLORS[1].hex);
    expect(months.filter(m => m.total === 0).every(m => m.barHeightPct === 0 && m.segments.length === 0)).toBe(true);

    expect(buildContractCommodityLegend(months)).toEqual([
      { commodity: 'Corn', hex: DASHBOARD_CHART_COLORS[0].hex },
      { commodity: 'Soybeans', hex: DASHBOARD_CHART_COLORS[1].hex },
    ]);
  });

  it('labels a contract with no commodity text as Other, and an empty year as all-zero bars', () => {
    const months = buildHarvestTimeline([
      contract({ commodityDescription: '', commodityGroup: '', commodityCode: '', quantity: 7 }),
    ]);
    expect(months[9].segments[0].commodity).toBe('Other');
    expect(buildHarvestTimeline([]).every(m => m.total === 0 && m.barHeightPct === 0)).toBe(true);
  });
});

describe('contractedBushelsByCategory', () => {
  it('groups by resolved planting category in bushels, falling back to the description', () => {
    const map = contractedBushelsByCategory([
      contract({ quantity: 1000 }),
      contract({ quantity: 500 }),
      soy({ quantity: 30, unit: 'ST' }), // 1,000 bu
      contract({ commodityCode: 'YSBO', quantity: 200 }),
      contract({ commodityCode: 'ZZ', commodityDescription: 'Sunflowers', quantity: 40 }),
      contract({ commodityCode: 'ZZ', commodityDescription: 'Sunflowers', quantity: 3, unit: 'RC' }), // not convertible
    ], COMMODITIES, LBS);

    expect([...map.entries()]).toEqual([
      ['corn', 1500],
      ['soybeans', 1000],
      ['organic soybeans', 200],
      ['sunflowers', 40],
    ]);
  });
});

describe('buildContractCoverageRows', () => {
  it('compares contracted to estimated bushels per category, capping at 999% and guarding a zero estimate', () => {
    const rows = buildContractCoverageRows(
      [
        { category: 'Corn', totalEstimatedProduction: 26000.4 },
        { category: 'Soybeans', totalEstimatedProduction: 100 },
        { category: 'Wheat', totalEstimatedProduction: 0 },
      ],
      new Map([['corn', 13000], ['soybeans', 500000], ['wheat', 10]]),
    );

    expect(rows).toEqual([
      { category: 'Corn', estimatedBu: 26000, contractedBu: 13000, pct: 50, hex: DASHBOARD_CHART_COLORS[0].hex },
      { category: 'Soybeans', estimatedBu: 100, contractedBu: 500000, pct: 999, hex: DASHBOARD_CHART_COLORS[1].hex },
      { category: 'Wheat', estimatedBu: 0, contractedBu: 10, pct: 0, hex: DASHBOARD_CHART_COLORS[2].hex },
    ]);
  });

  it('reads a category with no contracts as 0 contracted', () => {
    expect(buildContractCoverageRows([{ category: 'Corn', totalEstimatedProduction: 10 }], new Map())[0].contractedBu).toBe(0);
  });
});

describe('buildSalesOpportunities', () => {
  it('summarises open and unpriced bushels per commodity, sorted by open bushels', () => {
    const { rows, excludedContracts } = buildSalesOpportunities([
      contract({ quantity: 13000, openBalanceQuantity: 10000, pricedQuantity: 3000, totalValue: 52000 }),
      soy({ quantity: 30, unit: 'ST', price: 400, openBalanceQuantity: 30, pricedQuantity: 0 }),
      soy({ quantity: 60, unit: 'ST', price: 400, openBalanceQuantity: 0, pricedQuantity: 60 }),
    ], LBS);

    expect(excludedContracts).toBe(0);
    expect(rows).toEqual([
      { commodity: 'Corn', contracts: 1, totalBu: 13000, openBu: 10000, unpricedBu: 10000, avgPrice: 4, hex: DASHBOARD_CHART_COLORS[0].hex },
      // 90 ST = 3,000 bu; 1,000 open; all but 1,000 priced; (30 + 60) × $400 over 3,000 bu = $12/bu.
      { commodity: 'Soybeans', contracts: 2, totalBu: 3000, openBu: 1000, unpricedBu: 1000, avgPrice: 12, hex: DASHBOARD_CHART_COLORS[1].hex },
    ]);
  });

  it('counts contracts it cannot express in bushels, and drops commodities with no volume', () => {
    const { rows, excludedContracts } = buildSalesOpportunities([
      contract({ quantity: 3, unit: 'RC' }), // rail cars
      soy({ quantity: 30, unit: 'ST' }),
      contract({ commodityDescription: 'Milo', commodityGroup: 'Milo', quantity: 0 }),
    ], new Map()); // no conversions at all: the tonnage contract is excluded too

    expect(excludedContracts).toBe(2);
    expect(rows).toEqual([]);
  });

  it('never reports negative unpriced bushels or a price for zero volume', () => {
    const { rows } = buildSalesOpportunities([contract({ quantity: 100, pricedQuantity: 150, totalValue: 0, price: 5 })], LBS);
    expect(rows[0].unpricedBu).toBe(0);
    expect(rows[0].avgPrice).toBe(5); // falls back to quantity × price when totalValue is 0
  });
});

describe('buildCropDistribution / buildContractStatus', () => {
  const contracts = [
    contract({ id: 1, quantity: 3000, status: 'Active' }),
    soy({ id: 2, quantity: 30, unit: 'ST', status: 'Pending' }),
    contract({ id: 3, quantity: 5000, closedDate: new Date(2026, 5, 1), status: 'Active' }), // closed — ignored
    contract({ id: 4, commodityDescription: 'Sorghum', quantity: 1, unit: 'RC', status: 'Odd' }), // not convertible
  ];

  it('shares OPEN contract bushels by commodity, largest first, with known colours', () => {
    expect(buildCropDistribution(contracts, LBS)).toEqual([
      { name: 'Corn', bushels: 3000, percentage: 75, color: 'bg-green-500' },
      { name: 'Soybeans', bushels: 1000, percentage: 25, color: 'bg-blue-500' },
    ]);
    expect(buildCropDistribution([contract({ commodityDescription: 'Sorghum', quantity: 10 })], LBS))
      .toEqual([{ name: 'Sorghum', bushels: 10, percentage: 100, color: 'bg-gray-500' }]);
  });

  it('counts OPEN contracts per status in first-seen order', () => {
    expect(buildContractStatus(contracts)).toEqual([
      { name: 'Active', count: 1, dotColor: 'bg-green-500' },
      { name: 'Pending', count: 1, dotColor: 'bg-amber-500' },
      { name: 'Odd', count: 1, dotColor: 'bg-gray-500' },
    ]);
  });
});
