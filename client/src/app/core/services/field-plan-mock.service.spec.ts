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

  it('should find the field\'s most recent earlier season for acres and copy-forward', () => {
    const north = field('North 80');
    plan.addSeason(north.fieldKey, 1, 2024, 'Corn', 70);
    plan.addSeason(north.fieldKey, 2, 2025, 'Soybeans', 80);
    expect(plan.lastSeason(north.fieldKey, 2026)?.cropLabel).toBe('Soybeans');
    expect(plan.lastSeason(north.fieldKey, 2025)?.acres).toBe(70);
  });

  it('should mark a season Projected once its practices are complete, and keep it locked once final', () => {
    const s = plan.addSeason(field('North 80').fieldKey, 1, 2026, 'Corn', 80);
    plan.updateSeason({ ...s, expectedYield: 210, syntheticN: 180, tillage: 'NoTill', coverCrop: 'None' });
    expect(plan.season(s.id)?.status).toBe('Projected');

    plan.finalizeSeason(s.id, 205);
    plan.updateSeason({ ...plan.season(s.id)!, acres: 1 });
    plan.removeSeason(s.id);
    expect(plan.season(s.id)?.acres).toBe(80);
  });
});
