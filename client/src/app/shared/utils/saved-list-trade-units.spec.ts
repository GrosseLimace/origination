import { describe, it, expect } from 'vitest';
import {
  parseSavedListTradeUnits,
  savedListOverlapsTradeUnits,
  filterSavedListsByTradeUnitOverlap,
} from './saved-list-trade-units';

// A saved list is stamped with the trade units it was saved under and shown whenever ANY of them is
// selected. The exact-set match this replaced hid an [A,B] list from someone viewing [A,C,D].
const list = (tradeUnits?: string) => ({ tradeUnits });

describe('parseSavedListTradeUnits', () => {
  it('returns no codes for a missing or blank CSV', () => {
    expect(parseSavedListTradeUnits(undefined)).toEqual([]);
    expect(parseSavedListTradeUnits(null)).toEqual([]);
    expect(parseSavedListTradeUnits(list(undefined))).toEqual([]);
    expect(parseSavedListTradeUnits(list('  '))).toEqual([]);
  });

  it('trims, drops blanks, de-dupes and keeps CSV order', () => {
    expect(parseSavedListTradeUnits(list(' 2090 , 2291 ,, 2090 ,'))).toEqual(['2090', '2291']);
  });
});

describe('savedListOverlapsTradeUnits', () => {
  it('matches an identical set regardless of order', () => {
    expect(savedListOverlapsTradeUnits(list('2090,2291'), ['2291', '2090'])).toBe(true);
  });

  it('matches on a partial overlap — the [A,B] list shows under [A,C,D]', () => {
    expect(savedListOverlapsTradeUnits(list('2090,2291'), ['2090', '2305', '2400'])).toBe(true);
  });

  it('matches when only one of the list\'s trade units is selected', () => {
    expect(savedListOverlapsTradeUnits(list('2090,2291'), ['2291'])).toBe(true);
  });

  it('rejects disjoint sets', () => {
    expect(savedListOverlapsTradeUnits(list('2090,2291'), ['2305'])).toBe(false);
  });

  it('is false when either side is empty', () => {
    expect(savedListOverlapsTradeUnits(list(undefined), ['2090'])).toBe(false);
    expect(savedListOverlapsTradeUnits(list('2090'), [])).toBe(false);
  });

  it('tolerates whitespace in the stored CSV', () => {
    expect(savedListOverlapsTradeUnits(list(' 2090 , 2291 '), ['2291'])).toBe(true);
  });
});

describe('filterSavedListsByTradeUnitOverlap', () => {
  const inside = { id: 1, tradeUnits: '2090' };
  const partial = { id: 2, tradeUnits: '2090,2291' };
  const disjoint = { id: 3, tradeUnits: '2400' };
  const unscoped = { id: 4, tradeUnits: undefined };

  it('keeps exact and partial overlaps, drops disjoint and unscoped lists', () => {
    const out = filterSavedListsByTradeUnitOverlap([partial, disjoint, unscoped, inside], ['2090']);
    expect(out.map(l => l.id).sort()).toEqual([1, 2]);
  });

  it('orders wholly-inside lists before partial-overlap lists, keeping input order within each', () => {
    const inside2 = { id: 5, tradeUnits: '2090' };
    const out = filterSavedListsByTradeUnitOverlap([partial, inside, inside2], ['2090']);
    expect(out.map(l => l.id)).toEqual([1, 5, 2]);
  });

  it('shows nothing when no trade unit is selected', () => {
    expect(filterSavedListsByTradeUnitOverlap([inside, partial], [])).toEqual([]);
  });
});
