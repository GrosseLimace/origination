import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { FdCicData, FieldSeason, ProducerField } from '@models';
import { ProgramIntake, SustainabilityProgramDef } from './program-def';
import { SUSTAINABILITY_PROGRAMS } from './program-registry';
import { ProgramRecordMockService } from './program-record-mock.service';
import { ProgramEnrollmentMockService } from './program-enrollment-mock.service';
import { FD_CIC_PROGRAM } from './fd-cic/fd-cic.program';

/**
 * A made-up second program, to prove a new program needs no change to the field, record or
 * enrollment code: its own data, its own score and attestation, no delivery reconciliation, and it
 * lives on the same field season as 45Z.
 */
interface WaterData { irrigatedInches: number | null; meterReading: number | null }
const WATER_PROGRAM: SustainabilityProgramDef<WaterData> = {
  key: 'water-test',
  label: 'Water stewardship (test)',
  shortLabel: 'Water',
  description: 'Test program',
  appliesTo: () => true,
  blankData: () => ({ irrigatedInches: null, meterReading: null }),
  copyForward: prior => ({ irrigatedInches: prior.irrigatedInches }),
  missing: d => (d.irrigatedInches === null ? ['irrigation'] : []),
  preview: d => (d.irrigatedInches === null ? null : { value: d.irrigatedInches, unit: 'in', unitShort: 'in' }),
  finalizeMissing: d => [...(d.irrigatedInches === null ? ['irrigation'] : []), ...(d.meterReading === null ? ['meter reading'] : [])],
  freeze: d => ({ inputs: { ...d }, outputs: {}, score: { value: d.irrigatedInches!, unit: 'in', unitShort: 'in' }, calculatorVersion: 'water v0' }),
  intake: class {} as unknown as Type<ProgramIntake>,
  enrollment: { idPrefix: 'WS', statements: [{ key: 'metered', label: 'Water is metered.', short: 'metering confirmation' }], attestedNote: '' },
};

describe('ProgramRecordMockService (prototype)', () => {
  let plan: FieldPlanMockService;
  let records: ProgramRecordMockService;
  let enrollments: ProgramEnrollmentMockService;
  let north: ProducerField;
  let corn: FieldSeason;

  const newField = (name: string, fsaFieldNo: string) =>
    plan.createField({ customerId: 9, name, fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo, state: 'KS', county: 'Pratt' });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: SUSTAINABILITY_PROGRAMS, useValue: [FD_CIC_PROGRAM, WATER_PROGRAM] }] });
    plan = TestBed.inject(FieldPlanMockService);
    records = TestBed.inject(ProgramRecordMockService);
    enrollments = TestBed.inject(ProgramEnrollmentMockService);
    north = newField('Penka #1 irrigated', '3');
    corn = plan.addSeason(north.fieldKey, 1, 2026, 'Corn', 80);
  });

  const scored = (r: { data: unknown }, actualYield: number | null = null) =>
    ({ ...(r.data as FdCicData), expectedYield: 200, syntheticN: 180, actualYield });

  it('should hold two programs on one field season, each with its own data and its own enrollment ID', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    const w = records.add(corn.id, WATER_PROGRAM.key)!;
    expect(records.forSeason(corn.id)).toHaveLength(2);
    expect((z.data as FdCicData).tillage).toBe('NoneOfTheAbove');
    expect(w.data).toEqual({ irrigatedInches: null, meterReading: null });
    expect(records.enrollmentFor(z)?.enrollmentId).toBe('CI-2026-000001');
    expect(records.enrollmentFor(w)?.enrollmentId).toBe('WS-2026-000001');
    expect(records.add(corn.id, WATER_PROGRAM.key)?.id).toBe(w.id);
  });

  it('should issue the enrollment ID with the first field, and put every later field in the same enrollment', () => {
    const z1 = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    expect(records.enrollmentFor(z1)).toMatchObject({ enrollmentId: 'CI-2026-000001', status: 'Open' });
    const z2 = records.add(plan.addSeason(newField('Penka #2', '4').fieldKey, 1, 2026, 'Corn', 120).id, FD_CIC_PROGRAM.key)!;
    expect(records.enrollmentFor(z2)?.enrollmentId).toBe('CI-2026-000001');
    expect(records.forEnrollment(records.enrollmentFor(z1)!).map(r => r.id)).toEqual([z1.id, z2.id]);

    const next = records.add(plan.addSeason(north.fieldKey, 2, 2027, 'Corn', 80).id, FD_CIC_PROGRAM.key)!;
    expect(records.enrollmentFor(next)?.enrollmentId).toBe('CI-2027-000002');
  });

  it('should retire a withdrawn ID and issue a new one with the next program input', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    enrollments.withdraw(records.enrollmentFor(z)!.key, 'Producer enrolled elsewhere');
    expect(records.enrollmentFor(z)).toBeUndefined();
    const z2 = records.add(plan.addSeason(newField('Penka #2', '4').fieldKey, 1, 2026, 'Corn', 120).id, FD_CIC_PROGRAM.key)!;
    expect(records.enrollmentFor(z2)?.enrollmentId).toBe('CI-2026-000002');
  });

  it('should finalize every field with its actual yield when the enrollment\'s harvest is complete, and leave the rest open', () => {
    const z1 = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    records.update({ ...z1, data: scored(z1, 205) });
    const z2 = records.add(plan.addSeason(newField('Penka #2', '4').fieldKey, 1, 2026, 'Corn', 120).id, FD_CIC_PROGRAM.key)!;
    records.update({ ...z2, data: scored(z2) }); // no actual yield yet

    const e = records.enrollmentFor(z1)!;
    const leftOpen = records.completeHarvest(e);
    expect(records.record(z1.id)).toMatchObject({ status: 'Final', frozen: { finalizedBy: 'harvest complete', inputs: { actualYield: 205, fsaFieldNo: '3' } } });
    expect(leftOpen).toEqual([{ recordId: z2.id, missing: ['actual yield'] }]);
    expect(records.record(z2.id)?.status).toBe('Ready');
    expect(enrollments.current(FD_CIC_PROGRAM.key, 9, 2026)?.harvestCompleteAt).toBeDefined();
  });

  it('should not touch another program\'s records when one enrollment\'s harvest is complete', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    const w = records.add(corn.id, WATER_PROGRAM.key)!;
    records.update({ ...w, data: { irrigatedInches: 6, meterReading: 1200 } });
    records.completeHarvest(records.enrollmentFor(z)!);
    expect(records.record(w.id)?.status).toBe('Ready');
  });

  it('should let the producer attest before harvest, and then block reopening a finalized field in it', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    records.update({ ...z, data: scored(z) });
    const e = records.enrollmentFor(z)!;
    enrollments.update({ ...e, attestation: { ...e.attestation, signerName: 'Pat', signedOn: '2026-05-02',
      confirmations: Object.fromEntries(FD_CIC_PROGRAM.enrollment.statements.map(s => [s.key, true])) } });
    const listed = [{ recordId: z.id, seasonId: corn.id, fieldKey: north.fieldKey, fieldName: north.name, fsa: '1234/5678/3', cropLabel: 'Corn', year: 2026, acres: 80, status: 'Ready' as const }];
    expect(enrollments.attest(e.key, listed)?.status).toBe('Attested');

    records.update({ ...records.record(z.id)!, data: scored(z, 205) });
    records.completeHarvest(records.enrollmentFor(z)!);
    expect(records.record(z.id)?.status).toBe('Final');
    expect(records.reopen(z.id)).toBe(false);
  });

  it('should reopen a finalized field that isn\'t attested, and reopen the enrollment\'s harvest with it', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    records.update({ ...z, data: scored(z, 205) });
    records.completeHarvest(records.enrollmentFor(z)!);
    expect(records.reopen(z.id)).toBe(true);
    expect(records.record(z.id)?.status).toBe('Ready');
    expect(records.enrollmentFor(z)?.harvestCompleteAt).toBeUndefined();
  });

  it('should copy forward from the field\'s last season in the same program', () => {
    const last = plan.addSeason(north.fieldKey, 0, 2025, 'Corn', 80);
    const prior = records.add(last.id, WATER_PROGRAM.key)!;
    records.update({ ...prior, data: { irrigatedInches: 8, meterReading: 999 } });
    const copied = records.add(plan.addSeason(north.fieldKey, 2, 2027, 'Corn', 80).id, WATER_PROGRAM.key)!;
    expect(copied.data).toEqual({ irrigatedInches: 8, meterReading: null });
    expect(copied.copiedFromYear).toBe(2025);
  });

  it('should not add a program to a crop it doesn\'t apply to', () => {
    const wheat = plan.addSeason(north.fieldKey, 3, 2026, 'Hard Red Winter Wheat', 40);
    expect(records.add(wheat.id, FD_CIC_PROGRAM.key)).toBeUndefined();
    expect(records.add(wheat.id, WATER_PROGRAM.key)).toBeDefined();
  });
});
