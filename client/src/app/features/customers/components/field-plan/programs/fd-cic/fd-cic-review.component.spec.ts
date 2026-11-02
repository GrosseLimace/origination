import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { FdCicData, FieldTickets } from '@models';
import { SUSTAINABILITY_PROGRAMS } from '../program-registry';
import { InMemoryFieldPlanBackend } from '../../store/in-memory-field-plan-backend';
import { FieldPlanStore } from '../../store/field-plan.store';
import { createFdCicProgram } from './fd-cic.program';
import { fakeFdCicApi } from './fd-cic.testing';
import { FdCicReviewComponent, yieldFromTickets } from './fd-cic-review.component';

describe('yieldFromTickets (the review\'s suggested actual yield)', () => {
  it('should be the included bushels over the field\'s acres, to one decimal', () => {
    expect(yieldFromTickets(24_000, 120)).toBe(200);
    expect(yieldFromTickets(20_000, 120)).toBe(166.7);
  });

  it('should suggest nothing without acres or bushels', () => {
    expect(yieldFromTickets(24_000, null)).toBeNull();
    expect(yieldFromTickets(24_000, 0)).toBeNull();
    expect(yieldFromTickets(0, 120)).toBeNull();
  });
});

describe('FdCicReviewComponent', () => {
  const api = fakeFdCicApi();
  const program = createFdCicProgram(api);
  let store: FieldPlanStore;
  let review: FdCicReviewComponent;

  /** Two weighed tickets and one with no bushel figure. */
  const tickets = (): FieldTickets => ({
    splitId: 'TATOB28', cropYear: 2026, cropGroup: 'corn', windowFrom: '2026-08-01', windowTo: '2027-07-31',
    tickets: [
      { ticketKey: 'P1', ticketNumber: 'P1', blDate: '2026-10-05', location: null, productCode: 'YC', contractNumber: null, cropYearMatch: 'window', netBushels: 12_000, settled: false, settledDate: null, status: 'Unload' },
      { ticketKey: 'P2', ticketNumber: 'P2', blDate: '2026-10-06', location: null, productCode: 'YC', contractNumber: null, cropYearMatch: 'window', netBushels: 12_000, settled: true, settledDate: '2026-11-01', status: 'Final Settled' },
      { ticketKey: 'P3', ticketNumber: 'P3', blDate: '2026-10-07', location: null, productCode: 'XX', contractNumber: null, cropYearMatch: 'window', netBushels: null, settled: false, settledDate: null, status: 'Unload' },
    ],
    others: [
      { ticketKey: 'E1', ticketNumber: 'E1', blDate: '2026-07-28', location: null, productCode: 'YC', contractNumber: null, cropYearMatch: 'other', note: 'BL date outside 8/1/26–7/31/27', netBushels: 6_000, settled: false, settledDate: null, status: 'Unload' },
      { ticketKey: 'E2', ticketNumber: 'E2', blDate: '2026-07-20', location: null, productCode: 'YC', contractNumber: null, cropYearMatch: 'other', confirmedFor: 2025, netBushels: 5_000, settled: true, settledDate: null, status: 'Final Settled' },
    ],
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [
      { provide: SUSTAINABILITY_PROGRAMS, useValue: [program] },
      { provide: FdCicApiService, useValue: api },
    ] });
    store = TestBed.inject(FieldPlanStore);
    vi.spyOn(TestBed.inject(InMemoryFieldPlanBackend), 'fieldTickets').mockResolvedValue(tickets());
    const field = (await store.createField({ splitId: 'TATOB28', customerId: 9, name: 'PENKA #1 IRR', splitPercent: 100, effectiveDate: '2018-10-01', state: 'KS', county: 'Pratt' }))!;
    const season = (await store.addSeason(field.fieldKey, 1, 2026, 'Corn', 120))!;
    const record = (await store.addRecord(season.id, program.key))!;
    store.updateRecord(record.id, { ...(record.data as FdCicData), expectedYield: 200, syntheticN: 180 });

    const fixture = TestBed.createComponent(FdCicReviewComponent);
    fixture.componentRef.setInput('recordId', record.id);
    fixture.detectChanges();
    review = fixture.componentInstance;
    await review.loadTickets();
  });

  it('should start with every weighed ticket included and the one with no bushel figure left out', () => {
    expect(review.included().map(t => t.ticketKey)).toEqual(['P1', 'P2']);
    expect(review.allIncluded()).toBe(true);
    expect(review.suggestedYield()).toBe(200);
  });

  it('should have the header box tick and untick only the weighed tickets', () => {
    review.toggleAll();
    expect(review.included()).toEqual([]);
    review.toggleAll();
    expect(review.included().map(t => t.ticketKey)).toEqual(['P1', 'P2']);
  });

  it('should not confirm with a ticket that has no bushel figure, nor a yield over the API\'s limit', () => {
    review.reviewed.set(true);
    review.toggle('P3');
    expect(review.blocker()).toContain('P3 has no bushel figure');

    review.toggle('P3');
    review.yieldTyped.set(2000);
    expect(review.blocker()).toContain('over 1000 bu/ac');
  });

  it('should add a ticket from outside the crop year, count it, and take it back out', () => {
    expect(review.addable().map(t => t.ticketKey)).toEqual(['E1', 'E2']);
    expect(review.canAdd(review.addable()[1])).toBe(false);
    expect(review.addNote(review.addable()[1])).toBe('Already in the 2025 confirmed CI');

    review.addTicket('E1');
    expect(review.included().map(t => t.ticketKey)).toEqual(['P1', 'P2', 'E1']);
    expect(review.suggestedYield()).toBe(250);
    expect(review.matchLabel(review.rows()[3])).toBe('added');

    review.removeAdded('E1');
    expect(review.included().map(t => t.ticketKey)).toEqual(['P1', 'P2']);
    expect(review.addable().map(t => t.ticketKey)).toEqual(['E1', 'E2']);
  });

  it('should confirm an added ticket as added', async () => {
    review.addTicket('E1');
    review.reviewed.set(true);
    await vi.waitFor(() => expect(review.blocker()).toBeNull());

    await review.confirm();

    expect(review.confirmed()?.tickets?.map(t => [t.ticketKey, t.cropYearMatch])).toEqual([['P1', 'window'], ['P2', 'window'], ['E1', 'added']]);
  });

  it('should read a null confirmedFor and note from the API as "not counted elsewhere"', async () => {
    const fromApi = tickets();
    fromApi.tickets = fromApi.tickets.map(t => ({ ...t, confirmedFor: null, note: null }));
    fromApi.others = fromApi.others!.map(t => ({ ...t, confirmedFor: t.confirmedFor ?? null }));
    vi.spyOn(TestBed.inject(InMemoryFieldPlanBackend), 'fieldTickets').mockResolvedValue(fromApi);
    await review.loadTickets();

    expect(review.included().map(t => t.ticketKey)).toEqual(['P1', 'P2']);
    expect(review.canAdd(review.addable()[0])).toBe(true);
    review.reviewed.set(true);
    expect(review.blocker() ?? '').not.toContain('confirmed CI');
  });

  it('should go back to the suggested yield when what was typed is cleared', () => {
    review.yieldTyped.set(180);
    expect(review.actualYield()).toBe(180);
    review.yieldTyped.set(null);
    expect(review.actualYield()).toBe(200);
  });
});
