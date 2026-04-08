const fs = require('fs');

const csvPath = String.raw`C:\Users\CEgr\OneDrive - The Scoular Company\Desktop\prodCustomerSnapshot.csv`;
const outPath = String.raw`C:\Users\CEgr\OneDrive - The Scoular Company\Desktop\prodCustomerSnapshot.sql`;

const raw = fs.readFileSync(csvPath, 'utf-8').replace(/^\uFEFF/, ''); // strip BOM
const lines = [];
let current = '';
let inQuote = false;

// Parse CSV respecting quoted fields with commas
for (const char of raw) {
  if (char === '"') { inQuote = !inQuote; current += char; }
  else if (char === '\n' && !inQuote) { lines.push(current.replace(/\r$/, '')); current = ''; }
  else { current += char; }
}
if (current.trim()) lines.push(current.replace(/\r$/, ''));

const columns = [
  'CustomerId','CustomerName','SourceCustomerId','MerchandisingPhone','MerchandisingEmail',
  'ExtendedPrimaryPhone','SupplementalEmail','MerchandisingCity','MerchandisingStateProvince',
  'MerchandisingAddressLine1','MerchandisingPostalCode','ExtendedAddressLine1','ExtendedAddressLine2',
  'ExtendedAddressLine3','ExtendedAddressLine4','ExtendedCity','ExtendedStateProvince',
  'ExtendedPostalCode','ExtendedCountry','IndustryCode1','IsActive','EffectiveStartDate',
  'EffectiveEndDate','TradeUnit'
];

function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(field); field = ''; }
    else { field += c; }
  }
  fields.push(field);
  return fields;
}

function esc(val) {
  if (!val || val === 'NULL' || val === '') return 'NULL';
  return "N'" + val.replace(/'/g, "''") + "'";
}

const out = fs.createWriteStream(outPath);
out.write('SET NOCOUNT ON;\n\n');

const batchSize = 500;
let count = 0;

for (const line of lines) {
  if (!line.trim()) continue;
  const f = parseCSVLine(line);
  if (f.length < 24) { console.log('Skipping short line:', f.length, f[0]); continue; }

  const customerId = f[0];
  const isActive = f[20] === '1' ? '1' : '0';
  const effStart = f[21] && f[21] !== 'NULL' ? `'${f[21]}'` : 'NULL';
  const effEnd = f[22] && f[22] !== 'NULL' ? `'${f[22]}'` : 'NULL';

  out.write(`INSERT INTO dbo.CustomerSnapshot (${columns.join(',')},SnapshotRefreshedAt) VALUES (${customerId},${esc(f[1])},${esc(f[2])},${esc(f[3])},${esc(f[4])},${esc(f[5])},${esc(f[6])},${esc(f[7])},${esc(f[8])},${esc(f[9])},${esc(f[10])},${esc(f[11])},${esc(f[12])},${esc(f[13])},${esc(f[14])},${esc(f[15])},${esc(f[16])},${esc(f[17])},${esc(f[18])},${esc(f[19])},${isActive},${effStart},${effEnd},${esc(f[23])},GETUTCDATE());\n`);
  count++;

  if (count % batchSize === 0) {
    out.write('GO\n');
  }
}

out.write('GO\n');
out.write(`\nPRINT 'Inserted ${count} rows into CustomerSnapshot';\n`);
out.end();

console.log(`Generated ${count} INSERT statements → ${outPath}`);
