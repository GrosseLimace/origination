import { Commodity, Contract } from '@models';
import { quantityInBushels, sumInBushels } from '@shared/utils/production-coverage';
import { commodityPlantingCategory } from '@shared/utils/planting-category';

/**
 * Contract math behind the dashboard's Harvest & Contracts tab and its headline contract metrics.
 * Pure: the component reads the signals and passes the values in, so its computeds track the same
 * state they always did. Moved out of DashboardComponent unchanged.
 */

/** Series colours for the contract charts, assigned by position (not by crop). */
export const DASHBOARD_CHART_COLORS = [
  { bar: 'bg-scoular-green', dot: 'bg-scoular-green', hex: '#00A36F' },
  { bar: 'bg-blue-500', dot: 'bg-blue-500', hex: '#3b82f6' },
  { bar: 'bg-amber-500', dot: 'bg-amber-500', hex: '#f59e0b' },
  { bar: 'bg-purple-500', dot: 'bg-purple-500', hex: '#a855f7' },
  { bar: 'bg-red-500', dot: 'bg-red-500', hex: '#ef4444' },
  { bar: 'bg-teal-500', dot: 'bg-teal-500', hex: '#14b8a6' },
  { bar: 'bg-orange-500', dot: 'bg-orange-500', hex: '#f97316' },
  { bar: 'bg-indigo-500', dot: 'bg-indigo-500', hex: '#6366f1' },
];

export interface HarvestTimelineMonth {
  month: string;
  monthIndex: number;
  segments: { commodity: string; bushels: number; hex: string }[];
  total: number;
  barHeightPct: number;
}

export interface ContractCoverageRow {
  category: string;
  estimatedBu: number;
  contractedBu: number;
  pct: number;
  hex: string;
}

export interface SalesOpportunityRow {
  commodity: string;
  contracts: number;
  totalBu: number;
  openBu: number;
  unpricedBu: number;
  avgPrice: number;
  hex: string;
}

/** The selected crop year's contracts, narrowed to the top crop filter when one is set. */
export function filterContractsForYear(
  source: Contract[],
  year: number,
  cropFilter: string,
  commodityByCode: Map<string, Commodity>,
): Contract[] {
  return source.filter(c => {
    if (c.cropYear !== year) return false;
    if (cropFilter) {
      const filter = cropFilter.toLowerCase();
      const group = (c.commodityGroup || c.commodityDescription || c.commodityCode || '').toLowerCase();
      // The top crop filter can now be a planting label ("Organic Soybeans") that no ODS commodity
      // group text contains, so also match the contract's commodity through the same resolver.
      const label = (commodityPlantingCategory(commodityByCode.get(c.commodityCode || '')) || '').toLowerCase();
      if (label !== filter && !group.includes(filter) && filter !== group) return false;
    }
    return true;
  });
}

/** Purchase-contract quantity by delivery-start month, stacked by commodity. */
export function buildHarvestTimeline(contracts: Contract[]): HarvestTimelineMonth[] {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const commodityColorMap = new Map<string, string>();
  let colorIdx = 0;
  const monthData: Map<number, Map<string, number>> = new Map();
  for (let i = 0; i < 12; i++) monthData.set(i, new Map());

  for (const c of contracts) {
    if (!c.deliveryStart) continue;
    if (!c.sourceContractId?.startsWith('P')) continue; // Purchase contracts only
    const d = new Date(c.deliveryStart);
    const monthIdx = d.getMonth();
    const commodity = c.commodityDescription || c.commodityGroup || c.commodityCode || 'Other';
    if (!commodityColorMap.has(commodity)) {
      commodityColorMap.set(commodity, DASHBOARD_CHART_COLORS[colorIdx++ % DASHBOARD_CHART_COLORS.length].hex);
    }
    const m = monthData.get(monthIdx)!;
    m.set(commodity, (m.get(commodity) || 0) + (c.quantity || 0));
  }

  const raw = MONTHS.map((month, i) => {
    const m = monthData.get(i)!;
    const segments = [...m.entries()].map(([commodity, bushels]) => ({
      commodity, bushels, hex: commodityColorMap.get(commodity)!
    }));
    const total = segments.reduce((s, x) => s + x.bushels, 0);
    return { month, monthIndex: i, segments, total, barHeightPct: 0 };
  });

  const max = Math.max(...raw.map(m => m.total), 1);
  return raw.map(m => ({ ...m, barHeightPct: (m.total / max) * 100 }));
}

/** Each commodity in the timeline once, in first-seen order, with its colour. */
export function buildContractCommodityLegend(months: HarvestTimelineMonth[]): { commodity: string; hex: string }[] {
  const seen = new Set<string>();
  const result: { commodity: string; hex: string }[] = [];
  for (const m of months) {
    for (const seg of m.segments) {
      if (!seen.has(seg.commodity)) {
        seen.add(seg.commodity);
        result.push({ commodity: seg.commodity, hex: seg.hex });
      }
    }
  }
  return result;
}

/**
 * Contracted quantity by resolved (lower-cased) planting category — uses the Commodities table
 * lookup so contracts group by the same category name as planting intentions.
 */
export function contractedBushelsByCategory(
  contracts: Contract[],
  commodityMap: Map<string, Commodity>,
  lbsPerBushelByCode: Map<string, number>,
): Map<string, number> {
  // Totals are BUSHELS, not raw quantity. A commodity group carries processed products priced by
  // weight — soybean meal and oil in short tons, popcorn by the pound — and adding their quantity
  // straight in overstated contracted volume against a bushel production estimate. Same helper the
  // producer page uses, so the two agree.
  const byCategory = new Map<string, Contract[]>();
  for (const c of contracts) {
    const commodity = commodityMap.get(c.commodityCode || '') || commodityMap.get(c.commodityDescription || '');
    const category = (commodityPlantingCategory(commodity) || c.commodityDescription || c.commodityGroup || c.commodityCode || '').toLowerCase();
    const arr = byCategory.get(category);
    if (arr) arr.push(c); else byCategory.set(category, [c]);
  }

  const map = new Map<string, number>();
  for (const [category, contracts] of byCategory) {
    map.set(category, sumInBushels(contracts, lbsPerBushelByCode).contracted);
  }
  return map;
}

/** Contracted vs estimated bushels per Season Targets category, capped at 999%. */
export function buildContractCoverageRows(
  categoryRows: { category: string; totalEstimatedProduction: number }[],
  contractedMap: Map<string, number>,
): ContractCoverageRow[] {
  return categoryRows.map((row, i) => {
    const categoryLower = row.category.toLowerCase();
    const contracted = contractedMap.get(categoryLower) || 0;
    const pct = row.totalEstimatedProduction > 0
      ? Math.min(Math.round((contracted / row.totalEstimatedProduction) * 100), 999)
      : 0;
    return {
      category: row.category,
      estimatedBu: Math.round(row.totalEstimatedProduction),
      contractedBu: contracted,
      pct,
      hex: DASHBOARD_CHART_COLORS[i % DASHBOARD_CHART_COLORS.length].hex
    };
  });
}

// In BUSHELS, like Contract Coverage beside it. On raw quantity a 30-ton contract read as "30 bu"
// while Coverage counted it as 1,000, and in PROD 18% of purchase contracts are not in bushels
// (short tons, pounds, metric tons, ...). A contract whose unit cannot be expressed in bushels
// (rail cars, gallons, "each", or a commodity with no lb-per-bushel factor) is left out and
// counted, so the card can say so rather than dropping it silently. Avg Price is total value per
// bushel, so a $/ton price no longer averages in as if it were $/bu.
export function buildSalesOpportunities(
  contracts: Contract[],
  lbsPerBushelByCode: Map<string, number>,
): { rows: SalesOpportunityRow[]; excludedContracts: number } {
  const map = new Map<string, { total: number; open: number; priced: number; value: number; count: number }>();
  let excludedContracts = 0;
  for (const c of contracts) {
    const total = quantityInBushels(c, c.quantity || 0, lbsPerBushelByCode);
    if (total == null) {
      excludedContracts++;
      continue;
    }
    const cat = c.commodityDescription || c.commodityGroup || c.commodityCode || 'Other';
    if (!map.has(cat)) map.set(cat, { total: 0, open: 0, priced: 0, value: 0, count: 0 });
    const m = map.get(cat)!;
    m.total += total;
    // Same unit as the contract quantity, so the same conversion applies.
    m.open += quantityInBushels(c, c.openBalanceQuantity || 0, lbsPerBushelByCode) ?? 0;
    m.priced += quantityInBushels(c, c.pricedQuantity || 0, lbsPerBushelByCode) ?? 0;
    m.value += c.totalValue || ((c.quantity || 0) * (c.price || 0));
    m.count++;
  }
  const rows = [...map.entries()]
    .map(([commodity, v], i) => ({
      commodity,
      contracts: v.count,
      totalBu: v.total,
      openBu: v.open,
      unpricedBu: Math.max(0, v.total - v.priced),
      avgPrice: v.total > 0 ? v.value / v.total : 0,
      hex: DASHBOARD_CHART_COLORS[i % DASHBOARD_CHART_COLORS.length].hex
    }))
    .filter(r => r.totalBu > 0)
    .sort((a, b) => b.openBu - a.openBu);
  return { rows, excludedContracts };
}

/** Share of OPEN contract volume by commodity description, largest first. */
export function buildCropDistribution(
  contracts: Contract[],
  lbsPerBushelByCode: Map<string, number>,
): { name: string; bushels: number; percentage: number; color: string }[] {
  // Shares are computed from BUSHELS. On raw quantity a tonnage commodity's slice was sized by its
  // ton count, so it looked far smaller than the volume it represents.
  const cropMap = new Map<string, number>();
  for (const contract of contracts.filter(c => !c.closedDate)) {
    const commodity = contract.commodityDescription || contract.commodityCode || 'Unknown';
    const bushels = quantityInBushels(contract, contract.quantity || 0, lbsPerBushelByCode);
    if (bushels == null) continue;
    cropMap.set(commodity, (cropMap.get(commodity) || 0) + bushels);
  }

  const total = Array.from(cropMap.values()).reduce((a, b) => a + b, 0);
  const cropColors: Record<string, string> = {
    'Corn': 'bg-green-500',
    'Soybeans': 'bg-blue-500',
    'Wheat': 'bg-amber-500',
    'Milo': 'bg-orange-500'
  };

  return Array.from(cropMap.entries())
    .map(([name, bushels]) => ({
      name,
      bushels,
      percentage: Math.round((bushels / total) * 100),
      color: cropColors[name] || 'bg-gray-500'
    }))
    .sort((a, b) => b.bushels - a.bushels);
}

/** Count of OPEN contracts per status, in first-seen order. */
export function buildContractStatus(contracts: Contract[]): { name: string; count: number; dotColor: string }[] {
  const statusMap = new Map<string, number>();
  for (const contract of contracts.filter(c => !c.closedDate)) {
    statusMap.set(contract.status, (statusMap.get(contract.status) || 0) + 1);
  }

  const statusColors: Record<string, string> = {
    'Active': 'bg-green-500',
    'Pending': 'bg-amber-500',
    'Fulfilled': 'bg-blue-500',
    'Cancelled': 'bg-scoular-red'
  };

  return Array.from(statusMap.entries()).map(([name, count]) => ({
    name,
    count,
    dotColor: statusColors[name] || 'bg-gray-500'
  }));
}
