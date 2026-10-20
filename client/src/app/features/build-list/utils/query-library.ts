/**
 * Build a List prompt library: searching and grouping the prompt cards, the category tabs, the
 * saved / team list search, the category a saved list's prompt belongs to, and the user-facing
 * labels for the NLQ engine's matched patterns.
 *
 * Pure functions moved verbatim out of BuildListComponent; the page keeps the computeds.
 */
import { QueryLibraryItem, SavedList } from '@models';

/** Pattern display name map for user-facing feedback. */
export const PATTERN_DISPLAY_NAMES: { [key: string]: string } = {
  state_filter: 'State', acres_more: 'Acres (min)', acres_less: 'Acres (max)', acres_between: 'Acres (range)',
  large_farm: 'Large operations', small_farm: 'Small operations', not_contacted: 'Not contacted',
  recently_contacted: 'Recently contacted', storage: 'Has storage', no_storage: 'No storage',
  storage_duration: 'Storage duration', planting: 'Planting', no_planting: 'No planting',
  planting_year: 'Crop year', planting_type: 'Planting type',
  active_contract: 'Active contracts', no_contract: 'No contracts',
  unsigned_contract: 'Unconfirmed contracts', negative_pacing: 'Behind on pacing',
  positive_pacing: 'Ahead on pacing', contract_unconfirmed: 'Unconfirmed contracts',
  contract_confirmed: 'Confirmed contracts', contract_priced: 'Pricing status',
  contract_quantity: 'Contract quantity', contract_value: 'Contract value',
  contract_open_balance: 'Open balance', fulfillment_ratio: 'Fulfillment %',
  commodity_contract: 'Commodity contracts', has_deliveries: 'Has deliveries',
  no_deliveries: 'No deliveries', delivery_commodity: 'Delivery commodity',
  delivery_quantity: 'Delivery quantity', ticket_unapplied: 'Unapplied tickets',
  ticket_unsettled: 'Unsettled tickets', has_phone: 'Has phone', no_phone: 'No phone',
  has_email: 'Has email', no_email: 'No email', commodities_match: 'Commodity match', crop_count: 'Crop count',
  top_n: 'Top N ranking', customer_search: 'Name search', region_filter: 'Region',
  multi_commodity: 'Multiple crops (AND)', multi_commodity_or: 'Multiple crops (OR)',
  cross_contract_no_delivery: 'Contracted, not delivered',
  cross_planting_no_contract: 'Planting, no contracts',
  cross_delivery_no_contract: 'Delivered, no contracts',
  note_contains: 'Notes containing',
  grain_on_farm: 'Grain on farm', grain_target: 'Target price', grain_grade: 'Grade',
};

/** User-facing labels for the NLQ engine's matched patterns — unknown patterns dropped, duplicates
 *  (several patterns share a label) removed. */
export function matchedPatternLabels(patterns: string[]): string[] {
  return patterns
    .map(p => PATTERN_DISPLAY_NAMES[p] || null)
    .filter((label): label is string => label !== null)
    // Deduplicate labels
    .filter((v, i, a) => a.indexOf(v) === i);
}

/** Prompt cards matching the selected category and the search text (name, description, tags,
 *  category or prompt text). `search` is already lower-cased and trimmed. */
export function filterLibrary(items: QueryLibraryItem[], search: string, category: string | null, remindersEnabled: boolean): QueryLibraryItem[] {
  // Prompt cards are database rows, so they appear the moment the migration runs — including in
  // environments where the reminders feature is still switched off. There the follow-up card
  // would resolve to nobody, every time, so hide it rather than leave a dead end on the page.
  if (!remindersEnabled) {
    items = items.filter(q => !(q.tags || '').toLowerCase().includes('reminders'));
  }
  if (category) items = items.filter(q => q.category === category);
  if (search) {
    items = items.filter(q =>
      q.name.toLowerCase().includes(search) ||
      (q.description || '').toLowerCase().includes(search) ||
      (q.tags || '').toLowerCase().includes(search) ||
      q.category.toLowerCase().includes(search) ||
      q.queryText.toLowerCase().includes(search)
    );
  }
  return items;
}

/** Category tabs: Saved Lists, Team Lists (managers only), then the prompt categories A-Z. */
export function libraryCategories(items: QueryLibraryItem[], isManager: boolean): string[] {
  const cats = new Set(items.map(q => q.category));
  const sorted = [...cats].sort();
  // Prepend pseudo-categories so they sit right after "All" (rendered separately, before this loop).
  // 'Team Lists' (managers only) goes between 'Saved Lists' and the first real category. unshift in
  // reverse order so the final order is: Saved Lists, Team Lists, <alphabetical categories>.
  if (isManager) sorted.unshift('Team Lists');
  sorted.unshift('Saved Lists');
  return sorted;
}

/** Team lists matching the search text on name, prompt or owner. */
export function searchTeamLists(lists: SavedList[], search: string): SavedList[] {
  if (search) {
    lists = lists.filter(l =>
      l.name.toLowerCase().includes(search) ||
      l.query.toLowerCase().includes(search) ||
      (l.createdBy ?? '').toLowerCase().includes(search)
    );
  }
  return lists;
}

/** Saved lists matching the search text on name or prompt. */
export function searchSavedLists(lists: SavedList[], search: string): SavedList[] {
  if (search) {
    lists = lists.filter(l =>
      l.name.toLowerCase().includes(search) ||
      l.query.toLowerCase().includes(search)
    );
  }
  return lists;
}

/** The library category of the card whose prompt text is `query` (case- and space-insensitive). */
export function libraryCategoryForQuery(items: QueryLibraryItem[], query: string): string | null {
  const qLower = query.trim().toLowerCase();
  const matched = items.find(q => q.queryText.trim().toLowerCase() === qLower);
  return matched?.category ?? null;
}

/** Prompt cards grouped by category, categories in first-seen order. */
export function groupLibrary(items: QueryLibraryItem[]): { category: string; queries: QueryLibraryItem[] }[] {
  const map = new Map<string, QueryLibraryItem[]>();
  for (const item of items) {
    const arr = map.get(item.category);
    if (arr) arr.push(item); else map.set(item.category, [item]);
  }
  return [...map.entries()].map(([category, queries]) => ({ category, queries }));
}
