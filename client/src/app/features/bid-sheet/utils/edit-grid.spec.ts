import { describe, expect, it } from 'vitest';
import { BidSheetLocation, BidSheetLocationBid, Commodity } from '@models';
import { buildBidLookup, flattenBidEntries } from './bid-math';
import {
  applyBidsToLocations,
  applySavedOrder,
  arrowKeyTarget,
  buildDirtyBids,
  buildEditGridColumns,
  buildEditGridRows,
  clearDirtyForSaved,
  defaultMonthOrder,
  DirtyBid,
  EditBidsRow,
  editBidsMonthsLabel,
  orderEditBidsCrops,
  reorderCropsByColumnDrop,
  savedBidKey,
  setRowBid,
  toggleMonth,
  withHiddenCropsLast,
} from './edit-grid';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const bid = (locationId: number, commodityCode: string, cropYear: number, value: string, month = 0): BidSheetLocationBid => ({
  id: locationId * 100 + cropYear, locationId, commodityCode, cropYear, month, bid: value, createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z',
});
const loc = (id: number, name: string, bids: BidSheetLocationBid[], over: Partial<BidSheetLocation> = {}): BidSheetLocation => ({
  id, name, tradeUnitCode: '2040', createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z', bids, ...over,
});

const ALPHA = loc(1, 'Alpha', [bid(1, 'YC', 2026, '4.10'), bid(1, 'SB', 2026, '10.00'), bid(1, 'YC', 2026, '4.05', 5)], { elevatorCode: 'ALP', latitude: 1, longitude: -1 });
const BRAVO = loc(2, 'Bravo', [bid(2, 'YC', 2026, '4.25')], { tradeUnitCode: '2050' });
const CHARLIE = loc(3, 'Charlie', []);
const LOCS = [ALPHA, BRAVO, CHARLIE];
const ENTRIES = flattenBidEntries(LOCS);
const LOOKUP = buildBidLookup(ENTRIES);

const row = (name: string, bids: Record<string, string>, originalBids = bids, over: Partial<EditBidsRow> = {}): EditBidsRow =>
  ({ name, type: 'entry', bids: { ...bids }, originalBids: { ...originalBids }, ...over });

// ── Columns ─────────────────────────────────────────────────────────────────────────────────────

describe('columns', () => {
  it('orderEditBidsCrops drops hidden crops and applies the saved order, unknown crops last', () => {
    expect(orderEditBidsCrops(['SB', 'WHT', 'YC'], new Set(['WHT']), undefined)).toEqual(['SB', 'YC']);
    expect(orderEditBidsCrops(['SB', 'WHT', 'YC', 'OAT'], new Set(), ['YC', 'SB'])).toEqual(['YC', 'SB', 'WHT', 'OAT']);
    expect(orderEditBidsCrops(['SB', 'YC'], new Set(), [])).toEqual(['SB', 'YC']);
  });

  it('buildEditGridColumns crosses crops × months in month order, labelling the year or the month', () => {
    expect(buildEditGridColumns(['YC', 'SB'], [0, 5], 2026)).toEqual([
      { key: 'YC#0', crop: 'YC', month: 0, label: 'YC 2026' },
      { key: 'YC#5', crop: 'YC', month: 5, label: 'YC May' },
      { key: 'SB#0', crop: 'SB', month: 0, label: 'SB 2026' },
      { key: 'SB#5', crop: 'SB', month: 5, label: 'SB May' },
    ]);
    expect(buildEditGridColumns(['YC'], [12, 1], 2026).map(c => c.label)).toEqual(['YC Dec', 'YC Jan']);
  });

  it('editBidsMonthsLabel summarises the selection', () => {
    expect(editBidsMonthsLabel([0])).toBe('Year');
    expect(editBidsMonthsLabel([4])).toBe('1 Month');
    expect(editBidsMonthsLabel([4, 5])).toBe('2 Months');
    expect(editBidsMonthsLabel([0, 4, 5])).toBe('2 Months + Year');
  });

  it('toggleMonth adds/removes and falls back to Yearly when emptied; defaultMonthOrder puts Yearly first', () => {
    expect(toggleMonth([0], 6)).toEqual([0, 6]);
    expect(toggleMonth([0, 6], 0)).toEqual([6]);
    expect(toggleMonth([6], 6)).toEqual([0]);
    expect(defaultMonthOrder([6, 3, 0, 3])).toEqual([0, 3, 6]);
    expect(defaultMonthOrder([11, 2])).toEqual([2, 11]);
  });

  it('applySavedOrder sorts in place by the saved keys and leaves the input alone without one', () => {
    const items = ['c', 'a', 'b'];
    expect(applySavedOrder(items, ['b', 'c'], x => x)).toBe(items);
    expect(items).toEqual(['b', 'c', 'a']);
    expect(applySavedOrder(['c', 'a'], undefined, x => x)).toEqual(['c', 'a']);
  });
});

// ── Rows ────────────────────────────────────────────────────────────────────────────────────────

describe('buildEditGridRows', () => {
  const columns = buildEditGridColumns(['SB', 'YC'], [0, 5], 2026);

  it('one row per bidding location then each bid-less location, values per column with a snapshot', () => {
    const rows = buildEditGridRows(ENTRIES, LOCS, columns, LOOKUP, 2026, undefined);
    expect(rows.map(r => [r.name, r.bids])).toEqual([
      ['Alpha', { 'SB#0': '10.00', 'SB#5': '', 'YC#0': '4.10', 'YC#5': '4.05' }],
      ['Bravo', { 'SB#0': '', 'SB#5': '', 'YC#0': '4.25', 'YC#5': '' }],
      ['Charlie', { 'SB#0': '', 'SB#5': '', 'YC#0': '', 'YC#5': '' }],
    ]);
    expect(rows[0]).toMatchObject({ type: 'entry', elevatorCode: 'ALP', tradeUnitCode: '2040', latitude: 1, longitude: -1 });
    expect(rows[1].tradeUnitCode).toBe('2050');
    expect(rows[0].originalBids).toEqual(rows[0].bids);
    expect(rows[0].originalBids).not.toBe(rows[0].bids);
  });

  it('reads the requested crop year and applies the saved location order', () => {
    const rows = buildEditGridRows(ENTRIES, LOCS, columns, LOOKUP, 2027, ['Charlie', 'Bravo']);
    expect(rows.map(r => r.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(rows.every(r => Object.values(r.bids).every(v => v === ''))).toBe(true);
  });

  it('setRowBid changes one cell without mutating the input', () => {
    const rows = [row('Alpha', { 'YC#0': '4.10' })];
    const next = setRowBid(rows, 0, 'YC#0', '4.30');
    expect(next[0].bids['YC#0']).toBe('4.30');
    expect(rows[0].bids['YC#0']).toBe('4.10');
    expect(next[0].originalBids['YC#0']).toBe('4.10');
  });
});

// ── Reordering / navigation ─────────────────────────────────────────────────────────────────────

describe('reordering and navigation', () => {
  it('a column drop reorders whole crops and parks hidden crops at the end', () => {
    const columns = buildEditGridColumns(['SB', 'YC'], [0, 5], 2026); // SB#0 SB#5 YC#0 YC#5
    expect(reorderCropsByColumnDrop(columns, ['SB', 'YC'], ['SB', 'WHT', 'YC'], new Set(['WHT']), 0, 3)).toEqual(['YC', 'SB', 'WHT']);
    expect(reorderCropsByColumnDrop(columns, ['SB', 'YC'], ['SB', 'YC'], new Set(), 0, 1)).toBeNull(); // same crop
    expect(reorderCropsByColumnDrop(columns, ['SB', 'YC'], ['SB', 'YC'], new Set(), 0, 9)).toBeNull(); // off the end
    expect(withHiddenCropsLast(['YC'], ['SB', 'WHT', 'YC'], new Set(['WHT', 'SB']))).toEqual(['YC', 'SB', 'WHT']);
  });

  it('arrowKeyTarget moves one cell, clamps at the edges and ignores other keys', () => {
    expect(arrowKeyTarget('ArrowDown', 0, 1, 3, 2)).toEqual({ row: 1, col: 1 });
    expect(arrowKeyTarget('ArrowUp', 2, 0, 3, 2)).toEqual({ row: 1, col: 0 });
    expect(arrowKeyTarget('ArrowLeft', 1, 1, 3, 2)).toEqual({ row: 1, col: 0 });
    expect(arrowKeyTarget('ArrowRight', 1, 0, 3, 2)).toEqual({ row: 1, col: 1 });
    expect(arrowKeyTarget('ArrowUp', 0, 0, 3, 2)).toBeNull();
    expect(arrowKeyTarget('ArrowDown', 2, 0, 3, 2)).toBeNull();
    expect(arrowKeyTarget('ArrowRight', 0, 1, 3, 2)).toBeNull();
    expect(arrowKeyTarget('Tab', 0, 0, 3, 2)).toBeNull();
  });
});

// ── Saving ──────────────────────────────────────────────────────────────────────────────────────

describe('saving', () => {
  const COMMODITIES: Commodity[] = [{ id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }];
  const columns = buildEditGridColumns(['YC', 'SB'], [0], 2026);
  const groupFor = (tu: string) => (tu === '2040' ? 'Kansas' : '');

  it('buildDirtyBids emits only trimmed changed cells, falling back to the active trade unit', () => {
    const rows = [
      row('Alpha', { 'YC#0': ' 4.30 ', 'SB#0': '10.00' }, { 'YC#0': '4.10', 'SB#0': '10.00' }, { tradeUnitCode: '2050', latitude: 1, longitude: -1, elevatorCode: 'ALP' }),
      row('Bravo', { 'YC#0': '4.25 ', 'SB#0': '' }, { 'YC#0': '4.25', 'SB#0': '' }),
      row('Charlie', { 'YC#0': '', 'SB#0': '9.00' }, { 'YC#0': '', 'SB#0': '' }),
    ];
    expect(buildDirtyBids(rows, columns, 2026, '2040', COMMODITIES, groupFor)).toEqual([
      { name: 'Alpha', latitude: 1, longitude: -1, elevatorCode: 'ALP', tradeUnitCode: '2050', groupName: undefined, commodityCode: 'YC', commodityName: 'Yellow Corn', commodityCategory: 'Corn', cropYear: 2026, bid: '4.30', month: 0 },
      { name: 'Charlie', latitude: undefined, longitude: undefined, elevatorCode: undefined, tradeUnitCode: '2040', groupName: 'Kansas', commodityCode: 'SB', commodityName: undefined, commodityCategory: undefined, cropYear: 2026, bid: '9.00', month: 0 },
    ]);
  });

  it('clearDirtyForSaved snapshots the SAVED value, so a cell edited mid-save stays dirty', () => {
    const rows = [row('Alpha', { 'YC#0': '4.35', 'YC#5': '1' }, { 'YC#0': '4.10', 'YC#5': '' }), row('Bravo', { 'YC#0': '4.25' })];
    const next = clearDirtyForSaved(rows, [{ name: 'Alpha', commodityCode: 'YC', month: 0, bid: '4.30' }, { name: undefined, commodityCode: 'YC', bid: 'x' }]);
    expect(next[0].originalBids).toEqual({ 'YC#0': '4.30', 'YC#5': '' });
    expect(next[0].bids['YC#0']).toBe('4.35');
    expect(next[1]).toBe(rows[1]);
  });

  it('applyBidsToLocations updates or adds matching cells and keeps the array when nothing matches', () => {
    const now = '2026-10-13T12:00:00.000Z';
    const dirty: DirtyBid[] = [
      { name: 'Alpha', tradeUnitCode: '2040', commodityCode: 'YC', cropYear: 2026, bid: '4.30', month: 0, commodityName: 'Yellow Corn' },
      { name: 'Alpha', tradeUnitCode: '2040', commodityCode: 'YC', cropYear: 2027, bid: '4.50' },
      { name: 'Bravo', tradeUnitCode: '2040', commodityCode: 'YC', cropYear: 2026, bid: '9.99', month: 0 }, // wrong TU → ignored
    ];
    const next = applyBidsToLocations(LOCS, dirty, now);
    const alpha = next.find(l => l.name === 'Alpha')!;
    expect(alpha.bids[0]).toEqual({ ...ALPHA.bids[0], bid: '4.30', commodityName: 'Yellow Corn', modifiedAt: now });
    expect(alpha.bids[3]).toEqual({ id: 0, locationId: 1, commodityCode: 'YC', commodityName: undefined, commodityCategory: undefined, cropYear: 2027, month: 0, bid: '4.50', createdBy: '', createdAt: now, modifiedAt: now });
    expect(next.find(l => l.name === 'Bravo')).toBe(BRAVO);
    expect(ALPHA.bids).toHaveLength(3); // input untouched

    expect(applyBidsToLocations(LOCS, [{ name: 'Nobody', commodityCode: 'YC', cropYear: 2026, bid: '1' }], now)).toBe(LOCS);
  });

  it('savedBidKey identifies a cell by name, crop, year and month', () => {
    expect(savedBidKey({ name: 'Alpha', commodityCode: 'YC', cropYear: 2026 })).toBe('Alpha|YC|2026|0');
    expect(savedBidKey({ name: 'Alpha', commodityCode: 'YC', cropYear: 2026, month: 5 })).toBe('Alpha|YC|2026|5');
  });
});
