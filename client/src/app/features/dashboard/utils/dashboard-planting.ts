import { Commodity, Contract, DashboardActualHarvest, DashboardMarketShare, DashboardPlantingEstimate, PlantingIntention } from '@models';
import { commodityColor } from '@shared/utils/commodity-color';
import { plantingCategory } from '@shared/utils/planting-category';
import { inSelectedTradeUnits } from '@shared/utils/planting-trade-unit-filter';
import { dashboardCropKey, toTitleCase } from './dashboard-format';

/**
 * Planting-intention rollups behind the dashboard's headline stats, By Crop tab and Season Targets.
 * Pure: the component reads the signals and passes the values in. Moved out of DashboardComponent
 * unchanged.
 */

/** Season Targets table 1: one row per planting type + crop (e.g. "Irrigated Corn"). */
export interface YieldRow {
  cropCode: string;
  cropName: string;
  category: string;
  totalAcres: number;
  yieldEstimate: number | null;
}

/** Season Targets tables 2-4: one row per crop category. */
export interface CategoryRow {
  category: string;
  totalEstimatedProduction: number;
  marketSharePct: number | null;
  estimatedHarvestHandle: number;
}

export interface CropBreakdownRow {
  name: string;
  acres: number;
  pct: number;
  barColor: string;
  dotColor: string;
  hex: string;
}

/** Categories that are never offered as an actual-harvest crop. */
export const HARVEST_EXCLUDED_CATEGORIES = ['transportation', 'currency', 'feed & fert ingredients'];

/**
 * Planting rows are tagged with the trade unit they were recorded for, and every acre figure on the
 * dashboard counts a row only under that trade unit — and only for a loaded producer. An empty
 * trade-unit set ("All Producers") filters nothing out.
 */
export function inPlantingScope(p: PlantingIntention, customerIdSet: Set<number>, tradeUnitSet: Set<string>): boolean {
  return customerIdSet.has(p.customerId) && inSelectedTradeUnits(p, tradeUnitSet);
}

/** In-scope intentions for one planting year, narrowed to the top crop filter when one is set. */
export function filterIntentionsForYear(
  intentions: PlantingIntention[],
  year: number,
  customerIdSet: Set<number>,
  tradeUnitSet: Set<string>,
  cropFilter: string,
  commodityByCode: Map<string, Commodity>,
): PlantingIntention[] {
  return intentions.filter(p => {
    if (+p.plantingYear !== +year) return false;
    if (!inPlantingScope(p, customerIdSet, tradeUnitSet)) return false;
    if (cropFilter) {
      const commodity = commodityByCode.get(p.crop);
      const category = plantingCategory(p, commodity);
      if (category !== cropFilter) return false;
    }
    return true;
  });
}

/** Total in-scope acres for one planting year (no crop filter). */
export function inScopeAcresForYear(
  intentions: PlantingIntention[],
  year: number,
  customerIdSet: Set<number>,
  tradeUnitSet: Set<string>,
): number {
  return intentions
    .filter(p => +p.plantingYear === year && inPlantingScope(p, customerIdSet, tradeUnitSet))
    .reduce((sum, p) => sum + p.acres, 0);
}

export function buildYieldEstimateMap(estimates: DashboardPlantingEstimate[]): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const e of estimates) {
    map.set(e.crop, e.yieldEstimate ?? null);
  }
  return map;
}

/** Each intention's acres with the yield estimate saved for its type + crop key (null when none). */
export function intentionProductionPairs(
  intentions: PlantingIntention[],
  yieldMap: Map<string, number | null>,
  commodityByCode: Map<string, Commodity>,
): { acres: number; yieldEst: number | null }[] {
  return intentions.map(p => {
    const commodity = commodityByCode.get(p.crop);
    const category = plantingCategory(p, commodity);
    const cropKey = dashboardCropKey(p.type, category);
    return { acres: p.acres, yieldEst: yieldMap.get(cropKey) ?? null };
  });
}

/** Acres × yield over the intentions that have an estimate, unrounded. */
export function projectedProduction(pairs: { acres: number; yieldEst: number | null }[]): number {
  return pairs
    .filter(p => p.yieldEst != null)
    .reduce((sum, p) => sum + p.acres * p.yieldEst!, 0);
}

/** Acre-weighted average yield over the intentions that have an estimate; 0 when none do. */
export function weightedAverageYield(allPairs: { acres: number; yieldEst: number | null }[]): number {
  const pairs = allPairs.filter(p => p.yieldEst != null);
  const totalAcres = pairs.reduce((sum, p) => sum + p.acres, 0);
  const totalProd = pairs.reduce((sum, p) => sum + p.acres * p.yieldEst!, 0);
  return totalAcres > 0 ? Math.round(totalProd / totalAcres) : 0;
}

/** The top "Filter by Crop" options: in-scope planting categories plus contract commodity groups. */
export function buildAvailableCrops(
  intentions: PlantingIntention[],
  customerIdSet: Set<number>,
  tradeUnitSet: Set<string>,
  commodityByCode: Map<string, Commodity>,
  contracts: Contract[],
): string[] {
  const crops = new Set<string>();

  for (const p of intentions) {
    if (!inPlantingScope(p, customerIdSet, tradeUnitSet)) continue;
    const commodity = commodityByCode.get(p.crop);
    const category = plantingCategory(p, commodity);
    if (category) crops.add(toTitleCase(category));
  }

  // Contracts come from ODS, where strings are stored ALL-CAPS ("WHEAT",
  // "HARD RED WINTER WHEAT"). Title-case them on the way into the dropdown
  // so they merge with the already-Title-Cased planting-intention categories
  // instead of appearing as duplicate "WHEAT" / "Wheat" options.
  for (const c of contracts) {
    const group = c.commodityGroup || c.commodityDescription;
    if (group) crops.add(toTitleCase(group));
  }

  return [...crops].sort();
}

/** The By Crop grouping key: the category, or type + category once a crop is picked at the top. */
function cropGroupKey(p: PlantingIntention, category: string, cropFilterSet: boolean): string {
  return cropFilterSet ? dashboardCropKey(p.type, category) : category;
}

/** Intentions indexed by their By Crop key — O(n) lookup instead of O(n²) in the crop details rows. */
export function groupIntentionsByCropKey(
  intentions: PlantingIntention[],
  cropFilterSet: boolean,
  commodityByCode: Map<string, Commodity>,
): Map<string, PlantingIntention[]> {
  const map = new Map<string, PlantingIntention[]>();
  for (const p of intentions) {
    const commodity = commodityByCode.get(p.crop);
    const category = plantingCategory(p, commodity);
    const key = cropGroupKey(p, category, cropFilterSet);
    const arr = map.get(key);
    if (arr) arr.push(p); else map.set(key, [p]);
  }
  return map;
}

/** Acres per By Crop key, largest first, with rounded shares and the crop's shared colour. */
export function buildCropBreakdown(
  intentions: PlantingIntention[],
  cropFilterSet: boolean,
  commodityByCode: Map<string, Commodity>,
): CropBreakdownRow[] {
  // Track the underlying crop CATEGORY per row so color is by crop, not sort position —
  // e.g. "Irrigated Corn" and "Dryland Corn" stay as separate rows but both color as Corn.
  const cropMap = new Map<string, { acres: number; category: string }>();
  for (const p of intentions) {
    const commodity = commodityByCode.get(p.crop);
    const category = plantingCategory(p, commodity);
    const key = cropGroupKey(p, category, cropFilterSet);
    const entry = cropMap.get(key);
    if (entry) entry.acres += p.acres;
    else cropMap.set(key, { acres: p.acres, category });
  }
  const total = [...cropMap.values()].reduce((a, b) => a + b.acres, 0);
  return [...cropMap.entries()]
    .sort((a, b) => b[1].acres - a[1].acres)
    .map(([name, { acres, category }]) => {
      const color = commodityColor(category); // shared per-crop color (same everywhere)
      return {
        name,
        acres,
        pct: total > 0 ? Math.round((acres / total) * 100) : 0,
        barColor: color.bar,
        dotColor: color.bar,
        hex: color.hex
      };
    });
}

/** CSS conic-gradient for the Crop Distribution donut; grey when there is nothing to show. */
export function cropDistributionGradient(breakdown: { pct: number; hex: string }[]): string {
  if (breakdown.length === 0) return 'conic-gradient(#e5e7eb 0deg 360deg)';
  let deg = 0;
  const stops: string[] = [];
  for (const c of breakdown) {
    const end = deg + (c.pct / 100) * 360;
    stops.push(`${c.hex} ${deg}deg ${end}deg`);
    deg = end;
  }
  if (deg < 360) stops.push(`${breakdown[0].hex} ${deg}deg 360deg`);
  return `conic-gradient(${stops.join(', ')})`;
}

/** Crop Details table: acre-weighted yield, production and grower count per By Crop row. */
export function buildCropDetailsRows(
  breakdown: CropBreakdownRow[],
  intentionsMap: Map<string, PlantingIntention[]>,
  yieldMap: Map<string, number | null>,
  commodityByCode: Map<string, Commodity>,
) {
  return breakdown.map(c => {
    const matching = intentionsMap.get(c.name) || [];
    let totalProd = 0;
    let totalAcresWeighted = 0;
    for (const p of matching) {
      const commodity = commodityByCode.get(p.crop);
      const category = plantingCategory(p, commodity);
      const cropKey = dashboardCropKey(p.type, category);
      const yieldEst = yieldMap.get(cropKey);
      if (yieldEst != null) {
        totalProd += p.acres * yieldEst;
        totalAcresWeighted += p.acres;
      }
    }
    const avgYield = totalAcresWeighted > 0 ? Math.round(totalProd / totalAcresWeighted) : null;
    const production = totalProd > 0 ? Math.round(totalProd) : null;
    const growers = new Set(matching.map(p => p.customerId)).size;
    return { name: c.name, acres: c.acres, avgYield, production, growers, dotColor: c.dotColor };
  });
}

/** Distinct planting years, newest first. */
export function plantingYearsDescending(intentions: PlantingIntention[]): number[] {
  return [...new Set(intentions.map(p => p.plantingYear))].sort((a, b) => b - a);
}

/** Season Targets yield rows for one year's intentions, carrying the saved estimates. */
export function buildYieldRows(
  intentionsForYear: PlantingIntention[],
  commodityByCode: Map<string, Commodity>,
  yieldMap: Map<string, number | null>,
): YieldRow[] {
  // Group acres by combined type+category key (e.g. "Dryland Wheat", "Irrigated Corn")
  const cropAcresMap = new Map<string, number>();
  const cropCategoryMap = new Map<string, string>();
  for (const p of intentionsForYear) {
    const commodity = commodityByCode.get(p.crop);
    const category = plantingCategory(p, commodity);
    const cropKey = dashboardCropKey(p.type, category);
    cropAcresMap.set(cropKey, (cropAcresMap.get(cropKey) || 0) + p.acres);
    cropCategoryMap.set(cropKey, category);
  }

  // Use crop keys from planting intentions only
  const allCropCodes = new Set<string>(cropAcresMap.keys());

  return [...allCropCodes]
    .map(cropCode => ({
      cropCode,
      cropName: cropCode,
      category: cropCategoryMap.get(cropCode) || 'Unknown',
      totalAcres: cropAcresMap.get(cropCode) || 0,
      yieldEstimate: yieldMap.get(cropCode) ?? null
    }))
    // Group rows by commodity (all Corn variants together, then Soybeans, etc.), then by the
    // crop label within a commodity — instead of a flat alphabetical sort that splits e.g.
    // "Dryland Corn" and "Irrigated Corn" apart.
    .sort((a, b) => a.category.localeCompare(b.category) || a.cropName.localeCompare(b.cropName));
}

/** Season Targets category rows: production summed per category, with the saved market share applied. */
export function buildCategoryRows(yieldRows: YieldRow[], savedMarketShares: DashboardMarketShare[]): CategoryRow[] {
  // Group yield rows by category, sum production
  const categoryMap = new Map<string, number>();
  for (const row of yieldRows) {
    const production = (row.yieldEstimate != null && row.totalAcres > 0)
      ? row.totalAcres * row.yieldEstimate
      : 0;
    const current = categoryMap.get(row.category) || 0;
    categoryMap.set(row.category, current + production);
  }

  return [...categoryMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, totalEstimatedProduction]) => {
      const savedShare = savedMarketShares.find(s => s.cropCategory === category);
      const marketSharePct = savedShare?.marketSharePct ?? null;
      const estimatedHarvestHandle = (marketSharePct != null && totalEstimatedProduction > 0)
        ? totalEstimatedProduction * (marketSharePct / 100)
        : 0;
      return { category, totalEstimatedProduction, marketSharePct, estimatedHarvestHandle };
    });
}

/** Last season's recorded harvest for this trade-unit key, by crop category. */
export function buildActualHarvestRows(
  savedActualHarvest: DashboardActualHarvest[],
  tradeUnitKey: string,
  harvestYear: number,
): { id: number; cropCategory: string; bushels: number }[] {
  return [...savedActualHarvest]
    .filter(h => h.tradeUnitKey === tradeUnitKey && h.plantingYear === harvestYear)
    .sort((a, b) => a.cropCategory.localeCompare(b.cropCategory))
    .map(h => ({ id: h.id, cropCategory: h.cropCategory, bushels: h.bushels }));
}

/** Commodity categories that can still get a harvest row: not used yet, and not a non-crop category. */
export function availableHarvestCropCategories(commodities: Commodity[], usedHarvestCrops: Set<string>): string[] {
  const all = [...new Set(commodities.map(c => c.category).filter(Boolean) as string[])].sort();
  return all.filter(cat =>
    !usedHarvestCrops.has(cat) &&
    !HARVEST_EXCLUDED_CATEGORIES.includes(cat.toLowerCase())
  );
}

/** Actual harvest against estimated production per crop; null share when there is no estimate. */
export function buildActualMarketShareRows(
  actualHarvestRows: { cropCategory: string; bushels: number }[],
  categoryRows: { category: string; totalEstimatedProduction: number }[],
) {
  const allCrops = new Set<string>();
  for (const r of actualHarvestRows) allCrops.add(r.cropCategory);
  for (const r of categoryRows) allCrops.add(r.category);

  return [...allCrops].sort().map(crop => {
    const harvestRow = actualHarvestRows.find(r => r.cropCategory === crop);
    const prodRow = categoryRows.find(r => r.category === crop);
    const harvestBushels = harvestRow?.bushels ?? 0;
    const totalEstimatedProduction = prodRow?.totalEstimatedProduction ?? 0;
    const pct = totalEstimatedProduction > 0
      ? (harvestBushels / totalEstimatedProduction) * 100
      : null;
    return { cropCategory: crop, harvestBushels, totalEstimatedProduction, pct };
  });
}
