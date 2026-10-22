import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { FdCicData, FieldSeason } from '@models';
import { ProgramIntake, SustainabilityProgramDef } from './program-def';
import { SUSTAINABILITY_PROGRAMS } from './program-registry';
import { ProgramRecordMockService } from './program-record-mock.service';
import { ProgramEnrollmentMockService } from './program-enrollment-mock.service';
import { FD_CIC_PROGRAM } from './fd-cic/fd-cic.program';

/**
 * A made-up second program, to prove a new program needs no change to the field, record or
 * enrollment code: it has its own data, its own finalize input, its own score and its own
 * attestation, and lives on the same field season as 45Z.
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
  finalizeInputs: [{ key: 'meterReading', label: 'Meter reading' }],
  finalizeMissing: d => [...(d.irrigatedInches === null ? ['irrigation'] : []), ...(d.meterReading === null ? ['meter reading'] : [])],
  freeze: d => ({ inputs: { ...d }, outputs: {}, score: { value: d.irrigatedInches!, unit: 'in', unitShort: 'in' }, calculatorVersion: 'water v0' }),
  finalizeStatement: () => 'ok',
  intake: class {} as unknown as Type<ProgramIntake>,
  enrollment: { idPrefix: 'WS', statements: [{ key: 'metered', label: 'Water is metered.', short: 'metering confirmation' }], attestedNote: '' },
};

describe('ProgramRecordMockService (prototype)', () => {
  let plan: FieldPlanMockService;
  let records: ProgramRecordMockService;
  let enrollments: ProgramEnrollmentMockService;
  let corn: FieldSeason;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: SUSTAINABILITY_PROGRAMS, useValue: [FD_CIC_PROGRAM, WATER_PROGRAM] }] });
    plan = TestBed.inject(FieldPlanMockService);
    records = TestBed.inject(ProgramRecordMockService);
    enrollments = TestBed.inject(ProgramEnrollmentMockService);
    const north = plan.createField({ customerId: 9, name: 'North 80', state: 'KS', county: 'Pratt' });
    corn = plan.addSeason(north.fieldKey, 1, 2026, 'Corn', 80);
  });

  it('should hold two programs on one field season, each with its own data', () => {
    const z = records.add(corn.id, FD_CIC_PROGRAM.key)!;
    const w = records.add(corn.id, WATER_PROGRAM.key)!;
    expect(records.forSeason(corn.id)).toHaveLength(2);
    expect((z.data as FdCicData).tillage).toBe('NoneOfTheAbove');
    expect(w.data).toEqual({ irrigatedInches: null, meterReading: null });
    // Adding the same program twice returns the existing record.
    expect(records.add(corn.id, WATER_PROGRAM.key)?.id).toBe(w.id);
  });

  it('should move Draft → Ready from the program\'s own rules, and finalize one program without the other', () => {
    const w = records.add(corn.id, WATER_PROGRAM.key)!;
    records.add(corn.id, FD_CIC_PROGRAM.key);
    records.update({ ...w, data: { irrigatedInches: 6, meterReading: null } });
    expect(records.record(w.id)?.status).toBe('Ready');

    expect(records.finalize(w.id, {})).toBe(false); // meter reading still missing
    expect(records.finalize(w.id, { meterReading: 1200 })).toBe(true);
    expect(records.record(w.id)).toMatchObject({ status: 'Final', frozen: { calculatorVersion: 'water v0', score: { value: 6 } } });
    expect(records.find(corn.id, FD_CIC_PROGRAM.key)?.status).toBe('Draft');
    expect(records.hasFinal(corn.id)).toBe(true);
  });

  it('should copy forward from the field\'s previous season in the same program', () => {
    const last = plan.addSeason(corn.fieldKey, 0, 2025, 'Corn', 80);
    const prior = records.add(last.id, WATER_PROGRAM.key)!;
    records.update({ ...prior, data: { irrigatedInches: 8, meterReading: 999 } });
    const next = plan.addSeason(corn.fieldKey, 2, 2027, 'Corn', 80);
    const copied = records.add(next.id, WATER_PROGRAM.key)!;
    expect(copied.data).toEqual({ irrigatedInches: 8, meterReading: null });
    expect(copied.copiedFromYear).toBe(2025);
  });

  it('should enroll each program separately, with its own ID prefix and statements, and lock its records', () => {
    const w = records.add(corn.id, WATER_PROGRAM.key)!;
    records.update({ ...w, data: { irrigatedInches: 6, meterReading: null } });
    records.finalize(w.id, { meterReading: 1200 });
    const listed = [{ recordId: w.id, seasonId: corn.id, fieldKey: corn.fieldKey, fieldName: 'North 80', cropLabel: 'Corn', year: 2026, acres: 80, status: 'Final' as const }];

    const draft = enrollments.start(WATER_PROGRAM.key, 9, 2026, [w.id]);
    expect(enrollments.blockers(draft, listed)).toContain('metering confirmation');
    enrollments.update({ ...draft, attestation: { ...draft.attestation, signerName: 'Pat', signedOn: '2026-11-02', confirmations: { metered: true } } });
    expect(enrollments.attest(draft.key, listed)?.enrollmentId).toBe('WS-2026-000001');

    expect(records.reopen(w.id)).toBe(false);
    expect(enrollments.current(FD_CIC_PROGRAM.key, 9, 2026)).toBeUndefined();
  });

  it('should not add a program to a crop it doesn\'t apply to', () => {
    const wheat = plan.addSeason(corn.fieldKey, 3, 2026, 'Hard Red Winter Wheat', 40);
    expect(records.add(wheat.id, FD_CIC_PROGRAM.key)).toBeUndefined();
    expect(records.add(wheat.id, WATER_PROGRAM.key)).toBeDefined();
  });
});
