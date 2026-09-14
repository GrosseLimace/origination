import { SavedList } from '@models';

/**
 * Trade-unit visibility for saved lists.
 *
 * A saved list is stamped with the trade units selected when it was saved (a CSV on
 * `SavedList.tradeUnits`, e.g. "2090,2291"). Visibility is OVERLAP-based: the list is offered
 * whenever at least one of those trade units is in the current selection. That replaced an exact-set
 * match which hid a list saved under [A,B] from someone looking at [A,C,D] — or even at [A] alone.
 *
 * Visibility is the only thing trade units govern. Opening a list runs its query against whatever is
 * selected NOW, not against the trade units it was saved under, so the same list is reusable across
 * trade units. (Manager "Team Lists" match on overlap server-side already.)
 */
type TradeUnitScoped = Pick<SavedList, 'tradeUnits'> | null | undefined;

/** The list's trade-unit codes: trimmed, blanks dropped, de-duplicated, CSV order preserved. */
export function parseSavedListTradeUnits(list: TradeUnitScoped): string[] {
  if (!list?.tradeUnits) return [];
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const raw of list.tradeUnits.split(',')) {
    const code = raw.trim();
    if (code && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
}

/** True when the list shares at least one trade unit with `selected`. False when either side is
 *  empty — a list with no trade units is never offered, and an empty selection shows none. */
export function savedListOverlapsTradeUnits(list: TradeUnitScoped, selected: readonly string[]): boolean {
  if (selected.length === 0) return false;
  const sel = new Set(selected);
  return parseSavedListTradeUnits(list).some(tu => sel.has(tu));
}

/** Overlap filter for a visibility surface. Lists wholly inside the selection sort first (stable),
 *  then partial-overlap lists, so the lists aimed squarely at the current view stay at the top. */
export function filterSavedListsByTradeUnitOverlap<T extends Pick<SavedList, 'tradeUnits'>>(
  lists: readonly T[],
  selected: readonly string[],
): T[] {
  if (selected.length === 0) return [];
  const sel = new Set(selected);
  const inside: T[] = [];
  const partial: T[] = [];
  for (const list of lists) {
    const tus = parseSavedListTradeUnits(list);
    if (!tus.some(tu => sel.has(tu))) continue;
    (tus.every(tu => sel.has(tu)) ? inside : partial).push(list);
  }
  return [...inside, ...partial];
}
