/**
 * Bid sheet print layouts.
 *
 * Pure functions that turn the selected crops / periods / locations into a `PrintLayoutModel` —
 * a list of tables made of styled cells — and render that model either to the dialog preview
 * (Angular template, via `cellStyleMap`) or to the popup print document (`renderPrintDocument`).
 *
 * One model, two thin renderers: the preview and the printed sheet cannot drift, because every
 * geometry, colour and highlighting decision is made exactly once, here. This replaced two
 * hand-synchronised implementations per layout, which is where the earlier "columns squeezed to
 * an ellipsis" bug lived.
 *
 * Two layouts, modelled on the daily bid sheets originators already send out (card #559):
 *   - `locationsDown`   — one Location column, then a coloured band per crop with its period
 *                         columns beneath. Locations are listed ONCE. Wide crop selections split
 *                         into bands stacked down the page, each repeating the Location column.
 *   - `locationsAcross` — the transpose: crop bands with period rows down the side, locations
 *                         across the top. Locations split into blocks of 4–8 columns stacked down
 *                         the page, each repeating the row labels.
 *
 * A bid is a single free-text string per (location, crop, period); cells print it verbatim.
 */

export type PrintLayoutStyle = 'locationsDown' | 'locationsAcross';
export const DEFAULT_PRINT_LAYOUT_STYLE: PrintLayoutStyle = 'locationsDown';

/** One period column under a crop. `compactLabel` ("O/C 26", "May 26") is what prints. */
export interface PrintColumn {
  key: string;
  crop: string;
  month: number;
  year: number;
  label: string;
  compactLabel: string;
}

export interface PrintCropGroup {
  crop: string;
  columns: PrintColumn[];
}

/** A location with its bids pre-resolved by the component, keyed by `PrintColumn.key`.
 *  `isScoular` already has the Highlight toggle folded in — false means "do not highlight". */
export interface PrintLocation {
  name: string;
  isScoular: boolean;
  values: Record<string, string>;
}

export interface PrintCropColors {
  /** Saturated hue — header underline / row-label rule. */
  solid: string;
  /** Pastel fill — crop band background. */
  tint: string;
}

export interface PrintLayoutInput {
  style: PrintLayoutStyle;
  /** Crops in edit-grid order, each with its period columns. */
  groups: PrintCropGroup[];
  /** Locations in edit-grid order, UNFILTERED — the builders drop locations with no bids. */
  locations: PrintLocation[];
  cropColors: (crop: string) => PrintCropColors;
}

export interface PrintCell {
  text: string;
  align: 'left' | 'center';
  bold?: boolean;
  /** Bid values: monospace so the digits line up. */
  mono?: boolean;
  /** Names wrap; everything else is one line with an ellipsis as a last resort. */
  wrap?: boolean;
  /** Background hex. Undefined = white. */
  bg?: string;
  /** Full CSS border shorthand overriding the 1px grid line (band divider, crop rule). */
  borderLeft?: string;
  borderBottom?: string;
  colspan?: number;
  /** Defaults to 10. */
  fontSizePx?: number;
}

export interface PrintTable {
  /** Table width as a share of the printable page width. < 100 for a partial band/block, which
   *  must NOT stretch to fill the page — it lines up under the full bands above it. */
  widthPct: number;
  /** One entry per `<col>`, in inches. Percentages are derived per renderer relative to the table. */
  colWidthsIn: number[];
  headerRows: PrintCell[][];
  bodyRows: PrintCell[][];
}

export interface PrintLayoutModel {
  style: PrintLayoutStyle;
  tables: PrintTable[];
}

export interface PrintChrome {
  address: string;
  phone: string;
  dateText: string;
  /** Absolute URL — the popup document is `about:blank`, so a relative asset path 404s. */
  logoUrl: string;
}

// ── Page geometry ───────────────────────────────────────────────────────────────────────────────
// These numbers decide what fits on a landscape-letter sheet, so they live together. PAGE_MARGIN_IN
// drives the printed @page rule as well — keep them one constant or the columns silently mis-size.
export const PRINT_GEOMETRY = {
  PX_PER_IN: 96,
  PAGE_MARGIN_IN: 0.3,
  /** Landscape letter minus both margins. */
  PAGE_WIDTH_IN: 11 - 2 * 0.3,
  /** Enough for a 6-char header ("O/C 26") on one line at 10px bold plus padding; never shave. */
  MIN_VALUE_COL_IN: 0.55,
  /** Bid columns stop growing here — a 4-char basis in a 2-inch cell just looks lost. */
  MAX_VALUE_COL_IN: 1.0,
  MIN_NAME_COL_IN: 1.4,
  MAX_NAME_COL_IN: 3.0,
  /** Average advance of a mixed-case name at 10px in the print font stack. */
  NAME_CHAR_PX: 5.2,
  /** Bold location headers in the across layout run a little wider. */
  BOLD_CHAR_FACTOR: 1.1,
  /** Horizontal padding + borders inside a cell. */
  NAME_CELL_CHROME_PX: 14,
  /** Across layout: the row-label column ("O/C 26"). */
  LABEL_COL_IN: 1.0,
  /** Across layout: narrowest location column we'll draw. */
  MIN_LOC_COL_IN: 0.9,
  MIN_LOCATIONS_PER_BLOCK: 4,
  MAX_LOCATIONS_PER_BLOCK: 8,
} as const;

export const PRINT_COLORS = {
  /** Scoular facilities — the same yellow the daily sheets use. */
  scoularBg: '#FFD400',
  /** Divider between crop bands in the down layout. */
  heavyRule: '#111827',
  headerBg: '#f3f4f6',
  labelBg: '#f9fafb',
  gridLine: '#e5e7eb',
  headerLine: '#d1d5db',
  text: '#1f2937',
  /** Brand rule under the page header. */
  brandRule: '#00875F',
} as const;

const DEFAULT_FONT_PX = 10;
const BAND_HEADER_FONT_PX = 11;

// ── Small helpers ───────────────────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Split `items` into chunks no larger than `ceiling`, EVENED OUT rather than packed: 5 with a
 * ceiling of 4 gives 3 + 2, not 4 + 1. A remainder of one is what leaves a lone crop (or a lone
 * location column) stranded on its own band, which is the layout users rejected.
 */
export function balancedChunks<T>(items: T[], ceiling: number): T[][] {
  if (items.length === 0) return [];
  const safeCeiling = Math.max(1, Math.floor(ceiling));
  const chunkCount = Math.ceil(items.length / safeCeiling);
  const size = Math.ceil(items.length / chunkCount);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const longestName = (locations: PrintLocation[]): number =>
  locations.reduce((max, l) => Math.max(max, l.name.length), 0);

const valueOf = (loc: PrintLocation, col: PrintColumn): string => (loc.values[col.key] ?? '').trim();

const pageWidthPct = (inches: number): number => (inches / PRINT_GEOMETRY.PAGE_WIDTH_IN) * 100;

// ── Public API ──────────────────────────────────────────────────────────────────────────────────

/** Persisted `layoutStyle` → a valid style. The retired 'sideBySide' / 'stacked' values, and
 *  anything malformed, fall back to the default so old saved preferences keep working. */
export function parsePrintLayoutStyle(raw: unknown): PrintLayoutStyle {
  return raw === 'locationsDown' || raw === 'locationsAcross' ? raw : DEFAULT_PRINT_LAYOUT_STYLE;
}

/** Locations that have at least one bid in any selected column, in their ORIGINAL order — the
 *  print matches the on-screen grid, with no Scoular-first re-sort. */
export function selectPrintLocations(groups: PrintCropGroup[], locations: PrintLocation[]): PrintLocation[] {
  const columns = groups.flatMap(g => g.columns);
  return locations.filter(loc => columns.some(col => valueOf(loc, col).length > 0));
}

export function buildPrintLayout(input: PrintLayoutInput): PrintLayoutModel {
  const tables = input.style === 'locationsAcross' ? buildLocationsAcross(input) : buildLocationsDown(input);
  return { style: input.style, tables };
}

/**
 * LOCATIONS DOWN — one Location column, then a coloured band per crop with its period columns.
 *
 * Column widths: the name column is sized to the longest name (within 1.4–3.0in); bid columns get
 * an equal share of what's left, between 0.55in (a one-line "O/C 26" header) and 1.0in. If the
 * selected crops × periods need more than that, the CROPS are split into balanced bands stacked
 * down the page, every band drawn at the same widths so a partial last band lines up under the
 * ones above rather than stretching across the sheet.
 */
export function buildLocationsDown(input: Omit<PrintLayoutInput, 'style'>): PrintTable[] {
  const G = PRINT_GEOMETRY;
  const groups = input.groups.filter(g => g.columns.length > 0);
  const locs = selectPrintLocations(groups, input.locations);
  if (groups.length === 0 || locs.length === 0) return [];

  const periodsPerCrop = Math.max(...groups.map(g => g.columns.length));
  const measuredNameIn = clamp(
    (longestName(locs) * G.NAME_CHAR_PX + G.NAME_CELL_CHROME_PX) / G.PX_PER_IN,
    G.MIN_NAME_COL_IN, G.MAX_NAME_COL_IN);
  const availIn = G.PAGE_WIDTH_IN - measuredNameIn;
  const maxValueCols = Math.max(1, Math.floor(availIn / G.MIN_VALUE_COL_IN));
  const cropsPerBandCeiling = Math.max(1, Math.floor(maxValueCols / periodsPerCrop));
  const bands = balancedChunks(groups, cropsPerBandCeiling);

  // ONE set of widths for every band, derived from the fullest band. A single crop with more
  // periods than fit is allowed below the minimum rather than dropped — it only happens past ~16
  // periods, and a narrow column beats a missing one.
  const bandCols = Math.max(...bands.map(b => b.reduce((n, g) => n + g.columns.length, 0)));
  const valueIn = Math.min(G.MAX_VALUE_COL_IN, availIn / bandCols);
  const nameIn = Math.min(G.MAX_NAME_COL_IN, G.PAGE_WIDTH_IN - valueIn * bandCols);

  return bands.map(band => {
    const colWidthsIn = [nameIn];
    const bandHeader: PrintCell[] = [{ text: '', align: 'left', bg: PRINT_COLORS.headerBg }];
    const periodHeader: PrintCell[] = [{ text: 'Location', align: 'left', bold: true, bg: PRINT_COLORS.headerBg }];

    band.forEach((group, gi) => {
      const colors = input.cropColors(group.crop);
      const divider = gi > 0 ? `3px solid ${PRINT_COLORS.heavyRule}` : undefined;
      bandHeader.push({
        text: group.crop, align: 'center', bold: true, fontSizePx: BAND_HEADER_FONT_PX,
        colspan: group.columns.length, bg: colors.tint,
        borderBottom: `3px solid ${colors.solid}`, borderLeft: divider
      });
      group.columns.forEach((col, ci) => {
        colWidthsIn.push(valueIn);
        periodHeader.push({
          text: col.compactLabel, align: 'center', bold: true, bg: PRINT_COLORS.headerBg,
          borderLeft: ci === 0 ? divider : undefined
        });
      });
    });

    const bodyRows = locs.map(loc => {
      const bg = loc.isScoular ? PRINT_COLORS.scoularBg : undefined;
      const row: PrintCell[] = [{ text: loc.name, align: 'left', wrap: true, bold: loc.isScoular, bg }];
      band.forEach((group, gi) => {
        group.columns.forEach((col, ci) => {
          row.push({
            text: valueOf(loc, col), align: 'center', mono: true, bg,
            borderLeft: gi > 0 && ci === 0 ? `3px solid ${PRINT_COLORS.heavyRule}` : undefined
          });
        });
      });
      return row;
    });

    return {
      widthPct: pageWidthPct(colWidthsIn.reduce((a, b) => a + b, 0)),
      colWidthsIn,
      headerRows: [bandHeader, periodHeader],
      bodyRows
    };
  });
}

/**
 * LOCATIONS ACROSS — the transpose. Row labels down the side (a tinted band row per crop, then a
 * row per period), locations across the top.
 *
 * A trade unit can have 20–30 locations, far more than fit as columns, so locations are split
 * into balanced blocks of 4–8 stacked down the page. The block size comes from the longest name
 * wrapping onto at most two header lines. Each block repeats the crop bands and row labels, so it
 * reads on its own after a page break, and every block uses the same widths.
 *
 * The crop is a full-width band row rather than part of every row label ("Corn O/C 26"): it keeps
 * the label column at one inch, leaving the width for locations, and a band is what the eye
 * scans for. Period rows carry the crop's colour as a left rule so the association holds well
 * below the band.
 */
export function buildLocationsAcross(input: Omit<PrintLayoutInput, 'style'>): PrintTable[] {
  const G = PRINT_GEOMETRY;
  const groups = input.groups.filter(g => g.columns.length > 0);
  const locs = selectPrintLocations(groups, input.locations);
  if (groups.length === 0 || locs.length === 0) return [];

  const availIn = G.PAGE_WIDTH_IN - G.LABEL_COL_IN;
  const twoLineNeedIn =
    (Math.ceil(longestName(locs) / 2) * G.NAME_CHAR_PX * G.BOLD_CHAR_FACTOR + G.NAME_CELL_CHROME_PX) / G.PX_PER_IN;
  const fit = Math.floor(availIn / Math.max(twoLineNeedIn, G.MIN_LOC_COL_IN));
  const ceiling = clamp(fit, G.MIN_LOCATIONS_PER_BLOCK, G.MAX_LOCATIONS_PER_BLOCK);
  const blocks = balancedChunks(locs, ceiling);
  const perBlock = blocks[0].length;
  const locIn = availIn / perBlock;

  return blocks.map(block => {
    const colWidthsIn = [G.LABEL_COL_IN, ...block.map(() => locIn)];
    const header: PrintCell[] = [
      { text: '', align: 'left', bg: PRINT_COLORS.headerBg },
      ...block.map<PrintCell>(loc => ({
        text: loc.name, align: 'center', wrap: true, bold: loc.isScoular,
        bg: loc.isScoular ? PRINT_COLORS.scoularBg : PRINT_COLORS.headerBg
      }))
    ];

    const bodyRows: PrintCell[][] = [];
    for (const group of groups) {
      const colors = input.cropColors(group.crop);
      bodyRows.push([{
        text: group.crop, align: 'left', bold: true, fontSizePx: BAND_HEADER_FONT_PX,
        colspan: 1 + block.length, bg: colors.tint, borderBottom: `3px solid ${colors.solid}`
      }]);
      for (const col of group.columns) {
        bodyRows.push([
          { text: col.compactLabel, align: 'left', bold: true, bg: PRINT_COLORS.labelBg, borderLeft: `3px solid ${colors.solid}` },
          ...block.map<PrintCell>(loc => ({
            text: valueOf(loc, col), align: 'center', mono: true,
            bg: loc.isScoular ? PRINT_COLORS.scoularBg : undefined
          }))
        ]);
      }
    }

    return {
      widthPct: pageWidthPct(colWidthsIn.reduce((a, b) => a + b, 0)),
      colWidthsIn,
      headerRows: [header],
      bodyRows
    };
  });
}

/** Per-`<col>` widths as percentages OF THE TABLE (not the page), for `<col style="width">`. */
export function tableColWidthPcts(table: PrintTable): number[] {
  const total = table.colWidthsIn.reduce((a, b) => a + b, 0);
  return total > 0 ? table.colWidthsIn.map(w => (w / total) * 100) : table.colWidthsIn.map(() => 0);
}

/**
 * CSS for one cell, as a kebab-case map. The preview binds it with `[style]`; the print renderer
 * serialises it into a `style=""` attribute. Both `print-color-adjust` properties are always set,
 * because browsers otherwise drop cell backgrounds when printing.
 */
export function cellStyleMap(cell: PrintCell, isHeader: boolean): Record<string, string> {
  const style: Record<string, string> = {
    'padding': '4px 6px',
    'border': `1px solid ${isHeader ? PRINT_COLORS.headerLine : PRINT_COLORS.gridLine}`,
    'color': PRINT_COLORS.text,
    'font-size': `${cell.fontSizePx ?? DEFAULT_FONT_PX}px`,
    'line-height': '1.3',
    'text-align': cell.align,
    'vertical-align': 'middle',
    'font-weight': cell.bold ? '700' : '500',
    '-webkit-print-color-adjust': 'exact',
    'print-color-adjust': 'exact',
  };
  if (cell.mono) style['font-family'] = "'Cascadia Mono', 'Fira Code', monospace";
  if (cell.wrap) {
    style['white-space'] = 'normal';
    style['overflow-wrap'] = 'break-word';
    style['word-break'] = 'break-word';
  } else {
    style['white-space'] = 'nowrap';
    style['overflow'] = 'hidden';
    style['text-overflow'] = 'ellipsis';
  }
  if (cell.bg) style['background'] = cell.bg;
  if (cell.borderLeft) style['border-left'] = cell.borderLeft;
  if (cell.borderBottom) style['border-bottom'] = cell.borderBottom;
  return style;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const styleAttr = (map: Record<string, string>): string =>
  Object.entries(map).map(([k, v]) => `${k}:${v}`).join(';');

const renderCell = (cell: PrintCell, isHeader: boolean): string => {
  const tag = isHeader ? 'th' : 'td';
  const colspan = cell.colspan && cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
  // Empty stays empty — an em-dash in a dense grid reads as a value.
  return `<${tag}${colspan} style="${styleAttr(cellStyleMap(cell, isHeader))}">${escapeHtml(cell.text)}</${tag}>`;
};

/** One table (a band or block) with its colgroup, kept whole across page breaks. */
export function renderPrintTableHtml(table: PrintTable): string {
  const colgroup = tableColWidthPcts(table).map(w => `<col style="width:${w.toFixed(3)}%" />`).join('');
  const thead = table.headerRows.map(row => `<tr>${row.map(c => renderCell(c, true)).join('')}</tr>`).join('');
  const tbody = table.bodyRows.map(row => `<tr>${row.map(c => renderCell(c, false)).join('')}</tr>`).join('');
  return `<div style="page-break-inside:avoid;break-inside:avoid;">`
    + `<table style="width:${table.widthPct.toFixed(3)}%;border-collapse:collapse;table-layout:fixed;">`
    + `<colgroup>${colgroup}</colgroup><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

/** The complete popup document: brand header, the layout's tables, confidential footer. */
export function renderPrintDocument(model: PrintLayoutModel, chrome: PrintChrome): string {
  const address = chrome.address.trim();
  const phone = chrome.phone.trim();
  // Tables FLOW down the page (a spacer between them, not a forced page break): a band is only as
  // tall as the location list, so several usually share a sheet. page-break-inside:avoid on each
  // table stops the browser cutting one in half.
  const tables = model.tables.map(renderPrintTableHtml).join('<div style="height:14px;"></div>');

  return `<!DOCTYPE html><html><head>
      <title>Scoular Bids</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Open Sans', 'Segoe UI', system-ui, sans-serif; color: #1a1a1a; line-height: 1.5; padding: 0.4in; }
        @page { margin: ${PRINT_GEOMETRY.PAGE_MARGIN_IN}in; size: landscape; }
        @media print { body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        table { border-collapse: collapse; }
      </style>
    </head><body>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid ${PRINT_COLORS.brandRule};">
        <img src="${escapeHtml(chrome.logoUrl)}" alt="Scoular" style="height:40px;width:auto;" />
        <div style="text-align:right;font-size:12px;color:#4b5563;line-height:1.6;">
          ${address ? `<p>${escapeHtml(address)}</p>` : ''}
          ${phone ? `<p>${escapeHtml(phone)}</p>` : ''}
        </div>
      </div>
      ${tables}
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid ${PRINT_COLORS.gridLine};display:flex;justify-content:space-between;align-items:center;">
        <p style="font-size:10px;color:#9ca3af;">The Scoular Company &mdash; Confidential</p>
        <p style="font-size:10px;color:#9ca3af;">${escapeHtml(chrome.dateText)}</p>
      </div>
    </body></html>`;
}
