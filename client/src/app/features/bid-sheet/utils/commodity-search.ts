/**
 * Bid sheet Add-Location crop search.
 *
 * Pure search over the commodity list: every word of the query must appear in a commodity's code or
 * name, results are ranked (exact code, code prefix, name prefix, contains), de-duplicated by code
 * and capped. The page supplies the lists and the user's trade scope.
 */
import { Commodity } from '@models';
import { CommodityScopeContext, scopeCommodities } from '@shared/utils/commodity-scope';

/** Categories that are never a crop, so never offered. */
const EXCLUDED_COMMODITY_CATEGORIES = new Set([
  'CURRENCY', 'TRANSPORTATION', 'FEED & FERT INGREDIENTS', 'FEED &FERT INGREDIENTS'
]);

/** Most results the picker shows. */
export const MAX_COMMODITY_RESULTS = 20;

export interface CommoditySearchResult {
  code: string;
  /** "YELLOW CORN (YC)" — the name (or category when unnamed), upper-cased, with the code. */
  name: string;
}

/**
 * Searches the curated ("Planting Intentions") list, falling back to the full list when the curated
 * one is empty so the picker never goes blank. Commodities scoped to a trade group / unit the user
 * isn't in are dropped from both lists.
 */
export function searchCommodities(
  query: string, curatedList: Commodity[], fullList: Commodity[], inScope: CommodityScopeContext
): CommoditySearchResult[] {
  if (!query || query.length < 1) return [];
  // Split on whitespace so multi-word queries (e.g. "yellow corn") narrow results
  // instead of broadening them. Every word must appear somewhere in the code OR name.
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const seen = new Set<string>();
  const results: { code: string; name: string; rank: number }[] = [];
  // Search the curated Planting Intentions list; fall back to the full list if it's not loaded
  // so the picker never goes blank.
  // Drop commodities scoped to a trade group the user isn't in (organics). Applied to the
  // fallback too, or a failed curated fetch would leak them into a conventional picker.
  const curated = scopeCommodities(curatedList, inScope);
  const source = curated.length > 0 ? curated : scopeCommodities(fullList, inScope);
  for (const c of source) {
    const code = (c.code ?? '').trim();
    const cat = (c.category ?? '').trim().toUpperCase();
    const desc = (c.name ?? '').trim();
    if (!code || seen.has(code) || EXCLUDED_COMMODITY_CATEGORIES.has(cat)) continue;
    const codeLower = code.toLowerCase();
    const descLower = desc.toLowerCase();
    // AND match: every word must be in either the code or the name (category ignored)
    const allMatch = words.every(w => codeLower.includes(w) || descLower.includes(w));
    if (!allMatch) continue;
    seen.add(code);
    // Rank: exact code match (0) < code starts-with (1) < name starts-with (2) < contains (3)
    const fullQ = words.join(' ');
    let rank = 3;
    if (codeLower === fullQ) rank = 0;
    else if (codeLower.startsWith(fullQ)) rank = 1;
    else if (descLower.startsWith(fullQ)) rank = 2;
    results.push({ code, name: `${(desc || cat).toUpperCase()} (${code.toUpperCase()})`, rank });
  }
  return results
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, MAX_COMMODITY_RESULTS)
    .map(({ code, name }) => ({ code, name }));
}
