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
  binSites?: ProducerBinSiteItem[]; // User-entered bin sites (max 3), display order
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

/** A user-entered on-farm bin site: an optional name and a North American lat/long pair, stored
 *  to six decimal places. See shared/utils/coordinates.ts for the rules. */
export interface ProducerBinSiteItem {
  name?: string | null;
  latitude: number;
  longitude: number;
  sortOrder?: number;
}

/** Per-commodity grain-on-farm row: bushels on the farm, a grade note, and the $/bu target. */
export interface GrainOnFarmItem {
  /** Commodity code ("YC", "HRWW"), or a crop-group name ("Corn") on rows saved before
   *  2026-09-23 — see shared/utils/grain-on-farm.ts. Read it through the crop matcher, never
   *  compare it to a group string directly. */
  commodityCode: string;
  bushelsOnHand?: number;
  targetBushels?: number;
  grade?: string;           // free-text grade / quality note (e.g. "4.4%", "TW 58")
}
