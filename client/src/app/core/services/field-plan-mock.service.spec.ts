import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FieldPlanMockService } from './field-plan-mock.service';
import { CtrmSplitMockService } from './ctrm-split-mock.service';
import { TicketFeedMockService } from './ticket-feed-mock.service';

const CUSTOMER = 9;

describe('FieldPlanMockService (prototype)', () => {
  let plan: FieldPlanMockService;

  beforeEach(() => {
    plan = TestBed.inject(FieldPlanMockService);
  });

  function field(splitId: string, name: string) {
    return plan.createField({ splitId, customerId: CUSTOMER, name, splitPercent: 100, effectiveDate: '2024-09-01', state: 'KS', county: 'Pratt' });
  }

  it('should key a field by its CTRM split ID, once per split', () => {
    const north = field('TATOB28', 'PENKA #1 IRR');
    expect(north.fieldKey).toBe('TATOB28');
    expect(field('TATOB28', 'something else')).toBe(north);
    expect(plan.fieldsFor(CUSTOMER)).toHaveLength(1);
  });

  it('should reuse a field on another crop row and find its most recent earlier season', () => {
    const north = field('TATOB28', 'PENKA #1 IRR');
    plan.addSeason(north.fieldKey, 1, 2024, 'Corn', 70);
    plan.addSeason(north.fieldKey, 2, 2025, 'Soybeans', 80);
    expect(plan.lastSeason(north.fieldKey, 2026)?.cropLabel).toBe('Soybeans');
    expect(plan.lastSeason(north.fieldKey, 2025)?.acres).toBe(70);
  });

  it('should hold only generic season data', () => {
    const s = plan.addSeason(field('TATOB28', 'PENKA #1 IRR').fieldKey, 1, 2026, 'Corn', 80);
    expect(Object.keys(s).sort()).toEqual(['acres', 'cropLabel', 'fieldKey', 'id', 'plantingIntentionId', 'year']);
  });
});

describe('CtrmSplitMockService (prototype)', () => {
  it('should list a producer\'s splits from their CTRM code, including a bin site and an expired split', () => {
    const splits = TestBed.inject(CtrmSplitMockService).splitsFor({ scoularId: 'TATOBIN', name: 'T-A Tobin Farms LC' });
    expect(splits[0]).toMatchObject({ splitId: 'TATOB01', primaryCustomerId: 'TATOBIN', name: 'T-A TOBIN FARMS LC - NORTH 80', kind: 'Field' });
    expect(splits.some(s => s.kind === 'Bin')).toBe(true);
    expect(splits.some(s => s.expired)).toBe(true);
    expect(new Set(splits.map(s => s.splitId)).size).toBe(splits.length);
  });
});

describe('TicketFeedMockService (prototype)', () => {
  it('should keep tickets per split and year, and harvest complete per split and year', () => {
    const feed = TestBed.inject(TicketFeedMockService);
    feed.add('TATOB28', 2026, 1200, 'CI-2026-000001');
    feed.add('TATOB28', 2025, 900, 'CI-2025-000004');
    expect(feed.forSplit('TATOB28', 2026).map(t => t.netBushels)).toEqual([1200]);
    feed.setHarvestComplete('TATOB28', 2026, true);
    expect(feed.isHarvestComplete('TATOB28', 2026)).toBe(true);
    expect(feed.isHarvestComplete('TATOB28', 2025)).toBe(false);
  });
});
