/**
 * Trade-group and trade-unit scoping for the curated commodity list.
 *
 * Most commodities are unscoped and every user sees them. A few are restricted:
 *   - by trade GROUP  — the Organics & IP crops (HRWO, WHTO, YCO, YSBO)
 *   - by trade UNIT   — specialty soy/corn grades for 2090/2291/2295 (DNGS, DOSB, HEC, YWC)
 *
 * Unit scoping exists because a group is too coarse: those three units are only half of
 * Organics & IP, and a group name cannot express a subset of its own units.
 *
 * `Commodities.TradeGroupScope` / `TradeUnitScope` carry the restrictions. The API serves the full
 * curated superset so `/commodities/planting` stays globally cacheable, and filtering happens here.
 *
 * The two rules match DIFFERENTLY, on purpose:
 *   - Group scope is a case-insensitive SUBSTRING of the group name, so the seeded "Organics"
 *     resolves against "Organics & IP" and survives a rename.
 *   - Unit scope is EXACT membership after splitting on commas. Substring matching on numeric codes
 *     would be actively wrong — "209" would match 2090, 2093 and 2094.
 *
 * They combine with OR: a row shows when it is unscoped, or its group matches, or one of its units
 * is in scope. That keeps every scope additive rather than intersecting.
 *
 * Trade units are a UX filter here, not an access boundary (accepted risk AR-02), and commodity
 * codes are a public crop vocabulary — so shipping the superset to the browser is fine.
 */

/** What the user currently has in play, from AppStateService. */
export interface CommodityScopeContext {
  /** Group names in scope — see AppStateService.inScopeGroupNames. */
  groupNames: readonly string[];
  /** Trade unit codes in scope — see AppStateService.inScopeTradeUnitCodes. */
  tradeUnitCodes: readonly string[];
}

/** Scopes we've already warned about, so a per-keystroke filter doesn't spam the console. */
const _warnedScopes = new Set<string>();

/** True when the row carries no restriction at all. */
function isUnscoped(groupScope?: string | null, unitScope?: string | null): boolean {
  return !groupScope?.trim() && !unitScope?.trim();
}

/**
 * Drop commodities restricted to a trade group or trade unit the user isn't currently working in.
 *
 * @param commodities  The list to filter — safe to pass the curated list or the full catalog.
 * @param scope        Group names and unit codes currently in play.
 */
export function scopeCommodities<T extends { tradeGroupScope?: string | null; tradeUnitScope?: string | null }>(
  commodities: T[],
  scope: CommodityScopeContext
): T[] {
  // Nothing scoped in the list? Skip the work entirely — this is the common case.
  if (!commodities.some(c => c.tradeGroupScope?.trim() || c.tradeUnitScope?.trim())) return commodities;

  const groups = scope.groupNames.map(g => g.toLowerCase());
  const units = new Set(scope.tradeUnitCodes.map(u => u.trim()));

  return commodities.filter(c => {
    const groupScope = c.tradeGroupScope?.trim().toLowerCase();
    const unitScope = c.tradeUnitScope?.trim();
    if (isUnscoped(c.tradeGroupScope, c.tradeUnitScope)) return true;

    // Substring for group names, exact membership for unit codes. OR across both.
    const groupMatched = !!groupScope && groups.some(g => g.includes(groupScope));
    const unitMatched = !!unitScope
      && unitScope.split(',').map(u => u.trim()).filter(Boolean).some(u => units.has(u));
    if (groupMatched || unitMatched) return true;

    // A scope matching nothing is invisible by design, but that is also what a typo or an upstream
    // group rename looks like. Say so once so it is diagnosable.
    const key = `${groupScope ?? ''}|${unitScope ?? ''}`;
    if (!_warnedScopes.has(key)) {
      _warnedScopes.add(key);
      console.warn(
        `[CommodityScope] Nothing in scope matches group "${c.tradeGroupScope ?? '-'}" / units "${c.tradeUnitScope ?? '-'}" — commodities scoped to it stay hidden.`,
        { groupNames: scope.groupNames, tradeUnitCodes: scope.tradeUnitCodes }
      );
    }
    return false;
  });
}
