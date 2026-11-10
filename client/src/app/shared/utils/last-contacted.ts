import type { Note } from '@models';
import { parseServerTime } from '@shared/utils/server-time';

// When a producer was last contacted, read from their notes: the "Last contacted" label on the Notes card, and the
// note timestamps behind it.

/** Milliseconds since the epoch for a note timestamp; 0 when there is none. */
export function parseNoteTime(ts: string | Date): number {
  if (!ts) return 0;
  // API returns bare ISO strings without Z suffix — treat as UTC consistently
  const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
  return new Date(raw).getTime();
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
