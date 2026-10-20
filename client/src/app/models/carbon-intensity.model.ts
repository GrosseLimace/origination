/**
 * Fields under planting intentions, with the 45Z (USDA FD-CIC carbon intensity) layer on top.
 *
 * A ProducerField is durable: a name and a location, entered once and offered again in later years.
 * A FieldSeason is that field's share of one planting intention (one crop row): its acres and, for a
 * scored crop, its practices. Crop, year, type and trade unit all come from the intention row, so
 * they are never entered twice. The intention's Acres stays the total the dashboard counts; fields
 * only break it down.
 */

export type FdCicCrop = 'Corn' | 'Soybean' | 'Sorghum' | 'Canola';

export type Tillage = 'NoTill' | 'ReducedTill' | 'Conventional';
export type CoverCrop = 'None' | 'CoverCrop' | 'CoverCropGrazed';
export type ManureType = 'Beef' | 'Dairy' | 'Swine' | 'Poultry';
export type ManureForm = 'Solid' | 'Liquid';
export type SeasonStatus = 'Draft' | 'Projected' | 'Final';

export interface ProducerField {
  fieldKey: string;
  customerId: number;
  name: string;
  state: string;
  county: string;
  fsaFarmNo?: string;
  fsaTractNo?: string;
  fsaFieldNo?: string;
}

export interface ManureApplication {
  type: ManureType;
  form: ManureForm;
  /** tons/ac when Solid, 1,000 gal/ac when Liquid. */
  amount: number | null;
  /** lbs N per ton when Solid, per 1,000 gal when Liquid. */
  nContent: number | null;
}

/** One field's share of one planting intention (crop row). */
export interface FieldSeason extends CiIntakeFields {
  id: string;
  fieldKey: string;
  plantingIntentionId: number;
  /** Copied from the intention when the field is added, for history and copy-forward. */
  year: number;
  cropLabel: string;
  acres: number | null;
  expectedYield: number | null;
  actualYield: number | null;
  syntheticN: number | null;
  /** 0–1 in storage; the form shows 0–100%. */
  niFraction: number;
  tillage: Tillage | null;
  coverCrop: CoverCrop | null;
  manure: ManureApplication[];
  status: SeasonStatus;
  finalizedBy?: string;
  finalizedAt?: string;
}

export interface CiComponent {
  key: 'nFertilizer' | 'n2o' | 'energy' | 'chemicals' | 'ureaLime' | 'soilCarbon';
  label: string;
  value: number;
}

/** A plain-language "why it moved" line, e.g. "No-till: −410 g/bu". */
export interface CiReason {
  label: string;
  delta: number;
}

export interface CiResult {
  crop: FdCicCrop;
  ciGPerBu: number;
  nationalAverage: number;
  /** Fractional change vs national, e.g. −0.30. */
  vsNational: number;
  components: CiComponent[];
  reasons: CiReason[];
  yieldUsed: number;
}

export interface IntentionCiSummary {
  plantingIntentionId: number;
  fieldCount: number;
  assignedAcres: number;
  intentionAcres: number;
  /** Producer crop-year CI: bushel-weighted, acres not in a field at the national average. Null with no scored fields. */
  ciGPerBu: number | null;
  vsNational: number | null;
  status: SeasonStatus | 'NotStarted';
}

// ── Audit intake: what the CI ledger and a third-party auditor trace back to ──────────────────────

export type NProduct = 'Anhydrous' | 'UAN' | 'Urea' | 'AmmoniumNitrate' | 'AmmoniumSulfate' | 'MapDap' | 'Other';
export type NTiming = 'Fall' | 'Preplant' | 'AtPlant' | 'Sidedress' | 'Split';
/** Enhanced-efficiency product on the N. Only a nitrification inhibitor lowers the FD-CIC N₂O figure. */
export type NEfficiency = 'None' | 'NitrificationInhibitor' | 'UreaseInhibitor' | 'Both' | 'PolymerCoated';

/** One commercial nitrogen pass. */
export interface NApplication {
  product: NProduct;
  /** Pounds of actual N per acre, not pounds of product. */
  lbsN: number | null;
  timing: NTiming;
  efficiency: NEfficiency;
}

/** On-farm energy for the field, per acre. Null means not reported, never zero. */
export interface OnFarmEnergy {
  dieselGal: number | null;
  gasolineGal: number | null;
  lpGal: number | null;
  naturalGasTherms: number | null;
  electricityKwh: number | null;
}

export type EvidenceKind = 'NInvoice' | 'NApplicationRecord' | 'YieldRecord' | 'EnergyRecord' | 'Other';

/** A supporting record behind the practices. PROTOTYPE: a reference only, nothing is uploaded. */
export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  /** File name or document number, e.g. "Co-op invoice 48812" or "FSA-578 2026". */
  reference: string;
  addedBy: string;
  addedAt: string;
}

/**
 * The audit-grade intake on a field season, shared by every field-plan option. syntheticN and
 * niFraction on the season are derived from nApplications (see nSummary), so scoring is unchanged.
 */
export interface CiIntakeFields {
  nApplications: NApplication[];
  /** The producer confirms no commercial N went on: the only way an empty list means 0 lbs. */
  noNApplied: boolean;
  phosphateLbs: number | null;
  potashLbs: number | null;
  limeTons: number | null;
  energy: OnFarmEnergy;
  evidence: EvidenceItem[];
  /** Frozen at finalize, so the score the ledger carries never moves when the calculator changes. */
  finalCiGPerBu?: number;
  calculatorVersion?: string;
}

export type EnrollmentStatus = 'Draft' | 'Attested' | 'Withdrawn';

/** The producer's signed statement for one crop year. */
export interface ProducerAttestation {
  signerName: string;
  /** yyyy-mm-dd. */
  signedOn: string;
  method: 'eSign' | 'Paper';
  documentRef: string;
  /** None of the listed fields is enrolled with another buyer or program for this crop year. */
  notEnrolledElsewhere: boolean;
  /** The practices, yields and records provided are accurate. */
  recordsAccurate: boolean;
  /** Scoular, the plant and a third-party auditor may review the supporting records. */
  consentToThirdPartyAudit: boolean;
  /** Scoular, as the first point of aggregation, holds and allocates the CI; the producer makes no other claim on it. */
  firstPointOfAggregationAck: boolean;
}

/**
 * One producer's 45Z enrollment for one crop year: the ID a delivery lot points back to. Lists
 * finalized field seasons, each carrying its own frozen field-level CI. The ID is issued when the
 * producer attests and is never reused, even after a withdrawal.
 */
export interface CiEnrollment {
  key: string;
  enrollmentId: string | null;
  customerId: number;
  cropYear: number;
  status: EnrollmentStatus;
  fieldSeasonIds: string[];
  attestation: ProducerAttestation;
  attestedBy?: string;
  attestedAt?: string;
  /** The listed seasons as they stood when attested: field, FSA numbers, yield and frozen CI. */
  snapshot?: EnrollableSeason[];
  withdrawnReason?: string;
}

/** A field season as the enrollment sees it, whichever field-plan option it came from. */
export interface EnrollableSeason {
  seasonId: string;
  fieldKey: string;
  fieldName: string;
  fsaFarmNo?: string;
  fsaTractNo?: string;
  fsaFieldNo?: string;
  cropLabel: string;
  cropYear: number;
  acres: number | null;
  actualYield: number | null;
  status: SeasonStatus;
  finalCiGPerBu?: number;
}
