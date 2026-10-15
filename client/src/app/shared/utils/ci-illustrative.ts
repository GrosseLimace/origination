import { CiComponent, CiReason, CiResult, CoverCrop, FdCicCrop, FieldSeason, IntentionCiSummary, SeasonStatus, Tillage } from '@models';

/**
 * PROTOTYPE ONLY: an illustrative CI estimate so the 45Z capture screens can be walked through
 * before the real USDA FD-CIC port exists. The national-average components and N thresholds are the
 * FD-CIC v1.0 values (USDA Helper Sheet H4:H41, Parameters B180:E180). The practice effects are fixed
 * round numbers, NOT the county/MLRA-specific CSA tables. Replace this with the API's
 * POST /carbonintensity/seasons/preview once the C# calculator lands; it must not ship to QA or PROD.
 */

interface NationalDefaults {
  nFert: number; directN2O: number; indirectN2O: number; dieselGas: number;
  energyOther: number; chemicals: number; urea: number; lime: number;
  /** lbs N per bushel at which N fertilizer equals the national figure. */
  nThreshold: number;
}

const NATIONAL: Record<FdCicCrop, NationalDefaults> = {
  Corn:    { nFert: 1285.99, directN2O: 2170.71, indirectN2O: 746.98,  dieselGas: 543.58,  energyOther: 274.12, chemicals: 472.34,  urea: 234.41,  lime: 302.52, nThreshold: 0.9774 },
  Soybean: { nFert: 169.15,  directN2O: 4461.97, indirectN2O: 690.13,  dieselGas: 1030.79, energyOther: 238.05, chemicals: 1057.55, urea: 30.83,   lime: 0,      nThreshold: 0.0988 },
  Sorghum: { nFert: 1523.01, directN2O: 2492.92, indirectN2O: 864.10,  dieselGas: 684.82,  energyOther: 5.07,   chemicals: 596.77,  urea: 277.61,  lime: 0,      nThreshold: 1.1585 },
  Canola:  { nFert: 3109.10, directN2O: 6975.08, indirectN2O: 2377.88, dieselGas: 899.87,  energyOther: 40.62,  chemicals: 1021.58, urea: 1114.14, lime: 0,      nThreshold: 2.8424 },
};

// Illustrative per-acre soil-carbon credits (g CO2e/ac) and fuel multipliers.
const TILLAGE_SOC: Record<Tillage, number> = { NoTill: 80_000, ReducedTill: 35_000, Conventional: 0 };
const TILLAGE_FUEL: Record<Tillage, number> = { NoTill: 0.75, ReducedTill: 0.88, Conventional: 1 };
const COVER_SOC: Record<CoverCrop, number> = { None: 0, CoverCrop: 45_000, CoverCropGrazed: 38_000 };
const MANURE_SOC_PER_LB_N = 180;
const NI_N2O_REDUCTION = 0.3;

export const TILLAGE_LABELS: Record<Tillage, string> = {
  NoTill: 'No-till', ReducedTill: 'Reduced till', Conventional: 'Conventional till',
};
export const COVER_LABELS: Record<CoverCrop, string> = {
  None: 'No cover crop', CoverCrop: 'Cover crop', CoverCropGrazed: 'Cover crop, grazed',
};

/** Maps a planting row's crop label ("Irrigated Corn", "Organic Soybeans", "Milo") to an FD-CIC crop, or null. */
export function fdCicCropFor(cropLabel: string): FdCicCrop | null {
  const label = cropLabel.toLowerCase();
  if (label.includes('popcorn')) return null;
  if (label.includes('corn')) return 'Corn';
  if (label.includes('soy')) return 'Soybean';
  if (label.includes('sorghum') || label.includes('milo')) return 'Sorghum';
  if (label.includes('canola')) return 'Canola';
  return null;
}

export function nationalAverage(crop: FdCicCrop): number {
  const n = NATIONAL[crop];
  return n.nFert + n.directN2O + n.indirectN2O + n.dieselGas + n.energyOther + n.chemicals + n.urea + n.lime;
}

/** The inputs a season still needs before it can be scored, in form order. */
export function missingInputs(season: Pick<FieldSeason, 'acres' | 'expectedYield' | 'syntheticN' | 'tillage' | 'coverCrop'>): string[] {
  const missing: string[] = [];
  if (!season.acres || season.acres <= 0) missing.push('acres');
  if (!season.expectedYield || season.expectedYield <= 0) missing.push('expected yield');
  if (season.syntheticN === null || season.syntheticN < 0) missing.push('nitrogen rate');
  if (!season.tillage) missing.push('tillage');
  if (!season.coverCrop) missing.push('cover crop');
  return missing;
}

/** FD-CIC clamps the yield used to 80–120% of expected. Before harvest, actual = expected. */
export function yieldUsed(expected: number, actual: number | null): number {
  const raw = actual ?? expected;
  return Math.min(Math.max(raw, expected * 0.8), expected * 1.2);
}

export function seasonStatus(season: ScorableSeason): SeasonStatus {
  if (season.status === 'Final') return 'Final';
  return missingInputs(season).length === 0 ? 'Projected' : 'Draft';
}

type ScoredInputs = Pick<FieldSeason, 'expectedYield' | 'actualYield' | 'syntheticN' | 'niFraction' | 'tillage' | 'coverCrop' | 'manure'>;

/** Just the season fields scoring reads, so any season shape with them can be scored. */
export type ScorableSeason = ScoredInputs & Pick<FieldSeason, 'acres' | 'status'>;

function components(crop: FdCicCrop, s: ScoredInputs): CiComponent[] {
  const n = NATIONAL[crop];
  const y = yieldUsed(s.expectedYield!, s.actualYield);
  const nRatio = (s.syntheticN! / y) / n.nThreshold;
  const manureN = s.manure.reduce((sum, m) => sum + (m.amount ?? 0) * (m.nContent ?? 0), 0);
  // Soybean N2O is mostly residue and fixation, so it barely tracks synthetic N.
  const n2oNSensitivity = crop === 'Soybean' ? 0.1 : 0.6;
  const n2o = (n.directN2O + n.indirectN2O)
    * (1 - n2oNSensitivity + n2oNSensitivity * nRatio)
    * (1 - NI_N2O_REDUCTION * s.niFraction);
  const socPerAcre = TILLAGE_SOC[s.tillage!] + COVER_SOC[s.coverCrop!] + manureN * MANURE_SOC_PER_LB_N;
  return [
    { key: 'nFertilizer', label: 'Nitrogen fertilizer', value: n.nFert * nRatio },
    { key: 'n2o', label: 'Field N₂O emissions', value: n2o },
    { key: 'energy', label: 'On-farm energy', value: n.dieselGas * TILLAGE_FUEL[s.tillage!] + n.energyOther },
    { key: 'chemicals', label: 'Other chemicals', value: n.chemicals },
    { key: 'ureaLime', label: 'Urea & lime', value: n.urea * nRatio + n.lime },
    { key: 'soilCarbon', label: 'Soil carbon (credit)', value: -socPerAcre / y },
  ];
}

const total = (cs: CiComponent[]) => cs.reduce((sum, c) => sum + c.value, 0);

/** Illustrative CI for one field season, or null while required inputs are missing. */
export function estimateCi(crop: FdCicCrop, season: ScorableSeason): CiResult | null {
  if (missingInputs(season).length > 0) return null;
  const cs = components(crop, season);
  const ci = total(cs);
  const national = nationalAverage(crop);

  // Each practice's effect, measured against the same field with the conventional choice.
  const reasons: CiReason[] = [];
  const effect = (label: string, baseline: Partial<ScoredInputs>) => {
    const delta = ci - total(components(crop, { ...season, ...baseline }));
    if (Math.abs(delta) >= 1) reasons.push({ label, delta });
  };
  if (season.tillage !== 'Conventional') effect(TILLAGE_LABELS[season.tillage!], { tillage: 'Conventional' });
  if (season.coverCrop !== 'None') effect(COVER_LABELS[season.coverCrop!], { coverCrop: 'None' });
  if (season.niFraction > 0) effect('Nitrification inhibitor', { niFraction: 0 });
  if (season.manure.length > 0) effect('Manure', { manure: [] });
  const y = yieldUsed(season.expectedYield!, season.actualYield);
  effect('Nitrogen rate vs. national', { syntheticN: NATIONAL[crop].nThreshold * y });
  reasons.sort((a, b) => a.delta - b.delta);

  return { crop, ciGPerBu: ci, nationalAverage: national, vsNational: ci / national - 1, components: cs, reasons, yieldUsed: y };
}

/**
 * The producer's crop-year CI for one intention: bushel-weighted across scored fields, with the
 * intention's unassigned acres counted at the national average (so partial coverage never flatters
 * the score). Unassigned bushels use the scored fields' average yield.
 */
export function summarizeIntention(
  crop: FdCicCrop,
  intention: { id: number; acres: number },
  seasons: ScorableSeason[],
): IntentionCiSummary {
  const assignedAcres = seasons.reduce((sum, s) => sum + (s.acres ?? 0), 0);
  const scored = seasons
    .map(s => ({ s, r: estimateCi(crop, s) }))
    .filter((x): x is { s: ScorableSeason; r: CiResult } => x.r !== null);

  let status: IntentionCiSummary['status'] = 'NotStarted';
  if (seasons.length > 0) {
    const statuses = seasons.map(seasonStatus);
    status = statuses.every(st => st === 'Final') ? 'Final'
      : statuses.some(st => st === 'Draft') ? 'Draft' : 'Projected';
  }

  if (scored.length === 0) {
    return { plantingIntentionId: intention.id, fieldCount: seasons.length, assignedAcres, intentionAcres: intention.acres, ciGPerBu: null, vsNational: null, status };
  }

  const national = nationalAverage(crop);
  const scoredBu = scored.reduce((sum, x) => sum + x.s.acres! * x.r.yieldUsed, 0);
  const scoredAcres = scored.reduce((sum, x) => sum + x.s.acres!, 0);
  const weighted = scored.reduce((sum, x) => sum + x.r.ciGPerBu * x.s.acres! * x.r.yieldUsed, 0);
  const unassignedBu = Math.max(intention.acres - scoredAcres, 0) * (scoredBu / scoredAcres);
  const ci = (weighted + national * unassignedBu) / (scoredBu + unassignedBu);

  return {
    plantingIntentionId: intention.id, fieldCount: seasons.length, assignedAcres, intentionAcres: intention.acres,
    ciGPerBu: ci, vsNational: ci / national - 1, status,
  };
}
