import { describe, it, expect } from 'vitest';
import { TicketDisplayNumberPipe } from './ticket-display-number.pipe';
import { ticketDisplayNumber } from '@shared/utils/ticket-display';

/** The rules live in ticketDisplayNumber (see its spec); this pins that the pipe is that function. */
describe('TicketDisplayNumberPipe', () => {
  const pipe = new TicketDisplayNumberPipe();

  it('returns what ticketDisplayNumber returns', () => {
    for (const ticket of [
      { ticketNumber: '12345', shipmentTicketNumber: '  A-12345-B  ' },
      { ticketNumber: '12345', shipmentTicketNumber: undefined },
      { ticketNumber: '12345', shipmentTicketNumber: '   ' },
    ]) {
      expect(pipe.transform(ticket)).toBe(ticketDisplayNumber(ticket));
    }
    expect(pipe.transform({ ticketNumber: '12345', shipmentTicketNumber: '  A-12345-B  ' })).toBe('A-12345-B');
  });
});
