export interface ProducerDetails {
  id: number;
  customerId: number;
  scoularId?: string;
  customerName: string;
  totalAcres?: number;
  binCapacity?: number;
  primaryContact?: string; // derived server-side from the primary contact row (kept for compat)
  primaryPhone?: string;   // derived server-side from the primary contact row (kept for compat)
  commodities?: string; // Comma-separated list (e.g. "Corn,Soybeans,Wheat")
  linkedProducerIds?: string; // Comma-separated customer IDs
  grainOnFarm?: GrainOnFarmItem[]; // Per-commodity bushels on hand + target
  contacts?: ProducerContactItem[]; // User-entered contacts, primary first
  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;
}

/** A user-entered contact for a producer — a person (Dad, Son) or organization (insurance co).
 *  Exactly one row per producer is primary; array order (sortOrder) is the display order. */
export interface ProducerContactItem {
  name: string;
  phone?: string;   // stored formatted "(XXX) XXX-XXXX"
  email?: string;
  isPrimary?: boolean;
  sortOrder?: number;
}

/** Per-commodity-group grain-on-farm row: bushels on the farm + the target the farmer wants. */
export interface GrainOnFarmItem {
  commodityGroup: string;   // e.g. "Corn", "Wheat", "Soybeans"
  bushelsOnHand?: number;
  targetBushels?: number;
  grade?: string;           // free-text grade / quality note (e.g. "4.4%", "TW 58")
}
