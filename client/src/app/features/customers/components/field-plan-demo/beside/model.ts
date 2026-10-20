/* DEMO ONLY (demo_FieldPlanCompare): a frozen copy of an earlier prototype's model, so the three
 * field-plan options can be compared side by side. Delete this folder with the comparison switch. */
export * from '@models';
import type { CiIntakeFields } from '@models';

/**
 * 45Z field-level data capture and USDA FD-CIC carbon intensity (CI).
 *
 * A ProducerField is durable: entered once and reused every crop year. A FieldSeason is one field
 * in one crop year under one planting intention, holding that year's practices. The intention keeps
 * its own acres as the total; seasons only assign acres beneath it, so nothing that sums
 * PlantingIntention.acres (the dashboard and friends) sees this data.
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
  acres: number;
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

export interface FieldSeason extends CiIntakeFields {
  id: string;
  fieldKey: string;
  plantingIntentionId: number;
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
  /** Producer crop-year CI: bushel-weighted, unassigned acres at the national average. Null with no scored fields. */
  ciGPerBu: number | null;
  vsNational: number | null;
  status: SeasonStatus | 'NotStarted';
}
