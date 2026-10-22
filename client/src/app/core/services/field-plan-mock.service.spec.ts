import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FieldPlanMockService } from './field-plan-mock.service';

const CUSTOMER = 9;

describe('FieldPlanMockService (prototype)', () => {
  let plan: FieldPlanMockService;

  beforeEach(() => {
    plan = TestBed.inject(FieldPlanMockService);
  });

  function field(name: string) {
    return plan.createField({ customerId: CUSTOMER, name, state: 'KS', county: 'Pratt' });
  }

  it('should keep a field once and reuse it on another crop row', () => {
    const north = field('North 80');
    plan.addSeason(north.fieldKey, 1, 2025, 'Soybeans', 80);
    plan.addSeason(north.fieldKey, 2, 2026, 'Corn', 80);
    expect(plan.fieldsFor(CUSTOMER)).toHaveLength(1);
    expect(plan.seasonsForIntention(2)).toHaveLength(1);
  });

  it('should find the field\'s most recent earlier season', () => {
    const north = field('North 80');
    plan.addSeason(north.fieldKey, 1, 2024, 'Corn', 70);
    plan.addSeason(north.fieldKey, 2, 2025, 'Soybeans', 80);
    expect(plan.lastSeason(north.fieldKey, 2026)?.cropLabel).toBe('Soybeans');
    expect(plan.lastSeason(north.fieldKey, 2025)?.acres).toBe(70);
  });

  it('should hold only generic season data', () => {
    const s = plan.addSeason(field('North 80').fieldKey, 1, 2026, 'Corn', 80);
    expect(Object.keys(s).sort()).toEqual(['acres', 'cropLabel', 'fieldKey', 'id', 'plantingIntentionId', 'year']);
  });
});
