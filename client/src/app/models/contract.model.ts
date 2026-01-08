import { ContractStatus } from './contract-status.model';

export interface Contract {
  id: string;
  customerId: string;
  farmId: string;
  contractNumber: string;
  crop: string;
  quantity: number;
  unit: string;
  price: number;
  deliveryStart: Date;
  deliveryEnd: Date;
  status: ContractStatus;
  signed: boolean;
}
