/** Organic (NOP) certification for one producer, from
 *  `GET /api/organic-certifications/customer/{id}`.
 *
 *  The endpoint always returns a record, never a 404 — three states are distinguishable and all
 *  three render. See `noCertificateOnFile`. */
export interface CustomerOrganicCertification {
  customerId: number;
  /** The producer's NOP id. Null means none on file. */
  nopid?: string | null;
  /** A NOP id is on file but no certification has been received for it. Show the id as usual and
   *  warn alongside it — the organics desk asked for this to be visible. It means the producer
   *  holds no current certificate, or the feed has not reached us for them yet. */
  noCertificateOnFile: boolean;
  certification?: OrganicCertification | null;
}

export interface OrganicCertification {
  nopid: string;
  operationName?: string | null;
  /** Includes the bracketed short code as the certifier sends it, e.g.
   *  "[MCIA] Minnesota Crop Improvement Association". */
  certifierName?: string | null;

  /** Operation-level status. NOT the whole picture — read `scopes` for what a producer may
   *  actually trade. Typed as string, not a union: this is third-party vocabulary and an
   *  unexpected value must render rather than break `strictTemplates`. */
  status?: string | null;
  isCertified: boolean;

  /** When the current status began, per the certifier. The date to DISPLAY. */
  statusEffectiveDate?: string | null;
  /** The NEXT scheduled annual update — forward-looking, often absent. NOT an expiry date;
   *  NOP certification has none. */
  anniversaryDate?: string | null;
  totalAcreage?: number | null;

  /** When the certifier last touched the profile on the USDA site. Distinct from
   *  `anniversaryDate`, and the two routinely disagree — a record can be recently updated while
   *  already past its annual update. Both are shown. */
  sourceUpdatedOn?: string | null;
  /** Server-computed: the "updated on" date is older than the desk's compliance window (18 months
   *  by default), or absent entirely. */
  outsideComplianceWindow: boolean;
  /** Whole months since the certifier last touched the record. Null when unknown — show
   *  "unknown" rather than implying zero. */
  monthsSinceSourceUpdate?: number | null;

  /** Server-computed from the shared rule, so this and Actionable Insights cannot disagree:
   *  flagged from the moment a change is seen until the status returns to Certified. */
  hasUnresolvedStatusChange: boolean;
  /** What it changed FROM. Null when nothing has changed on our watch. */
  previousStatus?: string | null;
  /** When our feed OBSERVED the change — not the date to display; use `statusEffectiveDate`. */
  statusChangedOn?: string | null;

  /** Per scope, because a producer can be Certified for Crops and Surrendered for Handling at
   *  once. Crops are grouped under the scope that certifies them. */
  scopes: OrganicCertificationScope[];
  updatedOn: string;
}

/** A producer whose certification status has changed and has not resolved back to Certified.
 *  From `GET /api/organic-certifications/status-changes` — a bulk read, because Actionable
 *  Insights computes client-side and makes no per-customer calls. */
export interface OrganicCertificationStatusChange {
  customerId: number;
  /** The CTRM customer code — what Insights matches on, since it indexes contracts by it. */
  scoularId?: string | null;
  nopid: string;
  operationName?: string | null;
  /** The status now. */
  status?: string | null;
  /** What it changed FROM. */
  previousStatus?: string | null;
  /** When the certifier says the new status took effect — the date to display. */
  statusEffectiveDate?: string | null;
  /** When our feed observed it. Not for display. */
  statusChangedOn?: string | null;
}

export interface OrganicCertificationScope {
  /** "Crops", "Livestock", "Handling", "Wild Crops". */
  scope: string;
  status?: string | null;
  /** Whether THIS scope is certified — the question a trader is actually asking. */
  isCertified: boolean;
  statusEffectiveDate?: string | null;
  /** Already split and de-duplicated server-side; render as chips without parsing. Entries a
   *  certifier wrote as prose may read oddly — preferred to hiding a crop. */
  crops: string[];
}
