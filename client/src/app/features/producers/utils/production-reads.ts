import type { Contract, DashboardPlantingEstimate, PlantingIntention } from '@models';

// ── Merging reads ───────────────────────────────────────────────────────────

/** Incoming rows first; existing rows kept only when the incoming set has no row with their id. Used
 *  where a trade-unit-wide read and a per-producer read write the same signal, so a late wide
 *  response does not drop rows already loaded for the selected producer. */
export function mergeIncomingById<T extends { id: unknown }>(incoming: T[], existing: T[]): T[] {
  const seen = new Set(incoming.map(s => s.id));
  return [...incoming, ...existing.filter(s => !seen.has(s.id))];
}

// ── Yield estimates ─────────────────────────────────────────────────────────

/** Every planting year the user might pick: this year, last year, and any year an intention or a
 *  contract carries. */
export function yieldEstimateYears(currentYear: number, intentions: PlantingIntention[], contracts: Contract[]): number[] {
  const yearSet = new Set<number>();
  yearSet.add(currentYear);
  yearSet.add(currentYear - 1);
  for (const pi of intentions) {
    if (pi.plantingYear) yearSet.add(pi.plantingYear);
  }
  for (const c of contracts) {
    if (c.cropYear) yearSet.add(c.cropYear);
  }
  return [...yearSet];
}

/** Merges per-year estimate batches, one estimate per crop + year; a later batch wins a tie. */
export function mergeYieldEstimates(batches: DashboardPlantingEstimate[][]): DashboardPlantingEstimate[] {
  const map = new Map<string, DashboardPlantingEstimate>();
  for (const batch of batches) {
    for (const est of batch) {
      // Key by crop + year to keep per-year estimates separate
      map.set(`${est.crop}|${est.plantingYear}`, est);
    }
  }
  return [...map.values()];
}
