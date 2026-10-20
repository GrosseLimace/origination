import { describe, expect, it } from 'vitest';
import { BidSheetLocation, BidSheetLocationBid } from '@models';
import {
  bidLookupKey,
  buildBidLookup,
  buildPanelItems,
  buildPanelLocationBids,
  computeItemStatus,
  deriveAllProducersFilters,
  flattenBidEntries,
  formatMonthYear,
  lookupBid,
  PanelItemsInput,
  parseBid,
} from './bid-math';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

let seq = 1;
const bid = (locationId: number, commodityCode: string, cropYear: number, value: string, over: Partial<BidSheetLocationBid> = {}): BidSheetLocationBid => ({
  id: seq++, locationId, commodityCode, cropYear, month: 0, bid: value, createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z', ...over,
});
const loc = (id: number, name: string, bids: BidSheetLocationBid[], over: Partial<BidSheetLocation> = {}): BidSheetLocation => ({
  id, name, tradeUnitCode: '2040', createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z', latitude: id, longitude: -id, bids, ...over,
});

const ALPHA = loc(1, 'Alpha', [bid(1, 'YC', 2026, '4.10'), bid(1, 'YC', 2025, '3.90'), bid(1, 'SB', 2026, '10.00')]);
const BRAVO = loc(2, 'Bravo', [bid(2, 'YC', 2026, '4.25'), bid(2, 'YC', 2025, '3.90')]);
const CHARLIE = loc(3, 'Charlie', [], { isScoularFacility: true });
const LOCS = [ALPHA, BRAVO, CHARLIE];
const ENTRIES = flattenBidEntries(LOCS);
const LOOKUP = buildBidLookup(ENTRIES);

function panelInput(over: Partial<PanelItemsInput> = {}): PanelItemsInput {
  return {
    hasTu: true, hasCropYears: true, basis: 'all', crop: 'YC',
    oldD: { month: 0, year: 2025 }, newD: { month: 0, year: 2026 }, selected: { month: 0, year: 2026 },
    refName: '', entries: ENTRIES, lookup: LOOKUP, allMapLocations: LOCS, bidLocations: LOCS, ...over,
  };
}

// ── Formatting / parsing ────────────────────────────────────────────────────────────────────────

describe('formatMonthYear', () => {
  it('formats a year, a month + 2-digit year, or nothing', () => {
    expect(formatMonthYear(0, 2026)).toBe('2026');
    expect(formatMonthYear(12, 2025)).toBe('Dec 25');
    expect(formatMonthYear(1, null)).toBe('');
  });
});

describe('parseBid / computeItemStatus', () => {
  it('parses leading numbers and rejects text', () => {
    expect(parseBid('4.10')).toBe(4.1);
    expect(parseBid('-0.25 basis')).toBe(-0.25);
    expect(parseBid('N/A')).toBeNull();
    expect(parseBid('')).toBeNull();
  });

  it('grades a bid against the reference: higher beats, equal matches, anything else is none', () => {
    expect(computeItemStatus('4.30', false, 4.1)).toBe('beating');
    expect(computeItemStatus('4.10', false, 4.1)).toBe('matching');
    expect(computeItemStatus('4.00', false, 4.1)).toBe('none');
    expect(computeItemStatus('N/A', false, 4.1)).toBe('none');
    expect(computeItemStatus('4.30', false, null)).toBe('none');
    expect(computeItemStatus('', true, null)).toBe('reference');
  });
});

// ── Entries and lookup ──────────────────────────────────────────────────────────────────────────

describe('flattenBidEntries', () => {
  it('emits one entry per bid carrying its location fields, skipping bid-less locations', () => {
    expect(ENTRIES).toHaveLength(5);
    expect(ENTRIES[0]).toMatchObject({ locationId: 1, name: 'Alpha', tradeUnitCode: '2040', latitude: 1, longitude: -1, commodityCode: 'YC', cropYear: 2026, bid: '4.10' });
    expect(ENTRIES.some(e => e.name === 'Charlie')).toBe(false);
  });
});

describe('buildBidLookup / lookupBid', () => {
  it('keys by name|crop|year|month and keeps the most recently modified (else created) duplicate', () => {
    const dupes = flattenBidEntries([loc(9, 'Dup', [
      bid(9, 'YC', 2026, 'old', { createdAt: '2026-01-01T00:00:00Z' }),
      bid(9, 'YC', 2026, 'newest', { createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-05-01T00:00:00Z' }),
      bid(9, 'YC', 2026, 'middle', { createdAt: '2026-03-01T00:00:00Z' }),
    ])]);
    const lookup = buildBidLookup(dupes);
    expect(bidLookupKey('Dup', 'YC', 2026, 0)).toBe('Dup|YC|2026|0');
    expect(lookup.get('Dup|YC|2026|0')?.bid).toBe('newest');
  });

  it('returns an empty string when there is no year, crop or bid', () => {
    expect(lookupBid(LOOKUP, 'Alpha', 2026, 'YC', 0)).toBe('4.10');
    expect(lookupBid(LOOKUP, 'Alpha', null, 'YC', 0)).toBe('');
    expect(lookupBid(LOOKUP, 'Alpha', 2026, '', 0)).toBe('');
    expect(lookupBid(LOOKUP, 'Alpha', 2026, 'YC', 5)).toBe('');
  });
});

describe('deriveAllProducersFilters', () => {
  it('collects distinct crops (alphabetical) and crop years (ascending) across every location', () => {
    expect(deriveAllProducersFilters([...LOCS, loc(4, 'Delta', [bid(4, 'YC', 2024, '3.50')])])).toEqual({ crops: ['SB', 'YC'], years: [2024, 2025, 2026] });
    expect(deriveAllProducersFilters([CHARLIE])).toEqual({ crops: [], years: [] });
  });
});

// ── Panel list ──────────────────────────────────────────────────────────────────────────────────

describe('buildPanelItems', () => {
  const names = (items: { name: string }[]) => items.map(i => i.name);

  it('lists locations bidding the selected crop alphabetically with old/new bids and no status', () => {
    const items = buildPanelItems(panelInput());
    expect(items.map(i => [i.name, i.oldBid, i.newBid, i.status])).toEqual([['Alpha', '3.90', '4.10', 'none'], ['Bravo', '3.90', '4.25', 'none']]);
    expect(items[0]).toMatchObject({ type: 'entry', isScoular: false, isRef: false, latitude: 1, longitude: -1 });
  });

  it('puts the reference first and grades every period against the reference\'s own bid for it', () => {
    const items = buildPanelItems(panelInput({ refName: 'Alpha' }));
    expect(items.map(i => [i.name, i.oldStatus, i.newStatus, i.status])).toEqual([
      ['Alpha', 'reference', 'reference', 'reference'],
      ['Bravo', 'matching', 'beating', 'beating'],
    ]);
  });

  it('the basis filter keeps matching rows and always the reference', () => {
    expect(names(buildPanelItems(panelInput({ refName: 'Alpha', basis: 'beating' })))).toEqual(['Alpha', 'Bravo']);
    expect(names(buildPanelItems(panelInput({ refName: 'Alpha', basis: 'matching' })))).toEqual(['Alpha']);
  });

  it('adds the reference even without a bid for the crop, and bid-less locations only with no crop filter', () => {
    expect(names(buildPanelItems(panelInput({ crop: 'SB', refName: 'Bravo' })))).toEqual(['Bravo', 'Alpha']);
    const all = buildPanelItems(panelInput({ crop: '' }));
    expect(names(all)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(all[2]).toMatchObject({ isScoular: true, oldBid: '', newBid: '', oldStatus: 'none', newStatus: 'none', status: 'none' });
  });

  it('with no trade unit and no crop-year data lists each map location once by name only', () => {
    const items = buildPanelItems(panelInput({ hasTu: false, hasCropYears: false, allMapLocations: [CHARLIE, ALPHA, { ...CHARLIE, id: 30 }] }));
    expect(items).toEqual([
      { type: 'entry', name: 'Alpha', isScoular: false, isRef: false, latitude: 1, longitude: -1, oldBid: '', newBid: '', status: 'none' },
      { type: 'entry', name: 'Charlie', isScoular: true, isRef: false, latitude: 3, longitude: -3, oldBid: '', newBid: '', status: 'none' },
    ]);
  });

  it('All Producers (no trade unit, but crop-year data) still compares against the reference', () => {
    const items = buildPanelItems(panelInput({ hasTu: false, refName: 'Alpha' }));
    expect(items.map(i => [i.name, i.status])).toEqual([['Alpha', 'reference'], ['Bravo', 'beating']]);
  });
});

describe('buildPanelLocationBids', () => {
  const oldD = { month: 0, year: 2025 }, newD = { month: 0, year: 2026 };

  it('lists the location\'s crops that have a bid in either displayed period, graded vs the reference', () => {
    expect(buildPanelLocationBids('Alpha', ENTRIES, LOOKUP, oldD, newD, 'Bravo')).toEqual([
      { crop: 'SB', oldBid: '', newBid: '10.00', oldStatus: 'none', newStatus: 'none' },
      { crop: 'YC', oldBid: '3.90', newBid: '4.10', oldStatus: 'matching', newStatus: 'none' },
    ]);
  });

  it('marks every row as reference for the reference itself, and drops crops with no bid in either period', () => {
    expect(buildPanelLocationBids('Bravo', ENTRIES, LOOKUP, oldD, newD, 'Bravo')).toEqual([
      { crop: 'YC', oldBid: '3.90', newBid: '4.25', oldStatus: 'reference', newStatus: 'reference' },
    ]);
    expect(buildPanelLocationBids('Alpha', ENTRIES, LOOKUP, { month: 3, year: 2026 }, { month: 4, year: 2026 }, '')).toEqual([]);
    expect(buildPanelLocationBids('', ENTRIES, LOOKUP, oldD, newD, '')).toEqual([]);
  });
});
