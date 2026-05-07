import { ContractStatus } from './contract-status.model';

export interface Contract {
  id: number;             // Maps to bigint in C# API
  customerId: number;     // FK to Customer - maps to bigint in C# API
  ctrmCustomerId?: string; // Used to match with customer scoularId
  sourceContractId?: string; // Used to match with ticket ctrmContractNumber
  farmId: string;
  contractNumber: string;
  contractPrefixType?: string; // P = Purchase, S = Sale
  commodityCode?: string;
  commodityDescription?: string; // Grain type (Corn, Soybeans, Wheat)
  commodityGroup?: string; // Commodity group (e.g., "Wheat", "Corn", "Soybeans")
  tradeUnit?: string;     // Trade unit / organization code
  quantity: number;       // Bushels
  pricedQuantity?: number; // Quantity that has been priced
  unit: string;           // Usually "bushels"
  price: number;          // Price per bushel (calculated: totalValue / quantity)
  totalValue?: number;    // Total contract value from ODS
  contractDate?: Date;    // Date the contract was booked
  cropYear?: number;      // Grain crop year (e.g. 2025, 2026)
  openBalanceQuantity?: number; // Remaining unshipped bushels
  deliveryStart: Date;
  deliveryEnd: Date;
  status: ContractStatus;
  signed: boolean;
  priceTypeCode?: string; // ODS PriceTypeCode (e.g. "P" = priced, "U" = unpriced)
  specialType?: string;   // ODS SpecialType (specialty attribute code; null for standard contracts)
  customerConfirmStatus?: string; // ODS CustomerConfirmStatus (e.g. "Confirmed", "Pending", null)
  closedDate?: Date; // Null = open contract; set = closed/fulfilled
  marketZone?: string; // Market zone from ODS
  basisLocation?: string; // Basis price location from ODS
}
