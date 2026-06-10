export interface PlantingIntention {
  id: number;
  customerId: number;
  customerName: string;
  customerCode: string;
  tradeUnit: string;
  plantingYear: number;
  crop: string;
  category?: string;
  type?: string;
  description?: string;
  acres: number;
  createdAt: string;
  createdBy: string;
  modifiedAt?: string;
  modifiedBy?: string;
}
