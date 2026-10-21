/**
 * How old a BarChart bid is, and whether the sheet should still show its number.
 *
 * BarChart keeps serving the LAST price for a delivery period an elevator has stopped posting -- Scoular
 * Goodland's October corn sat frozen for two weeks while its December moved nightly (2026-10) -- and the
 * feed stores exactly what the vendor sends. So every surface that prints a fed number first asks here
 * whether the elevator has actually touched it lately. Past the threshold the number is withheld and the
 * date it went quiet is shown instead; a user may type over it, and the feed takes the cell back only
 * with a post newer than the edit (ApplyBidsToBidSheetAsync on the server: newest wins).
 *
 * Pure functions, so the rule is testable without a component. The component wraps them with its own
 * threshold signal (from the coverage endpoint: Barchart:StaleAfterDays) and its date formatter.
 */
import { BidSheetEntry } from '@models';

export type BidSide = 'cash' | 'basis';

export interface BidCellView {
  /** The value to print: '' for an empty side, and '' for a fed side past the threshold. */
  value: string;
  /** When the side last changed hands: the elevator's stamp on a fed side, the edit time on a manual one. */
  asOf?: string;
  /** True only for a fed side the elevator has not updated within the threshold. */
  stale: boolean;
  kind: 'feed' | 'manual' | 'none';
}

const DAY_MS = 86_400_000;

/** True when `iso` is more than `days` before `reference`. Undefined or unparseable never counts as old. */
export function isOlderThanDays(iso: string | undefined, days: number, reference = Date.now()): boolean {
  if (!iso) return false;
  const when = new Date(iso).getTime();
  return !isNaN(when) && reference - when > days * DAY_MS;
}

/**
 * The instant a delivery month closed -- the first moment of the following month, local time -- or
 * undefined while the month is still open.
 *
 * A past month's cells freeze as they last published and are never pruned, so measured against today
 * every one of them would be stale and the whole history view would read as blanks. Measured at the
 * month's end they read as they were when the month was live: an elevator that posted daily through
 * August shows its August number next year; one that went quiet on the 15th shows the 15th.
 */
export function periodEnd(cropYear: number, month: number, now = Date.now()): number | undefined {
  if (!month || month < 1 || month > 12) return undefined;
  // Date months are 0-based, so passing the 1-based month lands on the FOLLOWING month's first day.
  const end = new Date(cropYear, month, 1).getTime();
  return end <= now ? end : undefined;
}

/**
 * One side of a cell through the stale rule.
 *
 * Keyed on SOURCE, not on the presence of a vendor stamp: a Manual row may still carry the quoteAsOf
 * the feed left behind, and its time is the edit, never the vendor's. A fed side with no stamp at all
 * cannot be judged and is shown -- the bridge lets untimestamped quotes through on purpose.
 */
export function classifyBidSide(
  entry: BidSheetEntry | null | undefined,
  side: BidSide,
  staleAfterDays: number,
  now = Date.now(),
  periodEndMs?: number,
): BidCellView {
  if (!entry) return { value: '', stale: false, kind: 'none' };
  const value = ((side === 'cash' ? entry.cashBid : entry.basisBid) ?? '').trim();
  if (!value) return { value: '', stale: false, kind: 'none' };
  if (entry.source !== 'Barchart') {
    return { value, asOf: entry.modifiedAt ?? entry.createdAt, stale: false, kind: 'manual' };
  }
  const asOf = side === 'cash' ? entry.cashQuoteAsOf : entry.basisQuoteAsOf;
  const reference = periodEndMs != null ? Math.min(now, periodEndMs) : now;
  const stale = isOlderThanDays(asOf, staleAfterDays, reference);
  return { value: stale ? '' : value, asOf, stale, kind: 'feed' };
}

/** "Updated Oct 20" | "Not updated since Oct 7" | "". The when only -- never who. */
export function asOfTitle(view: BidCellView, format: (iso?: string) => string): string {
  if (view.kind === 'none' || !view.asOf) return '';
  const when = format(view.asOf);
  if (!when) return '';
  return view.stale ? `Not updated since ${when}` : `Updated ${when}`;
}
