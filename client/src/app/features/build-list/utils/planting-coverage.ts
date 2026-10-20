/**
 * Build a List planting-coverage prompts — "planting with no contracts", "under N percent
 * contracted", "highest uncontracted bushels": planting intentions (acres x the season yield
 * target) against the contracts fetched for each planting year.
 *
 * The computation moved verbatim out of BuildListComponent._applyPlantingCoverageFilter; the page
 * still owns the fetches, the spinner and the banners.
 */
import { Commodity, CommodityConversion, Contract, Customer, DashboardPlantingEstimate, PlantingIntention } from '@models';
import { buildLbsPerBushelMap, findYieldEstimate, sumInBushels } from '@shared/utils/production-coverage';
import { plantingCategory, commodityPlantingCategory } from '@shared/utils/planting-category';

export interface PlantingCoverageInput {
  intentions: PlantingIntention[];
  customers: Customer[];
  /** Contracts per planting year (one batch per year fetched). */
  contractBatches: Contract[][];
  /** Season yield targets per planting year (one batch per year fetched). */
  estimateBatches: DashboardPlantingEstimate[][];
  commodities: Commodity[];
  commodityConversions: CommodityConversion[];
}

export interface PlantingCoverageResult {
  /** The matching producers, or null when `lq` is none of the three coverage phrasings. */
  customers: Customer[] | null;
  /** Planting rows the "under N percent" / "uncontracted" branches evaluated, and how many of them
   *  had a season yield target. All evaluated and none with a target means the empty result is
   *  "no targets saved", not "everyone is well contracted". */
  plantingRowsEvaluated: number;
  plantingRowsWithEstimate: number;
}

/** Evaluates a coverage prompt (`lq` is the lower-cased prompt text). */
export function evaluatePlantingCoverage(lq: string, input: PlantingCoverageInput): PlantingCoverageResult {
  const { intentions, contractBatches: results, estimateBatches } = input;
  // Merge all fetched contracts
  const allContracts: Contract[] = [];
  for (const batch of results) allContracts.push(...batch);

  // Every year's estimates in one list; findYieldEstimate scopes by year internally.
  const allEstimates: DashboardPlantingEstimate[] = [];
  for (const batch of estimateBatches) allEstimates.push(...batch);

  // Commodity CODE → planting category, the key season targets are actually stored under
  // ("Corn" / "Dryland Corn" / "Organic Soybeans"), never the code. Looking up by code returned
  // undefined every time, which made both coverage prompts below return an empty list no matter
  // the data. Resolved through the same planting-category rule as the dashboard, so an organic
  // planting row finds its own season target and is covered by organic contracts only.
  const codeToCategory = new Map<string, string>();
  const commodityByCode = new Map<string, Commodity>();
  for (const cm of input.commodities) {
    if (!cm.code) continue;
    commodityByCode.set(cm.code.trim().toUpperCase(), cm);
    const label = commodityPlantingCategory(cm);
    if (label) codeToCategory.set(cm.code.trim().toUpperCase(), label);
  }

  // Index contracts by customer + year + commodity
  const contractsByCustomer = new Map<string, Contract[]>();
  for (const c of allContracts) {
    if (!c.ctrmCustomerId) continue;
    const arr = contractsByCustomer.get(c.ctrmCustomerId);
    if (arr) arr.push(c); else contractsByCustomer.set(c.ctrmCustomerId, [c]);
  }

  // Group planting by customer. `crop` stays the CODE (contract matching uses it); `category`
  // and `type` are carried alongside because that pair is what a season target is keyed by.
  const plantingByCustomer = new Map<number, { year: number; crop: string; category: string; type?: string; acres: number }[]>();
  for (const p of intentions) {
    const crop = (p.crop || '').trim().toUpperCase();
    if (!crop || !p.plantingYear) continue;
    const arr = plantingByCustomer.get(p.customerId);
    const entry = {
      year: p.plantingYear,
      crop,
      category: plantingCategory(p, commodityByCode.get(crop)),
      type: p.type,
      acres: p.acres,
    };
    if (arr) arr.push(entry); else plantingByCustomer.set(p.customerId, [entry]);
  }

  const allCustomers = input.customers;

  // Same conversion table the producer page uses, so contracted bushels agree across screens.
  const lbsPerBushelByCode = buildLbsPerBushelMap(input.commodityConversions);

  /**
   * Does this contract cover the planting crop? Matched on the resolved commodity CATEGORY, the
   * same join the producer page's Growth Opportunity panel uses.
   *
   * It used to match on substrings in either direction, which quietly pulled in different
   * products: planting crop "YC" matched commodity code "CKYC" (cracked corn) and "SOR" matched
   * "CSOR", because one string contains the other.
   */
  const contractMatchesCrop = (ct: Contract, cropCategory: string): boolean => {
    const target = cropCategory.trim().toUpperCase();
    if (!target) return false;
    const code = (ct.commodityCode || '').trim().toUpperCase();
    // Exact code match covers the case where the planting crop isn't in dbo.Commodities either,
    // so its "category" fell back to the raw code — otherwise that producer would match nothing.
    if (code && code === target) return true;
    const category = (codeToCategory.get(code) || ct.commodityGroup || ct.commodityDescription || code || '')
      .trim().toUpperCase();
    return category === target;
  };

  // Tracks whether the "under X% contracted" / "uncontracted" branches below could find a
  // saved season yield target for ANY planting row they evaluated. Coverage can't be computed
  // without one (estimatedProduction = acres × yield), so if every row lacks a target the
  // result is an empty list that looks IDENTICAL to "everyone is well-contracted" — this
  // distinguishes the two so the UI can point at the real cause instead of "No Producers Found".
  let plantingRowsEvaluated = 0;
  let plantingRowsWithEstimate = 0;
  // Null when the prompt matched none of the three phrasings — the page then leaves its results as they were.
  let matched: Customer[] | null = null;

  if (lq.includes('planting') && (lq.includes('no contract') || lq.includes('no active contract'))) {
    // 0% coverage: any planting crop+year with zero matching contracts
    matched = allCustomers.filter(c => {
      const plantings = plantingByCustomer.get(c.id);
      if (!plantings) return false;
      const custContracts = contractsByCustomer.get(c.scoularId!) || [];
      return plantings.some(p =>
        !custContracts.some(ct => ct.cropYear === p.year && contractMatchesCrop(ct, p.category))
      );
    });
  } else if (lq.includes('under') && lq.includes('percent contracted')) {
    // Under X% coverage: planting bushels vs contracted bushels per crop+year
    const pctMatch = lq.match(/under\s+(\d+)\s*percent/);
    const threshold = pctMatch ? parseInt(pctMatch[1]) / 100 : 0.5;

    matched = allCustomers.filter(c => {
      const plantings = plantingByCustomer.get(c.id);
      if (!plantings) return false;
      const custContracts = contractsByCustomer.get(c.scoularId!) || [];
      // Check each planting crop: estimated production vs contracted bushels
      return plantings.some(p => {
        // Same rule as the producer page: the estimate must belong to THIS crop and THIS year.
        plantingRowsEvaluated++;
        const yieldEst = findYieldEstimate(allEstimates, p.type, p.category, p.year);
        if (!yieldEst) return false; // can't calculate without a season target
        plantingRowsWithEstimate++;
        const estimatedProduction = p.acres * yieldEst;
        // Bushels, not raw quantity: contracts for meal / oil / popcorn sit in the same
        // commodity group but are priced by weight, and adding them in would overstate coverage
        // and drop this producer off the very list that should surface them.
        const { contracted: contractedBu } = sumInBushels(
          custContracts.filter(ct => ct.cropYear === p.year && contractMatchesCrop(ct, p.category)),
          lbsPerBushelByCode);
        const coverage = estimatedProduction > 0 ? contractedBu / estimatedProduction : 0;
        return coverage < threshold;
      });
    });
  } else if (lq.includes('uncontracted')) {
    // Highest uncontracted bushels — top 10 by gap
    const customerGaps: { customer: Customer; gap: number }[] = [];
    for (const c of allCustomers) {
      const plantings = plantingByCustomer.get(c.id);
      if (!plantings) continue;
      const custContracts = contractsByCustomer.get(c.scoularId!) || [];
      let totalGap = 0;
      for (const p of plantings) {
        plantingRowsEvaluated++;
        const yieldEst = findYieldEstimate(allEstimates, p.type, p.category, p.year);
        if (!yieldEst) continue;
        plantingRowsWithEstimate++;
        const estimatedProduction = p.acres * yieldEst;
        const { contracted: contractedBu } = sumInBushels(
          custContracts.filter(ct => ct.cropYear === p.year && contractMatchesCrop(ct, p.category)),
          lbsPerBushelByCode);
        totalGap += Math.max(0, estimatedProduction - contractedBu);
      }
      if (totalGap > 0) customerGaps.push({ customer: c, gap: totalGap });
    }
    customerGaps.sort((a, b) => b.gap - a.gap);
    matched = customerGaps.slice(0, 10).map(g => g.customer);
  }

  return { customers: matched, plantingRowsEvaluated, plantingRowsWithEstimate };
}
