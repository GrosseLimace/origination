/**
 * The 45Z program's data: the inputs of the USDA FD-CIC calculator (v1.2, "Crop Inputs" tab), less
 * the ones the field already holds (state, county, acres). Option values follow the workbook.
 */

export type FdCicCrop = 'Corn' | 'Soybean' | 'Sorghum' | 'Canola';

/** FD-CIC v1.2 tillage: Reduced till (STIR < 80), No till (STIR < 20), None of the above. */
export type Tillage = 'ReducedTill' | 'NoTill' | 'NoneOfTheAbove';
/** FD-CIC v1.2 cover crop: Cover crop, Cover crop with grazing, No cover crop. */
export type CoverCrop = 'None' | 'CoverCrop' | 'CoverCropGrazed';
export type ManureType = 'Beef' | 'Dairy' | 'Swine' | 'Poultry';
export type ManureForm = 'Solid' | 'Liquid';
/** Status the illustrative scoring helpers work with. */
export type SeasonStatus = 'Draft' | 'Projected' | 'Final';

export interface ManureApplication {
  type: ManureType;
  form: ManureForm;
  /** tons/ac when Solid, 1,000 gal/ac when Liquid. */
  amount: number | null;
  /** lbs N per ton when Solid, per 1,000 gal when Liquid. */
  nContent: number | null;
}

/** One field season's 45Z (FD-CIC) inputs. */
export interface FdCicData {
  /** Crop insurance APH yield, or an RMA transitional / FSA county benchmark yield. */
  expectedYield: number | null;
  /** Entered when the field is finalized, after harvest. */
  actualYield: number | null;
  /** Total synthetic N, lbs N/ac, from after the previous cash crop's harvest through this harvest. */
  syntheticN: number | null;
  /** Share of synthetic N with a nitrification inhibitor, 0–1 (the form shows 0–100%). */
  niFraction: number;
  coverCrop: CoverCrop;
  tillage: Tillage;
  /** Up to 3, as in the workbook. */
  manure: ManureApplication[];
}

export interface CiComponent {
  key: 'nFertilizer' | 'n2o' | 'energy' | 'chemicals' | 'ureaLime' | 'soilCarbon';
  label: string;
  value: number;
}

/** A plain-language "why it moved" line, e.g. "No till: −410 g/bu". */
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
