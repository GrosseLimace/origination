/* DEMO ONLY (demo_FieldPlanCompare): a frozen copy of an earlier prototype's model, so the three
 * field-plan options can be compared side by side. Delete this folder with the comparison switch. */
export * from '@models';
import type { CiIntakeFields } from '@models';

/**
 * Field-level planting plans, with the 45Z (USDA FD-CIC carbon intensity) layer on top.
 *
 * A ProducerField is durable: entered once and reused every crop year. A FieldSeason is one field
 * planted to one crop in one year; seasons roll up into the producer's planting intentions, grouped
 * the same way the add dialog groups them (crop, type, year, trade unit). The intention keeps its
 * Acres column as the total — field acres plus "other acres" not yet placed in a field — so the
 * dashboard and everything else that sums PlantingIntention.acres reads the same column as today.
 */

export type FdCicCrop = 'Corn' | 'Soybean' | 'Sorghum' | 'Canola';

export type IrrigationType = 'Irrigated' | 'Dryland';
export type Tillage = 'NoTill' | 'ReducedTill' | 'Conventional';
export type CoverCrop = 'None' | 'CoverCrop' | 'CoverCropGrazed';
export type ManureType = 'Beef' | 'Dairy' | 'Swine' | 'Poultry';
export type ManureForm = 'Solid' | 'Liquid';
export type SeasonStatus = 'Draft' | 'Projected' | 'Final';

/** Crop code for a field left unplanted for the year. */
export const FALLOW = 'FALLOW';

export interface ProducerField {
  fieldKey: string;
  customerId: number;
  name: string;
  acres: number;
  irrigation: IrrigationType;
  state: string;
  county: string;
  /** Trade unit the field's acres count under; defaults from the producer. */
  tradeUnit: string;
  fsaFarmNo?: string;
  fsaTractNo?: string;
  fsaFieldNo?: string;
  latitude?: number;
  longitude?: number;
  /** PROTOTYPE ONLY: seeded demo field, labelled "Sample" so it isn't mistaken for real data. */
  isSample?: boolean;
}

export interface ManureApplication {
  type: ManureType;
  form: ManureForm;
  /** tons/ac when Solid, 1,000 gal/ac when Liquid. */
  amount: number | null;
  /** lbs N per ton when Solid, per 1,000 gal when Liquid. */
  nContent: number | null;
}

/** One field planted to one crop in one year (a double crop is a second season with sortOrder 2). */
export interface FieldSeason extends CiIntakeFields {
  id: string;
  fieldKey: string;
  year: number;
  /** Commodity code, or FALLOW. */
  crop: string;
  cropLabel: string;
  /** Planting-intention type: the field's irrigation, or 'Double Crop' for a second crop. */
  type: string;
  tradeUnit: string;
  acres: number | null;
  sortOrder: number;
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
  /** Producer crop-year CI: bushel-weighted, other acres at the national average. Null with no scored fields. */
  ciGPerBu: number | null;
  vsNational: number | null;
  status: SeasonStatus | 'NotStarted';
}
