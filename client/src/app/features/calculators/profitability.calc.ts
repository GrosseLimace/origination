import { ProfitabilityInputs, ProfitabilityResult } from './models/calculator.model';

/**
 * Pure farm-profitability computation. Mirrors the reference prototype exactly:
 * per-acre variable costs (incl. harvesting) plus freight converted from $/bushel to
 * $/acre via yield; repairs are a fixed $ total. No Angular deps — unit-tested directly.
 */
export function computeProfitability(i: ProfitabilityInputs): ProfitabilityResult {
  const acres = i.totalAcres || 0;
  const yieldPerAcre = i.yieldPerAcre || 0;
  const price = i.pricePerBushel || 0;

  const perAcreVariableCosts =
    (i.fertilizer || 0) + (i.pesticides || 0) + (i.seed || 0) + (i.drying || 0) +
    (i.storage || 0) + (i.cropInsurance || 0) + (i.rent || 0) + (i.harvesting || 0);

  // Freight is entered per bushel; convert to per-acre using yield.
  const freightPerAcre = (i.freightPerBushel || 0) * yieldPerAcre;
  const variableCostPerAcre = perAcreVariableCosts + freightPerAcre;

  const totalRevenue = acres * yieldPerAcre * price;
  const totalVariableCost = acres * variableCostPerAcre;
  const totalFixedCost = i.repairs || 0;
  const totalCost = totalVariableCost + totalFixedCost;
  const profit = totalRevenue - totalCost;

  const totalBushels = acres * yieldPerAcre;

  return {
    totalRevenue,
    totalVariableCost,
    totalFixedCost,
    totalCost,
    costPerAcre: acres ? totalCost / acres : 0,
    breakevenPerBushel: totalBushels ? totalCost / totalBushels : 0,
    profit,
    revenuePerAcre: acres ? totalRevenue / acres : 0,
    variableCostPerAcre,
    fixedCostPerAcre: acres ? totalFixedCost / acres : 0,
    profitPerAcre: acres ? profit / acres : 0,
  };
}
