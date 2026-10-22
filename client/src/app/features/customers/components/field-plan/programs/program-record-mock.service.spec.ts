import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { TicketFeedMockService } from '@core/services/ticket-feed-mock.service';
import { FdCicData, FieldSeason } from '@models';
import { ProgramIntake, SustainabilityProgramDef } from './program-def';
import { SUSTAINABILITY_PROGRAMS } from './program-registry';
import { ProgramRecordMockService } from './program-record-mock.service';
import { ProgramEnrollmentMockService } from './program-enrollment-mock.service';
import { FD_CIC_PROGRAM } from './fd-cic/fd-cic.program';

/**
 * A made-up second program, to prove a new program needs no change to the field, record, ticket or
 * enrollment code: it has its own data, takes its own figure from the tickets (a delivery count),
 * has its own score and attestation, and lives on the same field season as 45Z.
 */
interface WaterData { irrigatedInches: number | null; deliveries: number | null }
const WATER_PROGRAM: SustainabilityProgramDef<WaterData> = {
  key: 'water-test',
  label: 'Water stewardship (test)',
  shortLabel: 'Water',
  description: 'Test program',
  appliesTo: () => true,
  blankData: () => ({ irrigatedInches: null, deliveries: null }),
  copyForward: prior => ({ irrigatedInches: prior.irrigatedInches }),
  missing: d => (d.irrigatedInches === null ? ['irrigation'] : []),
  preview: d => (d.irrigatedInches === null ? null : { value: d.irrigatedInches, unit: 'in', unitShort: 'in' }),
  fromTickets: tickets => ({ deliveries: tickets.length || null }),
  finalizeMissing: d => [...(d.irrigatedInches === null ? ['irrigation'] : []), ...(d.deliveries === null ? ['deliveries'] : [])],
  freeze: d => ({ inputs: { ...d }, outputs: {}, score: { value: d.irrigatedInches!, unit: 'in', unitShort: 'in' }, calculatorVersion: 'water v0' }),
  intake: class {} as unknown as Type<ProgramIntake>,
  enrollment: { idPrefix: 'WS', statements: [{ key: 'metered', label: 'Water is metered.', short: 'metering confirmation' }], attestedNote: '' },
};

describe('ProgramRecordMockService (prototype)', () => {
  let plan: FieldPlanMockService;
  let records: ProgramRecordMockService;
  let enrollments: ProgramEnrollmentMockService;
  let tickets: TicketFeedMockService;
  let corn: FieldSeason;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: SUSTAINABILITY_PROGRAMS, useValue: [FD_CIC_PROGRAM, WATER_PROGRAM] }] });
    plan = TestBed.inject(FieldPlanMockService);
    records = TestBed.inject(ProgramRecordMockService);
    enrollments = TestBed.inject(ProgramEnrollmentMockService);
    tickets = TestBed.inject(TicketFeedMockService);
    const north = plan.createField({ splitId: 'TATOB28', customerId: 9, name: 'PENKA #1 IRR', splitPercent: 50, effectiveDate: '2024-09-01', state: 'KS', county: 'Pratt' });
    corn = plan.addSeason(north.fieldKey, 1, 2026, 'Corn', 80);
  });

  const scored = (r: { data: unknown }) => ({ ...(r.data as FdCicData), expectedYield: 200, syntheticN: 180 });

  it('should hold two programs on one field season, each with its own data and its own enrollment ID', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    const w = records.add(corn.id, WATER_PROGRAM.key)!;
    expect(records.forSeason(corn.id)).toHaveLength(2);
    expect((z.data as FdCicData).tillage).toBe('NoneOfTheAbove');
    expect(w.data).toEqual({ irrigatedInches: null, deliveries: null });
    expect(records.enrollmentFor(z)?.enrollmentId).toBe('CI-2026-000001');
    expect(records.enrollmentFor(w)?.enrollmentId).toBe('WS-2026-000001');
    // Adding the same program twice returns the existing record.
    expect(records.add(corn.id, WATER_PROGRAM.key)?.id).toBe(w.id);
  });

  it('should issue the enrollment ID with the first field, and put every later field in the same enrollment', () => {
    const z1 = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    expect(records.enrollmentFor(z1)).toMatchObject({ enrollmentId: 'CI-2026-000001', status: 'Open' });

    const south = plan.createField({ splitId: 'TATOB30', customerId: 9, name: 'PENKA #2 IRR', splitPercent: 100, effectiveDate: '2025-09-01', state: 'KS', county: 'Pratt' });
    const z2 = records.add(plan.addSeason(south.fieldKey, 1, 2026, 'Corn', 120).id, FD_CIC_PROGRAM.key)!;
    expect(records.enrollmentFor(z2)?.enrollmentId).toBe('CI-2026-000001');

    // Another year, or another producer, gets its own ID.
    const next = records.add(plan.addSeason(corn.fieldKey, 2, 2027, 'Corn', 80).id, FD_CIC_PROGRAM.key)!;
    expect(records.enrollmentFor(next)?.enrollmentId).toBe('CI-2027-000002');
  });

  it('should retire a withdrawn ID and issue a new one with the next program input', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    enrollments.withdraw(records.enrollmentFor(z)!.key, 'Producer enrolled elsewhere');
    expect(records.enrollmentFor(z)).toBeUndefined();
    const south = plan.createField({ splitId: 'TATOB30', customerId: 9, name: 'PENKA #2 IRR', splitPercent: 100, effectiveDate: '2025-09-01', state: 'KS', county: 'Pratt' });
    const z2 = records.add(plan.addSeason(south.fieldKey, 1, 2026, 'Corn', 120).id, FD_CIC_PROGRAM.key)!;
    expect(records.enrollmentFor(z2)?.enrollmentId).toBe('CI-2026-000002');
    expect(enrollments.withdrawn(FD_CIC_PROGRAM.key, 9, 2026)[0].enrollmentId).toBe('CI-2026-000001');
  });

  it('should take 45Z actual yield from the tickets under the split, live', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    tickets.add('TATOB28', 2026, 9000, 'CI-2026-000001');
    tickets.add('TATOB28', 2026, 7400, 'CI-2026-000001');
    tickets.add('TATOB30', 2026, 5000, 'CI-2026-000001'); // another split: not this field
    records.syncTickets(corn.id);
    expect((records.record(z.id)!.data as FdCicData).actualYield).toBe(205); // 16,400 bu ÷ 80 ac
  });

  it('should finalize every complete program when harvest is marked complete, and leave incomplete ones open', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    const w = records.add(corn.id, WATER_PROGRAM.key)!;
    records.update({ ...z, data: scored(z) });
    tickets.add('TATOB28', 2026, 16400, 'CI-2026-000001');

    const leftOpen = records.completeHarvest(corn.id);
    expect(records.record(z.id)).toMatchObject({ status: 'Final', frozen: { finalizedBy: 'CTRM tickets', inputs: { splitId: 'TATOB28', actualYield: 205 } } });
    expect(leftOpen).toEqual([{ programKey: WATER_PROGRAM.key, missing: ['irrigation'] }]);
    expect(records.record(w.id)?.status).toBe('Draft');
    expect(tickets.isHarvestComplete('TATOB28', 2026)).toBe(true);
  });

  it('should let the producer attest before harvest, and then block reopening a finalized field in it', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    records.update({ ...z, data: scored(z) });
    const e = records.enrollmentFor(z)!;
    enrollments.update({ ...e, attestation: { ...e.attestation, signerName: 'Pat', signedOn: '2026-05-02',
      confirmations: Object.fromEntries(FD_CIC_PROGRAM.enrollment.statements.map(s => [s.key, true])) } });
    const listed = [{ recordId: z.id, seasonId: corn.id, fieldKey: 'TATOB28', fieldName: 'PENKA #1 IRR', cropLabel: 'Corn', year: 2026, acres: 80, status: 'Ready' as const }];
    expect(enrollments.attest(e.key, listed)?.status).toBe('Attested');

    tickets.add('TATOB28', 2026, 16400, 'CI-2026-000001');
    records.completeHarvest(corn.id);
    expect(records.reopen(z.id)).toBe(false);
  });

  it('should reopen a finalized field that isn\'t attested, and reopen the split\'s harvest with it', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    records.update({ ...z, data: scored(z) });
    tickets.add('TATOB28', 2026, 16400, 'CI-2026-000001');
    records.completeHarvest(corn.id);
    expect(records.reopen(z.id)).toBe(true);
    expect(records.record(z.id)?.status).toBe('Ready');
    expect(tickets.isHarvestComplete('TATOB28', 2026)).toBe(false);
  });

  it('should copy forward from the field\'s last season in the same program', () => {
    const last = plan.addSeason(corn.fieldKey, 0, 2025, 'Corn', 80);
    const prior = records.add(last.id, WATER_PROGRAM.key)!;
    records.update({ ...prior, data: { irrigatedInches: 8, deliveries: 3 } });
    const copied = records.add(plan.addSeason(corn.fieldKey, 2, 2027, 'Corn', 80).id, WATER_PROGRAM.key)!;
    expect(copied.data).toEqual({ irrigatedInches: 8, deliveries: null });
    expect(copied.copiedFromYear).toBe(2025);
  });

  it('should not add a program to a crop it doesn\'t apply to', () => {
    const wheat = plan.addSeason(corn.fieldKey, 3, 2026, 'Hard Red Winter Wheat', 40);
    expect(records.add(wheat.id, FD_CIC_PROGRAM.key)).toBeUndefined();
    expect(records.add(wheat.id, WATER_PROGRAM.key)).toBeDefined();
  });
});
