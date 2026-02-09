import { ContractStatus } from './contract-status.model';

export interface Contract {
  id: string;
  customerId: string;
  ctrmCustomerId?: string; // Used to match with customer sourceCustomerId
  farmId: string;
  contractNumber: string;
  commodityCode?: string;
  commodityDescription?: string; // Grain type (Corn, Soybeans, Wheat)
  quantity: number;       // Bushels
  unit: string;           // Usually "bushels"
  price: number;          // Price per bushel
  deliveryStart: Date;
  deliveryEnd: Date;
  status: ContractStatus;
  signed: boolean;
}
