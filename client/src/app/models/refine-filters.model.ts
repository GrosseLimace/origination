export interface RefinementFilters {
  noActiveContracts?: boolean;
  hasUnsignedContracts?: boolean;
  hasNegativePacing?: boolean;
  notContactedDays?: number | null;   // Days threshold; null/undefined = filter inactive
  neverContacted?: boolean;
  crops?: string[];                   // Filter to customers planting any of these crops
  states?: string[];                  // Filter to customers in any of these states
}
