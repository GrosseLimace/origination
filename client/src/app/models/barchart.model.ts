/**
 * BarChart catalog — the vendor's list of grain-buying locations and the bids they post.
 *
 * This is reference data we read but never write: the feed lands in our database on the integration
 * side's schedule, and the "Add from BarChart" picker searches it so an originator can link a
 * location to their bid sheet once and stop re-keying its bids.
 */

/** One elevator listing in the vendor catalog. */
export interface BarchartCatalogLocation {
  /** Vendor location key. This is what a bid sheet location stores to stay linked to the feed. */
  locationKey: string;
  /** Publishing company, e.g. "Grain Processing Corporation". */
  elevator?: string;
  /** Site name, usually the more recognizable of the two, e.g. "GPC-MUSCATINE". */
  locationName?: string;
  /** Country Elevator / River Terminal / Ethanol-Bio-Fuel / Feed Mill / Direct Ship… */
  facilityType?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
  /** Active bids this site publishes — a rough measure of how much it trades. */
  instrumentCount: number;
  /** Distinct commodities offered here. */
  commodityCount: number;
  /** Freshest elevator-updated bid time across the site. */
  latestQuoteAsOf?: string;
  /** Miles from the searched map centre. Only present when the search was geographic. */
  distanceMiles?: number;
  /** Trade units this location is already on, so the picker can show it as already added. */
  placements: BarchartCatalogPlacement[];
}

/** Where a catalog listing already sits on the bid sheet. */
export interface BarchartCatalogPlacement {
  /** Bid sheet location id — what you'd delete to remove this placement. */
  locationId: number;
  tradeUnitCode: string;
  groupName?: string;
  name: string;
}

/** A listing plus the bids it publishes — the picker's confirm step. */
export interface BarchartCatalogLocationDetail {
  location: BarchartCatalogLocation;
  bids: BarchartCatalogBid[];
  /** Bids whose commodity has no mapping yet; these won't reach the bid sheet. */
  unmappedBidCount: number;
}

/** One publishable bid from the catalog. */
export interface BarchartCatalogBid {
  /** Our commodity code, or absent when the vendor commodity isn't mapped. */
  commodityCode?: string;
  /** The vendor's own commodity name, always present so an unmapped row is still identifiable. */
  vendorCommodity: string;
  cropYear: number;
  /** Delivery month, 1-12. */
  month: number;
  price?: number;
  /** When the elevator last updated this bid. */
  quoteAsOf?: string;
  symbol: string;
  /** False when the commodity has no active mapping. */
  isMapped: boolean;
}

/** What the catalog holds, so an empty search reads as a coverage gap rather than a broken feed. */
export interface BarchartCoverage {
  locationCount: number;
  lastRefreshedUtc?: string;
  states: BarchartStateCoverage[];
}

/** One state's location count. */
export interface BarchartStateCoverage {
  state: string;
  locationCount: number;
}

/** Query for a catalog search. All fields optional; latitude and longitude must be supplied together. */
export interface BarchartLocationSearchParams {
  search?: string;
  state?: string;
  commodityCode?: string;
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
  take?: number;
}

/** Result of re-running the feed bridge for one bid sheet location. */
export interface BarchartRefreshBidsResult {
  locationId: number;
  /** Bid cells written or removed. */
  rowsAffected: number;
}
