import { CROP_CODE_MAP } from './crop-group-match';

/** The search words for a crop plus every commodity code Build a List knows for it (CROP_CODE_MAP),
 *  so the two lists cannot drift apart again. The codes matter most on the Tickets table, whose
 *  search sees only the product code: "wheat" used to miss SRWW, SWW, HADW, DNSW, CWRS, FDWT, WHTO
 *  and WHFG tickets, "corn" missed DMGC, "beans" missed DNGS and "milo" missed RO98. Words first,
 *  then codes, deduplicated. */
function withCodes(words: string[], group: keyof typeof CROP_CODE_MAP): string[] {
  return [...new Set([...words, ...CROP_CODE_MAP[group]])];
}

const SORGHUM = withCodes(['milo', 'sorghum', 'sor', 'sg'], 'sorghum');
const SOYBEANS = withCodes(['beans', 'soybeans', 'soy', 'sb'], 'soybeans');
const CORN = withCodes(['yc', 'corn', 'yellow corn'], 'corn');
const WHEAT = withCodes(['wheat', 'hrw', 'hw', 'hard red winter'], 'wheat');

/**
 * Canonical commodity alias map for the table and Insights searches.
 * When a user types "milo", search results should also include "sorghum" (and vice versa).
 *
 * Each key maps to the full set of terms that should be treated as equivalent.
 * All keys and values are lowercase. Consumers should lowercase their input before lookup.
 *
 * Barley, canola, oats and sunflower are deliberately absent: their codes (BASE, BLY, OAT...) are
 * short enough to match unrelated text, and the Insights search also matches producer names.
 * The hard-red-winter keys stay specific to that class rather than expanding to every wheat.
 */
export const COMMODITY_ALIAS_MAP: Record<string, string[]> = {
  // Milo / Sorghum
  'milo':        SORGHUM,
  'sorghum':     SORGHUM,
  'sor':         SORGHUM,
  'sg':          SORGHUM,
  // Soybeans
  'beans':       SOYBEANS,
  'soybeans':    SOYBEANS,
  'soy':         SOYBEANS,
  'sb':          SOYBEANS,
  // Corn
  'yc':          CORN,
  'corn':        CORN,
  'yellow corn': CORN,
  // Wheat
  'hrw':         ['hrw', 'wheat', 'hard red winter', 'hw'],
  'hw':          ['hw', 'wheat', 'hrw'],
  'wheat':       WHEAT,
  'hard red winter': ['hrw', 'wheat', 'hard red winter', 'hw'],
};

/**
 * Expand a single search term into all its aliases (exact key match).
 * E.g. "milo" → ["milo", "sorghum", "sor", "sg"]
 * Non-aliased terms return as a single-element array: "canola" → ["canola"]
 */
export function expandCommodityAliases(term: string): string[] {
  return COMMODITY_ALIAS_MAP[term.toLowerCase().trim()] ?? [term.toLowerCase().trim()];
}

/**
 * Expand a search query with alias support + prefix matching.
 * Handles both exact alias hits ("milo" → sorghum terms) and partial prefixes
 * ("mi" → matches "milo" key → expands to sorghum terms).
 * Returns a deduplicated set of all terms to search for.
 */
export function expandSearchWithAliases(query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [q];
  // Exact alias hit
  if (COMMODITY_ALIAS_MAP[q]) return COMMODITY_ALIAS_MAP[q];
  // Prefix match — "mi" matches "milo" key and expands
  const expanded = new Set<string>([q]);
  for (const [key, terms] of Object.entries(COMMODITY_ALIAS_MAP)) {
    if (key.startsWith(q)) terms.forEach(t => expanded.add(t));
  }
  return [...expanded];
}
