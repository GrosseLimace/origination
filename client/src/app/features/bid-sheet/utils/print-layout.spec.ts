import { describe, expect, it } from 'vitest';
import {
  balancedChunks,
  buildLocationsAcross,
  buildLocationsDown,
  buildPrintLayout,
  cellStyleMap,
  escapeHtml,
  parsePrintLayoutStyle,
  PRINT_COLORS,
  PRINT_GEOMETRY,
  PrintCell,
  PrintColumn,
  PrintCropGroup,
  PrintLocation,
  PrintTable,
  pagesFor,
  renderPrintDocument,
  rowHeightIn,
  selectPrintLocations,
  tableColWidthPcts,
  textWidthIn,
  wrappedHeaderWidthIn,
} from './print-layout';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const COLORS = { solid: '#f59e0b', tint: '#fdf3e0' };
const cropColors = () => COLORS;
const G = PRINT_GEOMETRY;

function col(crop: string, compactLabel: string): PrintColumn {
  return { key: `${crop}#${compactLabel}`, crop, month: 0, year: 2026, label: compactLabel, compactLabel };
}

/** A crop with `n` tiny period columns labelled P1..Pn (unrealistically narrow — for structure tests). */
function group(crop: string, n: number): PrintCropGroup {
  return { crop, columns: Array.from({ length: n }, (_, i) => col(crop, `P${i + 1}`)) };
}

/** A crop with `n` realistic six-character period labels ("O/C 26", "N/C 26", "May 26", ...). */
const REAL_LABELS = ['O/C 26', 'N/C 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26'];
function realGroup(crop: string, n: number): PrintCropGroup {
  return { crop, columns: REAL_LABELS.slice(0, n).map(l => col(crop, l)) };
}

/** A location bidding `value` in every column of `groups`. */
function loc(name: string, groups: PrintCropGroup[], value = '-30', isScoular = false): PrintLocation {
  const values: Record<string, string> = {};
  for (const g of groups) for (const c of g.columns) values[c.key] = value;
  return { name, isScoular, values };
}

/** A realistic seven-character basis/flat value. */
const REAL_VALUE = '-0.4500';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const cropsIn = (t: PrintTable) => t.headerRows[0].length - 1;
const locsIn = (t: PrintTable) => t.headerRows[0].length - 1;
const allCells = (tables: PrintTable[]) => tables.flatMap(t => [...t.headerRows.flat(), ...t.bodyRows.flat()]);

// ── parsePrintLayoutStyle ───────────────────────────────────────────────────────────────────────

describe('parsePrintLayoutStyle', () => {
  it('round-trips the two current styles', () => {
    expect(parsePrintLayoutStyle('locationsDown')).toBe('locationsDown');
    expect(parsePrintLayoutStyle('locationsAcross')).toBe('locationsAcross');
  });

  it('migrates the retired layouts and garbage to the default', () => {
    expect(parsePrintLayoutStyle('sideBySide')).toBe('locationsDown');
    expect(parsePrintLayoutStyle('stacked')).toBe('locationsDown');
    expect(parsePrintLayoutStyle(undefined)).toBe('locationsDown');
    expect(parsePrintLayoutStyle(null)).toBe('locationsDown');
    expect(parsePrintLayoutStyle(42)).toBe('locationsDown');
    expect(parsePrintLayoutStyle('garbage')).toBe('locationsDown');
  });
});

// ── balancedChunks / textWidthIn ────────────────────────────────────────────────────────────────

describe('balancedChunks', () => {
  const n = (count: number) => Array.from({ length: count }, (_, i) => i);
  const sizes = (chunks: unknown[][]) => chunks.map(c => c.length);

  it('evens chunks out instead of leaving a remainder of one', () => {
    expect(sizes(balancedChunks(n(5), 4))).toEqual([3, 2]);
    expect(sizes(balancedChunks(n(7), 4))).toEqual([4, 3]);
    expect(sizes(balancedChunks(n(8), 4))).toEqual([4, 4]);
    expect(sizes(balancedChunks(n(3), 4))).toEqual([3]);
  });

  it('handles empty input and a non-positive ceiling', () => {
    expect(balancedChunks([], 4)).toEqual([]);
    expect(sizes(balancedChunks(n(3), 0))).toEqual([1, 1, 1]);
  });
});

describe('wrappedHeaderWidthIn', () => {
  it('is the full single-line width by default, and on more lines the longest word or the spread, whichever is wider', () => {
    const name = 'Scoular Grain Handling Facility';
    expect(wrappedHeaderWidthIn(name, 12)).toBe(textWidthIn(name, 12, { bold: true }));
    expect(wrappedHeaderWidthIn(name, 12, 2)).toBeLessThan(wrappedHeaderWidthIn(name, 12, 1));
    expect(wrappedHeaderWidthIn(name, 12, 3)).toBeLessThan(wrappedHeaderWidthIn(name, 12, 2));
    expect(wrappedHeaderWidthIn(name, 12, 3)).toBeGreaterThanOrEqual(textWidthIn('Handling', 12, { bold: true }));
    expect(wrappedHeaderWidthIn('Supercalifragilistic', 12, 3)).toBe(textWidthIn('Supercalifragilistic', 12, { bold: true }));
  });
});

describe('rowHeightIn / pagesFor', () => {
  it('scales row height with type size and line count, and pages with the body height', () => {
    expect(rowHeightIn(12)).toBeGreaterThan(rowHeightIn(9));
    expect(rowHeightIn(12, 3)).toBeGreaterThan(2 * rowHeightIn(12));
    const body = G.PAGE_HEIGHT_IN - G.PAGE_CHROME_IN;
    expect(pagesFor(0)).toBe(1);
    expect(pagesFor(body)).toBe(1);
    expect(pagesFor(body + 0.01)).toBe(2);
  });
});

describe('textWidthIn', () => {
  it('grows with length and type size, bold and mono run wider, and an empty string is just the cell chrome', () => {
    expect(textWidthIn('abcd', 10)).toBeGreaterThan(textWidthIn('ab', 10));
    expect(textWidthIn('abcd', 12)).toBeGreaterThan(textWidthIn('abcd', 10));
    expect(textWidthIn('abcd', 10, { bold: true })).toBeGreaterThan(textWidthIn('abcd', 10));
    expect(textWidthIn('1234', 10, { mono: true })).toBeGreaterThan(textWidthIn('1234', 10));
    expect(near(textWidthIn('', 10), (2 * G.CELL_PAD_X_PX + G.CELL_BORDER_PX) / G.PX_PER_IN)).toBe(true);
  });
});

// ── selectPrintLocations ────────────────────────────────────────────────────────────────────────

describe('selectPrintLocations', () => {
  const groups = [group('Corn', 2), group('Wheat', 2)];

  it('drops locations with no bid in any selected column, keeps single-crop bidders, preserves order', () => {
    const wheatOnly: PrintLocation = { name: 'Wheat Only', isScoular: false, values: { 'Wheat#P2': '-10' } };
    const none: PrintLocation = { name: 'Nothing', isScoular: false, values: {} };
    const scoular = loc('Scoular Pratt', groups, '-20', true);
    const result = selectPrintLocations(groups, [wheatOnly, none, scoular]);
    expect(result.map(l => l.name)).toEqual(['Wheat Only', 'Scoular Pratt']);
  });

  it('treats whitespace-only values as empty', () => {
    const blank: PrintLocation = { name: 'Blank', isScoular: false, values: { 'Corn#P1': '   ' } };
    expect(selectPrintLocations(groups, [blank])).toEqual([]);
  });

  it('ignores columns that are not selected', () => {
    const other: PrintLocation = { name: 'Other', isScoular: false, values: { 'Milo#P1': '-50' } };
    expect(selectPrintLocations(groups, [other])).toEqual([]);
  });
});

// ── buildLocationsDown ──────────────────────────────────────────────────────────────────────────

describe('buildLocationsDown', () => {
  it('builds one band: blank+crop headers with colspans, Location+period sub-headers, one row per location', () => {
    const groups = [group('Corn', 2), group('Wheat', 2), group('Milo', 2)];
    const locs = [loc('Alpha', groups), loc('Bravo', groups)];
    const tables = buildLocationsDown({ groups, locations: locs, cropColors });

    expect(tables).toHaveLength(1);
    const [t] = tables;
    expect(t.headerRows).toHaveLength(2);
    expect(t.headerRows[0].map(c => c.text)).toEqual(['', 'Corn', 'Wheat', 'Milo']);
    expect(t.headerRows[0].slice(1).map(c => c.colspan)).toEqual([2, 2, 2]);
    expect(t.headerRows[1].map(c => c.text)).toEqual(['Location', 'P1', 'P2', 'P1', 'P2', 'P1', 'P2']);
    expect(t.colWidthsIn).toHaveLength(7);
    expect(t.widthPct).toBeLessThanOrEqual(100 + 1e-6);
    expect(t.bodyRows.map(r => r[0].text)).toEqual(['Alpha', 'Bravo']);
    expect(t.bodyRows[0]).toHaveLength(7);
    expect(t.bodyRows[0][1]).toMatchObject({ text: '-30', mono: true, align: 'center' });
  });

  it('lists each location ONCE per band, in grid order, even when a location bids only one crop', () => {
    const groups = [group('Corn', 1), group('Wheat', 1)];
    const cornOnly: PrintLocation = { name: 'Corn Only', isScoular: false, values: { 'Corn#P1': '-40' } };
    const both = loc('Both', groups);
    const [t] = buildLocationsDown({ groups, locations: [cornOnly, both], cropColors });
    expect(t.bodyRows.map(r => r[0].text)).toEqual(['Corn Only', 'Both']);
    expect(t.bodyRows[0].map(c => c.text)).toEqual(['Corn Only', '-40', '']);
  });

  it('fits four crops with old/new-crop columns on ONE band at the largest type size', () => {
    const groups = Array.from({ length: 4 }, (_, i) => realGroup(`Crop${i}`, 2));
    const tables = buildLocationsDown({ groups, locations: [loc('Scoular Pratt', groups, REAL_VALUE, true), loc('CHS Cullison', groups, REAL_VALUE)], cropColors });
    expect(tables).toHaveLength(1);
    expect(tables[0].fontPx).toBe(G.FONT_LADDER_PX[0]);
    expect(cropsIn(tables[0])).toBe(4);
  });

  it('steps the type size down rather than splitting when four crops × four periods only fit smaller', () => {
    const groups = Array.from({ length: 4 }, (_, i) => realGroup(`Crop${i}`, 4));
    const tables = buildLocationsDown({ groups, locations: [loc('Short', groups, REAL_VALUE)], cropColors });
    expect(tables).toHaveLength(1);
    expect(tables[0].fontPx).toBeLessThan(G.FONT_LADDER_PX[0]);
    expect(G.FONT_LADDER_PX).toContain(tables[0].fontPx);
    expect(cropsIn(tables[0])).toBe(4);
  });

  it('stamps the chosen type size on every cell, one step larger on the crop band', () => {
    const groups = Array.from({ length: 4 }, (_, i) => realGroup(`Crop${i}`, 4));
    const [t] = buildLocationsDown({ groups, locations: [loc('Short', groups, REAL_VALUE)], cropColors });
    expect(t.headerRows[0].slice(1).every(c => c.fontSizePx === t.fontPx + 1)).toBe(true);
    expect(t.headerRows[1].every(c => c.fontSizePx === t.fontPx)).toBe(true);
    expect(t.bodyRows.flat().every(c => c.fontSizePx === t.fontPx)).toBe(true);
  });

  it('splits crops into balanced bands only when even the smallest type cannot fit them: 6 × 4 → 3 + 3', () => {
    const groups = Array.from({ length: 6 }, (_, i) => realGroup(`Crop${i}`, 4));
    const tables = buildLocationsDown({ groups, locations: [loc('Short', groups, REAL_VALUE)], cropColors });
    expect(tables.map(cropsIn)).toEqual([3, 3]);
    // Every size needs two bands and one location fits one page, so the largest type wins.
    expect(tables[0].fontPx).toBe(G.FONT_LADDER_PX[0]);
  });

  it('shrinks the type when many locations would spill onto a second page, and not otherwise', () => {
    const groups = Array.from({ length: 4 }, (_, i) => realGroup(`Crop${i}`, 2));
    const few = Array.from({ length: 8 }, (_, i) => loc(`Elevator ${i + 1}`, groups, REAL_VALUE));
    const many = Array.from({ length: 32 }, (_, i) => loc(`Elevator ${i + 1}`, groups, REAL_VALUE));
    const [fewTable] = buildLocationsDown({ groups, locations: few, cropColors });
    const [manyTable] = buildLocationsDown({ groups, locations: many, cropColors });

    expect(fewTable.fontPx).toBe(G.FONT_LADDER_PX[0]);
    expect(manyTable.fontPx).toBeLessThan(fewTable.fontPx);
    // ...and the smaller size is the one that actually lands on a single page.
    const heightIn = rowHeightIn(manyTable.fontPx + 1) + rowHeightIn(manyTable.fontPx) + 32 * rowHeightIn(manyTable.fontPx);
    expect(pagesFor(heightIn)).toBe(1);
    expect(pagesFor(rowHeightIn(13) + rowHeightIn(12) + 32 * rowHeightIn(12))).toBeGreaterThan(1);
  });

  it('draws a partial last band at the SAME widths as the full ones, narrower rather than stretched', () => {
    const groups = Array.from({ length: 5 }, (_, i) => realGroup(`Crop${i}`, 4));
    const tables = buildLocationsDown({ groups, locations: [loc('Short', groups, REAL_VALUE)], cropColors });
    expect(tables.map(cropsIn)).toEqual([3, 2]);
    const [full, partial] = tables;
    expect(partial.colWidthsIn).toEqual(full.colWidthsIn.slice(0, partial.colWidthsIn.length));
    expect(near(full.widthPct, 100)).toBe(true);
    expect(partial.widthPct).toBeLessThan(full.widthPct);
  });

  it('never makes a column narrower than its longest header, value or name needs at the chosen size', () => {
    const longName = 'Scoular Grain Handling Facility at Somewhere Far Away';
    const groups = Array.from({ length: 4 }, (_, i) => realGroup(`Crop${i}`, 4));
    const tables = buildLocationsDown({ groups, locations: [loc(longName, groups, REAL_VALUE, true), loc('CHS', groups, '-1.2345')], cropColors });
    for (const t of tables) {
      expect(t.colWidthsIn[0]).toBeGreaterThanOrEqual(textWidthIn(longName, t.fontPx, { bold: true }) - 1e-9);
      for (const w of t.colWidthsIn.slice(1)) {
        expect(w).toBeGreaterThanOrEqual(textWidthIn('O/C 26', t.fontPx, { bold: true }) - 1e-9);
        expect(w).toBeGreaterThanOrEqual(textWidthIn('-1.2345', t.fontPx, { mono: true }) - 1e-9);
      }
      expect(sum(t.colWidthsIn)).toBeLessThanOrEqual(G.PAGE_WIDTH_IN + 1e-6);
    }
  });

  it('gives long names a wider Location column, paying with bands rather than wrapping', () => {
    const groups = Array.from({ length: 4 }, (_, i) => realGroup(`Crop${i}`, 4));
    const shortTables = buildLocationsDown({ groups, locations: [loc('Short', groups, REAL_VALUE)], cropColors });
    const longTables = buildLocationsDown({ groups, locations: [loc('A'.repeat(40), groups, REAL_VALUE)], cropColors });
    expect(shortTables).toHaveLength(1);
    expect(longTables.length).toBeGreaterThan(1);
    expect(longTables[0].colWidthsIn[0]).toBeGreaterThan(shortTables[0].colWidthsIn[0]);
  });

  it('puts the heavy divider on the first column of every crop after the first, and nowhere else', () => {
    const groups = [group('Corn', 2), group('Wheat', 2)];
    const [t] = buildLocationsDown({ groups, locations: [loc('X', groups)], cropColors });
    const heavy = `3px solid ${PRINT_COLORS.heavyRule}`;
    expect(t.headerRows[0].map(c => c.borderLeft)).toEqual([undefined, undefined, heavy]);
    expect(t.headerRows[1].map(c => c.borderLeft)).toEqual([undefined, undefined, undefined, heavy, undefined]);
    expect(t.bodyRows[0].map(c => c.borderLeft)).toEqual([undefined, undefined, undefined, heavy, undefined]);
  });

  it('colours the crop band from the palette callback with the solid hue as a bottom rule', () => {
    const groups = [group('Corn', 1)];
    const [t] = buildLocationsDown({ groups, locations: [loc('X', groups)], cropColors });
    expect(t.headerRows[0][1]).toMatchObject({ bg: COLORS.tint, borderBottom: `3px solid ${COLORS.solid}`, bold: true });
  });

  it('highlights a Scoular row across every cell and bolds its name; leaves others white', () => {
    const groups = [group('Corn', 2)];
    const [t] = buildLocationsDown({
      groups, locations: [loc('Scoular Pratt', groups, '-20', true), loc('CHS', groups)], cropColors
    });
    expect(t.bodyRows[0].every(c => c.bg === PRINT_COLORS.scoularBg)).toBe(true);
    expect(t.bodyRows[0][0].bold).toBe(true);
    expect(t.bodyRows[1].every(c => c.bg === undefined)).toBe(true);
    expect(t.bodyRows[1][0].bold).toBe(false);
  });

  it('emits no yellow when no location is flagged (Highlight toggle off)', () => {
    const groups = [group('Corn', 2)];
    const tables = buildLocationsDown({ groups, locations: [loc('A', groups), loc('B', groups)], cropColors });
    expect(allCells(tables).some(c => c.bg === PRINT_COLORS.scoularBg)).toBe(false);
  });

  it('prints an empty string, not a dash, for a missing bid', () => {
    const groups = [group('Corn', 2)];
    const partial: PrintLocation = { name: 'P', isScoular: false, values: { 'Corn#P1': '-5' } };
    const [t] = buildLocationsDown({ groups, locations: [partial], cropColors });
    expect(t.bodyRows[0].map(c => c.text)).toEqual(['P', '-5', '']);
  });

  it('returns no tables when nothing is selected or nobody has a bid', () => {
    const groups = [group('Corn', 2)];
    expect(buildLocationsDown({ groups: [], locations: [loc('X', groups)], cropColors })).toEqual([]);
    expect(buildLocationsDown({ groups, locations: [], cropColors })).toEqual([]);
    expect(buildLocationsDown({ groups: [{ crop: 'Corn', columns: [] }], locations: [loc('X', groups)], cropColors })).toEqual([]);
    const silent: PrintLocation = { name: 'Silent', isScoular: true, values: {} };
    expect(buildLocationsDown({ groups, locations: [silent], cropColors })).toEqual([]);
  });
});

// ── buildLocationsAcross ────────────────────────────────────────────────────────────────────────

describe('buildLocationsAcross', () => {
  const manyLocs = (count: number, groups: PrintCropGroup[], nameLen = 6) =>
    Array.from({ length: count }, (_, i) => loc(`L${String(i + 1).padStart(2, '0')}`.padEnd(nameLen, 'x'), groups));

  it('puts locations across the top and a tinted band row + one row per period under each crop', () => {
    const groups = [group('Corn', 2), group('Wheat', 1)];
    const locs = [loc('Alpha', groups), loc('Bravo', groups), loc('Charlie', groups)];
    const tables = buildLocationsAcross({ groups, locations: locs, cropColors });

    expect(tables).toHaveLength(1);
    const [t] = tables;
    expect(t.headerRows).toHaveLength(1);
    expect(t.headerRows[0].map(c => c.text)).toEqual(['Bids', 'Alpha', 'Bravo', 'Charlie']);
    expect(t.colWidthsIn).toHaveLength(4);
    // Label column is measured from the widest period label, not a fixed inch.
    expect(t.colWidthsIn[0]).toBeGreaterThanOrEqual(textWidthIn('P1', t.fontPx, { bold: true }));
    expect(t.colWidthsIn[0]).toBeLessThan(0.6);

    // Corn band, P1, P2, Wheat band, P1
    expect(t.bodyRows.map(r => r[0].text)).toEqual(['Corn', 'P1', 'P2', 'Wheat', 'P1']);
    expect(t.bodyRows[0]).toHaveLength(1);
    expect(t.bodyRows[0][0]).toMatchObject({ colspan: 4, bg: COLORS.tint, borderBottom: `3px solid ${COLORS.solid}`, bold: true, fontSizePx: t.fontPx + 1 });
    expect(t.bodyRows[1]).toHaveLength(4);
    expect(t.bodyRows[1][0]).toMatchObject({ text: 'P1', borderLeft: `3px solid ${COLORS.solid}`, bold: true });
    expect(t.bodyRows[1][1]).toMatchObject({ text: '-30', mono: true, align: 'center' });
  });

  it('packs rows greedily up to the per-row ceiling: 30 → 14 + 14 + 2', () => {
    const groups = [group('Corn', 2)];
    const tables = buildLocationsAcross({ groups, locations: manyLocs(30, groups), cropColors });
    expect(tables.map(locsIn)).toEqual([14, 14, 2]);
    const [down] = buildLocationsDown({ groups, locations: manyLocs(30, groups), cropColors });
    expect(tables[0].fontPx).toBe(Math.max(G.FONT_LADDER_PX[G.FONT_LADDER_PX.length - 1], down.fontPx - 1));
    for (const t of tables) {
      // Same tiny names → same column widths; the tail row is a prefix of a full row.
      expect(t.colWidthsIn).toEqual(tables[0].colWidthsIn.slice(0, t.colWidthsIn.length));
      expect(t.bodyRows.map(r => r[0].text)).toEqual(['Corn', 'P1', 'P2']);
    }
  });

  it('keeps a partial last block at the same widths, narrower rather than stretched', () => {
    const groups = [group('Corn', 2)];
    const tables = buildLocationsAcross({ groups, locations: manyLocs(25, groups), cropColors });
    expect(tables.map(locsIn)).toEqual([14, 11]);
    const [full, partial] = tables;
    // Tiny names hit the stretch cap in both rows, so the shorter row is a prefix of the full one.
    expect(partial.colWidthsIn).toEqual(full.colWidthsIn.slice(0, partial.colWidthsIn.length));
    expect(partial.widthPct).toBeLessThan(full.widthPct);
  });

  it('lets long names wrap only when single-line names would leave fewer than four per block: 14 → 5 + 5 + 4', () => {
    const groups = [realGroup('Corn', 2)];
    const longNames = Array.from({ length: 14 }, (_, i) => loc(`Scoular Grain Handling Facility Number ${i + 10}`, groups, REAL_VALUE));
    const tables = buildLocationsAcross({ groups, locations: longNames, cropColors });
    expect(tables.map(locsIn)).toEqual([5, 5, 4]);
    expect(tables[0].fontPx).toBeLessThan(G.FONT_LADDER_PX[0]);
    expect(tables[0].widthPct).toBeLessThanOrEqual(100 + 1e-6);
    for (const t of tables) {
      for (const cell of t.headerRows[0].slice(1)) expect(cell.wrap).toBe(true);
      for (const w of t.colWidthsIn.slice(1)) {
        expect(w).toBeGreaterThanOrEqual(wrappedHeaderWidthIn(longNames[0].name, t.fontPx, G.HEADER_MAX_LINES) - 1e-9);
        expect(w).toBeGreaterThanOrEqual(textWidthIn(REAL_VALUE, t.fontPx, { mono: true }) - 1e-9);
      }
    }
  });

  it('never splits a single word: an unbroken 60-character name still gets a column wide enough for it', () => {
    const groups = [group('Corn', 1)];
    const tables = buildLocationsAcross({ groups, locations: manyLocs(16, groups, 60), cropColors });
    for (const t of tables) {
      expect(locsIn(t)).toBeLessThanOrEqual(2);
      for (const w of t.colWidthsIn.slice(1)) expect(w).toBeGreaterThanOrEqual(textWidthIn('x'.repeat(60), t.fontPx, { bold: true }) - 1e-9);
    }
    expect(sum(tables.map(locsIn))).toBe(16);
  });

  it('never uses larger type than the Down layout would for the same sheet, and sits one step below it when both fit a page', () => {
    const groups = [realGroup('Corn', 2), realGroup('Wheat', 2)];
    const names = Array.from({ length: 20 }, (_, i) => loc(`Cooperative Elevator Site ${String(i + 1).padStart(2, '0')}`, groups, REAL_VALUE));
    const across = buildLocationsAcross({ groups, locations: names, cropColors });
    const [down] = buildLocationsDown({ groups, locations: names, cropColors });
    expect(across[0].fontPx).toBeLessThanOrEqual(down.fontPx);

    const few = names.slice(0, 6);
    const acrossFew = buildLocationsAcross({ groups, locations: few, cropColors });
    const [downFew] = buildLocationsDown({ groups, locations: few, cropColors });
    expect(acrossFew).toHaveLength(1);
    expect(acrossFew[0].fontPx).toBe(Math.max(G.FONT_LADDER_PX[G.FONT_LADDER_PX.length - 1], downFew.fontPx - 1));
  });

  it('lets ONE long-winded name wrap tall instead of narrowing every column: 13 locations still pack 9+ per block', () => {
    const groups = [realGroup('Corn', 2)];
    const locs = [
      ...Array.from({ length: 12 }, (_, i) => loc(`Site ${i + 1}`, groups, REAL_VALUE)),
      loc('Bartlett Grain Company Jacksonville River Terminal Facility', groups, REAL_VALUE)
    ];
    const tables = buildLocationsAcross({ groups, locations: locs, cropColors });
    expect(tables.length).toBeLessThanOrEqual(2);
    expect(Math.max(...tables.map(locsIn))).toBeGreaterThanOrEqual(7);
    // The header cell is allowed to wrap; the column is only as wide as the longest word needs.
    const longHeader = tables.flatMap(t => t.headerRows[0]).find(c => c.text.startsWith('Bartlett'))!;
    expect(longHeader.wrap).toBe(true);
    // Only the long name's own column pays for it; the "Site N" columns stay narrow.
    const host = tables.find(t => t.headerRows[0].some(c => c.text.startsWith('Bartlett')))!;
    const longIdx = host.headerRows[0].findIndex(c => c.text.startsWith('Bartlett'));
    expect(host.colWidthsIn[longIdx]).toBeGreaterThanOrEqual(textWidthIn('Jacksonville', host.fontPx, { bold: true }) - 1e-9);
    const siteIdx = host.headerRows[0].findIndex(c => c.text.startsWith('Site'));
    if (siteIdx > 0) expect(host.colWidthsIn[siteIdx]).toBeLessThan(host.colWidthsIn[longIdx]);
  });

  it('shrinks the type when stacked blocks would spill onto a second page, and not otherwise', () => {
    const groups = Array.from({ length: 4 }, (_, i) => realGroup(`Crop${i}`, 2));
    const few = Array.from({ length: 6 }, (_, i) => loc(`Cooperative Elevator Site ${i + 1}`, groups, REAL_VALUE));
    const many = Array.from({ length: 24 }, (_, i) => loc(`Cooperative Elevator Site ${i + 1}`, groups, REAL_VALUE));
    const fewTables = buildLocationsAcross({ groups, locations: few, cropColors });
    const manyTables = buildLocationsAcross({ groups, locations: many, cropColors });

    expect(fewTables).toHaveLength(1);
    expect(fewTables[0].fontPx).toBe(G.FONT_LADDER_PX[1]); // one step below Down (12px) by design
    expect(manyTables.length).toBeGreaterThan(1);
    expect(manyTables[0].fontPx).toBeLessThan(fewTables[0].fontPx);
  });

  it('keeps names on one line and packs as many as fit: 12 medium names → 6 + 6 (two rows at 10px beats two rows at 9px)', () => {
    const groups = [realGroup('Corn', 2), realGroup('Wheat', 2)];
    const locs = Array.from({ length: 12 }, (_, i) => loc(`Cooperative Elevator ${i + 1}`, groups, REAL_VALUE));
    const tables = buildLocationsAcross({ groups, locations: locs, cropColors });
    expect(tables.map(locsIn)).toEqual([6, 6]);
    for (const t of tables) {
      // Each column starts from its single-line name width (the bids are narrower) and is stretched
      // by one shared factor — never below natural, never past the cap — so the block spans the page.
      t.headerRows[0].slice(1).forEach((cell, i) => {
        const natural = textWidthIn(cell.text, t.fontPx, { bold: true });
        expect(t.colWidthsIn[i + 1]).toBeGreaterThanOrEqual(natural - 1e-9);
        expect(t.colWidthsIn[i + 1]).toBeLessThanOrEqual(natural * G.MAX_COLUMN_STRETCH + 1e-9);
      });
    }
    // The full first row closes its gap and spans the page.
    expect(near(tables[0].widthPct, 100)).toBe(true);
    const [down] = buildLocationsDown({ groups, locations: locs, cropColors });
    expect(tables[0].fontPx).toBeLessThanOrEqual(down.fontPx);
  });

  it('never lets a bid be wider than its column', () => {
    const groups = [group('Corn', 1)];
    const wide: PrintLocation = { name: 'Ab', isScoular: false, values: { 'Corn#P1': '-1.234567890' } };
    const [t] = buildLocationsAcross({ groups, locations: [wide], cropColors });
    expect(t.colWidthsIn[1]).toBeGreaterThanOrEqual(textWidthIn('-1.234567890', t.fontPx, { mono: true }) - 1e-9);
  });

  it('keeps a short list in one block with snug columns — no stretching to fill the page', () => {
    const groups = [group('Corn', 1)];
    const five = buildLocationsAcross({ groups, locations: manyLocs(5, groups), cropColors });
    expect(five).toHaveLength(1);
    expect(five[0].headerRows[0]).toHaveLength(6);
    expect(five[0].widthPct).toBeLessThan(60);
    const [, ...locCols] = five[0].colWidthsIn;
    expect(new Set(locCols.map(w => w.toFixed(6))).size).toBe(1);
    // Five tiny names cannot fill the page: they stretch only to the cap, not to absurd widths.
    expect(near(locCols[0], textWidthIn(five[0].headerRows[0][1].text, five[0].fontPx, { bold: true }) * G.MAX_COLUMN_STRETCH)).toBe(true);
  });

  it('fills each row: a full row spans the page, and a short tail row stops at the stretch cap', () => {
    const groups = [realGroup('Corn', 2)];
    const locs = Array.from({ length: 12 }, (_, i) => loc(i === 2 ? 'Farmers Cooperative Dorchester - Herkimer' : `Elevator ${i + 1}`, groups, REAL_VALUE));
    const tables = buildLocationsAcross({ groups, locations: locs, cropColors });
    expect(tables).toHaveLength(2);
    expect(locsIn(tables[0])).toBeGreaterThan(locsIn(tables[1]));
    expect(near(tables[0].widthPct, 100)).toBe(true);
    // The tail row's columns grow only to the cap, so it does not balloon to the page edge.
    const widthOf = (t: PrintTable, prefix: string) => t.colWidthsIn[t.headerRows[0].findIndex(c => c.text.startsWith(prefix))];
    const natural = textWidthIn('Elevator 10', tables[1].fontPx, { bold: true });
    expect(near(widthOf(tables[1], 'Elevator 10'), natural * G.MAX_COLUMN_STRETCH)).toBe(true);
    expect(tables[1].widthPct).toBeLessThan(60);
  });

  it('sizes each column to ITS OWN name, so one long name does not widen the others', () => {
    const groups = [realGroup('Corn', 2)];
    const locs = [loc('Kanza East', groups, REAL_VALUE), loc('Farmers Cooperative Dorchester - Herkimer', groups, REAL_VALUE), loc('Cargill Hutchinson', groups, REAL_VALUE)];
    const [t] = buildLocationsAcross({ groups, locations: locs, cropColors });
    const [, short, long, mid] = t.colWidthsIn;
    expect(short).toBeLessThan(mid);
    expect(mid).toBeLessThan(long);
    // Uniform stretch keeps the proportions of the natural widths.
    const ratio = textWidthIn('Farmers Cooperative Dorchester - Herkimer', t.fontPx, { bold: true }) / textWidthIn('Kanza East', t.fontPx, { bold: true });
    expect(near(long / short, ratio)).toBe(true);
  });

  it('never exceeds the per-block ceiling', () => {
    const groups = [group('Corn', 1)];
    const tables = buildLocationsAcross({ groups, locations: manyLocs(40, groups, 3), cropColors });
    for (const t of tables) expect(locsIn(t)).toBeLessThanOrEqual(G.MAX_LOCATIONS_PER_BLOCK);
    expect(sum(tables.map(locsIn))).toBe(40);
  });

  it('highlights a Scoular COLUMN in the header and every period row, but not the band rows', () => {
    const groups = [group('Corn', 2)];
    const locs = [loc('CHS', groups), loc('Scoular Pratt', groups, '-20', true), loc('ADM', groups)];
    const [t] = buildLocationsAcross({ groups, locations: locs, cropColors });
    const scoularIdx = 2; // label column + CHS + Scoular

    expect(t.headerRows[0][scoularIdx]).toMatchObject({ bg: PRINT_COLORS.scoularBg, bold: true });
    expect(t.headerRows[0][1].bg).toBe(PRINT_COLORS.headerBg);
    expect(t.headerRows[0][1].bold).toBe(false);
    for (const row of t.bodyRows.slice(1)) {
      expect(row[scoularIdx].bg).toBe(PRINT_COLORS.scoularBg);
      expect(row[1].bg).toBeUndefined();
      expect(row[3].bg).toBeUndefined();
    }
    expect(t.bodyRows[0][0].bg).toBe(COLORS.tint);
  });

  it('prints an empty string for a missing bid and returns nothing for empty input', () => {
    const groups = [group('Corn', 2)];
    const partial: PrintLocation = { name: 'P', isScoular: false, values: { 'Corn#P2': '-5' } };
    const [t] = buildLocationsAcross({ groups, locations: [partial], cropColors });
    expect(t.bodyRows[1].map(c => c.text)).toEqual(['P1', '']);
    expect(t.bodyRows[2].map(c => c.text)).toEqual(['P2', '-5']);

    expect(buildLocationsAcross({ groups: [], locations: [partial], cropColors })).toEqual([]);
    expect(buildLocationsAcross({ groups, locations: [], cropColors })).toEqual([]);
  });
});

// ── buildPrintLayout ────────────────────────────────────────────────────────────────────────────

describe('buildPrintLayout', () => {
  const groups = [group('Corn', 2)];
  const locations = [loc('A', groups)];

  it('dispatches on style and echoes it on the model', () => {
    const down = buildPrintLayout({ style: 'locationsDown', groups, locations, cropColors });
    const across = buildPrintLayout({ style: 'locationsAcross', groups, locations, cropColors });
    expect(down.style).toBe('locationsDown');
    expect(down.tables[0].headerRows).toHaveLength(2);
    expect(across.style).toBe('locationsAcross');
    expect(across.tables[0].headerRows).toHaveLength(1);
  });
});

// ── tableColWidthPcts / cellStyleMap / escapeHtml ───────────────────────────────────────────────

describe('tableColWidthPcts', () => {
  it('expresses widths relative to the TABLE so a partial band keeps its column sizes', () => {
    const groups = Array.from({ length: 5 }, (_, i) => realGroup(`Crop${i}`, 4));
    const [, partial] = buildLocationsDown({ groups, locations: [loc('Short', groups, REAL_VALUE)], cropColors });
    const pcts = tableColWidthPcts(partial);
    expect(near(sum(pcts), 100)).toBe(true);
    expect(pcts).toHaveLength(partial.colWidthsIn.length);
  });
});

describe('cellStyleMap', () => {
  const base: PrintCell = { text: 'x', align: 'center' };

  it('always forces print colour adjustment, uses tight padding, and header vs body grid lines', () => {
    const header = cellStyleMap(base, true);
    const body = cellStyleMap(base, false);
    expect(header['print-color-adjust']).toBe('exact');
    expect(header['-webkit-print-color-adjust']).toBe('exact');
    expect(header['border']).toContain(PRINT_COLORS.headerLine);
    expect(body['border']).toContain(PRINT_COLORS.gridLine);
    expect(body['padding']).toBe(`${G.CELL_PAD_Y_PX}px ${G.CELL_PAD_X_PX}px`);
    expect(body['font-size']).toBe('10px');
  });

  it('maps the cell flags to CSS', () => {
    const mono = cellStyleMap({ ...base, mono: true }, false);
    expect(mono['font-family']).toContain('monospace');
    expect(mono['white-space']).toBe('nowrap');
    expect(mono['text-overflow']).toBe('ellipsis');

    const wrap = cellStyleMap({ ...base, wrap: true, bold: true, bg: '#abc', borderLeft: '3px solid red', borderBottom: '3px solid blue', fontSizePx: 11 }, false);
    expect(wrap['white-space']).toBe('normal');
    expect(wrap['overflow-wrap']).toBe('break-word');
    expect(wrap['text-overflow']).toBeUndefined();
    expect(wrap['font-weight']).toBe('700');
    expect(wrap['background']).toBe('#abc');
    expect(wrap['border-left']).toBe('3px solid red');
    expect(wrap['border-bottom']).toBe('3px solid blue');
    expect(wrap['font-size']).toBe('11px');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`Bob's <Elevator> & "Co"`)).toBe('Bob&#039;s &lt;Elevator&gt; &amp; &quot;Co&quot;');
  });
});

// ── renderPrintDocument ─────────────────────────────────────────────────────────────────────────

describe('renderPrintDocument', () => {
  const groups = [group('Corn', 2)];
  const chrome = {
    address: '123 Test Road <Anytown>',
    phone: '(555) 123-4567',
    dateText: 'Friday, August 21, 2026',
    logoUrl: 'https://app.example.com/assets/images/scoular-logo-dark.webp'
  };

  it('escapes user text, carries the page setup and chrome, and never prints dashes for blanks', () => {
    const partial: PrintLocation = { name: `Bob's <Elevator> & Co`, isScoular: false, values: { 'Corn#P1': '-5' } };
    const model = buildPrintLayout({ style: 'locationsDown', groups, locations: [partial], cropColors });
    const html = renderPrintDocument(model, chrome);

    expect(html).toContain('Bob&#039;s &lt;Elevator&gt; &amp; Co');
    expect(html).not.toContain('<Elevator>');
    expect(html).toContain('123 Test Road &lt;Anytown&gt;');
    expect(html).toContain('(555) 123-4567');
    expect(html).toContain('Friday, August 21, 2026');
    expect(html).toContain(`src="${chrome.logoUrl}"`);
    expect(html).toContain(`@page { margin: ${G.PAGE_MARGIN_IN}in; size: landscape; }`);
    expect(html).toContain('print-color-adjust:exact');
    expect(html).toContain('Confidential');
    expect(html).not.toContain('&mdash;</td>');
    expect(html).not.toContain('&nbsp;');
  });

  it('omits empty address/phone lines and sizes a partial band below 100%', () => {
    const wide = Array.from({ length: 5 }, (_, i) => realGroup(`Crop${i}`, 4));
    const model = buildPrintLayout({ style: 'locationsDown', groups: wide, locations: [loc('Short', wide, REAL_VALUE)], cropColors });
    const html = renderPrintDocument(model, { ...chrome, address: '  ', phone: '' });

    expect(html).not.toContain('<p></p>');
    expect(html).toContain('width:100.000%');
    expect(html).toMatch(/<table style="width:(?!100\.000%)\d+\.\d{3}%/);
    expect(html).toContain('page-break-inside:avoid');
    expect((html.match(/<table /g) ?? []).length).toBe(2);
  });

  it('renders colspans only when greater than one', () => {
    const model = buildPrintLayout({ style: 'locationsAcross', groups, locations: [loc('A', groups)], cropColors });
    const html = renderPrintDocument(model, chrome);
    expect(html).toContain('colspan="2"');
    expect(html).not.toContain('colspan="1"');
  });
});
