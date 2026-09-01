/**
 * Trade-group scoping for the curated commodity list.
 *
 * Most commodities are unscoped and every user sees them. A few are restricted to a single trade
 * group — today that's the four Organics & IP crops (HRWO, WHTO, YCO, YSBO), which would be pure
 * clutter in a conventional grain originator's picker. `Commodities.TradeGroupScope` in the DB
 * carries the restriction; the API serves the full curated superset so `/commodities/planting`
 * stays globally cacheable, and the filtering happens here.
 *
 * The scope value is matched as a case-insensitive SUBSTRING of the group name, so the seeded
 * "Organics" resolves against the real group "Organics & IP" and survives a rename to, say,
 * "Organics and IP". Trade-off: another group with "organic" in its name would also match —
 * correcting that is a one-row UPDATE, not a deploy.
 *
 * Trade units are a UX filter here, not an access boundary (accepted risk AR-02), and commodity
 * codes are a public crop vocabulary — so shipping the superset to the browser is fine.
 */

/** Scopes we've already warned about, so a per-keystroke filter doesn't spam the console. */
const _warnedScopes = new Set<string>();

/**
 * Drop commodities restricted to a trade group the user isn't currently working in.
 *
 * @param commodities  The list to filter — safe to pass the curated list or the full catalog.
 * @param inScopeGroupNames  Group names currently in play, from AppStateService.inScopeGroupNames.
 */
export function scopeCommodities<T extends { tradeGroupScope?: string | null }>(
  commodities: T[],
  inScopeGroupNames: readonly string[]
): T[] {
  // Nothing scoped in the list? Skip the work entirely — this is the common case.
  if (!commodities.some(c => c.tradeGroupScope?.trim())) return commodities;

  const groups = inScopeGroupNames.map(g => g.toLowerCase());
  return commodities.filter(c => {
    const scope = c.tradeGroupScope?.trim().toLowerCase();
    if (!scope) return true;
    const matched = groups.some(g => g.includes(scope));
    // A scope that matches none of the user's groups is invisible by design, but it's also what a
    // typo or an upstream group rename looks like. Say so once so it's diagnosable.
    if (!matched && !_warnedScopes.has(scope)) {
      _warnedScopes.add(scope);
      console.warn(
        `[CommodityScope] No trade group matches "${c.tradeGroupScope}" — commodities scoped to it stay hidden.`,
        { inScopeGroupNames }
      );
    }
    return matched;
  });
}
