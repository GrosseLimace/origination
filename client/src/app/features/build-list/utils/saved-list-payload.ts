/**
 * Build a List: the body saved for a list — shared by "Save list" and "Assign to team members",
 * which used to build it in two identical copies. Moved verbatim out of BuildListComponent.
 */
import { RefinementFilters } from '@models';

export interface SavedListPayloadInput {
  query: string;
  /** The effective trade units the list was built under. */
  tradeUnits: string[];
  /** The applied refinements, or null when none is active. */
  refinements: RefinementFilters | null;
  /** The prompt's library category (Contracts / Tickets / …), if known. */
  category: string | null;
  includedIds: number[];
  excludedIds: number[];
}

/** The saved-list body (without name / targets). Empty parts are sent as undefined. */
export interface SavedListPayload {
  query: string;
  tradeUnits?: string;
  filters?: RefinementFilters;
  includedCustomerIds?: number[];
  excludedCustomerIds?: number[];
}

export function buildSavedListPayload(input: SavedListPayloadInput): SavedListPayload {
  const { tradeUnits, includedIds, excludedIds, category } = input;
  // Resolve the prompt's library category (Contracts / Tickets / etc.) and persist it as a
  // private hint on the filters so home/customer-list can run the dimension-aware crops filter
  // identically — they don't load the query library and can't recover the category from
  // queryText otherwise. Build-list reads it back too, but its own UI uses effectiveLibraryCategory.
  const baseFilters = input.refinements ? { ...input.refinements } : null;
  const filtersWithCategory = baseFilters
    ? (category ? { ...baseFilters, _promptCategory: category } : baseFilters)
    : (category ? { _promptCategory: category } : undefined);

  return {
    query: input.query,
    tradeUnits: tradeUnits.length > 0 ? tradeUnits.join(',') : undefined,
    filters: filtersWithCategory,
    includedCustomerIds: includedIds.length > 0 ? includedIds : undefined,
    excludedCustomerIds: excludedIds.length > 0 ? excludedIds : undefined,
  };
}
