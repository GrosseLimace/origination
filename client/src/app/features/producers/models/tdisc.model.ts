/**
 * USDA T-DISC (Tillage Disturbance Index for Soil Carbon), which a no-till or reduced-till 45Z field needs
 * before its CI is confirmed (7 CFR 2100.051). GET api/tdisc/options returns what the review's pass table is
 * built from; the server rates the passes at confirm. See fd-cic-tdisc.ts.
 */

/** A tillage window key, as the workbook names it. */
export type TDiscWindowKey = 'Field_Preparation' | 'Before_Planting' | 'Planting' | 'After_Planting' | 'Harvest';

/** T-DISC's designations: no till, reduced till, conventional till. */
export type TDiscDesignation = 'NT' | 'RT' | 'CT';

/** A field pass: the window it fell in and the T-DISC implement used. */
export interface TDiscPass {
  window: TDiscWindowKey;
  implement: string;
}

export interface TDiscOptions {
  version: string;
  label: string;
  maxPasses: number;
  /** A window's index is its tillage intensity ÷ this depth (cm). */
  indexDepthCm: number;
  designations: { max: number; designation: TDiscDesignation }[];
  windows: { key: TDiscWindowKey; label: string; implements: string[] }[];
  implements: { name: string; mixingEfficiency: number; depthCm: number }[];
  /** USDA's lookup: an everyday operation and the implements to enter for it, one pass each. */
  operations: { name: string; implements: string[] }[];
}

/** A pass as rated: its implement's mixing efficiency and depth, and the tillage intensity it adds. */
export interface TDiscRatedPass extends TDiscPass {
  mixingEfficiency: number;
  depthCm: number;
  tillageIntensity: number;
}

/** A window's index (null with no passes) and designation. */
export interface TDiscRatedWindow {
  key: TDiscWindowKey;
  label: string;
  index: number | null;
  designation: TDiscDesignation | null;
}

/** The worksheet: the rating (the highest window index) and what it's built from. */
export interface TDiscResult {
  rating: number;
  designation: TDiscDesignation;
  windows: TDiscRatedWindow[];
  passes: TDiscRatedPass[];
}
