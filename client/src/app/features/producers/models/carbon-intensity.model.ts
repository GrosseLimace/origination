import type { TDiscPass } from './tdisc.model';

/**
 * The 45Z program's data: the inputs of the USDA FD-CIC calculator (v1.2, "Crop Inputs" tab), less
 * the ones the field already holds (state, county, acres). Option values follow the workbook.
 */

export type FdCicCrop = 'Corn' | 'Soybean' | 'Sorghum' | 'Canola';

/**
 * FD-CIC v1.2 tillage: Reduced till, No till, None of the above. Confirming a no-till or reduced-till CI needs
 * the field's passes rated with USDA T-DISC (no till 0.075 or less, reduced till 0.252 or less; see fd-cic-tdisc.ts).
 */
export type Tillage = 'ReducedTill' | 'NoTill' | 'NoneOfTheAbove';
/** FD-CIC v1.2 cover crop: Cover crop, Cover crop with grazing, No cover crop. */
export type CoverCrop = 'None' | 'CoverCrop' | 'CoverCropGrazed';
export type ManureType = 'Beef' | 'Dairy' | 'Swine' | 'Poultry';
export type ManureForm = 'Solid' | 'Liquid';

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
  /**
   * The field's passes for USDA T-DISC, entered in the review for no till or reduced till (saved as they're
   * entered). Not needed for an estimate.
   */
  tDiscPasses?: TDiscPass[] | null;
  /** The T-DISC rating (0-1) the server worked out from the passes when the field was confirmed. */
  tDiscRating?: number | null;
}
