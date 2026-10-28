import { describe, expect, it } from 'vitest';
import * as ExcelJS from 'exceljs';
import {
  BidSheetExportInput, buildBidSheetExport, columnLetter, exportFileName, numberOrText, periodSubColumns,
  writeBidSheetWorkbook,
} from './bid-sheet-export';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function input(overrides: Partial<BidSheetExportInput> = {}): BidSheetExportInput {
  return {
    sheetName: 'West Desk',
    exportedAt: new Date(2026, 8, 10, 9, 30),
    priceMode: 'both',
    columns: [
      { key: 'ZC#2026#9', crop: 'Corn', year: 2026, month: 9, board: 'ZCZ26' },
      { key: 'ZC#2027#1', crop: 'Corn', year: 2027, month: 1, board: 'ZCH27' },
    ],
    rows: [
      { name: 'AA Belpre', bids: { 'ZC#2026#9': '4.25', 'ZC#2027#1': '4.6075' }, basisBids: { 'ZC#2027#1': '-30' }, boardChips: {} },
      { name: 'Kanza Belmont', bids: { 'ZC#2027#1': 'call' }, basisBids: {}, boardChips: { 'ZC#2027#1': 'ZCK27' } },
      { name: 'Empty Row', bids: {}, basisBids: {}, boardChips: {} },
    ],
    monthNames: MONTHS,
    ...overrides,
  };
}

describe('bid-sheet export — cell helpers', () => {
  it('turns numeric text into numbers and blank into a true blank, leaving words alone', () => {
    expect(numberOrText('4.25')).toBe(4.25);
    expect(numberOrText('-30')).toBe(-30);
    expect(numberOrText(' .5 ')).toBe(0.5);
    expect(numberOrText('')).toBeNull();
    expect(numberOrText(undefined)).toBeNull();
    expect(numberOrText('call')).toBe('call');
  });

  it('names columns the way Excel does', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(26)).toBe('Z');
    expect(columnLetter(27)).toBe('AA');
    expect(columnLetter(53)).toBe('BA');
  });

  // The characters NTFS refuses, and a name that is nothing but them.
  it('builds a Windows-safe file name from the sheet name and date', () => {
    expect(exportFileName('West Desk', new Date(2026, 8, 10))).toBe('West Desk - Bids - 2026-09-10.xlsx');
    expect(exportFileName('Q4: corn/beans?', new Date(2026, 0, 5))).toBe('Q4 corn beans - Bids - 2026-01-05.xlsx');
    expect(exportFileName('???', new Date(2026, 0, 5))).toBe('Bid Sheet - Bids - 2026-01-05.xlsx');
  });

  it('gives each period the price(s) the toggle shows, and always the Symbol', () => {
    expect(periodSubColumns('cash')).toEqual(['Cash', 'Symbol']);
    expect(periodSubColumns('basis')).toEqual(['Basis', 'Symbol']);
    expect(periodSubColumns('both')).toEqual(['Cash', 'Basis', 'Symbol']);
  });
});

describe('bid-sheet export — Both mode mirrors the grid with cash and basis side by side', () => {
  const sheet = buildBidSheetExport(input()).sheet;

  it('is just the location name and the bids: no city, state or other detail columns', () => {
    expect(sheet.headerRows[0][0]).toBe('Location');
    expect(sheet.headerRows[0]).toHaveLength(1 + 2 * 3);
  });

  it('carries the year in every period header, since the file has no year band to lean on', () => {
    expect(sheet.headerRows[0].slice(1)).toEqual(['Corn Sep 2026', null, null, 'Corn Jan 2027', null, null]);
    expect(sheet.headerRows[1].slice(1)).toEqual(['Cash', 'Basis', 'Symbol', 'Cash', 'Basis', 'Symbol']);
  });

  it('merges each period over its sub-columns and Location over both header rows', () => {
    expect(sheet.merges).toEqual(['A1:A2', 'B1:D1', 'E1:G1']);
  });

  it('writes numbers as numbers, keeps words, and leaves empty cells blank', () => {
    expect(sheet.rows[0]).toEqual(['AA Belpre', 4.25, null, 'ZCZ26', 4.6075, -30, 'ZCH27']);
    expect(sheet.rows[1][4]).toBe('call');
    expect(sheet.rows[2]).toEqual(['Empty Row', null, null, 'ZCZ26', null, null, 'ZCH27']);
  });

  // A fed cell that deviates from the column names its own contract; everyone else inherits the column's.
  it('prefers a cell’s own symbol over the column consensus', () => {
    expect(sheet.rows[0][6]).toBe('ZCH27');   // column consensus
    expect(sheet.rows[1][6]).toBe('ZCK27');   // this cell's chip
  });

  it('formats cash and basis columns and freezes Location plus both header rows', () => {
    expect(sheet.numberFormats[2]).toBe('0.00##');
    // Basis is signed by the FORMAT, not by text, so the cell stays a number Excel can sort and sum.
    expect(sheet.numberFormats[3]).toBe('+0.####;-0.####;0');
    expect(sheet.numberFormats[4]).toBeUndefined();  // Symbol is text
    expect(sheet.freeze).toEqual({ xSplit: 1, ySplit: 2 });
  });
});

describe('bid-sheet export — a single-price mode exports only that price', () => {
  it('Cash: one value and the Symbol per period, basis left out entirely', () => {
    const sheet = buildBidSheetExport(input({ priceMode: 'cash' })).sheet;
    expect(sheet.headerRows[1].slice(1)).toEqual(['Cash', 'Symbol', 'Cash', 'Symbol']);
    expect(sheet.merges).toEqual(['A1:A2', 'B1:C1', 'D1:E1']);
    expect(sheet.rows[0]).toEqual(['AA Belpre', 4.25, 'ZCZ26', 4.6075, 'ZCH27']);
    expect(sheet.numberFormats).toEqual({ 2: '0.00##', 4: '0.00##' });
  });

  it('Basis: the basis and the Symbol, cash left out entirely', () => {
    const sheet = buildBidSheetExport(input({ priceMode: 'basis' })).sheet;
    expect(sheet.headerRows[1].slice(1)).toEqual(['Basis', 'Symbol', 'Basis', 'Symbol']);
    expect(sheet.rows[0]).toEqual(['AA Belpre', null, 'ZCZ26', -30, 'ZCH27']);
    expect(sheet.numberFormats).toEqual({ 2: '+0.####;-0.####;0', 4: '+0.####;-0.####;0' });
  });

  it('keeps a positive basis a NUMBER, leaving the leading + to the cell format', () => {
    // Gluing a "+" onto the text would make Excel treat the column as text: no sorting, no sums, and
    // a green "number stored as text" warning on every cell.
    const sheet = buildBidSheetExport(input({
      priceMode: 'basis',
      rows: [{ name: 'AA Belpre', bids: {}, basisBids: { 'ZC#2026#9': '20' }, boardChips: {} }],
    })).sheet;

    expect(sheet.rows[0][1]).toBe(20);
    expect(sheet.numberFormats[2]).toBe('+0.####;-0.####;0');
  });
});

// The real thing, through exceljs and back: what the model says must be what the file holds.
describe('bid-sheet export — written workbook round-trips through exceljs', () => {
  it('produces one sheet with merged headers, typed numbers and frozen panes', async () => {
    const model = buildBidSheetExport(input());
    const bytes = await writeBidSheetWorkbook(model, ExcelJS);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);

    expect(wb.worksheets.map(w => w.name)).toEqual(['Bid Sheet']);
    const ws = wb.getWorksheet('Bid Sheet')!;
    expect(ws.getCell('A1').value).toBe('Location');
    expect(ws.getCell('B1').value).toBe('Corn Sep 2026');
    expect(ws.getCell('B2').value).toBe('Cash');
    expect(ws.getCell('D2').value).toBe('Symbol');
    expect(ws.getCell('B1').isMerged).toBe(true);
    expect(ws.getCell('B3').value).toBe(4.25);
    expect(typeof ws.getCell('F3').value).toBe('number');
    expect(ws.getCell('B3').numFmt).toBe('0.00##');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 2 });
    expect(ws.rowCount).toBe(5);   // 2 header rows + 3 locations

    expect(model.fileName).toBe('West Desk - Bids - 2026-09-10.xlsx');
  });
});
