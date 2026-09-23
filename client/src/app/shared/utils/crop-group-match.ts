import { Commodity } from '@models';

/**
 * Single source of truth for matching a commodity CODE, NAME, or GROUP STRING against a set of
 * crop-group refine chips (Build-A-List's "Wheat" / "Soybeans" / … buttons, and the equivalent
 * `crops` refine filter on saved lists / the home page).
 *
 * The chip generator (`availableCrops()` in build-list.component.ts) and the matcher below MUST
 * use the SAME resolver — otherwise a chip can be generated for a group that its own matcher then
 * fails to recognize, which is exactly how the commodity refine chip stopped filtering for real
 * TU-scoped codes like WHTO, SRWW, and DNGS (they resolve to Wheat/Soybeans via `Commodity.category`
 * but the old alias-only matcher had no entry for them).
 *
 * Three independent things can leave a code unresolvable via `Commodity.category` alone, so
 * `CROP_GROUP_BY_TOKEN` stays a REAL fallback tier, not legacy cruft:
 *   - a code that only ever appears on TICKETS (never a contract) syncs with a null `Category`
 *     (`CommodityRepository.SyncAsync` derives Category from `Contracts.CommodityGroup`);
 *   - `GET /api/commodities` only serves ACTIVE rows, so a retired code on a historical
 *     contract/ticket isn't in the table at all;
 *   - a saved list may have stored a raw code (`crops: ['YSB']`) from before chips existed.
 */

/** Canonical crop-group vocabulary (lowercased keys and values) — the token seeds for the
 *  fallback tier. Not exhaustive; verify against real `dbo.Commodities` / `ProductCode` values
 *  before adding a crop whose codes aren't listed here. */
export const CROP_CODE_MAP: Readonly<Record<string, readonly string[]>> = {
  wheat:     ['wheat', 'hrww', 'srww', 'sww', 'hww', 'hadw', 'dnsw', 'cwrs', 'fdwt', 'hrwo', 'whto', 'whfg'],
  corn:      ['corn', 'yc', 'yco', 'ycng', 'ckyc', 'ycck', 'dmgc'],
  soybeans:  ['soybean', 'beans', 'sb', 'ysb', 'nysb', 'ysbo', 'dngs', 'dosb'],
  sorghum:   ['sorghum', 'milo', 'sor', 'soro', 'csor', 'ro98'],
  canola:    ['canola', 'canp', 'casm'],
  barley:    ['barley', 'bly', 'fbau', 'base', 'blys', 'blyf'],
  oats:      ['oat', 'oats'],
  sunflower: ['sunfl', 'sunflower'],
} as const;

/** Crop groups that should be OFFERED as a "Crops" refine chip (lowercased). `dbo.Commodities`
 *  is a company-wide commodity master shared across Scoular's other business lines, not just
 *  Origination's grain producers — it has ~90 Category values, and all but a handful (marine
 *  protein, animal feed ingredients, freight, "Processed Co-Product" — 972 codes covering custom
 *  feed blends — etc.) are irrelevant field crops. A producer's commodity CSV can legitimately
 *  include a code under one of those categories, and without this allowlist availableCrops()
 *  surfaced the category verbatim as a chip, which read as "why is Processed Co-Product a crop?"
 *  Deliberately narrower than CROP_CODE_MAP's keys (no oats/sunflower) — this only gates what's
 *  OFFERED as a chip; matching (resolveCropGroup/matchesCropSelection) stays unrestricted so an
 *  older saved list that stored a now-excluded group still filters the same as it always did. */
export const CROP_CHIP_GROUPS: ReadonlySet<string> = new Set([
  'corn', 'soybeans', 'wheat', 'barley', 'sorghum', 'canola',
]);

/** Reverse index: any token from CROP_CODE_MAP (plus each group name itself, and the
 *  'soybean'/'beans' singular/plural variants) → its canonical group. */
export const CROP_GROUP_BY_TOKEN: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [group, tokens] of Object.entries(CROP_CODE_MAP)) {
    map.set(group, group);
    for (const token of tokens) map.set(token, group);
  }
  map.set('soybean', 'soybeans');
  return map;
})();

export interface CropGroupLookup {
  /** code|name (lowered) → canonical group (lowered). Populated ONLY from a non-blank
   *  `Commodity.category` — never falls back to the code/name itself, so a null-category code
   *  falls through to CROP_GROUP_BY_TOKEN instead of silently becoming its own one-member group. */
  readonly groupByKey: ReadonlyMap<string, string>;
  /** group (lowered) → its member codes/names, for callers that need the reverse direction. */
  readonly keysByGroup: ReadonlyMap<string, ReadonlySet<string>>;
  /** group (lowered) → a display label (the first non-blank category spelling seen for it). */
  readonly labelByGroup: ReadonlyMap<string, string>;
  /** Every commodity CODE (lowered). Lets buildCropSelection tell a code chip ("yc") from a group
   *  chip ("corn") — a code chip filters to that one code instead of widening to its whole group. */
  readonly codes: ReadonlySet<string>;
  /** Commodity NAME (lowered) → its code (lowered), so a code chip still matches data carrying the
   *  description ("yellow corn") rather than the code. */
  readonly codeByName: ReadonlyMap<string, string>;
  /** Every active code/name (lowered), longest first — for free-text term detection. */
  readonly terms: readonly string[];
}

const EMPTY_LOOKUP: CropGroupLookup = {
  groupByKey: new Map(),
  keysByGroup: new Map(),
  labelByGroup: new Map(),
  codes: new Set(),
  codeByName: new Map(),
  terms: [],
};

/** Builds the code/name → group lookup from the Commodities table. Pure — safe to call inside a
 *  computed(); callers should memoize (don't rebuild per row inside a filter predicate). */
export function buildCropGroupLookup(commodities: readonly Commodity[] | null | undefined): CropGroupLookup {
  if (!commodities || commodities.length === 0) return EMPTY_LOOKUP;

  const groupByKey = new Map<string, string>();
  const keysByGroup = new Map<string, Set<string>>();
  const labelByGroup = new Map<string, string>();
  const codes = new Set<string>();
  const codeByName = new Map<string, string>();
  const terms = new Set<string>();

  for (const c of commodities) {
    const code = (c.code || '').trim().toLowerCase();
    const name = (c.name || '').trim().toLowerCase();
    const category = (c.category || '').trim();
    if (code) terms.add(code);
    if (name) terms.add(name);
    // Recorded before the category guard: a code chip is precise and needs no group to work.
    if (code) codes.add(code);
    if (code && name) codeByName.set(name, code);
    if (!category) continue; // no group to record — falls through to the token map at match time

    const group = category.toLowerCase();
    if (code) groupByKey.set(code, group);
    if (name) groupByKey.set(name, group);
    if (!keysByGroup.has(group)) keysByGroup.set(group, new Set());
    if (code) keysByGroup.get(group)!.add(code);
    if (name) keysByGroup.get(group)!.add(name);
    if (!labelByGroup.has(group)) labelByGroup.set(group, category);
  }

  return {
    groupByKey,
    keysByGroup,
    labelByGroup,
    codes,
    codeByName,
    terms: [...terms].sort((a, b) => b.length - a.length),
  };
}

/** Resolves a commodity code / name / group string to its canonical crop group (lowercased), or
 *  null if it can't be resolved by either the Commodities table or the static token map. */
export function resolveCropGroup(value: string | null | undefined, lookup?: CropGroupLookup | null): string | null {
  const v = (value || '').trim().toLowerCase();
  if (!v) return null;
  const fromTable = lookup?.groupByKey.get(v);
  if (fromTable) return fromTable;
  return CROP_GROUP_BY_TOKEN.get(v) ?? null;
}

export interface CropSelection {
  /** Chips recognised as commodity CODES (lowered) — matched EXACTLY, never widened to their group,
   *  so picking HRWW returns hard red winter wheat and not every wheat code. */
  readonly codes: ReadonlySet<string>;
  /** The groups those code chips belong to (lowered). Used only to match data that records a crop
   *  at GROUP level with no code to be precise about — see matchesCropSelection's `groupOnlyValue`. */
  readonly codeGroups: ReadonlySet<string>;
  /** The selected chips, resolved to canonical groups (lowered). */
  readonly groups: ReadonlySet<string>;
  /** The chip strings exactly as stored/selected (lowered) — covers a saved list holding a raw
   *  code or a value absent from every lookup. */
  readonly literals: ReadonlySet<string>;
  /** Every CROP_CODE_MAP token reachable from any selected chip (via group or literal), for the
   *  bounded-containment fallback tier. */
  readonly tokens: ReadonlySet<string>;
  readonly isEmpty: boolean;
}

/** Precompute once per filter pass (e.g. once per `displayedCustomers()` recomputation) — never
 *  call per row inside a predicate. */
export function buildCropSelection(
  chips: readonly string[] | null | undefined,
  lookup?: CropGroupLookup | null
): CropSelection {
  const codes = new Set<string>();
  const codeGroups = new Set<string>();
  const groups = new Set<string>();
  const literals = new Set<string>();
  const tokens = new Set<string>();
  for (const raw of chips ?? []) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    literals.add(v);
    // A chip that IS a commodity code stays precise: no group, no tokens. Widening it would make
    // every code in a group return identical results, which is the whole reason to show codes.
    // (Group chips — what saved lists stored before codes existed — keep the old behaviour.)
    if (lookup?.codes.has(v)) {
      codes.add(v);
      const codeGroup = resolveCropGroup(v, lookup);
      if (codeGroup) codeGroups.add(codeGroup);
      continue;
    }
    const group = resolveCropGroup(v, lookup);
    if (group) {
      groups.add(group);
      for (const token of CROP_CODE_MAP[group] ?? []) tokens.add(token);
      tokens.add(group);
    } else {
      tokens.add(v);
    }
  }
  return {
    codes,
    codeGroups,
    groups,
    literals,
    tokens,
    isEmpty: groups.size === 0 && literals.size === 0,
  };
}

export interface MatchCropOptions {
  /** Set ONLY for a field whose value may be a crop GROUP with no code recorded alongside it (grain-on-farm
   *  rows saved before 2026-09-23). Lets a precise code chip still match those rows via its own group;
   *  harmless for a code value, which never equals its own group. */
  readonly groupOnlyValue?: boolean;
}

/** Does one data value (a commodity code, name, description, or group string) satisfy the
 *  selection? Tiered, in order:
 *   1. empty selection → match all (preserves "no crop filter selected" behavior).
 *   2. blank value → no match (a contract/ticket/etc. with no commodity recorded can't satisfy
 *      a crop filter — the old bidirectional-substring matcher treated `''` as matching anything).
 *   3. exact literal match against a selected chip — covers saved lists holding a raw code and
 *      values absent from every lookup.
 *   4. resolve BOTH sides to a crop group and compare — the main path (WHTO → wheat, chip
 *      "Wheat" → wheat).
 *   5. bounded token containment (length >= 4 only) — catches free-text values like
 *      "HRW WHEAT 11.5PRO" without the old matcher's false positives ("BE" matching "beans",
 *      "OR" matching "corn" via the alias table). */
export function matchesCropSelection(
  value: string | null | undefined,
  sel: CropSelection,
  lookup?: CropGroupLookup | null,
  opts?: MatchCropOptions
): boolean {
  if (sel.isEmpty) return true;
  const v = (value || '').trim().toLowerCase();
  if (!v) return false;
  if (sel.literals.has(v)) return true;

  // Code chips: exact on the code, or on the commodity name that code belongs to.
  if (sel.codes.size > 0) {
    const codeForName = lookup?.codeByName.get(v);
    if (codeForName && sel.codes.has(codeForName)) return true;
    // Only for a field that may record the crop as a GROUP and nothing finer (legacy grain-on-farm rows
    // hold "Corn"; newer ones hold "YC"). There is no code-level detail on a group row to be precise
    // about, so a code chip matches its own group. `valueGroup === v` keeps code rows exact. A code chip
    // must never match a sibling code this way. Never enable it on the GROUP field of a record that also has a
    // separate code field (a contract's commodityGroup) — it would let a
    // HRWW chip match an SRWW contract through its shared "Wheat" group.
    if (opts?.groupOnlyValue) {
      const valueGroup = resolveCropGroup(v, lookup);
      if (valueGroup && valueGroup === v && sel.codeGroups.has(valueGroup)) return true;
    }
  }

  const group = resolveCropGroup(v, lookup);
  if (group && sel.groups.has(group)) return true;
  for (const token of sel.tokens) {
    if (token.length < 4) continue;
    if (v.includes(token) || (v.length >= 4 && token.includes(v))) return true;
  }
  return false;
}
