import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';
import { FdCicData, FieldSeason, ProducerField } from '@models';
import { ToastService } from '@core/services/toast.service';
import { ProgramIntake, SustainabilityProgramDef } from '../programs/program-def';
import { SUSTAINABILITY_PROGRAMS } from '../programs/program-registry';
import { createFdCicProgram } from '../programs/fd-cic/fd-cic.program';
import { fakeFdCicApi } from '../programs/fd-cic/fd-cic.testing';
import { FIELD_PLAN_BACKEND, FieldPlanSnapshot } from './field-plan-backend';
import { InMemoryFieldPlanBackend } from './in-memory-field-plan-backend';
import { FieldPlanStore, SAVE_DEBOUNCE_MS } from './field-plan.store';

const FD_CIC_PROGRAM = createFdCicProgram(fakeFdCicApi());

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

describe('FieldPlanStore', () => {
  let store: FieldPlanStore;
  let backend: InMemoryFieldPlanBackend;
  let north: ProducerField;
  let corn: FieldSeason;

  const newField = async (name: string, fsaFieldNo: string, customerId = 9) =>
    (await store.createField({ customerId, name, fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo, state: 'KS', county: 'Pratt' }))!;

  const scored = (r: { data: unknown }, actualYield: number | null = null) =>
    ({ ...(r.data as FdCicData), expectedYield: 200, syntheticN: 180, actualYield });

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: SUSTAINABILITY_PROGRAMS, useValue: [FD_CIC_PROGRAM, WATER_PROGRAM] }] });
    store = TestBed.inject(FieldPlanStore);
    backend = TestBed.inject(InMemoryFieldPlanBackend);
    north = await newField('Penka #1 irrigated', '3');
    corn = (await store.addSeason(north.fieldKey, 1, 2026, 'Corn', 80))!;
  });

  afterEach(() => vi.useRealTimers());

  describe('fields and seasons', () => {
    it('should keep a field\'s name and FSA numbers, once, and reuse it on another crop row', async () => {
      expect(north).toMatchObject({ name: 'Penka #1 irrigated', fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '3' });
      await store.addSeason(north.fieldKey, 2, 2027, 'Soybeans', 80);
      expect(store.fieldsFor(9)).toHaveLength(1);
      expect(store.seasonsForIntention(2)).toHaveLength(1);
    });

    it('should find the field\'s most recent earlier season', async () => {
      await store.addSeason(north.fieldKey, 0, 2024, 'Corn', 70);
      await store.addSeason(north.fieldKey, 0, 2025, 'Soybeans', 75);
      expect(store.lastSeason(north.fieldKey, 2026)?.cropLabel).toBe('Soybeans');
      expect(store.lastSeason(north.fieldKey, 2025)?.acres).toBe(70);
    });

    it('should take a field off a crop row with its unfinalized programs', async () => {
      await store.addRecord(corn.id, WATER_PROGRAM.key);
      expect(await store.removeSeason(corn.id)).toBe(true);
      expect(store.seasonsForIntention(1)).toHaveLength(0);
      expect(store.forSeason(corn.id)).toHaveLength(0);
      expect((await backend.load(9)).records).toHaveLength(0);
    });
  });

  describe('program records and enrollments', () => {
    it('should hold two programs on one field season, each with its own data and its own enrollment ID', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      const w = (await store.addRecord(corn.id, WATER_PROGRAM.key))!;
      expect(store.forSeason(corn.id)).toHaveLength(2);
      expect((z.data as FdCicData).tillage).toBe('NoneOfTheAbove');
      expect(w.data).toEqual({ irrigatedInches: null, meterReading: null });
      expect(store.enrollmentFor(z)?.enrollmentId).toBe('CI-2026-000001');
      expect(store.enrollmentFor(w)?.enrollmentId).toBe('WS-2026-000001');
      expect((await store.addRecord(corn.id, WATER_PROGRAM.key))?.id).toBe(w.id);
    });

    it('should issue the enrollment ID with the first field, and put every later field in the same enrollment', async () => {
      const z1 = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      expect(store.enrollmentFor(z1)).toMatchObject({ enrollmentId: 'CI-2026-000001', status: 'Open' });
      const second = (await store.addSeason((await newField('Penka #2', '4')).fieldKey, 1, 2026, 'Corn', 120))!;
      const z2 = (await store.addRecord(second.id, FD_CIC_PROGRAM.key))!;
      expect(store.enrollmentFor(z2)?.enrollmentId).toBe('CI-2026-000001');
      expect(store.forEnrollment(store.enrollmentFor(z1)!).map(r => r.id)).toEqual([z1.id, z2.id]);

      const nextYear = (await store.addSeason(north.fieldKey, 2, 2027, 'Corn', 80))!;
      const next = (await store.addRecord(nextYear.id, FD_CIC_PROGRAM.key))!;
      expect(store.enrollmentFor(next)?.enrollmentId).toBe('CI-2027-000002');
    });

    it('should hold back the enrollment ID until a field in the program has its FSA numbers', async () => {
      const noFsa = (await store.createField({ customerId: 11, name: 'Rented 80', fsaFarmNo: '', fsaTractNo: '', fsaFieldNo: '', state: 'KS', county: 'Pratt' }))!;
      const season = (await store.addSeason(noFsa.fieldKey, 5, 2026, 'Corn', 80))!;
      const z = (await store.addRecord(season.id, FD_CIC_PROGRAM.key))!;
      expect(store.enrollmentFor(z)).toBeUndefined();
      expect(store.current(FD_CIC_PROGRAM.key, 11, 2026)).toBeUndefined();

      store.updateField({ ...noFsa, fsaFarmNo: '4321', fsaTractNo: '8765', fsaFieldNo: '1' });
      await store.ensureEnrollments(noFsa.fieldKey);
      expect(store.enrollmentFor(z)?.enrollmentId).toBe('CI-2026-000001');
    });

    it('should leave a field without FSA numbers out of the enrollment (and out of harvest complete)', async () => {
      const z1 = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      const noFsa = (await store.createField({ customerId: 9, name: 'Rented 80', fsaFarmNo: '4321', fsaTractNo: '', fsaFieldNo: '', state: 'KS', county: 'Pratt' }))!;
      const z2 = (await store.addRecord((await store.addSeason(noFsa.fieldKey, 1, 2026, 'Corn', 80))!.id, FD_CIC_PROGRAM.key))!;
      expect(store.forEnrollment(store.enrollmentFor(z1)!).map(r => r.id)).toEqual([z1.id]);
      expect(store.enrollmentFor(z2)).toBeUndefined();
    });

    it('should retire a withdrawn ID and issue a new one with the next program input', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      await store.withdraw(store.enrollmentFor(z)!.key, 'Producer enrolled elsewhere');
      expect(store.enrollmentFor(z)).toBeUndefined();
      expect(store.withdrawn(FD_CIC_PROGRAM.key, 9, 2026)[0]).toMatchObject({ enrollmentId: 'CI-2026-000001', withdrawnReason: 'Producer enrolled elsewhere' });
      const second = (await store.addSeason((await newField('Penka #2', '4')).fieldKey, 1, 2026, 'Corn', 120))!;
      const z2 = (await store.addRecord(second.id, FD_CIC_PROGRAM.key))!;
      expect(store.enrollmentFor(z2)?.enrollmentId).toBe('CI-2026-000002');
    });

    it('should copy forward from the field\'s last season in the same program', async () => {
      const last = (await store.addSeason(north.fieldKey, 0, 2025, 'Corn', 80))!;
      const prior = (await store.addRecord(last.id, WATER_PROGRAM.key))!;
      store.updateRecord(prior.id, { irrigatedInches: 8, meterReading: 999 });
      const copied = (await store.addRecord((await store.addSeason(north.fieldKey, 2, 2027, 'Corn', 80))!.id, WATER_PROGRAM.key))!;
      expect(copied.data).toEqual({ irrigatedInches: 8, meterReading: null });
      expect(copied.copiedFromYear).toBe(2025);
    });

    it('should not add a program to a crop it doesn\'t apply to', async () => {
      const wheat = (await store.addSeason(north.fieldKey, 3, 2026, 'Hard Red Winter Wheat', 40))!;
      expect(await store.addRecord(wheat.id, FD_CIC_PROGRAM.key)).toBeUndefined();
      expect(await store.addRecord(wheat.id, WATER_PROGRAM.key)).toBeDefined();
    });
  });

  describe('harvest complete, finalize and reopen', () => {
    it('should finalize every field with its actual yield, using the latest typed values, and leave the rest open', async () => {
      const z1 = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z1.id, scored(z1, 205)); // not saved yet: harvest complete saves it first
      const second = (await store.addSeason((await newField('Penka #2', '4')).fieldKey, 1, 2026, 'Corn', 120))!;
      const z2 = (await store.addRecord(second.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z2.id, scored(z2)); // no actual yield yet

      const leftOpen = await store.completeHarvest(store.enrollmentFor(z1)!);
      expect(store.record(z1.id)).toMatchObject({ status: 'Final', frozen: { finalizedBy: 'harvest complete', inputs: { actualYield: 205, fsaFieldNo: '3' } } });
      expect(leftOpen).toEqual([{ recordId: z2.id, missing: ['actual yield'] }]);
      expect(store.record(z2.id)?.status).toBe('Ready');
      expect(store.current(FD_CIC_PROGRAM.key, 9, 2026)?.harvestCompleteAt).toBeDefined();
      expect((await backend.load(9)).records.find(r => r.id === z1.id)?.status).toBe('Final');
    });

    it('should not touch another program\'s records when one enrollment\'s harvest is complete', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      const w = (await store.addRecord(corn.id, WATER_PROGRAM.key))!;
      store.updateRecord(w.id, { irrigatedInches: 6, meterReading: 1200 });
      await store.completeHarvest(store.enrollmentFor(z)!);
      expect(store.record(w.id)?.status).toBe('Ready');
    });

    it('should let the producer attest before harvest, and then block reopening a finalized field in it', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z.id, scored(z));
      const e = store.enrollmentFor(z)!;
      await store.updateAttestation({ ...e, attestation: { ...e.attestation, signerName: 'Pat', signedOn: '2026-05-02',
        confirmations: Object.fromEntries(FD_CIC_PROGRAM.enrollment!.statements.map(s => [s.key, true])) } });
      const listed = [{ recordId: z.id, seasonId: corn.id, fieldKey: north.fieldKey, fieldName: north.name, fsa: '1234/5678/3', cropLabel: 'Corn', year: 2026, acres: 80, status: 'Ready' as const }];
      expect((await store.attest(e.key, listed))?.status).toBe('Attested');

      store.updateRecord(z.id, scored(z, 205));
      await store.completeHarvest(store.enrollmentFor(z)!);
      expect(store.record(z.id)?.status).toBe('Final');
      expect(await store.reopen(z.id, 'Wrong yield')).toBe(false);
    });

    it('should reopen a finalized field that isn\'t attested, keep the reason and the old result, and reopen the harvest', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z.id, scored(z, 205));
      await store.completeHarvest(store.enrollmentFor(z)!);
      const frozen = store.record(z.id)!.frozen;

      expect(await store.reopen(z.id, 'Yield monitor was off')).toBe(true);
      expect(store.record(z.id)).toMatchObject({ status: 'Ready', reopened: [{ reason: 'Yield monitor was off', frozen }] });
      expect(store.record(z.id)?.frozen).toBeUndefined();
      expect(store.enrollmentFor(z)?.harvestCompleteAt).toBeUndefined();
      expect(await store.reopen(z.id, 'again')).toBe(false);
    });
  });

  describe('saving and loading', () => {
    it('should show an edit at once and save it once, after typing pauses, with the latest value', async () => {
      vi.useFakeTimers();
      const w = (await store.addRecord(corn.id, WATER_PROGRAM.key))!;
      const save = vi.spyOn(backend, 'updateRecord');
      for (const inches of [1, 12, 123]) store.updateRecord(w.id, { irrigatedInches: inches, meterReading: null });

      expect(store.record(w.id)).toMatchObject({ data: { irrigatedInches: 123 }, status: 'Ready' });
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(w.id, { irrigatedInches: 123, meterReading: null }, 'Ready');
    });

    it('should not save a finalized record\'s edits, and refuse them on the backend too', async () => {
      const w = (await store.addRecord(corn.id, WATER_PROGRAM.key))!;
      store.updateRecord(w.id, { irrigatedInches: 6, meterReading: 1200 });
      await store.completeHarvest(store.enrollmentFor(w)!);
      store.updateRecord(w.id, { irrigatedInches: 99, meterReading: 1 });
      expect(store.record(w.id)?.data).toEqual({ irrigatedInches: 6, meterReading: 1200 });
      await expect(backend.updateRecord(w.id, {}, 'Ready')).rejects.toThrow(/finalized/);
    });

    it('should say so and reload from the backend when a save fails', async () => {
      vi.useFakeTimers();
      const toast = vi.spyOn(TestBed.inject(ToastService), 'error');
      const w = (await store.addRecord(corn.id, WATER_PROGRAM.key))!;
      vi.spyOn(backend, 'updateRecord').mockRejectedValueOnce(new Error('Server unavailable'));
      store.updateRecord(w.id, { irrigatedInches: 4, meterReading: null });

      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('Server unavailable'));
      expect(store.record(w.id)?.data).toEqual({ irrigatedInches: null, meterReading: null });
    });

    it('should say so, change nothing, and keep the form\'s values when a structural change is refused', async () => {
      const toast = vi.spyOn(TestBed.inject(ToastService), 'error');
      vi.spyOn(backend, 'createField').mockRejectedValueOnce(new Error('Server unavailable'));
      expect(await store.createField({ customerId: 9, name: 'Back 40', fsaFarmNo: '', fsaTractNo: '', fsaFieldNo: '', state: 'KS', county: 'Pratt' })).toBeUndefined();
      expect(store.fieldsFor(9)).toHaveLength(1);
      expect(toast).toHaveBeenCalledWith('Couldn\'t add the field. Server unavailable');
    });

    it('should load a producer only when asked, once, with what the backend kept', async () => {
      // A fresh page: a new store over the same backend.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [
        { provide: SUSTAINABILITY_PROGRAMS, useValue: [FD_CIC_PROGRAM, WATER_PROGRAM] },
        { provide: FIELD_PLAN_BACKEND, useValue: backend },
      ] });
      const fresh = TestBed.inject(FieldPlanStore);
      const load = vi.spyOn(backend, 'load');
      expect(fresh.isLoaded(9)).toBe(false);
      expect(fresh.fieldsFor(9)).toEqual([]);

      fresh.ensureLoaded(9);
      fresh.ensureLoaded(9);
      await vi.waitFor(() => expect(fresh.isLoaded(9)).toBe(true));
      expect(load).toHaveBeenCalledTimes(1);
      expect(fresh.fieldsFor(9).map(f => f.name)).toEqual(['Penka #1 irrigated']);
      expect(fresh.seasonsForIntention(1)).toHaveLength(1);
    });

    it('should drop a slower, older load when a newer one has already landed', async () => {
      const slow = deferred<FieldPlanSnapshot>();
      const empty: FieldPlanSnapshot = { fields: [], seasons: [], records: [], enrollments: [] };
      vi.spyOn(backend, 'load').mockReturnValueOnce(slow.promise).mockResolvedValueOnce(empty);
      const first = store.reload(9);
      await store.reload(9);
      slow.resolve({ ...empty, fields: [{ ...north, name: 'Stale name' }] });
      await first;
      expect(store.fieldsFor(9)).toEqual([]);
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}
