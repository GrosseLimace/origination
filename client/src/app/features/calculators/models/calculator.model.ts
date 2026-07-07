// Types for the originator calculators feature. v1 ships the Profitability calculator;
// the CalculatorType union + CALCULATOR_TYPES registry are the single extension point for
// future calculators (contract cancellation, checks, …).

export type CalculatorType = 'profitability';

export interface CalculatorTypeInfo {
  type: CalculatorType;
  label: string;
  description: string;
}

/** Calculators offered in the launcher's type picker. Add an entry here (and a `@switch`
 *  case in the widget) to introduce a new calculator. */
export const CALCULATOR_TYPES: readonly CalculatorTypeInfo[] = [
  { type: 'profitability', label: 'Profitability', description: 'Farm profitability by crop' },
];

export type GrainCommodity = 'corn' | 'soybeans' | 'wheat' | 'barley' | 'sorghum' | 'canola';

export const GRAIN_COMMODITIES: readonly { value: GrainCommodity; label: string }[] = [
  { value: 'corn', label: 'Corn' },
  { value: 'soybeans', label: 'Soybeans' },
  { value: 'wheat', label: 'Wheat' },
  { value: 'barley', label: 'Barley' },
  { value: 'sorghum', label: 'Sorghum' },
  { value: 'canola', label: 'Canola' },
];

/** Raw numeric inputs for one crop's profitability calculation. */
export interface ProfitabilityInputs {
  farmName: string;
  commodity: GrainCommodity;
  totalAcres: number;
  yieldPerAcre: number;       // bushels/acre
  pricePerBushel: number;     // $/bushel
  // per-acre variable costs ($/acre)
  fertilizer: number;
  pesticides: number;
  seed: number;
  drying: number;
  storage: number;
  cropInsurance: number;
  rent: number;
  harvesting: number;
  // per-bushel
  freightPerBushel: number;   // $/bushel
  // fixed cost ($ total, not per-acre)
  repairs: number;
}

/** Derived profitability figures. Totals + per-acre views + breakeven. */
export interface ProfitabilityResult {
  totalRevenue: number;
  totalVariableCost: number;
  totalFixedCost: number;
  totalCost: number;
  costPerAcre: number;
  breakevenPerBushel: number;
  profit: number;
  revenuePerAcre: number;
  variableCostPerAcre: number;
  fixedCostPerAcre: number;
  profitPerAcre: number;
}
