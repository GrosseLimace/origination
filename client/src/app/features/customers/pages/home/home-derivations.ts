import type { Customer, Note, NoteLastContact, Reminder } from '@models';
import { parseNoteTime } from '@shared/utils/last-contacted';

/**
 * The producer page's pure derivations: formatting, sorting and filtering that read only their
 * arguments. They were private methods and computed bodies on HomeComponent; they live here so they
 * can be tested directly and the page keeps only the code that owns state.
 */

// ── Notes ───────────────────────────────────────────────────────────────────

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

// ── Linked producers ────────────────────────────────────────────────────────

/**
 * Returns every producer transitively linked to `customer` — both forward (the producers `customer`'s links name)
 * and reverse (producers whose own links include `customer.scoularId`) — walked until the connected component is
 * exhausted. `linkedIdsOf` gives a producer's links: the producer codes their saved details link to. Prevents infinite
 * loops with a visited set. Caps at 50 members to avoid worst-case fanout. Only producers in `all` can be found; one
 * not loaded yet is silently excluded until it is.
 */
export function linkedGroupOf(customer: Customer, all: Customer[], linkedIdsOf: (c: Customer) => readonly string[]): Customer[] {
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

    // Forward: follow each producer code the current customer links to
    for (const sourceId of linkedIdsOf(cur)) {
      const neighbor = bySourceId.get(sourceId);
      if (neighbor && !visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        result.set(neighbor.id, neighbor);
        queue.push(neighbor);
      }
    }

    // Reverse: find anyone whose links mention the current customer
    const curSource = cur.scoularId || '';
    if (curSource) {
      for (const other of all) {
        if (visited.has(other.id)) continue;
        if (linkedIdsOf(other).includes(curSource)) {
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
