import type { Ticket } from '@models';

/** Parse a ticket date string into a local-time epoch, avoiding the UTC-midnight off-by-one
 *  bug: ISO date-only strings ("YYYY-MM-DD") are treated as UTC by the JS spec, which shifts
 *  the calendar date back a day in US timezones. Appending T12:00:00 forces noon local time.
 *  Missing / unparseable dates return 0 (sort first) — matching the prior date-only behavior. */
function ticketDateValue(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  const s = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr + 'T12:00:00' : dateStr;
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Compare two tickets by their displayed ticket number, smallest → largest. Ticket numbers
 *  are numeric-like strings (e.g. "999", "1000"), so a plain string compare would order "1000"
 *  before "999". Parse to a number when both sides are numeric; otherwise fall back to a
 *  case-insensitive string compare. Empty / non-numeric numbers sort after numeric ones. */
export function compareTicketNumbers(a: Ticket, b: Ticket): number {
  const sa = (a.ticketNumber ?? '').trim();
  const sb = (b.ticketNumber ?? '').trim();
  if (sa === sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;

  const na = Number(sa);
  const nb = Number(sb);
  const aNum = sa !== '' && !Number.isNaN(na);
  const bNum = sb !== '' && !Number.isNaN(nb);

  if (aNum && bNum) return na - nb;        // both numeric → numeric order
  if (aNum) return -1;                      // numeric sorts before non-numeric
  if (bNum) return 1;
  return sa.localeCompare(sb, undefined, { sensitivity: 'base' });
}

/** Compare two tickets by date (oldest first — the app's default order), then by ticket number
 *  (smallest → largest) within the same date. This is the single source of truth for the
 *  applied- and unapplied-ticket default ordering. */
export function compareTicketsByDateThenNumber(a: Ticket, b: Ticket): number {
  const byDate = ticketDateValue(a.date) - ticketDateValue(b.date);
  return byDate !== 0 ? byDate : compareTicketNumbers(a, b);
}
