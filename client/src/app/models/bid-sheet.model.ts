export interface BidSheetLocationBid {
  id: number;
  locationId: number;
  commodityCode: string;
  commodityName?: string;
  commodityCategory?: string;
  cropYear: number;
  month: number;
  bid: string;
  /** Who owns this cell: 'Manual' (a user typed it) or 'Barchart' (fed). A fed cell may be typed over;
   *  the feed takes it back only with a quote that is current and newer than the edit. */
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
  /** Set when this cell shows a LATER contract month's bid whose delivery window covers this month
   *  (October showing the "Nov 26" bid that delivers from 1 Oct). Absent = the elevator's own bid. */
  coveredByCropYear?: number;
  coveredByMonth?: number;
  /** UTC time the cash / basis value last actually changed -- not the vendor's re-post stamp. */
  cashChangedAt?: string;
  basisChangedAt?: string;
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

/** Who owns a bid cell. Typing over a 'Barchart' cell makes it 'Manual' (newest wins, both ways). */
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
  /** Set when this row is linked to a BarChart listing; its bids arrive from the feed. */
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
  /** Each side's own elevator stamp, regardless of the toggle (quoteAsOf above follows it). A side is
   *  judged stale on its own stamp: cash and basis are separate BarChart instruments. */
  cashQuoteAsOf?: string;
  basisQuoteAsOf?: string;
  /** Set when this cell shows a LATER contract month's bid whose delivery window covers this month
   *  (October showing the "Nov 26" bid that delivers from 1 Oct). Absent = the elevator's own bid. */
  coveredByCropYear?: number;
  coveredByMonth?: number;
  /** UTC time the cash / basis value last actually changed -- not the vendor's re-post stamp. */
  cashChangedAt?: string;
  basisChangedAt?: string;
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

/**
 * One bid sheet preference write. Every field except the key is optional and `undefined` means
 * "leave alone" — except cropCode/month/cropYear, which the server assigns unconditionally, so a
 * caller saving anything at all must still send the panel's current crop/month/year.
 */
export interface BidSheetPreferenceUpdate {
  tradeUnitKey: string;
  cropCode: string | null;
  month: number | null;
  cropYear: number | null;
  /**
   * The Edit Bids columns, as a JSON array of picks in display order:
   * `[{"c":"YC","y":2026,"m":12},{"c":"YC","y":2027,"m":1}]`. One pick is one column.
   */
  selectedColumns?: string | null;
  /** @deprecated Superseded by `selectedColumns`; read once to synthesise a column list, never written. */
  cropOrder?: string | null;
  /** @deprecated Superseded by `selectedColumns`. */
  hiddenCrops?: string | null;
  /** @deprecated Superseded by `selectedColumns`. */
  selectedMonths?: string | null;
  /** @deprecated Superseded by `selectedColumns`. */
  selectedYears?: string | null;
  printLayout?: string | null;
  priceMode?: string | null;
  /** The sheet the user last had open, so the screen reopens where they left it. */
  selectedBidSheetIds?: string | null;
}

/**
 * What `GET /bidsheet/preference` returns — the stored row, or null when the user has none yet.
 *
 * Every field is nullable because the row is built up one screen setting at a time. A null
 * `selectedColumns` specifically means "has not opened the new Edit Bids grid yet", which is the
 * signal to synthesise a column list from the four deprecated fields.
 */
export interface BidSheetPreferenceRead {
  tradeUnitKey: string;
  cropCode: string | null;
  month: number | null;
  cropYear: number | null;
  selectedColumns: string | null;
  cropOrder: string | null;
  hiddenCrops: string | null;
  selectedMonths: string | null;
  selectedYears: string | null;
  printLayout: string | null;
  priceMode: string | null;
  selectedBidSheetIds: string | null;
}

/**
 * A named, shareable working set of locations — what replaced the trade unit as the thing that
 * decides which elevators the screen shows.
 *
 * Locations themselves are company-wide, so a sheet is not a permission boundary. It is the handful
 * of elevators one originator actually compares, in the order and with the columns they want, which
 * is what the trade-unit filter used to approximate badly.
 *
 * Everyone on a sheet can edit its contents and its columns. Only the owner can rename it, change who
 * it is shared with, or delete it — the client keys those three off `isOwner`.
 */
export interface BidSheet {
  id: number;
  name: string;
  /** Short UPN of the owner, e.g. `CEgr`. */
  ownerUserId: string;
  /** True when the signed-in user owns this sheet. Gates rename, share and delete. */
  isOwner: boolean;

  // Column layout, shared with everyone on the sheet. JSON strings, matching BidSheetPreference.
  /** JSON array of crop codes in display order, e.g. `["HRWW","YC"]`. */
  cropOrder?: string;
  /** JSON array of crop codes hidden from the grid. */
  hiddenCrops?: string;
  /** JSON array of months, where `0` is the Year column. */
  selectedMonths?: string;
  /** JSON array of crop years, e.g. `[2026,2027]`. */
  selectedYears?: string;

  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;

  shares: BidSheetShare[];
  /** Locations on the sheet, already in row order. */
  locations: BidSheetLocation[];
}

/** What a share points at. Membership is re-resolved on every read, so a desk or group share follows
 *  whoever is in it rather than freezing today's list. */
export type BidSheetShareType = 'person' | 'trade-unit' | 'trade-unit-group' | 'recap-group';

/** One member a sheet is shared with — a person, a whole desk, a trade-unit group, or a Daily Recap
 *  group ("Manage Groups"). Everyone a share resolves to gets full edit rights; no view-only tier. */
export interface BidSheetShare {
  memberType: BidSheetShareType;
  /** Short UPN, trade-unit code, entitlements group id, or recap group id — per `memberType`. */
  memberId: string;
  /** Short UPN, e.g. `JDoe`. Populated only for a person share and empty for the other three, so a
   *  desk code can never be mistaken for a user id. New code should read memberType + memberId. */
  userId: string;
  /** Display name captured when shared, so the list reads without a directory lookup. */
  name?: string;
  sharedBy: string;
  sharedAt: string;
}

/**
 * A partial column-layout save. Every field is optional and omitting one leaves the stored value
 * alone — the screen saves crop order, hidden crops, months and years on four separate interactions,
 * and sending the whole layout each time would let a stale client reset a colleague's view.
 */
export interface BidSheetLayoutUpdate {
  cropOrder?: string | null;
  hiddenCrops?: string | null;
  selectedMonths?: string | null;
  selectedYears?: string | null;
}
