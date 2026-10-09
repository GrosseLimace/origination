export interface ProducerDetails {
  id: number;
  customerId: number;
  scoularId?: string;
  customerName: string;
  totalAcres?: number;
  /** When the bin sites or grain on farm last actually changed (UTC ISO); null if never. */
  binSitesModifiedAt?: string | null;
  primaryContact?: string; // derived server-side from the primary contact row (kept for compat)
  primaryPhone?: string;   // derived server-side from the primary contact row (kept for compat)
  commodities?: string; // Comma-separated list (e.g. "Corn,Soybeans,Wheat")
  linkedProducerIds?: string; // Comma-separated customer IDs
  grainOnFarm?: GrainOnFarmItem[]; // Per-commodity bushels on hand + target
  contacts?: ProducerContactItem[]; // User-entered contacts, primary first
  binSites?: ProducerBinSiteItem[]; // User-entered bin sites, display order
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
 *  at full precision (shown to six places). See shared/utils/coordinates.ts for the rules. */
export interface ProducerBinSiteItem {
  /** Stable across saves (the client makes one for a new site); grain-on-farm rows link to it. */
  siteKey?: string;
  name?: string | null;
  latitude?: number | null;  // optional: only the name is required (2026-10-09)
  longitude?: number | null;
  capacity?: number | null; // storage capacity in bushels, per site (the only capacity recorded)
  sortOrder?: number;
}

/** Per-commodity grain-on-farm row: total bushels on the farm, how many of those are sold, a grade
 *  note, and the $/bu target. */
export interface GrainOnFarmItem {
  /** The bin site this grain is stored at (its siteKey); null on rows saved before grain was tied
   *  to sites (2026-10-09). */
  binSiteKey?: string | null;
  /** That site's name, for display (read only). */
  binSiteName?: string | null;
  /** Commodity code ("YC", "HRWW"), or a crop-group name ("Corn") on rows saved before
   *  2026-09-23 — see shared/utils/grain-on-farm.ts. Read it through the crop matcher, never
   *  compare it to a group string directly. */
  commodityCode: string;
  bushelsOnHand?: number;   // total bushels on the farm, sold or not
  bushelsSold?: number;     // of the total, how many are already sold (user-entered)
  targetBushels?: number;   // $/bu target PRICE — not bushels, despite the name; may be negative (basis)
  lastBid?: number;         // last bid, user-entered; may be negative (basis)
  grade?: string;           // free-text grade / quality note (e.g. "4.4%", "TW 58")
}
