export interface Commodity {
  id: number;
  code: string;
  name: string;
  category?: string;
  tier1?: string;
  tier2?: string;
  tier3?: string;
  baseUOM?: string;
  isActive: boolean;
  /** True when this row is in the curated crop list served by GET /api/commodities/planting. */
  showInPlantingIntentions?: boolean;
  /**
   * Null/absent (the default, and every row bar the organics) means every user sees this
   * commodity. A value restricts it to users whose current trade-unit selection includes a
   * matching trade group — see scopeCommodities() in shared/utils/commodity-scope.ts.
   */
  tradeGroupScope?: string | null;
  /**
   * Comma-separated trade unit codes this commodity is restricted to (e.g. "2090,2291,2295"), or
   * null/absent for no unit restriction. Matched by EXACT membership, never substring — "209" must
   * not match 2090. OR-combined with tradeGroupScope.
   */
  tradeUnitScope?: string | null;
}
