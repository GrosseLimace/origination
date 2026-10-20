import { Pipe, PipeTransform } from '@angular/core';
import type { Ticket } from '@models';
import { ticketDisplayNumber } from '@shared/utils/ticket-display';

/** Template form of ticketDisplayNumber (full shipment number, else the bare one). Pure, so a row
 *  formats its ticket once and re-formats only when it is handed a different ticket object. */
@Pipe({ name: 'ticketDisplayNumber', standalone: true, pure: true })
export class TicketDisplayNumberPipe implements PipeTransform {
  transform(ticket: Pick<Ticket, 'ticketNumber' | 'shipmentTicketNumber'>): string {
    return ticketDisplayNumber(ticket);
  }
}
