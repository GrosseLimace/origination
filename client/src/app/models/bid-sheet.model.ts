/**
 * Response from `GET /api/map-config` — runtime map configuration for any MapLibre/Azure Maps
 * consumer that isn't field-tagging-specific (currently: Bid Sheet). Each key is gated
 * independently by the API (unlike `FieldTagMapConfig`'s all-or-nothing `enabled` gate), so
 * `azureMapsKey` and `landMapMagicKey` can be non-null independently of one another.
 */
export interface MapConfig {
  azureMapsKey: string | null;
  landMapMagicKey: string | null;
  cdlYear: string;
  cdlFallbackYear: string;
}

export interface BidSheetLocationBid {
  id: number;
  locationId: number;
  commodityCode: string;
  commodityName?: string;
  commodityCategory?: string;
  cropYear: number;
  month: number;
  bid: string;
  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;
}

export interface BidSheetLocation {
  id: number;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  elevatorCode?: string;
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
  tradeUnitCode: string;
  groupName?: string;
  commodityCode: string;
  commodityName?: string;
  commodityCategory?: string;
  cropYear: number;
  month: number;
  bid: string;
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
