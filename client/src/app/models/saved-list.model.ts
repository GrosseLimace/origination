import { RefinementFilters } from './refine-filters.model';

export interface SavedList {
  id: number;
  name: string;
  query: string;
  tradeUnits?: string;              // Comma-separated trade unit keys (e.g. "TU1,TU2")
  filters?: RefinementFilters;      // Structured refinements applied on top of the NLQ query
  includedCustomerIds?: number[];   // Manually added customers (persisted to DB as JSON)
  excludedCustomerIds?: number[];   // Manually removed customers (persisted to DB as JSON)
  customerIds?: number[];           // Computed client-side, NOT stored in DB
  createdAt: string;
  createdBy?: string;               // Creator's display name (resolved server-side). Used by the manager "Team Lists" view.
}
