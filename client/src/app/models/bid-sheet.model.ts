export interface BidSheetEntry {
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

export interface BidReference {
  id: number;
  userId: string;
  tradeUnitCode: string;
  commodityCode: string;
  elevatorCode: string;
  modifiedAt: string;
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
