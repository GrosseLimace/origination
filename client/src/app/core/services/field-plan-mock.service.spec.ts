import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FieldPlanMockService } from './field-plan-mock.service';
import { TicketFeedMockService } from './ticket-feed-mock.service';

const CUSTOMER = 9;

describe('FieldPlanMockService (prototype)', () => {
  let plan: FieldPlanMockService;

  beforeEach(() => {
    plan = TestBed.inject(FieldPlanMockService);
  });

  function field(name: string, fsaFieldNo = '3') {
    return plan.createField({ customerId: CUSTOMER, name, fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo, state: 'KS', county: 'Pratt' });
  }

  it('should keep a field\'s name and FSA numbers, once, and reuse it on another crop row', () => {
    const north = field('Penka #1 irrigated');
    expect(north).toMatchObject({ name: 'Penka #1 irrigated', fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '3' });
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

describe('TicketFeedMockService (prototype)', () => {
  it('should keep tickets by the enrollment ID they were assigned, ignoring case and spaces', () => {
    const feed = TestBed.inject(TicketFeedMockService);
    feed.add('CI-2026-000001', 1200);
    feed.add(' ci-2026-000001', 800);
    feed.add('CI-2026-000002', 500);
    expect(feed.forEnrollment('CI-2026-000001').map(t => t.netBushels)).toEqual([1200, 800]);
  });
});
