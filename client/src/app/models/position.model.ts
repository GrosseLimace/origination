/**
 * Represents a grain position with purchase, hedge, and pricing data.
 * Used for tracking cash grain positions and basis analysis.
 */
export interface PositionData {
  /** Grain type (e.g., Corn, Soybeans, Wheat) */
  commodity: string;
  /** Delivery period (e.g., Dec 2024, Jan-Feb 2025) */
  deliveryWindow: string;
  /** Physical location of the grain */
  location: string;
  /** Current cash bid price per bushel */
  cashBid: number;
  /** Current futures contract price per bushel */
  futuresPrice: number;
  /** Difference between cash and futures price */
  basis: number;
  /** Total bushels purchased */
  purchasedBushels: number;
  /** Total bushels covered by hedges */
  hedgedBushels: number;
  /** Unhedged exposure (purchased - hedged) */
  netPosition: number;
  /** Weighted average purchase price per bushel */
  averagePurchasePrice: number;
  /** Weighted average hedge price per bushel */
  averageHedgePrice: number;
  /** Projected profit/loss for this position */
  grossMargin: number;
  /** Number of open futures contracts */
  openContracts: number;
}

/**
 * Represents a futures hedge position for risk management.
 * Tracks contract details and unrealized profit/loss.
 */
export interface HedgePosition {
  /** Unique identifier for the hedge */
  id: string;
  /** Grain type being hedged */
  commodity: string;
  /** Futures contract month and symbol */
  contractMonth: string;
  /** Long (buy) or Short (sell) position */
  position: 'Long' | 'Short';
  /** Number of futures contracts */
  contracts: number;
  /** Total bushels represented by contracts */
  bushels: number;
  /** Price at which position was opened */
  entryPrice: number;
  /** Current market price */
  currentPrice: number;
  /** Unrealized profit or loss */
  unrealizedPL: number;
}
