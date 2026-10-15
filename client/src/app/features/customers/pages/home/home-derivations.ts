import type { Contract, Customer, DashboardPlantingEstimate, Note, NoteLastContact, PlantingIntention, Reminder, Ticket } from '@models';
import { parseServerTime } from '@shared/utils/server-time';

/**
 * The producer page's pure derivations: formatting, sorting and filtering that read only their
 * arguments. They were private methods and computed bodies on HomeComponent; they live here so they
 * can be tested directly and the page keeps only the code that owns state.
 */

// ── Notes ───────────────────────────────────────────────────────────────────

/** Milliseconds since the epoch for a note timestamp; 0 when there is none. */
export function parseNoteTime(ts: string | Date): number {
  if (!ts) return 0;
  // API returns bare ISO strings without Z suffix — treat as UTC consistently
  const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
  return new Date(raw).getTime();
}

/** Pinned first, then most recently modified (or created). Sorts IN PLACE and returns the same array,
 *  as Array.prototype.sort does — callers pass a fresh array. */
export function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    const aTime = parseNoteTime(a.modifiedAt || a.createdAt);
    const bTime = parseNoteTime(b.modifiedAt || b.createdAt);
    return bTime - aTime;
  });
}

/** The "Last contacted" label above the notes panel: Never / Today / Yesterday / N days ago / a date. */
export function describeLastContacted(notes: Note[], now: Date = new Date()): string {
  if (notes.length === 0) return 'Never';
  // Find the most recently CREATED note — don't use notes[0] since pinned notes sort
  // to the top but may have an old createdAt. modifiedAt reflects edits/pins, not contact.
  const lastNote = notes.reduce((latest, note) =>
    parseNoteTime(note.createdAt) > parseNoteTime(latest.createdAt) ? note : latest,
    notes[0]
  );
  const date = parseServerTime(lastNote.createdAt);
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const noteMidnight = new Date(date);
  noteMidnight.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((todayMidnight.getTime() - noteMidnight.getTime()) / (1000 * 60 * 60 * 24)));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** One producer's last-contact aggregate row, derived from its full notes; null when it has none
 *  (the producer drops back to "Never contacted"). */
export function lastContactFromNotes(customerId: number, notes: Note[]): NoteLastContact | null {
  if (notes.length === 0) return null;
  const lastMs = notes.reduce((m, n) => Math.max(m, parseNoteTime(n.createdAt)), 0);
  return {
    customerId,
    customerCode: notes[0].customerCode,
    lastNoteAt: new Date(lastMs)
  };
}

// ── Reminders ───────────────────────────────────────────────────────────────

/** Open follow-ups first, then by due date, soonest first. Returns a new array. */
export function sortReminders(list: Reminder[]): Reminder[] {
  return [...list].sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });
}

// ── Load failures ───────────────────────────────────────────────────────────

/**
 * Turns a failed HTTP response into something an originator can act on.
 *
 * The API answers a failed CTRM read with a 503 and ProblemDetails carrying
 * INFRASTRUCTURE_CTRM_UNAVAILABLE, which is the case worth naming: the data exists, we could not reach
 * it, and retrying is the right move. Anything else gets a generic line rather than a raw status.
 */
export function readFailureMessage(err: unknown): string {
  const e = err as { status?: number; error?: { code?: string; message?: string } } | null;
  if (e?.error?.code === 'INFRASTRUCTURE_CTRM_UNAVAILABLE')
    return e.error.message ?? 'CTRM is temporarily unavailable. Please retry shortly.';
  if (e?.status === 503) return 'The data source is temporarily unavailable. Please retry shortly.';
  return 'Something went wrong loading this data. Please retry.';
}

// ── Linked producers ────────────────────────────────────────────────────────

/**
 * Returns every producer transitively linked to `customer` — both forward (customers
 * in `customer.linkedProducerIds`) and reverse (customers whose own `linkedProducerIds`
 * includes `customer.scoularId`) — walked until the connected component is
 * exhausted. Prevents infinite loops with a visited set. Caps at 50 members to avoid
 * worst-case fanout. Only producers in `all` can be found; one not loaded yet is silently
 * excluded until it is.
 */
export function linkedGroupOf(customer: Customer, all: Customer[]): Customer[] {
  const MAX_GROUP_SIZE = 50;
  const bySourceId = new Map<string, Customer>();
  for (const c of all) {
    if (c.scoularId) bySourceId.set(c.scoularId, c);
  }

  const visited = new Set<number>([customer.id]);
  const result = new Map<number, Customer>();
  const queue: Customer[] = [customer];

  while (queue.length > 0 && visited.size < MAX_GROUP_SIZE) {
    const cur = queue.shift()!;

    // Forward: follow each id in the current customer's linkedProducerIds
    for (const sourceId of cur.linkedProducerIds || []) {
      const neighbor = bySourceId.get(sourceId);
      if (neighbor && !visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        result.set(neighbor.id, neighbor);
        queue.push(neighbor);
      }
    }

    // Reverse: find anyone whose linkedProducerIds mentions the current customer
    const curSource = cur.scoularId || '';
    if (curSource) {
      for (const other of all) {
        if (visited.has(other.id)) continue;
        if ((other.linkedProducerIds || []).includes(curSource)) {
          visited.add(other.id);
          result.set(other.id, other);
          queue.push(other);
        }
      }
    }
  }
  return [...result.values()];
}

// ── Per-producer rows ───────────────────────────────────────────────────────

/** The contracts and tickets that belong on one producer's profile. */
export function producerContractsAndTickets(
  customer: Customer, contracts: Contract[], tickets: Ticket[]
): { contracts: Contract[]; tickets: Ticket[] } {
  const allContracts = contracts.filter(c => c.ctrmCustomerId === customer.scoularId);
  // Include tickets whose CustomerCode matches the customer (covers unapplied + same-customer
  // applied) AND tickets whose CtrmContractNumber is on one of this customer's contracts
  // (covers cross-entity / split-load tickets where the ticket's CustomerCode differs from
  // the contract's CtrmCustomerId — the backend now returns these; this filter must let them through).
  const customerContractIds = new Set(
    allContracts.map(c => c.sourceContractId).filter((s): s is string => !!s)
  );
  const allTickets = tickets.filter(t =>
    t.customerCode === customer.scoularId
    || (!!t.ctrmContractNumber && customerContractIds.has(t.ctrmContractNumber))
  );
  return { contracts: allContracts, tickets: allTickets };
}

/** Incoming rows first; existing rows kept only when the incoming set has no row with their id. Used
 *  where a trade-unit-wide read and a per-producer read write the same signal, so a late wide
 *  response does not drop rows already loaded for the selected producer. */
export function mergeIncomingById<T extends { id: unknown }>(incoming: T[], existing: T[]): T[] {
  const seen = new Set(incoming.map(s => s.id));
  return [...incoming, ...existing.filter(s => !seen.has(s.id))];
}

/** Distinct commodity codes a producer's tickets (ProductCode) and contracts (CommodityCode) carry,
 *  tickets' first. */
export function commodityCodesFrom(tickets: Ticket[], contracts: Contract[]): string[] {
  const ticketCommodities = [...new Set(tickets.map(t => t.productCode || '').filter(Boolean))];
  const contractCommodities = [...new Set(contracts.map(c => c.commodityCode || '').filter(Boolean))];
  return [...new Set([...ticketCommodities, ...contractCommodities])];
}

// ── Yield estimates ─────────────────────────────────────────────────────────

/** Every planting year the user might pick: this year, last year, and any year an intention or a
 *  contract carries. */
export function yieldEstimateYears(currentYear: number, intentions: PlantingIntention[], contracts: Contract[]): number[] {
  const yearSet = new Set<number>();
  yearSet.add(currentYear);
  yearSet.add(currentYear - 1);
  for (const pi of intentions) {
    if (pi.plantingYear) yearSet.add(pi.plantingYear);
  }
  for (const c of contracts) {
    if (c.cropYear) yearSet.add(c.cropYear);
  }
  return [...yearSet];
}

/** Merges per-year estimate batches, one estimate per crop + year; a later batch wins a tie. */
export function mergeYieldEstimates(batches: DashboardPlantingEstimate[][]): DashboardPlantingEstimate[] {
  const map = new Map<string, DashboardPlantingEstimate>();
  for (const batch of batches) {
    for (const est of batch) {
      // Key by crop + year to keep per-year estimates separate
      map.set(`${est.crop}|${est.plantingYear}`, est);
    }
  }
  return [...map.values()];
}
