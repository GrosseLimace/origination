import { NoteMention } from './note-mention.model';

export interface Note {
  id: number;
  customerId: number;
  customerName: string;
  customerCode?: string;
  tradeUnit?: string;
  content: string;
  isPinned: boolean;
  createdBy: string;
  createdAt: Date;
  modifiedBy?: string;
  modifiedAt?: Date;
  mentions?: NoteMention[];
}

/** Per-customer "last contacted" aggregate from GET /notes/last-contact — one row per
 *  customer that has notes, across ALL trade units (entitlement-filtered server-side).
 *  Feeds the customer-list / dashboard badges without downloading note bodies; full notes
 *  load per-producer on selection. */
export interface NoteLastContact {
  customerId: number;
  customerCode?: string;
  lastNoteAt: Date;
}
