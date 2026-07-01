export interface ProducerDetails {
  id: number;
  customerId: number;
  scoularId?: string;
  customerName: string;
  totalAcres?: number;
  binCapacity?: number;
  primaryContact?: string;
  commodities?: string; // Comma-separated list (e.g. "Corn,Soybeans,Wheat")
  linkedProducerIds?: string; // Comma-separated customer IDs
  grainOnFarm?: GrainOnFarmItem[]; // Per-commodity bushels on hand + target
  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;
}

/** Per-commodity-group grain-on-farm row: bushels on the farm + the target the farmer wants. */
export interface GrainOnFarmItem {
  commodityGroup: string;   // e.g. "Corn", "Wheat", "Soybeans"
  bushelsOnHand?: number;
  targetBushels?: number;
  grade?: string;           // free-text grade / quality note (e.g. "4.4%", "TW 58")
}
