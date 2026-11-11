/**
 * Does a planting-intention row belong to the trade units the dashboard is showing?
 *
 * Each row is tagged with the trade unit the originator recorded it for, because a producer on
 * several trade units plants different acres for each. The dashboard counts a row only under its
 * own trade unit, so Pratt's soybeans no longer appear on Tribune's dashboard.
 *
 * Two deliberate fall-throughs:
 *  - No trade units in scope (e.g. "All Producers"): nothing is filtered out here.
 *  - A row with a blank tag (legacy data): counts wherever its producer is loaded, which is the
 *    pre-fix behaviour. Callers keep their producer-membership check alongside this one.
 *
 * A row tagged to a trade unit the producer has since left is NOT special-cased: it counts under
 * no single-territory view until someone re-tags it (the edit dialog flags it). If the business
 * decides such rows should fall back to the producer's remaining trade unit instead, that rule
 * belongs here.
 */
export function inSelectedTradeUnits(row: { tradeUnit?: string | null }, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  const tradeUnit = (row.tradeUnit ?? '').trim();
  if (!tradeUnit) return true;
  return selected.has(tradeUnit);
}
