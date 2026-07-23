import { describe, it, expect } from 'vitest';
import type { Ticket } from '@models';
import { compareNumericStrings, compareTicketNumbers, compareTicketsByDateThenNumber } from './ticket-sort';

/** Minimal Ticket factory — only the fields the sort comparators read. */
function makeTicket(over: Partial<Ticket>): Ticket {
  return {
    id: 0,
    farmId: '',
    ticketNumber: '',
    date: '',
    grossWeight: 0,
    tareWeight: 0,
    netWeight: 0,
    ...over,
  } as Ticket;
}

const numbersOf = (tickets: Ticket[]) => tickets.map(t => t.ticketNumber);

describe('compareNumericStrings (shared ticket/receipt-number primitive)', () => {
  it('orders numeric-like strings numerically, not lexicographically', () => {
    const list = ['1000', '999', '1'];
    list.sort(compareNumericStrings);
    expect(list).toEqual(['1', '999', '1000']);
  });

  it('sorts numeric ahead of non-numeric, and empty/null last', () => {
    const list = ['X', '5', '', null as unknown as string];
    list.sort(compareNumericStrings);
    expect(list).toEqual(['5', 'X', '', null]);
  });
});

describe('compareTicketNumbers', () => {
  it('orders numerically, not lexicographically ("999" before "1000")', () => {
    const list = [
      makeTicket({ ticketNumber: '1000' }),
      makeTicket({ ticketNumber: '999' }),
      makeTicket({ ticketNumber: '1' }),
    ];
    list.sort(compareTicketNumbers);
    expect(numbersOf(list)).toEqual(['1', '999', '1000']);
  });

  it('falls back to string compare for non-numeric numbers without throwing', () => {
    const list = [
      makeTicket({ ticketNumber: 'B-2' }),
      makeTicket({ ticketNumber: 'A-1' }),
    ];
    expect(() => list.sort(compareTicketNumbers)).not.toThrow();
    expect(numbersOf(list)).toEqual(['A-1', 'B-2']);
  });

  it('sorts numeric ticket numbers ahead of non-numeric ones', () => {
    const list = [
      makeTicket({ ticketNumber: 'X' }),
      makeTicket({ ticketNumber: '5' }),
    ];
    list.sort(compareTicketNumbers);
    expect(numbersOf(list)).toEqual(['5', 'X']);
  });

  it('sorts empty/missing ticket numbers last', () => {
    const list = [
      makeTicket({ ticketNumber: '' }),
      makeTicket({ ticketNumber: '7' }),
    ];
    list.sort(compareTicketNumbers);
    expect(numbersOf(list)).toEqual(['7', '']);
  });
});

describe('compareTicketsByDateThenNumber', () => {
  it('keeps date order across different dates', () => {
    const list = [
      makeTicket({ date: '2026-07-08', ticketNumber: '1' }),
      makeTicket({ date: '2026-07-07', ticketNumber: '9' }),
    ];
    list.sort(compareTicketsByDateThenNumber);
    expect(list.map(t => t.date)).toEqual(['2026-07-07', '2026-07-08']);
  });

  it('sorts same-day tickets smallest -> largest ticket #', () => {
    const list = [
      makeTicket({ date: '2026-07-07', ticketNumber: '444227' }),
      makeTicket({ date: '2026-07-07', ticketNumber: '444120' }),
      makeTicket({ date: '2026-07-07', ticketNumber: '444135' }),
    ];
    list.sort(compareTicketsByDateThenNumber);
    expect(numbersOf(list)).toEqual(['444120', '444135', '444227']);
  });

  it('applies the ticket-# tiebreaker only within a date (date wins across dates)', () => {
    const list = [
      makeTicket({ date: '2026-07-08', ticketNumber: '100' }),
      makeTicket({ date: '2026-07-07', ticketNumber: '900' }),
      makeTicket({ date: '2026-07-07', ticketNumber: '100' }),
    ];
    list.sort(compareTicketsByDateThenNumber);
    expect(list.map(t => `${t.date}#${t.ticketNumber}`)).toEqual([
      '2026-07-07#100',
      '2026-07-07#900',
      '2026-07-08#100',
    ]);
  });

  it('does not crash on missing date or ticket number and orders deterministically', () => {
    const list = [
      makeTicket({ date: '', ticketNumber: '' }),
      makeTicket({ date: '2026-07-07', ticketNumber: '5' }),
      makeTicket({ date: '', ticketNumber: '2' }),
    ];
    expect(() => list.sort(compareTicketsByDateThenNumber)).not.toThrow();
    // Missing dates (epoch 0) sort first; within them, ticket # ascending.
    expect(list.map(t => `${t.date || '-'}#${t.ticketNumber || '-'}`)).toEqual([
      '-#2',
      '-#-',
      '2026-07-07#5',
    ]);
  });
});
