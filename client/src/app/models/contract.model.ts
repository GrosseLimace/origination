import { ContractStatus } from './contract-status.model';

export interface Contract {
  id: number;             // Maps to bigint in C# API
  customerId: number;     // FK to Customer - maps to bigint in C# API
  ctrmCustomerId?: string; // Used to match with customer sourceCustomerId
  sourceContractId?: string; // Used to match with ticket ctrmContractNumber
  farmId: string;
  contractNumber: string;
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
}
