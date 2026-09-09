import { describe, it, expect } from 'vitest';
import { ticketDisplayNumber } from './ticket-display';

/**
 * The grid shows the FULL shipment ticket number (prefix + number + suffix) because that is what
 * appears on the paperwork. ODS makes that column nullable, so the fallback is load-bearing.
 */
describe('ticketDisplayNumber', () => {
  it('prefers the full shipment ticket number', () => {
    expect(ticketDisplayNumber({ ticketNumber: '12345', shipmentTicketNumber: 'A-12345-B' }))
      .toBe('A-12345-B');
  });

  it('falls back to the bare number when ODS has no shipment number', () => {
    expect(ticketDisplayNumber({ ticketNumber: '12345', shipmentTicketNumber: undefined }))
      .toBe('12345');
    expect(ticketDisplayNumber({ ticketNumber: '12345', shipmentTicketNumber: null as never }))
      .toBe('12345');
  });

  it('treats a whitespace-only shipment number as missing', () => {
    // An all-spaces value would otherwise render as a blank cell where a ticket number belongs.
    expect(ticketDisplayNumber({ ticketNumber: '12345', shipmentTicketNumber: '   ' }))
      .toBe('12345');
  });

  it('trims surrounding whitespace off the shipment number', () => {
    expect(ticketDisplayNumber({ ticketNumber: '12345', shipmentTicketNumber: '  A-12345-B  ' }))
      .toBe('A-12345-B');
  });
});
