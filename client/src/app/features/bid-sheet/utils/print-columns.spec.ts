import { describe, expect, it } from 'vitest';
import { BidSheetLocation } from '@models';
import { buildBidLookup, flattenBidEntries } from './bid-math';
import {
  addYearlyRow,
  buildPrintCropGroups,
  buildPrintLocations,
  defaultPrintYearlyRows,
  formatPhoneInput,
  MAX_PRINT_YEARLY_ROWS,
  parsePrintLayoutPreference,
  printCellValue,
  printMonthName,
  printPreviewZoom,
  PrintYearRow,
  removeYearlyRow,
  serializePrintLayout,
  setYearlyRowOffset,
  setYearlyRowOldNew,
  tintHex,
  toggleYearlyRow,
} from './print-columns';

const LOCS: BidSheetLocation[] = [{
  id: 1, name: 'Alpha', tradeUnitCode: '2040', createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z',
  bids: [{ id: 1, locationId: 1, commodityCode: 'YC', cropYear: 2025, month: 0, bid: ' 3.90 ', createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z' }],
}];
const LOOKUP = buildBidLookup(flattenBidEntries(LOCS));
const ids = () => { let n = 0; return () => `id${n++}`; };

describe('printMonthName', () => {
  it('names months, calls 0 the Year, and is empty out of range', () => {
    expect(printMonthName(0)).toBe('Year');
    expect(printMonthName(1)).toBe('Jan');
    expect(printMonthName(12)).toBe('Dec');
    expect(printMonthName(13)).toBe('');
  });
});

describe('buildPrintCropGroups', () => {
  const rows: PrintYearRow[] = [
    { id: 'a', enabled: true, offset: -1, oldNew: 'old' },
    { id: 'b', enabled: true, offset: 0, oldNew: 'new' },
    { id: 'c', enabled: true, offset: 1, oldNew: '' },
    { id: 'd', enabled: false, offset: 2, oldNew: 'new' },
  ];

  it('one column per enabled Yearly row and per selected month, in grid order', () => {
    const groups = buildPrintCropGroups(['YC', 'SB', 'WHT'], [5, 0], new Set(['WHT', 'YC']), new Set([0, 5]), 2026, rows);
    expect(groups.map(g => g.crop)).toEqual(['YC', 'WHT']);
    expect(groups[0].columns).toEqual([
      { key: 'YC#5', crop: 'YC', month: 5, year: 2026, label: 'May (2026)', compactLabel: 'May 26' },
      { key: 'YC#0#a', crop: 'YC', month: 0, year: 2025, label: 'Old Crop (2025)', compactLabel: 'O/C 25' },
      { key: 'YC#0#b', crop: 'YC', month: 0, year: 2026, label: 'New Crop (2026)', compactLabel: 'N/C 26' },
      { key: 'YC#0#c', crop: 'YC', month: 0, year: 2027, label: '2027', compactLabel: '2027' },
    ]);
  });

  it('a crop with no selected periods keeps an empty group', () => {
    expect(buildPrintCropGroups(['YC'], [0], new Set(['YC']), new Set(), 2026, rows)).toEqual([{ crop: 'YC', columns: [] }]);
  });
});

describe('print cell values and locations', () => {
  const row = { name: 'Alpha', bids: { 'YC#0': ' 4.40 ' } };

  it('the viewed year reads the live (trimmed) grid value, other years the saved bid', () => {
    expect(printCellValue(row, { crop: 'YC', month: 0, year: 2026 }, 2026, LOOKUP)).toBe('4.40');
    expect(printCellValue(row, { crop: 'YC', month: 0, year: 2025 }, 2026, LOOKUP)).toBe('3.90');
    expect(printCellValue(row, { crop: 'SB', month: 0, year: 2026 }, 2026, LOOKUP)).toBe('');
  });

  it('buildPrintLocations resolves every column and folds the Highlight toggle into isScoular', () => {
    const groups = buildPrintCropGroups(['YC'], [0], new Set(['YC']), new Set([0]), 2026, defaultPrintYearlyRows());
    const ours = new Set(['Alpha']);
    expect(buildPrintLocations([row], groups, true, ours, 2026, LOOKUP)).toEqual([
      { name: 'Alpha', isScoular: true, values: { 'YC#0#yr-old': '3.90', 'YC#0#yr-new': '4.40' } },
    ]);
    expect(buildPrintLocations([row], groups, false, ours, 2026, LOOKUP)[0].isScoular).toBe(false);
  });
});

describe('dialog helpers', () => {
  it('tintHex blends toward white', () => {
    expect(tintHex('#000000', 0.5)).toBe('#808080');
    expect(tintHex('#00875F', 0)).toBe('#00875f');
    expect(tintHex('#123456', 1)).toBe('#ffffff');
  });

  it('formatPhoneInput keeps ten digits as "(402) 555-1234" while typing', () => {
    expect(formatPhoneInput('')).toBe('');
    expect(formatPhoneInput('40')).toBe('(40');
    expect(formatPhoneInput('402-55')).toBe('(402) 55');
    expect(formatPhoneInput('(402) 555-12345678')).toBe('(402) 555-1234');
  });

  it('printPreviewZoom fits 90% of the pane, bounded to 0.5–1.1, and is 1 before measuring', () => {
    expect(printPreviewZoom(0, 1000)).toBe(1);
    expect(printPreviewZoom(1000, 1000)).toBe(0.9);
    expect(printPreviewZoom(5000, 1000)).toBe(1.1);
    expect(printPreviewZoom(100, 1000)).toBe(0.5);
  });
});

describe('persisted print layout', () => {
  it('round-trips without row ids', () => {
    const json = serializePrintLayout({ yearlyRows: defaultPrintYearlyRows(), address: 'A', phone: 'P', highlightScoular: false, layoutStyle: 'locationsAcross' });
    expect(JSON.parse(json)).toEqual({
      yearlyRows: [{ enabled: true, offset: -1, oldNew: 'old' }, { enabled: true, offset: 0, oldNew: 'new' }],
      address: 'A', phone: 'P', highlightScoular: false, layoutStyle: 'locationsAcross',
    });
    expect(parsePrintLayoutPreference(json, ids())).toEqual({
      yearlyRows: [{ id: 'id0', enabled: true, offset: -1, oldNew: 'old' }, { id: 'id1', enabled: true, offset: 0, oldNew: 'new' }],
      address: 'A', phone: 'P', highlightScoular: false, layoutStyle: 'locationsAcross',
    });
  });

  it('sanitises rows: capped count, offsets clamped and truncated, unknown labels → plain year', () => {
    const rows = [{ offset: -9, enabled: false }, { offset: '1.9', oldNew: 'x' }, null, {}, {}, { offset: 1 }];
    const parsed = parsePrintLayoutPreference(JSON.stringify({ yearlyRows: rows }), ids())!;
    expect(parsed.yearlyRows!.map(({ enabled, offset, oldNew }) => [enabled, offset, oldNew])).toEqual([
      [false, -2, ''], [true, 1, ''], [true, 0, ''], [true, 0, ''], [true, 0, ''],
    ]);
    expect(parsed.yearlyRows).toHaveLength(MAX_PRINT_YEARLY_ROWS);
  });

  it('omits absent or mistyped fields, defaults retired layout styles, and returns null for bad JSON', () => {
    expect(parsePrintLayoutPreference('{"yearlyRows":[],"address":5,"layoutStyle":"stacked"}', ids())).toEqual({ layoutStyle: 'locationsDown' });
    expect(parsePrintLayoutPreference('null', ids())).toEqual({ layoutStyle: 'locationsDown' });
    expect(parsePrintLayoutPreference('{oops', ids())).toBeNull();
  });
});

describe('Yearly columns builder', () => {
  const start = defaultPrintYearlyRows();

  it('adds plain rows up to the cap and never removes the last row', () => {
    let rows = start;
    const next = ids();
    while (rows.length < MAX_PRINT_YEARLY_ROWS) rows = addYearlyRow(rows, next);
    expect(rows.at(-1)).toEqual({ id: 'id2', enabled: true, offset: 0, oldNew: '' });
    expect(addYearlyRow(rows, next)).toBe(rows);
    expect(removeYearlyRow(start, 'yr-old').map(r => r.id)).toEqual(['yr-new']);
    const single = removeYearlyRow(start, 'yr-old');
    expect(removeYearlyRow(single, 'yr-new')).toBe(single);
  });

  it('toggles, re-years (clamped) and relabels one row', () => {
    expect(toggleYearlyRow(start, 'yr-new').map(r => r.enabled)).toEqual([true, false]);
    expect(setYearlyRowOffset(start, 'yr-new', 9)[1].offset).toBe(2);
    expect(setYearlyRowOffset(start, 'yr-new', -9)[1].offset).toBe(-2);
    expect(setYearlyRowOldNew(start, 'yr-old', 'new')[0].oldNew).toBe('new');
    expect(setYearlyRowOldNew(start, 'yr-old', 'bogus')[0].oldNew).toBe('');
    expect(start).toEqual(defaultPrintYearlyRows()); // inputs untouched
  });
});
