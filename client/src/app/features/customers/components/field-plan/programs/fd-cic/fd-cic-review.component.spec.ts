import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { TDiscApiService } from '@core/services/tdisc-api.service';
import { FdCicData, FieldTickets, TDiscPass } from '@models';
import { fakeTDiscApi } from './fd-cic-tdisc.testing';
import { SUSTAINABILITY_PROGRAMS } from '../program-registry';
import { InMemoryFieldPlanBackend } from '../../store/in-memory-field-plan-backend';
import { FieldPlanStore } from '../../store/field-plan.store';
import { createFdCicProgram } from './fd-cic.program';
import { fakeFdCicApi } from './fd-cic.testing';
import { FdCicReviewComponent, yieldFromTickets } from './fd-cic-review.component';
import { ticketMatchLabel } from './review/review-ticket-table.component';

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
  let recordId: string;

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
      { provide: TDiscApiService, useValue: fakeTDiscApi() },
    ] });
    store = TestBed.inject(FieldPlanStore);
    vi.spyOn(TestBed.inject(InMemoryFieldPlanBackend), 'fieldTickets').mockResolvedValue(tickets());
    const field = (await store.createField({ splitId: 'TATOB28', customerId: 9, name: 'PENKA #1 IRR', splitPercent: 100, effectiveDate: '2018-10-01', state: 'KS', county: 'Pratt' }))!;
    const season = (await store.addSeason(field.fieldKey, 1, 2026, 'Corn', 120))!;
    const record = (await store.addRecord(season.id, program.key))!;
    recordId = record.id;
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
    expect(ticketMatchLabel(review.rows()[3])).toBe('added');

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

  it('should leave a cleared yield empty, and go back to the suggestion only on reset', () => {
    review.yieldTyped.set(180);
    expect(review.actualYield()).toBe(180);
    review.yieldTyped.set(null);
    expect(review.actualYield()).toBeNull();
    review.yieldTyped.set(undefined);
    expect(review.actualYield()).toBe(200);
  });

  /** Sets the field's tillage and opens a fresh review on it. */
  async function reviewWithTillage(tillage: FdCicData['tillage']): Promise<FdCicReviewComponent> {
    store.updateRecord(recordId, { ...(store.record(recordId)!.data as FdCicData), tillage });
    const fixture = TestBed.createComponent(FdCicReviewComponent);
    fixture.componentRef.setInput('recordId', recordId);
    fixture.detectChanges();
    await fixture.componentInstance.loadTickets();
    return fixture.componentInstance;
  }

  it('should skip the T-DISC step when the tillage is None of the above', () => {
    expect(review.needsTDisc()).toBe(false);
    expect(review.stepBlocker(2)).toBeNull();
    expect(review.canOpen(3)).toBe(true);
  });

  it('should open each step only once the steps before it are done', async () => {
    expect(review.step()).toBe(1);
    await vi.waitFor(() => expect(review.canOpen(4)).toBe(true));
    expect(review.canOpen(5)).toBe(false);
    expect(review.blocker()).toContain('record requirements');

    review.toggleAll();
    expect(review.canOpen(4)).toBe(false);
    expect(review.stepBlocker(3)).toContain('Include at least one ticket');
    review.next();
    review.next();
    review.next();
    expect(review.step()).toBe(3);
  });

  it('should hold the tickets-and-yield step on a yield the API would refuse', async () => {
    await vi.waitFor(() => expect(review.stepBlocker(3)).toBeNull());
    review.yieldTyped.set(2000);
    expect(review.stepBlocker(3)).toContain('over 1000 bu/ac');
  });

  const noTillPasses: TDiscPass[] = [{ window: 'Planting', implement: 'PLANTER, NO-TILL' }, { window: 'Harvest', implement: 'HARVEST, GRAIN' }];
  /** 0.1422: a field cultivator after a coil-tine harrow, reduced till. */
  const reducedTillPasses: TDiscPass[] = [
    { window: 'Field_Preparation', implement: 'CULTIVATOR, FIELD' }, { window: 'Field_Preparation', implement: 'HARROW, COILED TINES' },
    { window: 'Harvest', implement: 'HARVEST, GRAIN' },
  ];

  it('should need T-DISC passes for no till, and rescore at the tillage their rating supports', async () => {
    const noTill = await reviewWithTillage('NoTill');
    expect(noTill.needsTDisc()).toBe(true);
    expect(noTill.stepBlocker(2)).toContain('passes');
    expect(noTill.canOpen(3)).toBe(false);
    expect(noTill.isDone(3)).toBe(false); // tickets are in, but T-DISC before them isn't

    noTill.setPasses(reducedTillPasses);
    expect(noTill.tDiscRating()).toBeCloseTo(0.1422, 12);
    expect(noTill.confirmedTillage()).toBe('ReducedTill');
    expect(noTill.tillageStepsDown()).toBe(true);
    expect(noTill.recordkeeping().map(g => g.key)).not.toContain('noTill');

    noTill.setPasses(noTillPasses);
    expect(noTill.tillageStepsDown()).toBe(false);
    expect(noTill.tDiscSupportsNoTill()).toBe(false); // already no till
    expect(noTill.recordkeeping().map(g => g.key)).toContain('noTill');
    expect(noTill.stepBlocker(2)).toBeNull();

    noTill.setPasses([{ window: 'Harvest', implement: 'PLOW, CHISEL' }]);
    expect(noTill.tDiscRating()).toBeNull();
    expect(noTill.stepBlocker(2)).toContain('harvest');
  });

  it('should keep reduced till when the passes rate as no till, and say so', async () => {
    const reduced = await reviewWithTillage('ReducedTill');
    reduced.setPasses(reducedTillPasses);
    expect(reduced.tDiscSupportsNoTill()).toBe(false);

    reduced.setPasses(noTillPasses);
    expect(reduced.confirmedTillage()).toBe('ReducedTill');
    expect(reduced.tDiscSupportsNoTill()).toBe(true);
  });

  it('should change the tillage to no till from the review only once the producer meets the no-till rules', async () => {
    const reduced = await reviewWithTillage('ReducedTill');
    reduced.setPasses(noTillPasses);

    reduced.switchToNoTill();
    expect((store.record(recordId)!.data as FdCicData).tillage).toBe('ReducedTill');

    reduced.noTillPromised.set(true);
    reduced.switchToNoTill();
    const data = store.record(recordId)!.data as FdCicData;
    expect(data.tillage).toBe('NoTill');
    expect(data.tDiscPasses).toEqual(noTillPasses);
    expect(reduced.estimateTillage()).toBe('NoTill');
    expect(reduced.confirmedTillage()).toBe('NoTill');
    expect(reduced.tDiscSupportsNoTill()).toBe(false);
    expect(reduced.recordkeeping().map(g => g.key)).toContain('noTill');
  });

  it('should save the passes with the field\'s data, so reopening the review keeps them', async () => {
    const first = await reviewWithTillage('NoTill');
    first.setPasses(noTillPasses);

    expect((store.record(recordId)!.data as FdCicData).tDiscPasses).toEqual(noTillPasses);
    const reopened = TestBed.createComponent(FdCicReviewComponent);
    reopened.componentRef.setInput('recordId', recordId);
    reopened.detectChanges();
    expect(reopened.componentInstance.tDiscPasses()).toEqual(noTillPasses);
  });

  it('should confirm a no-till field at reduced till when its passes only support that, with the worksheet', async () => {
    const noTill = await reviewWithTillage('NoTill');
    noTill.setPasses(reducedTillPasses);
    noTill.reviewed.set(true);
    await vi.waitFor(() => expect(noTill.blocker()).toBeNull());

    await noTill.confirm();

    const tDisc = noTill.confirmed()?.tDisc;
    expect(tDisc).toMatchObject({ designation: 'Reduced till', estimatedTillage: 'No till', confirmedTillage: 'Reduced till', version: 'USDA T-DISC v1.1.1' });
    expect(tDisc?.rating).toBeCloseTo(0.1422, 12);
    expect(tDisc?.passes?.map(p => p.implement)).toEqual(['HARVEST, GRAIN', 'HARROW, COILED TINES', 'CULTIVATOR, FIELD']);
    expect(noTill.confirmed()?.recordkeepingAcknowledged).toBe(true);
    const data = store.record(recordId)!.data as FdCicData;
    expect(data.tillage).toBe('ReducedTill');
    expect(data.tDiscPasses).toEqual(reducedTillPasses);
    expect(noTill.estimateTillage()).toBe('NoTill');
    expect(noTill.tDiscResult()?.designation).toBe('RT');
  });
});
