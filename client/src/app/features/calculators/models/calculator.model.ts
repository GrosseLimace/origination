// Types for the originator calculators feature. v1 ships the Profitability calculator;
// the CalculatorType union + CALCULATOR_TYPES registry are the single extension point for
// future calculators (contract cancellation, checks, …).

export type CalculatorType = 'profitability' | 'check' | 'cancelRoll';

export interface CalculatorTypeInfo {
  type: CalculatorType;
  label: string;
  description: string;
}

/** Calculators offered in the launcher's type picker. Add an entry here (and a `@switch`
 *  case in the widget) to introduce a new calculator. */
export const CALCULATOR_TYPES: readonly CalculatorTypeInfo[] = [
  { type: 'profitability', label: 'Profitability', description: 'Farm profitability by crop' },
  { type: 'check', label: 'Check', description: 'Producer settlement check' },
  { type: 'cancelRoll', label: 'Cancel vs. Roll', description: 'Contract cancel vs. roll analysis' },
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

// ── Check (settlement) calculator ──────────────────────────────────────────

/** How the check-off value was entered. Both modes charge a share of gross value (Total Before
 *  Fees); the mode only sets the entry convention: 'percent' divides the typed number by 100,
 *  'perBushel' uses the decimal directly. */
export type CheckOffMode = 'percent' | 'perBushel';

/** Raw inputs for one commodity's settlement-check calculation (from the Check Calculator sheet). */
export interface CheckInputs {
  commodity: string;          // free-text label / grade code (e.g. HRWW, YC)
  bushels: number;
  basis: number;              // $/bushel (usually negative)
  futurePrice: number;        // $/bushel
  checkOffMode: CheckOffMode;
  checkOffValue: number;      // fraction of gross value (e.g. 0.02 = 2%); always applied to Total Before Fees
  avgDeliveryDate: string;    // ISO yyyy-MM-dd (blank = no DP days)
  settlementDate: string;     // ISO yyyy-MM-dd ("today's date")
  freightPerBushel: number;   // $/bushel (blank → 0)
  dailyDpFee: number;         // $/bushel/day delayed-price fee (sheet: =0.06/30 = 0.002)
}

/** Derived settlement figures. Deductions are negative; total = gross + deductions. */
export interface CheckResult {
  cashPrice: number;          // futures + basis
  totalBeforeFees: number;    // bushels × cash price
  daysSinceDelivery: number;  // settlement date − average delivery date (whole days, ≥ 0)
  dailyDpFee: number;         // dpMonthlyRate / 30 ($/bushel/day)
  totalCheckOff: number;      // negative
  totalDpFees: number;        // negative
  totalFreight: number;       // negative
  total: number;              // net check payable
}

/** Default daily delayed-price fee from the sheet: 0.06 / 30 = $0.002 per bushel per day. */
export const DEFAULT_DAILY_DP_FEE = 0.002;

// ── Cancel-Roll calculator ─────────────────────────────────────────────────

/** Raw inputs for the cancel-vs-roll decision (from the "Cancel-Roll Math" sheet). "Cash price
 *  today" is a single shared input feeding both options (the sheet had two equal manual entries;
 *  we merge them per the spec's recommendation). */
export interface CancelRollInputs {
  cashPriceToday: number;      // $/bu — shared by both options
  // Option 1 — Contract Cancelation
  contractAvgPrice: number;    // $/bu — original contracted price
  cancelFee: number;           // $/bu — cancellation fee
  bushels: number;
  // Option 2 — Roll / hold futures
  cashPriceNextYear: number;   // $/bu
  hedgeCost: number;           // $/bu — cost to service the hedge (~$0.01/bu/month)
  contractCashPrice: number;   // $/bu
}

/** Derived cancel-vs-roll figures. Cost to Roll may be negative (a net benefit). */
export interface CancelRollResult {
  costToCancel: number;          // $/bu  = today − contract avg + fee
  buyOut: number;                // $ total (headline, Option 1) = costToCancel × bushels
  costToRoll: number;            // $/bu  = today − next year + hedge (negative = benefit)
  newCashPriceNextYear: number;  // $/bu  (headline, Option 2) = contract cash price − costToRoll
}
