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
export interface FieldSeason {
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
