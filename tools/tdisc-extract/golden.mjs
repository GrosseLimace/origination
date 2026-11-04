#!/usr/bin/env node
// Fills in a T-DISC pack's golden-cases.json with the results Excel calculates from the USDA workbook.
//
//   node tools/tdisc-extract/golden.mjs <workbook.xlsm> <packDir>
//
// The passes in <packDir>/golden-cases.json are kept; each case's "expected" block is replaced
// with Excel's own values (Windows + Excel required; macros stay off, see excel-run.ps1).
// The calculator's tests must reproduce these values before a version goes live.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableJson } from '../fdcic-extract/stable-json.mjs';

const [workbookPath, packDir] = process.argv.slice(2);
if (!workbookPath || !packDir) {
  console.error('Usage: node golden.mjs <workbook.xlsm> <packDir>');
  process.exit(2);
}

const casesPath = join(packDir, 'golden-cases.json');
const golden = JSON.parse(readFileSync(casesPath, 'utf8'));
const manifest = JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8'));
const workbookSha = createHash('sha256').update(readFileSync(workbookPath)).digest('hex');
if (workbookSha !== manifest.source.sha256) {
  console.error(`This workbook (${workbookSha}) is not the one the pack was extracted from (${manifest.source.sha256}).`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'tdisc-golden-'));
try {
  const inputsPath = join(work, 'inputs.json');
  // Excel's VLOOKUP needs the workbook's own spelling (two names carry a trailing space).
  const spelled = name => manifest.workbookNames?.[name] ?? name;
  writeFileSync(inputsPath, JSON.stringify(golden.cases.map(c => ({
    name: c.name, passes: c.passes.map(p => ({ window: p.window, workbookName: spelled(p.implement) })),
  }))));
  const script = join(dirname(fileURLToPath(import.meta.url)), 'excel-run.ps1');
  const out = execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Workbook', resolve(workbookPath), '-CasesJson', inputsPath],
    { encoding: 'utf8', maxBuffer: 1 << 24 });
  const results = [].concat(JSON.parse(out));
  for (const c of golden.cases) {
    const r = results.find(x => x.name === c.name);
    if (!r) throw new Error(`Excel returned no result for case "${c.name}"`);
    c.expected = r.expected;
  }
  golden.confirmedInExcel = {
    on: new Date().toISOString().slice(0, 10),
    workbookSha256: workbookSha,
    how: "Passes typed into User Input C9:D28 (management unit 1) by tools/tdisc-extract/excel-run.ps1; macros disabled; workbook not saved.",
  };
  writeFileSync(casesPath, stableJson(golden) + '\n');
  for (const c of golden.cases) console.log(`${c.name}: ${c.expected.rating} ${c.expected.designation}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
