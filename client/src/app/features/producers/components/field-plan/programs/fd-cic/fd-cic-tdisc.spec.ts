import { describe, it, expect } from 'vitest';
import { TDiscPass } from '@models';
import { designate, operationsFor, passesProblem, rateTDisc, supportedTillage, tDiscNeeded } from './fd-cic-tdisc';
import { TDISC_TEST_OPTIONS as options } from './fd-cic-tdisc.testing';

const pass = (window: TDiscPass['window'], implement: string): TDiscPass => ({ window, implement });

describe('USDA T-DISC (7 CFR 2100.051)', () => {
  it('should be needed only for no till and reduced till', () => {
    expect(tDiscNeeded('NoTill')).toBe(true);
    expect(tDiscNeeded('ReducedTill')).toBe(true);
    expect(tDiscNeeded('NoneOfTheAbove')).toBe(false);
  });

  it('should designate by the regulation\'s limits, inclusive', () => {
    expect(designate(options, 0)).toBe('NT');
    expect(designate(options, 0.075)).toBe('NT');
    expect(designate(options, 0.0751)).toBe('RT');
    expect(designate(options, 0.252)).toBe('RT');
    expect(designate(options, 0.2521)).toBe('CT');
  });

  it('should keep the selected tillage when the designation supports it, and only ever step down', () => {
    expect(supportedTillage('NoTill', 'NT')).toBe('NoTill');
    expect(supportedTillage('NoTill', 'RT')).toBe('ReducedTill');
    expect(supportedTillage('NoTill', 'CT')).toBe('NoneOfTheAbove');
    expect(supportedTillage('ReducedTill', 'NT')).toBe('ReducedTill');
    expect(supportedTillage('ReducedTill', 'CT')).toBe('NoneOfTheAbove');
  });

  // Excel's own results for the pack's golden cases (Content/TDisc/v1.1.1/golden-cases.json).
  it.each([
    ['1 no-till corn', [pass('Planting', 'PLANTER, NO-TILL'), pass('After_Planting', 'SPRAYER/AERIAL/BROADCAST APPLICATION'), pass('Harvest', 'HARVEST, GRAIN')], 0.010000000000000002, 'NT'],
    ['2 rotary hoe at exactly 0.075', [pass('Planting', 'CULTIVATOR, ROTARY HOE'), pass('Harvest', 'HARVEST, GRAIN')], 0.075, 'NT'],
    ['3 two passes in one window', [pass('Field_Preparation', 'CULTIVATOR, FIELD'), pass('Field_Preparation', 'HARROW, COILED TINES'), pass('Planting', 'PLANTER, REGULAR'), pass('Harvest', 'HARVEST, GRAIN')], 0.1422, 'RT'],
    ['5 conventional chisel and disk', [pass('Field_Preparation', 'PLOW, CHISEL'), pass('Before_Planting', 'HARROW, DISK, TANDEM, LIGHTDUTY'), pass('Planting', 'PLANTER, REGULAR'), pass('Harvest', 'HARVEST, GRAIN')], 0.5, 'CT'],
    ['6 deep pass entered before a shallow one', [pass('Field_Preparation', 'PLOW, MOLDBOARD'), pass('Field_Preparation', 'HARROW, SPIKE TOOTH OR SPRING TOOTH'), pass('Harvest', 'HARVEST, GRAIN')], 0.4532, 'CT'],
    ['9 harvest only', [pass('Harvest', 'HARVEST, GRAIN')], 0, 'NT'],
    ['10 same depth, different mixing efficiency', [pass('Field_Preparation', 'PLOW, SWEEP'), pass('Field_Preparation', 'AERATOR'), pass('Field_Preparation', 'NUTRIENT MGMT: FERT APPL, SHANK'), pass('Harvest', 'RESIDUE MGMT: STALK PULLER CHOPPER')], 0.2252333333333333, 'RT'],
  ] as const)('should reproduce Excel: %s', (_, passes, rating, designation) => {
    const result = rateTDisc(options, passes)!;
    expect(result.rating).toBeCloseTo(rating, 12);
    expect(result.designation).toBe(designation);
  });

  it('should show each window\'s index, blank where there were no passes, and each pass\'s intensity in rated order', () => {
    const result = rateTDisc(options, [pass('Field_Preparation', 'CULTIVATOR, FIELD'), pass('Field_Preparation', 'HARROW, COILED TINES'), pass('Harvest', 'HARVEST, GRAIN')])!;

    expect(result.windows.find(w => w.key === 'Before_Planting')!.index).toBeNull();
    expect(result.windows.find(w => w.key === 'Harvest')).toMatchObject({ index: 0, designation: 'NT' });
    expect(result.passes.map(p => p.implement)).toEqual(['HARVEST, GRAIN', 'HARROW, COILED TINES', 'CULTIVATOR, FIELD']);
    expect(result.passes[2].tillageIntensity).toBeCloseTo(0.39 * (10 - 0.6), 12);
  });

  it('should refuse no passes, too many, and an implement outside its window', () => {
    expect(passesProblem(options, [])).toContain('Add the field');
    expect(passesProblem(options, Array.from({ length: 21 }, () => pass('Harvest', 'HARVEST, GRAIN')))).toContain('at most 20');
    expect(passesProblem(options, [pass('Harvest', 'PLOW, CHISEL')])).toContain('harvest');
    expect(rateTDisc(options, [pass('Harvest', 'PLOW, CHISEL')])).toBeNull();
  });

  it('should offer only the operations whose implements are all allowed in the window', () => {
    expect(operationsFor(options, 'Field_Preparation').map(o => o.name)).toEqual(['Chisel, straight point, coil tine harrow']);
    expect(operationsFor(options, 'Harvest').map(o => o.name)).toEqual(['Combine']);
  });
});
