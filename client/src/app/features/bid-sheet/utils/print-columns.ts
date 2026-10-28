/**
 * Bid sheet print dialog — what to print.
 *
 * Pure functions that turn the dialog's choices (crops, periods, the Yearly column builder) into
 * the `PrintCropGroup`s and `PrintLocation`s the layout builder in `print-layout.ts` arranges, plus
 * the dialog's small helpers: crop colour tints, phone formatting, preview zoom, and reading /
 * writing the persisted print layout. The page owns the signals and the popup; nothing here reads
 * state or has side effects.
 */
import { BidSheetEntry } from '@models';
import { lookupBid } from './bid-math';
import { parsePrintLayoutStyle, PrintColumn, PrintCropGroup, PrintLayoutStyle, PrintLocation } from './print-layout';

/** One row in the Yearly print columns builder. The resolved crop year = editBidsYear() + offset
 *  (relative, so it rolls over). oldNew picks the header style: '' = just the year, 'old'/'new' = "Old/New Crop (YYYY)". */
export interface PrintYearRow {
  id: string;
  enabled: boolean;
  offset: number;            // -2..+2 relative to the viewed year
  oldNew: '' | 'old' | 'new';
}

export const MAX_PRINT_YEARLY_ROWS = 5;
// Monthly columns have no separate config: each month picked in the Months list prints as "May (2026)"
// for the viewed year. Year offsets are only used by the Yearly columns' year dropdown.
export const PRINT_YEAR_OFFSETS: number[] = [-2, -1, 0, 1, 2];

/** The Yearly columns a new page starts with: Old Crop (viewed year − 1), New Crop (viewed year). */
export function defaultPrintYearlyRows(): PrintYearRow[] {
  return [
    { id: 'yr-old', enabled: true, offset: -1, oldNew: 'old' },
    { id: 'yr-new', enabled: true, offset: 0, oldNew: 'new' }
  ];
}

export function printMonthName(month: number): string {
  if (month === 0) return 'Year';
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1] ?? '';
}

/**
 * Columns grouped by crop for the print preview — each group is one table section.
 * The Yearly view uses the enabled Yearly rows (per-row year + Old/New → "Old Crop (2025)" / "2025"); each
 * specific month picked in the Months list renders one column for the viewed year, headed "May (2026)".
 * Crop and month order follow the grid (`gridCrops` / `gridMonths`); only the selected ones print.
 */
export function buildPrintCropGroups(
  gridCrops: string[], gridMonths: number[], selectedCrops: ReadonlySet<string>, selectedMonths: ReadonlySet<number>,
  viewedYear: number, allYearlyRows: PrintYearRow[]
): PrintCropGroup[] {
  const yearlyRows = allYearlyRows.filter(r => r.enabled);
  // Preserve crop + month order from the grid (editBidsMonths is the canonical, user-orderable order).
  const crops = gridCrops.filter(c => selectedCrops.has(c));
  const months = gridMonths.filter(m => selectedMonths.has(m));

  return crops.map<PrintCropGroup>(crop => {
    const columns: PrintColumn[] = [];
    for (const m of months) {
      if (m === 0) {
        // Yearly: one column per enabled row. Header = "Old Crop (2025)" / "New Crop (2025)" / "2025".
        for (const row of yearlyRows) {
          const resolved = viewedYear + row.offset;
          const label = row.oldNew === 'old' ? `Old Crop (${resolved})`
            : row.oldNew === 'new' ? `New Crop (${resolved})`
            : String(resolved);
          // compactLabel is for the side-by-side layout, where a column is only a few percent of
          // the page and "Old Crop (2026)" overflows into its neighbour. It ABBREVIATES the same
          // column the user configured — it never renames it — so old crop still reads as old
          // crop, not as some other word.
          const yy = String(resolved).slice(-2);
          const compactLabel = row.oldNew === 'old' ? `O/C ${yy}`
            : row.oldNew === 'new' ? `N/C ${yy}`
            : String(resolved);
          columns.push({ key: `${crop}#0#${row.id}`, crop, month: 0, year: resolved, label, compactLabel });
        }
      } else {
        // Monthly: one column per selected month for the viewed year, headed "May (2026)".
        columns.push({
          key: `${crop}#${m}`, crop, month: m, year: viewedYear,
          label: `${printMonthName(m)} (${viewedYear})`,
          compactLabel: `${printMonthName(m)} ${String(viewedYear).slice(-2)}`
        });
      }
    }
    return { crop, columns };
  });
}

/**
 * Resolve a printed cell's bid value. For the viewed (New Crop) year we read the live edit-grid
 * value so unsaved edits print; for any other year (Old Crop) we read the saved bid from the lookup.
 */
export function printCellValue(
  row: { name: string; bids: Record<string, string> }, col: { crop: string; month: number; year: number },
  viewedYear: number, lookup: ReadonlyMap<string, BidSheetEntry>
): string {
  if (col.year === viewedYear) {
    return (row.bids[`${col.crop}#${col.month}`] ?? '').trim();
  }
  return lookupBid(lookup, row.name, col.year, col.crop, col.month).trim();
}

/**
 * Every edit-grid row with its bids resolved for the print columns, in grid order. The Highlight
 * toggle is folded into `isScoular` here so the layout builder never has to know about it.
 * Locations with no bids are dropped by the builder, not here.
 */
export function buildPrintLocations(
  rows: { name: string; bids: Record<string, string> }[], groups: PrintCropGroup[], highlight: boolean,
  scoularNames: ReadonlySet<string>, viewedYear: number, lookup: ReadonlyMap<string, BidSheetEntry>
): PrintLocation[] {
  const columns = groups.flatMap(g => g.columns);
  return rows.map(row => ({
    name: row.name,
    isScoular: highlight && scoularNames.has(row.name),
    values: Object.fromEntries(columns.map(col => [col.key, printCellValue(row, col, viewedYear, lookup)]))
  }));
}

/** Blends a `#rrggbb` colour toward white by `blend` (0 = unchanged, 1 = white). */
export function tintHex(hexColor: string, blend: number): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * blend);
  return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Formats typed phone input as "(402) 555-1234": digits only, at most ten. */
export function formatPhoneInput(value: string): string {
  const raw = value.replace(/\D/g, '').slice(0, 10);
  let formatted = raw;
  if (raw.length > 6) formatted = `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`;
  else if (raw.length > 3) formatted = `(${raw.slice(0, 3)}) ${raw.slice(3)}`;
  else if (raw.length > 0) formatted = `(${raw}`;
  return formatted;
}

/** Zoom that fits the sheet to the pane with a little margin, bounded so it never becomes unreadably
 *  small or blown up: 1.1× is as large as a print preview should read on a monitor. */
export function printPreviewZoom(paneWidth: number, sheetPx: number): number {
  if (paneWidth <= 0) return 1;
  return Math.round(Math.min(1.1, Math.max(0.5, (paneWidth * 0.9) / sheetPx)) * 100) / 100;
}

/** The persisted print layout's fields; an absent field means "keep what you have". */
export interface PrintLayoutSettings {
  yearlyRows?: PrintYearRow[];
  address?: string;
  phone?: string;
  highlightScoular?: boolean;
  layoutStyle: PrintLayoutStyle;
}

/**
 * Reads a persisted print layout, sanitising on read so malformed/out-of-range data can't break the
 * year pickers: at most MAX_PRINT_YEARLY_ROWS rows, offsets clamped to ±2, unknown Old/New → plain
 * year. Each restored row gets a fresh id from `newRowId`. Returns null when the JSON is invalid.
 */
export function parsePrintLayoutPreference(json: string, newRowId: () => string): PrintLayoutSettings | null {
  try {
    const l = JSON.parse(json);
    // Retired 'sideBySide' / 'stacked' values fall back to the default; the next save rewrites them.
    const settings: PrintLayoutSettings = { layoutStyle: parsePrintLayoutStyle(l?.layoutStyle) };
    if (Array.isArray(l?.yearlyRows) && l.yearlyRows.length) {
      settings.yearlyRows = l.yearlyRows.slice(0, MAX_PRINT_YEARLY_ROWS).map((r: { enabled?: unknown; offset?: unknown; oldNew?: unknown }) => ({
        id: newRowId(),
        enabled: r?.enabled !== false,
        offset: Math.max(-2, Math.min(2, Math.trunc(Number(r?.offset)) || 0)),
        oldNew: (r?.oldNew === 'old' || r?.oldNew === 'new') ? r.oldNew : '' as const
      }));
    }
    if (typeof l?.address === 'string') settings.address = l.address;
    if (typeof l?.phone === 'string') settings.phone = l.phone;
    if (typeof l?.highlightScoular === 'boolean') settings.highlightScoular = l.highlightScoular;
    return settings;
  } catch {
    return null; // invalid JSON — keep defaults
  }
}

/** The JSON persisted for the print layout (row ids are not stored). */
export function serializePrintLayout(s: { yearlyRows: PrintYearRow[]; address: string; phone: string; highlightScoular: boolean; layoutStyle: PrintLayoutStyle }): string {
  return JSON.stringify({
    yearlyRows: s.yearlyRows.map(({ enabled, offset, oldNew }) => ({ enabled, offset, oldNew })),
    address: s.address,
    phone: s.phone,
    highlightScoular: s.highlightScoular,
    layoutStyle: s.layoutStyle
  });
}

// ── Yearly columns builder ──────────────────────────────────────────────────────────────────────

/** Adds a plain viewed-year row, up to MAX_PRINT_YEARLY_ROWS (returns the same array when full). */
export function addYearlyRow(rows: PrintYearRow[], newRowId: () => string): PrintYearRow[] {
  if (rows.length >= MAX_PRINT_YEARLY_ROWS) return rows;
  return [...rows, { id: newRowId(), enabled: true, offset: 0, oldNew: '' as const }];
}

/** Removes a row, but never the last one. */
export function removeYearlyRow(rows: PrintYearRow[], id: string): PrintYearRow[] {
  return rows.length <= 1 ? rows : rows.filter(r => r.id !== id);
}

export function toggleYearlyRow(rows: PrintYearRow[], id: string): PrintYearRow[] {
  return rows.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r);
}

/** Sets a row's year offset, clamped to ±2. */
export function setYearlyRowOffset(rows: PrintYearRow[], id: string, offset: number): PrintYearRow[] {
  const clamped = Math.max(-2, Math.min(2, offset));
  return rows.map(r => r.id === id ? { ...r, offset: clamped } : r);
}

/** Sets a row's Old/New label; anything other than 'old' / 'new' means just the year. */
export function setYearlyRowOldNew(rows: PrintYearRow[], id: string, value: string): PrintYearRow[] {
  const oldNew: '' | 'old' | 'new' = value === 'old' || value === 'new' ? value : '';
  return rows.map(r => r.id === id ? { ...r, oldNew } : r);
}
