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
  assignedTo?: string;              // Short UPN of the member this list was assigned to (null for a personal list).
  assignedToName?: string;          // Assignee's display name (resolved server-side).
}

/** A selectable team member for the manager's "assign a list" picker. */
export interface TeamMember {
  userId: string;                   // Short UPN (e.g. "CEgr") — the assignment key.
  displayName: string;              // Azure AD display name shown in the picker.
}
