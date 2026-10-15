import { describe, expect, it } from 'vitest';

import { formatNoteTimestamp, formatUpdatedAgo, noteInitials } from './note-format';

describe('note-format (the desktop rules)', () => {
  const now = new Date(2026, 9, 14, 10, 0, 0); // Oct 14 2026, 10:00 local

  it('says Today / Yesterday with the time, then "N days ago", then the date', () => {
    expect(formatNoteTimestamp(new Date(2026, 9, 14, 8, 5), now)).toMatch(/^Today at 8:05\sAM$/);
    expect(formatNoteTimestamp(new Date(2026, 9, 13, 19, 57), now)).toMatch(/^Yesterday at 7:57\sPM$/);
    expect(formatNoteTimestamp(new Date(2026, 9, 10, 12, 0), now)).toBe('4 days ago');
    expect(formatNoteTimestamp(new Date(2026, 8, 1, 12, 0), now)).toBe('Sep 1, 2026');
  });

  it('treats a bare ISO string as UTC, like the desktop', () => {
    const bare = formatNoteTimestamp('2026-09-01T12:00:00', now);
    const utc = formatNoteTimestamp('2026-09-01T12:00:00Z', now);
    expect(bare).toBe(utc);
  });

  it('makes initials like the desktop', () => {
    expect(noteInitials('Caden Egr')).toBe('CE');
    expect(noteInitials('cegr')).toBe('CE');
    expect(noteInitials('')).toBe('??');
  });

  it('says when farm details were last updated', () => {
    expect(formatUpdatedAgo(new Date(2026, 9, 14, 8, 0), now)).toBe('today');
    expect(formatUpdatedAgo(new Date(2026, 9, 13, 23, 0), now)).toBe('yesterday');
    expect(formatUpdatedAgo(new Date(2026, 9, 11, 9, 0), now)).toBe('3 days ago');
    expect(formatUpdatedAgo(new Date(2026, 8, 1, 9, 0), now)).toBe('Sep 1, 2026');
  });
});
