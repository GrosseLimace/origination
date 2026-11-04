import { describe, it, expect } from 'vitest';
import type { FieldProgramRecord, FieldSeason, ProducerField } from '@models';
import { feedstockReport } from './feedstock-report';

const field: ProducerField = {
  fieldKey: 'TATOB43', splitId: 'TATOB43', customerId: 9, name: 'JARBOE WEST', splitPercent: 100, effectiveDate: '', state: 'KS', county: 'Pratt',
};
const season: FieldSeason = { id: 's1', fieldKey: 'TATOB43', plantingIntentionId: 10, year: 2026, cropLabel: 'Irrigated Corn', acres: 120 };
const producer = { code: 'TATOBIN', name: 'T-A TOBIN FARMS LC' };

const confirmed = (tDisc: NonNullable<FieldProgramRecord['official']>['tDisc'], tillage: string): FieldProgramRecord => ({
  id: 'r1', seasonId: 's1', programKey: '45z-fdcic', status: 'Locked',
  data: { expectedYield: 190, actualYield: 200, syntheticN: 180, niFraction: 0.5, coverCrop: 'None', tillage: 'ReducedTill', manure: [], tDiscRating: 0.14 },
  frozen: {
    inputs: {
      acres: 120, expectedYield: 190, actualYield: 200, syntheticN: 180, niPercent: 50, coverCrop: 'No cover crop', tillage,
      tDiscRating: 0.14, manure: [{ type: 'Beef', form: 'Solid', amount: 10, nContent: 12 }],
    },
    outputs: {
      yieldUsed: 200, mlra: '78C', usdaWorkbookSha256: 'abc123', usdaFormulaFingerprint: 'fp1',
      components: { nFertilizer: 1000, soilCarbon: -50, directN2o: 900, indirectN2o: 200, onFarmEnergy: 600, otherChemicals: 300, ureaLime: 120 },
    },
    calculatorVersion: 'USDA FD-CIC v1.2', basis: 'Estimate', lockedBy: 'hc', lockedAt: '',
  },
  official: {
    status: 'Documented', score: { value: 3100.456, unit: 'g CO₂e/bu', unitShort: 'g/bu' }, method: 'USDA FD-CIC v1.2',
    actualYield: 200, bushels: 24_000, tDisc, recordkeepingAcknowledged: true,
    tickets: [{ ticketKey: 'k1', ticketNumber: 'P1', blDate: '2026-10-05', location: 'Pratt', productCode: 'YC', contractNumber: null, cropYearMatch: 'window', netBushels: 24_000, settled: true, settledDate: null, status: null }],
    documentedBy: 'tess.tester@example.test', documentedAt: '2026-11-21T15:00:00Z',
  },
});

describe('feedstockReport (7 CFR 2100.031(e))', () => {
  const stepDown = { rating: 0.14, designation: 'Reduced till', estimatedTillage: 'No till', confirmedTillage: 'Reduced till' };
  const report = feedstockReport({ producer, field, season, record: confirmed(stepDown, 'Reduced till'), enrollmentId: 'CI-2026-TATOB43', generatedAt: new Date(2026, 10, 22) })!;
  const rows = (heading: string) => Object.fromEntries(report.sections.find(s => s.heading === heading)!.rows);

  it('should name the farm, producer and field location', () => {
    expect(rows('Farm producer')).toMatchObject({ 'Farm and producer name': 'T-A TOBIN FARMS LC', 'Field location': 'Pratt County, KS' });
    expect(rows('Field')['Field ID']).toBe('CI-2026-TATOB43');
  });

  it('should name the primary contact only when there is one', () => {
    expect(rows('Farm producer')['Primary contact']).toBeUndefined();
    const withContact = feedstockReport({ producer: { ...producer, primaryContact: ' Pat Producer ' }, field, season, record: confirmed(stepDown, 'Reduced till'), enrollmentId: 'CI-2026-TATOB43', generatedAt: new Date(2026, 10, 22) })!;
    const farm = Object.fromEntries(withContact.sections.find(s => s.heading === 'Farm producer')!.rows);
    expect(farm['Primary contact']).toBe('Pat Producer');
  });

  it('should show every FD-CIC input, including the T-DISC rating and a stepped-down tillage', () => {
    const inputs = rows('USDA FD-CIC inputs');
    expect(inputs['Tillage']).toBe('Reduced till (estimated as No till)');
    expect(inputs['T-DISC rating']).toBe('0.140 (Reduced till)');
    expect(inputs['Manure']).toBe('Beef solid: 10.0 tons/ac at 12.0 lb N per ton');
    expect(inputs['Nitrification inhibitor']).toBe('50% of N');
  });

  it('should show how the CI was worked out: the seven components, then their total', () => {
    expect(report.calculation.heading).toBe('CI calculation (USDA FD-CIC v1.2)');
    expect(report.calculation.rows).toHaveLength(7);
    expect(report.calculation.rows[1]).toEqual(['Soil carbon', '-50.00']);
    expect(report.calculation.total).toEqual(['Carbon intensity (CI): the sum', '3,100.46']);
    expect(rows('USDA FD-CIC inputs')['MLRA (from the county)']).toBe('78C');
  });

  it('should leave out what is not an input or the calculation', () => {
    expect(report.sections.map(sec => sec.heading)).toEqual(['Farm producer', 'Field', 'USDA FD-CIC inputs']);
    const all = JSON.stringify(report);
    for (const gone of ['SHA-256', 'fingerprint', 'Confirmed bushels', 'Yield used']) expect(all).not.toContain(gone);
  });

  it('should not be an attestation: no certification, tickets or recordkeeping list', () => {
    for (const key of ['certification', 'attestation', 'fraudStatement', 'tickets', 'recordkeeping', 'recordkeepingNote']) expect(report).not.toHaveProperty(key);
  });

  it('should name the originator who confirmed it, falling back to their sign-in', () => {
    expect(report.footer).toContain('Confirmed by tess.tester@example.test on 2026-11-21');
    const named = confirmed(stepDown, 'Reduced till');
    named.official!.documentedByName = 'Tess Tester';
    expect(feedstockReport({ producer, field, season, record: named, enrollmentId: 'CI-2026-TATOB43', generatedAt: new Date(2026, 10, 22) })!.footer)
      .toContain('Confirmed by Tess Tester on 2026-11-21');
  });

  it('should carry the server\'s T-DISC worksheet: every pass, each window\'s index, and how the rating is worked out', () => {
    const worksheet = feedstockReport({ producer, field, season, enrollmentId: 'CI-2026-TATOB43', generatedAt: new Date(2026, 10, 22), record: confirmed({
      ...stepDown, rating: 0.1422, version: 'USDA T-DISC v1.1.1',
      passes: [
        { window: 'Harvest', implement: 'HARVEST, GRAIN', mixingEfficiency: 0, depthCm: 0, tillageIntensity: 0 },
        { window: 'Field_Preparation', implement: 'HARROW, COILED TINES', mixingEfficiency: 0.2, depthCm: 3, tillageIntensity: 0.6 },
        { window: 'Field_Preparation', implement: 'CULTIVATOR, FIELD', mixingEfficiency: 0.39, depthCm: 10, tillageIntensity: 3.666 },
      ],
      windows: [
        { key: 'Field_Preparation', label: 'Field preparation', index: 0.1422, designation: 'RT' },
        { key: 'Before_Planting', label: 'Before planting', index: null, designation: null },
        { key: 'Harvest', label: 'Harvest', index: 0, designation: 'NT' },
      ],
    }, 'Reduced till') })!;

    expect(worksheet.tDisc?.heading).toBe('T-DISC worksheet (USDA T-DISC v1.1.1)');
    expect(worksheet.tDisc?.passes.rows[1]).toEqual(['Field preparation', 'HARROW, COILED TINES', '0.20', '3', '0.600']);
    expect(worksheet.tDisc?.windows.rows).toEqual([['Field preparation', '0.142', 'Reduced till'], ['Before planting', 'No passes', '—'], ['Harvest', '0.000', 'No till']]);
    expect(worksheet.tDisc?.summary).toContain('T-DISC rating 0.142 (Reduced till)');
    expect(report.tDisc).toBeNull(); // a confirmed CI from before the worksheet was kept
  });

  it('should be named by producer, field ID and day', () => {
    expect(report.fileName).toBe('45Z-Biofuel-Feedstock-Report_TATOBIN_CI-2026-TATOB43_20261122.pdf');
  });

  it('should not be built for a field that is only estimated', () => {
    const estimate: FieldProgramRecord = { id: 'r2', seasonId: 's1', programKey: '45z-fdcic', data: {}, status: 'Ready' };
    expect(feedstockReport({ producer, field, season, record: estimate, enrollmentId: undefined, generatedAt: new Date() })).toBeNull();
  });
});
