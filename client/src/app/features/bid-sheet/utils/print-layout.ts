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
 *                         columns beneath. Locations are listed ONCE. Only when even the smallest
 *                         readable type can't fit every crop across the page do the crops split
 *                         into bands stacked down the page, each repeating the Location column.
 *   - `locationsAcross` — the transpose: crop bands with period rows down the side, locations
 *                         across the top. Locations split into blocks stacked down the page, each
 *                         repeating the row labels.
 *
 * Sizing is MEASURED, not fixed: every column is exactly as wide as its longest header or value
 * needs to sit on one line at the chosen type size. The type size itself REACTS to the content:
 * from a small ladder it is the largest size that (a) needs the fewest bands/blocks across the
 * page and (b) keeps the whole sheet on the fewest pages — so a short sheet prints large and a
 * dense one (many locations, crops or months) shrinks to stay on one page. Bids never wrap — the
 * sheet is often screenshotted straight off the monitor and sent round on Teams.
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
  /** Set only in Both mode, where each period prints as a cash column beside a basis column. Absent
   *  in cash or basis mode, where a period is a single column carrying whichever price is selected. */
  priceType?: 'cash' | 'basis';
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
  /** Allow wrapping. Columns are measured so this should never actually fire; it is the safety
   *  net for a name longer than any column can be — better a second line than clipped text. */
  wrap?: boolean;
  /** Background hex. Undefined = white. */
  bg?: string;
  /** Full CSS border shorthand overriding the 1px grid line (band divider, crop rule). */
  borderLeft?: string;
  borderBottom?: string;
  colspan?: number;
  /** Set on every cell by the builders (the table's chosen type size; band headers one step up). */
  fontSizePx?: number;
}

export interface PrintTable {
  /** Table width as a share of the printable page width. < 100 for a partial band/block, which
   *  must NOT stretch to fill the page — it lines up under the full bands above it. */
  widthPct: number;
  /** One entry per `<col>`, in inches. Percentages are derived per renderer relative to the table. */
  colWidthsIn: number[];
  /** The type size the table was fitted at — informational; each cell carries its own. */
  fontPx: number;
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
  /** Landscape letter minus both margins. */
  PAGE_HEIGHT_IN: 8.5 - 2 * 0.3,
  /** Logo header + confidential footer, roughly; what is left is the body height per page. */
  PAGE_CHROME_IN: 1.25,
  /** Vertical gap between stacked bands/blocks. */
  TABLE_GAP_PX: 14,
  LINE_HEIGHT: 1.25,
  /** Type sizes tried largest-first. Bigger is better — the sheet is screenshotted and read on
   *  Teams — but the size that fits the content (fewest bands/blocks, fewest pages) wins. */
  FONT_LADDER_PX: [12, 11, 10, 9] as readonly number[],
  /** Average advance of mixed-case text as a fraction of the font size (Open Sans, measured
   *  generously so a wide name is sized to fit rather than judged to fit and then wrap). */
  TEXT_EM: 0.58,
  BOLD_FACTOR: 1.08,
  /** Monospace digits (Cascadia Mono / Fira Code). */
  MONO_EM: 0.62,
  /** Horizontal padding inside a cell, each side. */
  CELL_PAD_X_PX: 4,
  CELL_PAD_Y_PX: 3,
  /** Left + right 1px borders. */
  CELL_BORDER_PX: 2,
  /** A bid column stops growing here — a 4-char basis in a 2-inch cell just looks lost. */
  MAX_VALUE_COL_IN: 0.9,
  /** The Location column stops absorbing slack here (measured need can still exceed it). */
  MAX_NAME_COL_IN: 3.0,
  /** Across: location names stay on ONE header line unless that would leave fewer than this many
   *  locations per block on average — only then may names wrap (to at most HEADER_MAX_LINES). */
  MIN_AVG_LOCATIONS_PER_BLOCK: 4,
  /** Across: each row's columns grow just enough to close the gap at its right edge, but never past
   *  this multiple of their natural width — a short tail row should not balloon. */
  MAX_COLUMN_STRETCH: 1.25,
  HEADER_MAX_LINES: 3,
  /** Word boundaries make greedy wrapping less efficient than chars ÷ lines; allow this much slack. */
  WRAP_SLACK: 1.15,
  /** Across: a row holds at most this many locations, however narrow their columns. */
  MAX_LOCATIONS_PER_BLOCK: 14,
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

/** Width a piece of text needs to sit on one line in a cell at `fontPx`, in inches. */
export function textWidthIn(text: string, fontPx: number, opts: { bold?: boolean; mono?: boolean } = {}): number {
  const G = PRINT_GEOMETRY;
  const em = opts.mono ? G.MONO_EM : G.TEXT_EM * (opts.bold ? G.BOLD_FACTOR : 1);
  const textPx = text.length * fontPx * em;
  return (textPx + 2 * G.CELL_PAD_X_PX + G.CELL_BORDER_PX) / G.PX_PER_IN;
}

const valueOf = (loc: PrintLocation, col: PrintColumn): string => (loc.values[col.key] ?? '').trim();

const pageWidthPct = (inches: number): number => (inches / PRINT_GEOMETRY.PAGE_WIDTH_IN) * 100;

const maxOf = (xs: number[]): number => xs.reduce((m, x) => Math.max(m, x), 0);

/** Widest location name, measured bold (a Scoular row is bold, and it must not wrap either). */
const widestNameIn = (locs: PrintLocation[], fontPx: number): number =>
  maxOf(locs.map(l => textWidthIn(l.name, fontPx, { bold: true })));

/**
 * Column width a location name needs as a column HEADER set on `lines` lines: on one line, its full
 * width; on more, the longer of its longest single word (words don't split) and its length spread
 * over the lines with slack for ragged word breaks. Measured bold, since a Scoular header is bold.
 */
export function wrappedHeaderWidthIn(name: string, fontPx: number, lines = 1): number {
  if (lines <= 1) return textWidthIn(name, fontPx, { bold: true });
  const longestWord = maxOf(name.split(/\s+/).map(w => textWidthIn(w, fontPx, { bold: true })));
  const perLineChars = Math.ceil((name.length / lines) * PRINT_GEOMETRY.WRAP_SLACK);
  return Math.max(longestWord, textWidthIn('x'.repeat(perLineChars), fontPx, { bold: true }));
}

/**
 * Pack locations into rows GREEDILY, in grid order: each row takes as many columns as fit the
 * available width at their natural widths (and at most `maxPerBlock`). As many locations per row
 * as possible is the point — the daily sheets read best wide — so a short tail row is accepted
 * rather than evening the rows out. A single column wider than the page gets a row to itself.
 */
function packBlocks(widthsIn: number[], availIn: number, maxPerBlock: number): number[][] {
  const blocks: number[][] = [];
  let current: number[] = [];
  let used = 0;
  widthsIn.forEach((w, i) => {
    if (current.length > 0 && (current.length >= maxPerBlock || used + w > availIn + 1e-9)) {
      blocks.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += w;
  });
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/** Widest bid value across the given columns, measured monospace. */
const widestValueIn = (locs: PrintLocation[], cols: PrintColumn[], fontPx: number): number =>
  maxOf(locs.flatMap(l => cols.map(c => textWidthIn(valueOf(l, c), fontPx, { mono: true }))));

/** Height of one table row at `fontPx` with `lines` lines of text, in inches. */
export function rowHeightIn(fontPx: number, lines = 1): number {
  const G = PRINT_GEOMETRY;
  return (lines * fontPx * G.LINE_HEIGHT + 2 * G.CELL_PAD_Y_PX + 1) / G.PX_PER_IN;
}

/** Pages a sheet of `heightIn` needs, given the header/footer chrome on each page. */
export function pagesFor(heightIn: number): number {
  const G = PRINT_GEOMETRY;
  return Math.max(1, Math.ceil(heightIn / (G.PAGE_HEIGHT_IN - G.PAGE_CHROME_IN)));
}

/** Total height of `count` stacked tables of `eachIn`, with the gap between them. */
const stackedHeightIn = (count: number, eachIn: number): number =>
  count * eachIn + Math.max(0, count - 1) * (PRINT_GEOMETRY.TABLE_GAP_PX / PRINT_GEOMETRY.PX_PER_IN);

/**
 * Pick the type size for a sheet: fewest bands/blocks across the page first, then fewest pages
 * down it, then the largest size (the ladder is largest-first, so `find` resolves the tie).
 */
function chooseFit<T extends { splits: number; pages: number }>(candidates: T[]): T {
  const fewestSplits = Math.min(...candidates.map(c => c.splits));
  const inSplit = candidates.filter(c => c.splits === fewestSplits);
  const fewestPages = Math.min(...inSplit.map(c => c.pages));
  return inSplit.find(c => c.pages === fewestPages)!;
}

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

/**
 * Crops × periods that have at least one bid at ANY location, in their original order. A period
 * nobody quotes yet (N/C 27 in August) drops off the sheet rather than printing as an empty column,
 * and a crop with no populated periods drops entirely. Which columns survive shifts with the season,
 * so this is driven by the data, never configured.
 */
export function selectPrintColumns(groups: PrintCropGroup[], locations: PrintLocation[]): PrintCropGroup[] {
  return groups
    .map(g => ({ crop: g.crop, columns: g.columns.filter(col => locations.some(loc => valueOf(loc, col).length > 0)) }))
    .filter(g => g.columns.length > 0);
}

export function buildPrintLayout(input: PrintLayoutInput): PrintLayoutModel {
  const tables = input.style === 'locationsAcross' ? buildLocationsAcross(input) : buildLocationsDown(input);
  return { style: input.style, tables };
}

/**
 * LOCATIONS DOWN — one Location column, then a coloured band per crop with its period columns.
 *
 * Fit-first: at each step of the type ladder, the Location column is as wide as the longest name
 * and every bid column as wide as its longest header or value. The size that keeps ALL crops on one
 * band wins — four commodities land on one line whenever the paper allows — and among those, the
 * size that keeps the sheet on the fewest pages, so thirty locations print smaller than ten. Only
 * if even the smallest step overflows the width do the CROPS split into balanced bands stacked
 * down the page, every band drawn at the same widths so a partial last band lines up under the
 * ones above rather than stretching across the sheet. Leftover width goes to the bid columns first
 * (up to a cap), then to the Location column.
 */
export function buildLocationsDown(input: Omit<PrintLayoutInput, 'style'>): PrintTable[] {
  const G = PRINT_GEOMETRY;
  // Columns nobody quotes drop first; then locations with nothing left to show.
  const groups = selectPrintColumns(input.groups, input.locations);
  const locs = selectPrintLocations(groups, input.locations);
  if (groups.length === 0 || locs.length === 0) return [];

  const chosen = fitLocationsDown(groups, locs);
  const bands = balancedChunks(groups, chosen.cropsPerBandCeiling);

  // ONE set of widths for every band, derived from the fullest band. Slack goes to the bid columns
  // first (capped so a short basis isn't lost in a huge cell), then to the Location column.
  const bandCols = maxOf(bands.map(b => b.reduce((n, g) => n + g.columns.length, 0)));
  const availIn = G.PAGE_WIDTH_IN - chosen.nameIn;
  const valueIn = clamp(availIn / bandCols, chosen.valueIn, Math.max(chosen.valueIn, G.MAX_VALUE_COL_IN));
  const nameIn = Math.max(chosen.nameIn, Math.min(G.MAX_NAME_COL_IN, G.PAGE_WIDTH_IN - valueIn * bandCols));

  const fontPx = chosen.fontPx;
  const bandFontPx = fontPx + 1;

  return bands.map(band => {
    const colWidthsIn = [nameIn];
    const bandHeader: PrintCell[] = [{ text: '', align: 'left', bg: PRINT_COLORS.headerBg, fontSizePx: bandFontPx }];
    const periodHeader: PrintCell[] = [{ text: 'Location', align: 'left', bold: true, bg: PRINT_COLORS.headerBg, fontSizePx: fontPx }];

    band.forEach((group, gi) => {
      const colors = input.cropColors(group.crop);
      const divider = gi > 0 ? `3px solid ${PRINT_COLORS.heavyRule}` : undefined;
      bandHeader.push({
        text: group.crop, align: 'center', bold: true, fontSizePx: bandFontPx,
        colspan: group.columns.length, bg: colors.tint,
        borderBottom: `3px solid ${colors.solid}`, borderLeft: divider
      });
      group.columns.forEach((col, ci) => {
        colWidthsIn.push(valueIn);
        periodHeader.push({
          text: col.compactLabel, align: 'center', bold: true, bg: PRINT_COLORS.headerBg, fontSizePx: fontPx,
          borderLeft: ci === 0 ? divider : undefined
        });
      });
    });

    const bodyRows = locs.map(loc => {
      const bg = loc.isScoular ? PRINT_COLORS.scoularBg : undefined;
      const row: PrintCell[] = [{ text: loc.name, align: 'left', wrap: true, bold: loc.isScoular, bg, fontSizePx: fontPx }];
      band.forEach((group, gi) => {
        group.columns.forEach((col, ci) => {
          row.push({
            text: valueOf(loc, col), align: 'center', mono: true, bg, fontSizePx: fontPx,
            borderLeft: gi > 0 && ci === 0 ? `3px solid ${PRINT_COLORS.heavyRule}` : undefined
          });
        });
      });
      return row;
    });

    return {
      widthPct: pageWidthPct(colWidthsIn.reduce((a, b) => a + b, 0)),
      colWidthsIn,
      fontPx,
      headerRows: [bandHeader, periodHeader],
      bodyRows
    };
  });
}

/** The Down layout's fit for a sheet: type size, measured column needs, and how the crops band. */
function fitLocationsDown(groups: PrintCropGroup[], locs: PrintLocation[]) {
  const G = PRINT_GEOMETRY;
  const allCols = groups.flatMap(g => g.columns);
  const periodsPerCrop = maxOf(groups.map(g => g.columns.length));

  /** Narrowest bid column that keeps every header, value and crop band on one line. */
  const measureValueIn = (fontPx: number): number => Math.max(
    maxOf(allCols.map(c => textWidthIn(c.compactLabel, fontPx, { bold: true }))),
    widestValueIn(locs, allCols, fontPx),
    // The crop name spans its k columns; make sure it fits too.
    maxOf(groups.map(g => textWidthIn(g.crop, fontPx + 1, { bold: true }) / g.columns.length))
  );

  const fit = (fontPx: number) => {
    const nameIn = widestNameIn(locs, fontPx);
    const valueIn = measureValueIn(fontPx);
    const cropsPerBandCeiling = Math.max(1, Math.floor(Math.floor((G.PAGE_WIDTH_IN - nameIn) / valueIn) / periodsPerCrop));
    const splits = Math.ceil(groups.length / cropsPerBandCeiling);
    // Two header rows (crop band one step larger, then the period labels) plus one row per location.
    const bandIn = rowHeightIn(fontPx + 1) + rowHeightIn(fontPx) + locs.length * rowHeightIn(fontPx);
    return { fontPx, nameIn, valueIn, cropsPerBandCeiling, splits, pages: pagesFor(stackedHeightIn(splits, bandIn)) };
  };

  return chooseFit(G.FONT_LADDER_PX.map(fit));
}

/**
 * LOCATIONS ACROSS — the transpose. Row labels down the side (a tinted band row per crop, then a
 * row per period), locations across the top.
 *
 * The label column is as wide as the longest period label. Every location column has ITS OWN width:
 * exactly what its name needs on one header line, or its widest bid if that is wider — nothing is
 * stretched to fill the page, so cells stay snug around their bids and a short sheet simply ends
 * where its columns end. Names stay on one line; only when single-line names would leave fewer
 * than MIN_AVG_LOCATIONS_PER_BLOCK locations per block may they wrap (to at most HEADER_MAX_LINES).
 * When the columns cannot all fit across, rows are packed greedily — as many locations per row as
 * fit — and stacked down the page, each repeating the crop bands and row labels so it reads on its
 * own; every row then stretches just enough to close the gap at its right edge.
 *
 * Type size is ONE STEP BELOW the DOWN layout for the same sheet (floor 9px), so switching layouts
 * never makes the text bigger and the transposed sheet reads a touch denser. Within that: fewest
 * header lines, then fewest blocks, then fewest pages, then the largest type.
 *
 * The crop is a full-width band row rather than part of every row label ("Corn O/C 26"): it keeps
 * the label column narrow, leaving the width for locations, and a band is what the eye scans for.
 * Period rows carry the crop's colour as a left rule so the association holds well below the band.
 */
export function buildLocationsAcross(input: Omit<PrintLayoutInput, 'style'>): PrintTable[] {
  const G = PRINT_GEOMETRY;
  // Columns nobody quotes drop first; then locations with nothing left to show.
  const groups = selectPrintColumns(input.groups, input.locations);
  const locs = selectPrintLocations(groups, input.locations);
  if (groups.length === 0 || locs.length === 0) return [];

  const allCols = groups.flatMap(g => g.columns);
  const downFontPx = fitLocationsDown(groups, locs).fontPx;
  // One ladder step below Down (never below the ladder floor): the transposed sheet reads denser.
  const ceilingPx = G.FONT_LADDER_PX.find(f => f < downFontPx) ?? downFontPx;
  const fonts = G.FONT_LADDER_PX.filter(f => f <= ceilingPx);

  const fitAt = (fontPx: number, lines: number) => {
    // Label cells carry a 3px crop rule on the left; the band row spans the table so it never binds.
    const labelIn = maxOf(allCols.map(c => textWidthIn(c.compactLabel, fontPx, { bold: true }))) + 3 / G.PX_PER_IN;
    const widthsIn = locs.map(l => Math.max(wrappedHeaderWidthIn(l.name, fontPx, lines), widestValueIn([l], allCols, fontPx)));
    const blocks = packBlocks(widthsIn, G.PAGE_WIDTH_IN - labelIn, G.MAX_LOCATIONS_PER_BLOCK);
    const blockIn = rowHeightIn(fontPx, lines)
      + groups.reduce((h, g) => h + rowHeightIn(fontPx + 1) + g.columns.length * rowHeightIn(fontPx), 0);
    return { fontPx, lines, labelIn, widthsIn, blocks, splits: blocks.length, pages: pagesFor(stackedHeightIn(blocks.length, blockIn)) };
  };

  // Names on one line unless that leaves the blocks too thin; then allow one more line, and so on.
  let chosen = chooseFit(fonts.map(f => fitAt(f, 1)));
  const tooThin = (c: { splits: number }) => c.splits > 1 && locs.length / c.splits < G.MIN_AVG_LOCATIONS_PER_BLOCK;
  for (let lines = 2; lines <= G.HEADER_MAX_LINES && tooThin(chosen); lines++) {
    chosen = chooseFit(fonts.map(f => fitAt(f, lines)));
  }

  const { labelIn, widthsIn, fontPx } = chosen;
  // Close the gap: each row's columns grow by just enough to reach the page edge (capped) — natural
  // widths are the floor, never the ceiling. A full row needs only a few percent; a short tail row
  // stops at the cap and leaves the rest of its line empty rather than ballooning.
  const availIn = G.PAGE_WIDTH_IN - labelIn;
  const stretchFor = (indexes: number[]) =>
    Math.min(G.MAX_COLUMN_STRETCH, availIn / indexes.reduce((w, i) => w + widthsIn[i], 0));
  const bandFontPx = fontPx + 1;

  return chosen.blocks.map(indexes => {
    const block = indexes.map(i => locs[i]);
    const stretch = stretchFor(indexes);
    const colWidthsIn = [labelIn, ...indexes.map(i => widthsIn[i] * stretch)];
    const header: PrintCell[] = [
      { text: 'Bids', align: 'left', bold: true, bg: PRINT_COLORS.headerBg, fontSizePx: fontPx },
      ...block.map<PrintCell>(loc => ({
        text: loc.name, align: 'center', wrap: true, bold: loc.isScoular, fontSizePx: fontPx,
        bg: loc.isScoular ? PRINT_COLORS.scoularBg : PRINT_COLORS.headerBg
      }))
    ];

    const bodyRows: PrintCell[][] = [];
    for (const group of groups) {
      const colors = input.cropColors(group.crop);
      bodyRows.push([{
        text: group.crop, align: 'left', bold: true, fontSizePx: bandFontPx,
        colspan: 1 + block.length, bg: colors.tint, borderBottom: `3px solid ${colors.solid}`
      }]);
      for (const col of group.columns) {
        bodyRows.push([
          { text: col.compactLabel, align: 'left', bold: true, bg: PRINT_COLORS.labelBg, fontSizePx: fontPx, borderLeft: `3px solid ${colors.solid}` },
          ...block.map<PrintCell>(loc => ({
            text: valueOf(loc, col), align: 'center', mono: true, fontSizePx: fontPx,
            bg: loc.isScoular ? PRINT_COLORS.scoularBg : undefined
          }))
        ]);
      }
    }

    return {
      widthPct: pageWidthPct(colWidthsIn.reduce((a, b) => a + b, 0)),
      colWidthsIn,
      fontPx,
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
  const G = PRINT_GEOMETRY;
  const style: Record<string, string> = {
    'padding': `${G.CELL_PAD_Y_PX}px ${G.CELL_PAD_X_PX}px`,
    'border': `1px solid ${isHeader ? PRINT_COLORS.headerLine : PRINT_COLORS.gridLine}`,
    'color': PRINT_COLORS.text,
    'font-size': `${cell.fontSizePx ?? DEFAULT_FONT_PX}px`,
    'line-height': String(G.LINE_HEIGHT),
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
  const tables = model.tables.map(renderPrintTableHtml).join(`<div style="height:${PRINT_GEOMETRY.TABLE_GAP_PX}px;"></div>`);

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
