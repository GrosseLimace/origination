import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';
import { FdCicData } from '../../../models/carbon-intensity.model';
import { FieldSeason, ProducerField } from '../../../models/field-plan.model';
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
 * summary code: its own data, its own score, and it
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
  freeze: d => ({ inputs: { ...d }, outputs: {}, score: { value: d.irrigatedInches!, unit: 'in', unitShort: 'in' }, calculatorVersion: 'water v0' }),
  intake: class {} as unknown as Type<ProgramIntake>,
  enrollment: { idPrefix: 'WS' },
};

describe('FieldPlanStore', () => {
  let store: FieldPlanStore;
  let backend: InMemoryFieldPlanBackend;
  let north: ProducerField;
  let corn: FieldSeason;

  /** One of the producer's CTRM splits made a field. */
  const split = (splitId: string, name: string, customerId = 9) =>
    ({ splitId, customerId, name, splitPercent: 100, effectiveDate: '2018-10-01', state: 'KS', county: 'Pratt' });
  const newField = async (name: string, splitId: string, customerId = 9) => (await store.createField(split(splitId, name, customerId)))!;

  const scored = (r: { data: unknown }, actualYield: number | null = null) =>
    ({ ...(r.data as FdCicData), expectedYield: 200, syntheticN: 180, actualYield });

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: SUSTAINABILITY_PROGRAMS, useValue: [FD_CIC_PROGRAM, WATER_PROGRAM] }] });
    store = TestBed.inject(FieldPlanStore);
    backend = TestBed.inject(InMemoryFieldPlanBackend);
    north = await newField('PENKA #1 IRR', 'TATOB28');
    corn = (await store.addSeason(north.fieldKey, 1, 2026, 'Corn', 80))!;
  });

  afterEach(() => vi.useRealTimers());

  // Audit 2026-11-05: the lists were public WritableSignals, so any component could change them without
  // the save that goes with it. Only the store's own methods may write them now.
  it('should expose its fields, seasons and records read-only', () => {
    for (const list of [store.fields, store.seasons, store.records]) {
      expect('set' in list).toBe(false);
      expect('update' in list).toBe(false);
    }
  });

  describe('fields and seasons', () => {
    it('should key a field by its CTRM split ID, once, and reuse it on another crop row', async () => {
      expect(north).toMatchObject({ fieldKey: 'TATOB28', splitId: 'TATOB28', name: 'PENKA #1 IRR', splitPercent: 100 });
      expect(await store.createField(split('tatob28', 'PENKA #1 IRR'))).toEqual(north);
      expect(store.fieldsFor(9)).toHaveLength(1);
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

    it('should take a field off a crop row with its unlocked programs', async () => {
      await store.addRecord(corn.id, WATER_PROGRAM.key);
      expect(await store.removeSeason(corn.id)).toBe(true);
      expect(store.seasonsForIntention(1)).toHaveLength(0);
      expect(store.forSeason(corn.id)).toHaveLength(0);
      expect((await backend.load(9)).records).toHaveLength(0);
    });
  });

  describe('program records', () => {
    it('should hold two programs on one field season, each with its own data and its own enrollment ID', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      const w = (await store.addRecord(corn.id, WATER_PROGRAM.key))!;
      expect(store.forSeason(corn.id)).toHaveLength(2);
      expect((z.data as FdCicData).tillage).toBe('NoneOfTheAbove');
      expect(w.data).toEqual({ irrigatedInches: null, meterReading: null });
      expect(store.enrollmentIdOf(z)).toBe('CI-2026-TATOB28');
      expect(store.enrollmentIdOf(w)).toBe('WS-2026-TATOB28');
      expect((await store.addRecord(corn.id, WATER_PROGRAM.key))?.id).toBe(w.id);
    });

    it('should give each field its own derived ID per crop year, with no producer-level enrollment to create', async () => {
      const z1 = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      const second = (await store.addSeason((await newField('PENKA #2', 'TATOB29')).fieldKey, 1, 2026, 'Corn', 120))!;
      const z2 = (await store.addRecord(second.id, FD_CIC_PROGRAM.key))!;
      expect([store.enrollmentIdOf(z1), store.enrollmentIdOf(z2)]).toEqual(['CI-2026-TATOB28', 'CI-2026-TATOB29']);

      const nextYear = (await store.addSeason(north.fieldKey, 2, 2027, 'Corn', 80))!;
      const next = (await store.addRecord(nextYear.id, FD_CIC_PROGRAM.key))!;
      expect(store.enrollmentIdOf(next)).toBe('CI-2027-TATOB28');
    });

    it('should refuse to make one producer\'s split another producer\'s field', async () => {
      const toast = vi.spyOn(TestBed.inject(ToastService), 'error');
      expect(await store.createField(split('TATOB28', 'PENKA #1 IRR', 11))).toBeUndefined();
      expect(toast).toHaveBeenCalledWith('Couldn\'t add the field. Split TATOB28 is another producer\'s field.');
    });

    it('should copy forward from the field\'s last season in the same program', async () => {
      const last = (await store.addSeason(north.fieldKey, 0, 2025, 'Corn', 80))!;
      const prior = (await store.addRecord(last.id, WATER_PROGRAM.key))!;
      store.updateRecord(prior.id, { irrigatedInches: 8, meterReading: 999 });
      const copied = (await store.addRecord((await store.addSeason(north.fieldKey, 2, 2027, 'Corn', 80))!.id, WATER_PROGRAM.key))!;
      expect(copied.data).toEqual({ irrigatedInches: 8, meterReading: null });
      expect(copied.copiedFromYear).toBe(2025);
    });

    it('should not put a field on a second row of the same crop in a year, so its tickets are never counted twice', async () => {
      expect(await store.addSeason(north.fieldKey, 1, 2026, 'Corn', 80)).toBeUndefined();
      expect(await store.addSeason(north.fieldKey, 4, 2026, 'Dryland Corn', 40)).toBeUndefined();
      expect(await store.addSeason(north.fieldKey, 2, 2026, 'Soybeans', 40)).toBeDefined();
      expect(await store.addSeason(north.fieldKey, 5, 2027, 'Corn', 80)).toBeDefined();
    });

    it('should leave out a ticket with no bushel figure: confirming with it is refused', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z.id, scored(z));
      const tickets = (await store.fieldTickets(z.id)).tickets;
      vi.spyOn(backend, 'fieldTickets').mockResolvedValue({
        splitId: 'TATOB28', cropYear: 2026, cropGroup: 'corn', windowFrom: '2026-08-01', windowTo: '2027-07-31',
        tickets: [{ ...tickets[0], netBushels: null }],
      });

      expect(await store.confirm(z.id, 205, [tickets[0].ticketKey], { tDiscPasses: null, recordkeepingReviewed: true })).toBeUndefined();
      expect(store.record(z.id)?.status).toBe('Ready');
    });

    it('should not add a program to a crop it doesn\'t apply to', async () => {
      const wheat = (await store.addSeason(north.fieldKey, 3, 2026, 'Hard Red Winter Wheat', 40))!;
      expect(await store.addRecord(wheat.id, FD_CIC_PROGRAM.key)).toBeUndefined();
      expect(await store.addRecord(wheat.id, WATER_PROGRAM.key)).toBeDefined();
    });
  });

  describe('confirm and reopen', () => {
    /** Confirms a 45Z field with every ticket the review offers, as the originator would. */
    const confirmAll = async (id: string, actualYield: number) =>
      store.confirm(id, actualYield, (await store.fieldTickets(id)).tickets.map(t => t.ticketKey), { tDiscPasses: null, recordkeepingReviewed: true });

    it('should lock a confirmed field with the latest typed values and the confirmed CI as its official result', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z.id, scored(z)); // not saved yet: confirming saves it first

      await confirmAll(z.id, 205);
      expect(store.record(z.id)).toMatchObject({ status: 'Locked', frozen: { basis: 'Estimate', inputs: { actualYield: 205, splitId: 'TATOB28' } } });
      expect(store.record(z.id)?.official?.status).toBe('Documented');
      expect((await backend.load(9)).records.find(r => r.id === z.id)?.status).toBe('Locked');
    });

    it('should reopen (unlock) a confirmed field with a reason, keeping the reason, the estimate and the confirmed CI', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z.id, scored(z));
      await confirmAll(z.id, 205);
      const { frozen, official } = store.record(z.id)!;

      expect(await store.reopen(z.id, '  ')).toBe(false);
      expect(store.record(z.id)?.status).toBe('Locked');
      expect(await store.reopen(z.id, 'Yield monitor was off')).toBe(true);
      expect(store.record(z.id)).toMatchObject({ status: 'Ready', reopened: [{ reason: 'Yield monitor was off', frozen, official }] });
      expect(store.record(z.id)?.frozen).toBeUndefined();
      expect(store.record(z.id)?.official).toBeUndefined();
      expect(await store.reopen(z.id, 'again')).toBe(false);
    });
  });

  describe('copying inputs between fields', () => {
    const practices = (r: { data: unknown }, actualYield: number | null = null): FdCicData =>
      ({ ...scored(r, actualYield), tillage: 'NoTill', coverCrop: 'CoverCrop', niFraction: 0.5 });

    it('should copy every input but the actual yield onto a field of the same crop, and keep that field\'s actual yield', async () => {
      const z1 = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z1.id, practices(z1, 205));
      const second = (await store.addSeason((await newField('PENKA #2', 'TATOB29')).fieldKey, 1, 2026, 'Corn', 120))!;
      const z2 = (await store.addRecord(second.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z2.id, { ...(z2.data as FdCicData), actualYield: 190 });

      expect(store.copySources(second.id, FD_CIC_PROGRAM.key).map(c => c.fieldName)).toEqual(['PENKA #1 IRR']);
      expect(store.copyTargets(z1.id)).toEqual([{ seasonId: second.id, fieldName: 'PENKA #2', cropLabel: 'Corn', effect: 'replace' }]);
      expect(await store.copyInputs(z1.id, [second.id])).toEqual({ copied: 1, skipped: 0 });

      expect(store.record(z2.id)).toMatchObject({
        status: 'Ready', copiedFromField: 'PENKA #1 IRR',
        data: { expectedYield: 200, syntheticN: 180, tillage: 'NoTill', coverCrop: 'CoverCrop', niFraction: 0.5, actualYield: 190 },
      });
      expect(store.record(z1.id)?.copiedFromField).toBeUndefined();
      expect((await backend.load(9)).records.find(r => r.id === z2.id)?.copiedFromField).toBe('PENKA #1 IRR');
    });

    it('should copy only tillage and cover crop onto another crop, and add the program where it\'s missing', async () => {
      const z1 = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z1.id, practices(z1));
      const soy = (await store.addSeason((await newField('WEST 80', 'TATOB31')).fieldKey, 2, 2026, 'Soybeans', 80))!;
      const corn2 = (await store.addSeason((await newField('PENKA #2', 'TATOB29')).fieldKey, 1, 2026, 'Corn', 120))!;

      expect(store.copyTargets(z1.id).map(t => [t.fieldName, t.effect])).toEqual([['PENKA #2', 'empty'], ['WEST 80', 'partial']]);
      expect(await store.copyInputs(z1.id, [soy.id, corn2.id])).toEqual({ copied: 2, skipped: 0 });

      expect(store.find(soy.id, FD_CIC_PROGRAM.key)?.data).toMatchObject({ tillage: 'NoTill', coverCrop: 'CoverCrop', syntheticN: null, niFraction: 0 });
      expect(store.find(soy.id, FD_CIC_PROGRAM.key)?.status).toBe('Draft');
      expect(store.find(corn2.id, FD_CIC_PROGRAM.key)).toMatchObject({ status: 'Ready', data: { syntheticN: 180, niFraction: 0.5 } });
    });

    it('should only offer the producer\'s other fields in the same year', async () => {
      const z1 = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      const nextYear = (await store.addSeason(north.fieldKey, 2, 2027, 'Corn', 80))!;
      await store.addRecord(nextYear.id, FD_CIC_PROGRAM.key);
      const neighbour = (await store.addSeason((await newField('NEIGHBOUR', 'SMITH01', 11)).fieldKey, 7, 2026, 'Corn', 80))!;
      await store.addRecord(neighbour.id, FD_CIC_PROGRAM.key);

      expect(store.copySources(corn.id, FD_CIC_PROGRAM.key)).toEqual([]);
      expect(store.copyTargets(z1.id)).toEqual([]);
      expect(await store.copyInputs(z1.id, [nextYear.id, neighbour.id, corn.id])).toEqual({ copied: 0, skipped: 3 });
    });

    it('should list a locked field as locked and never copy onto it', async () => {
      const z1 = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z1.id, practices(z1));
      const second = (await store.addSeason((await newField('PENKA #2', 'TATOB29')).fieldKey, 1, 2026, 'Corn', 120))!;
      const z2 = (await store.addRecord(second.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z2.id, scored(z2, 210));
      await store.confirm(z2.id, 210, (await store.fieldTickets(z2.id)).tickets.map(t => t.ticketKey), { tDiscPasses: null, recordkeepingReviewed: true });
      expect(store.record(z2.id)?.status).toBe('Locked');

      expect(store.copyTargets(z1.id)).toEqual([{ seasonId: second.id, fieldName: 'PENKA #2', cropLabel: 'Corn', effect: 'locked' }]);
      expect(await store.copyInputs(z1.id, [second.id])).toEqual({ copied: 0, skipped: 1 });
      expect(store.record(z2.id)?.data).toMatchObject({ tillage: 'NoneOfTheAbove', actualYield: 210 });
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

    it('should not save a locked record\'s edits, and refuse them on the backend too', async () => {
      const z = (await store.addRecord(corn.id, FD_CIC_PROGRAM.key))!;
      store.updateRecord(z.id, scored(z));
      await store.confirm(z.id, 205, (await store.fieldTickets(z.id)).tickets.map(t => t.ticketKey), { tDiscPasses: null, recordkeepingReviewed: true });
      const kept = store.record(z.id)?.data;
      store.updateRecord(z.id, scored(z, 1));
      expect(store.record(z.id)?.data).toEqual(kept);
      await expect(backend.updateRecord(z.id, {}, 'Ready')).rejects.toThrow(/confirmed/);
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
      expect(await store.createField(split('TATOB30', 'BACK 40'))).toBeUndefined();
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
      expect(fresh.fieldsFor(9).map(f => f.name)).toEqual(['PENKA #1 IRR']);
      expect(fresh.seasonsForIntention(1)).toHaveLength(1);
    });

    it('should drop a slower, older load when a newer one has already landed', async () => {
      const slow = deferred<FieldPlanSnapshot>();
      const empty: FieldPlanSnapshot = { fields: [], seasons: [], records: [] };
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
