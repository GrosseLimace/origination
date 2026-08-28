export interface BidSheetLocationBid {
  id: number;
  locationId: number;
  commodityCode: string;
  commodityName?: string;
  commodityCategory?: string;
  cropYear: number;
  month: number;
  bid: string;
  /** Who owns this cell: 'Manual' (a user typed it) or 'Barchart' (fed, read-only). */
  source: BidSource;
  /** Vendor symbol behind a fed cell; absent on manual cells. */
  barchartSymbol?: string;
  /** When the elevator last updated a fed bid — the "as of" shown next to the value. */
  quoteAsOf?: string;
  /** Basis bid for this cell, in cents against the board. Negative is the normal case ("30 under"). */
  basisBid?: string;
  /** Vendor symbol behind the basis bid. */
  basisSymbol?: string;
  /** When the elevator last updated the basis bid. */
  basisQuoteAsOf?: string;
  /**
   * Futures contract the bid is quoted against, e.g. `ZCZ26`. Absent on manual cells.
   *
   * Not the delivery month: Kansas City wheat delivering in January trades against the March board.
   * Originators compare bids by the contract behind them, so this is what a Year cell names.
   */
  underlyingFuture?: string;
  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;
}

/** Who owns a bid cell. The server enforces this too: writes to a 'Barchart' cell are rejected. */
export type BidSource = 'Manual' | 'Barchart';

export interface BidSheetLocation {
  id: number;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  elevatorCode?: string;
  /** Set when this row is linked to a BarChart listing; its bids are fed and read-only. */
  barchartLocationKey?: string;
  tradeUnitCode: string;
  groupName?: string;
  isScoularFacility?: boolean;
  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;
  bids: BidSheetLocationBid[];
}

/** Flattened view of a BidSheetLocation + one of its bids — used internally by the bid sheet component. */
export interface BidSheetEntry {
  id: number;           // bid id
  locationId: number;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  elevatorCode?: string;
  barchartLocationKey?: string;
  tradeUnitCode: string;
  groupName?: string;
  commodityCode: string;
  commodityName?: string;
  commodityCategory?: string;
  cropYear: number;
  month: number;
  /** Whichever price the sheet is currently showing, so map, panel and print follow the toggle. */
  bid: string;
  source: BidSource;
  barchartSymbol?: string;
  quoteAsOf?: string;
  /** The cash price regardless of the toggle — the Edit Bids grid needs both at once in "Both" mode. */
  cashBid?: string;
  basisBid?: string;
  basisQuoteAsOf?: string;
  /** Futures contract behind the bid, e.g. `ZCZ26`. */
  underlyingFuture?: string;
  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;
}

export interface Elevator {
  elevatorCode: string;
  elevatorShortName: string;
  elevatorName: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  ourFacility?: string;
  bushelCapacity?: number;
  elevatorCompanyCode?: string;
  elevatorDivisionCode?: string;
  elevatorLocationCode?: string;
  tradeUnitCode?: string;
  latitude?: number;
  longitude?: number;
}
