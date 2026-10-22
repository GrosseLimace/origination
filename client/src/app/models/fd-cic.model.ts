/**
 * The API's USDA FD-CIC calculator (api/fd-cic). Labels (crop, cover crop, tillage) are the workbook's
 * own, e.g. "Corn", "Cover crop with grazing", "None of the above".
 */

export interface FdCicScoreRequest {
  crop: string;
  state: string;
  county: string;
  /** bu/ac; null for a projected score before harvest. */
  actualYield: number | null;
  expectedYield: number;
  syntheticN: number;
  niFraction: number;
  coverCrop: string;
  tillage: string;
  manure: { amount: number; nContent: number }[];
}

export interface FdCicComponents {
  nFertilizer: number;
  soilCarbon: number;
  directN2o: number;
  indirectN2o: number;
  onFarmEnergy: number;
  otherChemicals: number;
  ureaLime: number;
}

/** A score and the exact USDA version that produced it. */
export interface FdCicScore {
  version: string;
  /** e.g. "USDA FD-CIC v1.2". */
  label: string;
  sourceSha256: string;
  formulaFingerprint: string;
  /** No actual yield yet: the expected yield stood in. */
  projected: boolean;
  scorable: boolean;
  /** Why USDA's tables can't score this crop and place, when not scorable. */
  unscorableReason: string | null;
  mlra: string | null;
  yieldForCi: number;
  components: FdCicComponents | null;
  /** g CO₂e/bu; null when not scorable. */
  ci: number | null;
  nationalAverage: number;
  /** (CI − national) ÷ national. */
  changeFraction: number | null;
  /** Not a USDA output: what each choice is worth against the workbook default, most helpful first. */
  effects: { label: string; delta: number }[];
  unit: string;
}

/** Where one field's score stands: being calculated, calculated, or the API refused it. */
export type FdCicScoreState =
  | { status: 'loading' }
  | { status: 'done'; score: FdCicScore }
  | { status: 'error'; message: string };
