import { downloadBlob } from './download';

export type CsvCell = string | number | boolean | null | undefined;

/**
 * One CSV cell. Text is guarded against formula injection: a spreadsheet would run a cell that starts
 * with = + - @ (or a tab or carriage return) as a formula, so such text gets a leading apostrophe.
 * Numbers are written as they are, so a negative number stays a number. Quoted per RFC 4180 when needed.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = typeof value === 'boolean' ? (value ? 'Y' : 'N') : value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV document: a header row, then one line per row, CRLF line endings. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

/** Downloads CSV text. Starts with a byte-order mark so Excel reads it as UTF-8 (e.g. "CO₂e"). */
export function downloadCsv(csv: string, fileName: string): void {
  downloadBlob(new Blob([String.fromCharCode(0xfeff), csv], { type: 'text/csv;charset=utf-8' }), fileName);
}
