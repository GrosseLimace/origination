import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { GrowthOpportunityComponent } from './growth-opportunity.component';
import { Commodity, Contract, Customer, DashboardPlantingEstimate, Note, PlantingIntention } from '@models';

/**
 * The coverage arithmetic is tested in shared/utils/production-coverage.spec.ts. This covers what
 * the component adds on top: the status pill thresholds and the action items — which replaced a
 * hardcoded sentence and an unreachable "revenue opportunity" line that could never render.
 */
const DAY = 24 * 60 * 60 * 1000;

function note(daysAgo: number): Note {
  return { id: 1, customerId: 100, content: 'x', createdAt: new Date(Date.now() - daysAgo * DAY) } as Note;
}

function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 100, farmId: '', contractNumber: 'C1', commodityCode: 'YC',
    quantity: 50_000, unit: 'bu', price: 0, cropYear: 2026,
    deliveryStart: new Date('2026-10-01'), deliveryEnd: new Date('2026-11-30'),
    status: 'Active', signed: true, ...over,
  } as Contract;
}

describe('GrowthOpportunityComponent', () => {
  let component: GrowthOpportunityComponent;
  let ref: ComponentRef<GrowthOpportunityComponent>;
  let fixture: ComponentFixture<GrowthOpportunityComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    // happy-dom + JIT can't fetch templateUrl; the logic under test is class-level.
    TestBed.overrideComponent(GrowthOpportunityComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    fixture = TestBed.createComponent(GrowthOpportunityComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', { id: 100, name: 'Acme' } as Customer);
    ref.setInput('contracts', []);
    ref.setInput('notes', []);
    ref.setInput('plantingIntentions', []);
    fixture.detectChanges();
  });

  describe('status pill', () => {
    it('reads Needs Attention when there are no notes at all', () => {
      expect(component.daysSinceLastContact()).toBeNull();
      expect(component.statusLabel()).toBe('Needs Attention');
    });

    it('reads On Track within 30 days', () => {
      ref.setInput('notes', [note(5)]);
      expect(component.statusLabel()).toBe('On Track');
    });

    it('reads Monitor past 30 days', () => {
      ref.setInput('notes', [note(45)]);
      expect(component.statusLabel()).toBe('Monitor');
    });

    it('reads Needs Attention past 90 days', () => {
      ref.setInput('notes', [note(120)]);
      expect(component.statusLabel()).toBe('Needs Attention');
    });

    it('uses the most recent note, not the first in the array', () => {
      ref.setInput('notes', [note(200), note(3), note(90)]);
      expect(component.statusLabel()).toBe('On Track');
    });
  });

  describe('action items', () => {
    it('prompts for an introductory call when no notes exist', () => {
      expect(component.actionItems().some(i => i.includes('No notes logged yet'))).toBe(true);
    });

    it('prompts a follow-up when contact has gone stale', () => {
      ref.setInput('notes', [note(45)]);
      expect(component.actionItems().some(i => i.includes('45 days ago'))).toBe(true);
    });

    it('surfaces uncontracted bushels with the real unit', () => {
      ref.setInput('notes', [note(2)]);
      ref.setInput('commodities', [{ id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }] as Commodity[]);
      ref.setInput('plantingIntentions', [
        { id: 1, customerId: 100, plantingYear: 2026, crop: 'YC', acres: 1000 } as PlantingIntention,
      ]);
      ref.setInput('yieldEstimates', [
        { id: 1, tradeUnitKey: 'TU1', crop: 'Corn', plantingYear: 2026, yieldEstimate: 180 } as DashboardPlantingEstimate,
      ]);
      ref.setInput('contracts', [contract({ quantity: 50_000 })]);
      ref.setInput('plantingYear', 2026);

      // 1000 ac x 180 = 180,000 projected; 50,000 contracted → 130,000 available.
      // Two decimals, matching how bushel quantities are shown everywhere else in the app.
      expect(component.actionItems().some(i => i.includes('130,000.00 bu'))).toBe(true);
    });

    it('flags contracts with delivery ending inside 30 days', () => {
      ref.setInput('notes', [note(2)]);
      ref.setInput('contracts', [contract({ deliveryEnd: new Date(Date.now() + 10 * DAY), status: 'Active' })]);
      expect(component.actionItems().some(i => i.includes('Review 1 contract'))).toBe(true);
    });

    it('falls back to a healthy message when nothing needs doing', () => {
      ref.setInput('notes', [note(2)]);
      expect(component.actionItems()).toEqual([
        'Nothing outstanding — engagement is current and production is well covered.',
      ]);
    });
  });

  describe('crop-year picker', () => {
    it('emits the selected year so the profile can move both this panel and the Planting tab', () => {
      const emitted: number[] = [];
      component.yearSelect.subscribe(y => emitted.push(y));

      component.yearSelect.emit(2025);

      expect(emitted).toEqual([2025]);
    });

    it('scopes the coverage to the selected year', () => {
      ref.setInput('commodities', [{ id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }] as Commodity[]);
      ref.setInput('plantingIntentions', [
        { id: 1, customerId: 100, plantingYear: 2026, crop: 'YC', acres: 1000 } as PlantingIntention,
        { id: 2, customerId: 100, plantingYear: 2025, crop: 'YC', acres: 400 } as PlantingIntention,
      ]);
      ref.setInput('yieldEstimates', [
        { id: 1, tradeUnitKey: 'TU1', crop: 'Corn', plantingYear: 2026, yieldEstimate: 180 } as DashboardPlantingEstimate,
        { id: 2, tradeUnitKey: 'TU1', crop: 'Corn', plantingYear: 2025, yieldEstimate: 150 } as DashboardPlantingEstimate,
      ]);

      ref.setInput('plantingYear', 2026);
      expect(component.coverage().byCommodity[0].projectedYield).toBe(180_000);

      ref.setInput('plantingYear', 2025);
      expect(component.coverage().byCommodity[0].projectedYield).toBe(60_000);   // 400 ac x 150
    });
  });

  it('reports when intentions exist but no yield estimate has been entered', () => {
    ref.setInput('commodities', [{ id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }] as Commodity[]);
    ref.setInput('plantingIntentions', [
      { id: 1, customerId: 100, plantingYear: 2026, crop: 'YC', acres: 1000 } as PlantingIntention,
    ]);
    ref.setInput('yieldEstimates', []);
    ref.setInput('plantingYear', 2026);

    expect(component.hasNoYieldEstimates()).toBe(true);
    expect(component.coverage().byCommodity[0].projectedYield).toBeNull();
  });
});
