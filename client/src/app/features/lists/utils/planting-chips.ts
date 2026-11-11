/**
 * Planting-intention chips for Build-A-List results — the per-crop "Irrigated YC · 1,200 ac · 2026"
 * badges shown inline next to a producer's location, mirroring the Storage / Grain-on-Farm chips.
 *
 * Planting rows carry no location of their own (see ProducerPlantingIntentions) — the location on
 * the result row is the producer's. What a chip adds is the crop, how many acres, and which year.
 *
 * The irrigation-type predicates live here too so the row and the refine-panel filters that share
 * them (`irrigatedOnly` / `drylandOnly` / `doubleCropOnly`) can't drift apart. `type` is free text
 * in the DB, hence the substring matching.
 */
import { PlantingIntention } from '@models';

/** One chip on a Planting result row. */
export interface PlantingChip {
  /** "[Type ]CROP" — e.g. "Irrigated YC", or just "YC" when no type is recorded. */
  label: string;
  acres: number;
  year: number;
  /** Crop name used to pick the shared per-crop chip color (see commodity-color.ts). */
  colorKey: string;
}

/** The refine panel's planting-type toggles. */
export interface PlantingTypeFilters {
  irrigatedOnly?: boolean;
  drylandOnly?: boolean;
  doubleCropOnly?: boolean;
}

export function isIrrigated(type: string | null | undefined): boolean {
  return (type ?? '').toLowerCase().includes('irrigat');
}

export function isDryland(type: string | null | undefined): boolean {
  const t = (type ?? '').toLowerCase();
  return t.includes('dryland') || t.includes('dry land');
}

export function isDoubleCrop(type: string | null | undefined): boolean {
  return (type ?? '').toLowerCase().includes('double crop');
}

/**
 * Whether an intention survives the active type toggles. Enabled toggles OR together: with both
 * "Irrigated" and "Dryland" on, a qualifying producer holds both kinds and should show both.
 * No toggles on → everything passes.
 */
export function matchesPlantingTypes(type: string | null | undefined, f: PlantingTypeFilters): boolean {
  const active: Array<(t: string | null | undefined) => boolean> = [];
  if (f.irrigatedOnly) active.push(isIrrigated);
  if (f.drylandOnly) active.push(isDryland);
  if (f.doubleCropOnly) active.push(isDoubleCrop);
  return active.length === 0 || active.some(p => p(type));
}

/**
 * The season and irrigation type a Planting *prompt* asks about — "Producers with 2025 planting
 * intentions" scopes to 2025, "irrigated corn producers" to irrigated.
 *
 * The NLQ engine narrows producers by these but hands back only `Customer[]`, so the result row has
 * to re-derive them; otherwise a 2025 prompt would show each producer's latest year (2026) instead
 * of the season asked for. Kept here so the row and `applyPlantingFilters` read the prompt the same
 * way — only what the NLQ engine actually filters on belongs in here, or rows could show no chips
 * for a producer that legitimately matched.
 */
export function plantingQueryScope(query: string | null | undefined): { year: number | null } & PlantingTypeFilters {
  const q = (query ?? '').toLowerCase();
  // "2025 planting intentions" | "planting for 2026" | "planting intentions for 2026" | "planted in 2024".
  // The year must follow an explicit "in"/"for" (or precede "planting") and look like a season, so
  // quantities such as "planting acres over 2000" aren't read as years.
  const year = q.match(/(20\d{2})\s*plant/)?.[1]
    ?? q.match(/plant\w*(?:\s+\w+){0,3}\s+(?:in|for)\s+(20\d{2})/)?.[1];
  return {
    year: year ? parseInt(year, 10) : null,
    irrigatedOnly: q.includes('irrigated'),
    drylandOnly: q.includes('dryland') || q.includes('dry land'),
  };
}

/**
 * Build the chips for ONE producer's planting intentions.
 *
 * Year scope: the `year` the prompt or refine panel asked about when there is one, otherwise only the
 * producer's most recent year on file — a producer can carry several seasons and the row would
 * otherwise run long.
 *
 * Intentions are aggregated by type + crop + year, since the same crop can be recorded once per
 * trade unit. `categoryByKey` maps a lower-cased commodity code OR name to its crop category
 * ("yc" → "Corn"); resolving through it keeps a chip's color aligned with the rest of the app,
 * because `PlantingIntention.category` may hold a tier value ("White Corn") that the shared
 * palette doesn't know.
 */
export function plantingChips(
  intentions: PlantingIntention[],
  opts: { year?: number | null } & PlantingTypeFilters,
  categoryByKey: Map<string, string>,
): PlantingChip[] {
  const typed = intentions.filter(p => matchesPlantingTypes(p.type, opts));

  let scoped: PlantingIntention[];
  if (opts.year) {
    scoped = typed.filter(p => p.plantingYear === opts.year);
  } else {
    const latest = typed.reduce((max, p) => Math.max(max, p.plantingYear || 0), 0);
    scoped = latest ? typed.filter(p => p.plantingYear === latest) : [];
  }

  const byKey = new Map<string, PlantingChip>();
  for (const p of scoped) {
    const crop = (p.crop || '').trim();
    const acres = p.acres ?? 0;
    if (!crop || acres <= 0) continue;

    const type = (p.type || '').trim();
    const key = `${type.toLowerCase()}|${crop.toLowerCase()}|${p.plantingYear}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.acres += acres;
      continue;
    }
    byKey.set(key, {
      label: type ? `${type} ${crop}` : crop,
      acres,
      year: p.plantingYear,
      colorKey: categoryByKey.get(crop.toLowerCase()) ?? ((p.category || '').trim() || crop),
    });
  }

  return [...byKey.values()].sort((a, b) => b.year - a.year || b.acres - a.acres);
}
