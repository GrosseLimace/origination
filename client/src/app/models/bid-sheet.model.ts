export interface BidSheetLocationBid {
  id: number;
  locationId: number;
  commodityCode: string;
  commodityName?: string;
  commodityCategory?: string;
  cropYear: number;
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
