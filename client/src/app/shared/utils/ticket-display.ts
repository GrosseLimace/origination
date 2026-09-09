import type { Ticket } from '@models';

/**
 * The ticket number to show the user.
 *
 * ODS carries two forms: `ticketNumber` is the bare sequence, while `shipmentTicketNumber` is the
 * full identifier including the ticket prefix and suffix — which is what people actually quote and
 * what appears on the paperwork. Prefer the full one everywhere.
 *
 * Falls back to the bare number because `shipmentTicketNumber` is nullable in ODS: older or
 * partially-loaded rows can arrive without it, and a blank cell where a ticket number belongs is
 * worse than a short one. Whitespace-only counts as missing.
 */
export function ticketDisplayNumber(ticket: Pick<Ticket, 'ticketNumber' | 'shipmentTicketNumber'>): string {
  return ticket.shipmentTicketNumber?.trim() || ticket.ticketNumber;
}
