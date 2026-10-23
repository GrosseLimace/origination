import { describe, it, expect } from 'vitest';
import { FdCicData, FieldProgramRecord, FieldSeason, ProducerField } from '@models';
import { createFdCicProgram } from './fd-cic.program';
import { fakeFdCicApi } from './fd-cic.testing';

const season: FieldSeason = { id: 's1', fieldKey: 'f1', plantingIntentionId: 1, year: 2026, cropLabel: 'Irrigated Corn', acres: 80 };
const field: ProducerField = {
  fieldKey: 'f1', customerId: 9, name: 'Penka #1 irrigated', fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '3', state: 'KS', county: 'Pratt',
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
    expect(score.value).toBe(5900);
    expect(score.vsBaseline).toBeCloseTo(-100 / 6000, 9);
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

  it('should give the field\'s production for the ticket check: acres × actual yield', () => {
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
    expect(frozen.inputs).toMatchObject({ fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '3', state: 'KS', county: 'Pratt', acres: 80, actualYield: 205, tillage: 'No till', coverCrop: 'No cover crop', niPercent: 0 });
    expect(frozen.outputs).toMatchObject({ ciGPerBu: 5300, nationalAverage: 6000, yieldUsed: 205, mlra: '78', usdaVersion: '1.2', usdaWorkbookSha256: 'db3e', usdaFormulaFingerprint: 'a2cc' });
    expect(frozen.score!.value).toBe(5300);
  });

  it('should copy last year\'s practices by the crop rules, never the actual yield', () => {
    const last = data({ actualYield: 210, tillage: 'NoTill', coverCrop: 'CoverCrop' });
    expect(program.copyForward(last, 'Soybeans', 'Corn')).toEqual({ tillage: 'NoTill', coverCrop: 'CoverCrop' });
    expect(program.copyForward(last, 'Corn', 'Corn')).not.toHaveProperty('actualYield');
  });

  describe('crop row roll-up', () => {
    const record = (d: FdCicData, frozen?: FieldProgramRecord['frozen']): FieldProgramRecord<FdCicData> =>
      ({ id: 'r1', seasonId: 's1', programKey: program.key, data: d, status: frozen ? 'Final' : 'Ready', frozen });

    it('should show the CI line, marked better when below national', () => {
      const low = program.rowSummary!([{ season, field, record: record(data({ tillage: 'NoTill', coverCrop: 'CoverCrop', niFraction: 1 })) }], { id: 1, acres: 80 })!;
      expect(low.text).toBe('CI 4,600 g/bu');
      expect(low.change).toEqual({ text: '▼23% vs national', better: true });
      const high = program.rowSummary!([{ season, field, record: record(data({ syntheticN: 400 })) }], { id: 1, acres: 80 })!;
      expect(high.change).toEqual({ text: '▲17% vs national', better: false });
    });

    it('should count acres not yet in a scored field at the national average', () => {
      // 80 scored acres at 5,900 and 80 more at the national 6,000, at the same yield: 5,950.
      const row = program.rowSummary!([{ season, field, record: record(data()) }], { id: 1, acres: 160 })!;
      expect(row.text).toBe('CI 5,950 g/bu');
    });

    it('should give the producer\'s enrollment CI weighted by each scored field\'s bushels, leaving unscored fields out', () => {
      // 80 ac × 200 bu at 5,900 and 40 ac × 100 bu at 5,500: (5,900×16,000 + 5,500×4,000) ÷ 20,000 = 5,820.
      const small: FieldSeason = { ...season, id: 's2', acres: 40 };
      const unscored: FieldSeason = { ...season, id: 's3', acres: 500 };
      const summaries = program.enrollmentSummary!([
        { season, field, record: record(data()) },
        { season: small, field, record: record(data({ expectedYield: 100, syntheticN: 100 })) },
        { season: unscored, field, record: record(program.blankData()) },
      ]);
      expect(summaries).toEqual([{ text: 'CI 5,820 g/bu', change: { text: '▼3% vs national', better: true } }]);
    });

    it('should give one enrollment CI per crop, never averaging corn and soybeans together', () => {
      const soy: FieldSeason = { ...season, id: 's2', cropLabel: 'Organic Soybeans' };
      const summaries = program.enrollmentSummary!([
        { season, field, record: record(data()) },
        { season: soy, field, record: record(data({ syntheticN: 0 })) },
      ]);
      expect(summaries.map(s => s.text)).toEqual(['Corn CI 5,900 g/bu', 'Soybean CI 5,000 g/bu']);
    });

    it('should use a finalized field\'s frozen score, not a new calculation', () => {
      const frozen = { inputs: {}, outputs: { yieldUsed: 200, nationalAverage: 6000 }, score: { value: 4800, unit: 'g CO₂e/bu', unitShort: 'g/bu' },
        calculatorVersion: 'USDA FD-CIC v1.2', finalizedBy: 'harvest complete', finalizedAt: '2026-10-01' };
      const api = fakeFdCicApi();
      const row = createFdCicProgram(api).rowSummary!([{ season, field, record: record(data(), frozen) }], { id: 1, acres: 80 })!;
      expect(row.text).toBe('CI 4,800 g/bu');
      expect(api.requests).toHaveLength(0);
    });
  });
});
