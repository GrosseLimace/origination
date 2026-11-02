// Minimal read-only .xlsx/.xlsm reader: zip central directory + inflate, then the
// SpreadsheetML parts we need. No dependencies, nothing written to disk, no macros run.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function readZip(path) {
  const buf = readFileSync(path);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory.');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (compSize === 0xffffffff || local === 0xffffffff) throw new Error('Zip64 workbooks are not supported.');
    entries.set(name, { method, compSize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    buffer: buf,
    has: name => entries.has(name),
    names: () => [...entries.keys()],
    text(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`Part not found: ${name}`);
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const raw = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return raw.toString('utf8');
      if (e.method === 8) return inflateRawSync(raw).toString('utf8');
      throw new Error(`Unsupported zip compression method ${e.method} for ${name}`);
    },
  };
}

const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
const attr = (s, name) => { const m = s.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? decode(m[1]) : undefined; };

export const colNum = c => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
export const colStr = n => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
export const splitAddr = a => { const m = a.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/); if (!m) throw new Error(`Bad cell address ${a}`); return [colNum(m[1]), +m[2]]; };
export const addr = (c, r) => colStr(c) + r;

// Re-bases a shared formula's relative references from its anchor cell to another cell.
function shiftFormula(f, dc, dr) {
  return f.replace(/("[^"]*")|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (all, str, d1, c, d2, r, off, whole) => {
    if (str) return str;
    const prev = whole[off - 1];
    if (prev && /[A-Za-z0-9_.]/.test(prev)) return all;
    return d1 + (d1 ? c : colStr(colNum(c) + dc)) + d2 + (d2 ? r : String(+r + dr));
  });
}

export function openWorkbook(path) {
  const zip = readZip(path);
  const strings = [];
  if (zip.has('xl/sharedStrings.xml')) {
    for (const m of zip.text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      strings.push(decode([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
    }
  }

  const wbXml = zip.text('xl/workbook.xml');
  const rels = new Map([...zip.text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)]
    .map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const sheetParts = new Map();
  for (const m of wbXml.matchAll(/<sheet\s[^>]*>/g)) {
    const target = rels.get(attr(m[0], 'r:id'));
    sheetParts.set(attr(m[0], 'name'), 'xl/' + target.replace(/^\/?xl\//, ''));
  }
  const names = new Map();
  for (const m of wbXml.matchAll(/<definedName\s([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    if (attr(' ' + m[1], 'localSheetId') !== undefined) continue;
    names.set(attr(' ' + m[1], 'name').toLowerCase(), decode(m[2]));
  }

  const sheetCache = new Map();
  function sheet(name) {
    if (sheetCache.has(name)) return sheetCache.get(name);
    const part = sheetParts.get(name);
    if (!part) throw new Error(`Sheet not found: ${name}`);
    const xml = zip.text(part);
    const cells = new Map();
    const shared = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, a, attrs, body = ''] = m;
      const t = attr(attrs, 't');
      let f;
      const fm = body.match(/<f([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
      if (fm) {
        const text = fm[2] ? decode(fm[2]) : '';
        const si = attr(fm[1], 'si');
        if (attr(fm[1], 't') === 'shared') {
          if (text) { shared[si] = { f: text, at: splitAddr(a) }; f = text; }
          else if (shared[si]) { const [c0, r0] = shared[si].at; const [c1, r1] = splitAddr(a); f = shiftFormula(shared[si].f, c1 - c0, r1 - r0); }
        } else f = text;
      }
      const vm = body.match(/<v>([\s\S]*?)<\/v>/);
      let v = vm ? decode(vm[1]) : undefined;
      if (t === 's' && v !== undefined) v = strings[+v];
      else if (t === 'inlineStr') v = decode([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
      else if (t === 'e') v = { error: v };
      else if (t === 'b') v = v === '1';
      else if (t !== 'str' && v !== undefined) v = Number(v);
      if (v === undefined && f === undefined) continue;
      cells.set(a, { v, f });
    }
    const validations = [...xml.matchAll(/<dataValidation\s([^>]*)>([\s\S]*?)<\/dataValidation>/g)].map(m => ({
      sqref: attr(' ' + m[1], 'sqref'),
      type: attr(' ' + m[1], 'type'),
      formula1: (m[2].match(/<formula1>([\s\S]*?)<\/formula1>/) || [])[1]?.replace(/^"|"$/g, ''),
    }));
    const s = {
      name, part, cells, validations,
      get: a => cells.get(a)?.v,
      formula: a => cells.get(a)?.f,
      maxRow: () => Math.max(0, ...[...cells.keys()].map(k => splitAddr(k)[1])),
      maxCol: row => Math.max(0, ...[...cells.keys()].map(splitAddr).filter(([, r]) => r === row).map(([c]) => c)),
    };
    sheetCache.set(name, s);
    return s;
  }

  function resolveName(name) {
    const ref = names.get(name.toLowerCase());
    if (!ref) throw new Error(`Defined name not found: ${name}`);
    const m = ref.match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/);
    if (!m) throw new Error(`Defined name ${name} is not a single cell: ${ref}`);
    return { sheet: m[1], cell: m[2] + m[3] };
  }

  function table(tableName) {
    for (const part of zip.names().filter(n => /^xl\/tables\/table\d+\.xml$/.test(n))) {
      const xml = zip.text(part);
      const head = xml.match(/<table\s[^>]*>/)[0];
      if (attr(head, 'name') !== tableName) continue;
      const file = part.split('/').pop();
      for (const [sheetName, sheetPart] of sheetParts) {
        const relPart = sheetPart.replace(/worksheets\//, 'worksheets/_rels/') + '.rels';
        if (zip.has(relPart) && zip.text(relPart).includes(`tables/${file}`)) return { sheet: sheetName, ref: attr(head, 'ref') };
      }
    }
    throw new Error(`Excel table not found: ${tableName}`);
  }

  return {
    buffer: zip.buffer,
    sheetNames: () => [...sheetParts.keys()],
    sheet,
    name: n => { const r = resolveName(n); return sheet(r.sheet).get(r.cell); },
    nameRef: resolveName,
    table,
    coreProps: () => {
      const xml = zip.has('docProps/core.xml') ? zip.text('docProps/core.xml') : '';
      const tag = t => (xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1];
      return { modified: tag('dcterms:modified'), created: tag('dcterms:created') };
    },
  };
}
