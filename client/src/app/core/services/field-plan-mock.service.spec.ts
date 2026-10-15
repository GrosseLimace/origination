import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlantingIntention } from '@models';
import { FieldPlanMockService } from './field-plan-mock.service';

const CUSTOMER = 9;

function intention(overrides: Partial<PlantingIntention>): PlantingIntention {
  return {
    id: 1, customerId: CUSTOMER, customerName: '', customerCode: '', tradeUnit: '2190', plantingYear: 2026,
    crop: 'YC', type: 'Irrigated', acres: 220, createdAt: '', createdBy: '', ...overrides,
  };
}

describe('FieldPlanMockService (prototype roll-up)', () => {
  let plan: FieldPlanMockService;

  beforeEach(() => {
    plan = TestBed.inject(FieldPlanMockService);
    plan.clearAll(); // no sample fields: each test builds exactly what it needs
    plan.load(CUSTOMER, [intention({})], 2026, 'KS', '2190', () => null);
  });

  function field(name: string, acres: number, irrigation: 'Irrigated' | 'Dryland' = 'Irrigated') {
    return plan.createField({ customerId: CUSTOMER, name, acres, irrigation, state: 'KS', county: 'Pratt', tradeUnit: '2190' });
  }
  const totalFor = (crop: string, type = 'Irrigated') =>
    plan.totalsFor(CUSTOMER, 2026).find(t => t.key.crop === crop && t.key.type === type)?.total;

  it('should start each total at the real intention acres', () => {
    expect(totalFor('YC')).toBe(220);
  });

  it('should move existing acres into a field without changing the total', () => {
    plan.setCrop(field('North 80', 80), 2026, 1, 'YC', 'Corn');
    expect(totalFor('YC')).toBe(220);
  });

  it('should raise the total only by the acres the existing plan cannot cover', () => {
    plan.setCrop(field('North 80', 80), 2026, 1, 'YC', 'Corn');
    plan.setCrop(field('River Bottom', 320), 2026, 1, 'YC', 'Corn');
    expect(totalFor('YC')).toBe(400);
  });

  it('should move a field\'s acres from one crop to the other when its crop changes', () => {
    const north = field('North 80', 80);
    plan.setCrop(north, 2026, 1, 'YC', 'Corn');
    plan.setCrop(north, 2026, 1, 'SB', 'Soybeans');
    expect(totalFor('YC')).toBe(140);
    expect(totalFor('SB')).toBe(80);
  });

  it('should roll a dryland field into an untyped intention instead of starting a second row', () => {
    plan.clearAll();
    plan.load(CUSTOMER, [intention({ id: 2, crop: 'SB', type: undefined, acres: 175 })], 2026, 'KS', '2190', () => null);
    plan.setCrop(field('Home Place', 100, 'Dryland'), 2026, 1, 'SB', 'Soybeans');
    expect(totalFor('SB', '')).toBe(175);
    expect(totalFor('SB', 'Dryland')).toBeUndefined();
  });

  it('should leave the total alone for a fallow field', () => {
    plan.setCrop(field('North 80', 80), 2026, 1, 'FALLOW', 'Not planted');
    expect(totalFor('YC')).toBe(220);
  });
});
