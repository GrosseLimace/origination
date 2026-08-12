import { Commodity, Contract, DashboardPlantingEstimate, HarvestWindow, PlantingIntention } from '@models';

/**
 * Projected production vs. bushels contracted, per commodity, for one producer and one season.
 *
 * Projected production is planting acres × a yield estimate. The yield is NOT per producer — it's
 * entered per (trade unit, crop, planting year) on the dashboard's "Set Season Targets" dialog, so
 * every producer in a trade unit growing the same crop shares one bu/ac figure. (A per-intention
 * EstimatedYield column existed once and was deliberately dropped.) That is the accuracy ceiling of
 * this number, and it's why a missing estimate must read as "unknown" rather than zero.
 *
 * Extracted from CustomerProfileComponent so the arithmetic is testable on its own and so the other
 * places that recompute it (print report, Build-A-List) can converge on one implementation — they
 * currently use divergent yield lookups and can disagree about the same producer.
 */

/** Fallback when a contract carries no unit. The overwhelming majority of contracts are bushels. */
const DEFAULT_UNIT = 'bu';

export interface CommodityCoverage {
  /** Broad category ("Corn", "Wheat"), resolved from the Commodities lookup. */
  commodity: string;
  /** Total contracted volume in {@link unit}. */
  contracted: number;
  /** Acres × yield estimate. NULL when no yield estimate matched — NOT zero: "we don't know" and
   *  "they've sold none of it" are opposite conclusions and must not render identically. */
  projectedYield: number | null;
  /** contracted / projectedYield × 100. Null when projectedYield is unknown. Not clamped — a
   *  producer really can be contracted over 100% of an estimate, and the caller decides how to show
   *  that (the bar clamps its width; the number stays honest). */
  percentage: number | null;
  /** Bushels still available to contract. Null when projectedYield is unknown; never negative. */
  available: number | null;
  /** The unit these contracts are actually denominated in — bu, CWT, tons, lbs. */
  unit: string;
  /** True when this commodity's contracts span more than one unit, so `contracted` covers only the
   *  dominant one. The caller must surface this rather than presenting a single total. */
  hasMixedUnits: boolean;
}

export interface ProductionCoverage {
  contractYear: number;
  totalContracted: number;
  totalProjectedYield: number;
  /** Total contracted ÷ total projected, as a percentage. Meaningless when units differ, so it is
   *  null in that case (see {@link hasMixedUnits}). */
  marketSharePercentage: number | null;
  bushelsAvailable: number;
  /** The single unit shared by every commodity, or null when they differ. */
  totalUnit: string | null;
  /** True when the commodities don't share one unit — totals can't legitimately be added. */
  hasMixedUnits: boolean;
  byCommodity: CommodityCoverage[];
}

export interface ProductionCoverageInput {
  intentions: PlantingIntention[];
  contracts: Contract[];
  commodities: Commodity[];
  yieldEstimates: DashboardPlantingEstimate[];
  harvestWindows: HarvestWindow[];
  /** Planting year to scope to. 0 means "all years". */
  year: number;
}

export function buildProductionCoverage(input: ProductionCoverageInput): ProductionCoverage {
  const { intentions, contracts, commodities, yieldEstimates, harvestWindows, year } = input;

  const intentionsForYear = year > 0
    ? intentions.filter(pi => pi.plantingYear === year)
    : intentions;

  // Commodity code → broad category ("HRWW" → "WHEAT", "YC" → "CORN"). This is the join between the
  // two sides: a planting intention stores a commodity CODE, and Commodities.Category is seeded
  // directly from Contract.CommodityGroup, so resolving both through this map compares like with like.
  const codeToCategory = new Map<string, string>();
  for (const c of commodities) {
    if (c.code && c.category) codeToCategory.set(c.code.toUpperCase(), c.category.toUpperCase());
  }

  const getContractCategory = (c: Contract): string => {
    const code = (c.commodityCode || '').toUpperCase();
    if (codeToCategory.has(code)) return codeToCategory.get(code)!;
    // Fallback for a commodity missing from the hand-curated lookup: match the description against
    // a known harvest-window commodity.
    const desc = (c.commodityDescription || '').toUpperCase();
    for (const hw of harvestWindows) {
      const hwName = hw.commodity.toUpperCase();
      if (desc.includes(hwName) || code.includes(hwName)) return hwName;
    }
    return desc || code;
  };

  /**
   * Does this contract belong to `year`'s crop?
   *
   * CropYear comes from CTRM and is the source system's own statement of the season, so it wins.
   * Harvest-window delivery-date overlap is only a fallback for contracts with no CropYear. It used
   * to be the primary rule, which let a contract whose delivery window straddled a year boundary be
   * counted in TWO seasons, and made this screen disagree with the dashboard and Build-A-List.
   */
  const contractMatchesSeason = (c: Contract, category: string): boolean => {
    if (getContractCategory(c) !== category.toUpperCase()) return false;
    if (year === 0) return true;
    if (c.cropYear) return c.cropYear === year;

    if (!c.deliveryEnd && !c.deliveryStart) return false;
    const hw = harvestWindows.find(w => w.commodity.toUpperCase() === category.toUpperCase());
    if (!hw) return false;
    const windowStart = new Date(year, hw.deliveryStartMonth - 1, hw.deliveryStartDay);
    const windowEnd = new Date(year, hw.deliveryEndMonth - 1, hw.deliveryEndDay);
    windowEnd.setHours(23, 59, 59);
    const delStart = c.deliveryStart ? new Date(c.deliveryStart) : new Date(c.deliveryEnd);
    const delEnd = c.deliveryEnd ? new Date(c.deliveryEnd) : new Date(c.deliveryStart);
    return delStart <= windowEnd && delEnd >= windowStart;
  };

  // Projected production per category. `null` acres-times-nothing stays null so the distinction
  // between "no estimate" and "zero" survives all the way to the template.
  const cropMap = new Map<string, { category: string; projectedYield: number | null }>();

  for (const pi of intentionsForYear) {
    const commodity = commodities.find(c => c.code === pi.crop);
    const category = commodity?.category || pi.crop;
    const yieldEstimate = findYieldEstimate(yieldEstimates, pi.type, category, year);

    if (!cropMap.has(category)) cropMap.set(category, { category, projectedYield: null });
    const entry = cropMap.get(category)!;
    if (yieldEstimate != null) {
      entry.projectedYield = (entry.projectedYield ?? 0) + pi.acres * yieldEstimate;
    }
  }

  const byCommodity: CommodityCoverage[] = Array.from(cropMap.values()).map(entry => {
    const matching = contracts.filter(c => contractMatchesSeason(c, entry.category));
    const { contracted, unit, hasMixedUnits } = sumByUnit(matching);
    const projectedYield = entry.projectedYield;

    return {
      commodity: entry.category,
      contracted,
      projectedYield,
      percentage: projectedYield != null && projectedYield > 0
        ? (contracted / projectedYield) * 100
        : null,
      available: projectedYield != null ? Math.max(0, projectedYield - contracted) : null,
      unit,
      hasMixedUnits,
    };
  });

  // Totals are only meaningful when every commodity is denominated the same way. Bushels of corn
  // plus hundredweight of canola is not a number.
  const units = new Set(byCommodity.map(c => c.unit));
  const hasMixedUnits = units.size > 1 || byCommodity.some(c => c.hasMixedUnits);
  const totalContracted = byCommodity.reduce((s, c) => s + c.contracted, 0);
  const totalProjectedYield = byCommodity.reduce((s, c) => s + (c.projectedYield ?? 0), 0);

  return {
    contractYear: year,
    totalContracted,
    totalProjectedYield,
    marketSharePercentage: !hasMixedUnits && totalProjectedYield > 0
      ? (totalContracted / totalProjectedYield) * 100
      : null,
    bushelsAvailable: Math.max(0, totalProjectedYield - totalContracted),
    totalUnit: units.size === 1 ? [...units][0] : null,
    hasMixedUnits,
    byCommodity,
  };
}

/**
 * Yield estimate for one intention: the type-prefixed crop key ("Dryland Corn") for the requested
 * season, falling back to the bare category ("Corn") for that SAME season. Returns null — not 0 —
 * when nothing matches.
 *
 * It deliberately does NOT fall back to another year. Yields are set per season, so borrowing last
 * year's number silently produces a projection nobody entered and hides the fact that this season's
 * target is missing — a new crop year would quietly inherit the prior year's bu/ac and look complete.
 * No estimate for the season means no projection, and the UI says so.
 *
 * The one exception is year 0 ("all years"), where there is no season to match on.
 */
export function findYieldEstimate(
  estimates: DashboardPlantingEstimate[],
  type: string | undefined,
  category: string,
  year: number,
): number | null {
  const cropKey = [type, category].filter(Boolean).join(' ');
  const forSeason = year > 0
    ? estimates.filter(ye => ye.plantingYear === year)
    : estimates;

  const match = forSeason.find(ye => ye.crop === cropKey)
    || (cropKey !== category ? forSeason.find(ye => ye.crop === category) : undefined);
  return match?.yieldEstimate ?? null;
}

/**
 * Totals a commodity's contracts WITHOUT adding across units. Contracts are stored in their native
 * QuantityUom (bu / CWT / tons / lbs) and nothing in the app normalizes them, so a naive sum quietly
 * mixes them and the UI then labels the result "bu". Where units differ, the largest group wins and
 * the caller is told, rather than producing a confidently wrong total.
 */
function sumByUnit(contracts: Contract[]): { contracted: number; unit: string; hasMixedUnits: boolean } {
  if (contracts.length === 0) return { contracted: 0, unit: DEFAULT_UNIT, hasMixedUnits: false };

  const totals = new Map<string, number>();
  for (const c of contracts) {
    const unit = (c.unit || DEFAULT_UNIT).trim() || DEFAULT_UNIT;
    totals.set(unit, (totals.get(unit) ?? 0) + (c.quantity || 0));
  }

  // Largest group wins; first-seen breaks ties.
  let unit = DEFAULT_UNIT;
  let contracted = 0;
  let first = true;
  for (const [u, total] of totals) {
    if (first || total > contracted) {
      unit = u;
      contracted = total;
      first = false;
    }
  }
  return { contracted, unit, hasMixedUnits: totals.size > 1 };
}
