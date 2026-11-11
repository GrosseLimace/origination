import { FieldProgramRecord, FieldSeason, ProducerField } from '../../../../models/field-plan.model';
import { ManureApplication } from '../../../../models/carbon-intensity.model';
import { DESIGNATION_LABELS } from './fd-cic-tdisc';
import { fdCicCropFor } from './fd-cic.data';
import { safeCode, yyyymmdd } from './mass-balance-ledger';

/**
 * A confirmed 45Z field's Biofuel Feedstock Report: which field it is, the USDA FD-CIC inputs, and how the CI was
 * worked out from them (the T-DISC worksheet behind the tillage, then USDA's seven components adding up to the
 * CI). Not an attestation: no signature, tickets or recordkeeping list. Built here as plain content (testable);
 * feedstock-report.service.ts draws the PDF.
 */
export interface FeedstockReport {
  title: string;
  subtitle: string;
  sections: { heading: string; rows: [string, string][] }[];
  /** The USDA T-DISC worksheet behind the tillage, for no till or reduced till; null otherwise. */
  tDisc: { heading: string; passes: { head: string[]; rows: string[][] }; windows: { head: string[]; rows: string[][] }; summary: string } | null;
  /** USDA's seven components, then their total: the CI. */
  calculation: { heading: string; head: string[]; rows: string[][]; total: string[] };
  footer: string;
  fileName: string;
}

export interface FeedstockReportInput {
  /** primaryContact: the producer's primary contact's name, shown when there is one. */
  producer: { code: string; name: string; primaryContact?: string | null };
  field: ProducerField;
  season: FieldSeason;
  record: FieldProgramRecord;
  enrollmentId: string | undefined;
  generatedAt: Date;
}

const COMPONENT_LABELS: [string, string][] = [
  ['nFertilizer', 'Nitrogen fertilizer'], ['soilCarbon', 'Soil carbon'], ['directN2o', 'Direct N2O'],
  ['indirectN2o', 'Indirect N2O'], ['onFarmEnergy', 'On-farm energy'], ['otherChemicals', 'Other chemicals'], ['ureaLime', 'Urea and lime'],
];

function num(v: unknown, digits = 0): string {
  return typeof v === 'number' && Number.isFinite(v)
    ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';
}

function text(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v : '—';
}

function manureText(manure: unknown): string {
  if (!Array.isArray(manure) || manure.length === 0) return 'None';
  return (manure as ManureApplication[]).map(m => {
    const unit = m.form === 'Liquid' ? '1,000 gal/ac' : 'tons/ac';
    const nUnit = m.form === 'Liquid' ? 'lb N per 1,000 gal' : 'lb N per ton';
    return `${m.type} ${m.form.toLowerCase()}: ${num(m.amount, 1)} ${unit} at ${num(m.nContent, 1)} ${nUnit}`;
  }).join('; ');
}

type ConfirmedTDisc = NonNullable<NonNullable<FieldProgramRecord['official']>['tDisc']>;

/** The T-DISC worksheet as rated on the server: every pass with the intensity it adds, and each window's index. */
function tDiscWorksheet(t: ConfirmedTDisc): NonNullable<FeedstockReport['tDisc']> {
  const windowLabel = new Map((t.windows ?? []).map(w => [w.key, w.label]));
  return {
    heading: `T-DISC worksheet (${t.version ?? 'USDA T-DISC'})`,
    passes: {
      head: ['Tillage window', 'T-DISC implement', 'Mixing efficiency', 'Depth (cm)', 'Tillage intensity'],
      rows: (t.passes ?? []).map(p => [windowLabel.get(p.window) ?? p.window, p.implement, num(p.mixingEfficiency, 2), num(p.depthCm), num(p.tillageIntensity, 3)]),
    },
    windows: {
      head: ['Tillage window', 'Index', 'Designation'],
      rows: (t.windows ?? []).map(w => [w.label, w.index === null ? 'No passes' : num(w.index, 3), w.designation ? DESIGNATION_LABELS[w.designation] : '—']),
    },
    summary: `T-DISC rating ${num(t.rating, 3)} (${t.designation}): the highest window index. Passes are sorted by depth, then mixing efficiency; `
      + 'each adds mixing efficiency x (depth - the window\'s earlier intensities), and a window\'s index is its total / 30 cm.',
  };
}

export function feedstockReport(input: FeedstockReportInput): FeedstockReport | null {
  const { producer, field, season, record, enrollmentId, generatedAt } = input;
  const official = record.official;
  const frozen = record.frozen;
  if (official?.status !== 'Documented' || !frozen) return null;
  const inp = frozen.inputs;
  const out = frozen.outputs;
  const tDisc = official.tDisc ?? null;
  const tillageLabel = text(inp['tillage']);
  const crop = fdCicCropFor(season.cropLabel) ?? season.cropLabel;
  const id = enrollmentId ?? '';

  const inputs: [string, string][] = [
    ['Expected yield', `${num(inp['expectedYield'], 1)} bu/ac`],
    ['Actual yield', `${num(inp['actualYield'], 1)} bu/ac`],
    ['Synthetic nitrogen', `${num(inp['syntheticN'])} lb N/ac`],
    ['Nitrification inhibitor', `${num(inp['niPercent'])}% of N`],
    ['Cover crop', text(inp['coverCrop'])],
    ['Tillage', tDisc && tDisc.estimatedTillage !== tDisc.confirmedTillage
      ? `${tDisc.confirmedTillage} (estimated as ${tDisc.estimatedTillage})` : tillageLabel],
    ...(tDisc ? [['T-DISC rating', `${num(tDisc.rating, 3)} (${tDisc.designation})`] as [string, string]] : []),
    ['Manure', manureText(inp['manure'])],
    ['MLRA (from the county)', text(out['mlra'])],
  ];

  const components = out['components'] as Record<string, number> | null | undefined;

  return {
    title: 'Biofuel Feedstock Report',
    subtitle: `45Z · ${season.year} ${crop} · ${producer.name}`,
    sections: [
      {
        heading: 'Farm producer',
        rows: [
          ['Farm and producer name', producer.name],
          ['Producer code', producer.code],
          ...(producer.primaryContact?.trim() ? [['Primary contact', producer.primaryContact.trim()] as [string, string]] : []),
          ['Field location', `${text(field.county)} County, ${text(field.state)}`],
        ],
      },
      {
        heading: 'Field',
        rows: [
          ['Field ID', id || '—'],
          ['Split ID', field.splitId],
          ['Field name', field.name],
          ['Acres', num(inp['acres'] ?? season.acres, 1)],
          ['Crop', `${season.cropLabel} (${crop})`],
          ['Crop year', String(season.year)],
        ],
      },
      { heading: 'USDA FD-CIC inputs', rows: inputs },
    ],
    calculation: {
      heading: `CI calculation (${text(official.method ?? frozen.calculatorVersion)})`,
      head: ['Component', 'g CO2e/bu'],
      rows: COMPONENT_LABELS.map(([key, label]) => [label, num(components?.[key], 2)]),
      total: ['Carbon intensity (CI): the sum', num(official.score?.value, 2)],
    },
    tDisc: tDisc?.passes && tDisc.windows ? tDiscWorksheet(tDisc) : null,
    footer: `Confirmed by ${official.documentedByName ?? official.documentedBy ?? '—'} on ${official.documentedAt ? localDate(new Date(official.documentedAt)) : '—'} · Generated ${localDate(generatedAt)}`,
    fileName: `45Z-Biofuel-Feedstock-Report_${safeCode(producer.code)}_${safeCode(id, 'field')}_${yyyymmdd(generatedAt)}.pdf`,
  };
}

/** yyyy-mm-dd in the user's time zone, as the file name's date is. */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
