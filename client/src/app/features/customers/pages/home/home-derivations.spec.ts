import { describe, it, expect } from 'vitest';
import type { Customer, Note, Reminder } from '@models';
import { lastContactFromNotes, linkedGroupOf, sortNotes, sortReminders } from './home-derivations';

function note(id: number, createdAt: string | Date, over: Partial<Note> = {}): Note {
  return {
    id, customerId: 1, customerName: 'P', customerCode: 'S-1', content: '', isPinned: false, createdBy: 't',
    createdAt: createdAt as Date, ...over,
  };
}

/** Each test producer's links, as their saved details hold them. */
const links = new WeakMap<Customer, string[]>();
const linksOf = (c: Customer) => links.get(c) ?? [];

function customer(id: number, linked: string[] = []): Customer {
  const c = { id, scoularId: `S-${id}`, name: `P${id}` } as Customer;
  links.set(c, linked);
  return c;
}

function reminder(id: number, dueAt: string, isCompleted = false): Reminder {
  return { id, customerId: 1, customerName: 'P', dueAt, subject: '', isCompleted, createdAt: '' } as Reminder;
}

describe('home derivations', () => {
  describe('sortNotes', () => {
    it('puts pinned notes first, then newest by modified-or-created, sorting in place', () => {
      const notes = [
        note(1, '2026-10-01T00:00:00'),
        note(2, '2026-09-01T00:00:00', { isPinned: true }),
        note(3, '2026-08-01T00:00:00', { modifiedAt: '2026-10-05T00:00:00' as unknown as Date }),
        note(4, '2026-10-03T00:00:00'),
      ];
      const sorted = sortNotes(notes);
      expect(sorted).toBe(notes);
      expect(sorted.map(n => n.id)).toEqual([2, 3, 4, 1]);
    });
  });

  describe('lastContactFromNotes', () => {
    it('is null for a producer with no notes', () => {
      expect(lastContactFromNotes(7, [])).toBeNull();
    });

    it('takes the latest createdAt and the first note\'s code', () => {
      const row = lastContactFromNotes(7, [
        note(1, '2026-10-01T00:00:00', { customerCode: 'S-7' }),
        note(2, '2026-10-09T00:00:00', { customerCode: 'S-7b' }),
      ]);
      expect(row).toEqual({ customerId: 7, customerCode: 'S-7', lastNoteAt: new Date(Date.UTC(2026, 9, 9)) });
    });
  });

  describe('sortReminders', () => {
    it('puts open follow-ups first, each group soonest first, without mutating the input', () => {
      const input = [
        reminder(1, '2026-10-20T00:00:00Z', true),
        reminder(2, '2026-10-25T00:00:00Z'),
        reminder(3, '2026-10-15T00:00:00Z', true),
        reminder(4, '2026-10-18T00:00:00Z'),
      ];
      expect(sortReminders(input).map(r => r.id)).toEqual([4, 2, 3, 1]);
      expect(input.map(r => r.id)).toEqual([1, 2, 3, 4]);
    });
  });


  describe('linkedGroupOf', () => {
    it('walks forward and reverse links transitively and excludes the producer itself', () => {
      const a = customer(1, ['S-2']);
      const b = customer(2, ['S-4']);
      const c = customer(3, ['S-1']);
      const d = customer(4);
      const e = customer(5);
      expect(linkedGroupOf(a, [a, b, c, d, e], linksOf).map(x => x.id).sort()).toEqual([2, 3, 4]);
      expect(linkedGroupOf(d, [a, b, c, d, e], linksOf).map(x => x.id).sort()).toEqual([1, 2, 3]);
      expect(linkedGroupOf(e, [a, b, c, d, e], linksOf)).toEqual([]);
    });

    it('survives a cycle and skips a link to a producer that is not loaded', () => {
      const a = customer(1, ['S-2', 'S-99']);
      const b = customer(2, ['S-1']);
      expect(linkedGroupOf(a, [a, b], linksOf).map(x => x.id)).toEqual([2]);
    });

    it('stops at 50 members', () => {
      const chain = Array.from({ length: 80 }, (_, i) => customer(i + 1, [`S-${i + 2}`]));
      expect(linkedGroupOf(chain[0], chain, linksOf).length).toBe(49);
    });
  });
});
