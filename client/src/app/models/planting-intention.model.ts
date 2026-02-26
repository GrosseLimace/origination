export interface PlantingIntention {
  id: number;
  customerId: number;
  customerName: string;
  customerCode: string;
  tradeUnit: string;
  plantingYear: number;
  crop: string;
  type?: string;
  description?: string;
  acres: number;
  createdOn: string;
  createdBy: string;
  modifiedOn?: string;
  modifiedBy?: string;
}
