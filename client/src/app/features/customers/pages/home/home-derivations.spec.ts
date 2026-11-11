import { describe, it, expect } from 'vitest';
import type { Contract, Customer, DashboardPlantingEstimate, Note, PlantingIntention, Reminder, Ticket } from '@models';
import {
  commodityCodesFrom, lastContactFromNotes, linkedGroupOf, mergeIncomingById, mergeYieldEstimates,
  producerContractsAndTickets, readFailureMessage, sortNotes, sortReminders, yieldEstimateYears,
} from './home-derivations';

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

  describe('readFailureMessage', () => {
    it('names a CTRM outage with the server\'s own message, or a default when it has none', () => {
      expect(readFailureMessage({ status: 503, error: { code: 'INFRASTRUCTURE_CTRM_UNAVAILABLE', message: 'Down.' } }))
        .toBe('Down.');
      expect(readFailureMessage({ status: 503, error: { code: 'INFRASTRUCTURE_CTRM_UNAVAILABLE' } }))
        .toBe('CTRM is temporarily unavailable. Please retry shortly.');
    });

    it('calls any other 503 a data-source outage and everything else a generic failure', () => {
      expect(readFailureMessage({ status: 503 })).toBe('The data source is temporarily unavailable. Please retry shortly.');
      expect(readFailureMessage({ status: 500 })).toBe('Something went wrong loading this data. Please retry.');
      expect(readFailureMessage(null)).toBe('Something went wrong loading this data. Please retry.');
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

  describe('producerContractsAndTickets', () => {
    it('keeps the producer\'s contracts, its own tickets, and split-load tickets applied to its contracts', () => {
      const contracts = [
        { id: 1, ctrmCustomerId: 'S-1', sourceContractId: 'P1' },
        { id: 2, ctrmCustomerId: 'S-2', sourceContractId: 'P2' },
      ] as Contract[];
      const tickets = [
        { id: 10, customerCode: 'S-1' },
        { id: 11, customerCode: 'S-X', ctrmContractNumber: 'P1' },
        { id: 12, customerCode: 'S-X', ctrmContractNumber: 'P2' },
        { id: 13, customerCode: 'S-2' },
      ] as Ticket[];
      const rows = producerContractsAndTickets(customer(1), contracts, tickets);
      expect(rows.contracts.map(c => c.id)).toEqual([1]);
      expect(rows.tickets.map(t => t.id)).toEqual([10, 11]);
    });
  });

  describe('mergeIncomingById', () => {
    it('puts incoming rows first and keeps only existing rows the incoming set does not replace', () => {
      const merged = mergeIncomingById([{ id: 'b', v: 2 }, { id: 'c', v: 3 }], [{ id: 'a', v: 0 }, { id: 'b', v: 1 }]);
      expect(merged).toEqual([{ id: 'b', v: 2 }, { id: 'c', v: 3 }, { id: 'a', v: 0 }]);
    });
  });

  describe('commodityCodesFrom', () => {
    it('lists distinct ticket product codes then contract commodity codes, skipping blanks', () => {
      const tickets = [{ productCode: 'SB' }, { productCode: '' }, { productCode: 'C' }, { productCode: 'SB' }] as Ticket[];
      const contracts = [{ commodityCode: 'C' }, { commodityCode: 'W' }, {}] as Contract[];
      expect(commodityCodesFrom(tickets, contracts)).toEqual(['SB', 'C', 'W']);
    });
  });

  describe('yield estimates', () => {
    it('asks for this year, last year and every year an intention or contract carries', () => {
      const intentions = [{ plantingYear: 2027 }, { plantingYear: 0 }] as PlantingIntention[];
      const contracts = [{ cropYear: 2024 }, { cropYear: 2026 }] as Contract[];
      expect(yieldEstimateYears(2026, intentions, contracts)).toEqual([2026, 2025, 2027, 2024]);
    });

    it('keeps one estimate per crop and year, the later batch winning', () => {
      const est = (crop: string, year: number, y: number) =>
        ({ id: 0, tradeUnitKey: 'TU1', crop, plantingYear: year, yieldEstimate: y }) as DashboardPlantingEstimate;
      const merged = mergeYieldEstimates([[est('CORN', 2026, 180), est('CORN', 2025, 170)], [est('CORN', 2026, 190)]]);
      expect(merged.map(e => `${e.crop}|${e.plantingYear}|${e.yieldEstimate}`))
        .toEqual(['CORN|2026|190', 'CORN|2025|170']);
    });
  });
});
