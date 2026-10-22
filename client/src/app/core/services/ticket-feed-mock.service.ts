import { Injectable, signal } from '@angular/core';
import { EnrollmentTicket } from '@models';

/**
 * PROTOTYPE ONLY: stands in for the CTRM ticket feed for sustainability programs. An incoming ticket
 * is assigned a program enrollment ID (producer + program + year), not a field. Tickets here are
 * entered by hand from the enrollment card's simulation box; the real ones come from CTRM.
 */
@Injectable({ providedIn: 'root' })
export class TicketFeedMockService {
  readonly tickets = signal<EnrollmentTicket[]>([]);
  private _nextNo = 1;

  /** Tickets assigned this enrollment ID (as keyed, case and spaces ignored). */
  forEnrollment(enrollmentId: string): EnrollmentTicket[] {
    const id = enrollmentId.trim().toUpperCase();
    return this.tickets().filter(t => t.enrollmentId.trim().toUpperCase() === id);
  }

  add(enrollmentId: string, netBushels: number): EnrollmentTicket {
    const ticket: EnrollmentTicket = {
      ticketNo: `T${String(this._nextNo++).padStart(6, '0')}`,
      date: new Date().toISOString().slice(0, 10),
      netBushels, enrollmentId: enrollmentId.trim(),
    };
    this.tickets.update(ts => [...ts, ticket]);
    return ticket;
  }

  remove(ticketNo: string): void {
    this.tickets.update(ts => ts.filter(t => t.ticketNo !== ticketNo));
  }
}
