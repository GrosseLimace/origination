import { describe, expect, it } from 'vitest';
import { BidSheetLocation } from '@models';
import {
  GLOBAL_PREF_KEY, mergeTradeUnitLoads, parseHiddenCrops, pickSelectedYear, preferredSelection, StoredBidSheetPreference, yearOffsetFor,
} from './bid-sheet-load';

const loc = (id: number): BidSheetLocation => ({ id, name: `L${id}`, tradeUnitCode: '2040', createdBy: 'rep', createdAt: '', bids: [] });
const pref = (over: Partial<StoredBidSheetPreference>): StoredBidSheetPreference =>
  ({ cropCode: null, month: null, cropYear: null, hiddenCrops: null, ...over });

describe('mergeTradeUnitLoads', () => {
  it('concatenates locations and de-duplicates / sorts crop years and crops', () => {
    const merged = mergeTradeUnitLoads([
      { locations: [loc(1), loc(2)], cropYears: [2026, 2025], bidCommodities: ['YC', 'SB'] },
      { locations: [loc(3)], cropYears: [2024, 2026], bidCommodities: ['YC', 'WHT'] },
    ], 2026);
    expect(merged.locations.map(l => l.id)).toEqual([1, 2, 3]);
    expect(merged.cropYears).toEqual([2024, 2025, 2026]);
    expect(merged.crops).toEqual(['SB', 'WHT', 'YC']);
  });

  it('falls back to the current year when nobody has crop years yet', () => {
    expect(mergeTradeUnitLoads([{ locations: [], cropYears: [], bidCommodities: [] }], 2026).cropYears).toEqual([2026]);
  });
});

describe('pickSelectedYear / yearOffsetFor', () => {
  it('keeps a year with data, else the current year, else the latest', () => {
    expect(pickSelectedYear([2025, 2026, 2027], 2025, 2026)).toBe(2025);
    expect(pickSelectedYear([2025, 2026, 2027], 2019, 2026)).toBe(2026);
    expect(pickSelectedYear([2024, 2027], 2019, 2026)).toBe(2027);
  });

  it('counts back from the latest year, null when the year has no data', () => {
    expect(yearOffsetFor([2024, 2025, 2026], 2026)).toBe(0);
    expect(yearOffsetFor([2024, 2025, 2026], 2024)).toBe(-2);
    expect(yearOffsetFor([2024, 2025, 2026], 2030)).toBeNull();
  });
});

describe('preferredSelection', () => {
  it('takes each field from the per-key preference, else the global one, else null', () => {
    expect(preferredSelection(pref({ cropCode: 'YC', month: 0 }), pref({ cropCode: 'SB', month: 4, cropYear: 2025 })))
      .toEqual({ crop: 'YC', month: 0, year: 2025 });
    expect(preferredSelection(null, null)).toEqual({ crop: null, month: null, year: null });
  });

  it('uses a stable key for the global preference', () => {
    expect(GLOBAL_PREF_KEY).toBe('__global__');
  });
});

describe('parseHiddenCrops', () => {
  it('reads a saved list; nothing saved or unreadable means none hidden', () => {
    expect([...parseHiddenCrops('["SB","YC"]')]).toEqual(['SB', 'YC']);
    expect(parseHiddenCrops(null).size).toBe(0);
    expect(parseHiddenCrops('').size).toBe(0);
    expect(parseHiddenCrops('{bad').size).toBe(0);
    expect(parseHiddenCrops('5').size).toBe(0); // not iterable
  });
});
