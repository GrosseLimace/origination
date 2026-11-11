import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { GrowthOpportunityComponent } from './growth-opportunity.component';
import { ProducerInsightsPanels } from '../producer-insights/producer-insights-panels.state';
import { AppStateService } from '@core/services/app-state.service';
import { Commodity, Contract, DashboardPlantingEstimate, Note, PlantingIntention } from '@models';
import { CustomerScreenSources, customerScreenSources } from '@testing/customer-screen-sources';

/**
 * The coverage arithmetic is tested in features/producers/utils/production-coverage.spec.ts. This covers what
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
  let fixture: ComponentFixture<GrowthOpportunityComponent>;
  let sources: CustomerScreenSources;

  /** Sets what the panel reads from the selected producer's data, by the name it reads it as. */
  function set(name: 'contracts' | 'notes' | 'plantingIntentions' | 'commodities' | 'yieldEstimates' | 'plantingYear', value: unknown): void {
    switch (name) {
      case 'contracts': sources.activity.contracts.set(value as Contract[]); break;
      case 'notes': sources.engagement.notes.set(value as Note[]); break;
      case 'plantingIntentions': sources.production.visiblePlantingIntentions.set(value as PlantingIntention[]); break;
      case 'commodities': TestBed.inject(AppStateService).setCommodities(value as Commodity[]); break;
      case 'yieldEstimates': sources.production.yieldEstimates.set(value as DashboardPlantingEstimate[]); break;
      case 'plantingYear': sources.production.selectedPlantingYear.set(value as number); break;
    }
  }

  beforeEach(() => {
    sources = customerScreenSources();
    TestBed.configureTestingModule({ providers: sources.providers });
    // happy-dom + JIT can't fetch templateUrl; the logic under test is class-level.
    TestBed.overrideComponent(GrowthOpportunityComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    fixture = TestBed.createComponent(GrowthOpportunityComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('status pill', () => {
    it('reads Needs Attention when there are no notes at all', () => {
      expect(component.daysSinceLastContact()).toBeNull();
      expect(component.statusLabel()).toBe('Needs Attention');
    });

    it('reads On Track within 30 days', () => {
      set('notes', [note(5)]);
      expect(component.statusLabel()).toBe('On Track');
    });

    it('reads Monitor past 30 days', () => {
      set('notes', [note(45)]);
      expect(component.statusLabel()).toBe('Monitor');
    });

    it('reads Needs Attention past 90 days', () => {
      set('notes', [note(120)]);
      expect(component.statusLabel()).toBe('Needs Attention');
    });

    it('uses the most recent note, not the first in the array', () => {
      set('notes', [note(200), note(3), note(90)]);
      expect(component.statusLabel()).toBe('On Track');
    });
  });

  describe('action items', () => {
    it('prompts for an introductory call when no notes exist', () => {
      expect(component.actionItems().some(i => i.includes('No notes logged yet'))).toBe(true);
    });

    it('prompts a follow-up when contact has gone stale', () => {
      set('notes', [note(45)]);
      expect(component.actionItems().some(i => i.includes('45 days ago'))).toBe(true);
    });

    it('surfaces uncontracted bushels with the real unit', () => {
      set('notes', [note(2)]);
      set('commodities', [{ id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }] as Commodity[]);
      set('plantingIntentions', [
        { id: 1, customerId: 100, plantingYear: 2026, crop: 'YC', acres: 1000 } as PlantingIntention,
      ]);
      set('yieldEstimates', [
        { id: 1, tradeUnitKey: 'TU1', crop: 'Corn', plantingYear: 2026, yieldEstimate: 180 } as DashboardPlantingEstimate,
      ]);
      set('contracts', [contract({ quantity: 50_000 })]);
      set('plantingYear', 2026);

      // 1000 ac x 180 = 180,000 projected; 50,000 contracted → 130,000 available.
      // Two decimals, matching how bushel quantities are shown everywhere else in the app.
      expect(component.actionItems().some(i => i.includes('130,000.00 bu'))).toBe(true);
    });

    it('flags contracts with delivery ending inside 30 days', () => {
      set('notes', [note(2)]);
      set('contracts', [contract({ deliveryEnd: new Date(Date.now() + 10 * DAY), status: 'Active' })]);
      expect(component.actionItems().some(i => i.includes('Review 1 contract'))).toBe(true);
    });

    it('falls back to a healthy message when nothing needs doing', () => {
      set('notes', [note(2)]);
      expect(component.actionItems()).toEqual([
        'Nothing outstanding — engagement is current and production is well covered.',
      ]);
    });
  });

  describe('crop-year picker', () => {
    it('picks the year on the profile, so both this panel and the Planting tab move', () => {
      component.selectYear(2025);

      expect(sources.production.selectPlantingYear).toHaveBeenCalledWith(2025);
    });

    it('scopes the coverage to the selected year', () => {
      set('commodities', [{ id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }] as Commodity[]);
      set('plantingIntentions', [
        { id: 1, customerId: 100, plantingYear: 2026, crop: 'YC', acres: 1000 } as PlantingIntention,
        { id: 2, customerId: 100, plantingYear: 2025, crop: 'YC', acres: 400 } as PlantingIntention,
      ]);
      set('yieldEstimates', [
        { id: 1, tradeUnitKey: 'TU1', crop: 'Corn', plantingYear: 2026, yieldEstimate: 180 } as DashboardPlantingEstimate,
        { id: 2, tradeUnitKey: 'TU1', crop: 'Corn', plantingYear: 2025, yieldEstimate: 150 } as DashboardPlantingEstimate,
      ]);

      set('plantingYear', 2026);
      expect(component.coverage().byCommodity[0].projectedYield).toBe(180_000);

      set('plantingYear', 2025);
      expect(component.coverage().byCommodity[0].projectedYield).toBe(60_000);   // 400 ac x 150
    });
  });

  it('reports when intentions exist but no yield estimate has been entered', () => {
    set('commodities', [{ id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }] as Commodity[]);
    set('plantingIntentions', [
      { id: 1, customerId: 100, plantingYear: 2026, crop: 'YC', acres: 1000 } as PlantingIntention,
    ]);
    set('yieldEstimates', []);
    set('plantingYear', 2026);

    expect(component.hasNoYieldEstimates()).toBe(true);
    expect(component.coverage().byCommodity[0].projectedYield).toBeNull();
  });

  describe('excluded-contracts note', () => {
    // A failed conversion load drops every non-bushel contract; the note must not blame their unit.
    it('blames the failed conversion load, not the unit, when conversions failed to load', () => {
      TestBed.inject(AppStateService).setCommodityConversionsLoadFailed(true);
      expect(component.conversionsUnavailable()).toBe(true);
    });

    it('keeps the unit explanation when conversions loaded', () => {
      expect(component.conversionsUnavailable()).toBe(false);
    });

    it('keeps the unit explanation once conversions are present, whatever the flag says', () => {
      const state = TestBed.inject(AppStateService);
      state.setCommodityConversionsLoadFailed(true);
      state.setCommodityConversions([{ commodityCode: 'SBM', lbsPerUnit: 2000 }]);
      expect(component.conversionsUnavailable()).toBe(false);
    });
  });
});

// Rendered through the real template: one of the three Insights panels, so it is there only while they are open.
describe('GrowthOpportunityComponent — open and closed', () => {
  it('shows nothing while the Producer Insights panels are closed', () => {
    TestBed.configureTestingModule({ providers: customerScreenSources().providers });
    const fixture = TestBed.createComponent(GrowthOpportunityComponent);
    const panels = TestBed.inject(ProducerInsightsPanels);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');

    panels.open.set(true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Growth Opportunity');
  });
});
