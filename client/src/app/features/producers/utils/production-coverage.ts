import { Commodity, CommodityConversion, Contract, DashboardPlantingEstimate, HarvestWindow, PlantingIntention } from '@models';
import { commodityPlantingCategory, plantingCategory } from './planting-category';

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

/** Fallback when a contract carries no unit. 85% of contracts are bushels, and the rows that carry
 *  no unit also carry no commodity group, so they can't match a planting category anyway. */
const DEFAULT_UNIT = 'BU';

/**
 * Every spelling that means bushels. ODS `QuantityUom` holds the two-letter code `BU`, but the
 * column is 16 chars and the Contract model's own comment says 'Usually "bushels"' — so accept the
 * long forms too. Getting this wrong is the expensive direction: an unrecognised bushel spelling
 * would be treated as a unit we can't convert and its volume would drop out of the total.
 */
const BUSHEL_UNITS = new Set(['BU', 'BUS', 'BSH', 'BUSHEL', 'BUSHELS']);

/**
 * Pounds in one of each MASS unit contracts are written in, so a tonnage contract can be expressed
 * in bushels: bushels = quantity × lbsPerUnit ÷ lbsPerBushel.
 *
 * Only mass units are here, deliberately. GL (gallons), EA (each) and RC have no bushel equivalent —
 * they appear exclusively on Feed & Fert Ingredients, Currency and Transportation contracts, which
 * can never match a planting-intention crop, so within this calculation they don't arise.
 */
const LBS_PER_MASS_UNIT: Record<string, number> = {
  LB: 1,
  CW: 100,          // hundredweight
  ST: 2000,         // short ton
  MT: 2204.6226,    // metric tonne
  KG: 2.2046226,
};

/**
 * Plausible range for a lb-per-bushel factor, and the load-bearing guard in this file.
 *
 * GNP024's `Pounds_To_Commodity_Unit` is pounds per the commodity's OWN standard unit, not per
 * bushel — verified against its `Commodity_Std_Unit_Measure` column. Bushel commodities carry a real
 * lb/bu figure (canola 50, millet 50, corn 56, sorghum 56, wheat 60, soybeans 60), but a ton-based
 * commodity carries 2000, a tonne 2204.62, a pound 1.
 *
 * That matters because the non-bushel contracts sitting inside grain commodity GROUPS are not grain:
 * they're soybean meal (480M, SBMO, SBMB), soybean oil (BOIL), popcorn by the pound (POP), cracked
 * corn (CKYC). Converting one of those with its own factor would pass the quantity through unchanged
 * and count 318 tons of MEAL as 318 bushels of soybeans. Rejecting factors outside this band is what
 * stops that — everything real falls outside it, so those contracts are excluded and reported.
 */
const MIN_LBS_PER_BUSHEL = 25;
const MAX_LBS_PER_BUSHEL = 80;

export interface CommodityCoverage {
  /** Broad category ("Corn", "Wheat"), resolved from the Commodities lookup. */
  commodity: string;
  /** Total contracted volume in {@link unit}, with tonnage/pound contracts converted to bushels. */
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
  /** The unit `contracted` is expressed in — "bu" once mass units have been converted. */
  unit: string;
  /** Contracts left OUT of `contracted` because their unit has no bushel equivalent, or because no
   *  trustworthy lb-per-bushel factor was available. Zero in normal operation; when non-zero the
   *  caller must say so rather than presenting the figure as complete. */
  excludedContracts: number;
}

export interface ProductionCoverage {
  contractYear: number;
  totalContracted: number;
  totalProjectedYield: number;
  /** Total contracted ÷ total projected, as a percentage. Null only when there is nothing projected. */
  marketSharePercentage: number | null;
  bushelsAvailable: number;
  /** The unit the totals are expressed in — always "bu", since everything comparable is converted. */
  totalUnit: string;
  /** Contracts excluded across all commodities because they couldn't be expressed in bushels. */
  excludedContracts: number;
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
  /** lb-per-bushel factors from ctrm.vw_GNP024, keyed by commodity code — used to express tonnage
   *  and pound contracts in bushels. Omit and non-bushel contracts are excluded instead. */
  conversions?: CommodityConversion[];
}

/**
 * lb-per-bushel by commodity code, from the GNP024 rows. Every screen that totals contracted volume
 * should build this once and pass it to {@link sumInBushels}, so they all agree.
 */
export function buildLbsPerBushelMap(conversions: readonly CommodityConversion[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const conv of conversions ?? []) {
    if (conv.commodityCode) map.set(conv.commodityCode.trim().toUpperCase(), conv.lbsPerUnit);
  }
  return map;
}

export function buildProductionCoverage(input: ProductionCoverageInput): ProductionCoverage {
  const { intentions, contracts, commodities, yieldEstimates, harvestWindows, year } = input;

  const intentionsForYear = year > 0
    ? intentions.filter(pi => pi.plantingYear === year)
    : intentions;

  // Commodity code → planting category ("HRWW" → "WHEAT", "YC" → "CORN", "YSBO" → "ORGANIC SOYBEANS").
  // This is the join between the two sides: a planting intention stores a commodity CODE, and
  // contracts carry one too, so resolving both through the same map compares like with like — an
  // organic contract only covers organic acres. Harvest windows, though, are keyed by the broad
  // crop ("SOYBEANS"), so the base category is kept alongside for that lookup.
  const codeToCategory = new Map<string, string>();
  const commodityByCode = new Map<string, Commodity>();
  for (const c of commodities) {
    if (!c.code) continue;
    commodityByCode.set(c.code.toUpperCase(), c);
    const label = commodityPlantingCategory(c);
    if (label) codeToCategory.set(c.code.toUpperCase(), label.toUpperCase());
  }
  const harvestWindowFor = (category: string, baseCategory: string): HarvestWindow | undefined => {
    const byLabel = harvestWindows.find(w => w.commodity.toUpperCase() === category.toUpperCase());
    return byLabel ?? harvestWindows.find(w => w.commodity.toUpperCase() === baseCategory.toUpperCase());
  };

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
  const contractMatchesSeason = (c: Contract, category: string, baseCategory: string): boolean => {
    if (getContractCategory(c) !== category.toUpperCase()) return false;
    if (year === 0) return true;
    if (c.cropYear) return c.cropYear === year;

    if (!c.deliveryEnd && !c.deliveryStart) return false;
    const hw = harvestWindowFor(category, baseCategory);
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
  const cropMap = new Map<string, { category: string; baseCategory: string; projectedYield: number | null }>();

  for (const pi of intentionsForYear) {
    const commodity = commodityByCode.get((pi.crop || '').toUpperCase());
    const category = plantingCategory(pi, commodity);
    const baseCategory = commodity?.category || category;
    const yieldEstimate = findYieldEstimate(yieldEstimates, pi.type, category, year);

    if (!cropMap.has(category)) cropMap.set(category, { category, baseCategory, projectedYield: null });
    const entry = cropMap.get(category)!;
    if (yieldEstimate != null) {
      entry.projectedYield = (entry.projectedYield ?? 0) + pi.acres * yieldEstimate;
    }
  }

  // lb-per-bushel by commodity code, so tonnage contracts can be expressed in bushels.
  const lbsPerBushelByCode = buildLbsPerBushelMap(input.conversions);

  const byCommodity: CommodityCoverage[] = Array.from(cropMap.values()).map(entry => {
    const matching = contracts.filter(c => contractMatchesSeason(c, entry.category, entry.baseCategory));
    const { contracted, unit, excludedContracts } = sumInBushels(matching, lbsPerBushelByCode);
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
      excludedContracts,
    };
  });

  // Everything comparable is now in bushels, so the totals are a real sum.
  const totalContracted = byCommodity.reduce((s, c) => s + c.contracted, 0);
  const totalProjectedYield = byCommodity.reduce((s, c) => s + (c.projectedYield ?? 0), 0);

  return {
    contractYear: year,
    totalContracted,
    totalProjectedYield,
    marketSharePercentage: totalProjectedYield > 0
      ? (totalContracted / totalProjectedYield) * 100
      : null,
    bushelsAvailable: Math.max(0, totalProjectedYield - totalContracted),
    totalUnit: 'bu',
    excludedContracts: byCommodity.reduce((s, c) => s + c.excludedContracts, 0),
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
 * Totals a commodity's contracts IN BUSHELS, converting the mass units some grain is contracted in.
 *
 * Contracts are stored in their native QuantityUom and nothing else in the app normalizes them, so a
 * naive sum used to add short tons into a figure labelled "bu".
 *
 * On today's data no conversion actually occurs: every non-bushel contract inside a grain commodity
 * group is a processed product (meal, oil, popcorn) whose factor fails the plausibility guard, so it
 * is excluded. The conversion is kept for the legitimate case — a genuinely bushel-denominated crop
 * contracted by weight, e.g. soybeans at 60 lb/bu sold in short tons — which the guard would accept.
 *
 * A contract is excluded (and counted) rather than approximated when its unit isn't mass-based or no
 * trustworthy lb-per-bushel factor exists — silently dropping volume is bad, but inventing it is worse.
 */
export function sumInBushels(
  contracts: Contract[],
  lbsPerBushelByCode: Map<string, number>,
): { contracted: number; unit: string; excludedContracts: number } {
  let contracted = 0;
  let excludedContracts = 0;

  for (const c of contracts) {
    const bushels = quantityInBushels(c, c.quantity || 0, lbsPerBushelByCode);
    if (bushels == null) excludedContracts++;
    else contracted += bushels;
  }

  return { contracted, unit: 'bu', excludedContracts };
}

/**
 * Expresses ONE quantity, denominated in `contract.unit`, in bushels. Returns null when it can't be —
 * an inconvertible unit, or no trustworthy lb-per-bushel factor for the commodity.
 *
 * Takes the quantity separately from the contract so callers can convert something other than the
 * contract's face value — the unshipped balance, for instance, which is in the same unit.
 */
export function quantityInBushels(
  contract: Contract,
  quantity: number,
  lbsPerBushelByCode: Map<string, number>,
): number | null {
  const unit = (contract.unit || DEFAULT_UNIT).trim().toUpperCase() || DEFAULT_UNIT;
  if (BUSHEL_UNITS.has(unit)) return quantity;

  const lbsPerUnit = LBS_PER_MASS_UNIT[unit];
  const lbsPerBushel = lbsPerBushelByCode.get((contract.commodityCode || '').trim().toUpperCase());
  const usableFactor = lbsPerBushel != null
    && lbsPerBushel >= MIN_LBS_PER_BUSHEL
    && lbsPerBushel <= MAX_LBS_PER_BUSHEL;

  if (lbsPerUnit == null || !usableFactor) return null;
  return (quantity * lbsPerUnit) / lbsPerBushel!;
}
