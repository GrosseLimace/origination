import type * as ExcelJSNamespace from 'exceljs';

/**
 * Export of one bid sheet to an Excel workbook: the Edit Bids grid, as displayed.
 *
 * Split in two on purpose. `buildBidSheetExport` turns the grid into a plain model -- header rows, data
 * rows, merges, formats -- with no exceljs in sight, so the shape of the file is unit-tested without a
 * workbook. `writeBidSheetWorkbook` then pours that model into exceljs. The exceljs module is passed IN
 * rather than imported here: the component lazy-loads the ~1MB browser build on first click so it never
 * rides in the initial bundle, and the tests hand in the node build.
 *
 * One worksheet, deliberately no more: the location's name, then under every crop / period / year the
 * price the Cash-Basis-Both toggle is showing (both when it says Both) and the contract Symbol. Nothing
 * the grid isn't showing -- a first cut carried City / State / Scoular columns and two extra tabs, and
 * the ask was to strip it back to the names and the bids.
 */

/** The exceljs module surface this file uses. */
export type ExcelJSModule = typeof ExcelJSNamespace;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ExportPriceMode = 'cash' | 'basis' | 'both';

export interface ExportColumn {
  /** The grid's column key, which indexes the row's bid maps. */
  key: string;
  crop: string;
  year: number;
  /** Delivery month, 1-12. */
  month: number;
  /** Column-wide board consensus, '' where the column's fed cells do not agree on one. */
  board: string;
}

export interface ExportRow {
  /** The name the SHEET shows -- a per-sheet label where one is set. */
  name: string;
  bids: Record<string, string>;
  basisBids: Record<string, string>;
  /** Per-cell board where a fed cell deviates from the column consensus. */
  boardChips: Record<string, string>;
}

export interface BidSheetExportInput {
  sheetName: string;
  exportedAt: Date;
  /** Which price the grid is showing. Cash and Basis export one value per period; Both exports both. */
  priceMode: ExportPriceMode;
  columns: ExportColumn[];
  rows: ExportRow[];
  /** Index 1-12; index 0 is unused. */
  monthNames: readonly string[];
}

export type CellValue = string | number | null;

export interface ExportSheetModel {
  name: string;
  /** Two header rows: a period band merged over its sub-columns, then the sub-column names. */
  headerRows: CellValue[][];
  rows: CellValue[][];
  /** A1-style ranges, e.g. 'B1:C1'. */
  merges: string[];
  columnWidths: number[];
  /** 1-based column index -> Excel number format for that column's data cells. */
  numberFormats: Record<number, string>;
  freeze: { xSplit: number; ySplit: number };
}

export interface BidSheetExportModel {
  fileName: string;
  title: string;
  exportedAt: Date;
  sheet: ExportSheetModel;
}

// Cash is dollars with up to four places (4.2575 happens); basis is cents and written as typed.
const CASH_FORMAT = '0.00##';
// Positive / negative / zero sections, so a positive basis shows its "+" as it does on screen. A
// FORMAT rather than a "+" glued to the text: the cell stays a real number, so it still sorts and
// sums. Four optional places match what General showed -- trailing zeros dropped, and nothing
// rounded away short of the precision basis is quoted to.
const BASIS_FORMAT = '+0.####;-0.####;0';

/** Column number (1-based) -> Excel letters: 1 -> A, 27 -> AA. */
export function columnLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * A grid cell as Excel should hold it: a real number when the text is one, so it sorts and sums;
 * null when empty, so the cell is genuinely blank rather than an empty string that breaks COUNT.
 */
export function numberOrText(value: string | undefined | null): CellValue {
  const v = (value ?? '').trim();
  if (!v) return null;
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v) ? Number(v) : v;
}

/** Windows-safe file name: the sheet's name with the characters NTFS refuses swapped for spaces. */
export function exportFileName(sheetName: string, exportedAt: Date): string {
  const safe = sheetName.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Bid Sheet';
  const y = exportedAt.getFullYear();
  const m = String(exportedAt.getMonth() + 1).padStart(2, '0');
  const d = String(exportedAt.getDate()).padStart(2, '0');
  return `${safe} - Bids - ${y}-${m}-${d}.xlsx`;
}

/** The sub-columns one period gets, in order, for the grid's price mode. Symbol always closes the set. */
export function periodSubColumns(mode: ExportPriceMode): Array<'Cash' | 'Basis' | 'Symbol'> {
  switch (mode) {
    case 'cash': return ['Cash', 'Symbol'];
    case 'basis': return ['Basis', 'Symbol'];
    default: return ['Cash', 'Basis', 'Symbol'];
  }
}

export function buildBidSheetExport(input: BidSheetExportInput): BidSheetExportModel {
  const periodName = (c: ExportColumn) => input.monthNames[c.month] ?? String(c.month);
  const periodLabel = (c: ExportColumn) => `${c.crop} ${periodName(c)} ${c.year}`;
  const symbolOf = (row: ExportRow, c: ExportColumn) => row.boardChips[c.key] || c.board || null;
  const subs = periodSubColumns(input.priceMode);

  // Header row 1 is the period band, row 2 the sub-columns. Location spans both.
  const band: CellValue[] = ['Location'];
  const sub: CellValue[] = [null];
  const merges = ['A1:A2'];
  const numberFormats: Record<number, string> = {};
  const widths = [34];
  input.columns.forEach((c, i) => {
    const start = 2 + i * subs.length;
    band.push(periodLabel(c), ...subs.slice(1).map(() => null));
    sub.push(...subs);
    if (subs.length > 1) merges.push(`${columnLetter(start)}1:${columnLetter(start + subs.length - 1)}1`);
    subs.forEach((name, j) => {
      if (name === 'Cash') numberFormats[start + j] = CASH_FORMAT;
      if (name === 'Basis') numberFormats[start + j] = BASIS_FORMAT;
      widths.push(name === 'Basis' ? 8 : 9);
    });
  });

  const rows = input.rows.map(row => {
    const cells: CellValue[] = [row.name];
    for (const c of input.columns) {
      for (const name of subs) {
        cells.push(
          name === 'Cash' ? numberOrText(row.bids[c.key])
          : name === 'Basis' ? numberOrText(row.basisBids[c.key])
          : symbolOf(row, c));
      }
    }
    return cells;
  });

  return {
    fileName: exportFileName(input.sheetName, input.exportedAt),
    title: `${input.sheetName} — bid sheet`,
    exportedAt: input.exportedAt,
    sheet: {
      name: 'Bid Sheet',
      headerRows: [band, sub],
      rows,
      merges,
      columnWidths: widths,
      numberFormats,
      freeze: { xSplit: 1, ySplit: 2 },
    },
  };
}

/** Pours the model into a workbook and returns the .xlsx bytes. */
export async function writeBidSheetWorkbook(model: BidSheetExportModel, ExcelJS: ExcelJSModule): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Origination Workbench';
  wb.created = model.exportedAt;
  wb.modified = model.exportedAt;
  wb.title = model.title;

  const s = model.sheet;
  const ws = wb.addWorksheet(s.name, {
    views: [{ state: 'frozen', xSplit: s.freeze.xSplit, ySplit: s.freeze.ySplit }],
  });
  for (const h of s.headerRows) ws.addRow(h);
  for (const r of s.rows) ws.addRow(r);
  for (const m of s.merges) ws.mergeCells(m);

  for (let i = 1; i <= s.headerRows.length; i++) {
    const row = ws.getRow(i);
    row.font = { bold: true };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    });
  }
  s.columnWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (const [index, format] of Object.entries(s.numberFormats)) {
    // Data cells only: a number format on a text header is harmless but untidy in the XML.
    ws.getColumn(Number(index)).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber > s.headerRows.length) cell.numFmt = format;
    });
  }

  return await wb.xlsx.writeBuffer() as unknown as ArrayBuffer;
}

/** Hands the bytes to the browser as a download. */
export function downloadWorkbook(bytes: ArrayBuffer, fileName: string): void {
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a tick, not immediately: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
