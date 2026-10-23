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

/**
 * One CI component split into the part the field's inputs change and the part the calculator fixes
 * (a national figure), with the inputs that drive it. Not a USDA output: the API's method explains its
 * own formulas, so a new USDA version brings its own split.
 */
export interface FdCicComponentPart {
  /** e.g. "soilCarbon", as in FdCicComponents. */
  key: string;
  label: string;
  total: number;
  /** The part no input changes; total − fixed is what the inputs drive. */
  fixed: number;
  /** What the fixed part is, e.g. "Lime"; null when there's none. */
  fixedLabel: string | null;
  /** The form inputs that change the rest, e.g. ["Tillage", "Cover crop"]; empty when nothing does. */
  drivers: string[];
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
  /** Each component split into what the inputs change and the fixed USDA part; empty when not scorable. */
  breakdown: FdCicComponentPart[];
  /** g CO₂e/bu; null when not scorable. */
  ci: number | null;
  nationalAverage: number;
  /** (CI − national) ÷ national. */
  changeFraction: number | null;
  /**
   * Not a USDA output: what each choice is worth against the workbook default, most helpful first, and
   * which components it moves (never a fixed USDA figure).
   */
  effects: { label: string; delta: number; components: { key: string; label: string; delta: number }[] }[];
  unit: string;
}

/** Where one field's score stands: being calculated, calculated, or the API refused it. */
export type FdCicScoreState =
  | { status: 'loading' }
  | { status: 'done'; score: FdCicScore }
  | { status: 'error'; message: string };
