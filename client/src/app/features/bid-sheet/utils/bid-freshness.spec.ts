import { describe, it, expect } from 'vitest';

import { BidSheetEntry } from '@models';

import { asOfTitle, classifyBidSide, isOlderThanDays, periodEnd } from './bid-freshness';

/**
 * The rule that keeps a frozen BarChart price off the sheet. Pure, so it is pinned here without a
 * component: the boundary, which side reads which stamp, why a manual row ignores the stamp it may
 * still carry, and how a past month is judged.
 */

const NOW = Date.parse('2026-10-21T15:00:00Z');
const daysAgo = (d: number): string => new Date(NOW - d * 86_400_000).toISOString();

function entry(overrides: Partial<BidSheetEntry> = {}): BidSheetEntry {
  return {
    id: 1, locationId: 1, name: 'Goodland', tradeUnitCode: '2038',
    commodityCode: 'YC', cropYear: 2026, month: 12,
    bid: '4.47', cashBid: '4.47', basisBid: '-30',
    source: 'Barchart',
    cashQuoteAsOf: daysAgo(1), basisQuoteAsOf: daysAgo(1),
    createdBy: 'barchart-feed', createdAt: daysAgo(40),
    ...overrides,
  };
}

describe('isOlderThanDays', () => {
  it('is strict: exactly N days old is not yet older than N days', () => {
    expect(isOlderThanDays(daysAgo(10), 10, NOW)).toBe(false);
    expect(isOlderThanDays(daysAgo(10.01), 10, NOW)).toBe(true);
  });

  it('never calls a missing or unreadable stamp old', () => {
    expect(isOlderThanDays(undefined, 10, NOW)).toBe(false);
    expect(isOlderThanDays('not a date', 10, NOW)).toBe(false);
  });
});

describe('classifyBidSide — a fed side', () => {
  it('shows a number the elevator updated inside the threshold', () => {
    const v = classifyBidSide(entry({ cashQuoteAsOf: daysAgo(9) }), 'cash', 10, NOW);
    expect(v).toEqual({ value: '4.47', asOf: daysAgo(9), stale: false, kind: 'feed' });
  });

  it('withholds the number past the threshold but keeps the date, so the sheet can say when it went quiet', () => {
    const v = classifyBidSide(entry({ cashQuoteAsOf: daysAgo(11) }), 'cash', 10, NOW);
    expect(v).toEqual({ value: '', asOf: daysAgo(11), stale: true, kind: 'feed' });
  });

  it('honours the threshold it is given rather than a fixed ten days', () => {
    expect(classifyBidSide(entry({ cashQuoteAsOf: daysAgo(20) }), 'cash', 30, NOW).stale).toBe(false);
    expect(classifyBidSide(entry({ cashQuoteAsOf: daysAgo(20) }), 'cash', 10, NOW).stale).toBe(true);
  });

  it('judges each side on its own stamp: cash and basis are separate instruments', () => {
    const e = entry({ cashQuoteAsOf: daysAgo(20), basisQuoteAsOf: daysAgo(1) });
    expect(classifyBidSide(e, 'cash', 10, NOW).stale).toBe(true);
    expect(classifyBidSide(e, 'basis', 10, NOW)).toEqual({ value: '-30', asOf: daysAgo(1), stale: false, kind: 'feed' });
  });

  it('shows a side with no stamp at all -- it cannot be judged, and the bridge lets such quotes through', () => {
    const v = classifyBidSide(entry({ cashQuoteAsOf: undefined }), 'cash', 10, NOW);
    expect(v.stale).toBe(false);
    expect(v.value).toBe('4.47');
  });

  it('is empty, not stale, for a side with no value', () => {
    expect(classifyBidSide(entry({ basisBid: undefined }), 'basis', 10, NOW)).toEqual({ value: '', stale: false, kind: 'none' });
    expect(classifyBidSide(null, 'cash', 10, NOW).kind).toBe('none');
  });
});

describe('classifyBidSide — a manual side', () => {
  it('is dated by the edit, never stale, and ignores a vendor stamp the row may still carry', () => {
    const e = entry({ source: 'Manual', cashQuoteAsOf: daysAgo(60), modifiedAt: daysAgo(2), createdAt: daysAgo(40) });
    expect(classifyBidSide(e, 'cash', 10, NOW)).toEqual({ value: '4.47', asOf: daysAgo(2), stale: false, kind: 'manual' });
  });

  it('falls back to the creation time when the row was never edited', () => {
    const e = entry({ source: 'Manual', modifiedAt: undefined, createdAt: daysAgo(40) });
    expect(classifyBidSide(e, 'cash', 10, NOW).asOf).toBe(daysAgo(40));
  });
});

describe('periodEnd and a past month', () => {
  it('is undefined while the month is open, and the following first-of-month once it has closed', () => {
    const now = new Date(2026, 9, 21, 12).getTime();                       // 21 Oct 2026, local
    expect(periodEnd(2026, 10, now)).toBeUndefined();
    expect(periodEnd(2026, 12, now)).toBeUndefined();
    expect(periodEnd(2026, 8, now)).toBe(new Date(2026, 8, 1).getTime());  // Aug closed on 1 Sep
    expect(periodEnd(2026, 0, now)).toBeUndefined();                      // the retired Yearly period
  });

  it('judges a closed month at its end, so history does not turn to blanks the day a month passes', () => {
    const now = new Date(2026, 9, 21, 12).getTime();
    const end = new Date(2026, 8, 1).getTime();
    const postedDaily = entry({ cropYear: 2026, month: 8, cashQuoteAsOf: new Date(end - 2 * 86_400_000).toISOString() });
    const wentQuiet = entry({ cropYear: 2026, month: 8, cashQuoteAsOf: new Date(end - 17 * 86_400_000).toISOString() });
    expect(classifyBidSide(postedDaily, 'cash', 10, now, periodEnd(2026, 8, now)).stale).toBe(false);
    expect(classifyBidSide(wentQuiet, 'cash', 10, now, periodEnd(2026, 8, now)).stale).toBe(true);
  });
});

describe('asOfTitle', () => {
  const fmt = (iso?: string): string => (iso ? 'Oct 7' : '');

  it('names the when, and only the when', () => {
    expect(asOfTitle({ value: '4.47', asOf: daysAgo(1), stale: false, kind: 'feed' }, fmt)).toBe('Updated Oct 7');
    expect(asOfTitle({ value: '', asOf: daysAgo(14), stale: true, kind: 'feed' }, fmt)).toBe('Not updated since Oct 7');
    expect(asOfTitle({ value: '4.10', asOf: daysAgo(0), stale: false, kind: 'manual' }, fmt)).toBe('Updated Oct 7');
  });

  it('says nothing for an empty cell or one with no date', () => {
    expect(asOfTitle({ value: '', stale: false, kind: 'none' }, fmt)).toBe('');
    expect(asOfTitle({ value: '4.47', stale: false, kind: 'feed' }, fmt)).toBe('');
  });
});
