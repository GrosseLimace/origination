/**
 * Grain on Farm is recorded per commodity CODE — the same values the producer's Commodities chips
 * show (YC, HRWW, YSBO) — so a producer can hold HRWW and SRWW as two rows with their own bushels,
 * grade and target instead of one blended "Wheat".
 *
 * Legacy rows: before 2026-09-23 a row held a crop GROUP ("Corn", "Wheat"). The migration renamed
 * the column but did not rewrite values, because a group cannot be mapped to one code without
 * guessing. Every reader therefore accepts either shape:
 *   - crop filters go through crop-group-match, which resolves a code AND a group name;
 *   - display shows the stored value verbatim and flags a legacy row so the user can re-pick a code.
 *
 * This file owns the add-row options for the edit dialog (the planting-intentions list, so both
 * pickers offer the same commodities) and the small display helpers the profile
 * breakdown and Build-A-List chips share, so those surfaces cannot drift apart.
 */
import { Commodity, GrainOnFarmItem, ProducerBinSiteItem } from '@models';
import { googleMapsCoordinatesUrl } from './address';
import { binSiteHasCoordinates } from './coordinates';
import { CropGroupLookup, resolveCropGroup } from './crop-group-match';

/** Build a List library category holding every grain-on-farm AND bin-site prompt (user 2026-10-09:
 *  grain on farm belongs to a bin site, so their prompts share one column). Before that the grain
 *  cards were "Grain on Farm" and the bin-site cards sat under "Producers"; the rename is migration
 *  CombineGrainOnFarmAndBinSitePrompts. */
export const GRAIN_AND_BIN_SITES_CATEGORY = 'Grain on Farm & Bin Sites';

/** The category before the rename. A saved list remembers the category of the prompt it came from
 *  (`_promptCategory`), so lists saved before then still carry it — treat it as the same thing. */
export const LEGACY_GRAIN_ON_FARM_CATEGORY = 'Grain on Farm';

export function isGrainAndBinSitesCategory(category: string | null | undefined): boolean {
  return category === GRAIN_AND_BIN_SITES_CATEGORY || category === LEGACY_GRAIN_ON_FARM_CATEGORY;
}

export interface GrainOnFarmOption {
  code: string;
  /** "YELLOW CORN (YC)" — the same shape the planting-intentions crop picker shows. */
  label: string;
}

export interface GrainOnFarmOptionInputs {
  /** The planting-intentions commodity list, already scoped to the user's trade units — the exact
   *  set the planting crop picker offers, so the two dropdowns always agree. */
  planting: readonly Commodity[];
  /** Values already present as grain-on-farm rows; excluded from the list. */
  used: readonly string[];
}

/** Case-insensitive code → commodity index. Later lists win for the same code. */
export function indexCommoditiesByCode(...lists: ReadonlyArray<readonly Commodity[]>): Map<string, Commodity> {
  const byCode = new Map<string, Commodity>();
  for (const list of lists) {
    for (const c of list) {
      const code = (c.code || '').trim().toLowerCase();
      if (code) byCode.set(code, c);
    }
  }
  return byCode;
}

/**
 * Builds the "add a commodity" dropdown: one list of every planting commodity the user's trade
 * units can see, in the planting picker's order (name, then code). Codes on the producer that are
 * NOT planting commodities (e.g. a ticket-only BLY) are deliberately not offered, matching the
 * planting picker. Pure — safe inside a computed().
 */
export function buildGrainOnFarmOptions(inputs: GrainOnFarmOptionInputs): GrainOnFarmOption[] {
  const taken = new Set(inputs.used.map(u => u.trim().toLowerCase()));
  const rows: { name: string; option: GrainOnFarmOption }[] = [];
  const seen = new Set<string>();
  for (const c of inputs.planting) {
    const code = (c.code || '').trim();
    const key = code.toLowerCase();
    if (!code || taken.has(key) || seen.has(key)) continue;
    seen.add(key);
    const name = (c.name || '').trim();
    rows.push({ name, option: { code, label: name && name.toLowerCase() !== key ? `${name} (${code})` : code } });
  }
  return rows
    .sort((a, b) => a.name.localeCompare(b.name) || a.option.code.localeCompare(b.option.code))
    .map(r => r.option);
}

/** True when a stored value is a known commodity code. */
export function isGrainOnFarmCode(value: string | null | undefined, byCode: ReadonlyMap<string, Commodity>): boolean {
  return byCode.has((value || '').trim().toLowerCase());
}

/**
 * True when a stored value is a pre-2026-09-23 crop-GROUP row ("Corn", "Wheat") rather than a code.
 * Requires the value to actually BE a group name — a catalog category or a known crop group — so a
 * real code that is merely missing from the active catalog (a deactivated commodity) is never
 * mislabelled. False while the catalog has not loaded.
 */
export function isLegacyGrainGroup(
  value: string | null | undefined,
  byCode: ReadonlyMap<string, Commodity>,
  lookup?: CropGroupLookup | null,
): boolean {
  const v = (value || '').trim().toLowerCase();
  if (!v || byCode.size === 0 || byCode.has(v)) return false;
  return !!lookup?.labelByGroup.has(v) || resolveCropGroup(v, lookup) === v;
}

/**
 * Hover text for a grain-on-farm chip: the commodity name for a code, a re-pick note for a legacy
 * group row, and nothing otherwise (still loading, or a code not in the active catalog).
 */
export function grainOnFarmTitle(
  value: string | null | undefined,
  byCode: ReadonlyMap<string, Commodity>,
  lookup?: CropGroupLookup | null,
): string {
  const v = (value || '').trim();
  const c = byCode.get(v.toLowerCase());
  if (c) return c.name?.trim() || v;
  if (isLegacyGrainGroup(v, byCode, lookup)) {
    return `${v} was recorded as a crop group before Grain on Farm used commodity codes. Edit the producer to re-pick a code.`;
  }
  return '';
}

/** The key to colour a grain-on-farm chip by: the value's crop group, so YC, YCNG and a legacy
 *  "Corn" row are all corn amber. Falls back to the raw value. */
export function grainOnFarmColorKey(value: string | null | undefined, lookup?: CropGroupLookup | null): string {
  const v = (value || '').trim();
  return resolveCropGroup(v, lookup) ?? v;
}

/** One bin site's line in a bin-sites-and-grain breakdown, with the grain stored there. */
export interface BinSiteGrainGroup {
  name: string;
  capacity: number | null;
  /** Google Maps link when the site has coordinates. */
  mapUrl: string | null;
  rows: GrainOnFarmItem[];
}

/**
 * A producer's bin sites in their saved order — each with its capacity, a map link when it has
 * coordinates, and the grain rows stored there — then a "Not tied to a bin site" group for any grain
 * rows without a (current) site, saved before grain belonged to sites. A site with no grain is still
 * listed, with no rows. Used by Build a List's per-producer breakdown.
 */
export function binSiteGrainBreakdown(
  binSites: readonly ProducerBinSiteItem[] | null | undefined,
  grain: readonly GrainOnFarmItem[] | null | undefined,
): BinSiteGrainGroup[] {
  const rows = grain ?? [];
  const sites = binSites ?? [];
  const groups: BinSiteGrainGroup[] = sites.map(site => ({
    name: site.name?.trim() || 'Bin site',
    capacity: site.capacity ?? null,
    mapUrl: binSiteHasCoordinates(site) ? googleMapsCoordinatesUrl(site.latitude, site.longitude) : null,
    rows: rows.filter(g => !!site.siteKey && g.binSiteKey === site.siteKey),
  }));
  const keys = new Set(sites.map(s => s.siteKey).filter(Boolean));
  const unlinked = rows.filter(g => !g.binSiteKey || !keys.has(g.binSiteKey));
  if (unlinked.length > 0) groups.push({ name: 'Not tied to a bin site', capacity: null, mapUrl: null, rows: unlinked });
  return groups;
}

const LAST_BID_FORMAT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

/** A grain row's Last Bid for display: no "$" and no padded decimals (user 2026-10-09) — "4", "-0.35",
 *  "0.1525" — up to the four places the column stores. A dash when there is none. */
export function formatLastBid(value: number | null | undefined): string {
  return value == null ? '—' : LAST_BID_FORMAT.format(value);
}
