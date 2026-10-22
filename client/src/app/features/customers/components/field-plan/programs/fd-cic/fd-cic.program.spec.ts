import { describe, it, expect } from 'vitest';
import { FdCicData, FieldSeason, ProducerField } from '@models';
import { FD_CIC_PROGRAM } from './fd-cic.program';
import { FD_CIC_CALCULATOR_VERSION } from './fd-cic.data';

const season: FieldSeason = { id: 's1', fieldKey: 'f1', plantingIntentionId: 1, year: 2026, cropLabel: 'Corn', acres: 80 };
const field: ProducerField = {
  fieldKey: 'f1', customerId: 9, name: 'Penka #1 irrigated', fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '3', state: 'KS', county: 'Pratt',
};
const data = (overrides: Partial<FdCicData> = {}): FdCicData => ({ ...FD_CIC_PROGRAM.blankData(), expectedYield: 200, syntheticN: 180, ...overrides });

describe('45Z program (USDA FD-CIC v1.2 inputs)', () => {
  it('should start with the workbook\'s defaults and need only expected yield and total N', () => {
    const blank = FD_CIC_PROGRAM.blankData();
    expect(blank).toMatchObject({ coverCrop: 'None', tillage: 'NoneOfTheAbove', niFraction: 0, manure: [] });
    expect(FD_CIC_PROGRAM.missing(blank, season)).toEqual(['expected yield', 'nitrogen rate']);
    expect(FD_CIC_PROGRAM.missing(data(), season)).toEqual([]);
  });

  it('should score with the defaults alone, and lower the score for no till, cover crop and an inhibitor', () => {
    const base = FD_CIC_PROGRAM.preview(data(), season, field)!;
    expect(base.unitShort).toBe('g/bu');
    const better = FD_CIC_PROGRAM.preview(data({ tillage: 'NoTill', coverCrop: 'CoverCrop', niFraction: 0.5 }), season, field)!;
    expect(better.value).toBeLessThan(base.value);
    expect(FD_CIC_PROGRAM.preview(data({ tillage: 'ReducedTill' }), season, field)!.value).toBeLessThan(base.value);
    expect(FD_CIC_PROGRAM.preview(data({ coverCrop: 'CoverCropGrazed' }), season, field)!.value).toBeLessThan(base.value);
  });

  it('should only apply to the crops FD-CIC scores', () => {
    expect(FD_CIC_PROGRAM.appliesTo('Irrigated Corn')).toBe(true);
    expect(FD_CIC_PROGRAM.appliesTo('Milo')).toBe(true);
    expect(FD_CIC_PROGRAM.appliesTo('Hard Red Winter Wheat')).toBe(false);
  });

  it('should give the field\'s production for the ticket check: acres × actual yield', () => {
    expect(FD_CIC_PROGRAM.production!(data({ actualYield: 205 }), season)).toBe(16400);
    expect(FD_CIC_PROGRAM.production!(data(), season)).toBeNull();
  });

  it('should need the actual yield before finalizing and freeze the workbook\'s inputs and outputs with the version', () => {
    expect(FD_CIC_PROGRAM.finalizeMissing(data(), season)).toEqual(['actual yield']);
    const frozen = FD_CIC_PROGRAM.freeze(data({ actualYield: 205, tillage: 'NoTill' }), season, field);
    expect(frozen.calculatorVersion).toBe(FD_CIC_CALCULATOR_VERSION);
    expect(frozen.calculatorVersion).toContain('FD-CIC v1.2');
    expect(frozen.inputs).toMatchObject({ fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '3', state: 'KS', county: 'Pratt', acres: 80, actualYield: 205, tillage: 'No till', coverCrop: 'No cover crop', niPercent: 0 });
    expect(frozen.outputs).toHaveProperty('nationalAverage');
    expect(frozen.score.value).toBeCloseTo(frozen.outputs['ciGPerBu'] as number, 6);
  });

  it('should copy last year\'s practices by the crop rules, never the actual yield', () => {
    const last = data({ actualYield: 210, tillage: 'NoTill', coverCrop: 'CoverCrop' });
    expect(FD_CIC_PROGRAM.copyForward(last, 'Soybeans', 'Corn')).toEqual({ tillage: 'NoTill', coverCrop: 'CoverCrop' });
    expect(FD_CIC_PROGRAM.copyForward(last, 'Corn', 'Corn')).not.toHaveProperty('actualYield');
  });

  it('should roll a crop row up to a CI line, with its change against national marked better when lower', () => {
    const row = (d: FdCicData) => FD_CIC_PROGRAM.rowSummary!([{ season, record: { id: 'r1', seasonId: 's1', programKey: FD_CIC_PROGRAM.key, data: d, status: 'Ready' } }], { id: 1, acres: 80 })!;
    const low = row(data({ tillage: 'NoTill', coverCrop: 'CoverCrop', niFraction: 1 }));
    expect(low.text).toMatch(/^CI [\d,]+ g\/bu$/);
    expect(low.change).toMatchObject({ better: true });
    expect(low.change!.text).toMatch(/^▼\d+% vs national$/);
    const high = row(data({ syntheticN: 400 }));
    expect(high.change).toMatchObject({ better: false });
    expect(high.change!.text).toMatch(/^▲\d+% vs national$/);
  });
});
