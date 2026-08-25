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
  renderPrintDocument,
  selectPrintLocations,
  tableColWidthPcts,
} from './print-layout';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const COLORS = { solid: '#f59e0b', tint: '#fdf3e0' };
const cropColors = () => COLORS;

function col(crop: string, compactLabel: string): PrintColumn {
  return { key: `${crop}#${compactLabel}`, crop, month: 0, year: 2026, label: compactLabel, compactLabel };
}

/** A crop with `n` period columns labelled P1..Pn. */
function group(crop: string, n: number): PrintCropGroup {
  return { crop, columns: Array.from({ length: n }, (_, i) => col(crop, `P${i + 1}`)) };
}

/** A location bidding `value` in every column of `groups`. */
function loc(name: string, groups: PrintCropGroup[], value = '-30', isScoular = false): PrintLocation {
  const values: Record<string, string> = {};
  for (const g of groups) for (const c of g.columns) values[c.key] = value;
  return { name, isScoular, values };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

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

// ── balancedChunks ──────────────────────────────────────────────────────────────────────────────

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

  it('splits crops into balanced bands when their periods exceed the page: 6 × 4 → 3 + 3', () => {
    const groups = Array.from({ length: 6 }, (_, i) => group(`Crop${i}`, 4));
    const tables = buildLocationsDown({ groups, locations: [loc('Short', groups)], cropColors });
    expect(tables.map(t => t.headerRows[0].length - 1)).toEqual([3, 3]);
  });

  it('draws a partial last band at the SAME widths as the full ones, narrower rather than stretched', () => {
    const groups = Array.from({ length: 5 }, (_, i) => group(`Crop${i}`, 4));
    const tables = buildLocationsDown({ groups, locations: [loc('Short', groups)], cropColors });
    expect(tables.map(t => t.headerRows[0].length - 1)).toEqual([3, 2]);
    const [full, partial] = tables;
    expect(partial.colWidthsIn).toEqual(full.colWidthsIn.slice(0, partial.colWidthsIn.length));
    expect(near(full.widthPct, 100)).toBe(true);
    expect(partial.widthPct).toBeLessThan(full.widthPct);
  });

  it('never lets a bid column drop below the one-line header width when the page is full', () => {
    const groups = Array.from({ length: 4 }, (_, i) => group(`Crop${i}`, 4)); // 16 columns, exactly the ceiling
    const [t] = buildLocationsDown({ groups, locations: [loc('Short', groups)], cropColors });
    for (const w of t.colWidthsIn.slice(1)) expect(w).toBeGreaterThanOrEqual(PRINT_GEOMETRY.MIN_VALUE_COL_IN - 1e-9);
    expect(t.colWidthsIn[0]).toBeGreaterThanOrEqual(PRINT_GEOMETRY.MIN_NAME_COL_IN - 1e-9);
  });

  it('gives long names a wider Location column (splitting crops to pay for it) and clamps at the maximum', () => {
    const groups = Array.from({ length: 4 }, (_, i) => group(`Crop${i}`, 4));
    const shortTables = buildLocationsDown({ groups, locations: [loc('Short', groups)], cropColors });
    const longTables = buildLocationsDown({ groups, locations: [loc('A'.repeat(40), groups)], cropColors });
    const hugeTables = buildLocationsDown({ groups, locations: [loc('A'.repeat(200), groups)], cropColors });

    expect(shortTables).toHaveLength(1);
    expect(longTables.length).toBeGreaterThan(1);
    expect(longTables[0].colWidthsIn[0]).toBeGreaterThan(shortTables[0].colWidthsIn[0]);
    expect(near(hugeTables[0].colWidthsIn[0], PRINT_GEOMETRY.MAX_NAME_COL_IN)).toBe(true);
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
    const cells = tables.flatMap(t => [...t.headerRows.flat(), ...t.bodyRows.flat()]);
    expect(cells.some(c => c.bg === PRINT_COLORS.scoularBg)).toBe(false);
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
    expect(t.headerRows[0].map(c => c.text)).toEqual(['', 'Alpha', 'Bravo', 'Charlie']);
    expect(t.colWidthsIn).toHaveLength(4);
    expect(near(t.colWidthsIn[0], PRINT_GEOMETRY.LABEL_COL_IN)).toBe(true);

    // Corn band, P1, P2, Wheat band, P1
    expect(t.bodyRows.map(r => r[0].text)).toEqual(['Corn', 'P1', 'P2', 'Wheat', 'P1']);
    expect(t.bodyRows[0]).toHaveLength(1);
    expect(t.bodyRows[0][0]).toMatchObject({ colspan: 4, bg: COLORS.tint, borderBottom: `3px solid ${COLORS.solid}`, bold: true });
    expect(t.bodyRows[1]).toHaveLength(4);
    expect(t.bodyRows[1][0]).toMatchObject({ text: 'P1', borderLeft: `3px solid ${COLORS.solid}`, bold: true });
    expect(t.bodyRows[1][1]).toMatchObject({ text: '-30', mono: true, align: 'center' });
  });

  it('splits 30 short-named locations into balanced blocks of 8, 8, 8, 6 sharing the same widths', () => {
    const groups = [group('Corn', 2)];
    const tables = buildLocationsAcross({ groups, locations: manyLocs(30, groups), cropColors });
    expect(tables.map(t => t.headerRows[0].length - 1)).toEqual([8, 8, 8, 6]);
    const [full, , , partial] = tables;
    expect(partial.colWidthsIn).toEqual(full.colWidthsIn.slice(0, partial.colWidthsIn.length));
    expect(near(full.widthPct, 100)).toBe(true);
    expect(partial.widthPct).toBeLessThan(full.widthPct);
    // Every block repeats the crop band and period rows.
    for (const t of tables) expect(t.bodyRows.map(r => r[0].text)).toEqual(['Corn', 'P1', 'P2']);
  });

  it('drops to the 4-per-block floor for very long names and keeps a short list in one block', () => {
    const groups = [group('Corn', 1)];
    const longNames = buildLocationsAcross({ groups, locations: manyLocs(16, groups, 60), cropColors });
    expect(longNames.map(t => t.headerRows[0].length - 1)).toEqual([4, 4, 4, 4]);

    const five = buildLocationsAcross({ groups, locations: manyLocs(5, groups), cropColors });
    expect(five).toHaveLength(1);
    expect(five[0].headerRows[0]).toHaveLength(6);
  });

  it('never exceeds 8 locations per block', () => {
    const groups = [group('Corn', 1)];
    const tables = buildLocationsAcross({ groups, locations: manyLocs(40, groups, 3), cropColors });
    for (const t of tables) expect(t.headerRows[0].length - 1).toBeLessThanOrEqual(PRINT_GEOMETRY.MAX_LOCATIONS_PER_BLOCK);
    expect(sum(tables.map(t => t.headerRows[0].length - 1))).toBe(40);
  });

  it('highlights a Scoular COLUMN in the header and every period row, but not the band rows', () => {
    const groups = [group('Corn', 2)];
    const locs = [loc('CHS', groups), loc('Scoular Pratt', groups, '-20', true), loc('ADM', groups)];
    const [t] = buildLocationsAcross({ groups, locations: locs, cropColors });
    const scoularIdx = 2; // label column + CHS + Scoular

    expect(t.headerRows[0][scoularIdx]).toMatchObject({ bg: PRINT_COLORS.scoularBg, bold: true, wrap: true });
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
    const groups = Array.from({ length: 5 }, (_, i) => group(`Crop${i}`, 4));
    const [, partial] = buildLocationsDown({ groups, locations: [loc('S', groups)], cropColors });
    const pcts = tableColWidthPcts(partial);
    expect(near(sum(pcts), 100)).toBe(true);
    expect(pcts).toHaveLength(partial.colWidthsIn.length);
  });
});

describe('cellStyleMap', () => {
  const base: PrintCell = { text: 'x', align: 'center' };

  it('always forces print colour adjustment and uses header vs body grid lines', () => {
    const header = cellStyleMap(base, true);
    const body = cellStyleMap(base, false);
    expect(header['print-color-adjust']).toBe('exact');
    expect(header['-webkit-print-color-adjust']).toBe('exact');
    expect(header['border']).toContain(PRINT_COLORS.headerLine);
    expect(body['border']).toContain(PRINT_COLORS.gridLine);
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
    expect(html).toContain(`@page { margin: ${PRINT_GEOMETRY.PAGE_MARGIN_IN}in; size: landscape; }`);
    expect(html).toContain('print-color-adjust:exact');
    expect(html).toContain('Confidential');
    expect(html).not.toContain('&mdash;</td>');
    expect(html).not.toContain('&nbsp;');
  });

  it('omits empty address/phone lines and sizes a partial band below 100%', () => {
    const wide = Array.from({ length: 5 }, (_, i) => group(`Crop${i}`, 4));
    const model = buildPrintLayout({ style: 'locationsDown', groups: wide, locations: [loc('S', wide)], cropColors });
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
