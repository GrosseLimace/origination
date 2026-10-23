import { describe, it, expect } from 'vitest';
import { FdCicData, FieldProgramRecord, FieldSeason, ProducerField } from '@models';
import { createFdCicProgram } from './fd-cic.program';
import { fakeFdCicApi } from './fd-cic.testing';

const season: FieldSeason = { id: 's1', fieldKey: 'f1', plantingIntentionId: 1, year: 2026, cropLabel: 'Irrigated Corn', acres: 80 };
const field: ProducerField = {
  fieldKey: 'TATOB28', splitId: 'TATOB28', customerId: 9, name: 'PENKA #1 IRR', splitPercent: 50, effectiveDate: '2024-09-01', state: 'KS', county: 'Pratt',
};
const program = createFdCicProgram(fakeFdCicApi());
const data = (overrides: Partial<FdCicData> = {}): FdCicData => ({ ...program.blankData(), expectedYield: 200, syntheticN: 180, ...overrides });

describe('45Z program (USDA FD-CIC on the API)', () => {
  it('should start with the workbook\'s defaults and need only expected yield and total N', () => {
    const blank = program.blankData();
    expect(blank).toMatchObject({ coverCrop: 'None', tillage: 'NoneOfTheAbove', niFraction: 0, manure: [] });
    expect(program.missing(blank, season)).toEqual(['expected yield', 'nitrogen rate']);
    expect(program.missing(data(), season)).toEqual([]);
  });

  it('should ask the API for the crop year, in the workbook\'s labels, with the field\'s location', () => {
    const api = fakeFdCicApi();
    createFdCicProgram(api).preview(data({ tillage: 'NoTill', coverCrop: 'CoverCropGrazed', niFraction: 0.25,
      manure: [{ type: 'Swine', form: 'Liquid', amount: 5, nContent: null }] }), season, field);
    expect(api.requests).toEqual([{ year: 2026, request: {
      crop: 'Corn', state: 'KS', county: 'Pratt', actualYield: null, expectedYield: 200, syntheticN: 180, niFraction: 0.25,
      coverCrop: 'Cover crop with grazing', tillage: 'No till', manure: [{ amount: 5, nContent: 0 }],
    } }]);
  });

  it('should not ask until the inputs and the field\'s county are in', () => {
    const api = fakeFdCicApi();
    const p = createFdCicProgram(api);
    expect(p.preview(program.blankData(), season, field)).toBeNull();
    expect(p.preview(data(), season, { ...field, county: '' })).toBeNull();
    expect(api.requests).toHaveLength(0);
  });

  it('should show the API\'s score, and say why there is none while calculating or when USDA has no data', () => {
    const score = program.preview(data(), season, field)!;
    expect(score).toMatchObject({ unitShort: 'g/bu', unit: 'g CO₂e/bu' });
    expect(score).toEqual({ value: 5900, unit: 'g CO₂e/bu', unitShort: 'g/bu' });
    expect(program.previewNote!(data(), season, field)).toBeNull();

    const loading = createFdCicProgram(fakeFdCicApi('loading'));
    expect(loading.preview(data(), season, field)).toBeNull();
    expect(loading.previewNote!(data(), season, field)).toBe('calculating…');

    const noData = createFdCicProgram(fakeFdCicApi('unscorable'));
    expect(noData.preview(data(), season, field)).toBeNull();
    expect(noData.previewNote!(data(), season, field)).toBe('no USDA data');
  });

  it('should only apply to the crops FD-CIC scores', () => {
    expect(program.appliesTo('Irrigated Corn')).toBe(true);
    expect(program.appliesTo('Milo')).toBe(true);
    expect(program.appliesTo('Hard Red Winter Wheat')).toBe(false);
  });

  it('should give the field\'s production: acres × actual yield', () => {
    expect(program.production!(data({ actualYield: 205 }), season)).toBe(16400);
    expect(program.production!(data(), season)).toBeNull();
  });

  it('should need the actual yield and a finished USDA score before finalizing', () => {
    expect(program.finalizeMissing(data(), season, field)).toEqual(['actual yield']);
    expect(program.finalizeMissing(data({ actualYield: 205 }), season, field)).toEqual([]);
    expect(createFdCicProgram(fakeFdCicApi('loading')).finalizeMissing(data({ actualYield: 205 }), season, field))
      .toEqual(['the USDA score (still calculating)']);
    expect(createFdCicProgram(fakeFdCicApi('unscorable')).finalizeMissing(data({ actualYield: 205 }), season, field)[0])
      .toContain('no Corn data for Pratt County');
  });

  it('should freeze the inputs, the USDA outputs and the exact USDA version', () => {
    const frozen = program.freeze(data({ actualYield: 205, tillage: 'NoTill' }), season, field);
    expect(frozen.calculatorVersion).toBe('USDA FD-CIC v1.2');
    expect(frozen.inputs).toMatchObject({ splitId: 'TATOB28', splitPercent: 50, state: 'KS', county: 'Pratt', acres: 80, actualYield: 205, tillage: 'No till', coverCrop: 'No cover crop', niPercent: 0 });
    expect(frozen.outputs).toMatchObject({ ciGPerBu: 5300, nationalAverage: 6000, yieldUsed: 205, mlra: '78', usdaVersion: '1.2', usdaWorkbookSha256: 'db3e', usdaFormulaFingerprint: 'a2cc' });
    expect(frozen.score!.value).toBe(5300);
    expect(frozen.outputs['breakdown']).toContainEqual({ key: 'otherChemicals', label: 'Other chemicals', total: 470, fixed: 470, fixedLabel: 'Other chemicals', drivers: [] });
  });

  it('should copy last year\'s practices by the crop rules, never the actual yield', () => {
    const last = data({ actualYield: 210, tillage: 'NoTill', coverCrop: 'CoverCrop' });
    expect(program.copyForward(last, 'Soybeans', 'Corn')).toEqual({ tillage: 'NoTill', coverCrop: 'CoverCrop' });
    expect(program.copyForward(last, 'Corn', 'Corn')).not.toHaveProperty('actualYield');
  });

  describe('crop row and field results', () => {
    const record = (d: FdCicData, frozen?: FieldProgramRecord['frozen'], id = 'r1'): FieldProgramRecord<FdCicData> =>
      ({ id, seasonId: 's1', programKey: program.key, data: d, status: frozen ? 'Final' : 'Ready', frozen });

    it('should show the raw CI and the bushels, with no comparison to the national average', () => {
      const low = program.rowSummary!([{ season, field, record: record(data({ tillage: 'NoTill', coverCrop: 'CoverCrop', niFraction: 1 })) }], { id: 1, acres: 80 })!;
      expect(low).toEqual({ text: 'CI 4,600 g/bu · 16,000 bu (projected)', short: 'CI 4,600' });
      const high = program.rowSummary!([{ season, field, record: record(data({ syntheticN: 400 })) }], { id: 1, acres: 80 })!;
      expect(JSON.stringify(high)).not.toMatch(/national|average|%|▲|▼/);
    });

    it('should give the crop row its range of field CIs and their bushels, never an average, and how much is scored', () => {
      const small: FieldSeason = { ...season, id: 's2', acres: 40 };
      const unscored: FieldSeason = { ...season, id: 's3', acres: 100 };
      const row = program.rowSummary!([
        { season, field, record: record(data({ actualYield: 210 })) },
        { season: small, field, record: record(data({ tillage: 'NoTill', coverCrop: 'CoverCrop', niFraction: 1 }), undefined, 'r2') },
        { season: unscored, field, record: record(program.blankData(), undefined, 'r3') },
      ], { id: 1, acres: 300 })!;
      // 80 ac × 210 actual + 40 ac × 200 expected = 24,800 bu.
      expect(row.text).toBe('CI 4,600–5,900 g/bu · 24,800 bu (projected) · 120 of 300 ac scored');
    });

    it('should give each field its CI and bushels: projected from the expected yield, then actual', () => {
      const soy: FieldSeason = { ...season, id: 's2', cropLabel: 'Organic Soybeans' };
      expect(program.fieldResults!([
        { season, field, record: record(data()) },
        { season, field, record: record(data({ actualYield: 210 }), undefined, 'r2') },
        { season: soy, field, record: record(data({ syntheticN: 0 }), undefined, 'r3') },
        { season, field, record: record(program.blankData(), undefined, 'r4') },
      ])).toEqual([
        { recordId: 'r1', group: 'Corn', value: 5900, unitShort: 'g/bu', bushels: 16000, projected: true },
        { recordId: 'r2', group: 'Corn', value: 5900, unitShort: 'g/bu', bushels: 16800, projected: false },
        { recordId: 'r3', group: 'Soybean', value: 5000, unitShort: 'g/bu', bushels: 16000, projected: true },
        { recordId: 'r4', group: 'Corn', value: null, unitShort: 'g/bu', bushels: null, projected: true },
      ]);
    });

    it('should use a finalized field\'s frozen score, acres and actual yield, not a new calculation', () => {
      const frozen = { inputs: { acres: 80, actualYield: 205 }, outputs: { yieldUsed: 205, nationalAverage: 6000 }, score: { value: 4800, unit: 'g CO₂e/bu', unitShort: 'g/bu' },
        calculatorVersion: 'USDA FD-CIC v1.2', finalizedBy: 'harvest complete', finalizedAt: '2026-10-01' };
      const api = fakeFdCicApi();
      const p = createFdCicProgram(api);
      expect(p.rowSummary!([{ season, field, record: record(data(), frozen) }], { id: 1, acres: 80 })!.text).toBe('CI 4,800 g/bu · 16,400 bu');
      expect(p.fieldResults!([{ season, field, record: record(data(), frozen) }])[0]).toMatchObject({ value: 4800, bushels: 16400, projected: false });
      expect(api.requests).toHaveLength(0);
    });
  });
});
