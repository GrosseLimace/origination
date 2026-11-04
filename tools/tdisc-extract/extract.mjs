#!/usr/bin/env node
// Extracts a versioned T-DISC data pack from USDA's T-DISC workbook (.xlsm).
//
//   node tools/tdisc-extract/extract.mjs <workbook.xlsm> <outDir>
//
// The workbook is read as data only (no Excel, no macros), with the FD-CIC extractor's reader.
// Everything the rating depends on is located by its labels or defined names and checked against
// the layout v1.1.1 uses; if USDA moves something, extraction stops instead of writing a wrong pack.
// See docs/45z/README.md ("T-DISC") for the update runbook.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openWorkbook, splitAddr, addr } from '../fdcic-extract/xlsx.mjs';
import { stableJson } from '../fdcic-extract/stable-json.mjs';

const EXTRACTOR_VERSION = '1';

const [workbookPath, outDir] = process.argv.slice(2);
if (!workbookPath || !outDir) {
  console.error('Usage: node extract.mjs <workbook.xlsm> <outDir>');
  process.exit(2);
}

const fail = msg => { throw new Error(`Layout check failed: ${msg}. The extractor needs updating for this workbook.`); };
const expect = (cond, msg) => { if (!cond) fail(msg); };
const sha256 = data => createHash('sha256').update(data).digest('hex');
const num = (v, where) => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`expected a number at ${where}, found ${JSON.stringify(v)}`); return v; };
const text = v => String(v ?? '').trim();

const wb = openWorkbook(workbookPath);
const input = wb.sheet('User Input');
const list = wb.sheet('Implement List');
const mapping = wb.sheet('Implement Mapping');

// ---- Version -------------------------------------------------------------------------------
const versionLabel = text(input.get('K1'));
const version = (versionLabel.match(/^Ver\s*([\d.]+)$/i) || [])[1];
expect(version, `'User Input'!K1 should read "Verx.y.z" (found "${versionLabel}")`);

// ---- The rating's formulas (management unit 1, rows 8-29) -----------------------------------
// The calculator code implements exactly these; any change shows up in the fingerprint and the
// version gate refuses the pack until the code is reviewed.
const formula = a => (input.formula(a) ?? '').replace(/\s+/g, ' ').trim();
expect(formula('M8') === '_xlfn.SORTBY(B9:F28, F9:F28,1,E9:E28,1)', `User Input!M8 should sort the passes by depth then mixing efficiency (found "${formula('M8')}")`);
expect(formula('E9') === 'IF(D9="","", VLOOKUP(D9,Implements,2,FALSE))' && formula('F9') === 'IF(D9="","", VLOOKUP(D9,Implements,3,FALSE))',
  'User Input!E9:F9 should look the implement up in Implements');
const windowColumns = { Field_Preparation: 'U', Before_Planting: 'Y', Planting: 'AC', After_Planting: 'AG', Harvest: 'AK' };
const divisors = new Set();
for (const [window, ti] of Object.entries(windowColumns)) {
  const [c] = splitAddr(ti + '1');
  const [opCol, meCol, depthCol] = [c - 3, c - 2, c - 1].map(x => addr(x, 1).replace(/\d+$/, ''));
  expect(formula(`${opCol}8`) === `IF($N8="${window}", $O8,"")`, `User Input!${opCol}8 should pick ${window} passes`);
  expect(formula(`${ti}8`) === `IFERROR(${meCol}8*${depthCol}8, "")`, `User Input!${ti}8 should be ME × depth`);
  expect(formula(`${ti}9`) === `IFERROR(${meCol}9*(${depthCol}9-SUM(${ti}8:${ti}8)),"")`, `User Input!${ti}9 should be ME × (depth − earlier TIs)`);
  const total = formula(`${ti}28`).match(new RegExp(`^IF\\(${opCol}28>0,SUM\\(${ti}8:${ti}27\\)/(\\d+(?:\\.\\d+)?),""\\)$`));
  expect(total, `User Input!${ti}28 should be the window's TI total ÷ a depth`);
  divisors.add(+total[1]);
}
expect(divisors.size === 1, 'every window should divide by the same depth');
const [indexDepthCm] = divisors;
expect(formula('O28') === 'MAX(U28,Y28,AC28,AG28,AK28)', 'User Input!O28 should be the highest window index');
expect(formula('J7') === 'O28' && formula('J8') === 'O29', 'User Input!J7:J8 should show the rating and its designation');
expect(formula('O29') === `IF(P29>0, INDEX('Implement List'!$K$15:$L$17,MATCH(O28,'Implement List'!$K$15:$K$17,-1),2),"")`,
  'User Input!O29 should designate the rating from Implement List K15:L17');

// ---- Designation limits ('Implement List'!K15:L17, matched with MATCH(…, -1)) --------------
expect(text(list.get('K14')) === 'TI MAX' && text(list.get('L14')) === 'Tillage Designation', "'Implement List'!K14:L14 should head the designation limits");
const designations = [15, 16, 17].map(r => ({ max: num(list.get('K' + r), `Implement List!K${r}`), designation: text(list.get('L' + r)) }));
expect(designations.map(d => d.designation).join() === 'CT,RT,NT', 'the designations should be CT, RT, NT from the top');
expect(designations[0].max >= designations[1].max && designations[1].max >= designations[2].max, 'the limits should run high to low');

// ---- Implements ('Implements' = 'Implement List'!B1:D120) ----------------------------------
const impRange = wb.rangeRef('Implements');
expect(impRange.sheet === 'Implement List', 'Implements should be on Implement List');
const [ic0, ir0] = impRange.from;
expect(['Name', 'Mixing Efficiency', 'Tillage Depth (cm)'].every((h, i) => text(list.get(addr(ic0 + i, ir0))) === h),
  'Implements should have the columns Name, Mixing Efficiency, Tillage Depth (cm)');
const implementRows = [];
const workbookNames = {};
for (let r = ir0 + 1; r <= impRange.to[1]; r++) {
  const raw = list.get(addr(ic0, r));
  if (raw === undefined || raw === '') continue;
  const name = text(raw);
  if (name !== raw) workbookNames[name] = raw;
  expect(!implementRows.some(i => i.name === name), `implement "${name}" is listed twice`);
  implementRows.push({ name, mixingEfficiency: num(list.get(addr(ic0 + 1, r)), `Implement List!${addr(ic0 + 1, r)}`), depthCm: num(list.get(addr(ic0 + 2, r)), `Implement List!${addr(ic0 + 2, r)}`) });
}
const known = new Set(implementRows.map(i => i.name));
expect(implementRows.every(i => i.mixingEfficiency >= 0 && i.mixingEfficiency <= 1 && i.depthCm >= 0 && i.depthCm <= indexDepthCm),
  `every mixing efficiency should be 0-1 and every depth 0-${indexDepthCm} cm, so a rating stays within 0-1`);

// ---- Windows (defined names Field_Preparation … Harvest, used by the INDIRECT(C9) dropdowns) ----
const windowOrder = [2, 3, 4, 5, 6].map(r => text(list.get('H' + r)));
expect(text(list.get('H1')) === 'Tillage Interval' && windowOrder.join() === Object.keys(windowColumns).join(),
  `'Implement List'!H2:H6 should list the five tillage windows (found ${windowOrder.join(', ')})`);
expect(input.validations.some(v => v.formula1 === 'INDIRECT(C9)' && v.sqref.split(' ').includes('D9:D29')),
  "User Input!D9 should offer the implements of the window chosen in C9");
const windowLabels = { Field_Preparation: 'Field preparation', Before_Planting: 'Before planting', Planting: 'Planting', After_Planting: 'After planting', Harvest: 'Harvest' };
const windows = windowOrder.map(key => {
  const ref = wb.rangeRef(key);
  const s = wb.sheet(ref.sheet);
  const names = [];
  for (let r = ref.from[1]; r <= ref.to[1]; r++) {
    const v = s.get(addr(ref.from[0], r));
    if (v === undefined || v === '') continue;
    const name = text(v);
    expect(known.has(name), `${key} lists "${name}", which is not in Implements`);
    if (!names.includes(name)) names.push(name);
  }
  expect(names.length > 0, `${key} has no implements`);
  return { key, label: windowLabels[key], implements: names };
});

// ---- Operation lookup ('Implement Mapping') -------------------------------------------------
// USDA's own lookup has a few names that don't match Implements exactly. Two are plain typos and
// are fixed here (listed in the manifest); an operation that can't be matched is left out.
const FIXES = { 'RESIDUE MGMT, POWER MULCHER': 'RESIDUE MGMT: POWER MULCHER', 'RESIDUE MGMT, TRASH WHEEL': 'RESIDUE MGMT: TRASH WHEEL' };
expect(text(mapping.get('B1')) === 'If your operation is this:' && text(mapping.get('C1')) === 'Use this TDISC implement',
  "'Implement Mapping' should have the operation in B and the implements in C:F");
const operations = [];
const fixed = [];
const skipped = [];
for (let r = 2; r <= mapping.maxRow(); r++) {
  const name = text(mapping.get('B' + r));
  if (!name) continue;
  const parts = ['C', 'D', 'E', 'F'].map(c => text(mapping.get(c + r))).filter(Boolean);
  const resolved = parts.map(p => known.has(p) ? p : FIXES[p]);
  parts.forEach((p, i) => { if (!known.has(p) && FIXES[p]) fixed.push(`${name}: "${p}" → "${FIXES[p]}"`); });
  const missing = parts.filter((p, i) => !resolved[i] || !known.has(resolved[i]));
  if (parts.length === 0 || missing.length) { skipped.push(`${name}: ${missing.map(m => `"${m}"`).join(', ') || 'no implement'}`); continue; }
  expect(!operations.some(o => o.name === name), `operation "${name}" is listed twice`);
  operations.push({ name, implements: resolved });
}

// ---- Formulas (fingerprint: if these change, the calculator code needs review) ----------------
const formulas = {};
for (const [a, cell] of input.cells) {
  const [, r] = splitAddr(a);
  if (cell.f !== undefined && r >= 7 && r <= 29) formulas[`User Input!${a}`] = cell.f.replace(/\s+/g, ' ').trim();
}
const sortedFormulas = Object.fromEntries(Object.entries(formulas).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));

// ---- Write the pack -------------------------------------------------------------------------
const files = {
  'implements.json': { columns: ['name', 'mixingEfficiency', 'depthCm'], rows: implementRows.map(i => [i.name, i.mixingEfficiency, i.depthCm]) },
  'windows.json': windows,
  'operations.json': { note: "USDA's lookup from everyday operation names to the T-DISC implements to enter, one pass each.", rows: operations.map(o => [o.name, o.implements]) },
  'rules.json': { indexDepthCm, maxPasses: 20, designations },
  'formulas.json': sortedFormulas,
};

mkdirSync(outDir, { recursive: true });
const fileHashes = {};
for (const [name, value] of Object.entries(files)) {
  const out = stableJson(value) + '\n';
  writeFileSync(join(outDir, name), out);
  fileHashes[name] = sha256(out);
}
const props = wb.coreProps();
const manifest = {
  method: 'USDA T-DISC',
  version,
  label: `USDA T-DISC v${version}`,
  source: { file: basename(workbookPath), sha256: sha256(wb.buffer), versionLabel, workbookModified: props.modified ?? null },
  extractor: { version: EXTRACTOR_VERSION, extractedAt: new Date().toISOString().slice(0, 10) },
  formulaFingerprint: sha256(JSON.stringify(sortedFormulas)),
  counts: { implements: implementRows.length, operations: operations.length, windows: Object.fromEntries(windows.map(w => [w.key, w.implements.length])) },
  // Names as the workbook spells them where they differ from the trimmed name (Excel's VLOOKUP needs them).
  workbookNames,
  lookupFixes: fixed,
  lookupSkipped: skipped,
  files: fileHashes,
};
writeFileSync(join(outDir, 'manifest.json'), stableJson(manifest) + '\n');
console.log(`Wrote ${manifest.label} pack to ${outDir}`);
console.log(`  source sha256 ${manifest.source.sha256}`);
console.log(`  formula fingerprint ${manifest.formulaFingerprint}`);
console.log(`  ${implementRows.length} implements, ${operations.length} operations (${fixed.length} name fix(es), ${skipped.length} skipped)`);
for (const s of skipped) console.log(`  skipped: ${s}`);
