/**
 * Canonical commodity alias map — single source of truth for crop name synonyms.
 * When a user types "milo", search results should also include "sorghum" (and vice versa).
 *
 * Each key maps to the full set of terms that should be treated as equivalent.
 * All keys and values are lowercase. Consumers should lowercase their input before lookup.
 */
export const COMMODITY_ALIAS_MAP: Record<string, string[]> = {
  // Milo / Sorghum
  'milo':        ['milo', 'sorghum', 'sor', 'sg'],
  'sorghum':     ['milo', 'sorghum', 'sor', 'sg'],
  'sor':         ['milo', 'sorghum', 'sor', 'sg'],
  'sg':          ['milo', 'sorghum', 'sor', 'sg'],
  // Soybeans
  'beans':       ['beans', 'soybeans', 'soy', 'sb'],
  'soybeans':    ['beans', 'soybeans', 'soy', 'sb'],
  'soy':         ['beans', 'soybeans', 'soy', 'sb'],
  'sb':          ['beans', 'soybeans', 'soy', 'sb'],
  // Corn
  'yc':          ['yc', 'corn', 'yellow corn'],
  'corn':        ['yc', 'corn', 'yellow corn'],
  'yellow corn': ['yc', 'corn', 'yellow corn'],
  // Wheat
  'hrw':         ['hrw', 'wheat', 'hard red winter', 'hw'],
  'hw':          ['hw', 'wheat', 'hrw'],
  'wheat':       ['wheat', 'hrw', 'hw', 'hard red winter'],
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
