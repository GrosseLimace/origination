#!/usr/bin/env node
// Extracts a versioned FD-CIC data pack from a USDA FD-CIC workbook (.xlsm).
//
//   node tools/fdcic-extract/extract.mjs <workbook.xlsm> <outDir> [--previous <packDir>]
//
// The workbook is read as data only (no Excel, no macros). Every table the score depends on
// is located by its labels or defined names and checked against the layout v1.2 uses; if
// USDA moves something, extraction stops with a message instead of writing a wrong pack.
// With --previous, CHANGES.md lists every value and formula that differs from that pack.
// See docs/45z/README.md for the update runbook.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openWorkbook, splitAddr, addr, colStr } from './xlsx.mjs';
import { stableJson } from './stable-json.mjs';

const EXTRACTOR_VERSION = '1';

const args = process.argv.slice(2);
const prevIdx = args.indexOf('--previous');
const previous = prevIdx >= 0 ? args.splice(prevIdx, 2)[1] : null;
const [workbookPath, outDir] = args;
if (!workbookPath || !outDir) {
  console.error('Usage: node extract.mjs <workbook.xlsm> <outDir> [--previous <packDir>]');
  process.exit(2);
}

const fail = msg => { throw new Error(`Layout check failed: ${msg}. The extractor needs updating for this workbook.`); };
const expect = (cond, msg) => { if (!cond) fail(msg); };
const sha256 = data => createHash('sha256').update(data).digest('hex');
const num = (v, where) => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`expected a number at ${where}, found ${JSON.stringify(v)}`); return v; };
const tableValue = v => (v === 'NA' || v === undefined || v === '' ? null : typeof v === 'number' ? v : fail(`unexpected table value ${JSON.stringify(v)}`));
const mlraKey = v => (v === undefined || v === '' ? null : String(v).trim());

const wb = openWorkbook(workbookPath);
const inputs = wb.sheet('Crop Inputs');
const helper = wb.sheet('USDA Helper Sheet');
const params = wb.sheet('Parameters');

// ---- Version -------------------------------------------------------------------------------
const versionLabel = String(inputs.get('C1') ?? '');
const version = (versionLabel.match(/Version\s+([\d.]+)/i) || [])[1];
expect(version, `'Crop Inputs'!C1 should read "Version x.y" (found "${versionLabel}")`);

// ---- Options (the exact labels the tables are keyed by) -------------------------------------
const listBelow = (sheet, col, label) => {
  for (let r = 1; r <= sheet.maxRow(); r++) {
    if (String(sheet.get(col + r) ?? '').trim() === label) {
      const out = [];
      for (let k = r + 1; sheet.get(col + k) !== undefined && sheet.get(col + k) !== ''; k++) out.push(String(sheet.get(col + k)));
      return out;
    }
  }
  return fail(`label "${label}" not found in column ${col} of ${sheet.name}`);
};
const listValidation = (sheet, cell) => {
  const v = sheet.validations.find(x => x.type === 'list' && x.sqref.split(' ').some(r => r.split(':')[0] === cell));
  expect(v?.formula1, `${sheet.name}!${cell} should have a dropdown list`);
  return v.formula1.split(',');
};

const crops = listValidation(inputs, 'C4');
const coverCrops = listBelow(helper, 'I', 'Cover Crop Options');
const tillage = listBelow(helper, 'I', 'Tillage Options');
// The manure list runs straight into the next block ("Max Fields"), so it stops at "None".
const manureAll = listBelow(helper, 'I', 'Manure Types');
expect(manureAll.includes('None'), 'the manure type list should end with "None"');
const manureLabels = manureAll.slice(0, manureAll.indexOf('None') + 1);
const fixedPractice = { timing: String(inputs.get('C58')), inhibitor: String(inputs.get('C59')) };
expect(fixedPractice.timing && fixedPractice.inhibitor, 'hidden practice cells C58/C59 should hold fixed values');

// Likely max N content per manure type (VBA warning only, kept so the app can warn the same way).
const maxN = new Map();
for (let c = 2; c <= params.maxCol(56); c++) {
  const label = params.get(addr(c, 56));
  if (label !== undefined) maxN.set(String(label).trim(), params.get(addr(c, 57)));
}
const manureTypes = manureLabels.filter(l => l !== 'None').map(label => ({
  label,
  unit: /liquid/i.test(label) ? '1000 gal/ac' : 'tons/ac',
  likelyMaxNPerUnit: maxN.get(label.trim()) ?? null,
}));

// ---- Constants ------------------------------------------------------------------------------
const yieldBound = label => {
  for (let r = 1; r <= 20; r++) if (helper.get('I' + r) === label) return num(helper.get('J' + r), `Helper J${r}`);
  return fail(`yield bound "${label}" not found on the USDA Helper Sheet`);
};
const cropHeaderRow = (() => {
  for (let r = 1; r <= params.maxRow(); r++) {
    const row = [2, 3, 4, 5].map(c => String(params.get(addr(c, r)) ?? '').toLowerCase());
    if (crops.every(cr => row.includes(cr.toLowerCase()))) return r;
  }
  return fail('the per-crop block (canola/corn/sorghum/soybean headers) was not found on Parameters');
})();
const paramRow = label => {
  for (let r = cropHeaderRow + 1; r <= cropHeaderRow + 10; r++) if (String(params.get('A' + r) ?? '').startsWith(label)) return r;
  return fail(`"${label}" row not found under the Parameters crop block`);
};
const nuiRow = paramRow('Default NUI'), thresholdRow = paramRow('USDA Assumed NUI Threshold');
const nationalNames = { Corn: 'Corn', Soybean: 'Soy', Sorghum: 'Sorg', Canola: 'Canola' };
const components = [
  ['nFertilizer', 'NFert'], ['directN2o', 'DN2O'], ['indirectN2o', 'IndN2O'], ['onFarmFuel', 'OnFarm'],
  ['onFarmOther', 'OnFarmOthers'], ['otherChemicals', 'Other'], ['urea', 'Urea'], ['lime', 'Lime'],
];
const cropConstants = {};
for (const crop of crops) {
  const prefix = nationalNames[crop] ?? fail(`no national-average name prefix known for crop ${crop}`);
  const col = [2, 3, 4, 5].find(c => String(params.get(addr(c, cropHeaderRow))).toLowerCase() === crop.toLowerCase());
  const national = Object.fromEntries(components.map(([key, n]) => [key, num(wb.name(`USDA${prefix}${n}`), `USDA${prefix}${n}`)]));
  national.total = Object.values(national).reduce((a, b) => a + b, 0);
  cropConstants[crop] = {
    defaultNui: num(params.get(addr(col, nuiRow)), `Parameters!${addr(col, nuiRow)}`),
    nuiThreshold: num(params.get(addr(col, thresholdRow)), `Parameters!${addr(col, thresholdRow)}`),
    residueNGPerBu: num(wb.name(`${crop}farming_Ninbiomass_residue`), `${crop}farming_Ninbiomass_residue`),
    nFixationGN2oPerBu: crop === 'Soybean' ? num(wb.name('Soybeanfarming_Nfixation_N2O_factor'), 'Soybeanfarming_Nfixation_N2O_factor') : 0,
    national,
  };
}
const constants = {
  gPerLb: num(wb.name('g_to_lb'), 'g_to_lb'),
  n2oNToN2o: num(wb.name('N2O_N_to_N2O'), 'N2O_N_to_N2O'),
  gwpN2o: num(wb.name('N2O_GWP'), 'N2O_GWP'),
  yieldLowerBound: yieldBound('Lower bound on yield range'),
  yieldUpperBound: yieldBound('Upper bound on yield boundary'),
  fixedPractice,
  crops: cropConstants,
};

// ---- Counties (FIPSTable) -------------------------------------------------------------------
const fipsTable = wb.table('FIPSTable');
const fips = wb.sheet(fipsTable.sheet);
const [[c0, r0], [, r1]] = fipsTable.ref.split(':').map(splitAddr);
expect(['FIPS', 'Name', 'State', 'MLRA'].every((h, i) => String(fips.get(addr(c0 + i, r0))).trim() === h), 'FIPSTable columns should be FIPS, Name, State, MLRA');
const counties = [];
for (let r = r0 + 1; r <= r1; r++) {
  const state = String(fips.get(addr(c0 + 2, r)) ?? '');
  if (state === 'None' || state === '') continue;
  counties.push([num(fips.get(addr(c0, r)), `FIPS row ${r}`), state, String(fips.get(addr(c0 + 1, r))), mlraKey(fips.get(addr(c0 + 3, r)))]);
}

// ---- Implied emission factors (IEF_dir / IEF_Indir) -----------------------------------------
const readIef = sheetName => {
  const s = wb.sheet(sheetName);
  expect(/crop/i.test(String(s.get('A3'))) && /mlra/i.test(String(s.get('C3'))), `${sheetName} should have Crop in A3 and MLRA in C3`);
  const out = new Map();
  for (let r = 4; r <= s.maxRow(); r++) {
    const crop = s.get('A' + r);
    if (crop === undefined) continue;
    expect(crops.includes(crop), `${sheetName}!A${r} has unknown crop ${crop}`);
    out.set(`${crop}|${mlraKey(s.get('C' + r))}`, tableValue(s.get('D' + r)));
  }
  return out;
};
const iefDir = readIef('IEF_dir'), iefInd = readIef('IEF_Indir');
const ief = Object.fromEntries(crops.map(c => [c, {}]));
for (const key of new Set([...iefDir.keys(), ...iefInd.keys()])) {
  const [crop, mlra] = key.split('|');
  ief[crop][mlra] = [iefDir.get(key) ?? null, iefInd.get(key) ?? null];
}

// ---- Practice tables (CSA, NI_Impact) -------------------------------------------------------
// Header rows 2 (crop), 4 (scenario), 10 (cover crop), 11 (tillage), 12 (N timing), 13 (inhibitor);
// value blocks are found by their column-A label and keyed by MLRA in column B.
function readPracticeSheet(sheetName, blocks) {
  const s = wb.sheet(sheetName);
  expect(s.get('A2') === 'Feedstock' && s.get('A10') === 'Cover crop' && s.get('A11') === 'Tillage' && s.get('B15') === 'MLRA',
    `${sheetName} header rows (Feedstock row 2, Cover crop row 10, Tillage row 11, MLRA B15) moved`);
  const columns = [];
  for (let c = 3; c <= s.maxCol(2); c++) {
    const crop = crops.find(x => x.toLowerCase() === String(s.get(addr(c, 2)) ?? '').toLowerCase());
    if (!crop) continue;
    columns.push({ col: c, crop, practice: {
      cover: String(s.get(addr(c, 10))), tillage: String(s.get(addr(c, 11))),
      timing: String(s.get(addr(c, 12))), inhibitor: String(s.get(addr(c, 13))), scenario: String(s.get(addr(c, 4))) } });
  }
  expect(columns.length > 0, `${sheetName} has no crop columns`);
  for (const { practice: p } of columns) {
    expect(coverCrops.includes(p.cover) && tillage.includes(p.tillage), `${sheetName} column has unknown cover/tillage "${p.cover}"/"${p.tillage}"`);
  }
  const blockRows = {};
  for (let r = 16; r <= s.maxRow(); r++) {
    const label = String(s.get('A' + r) ?? '');
    const key = Object.keys(blocks).find(k => blocks[k].test(label));
    if (key) (blockRows[key] ??= []).push(r);
  }
  for (const key of Object.keys(blocks)) expect(blockRows[key]?.length, `${sheetName} block "${key}" (${blocks[key]}) not found`);
  const out = {};
  for (const crop of crops) {
    const cols = columns.filter(x => x.crop === crop);
    const mlras = {};
    for (const [key, rows] of Object.entries(blockRows)) {
      for (const r of rows) {
        const mlra = mlraKey(s.get('B' + r));
        const values = cols.map(x => tableValue(s.get(addr(x.col, r))));
        if (values.every(v => v === null)) continue;
        (mlras[mlra] ??= {})[key] = values;
      }
    }
    out[crop] = { practices: cols.map(x => x.practice), mlra: mlras };
  }
  return out;
}
const csa = readPracticeSheet('CSA', {
  socGPerBu: /^Change in SOC gCO2e\/bu/i,
  directN2oChange: /^% change dir N2O/i,
  indirectN2oChange: /^% change indir N2O/i,
  fuelChange: /^% Change Fuel Use/i,
});
const niImpact = readPracticeSheet('NI_Impact', {
  directN2oChange: /^% change dir N2O/i,
  indirectN2oChange: /^% change indir N2O/i,
});

// ---- Formulas (fingerprint: if these change, the calculator code needs review) -----------------
const formulas = {};
for (const sheetName of wb.sheetNames()) {
  const s = wb.sheet(sheetName);
  for (const [a, cell] of s.cells) {
    if (cell.f === undefined) continue;
    const [c] = splitAddr(a);
    // Crop Inputs repeats column C's formulas in D..L for MUs 2-10; column C and M (national) are enough.
    if (sheetName === 'Crop Inputs' && !['C', 'M'].includes(colStr(c))) continue;
    formulas[`${sheetName}!${a}`] = cell.f.replace(/\s+/g, ' ').trim();
  }
}
const sortedFormulas = Object.fromEntries(Object.entries(formulas).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));

// ---- Write the pack -------------------------------------------------------------------------

const files = {
  'constants.json': constants,
  'options.json': { crops, coverCrops, tillage, manureTypes },
  'counties.json': { columns: ['fips', 'state', 'county', 'mlra'], rows: counties },
  'ief.json': { note: 'Percent of applied N emitted as N2O-N: [direct, indirect] by crop and MLRA.', crops: ief },
  'csa.json': { note: 'Conservation practice adjustments by crop, MLRA and practice column. socGPerBu is sequestration (positive = credit); the others are fractional changes.', crops: csa },
  'ni-impact.json': { note: 'Fractional change in N2O when a nitrification inhibitor is applied to 100% of synthetic N.', crops: niImpact },
  'formulas.json': sortedFormulas,
};

mkdirSync(outDir, { recursive: true });
const fileHashes = {};
for (const [name, value] of Object.entries(files)) {
  const text = stableJson(value) + '\n';
  writeFileSync(join(outDir, name), text);
  fileHashes[name] = sha256(text);
}
const props = wb.coreProps();
const manifest = {
  method: 'USDA FD-CIC',
  version,
  label: `USDA FD-CIC v${version}`,
  source: {
    file: basename(workbookPath),
    sha256: sha256(wb.buffer),
    versionLabel: versionLabel.trim(),
    workbookModified: props.modified ?? null,
  },
  extractor: { version: EXTRACTOR_VERSION, extractedAt: new Date().toISOString().slice(0, 10) },
  formulaFingerprint: sha256(JSON.stringify(sortedFormulas)),
  counts: {
    counties: counties.length,
    mlras: new Set(counties.map(c => c[3]).filter(Boolean)).size,
    iefRows: Object.fromEntries(crops.map(c => [c, Object.keys(ief[c]).length])),
    csaMlras: Object.fromEntries(crops.map(c => [c, Object.keys(csa[c].mlra).length])),
  },
  files: fileHashes,
};
writeFileSync(join(outDir, 'manifest.json'), stableJson(manifest) + '\n');
console.log(`Wrote ${manifest.label} pack to ${outDir}`);
console.log(`  source sha256 ${manifest.source.sha256}`);
console.log(`  formula fingerprint ${manifest.formulaFingerprint}`);
console.log(`  ${counties.length} counties, ${manifest.counts.mlras} MLRAs, crops ${crops.join(', ')}`);

// ---- Change report against the previous pack --------------------------------------------------
if (previous) {
  const readPack = (dir, name) => existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : undefined;
  const prevManifest = readPack(previous, 'manifest.json');
  const lines = [`# Changes: ${prevManifest?.label ?? previous} → ${manifest.label}`, ''];
  const prevFormulas = readPack(previous, 'formulas.json') ?? {};
  const formulaChanges = [...new Set([...Object.keys(prevFormulas), ...Object.keys(sortedFormulas)])]
    .filter(k => prevFormulas[k] !== sortedFormulas[k]);
  if (formulaChanges.length === 0) {
    lines.push('**Formulas unchanged.** This is a tables-only update: the calculator code does not need to change.', '');
  } else {
    lines.push(`**${formulaChanges.length} formula(s) changed. The calculator code must be reviewed before this version goes live.**`, '');
    for (const k of formulaChanges) lines.push(`- \`${k}\``, `  - before: \`${prevFormulas[k] ?? '(none)'}\``, `  - after: \`${sortedFormulas[k] ?? '(none)'}\``);
    lines.push('');
  }
  const diff = (a, b, path, out) => {
    if (a === b) return;
    const isObj = v => v !== null && typeof v === 'object';
    if (isObj(a) && isObj(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? `${path}.${k}` : k, out);
      return;
    }
    out.push(`- \`${path}\`: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  };
  // Counties are compared by FIPS, so an added county doesn't show as every later row changing.
  const forDiff = (name, value) => name !== 'counties.json' || !value ? value
    : Object.fromEntries(value.rows.map(([f, st, county, mlra]) => [`${f} ${county}, ${st}`, { mlra }]));
  for (const name of Object.keys(files).filter(n => n !== 'formulas.json')) {
    const out = [];
    diff(forDiff(name, readPack(previous, name)), forDiff(name, files[name]), '', out);
    lines.push(`## ${name}: ${out.length === 0 ? 'no changes' : `${out.length} change(s)`}`, '');
    if (out.length) lines.push(...out.slice(0, 50), ...(out.length > 50 ? [`- … and ${out.length - 50} more`] : []), '');
  }
  writeFileSync(join(outDir, 'CHANGES.md'), lines.join('\n') + '\n');
  console.log(`  change report: ${join(outDir, 'CHANGES.md')} (${formulaChanges.length} formula change(s))`);
}
