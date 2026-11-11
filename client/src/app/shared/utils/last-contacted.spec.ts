import { describe, it, expect } from 'vitest';
import type { Note } from '@models';
import { describeLastContacted, parseNoteTime } from './last-contacted';

function note(id: number, createdAt: string | Date, over: Partial<Note> = {}): Note {
  return {
    id, customerId: 1, customerName: 'P', customerCode: 'S-1', content: '', isPinned: false, createdBy: 't',
    createdAt: createdAt as Date, ...over,
  };
}

describe('last contacted', () => {
  describe('parseNoteTime', () => {
    it('reads a bare ISO string as UTC, keeps an explicit zone, and gives 0 for nothing', () => {
      expect(parseNoteTime('2026-10-13T15:00:00')).toBe(Date.UTC(2026, 9, 13, 15));
      expect(parseNoteTime('2026-10-13T15:00:00-05:00')).toBe(Date.UTC(2026, 9, 13, 20));
      expect(parseNoteTime(new Date(Date.UTC(2026, 0, 1)))).toBe(Date.UTC(2026, 0, 1));
      expect(parseNoteTime('' as unknown as string)).toBe(0);
    });
  });

  describe('describeLastContacted', () => {
    const now = new Date(2026, 9, 13, 15, 0, 0); // local time, as the label is

    it('says Never with no notes', () => {
      expect(describeLastContacted([], now)).toBe('Never');
    });

    it('uses the most recently CREATED note, not the first (pinned) one', () => {
      const notes = [
        note(1, new Date(2026, 8, 1, 12), { isPinned: true }),
        note(2, new Date(2026, 9, 12, 9)),
      ];
      expect(describeLastContacted(notes, now)).toBe('Yesterday');
    });

    it('counts calendar days: Today, N days ago under a week, then a date', () => {
      expect(describeLastContacted([note(1, new Date(2026, 9, 13, 0, 5))], now)).toBe('Today');
      expect(describeLastContacted([note(1, new Date(2026, 9, 10, 23))], now)).toBe('3 days ago');
      expect(describeLastContacted([note(1, new Date(2026, 9, 6, 12))], now)).toBe('Oct 6, 2026');
    });

    it('treats a future note as today rather than negative days', () => {
      expect(describeLastContacted([note(1, new Date(2026, 9, 20))], now)).toBe('Today');
    });
  });
});
