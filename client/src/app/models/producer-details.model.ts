export interface ProducerDetails {
  id: number;
  customerId: number;
  sourceCustomerId?: string;
  customerName: string;
  totalAcres?: number;
  binCapacity?: number;
  primaryContact?: string;
  commodities?: string; // Comma-separated list (e.g. "Corn,Soybeans,Wheat")
  linkedProducerIds?: string; // Comma-separated customer IDs
  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;
}
