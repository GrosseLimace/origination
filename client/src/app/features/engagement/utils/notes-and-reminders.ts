import type { Note, NoteLastContact, Reminder } from '@models';
import { parseNoteTime } from '@shared/utils/last-contacted';

/**
 * How the customer screen orders a producer's notes and the user's follow-ups, and a producer's last contact worked out
 * from their notes. Pure: they read only their arguments.
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
