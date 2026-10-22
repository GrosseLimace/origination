import { Injectable, signal } from '@angular/core';
import { FieldTicket } from '@models';

/**
 * PROTOTYPE ONLY: stands in for the CTRM ticket feed for fields. A ticket is delivered under a split
 * ID and, for a sustainability program, carries the enrollment ID too. "Harvest complete" for a split
 * is what finalizes its program records. Tickets here are entered by hand from the field dialog's
 * simulation box; the real ones come from CTRM (Ticket.CustomerCode is the split ID).
 */
@Injectable({ providedIn: 'root' })
export class TicketFeedMockService {
  readonly tickets = signal<FieldTicket[]>([]);
  /** `${splitId}|${cropYear}` for splits whose harvest is complete. */
  readonly harvested = signal<ReadonlySet<string>>(new Set());
  private _nextNo = 1;

  forSplit(splitId: string, cropYear: number): FieldTicket[] {
    return this.tickets().filter(t => t.splitId === splitId && t.cropYear === cropYear);
  }

  add(splitId: string, cropYear: number, netBushels: number, enrollmentId: string): FieldTicket {
    const ticket: FieldTicket = {
      ticketNo: `T${String(this._nextNo++).padStart(6, '0')}`,
      date: new Date().toISOString().slice(0, 10),
      netBushels, splitId, enrollmentId: enrollmentId.trim(), cropYear,
    };
    this.tickets.update(ts => [...ts, ticket]);
    return ticket;
  }

  remove(ticketNo: string): void {
    this.tickets.update(ts => ts.filter(t => t.ticketNo !== ticketNo));
  }

  isHarvestComplete(splitId: string, cropYear: number): boolean {
    return this.harvested().has(`${splitId}|${cropYear}`);
  }

  setHarvestComplete(splitId: string, cropYear: number, complete: boolean): void {
    this.harvested.update(h => {
      const next = new Set(h);
      complete ? next.add(`${splitId}|${cropYear}`) : next.delete(`${splitId}|${cropYear}`);
      return next;
    });
  }
}
