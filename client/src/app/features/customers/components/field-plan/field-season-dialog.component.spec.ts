import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, Type, input } from '@angular/core';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { TDiscApiService } from '@core/services/tdisc-api.service';
import { ToastService } from '@core/services/toast.service';
import { FdCicData, FieldProgramRecord, FieldSeason, ProducerField } from '@models';
import { ProgramIntake, SustainabilityProgramDef } from './programs/program-def';
import { SUSTAINABILITY_PROGRAMS } from './programs/program-registry';
import { createFdCicProgram } from './programs/fd-cic/fd-cic.program';
import { fakeFdCicApi } from './programs/fd-cic/fd-cic.testing';
import { fakeTDiscApi } from './programs/fd-cic/fd-cic-tdisc.testing';
import { FeedstockReportService } from './programs/fd-cic/feedstock-report.service';
import { InMemoryFieldPlanBackend } from './store/in-memory-field-plan-backend';
import { FieldPlanStore } from './store/field-plan.store';
import { FieldSeasonDialogComponent } from './field-season-dialog.component';

/** The FD-CIC states and counties the dialog offers for a field's location. */
const fdCicApi = () => Object.assign(fakeFdCicApi(), {
  states: () => ['KS', 'NE'],
  counties: (state: string) => (state === 'KS' ? ['Pratt', 'Reno'] : ['Hall']),
});
const FD_CIC_PROGRAM = createFdCicProgram(fakeFdCicApi());

/** A bare form for the made-up program: the dialog only hands it its inputs. */
@Component({ selector: 'app-water-intake', standalone: true, template: '' })
class WaterIntakeStub implements ProgramIntake {
  readonly record = input.required<FieldProgramRecord>();
  readonly season = input.required<FieldSeason>();
  readonly field = input.required<ProducerField>();
  readonly disabled = input(false);
}

/** A made-up second program with no official result or enrollment ID, to prove the dialog is generic. */
interface WaterData { irrigatedInches: number | null }
const WATER_PROGRAM: SustainabilityProgramDef<WaterData> = {
  key: 'water-test',
  label: 'Water stewardship (test)',
  shortLabel: 'Water',
  description: 'Test program',
  appliesTo: () => true,
  blankData: () => ({ irrigatedInches: null }),
  copyForward: prior => ({ irrigatedInches: prior.irrigatedInches }),
  missing: d => (d.irrigatedInches === null ? ['irrigation'] : []),
  preview: d => (d.irrigatedInches === null ? null : { value: d.irrigatedInches, unit: 'in', unitShort: 'in' }),
  freeze: d => ({ inputs: { ...d }, outputs: {}, score: { value: d.irrigatedInches!, unit: 'in', unitShort: 'in' }, calculatorVersion: 'water v0' }),
  intake: WaterIntakeStub as Type<ProgramIntake>,
};

/** Whitespace dropped: the markup breaks lines inside sentences. */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('FieldSeasonDialogComponent', () => {
  let store: FieldPlanStore;
  let backend: InMemoryFieldPlanBackend;
  let toast: ToastService;
  let reports: { download: ReturnType<typeof vi.fn> };
  let field: ProducerField;
  let season: FieldSeason;

  /** One of the producer's CTRM splits made a field, on a 2026 corn row. */
  const newSeason = async (splitId: string, name: string, acres = 80) => {
    const f = (await store.createField({ splitId, customerId: 9, name, splitPercent: 100, effectiveDate: '2018-10-01', state: 'KS', county: 'Pratt' }))!;
    const s = (await store.addSeason(f.fieldKey, 1, 2026, 'Corn', acres))!;
    return { field: f, season: s };
  };
  /** Gives a 45Z record the inputs it needs to be scored. */
  const score = (record: FieldProgramRecord) =>
    store.updateRecord(record.id, { ...(record.data as FdCicData), expectedYield: 200, syntheticN: 180 });
  /** Confirms a scored 45Z field with one of its (in-memory) tickets, which locks it. */
  const confirm = (record: FieldProgramRecord) =>
    store.confirm(record.id, 200, [`${field.splitId}-2026-1`], { tDiscPasses: null, recordkeepingReviewed: true });

  const open = (inputs: { seasonId?: string; startProgram?: string; producer?: { code: string; name: string } } = {}) => {
    const fixture = TestBed.createComponent(FieldSeasonDialogComponent);
    fixture.componentRef.setInput('seasonId', inputs.seasonId ?? season.id);
    if (inputs.startProgram) fixture.componentRef.setInput('startProgram', inputs.startProgram);
    if (inputs.producer) fixture.componentRef.setInput('producer', inputs.producer);
    fixture.detectChanges();
    return fixture;
  };
  const text = (fixture: ComponentFixture<FieldSeasonDialogComponent>) => squash((fixture.nativeElement as HTMLElement).textContent!);

  beforeEach(async () => {
    reports = { download: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({ providers: [
      { provide: SUSTAINABILITY_PROGRAMS, useValue: [FD_CIC_PROGRAM, WATER_PROGRAM] },
      { provide: FdCicApiService, useValue: fdCicApi() },
      { provide: TDiscApiService, useValue: fakeTDiscApi() },
      { provide: FeedstockReportService, useValue: reports },
    ] });
    store = TestBed.inject(FieldPlanStore);
    backend = TestBed.inject(InMemoryFieldPlanBackend);
    toast = TestBed.inject(ToastService);
    ({ field, season } = await newSeason('TATOB28', 'PENKA #1 IRR'));
  });

  it('should title the dialog with the field, year, crop, split and location, and offer every program that applies', () => {
    const fixture = open();

    expect(text(fixture)).toContain('PENKA #1 IRR · 2026');
    expect(text(fixture)).toContain('Corn · Split TATOB28 · Pratt County, KS');
    expect(fixture.componentInstance.addable().map(d => d.key)).toEqual([FD_CIC_PROGRAM.key, WATER_PROGRAM.key]);
    expect(fixture.componentInstance.active()).toBeNull();
    expect(text(fixture)).toContain('Add a program to record this field\'s sustainability data.');
  });

  it('should emit close when Done is clicked', () => {
    const fixture = open();
    const closed = vi.fn();
    fixture.componentInstance.close.subscribe(closed);

    const done = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(b => b.textContent!.trim() === 'Done')!;
    done.click();

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('should save a hand-typed field name and the season\'s acres to the store', async () => {
    const dialog = open().componentInstance;

    dialog.draftField!.name = 'PENKA NORTH';
    dialog.saveField();
    dialog.draftSeason!.acres = 95;
    dialog.saveSeason();

    expect(store.field(field.fieldKey)?.name).toBe('PENKA NORTH');
    expect(store.season(season.id)?.acres).toBe(95);
    await store.flush();
  });

  it('should not save a split share that isn\'t a real share (0, or over 100)', () => {
    const dialog = open().componentInstance;

    for (const share of [0, -5, 100.5]) {
      dialog.draftField = { ...dialog.draftField!, name: 'NOT SAVED', splitPercent: share };
      dialog.saveField();
    }

    expect(store.field(field.fieldKey)).toMatchObject({ name: 'PENKA #1 IRR', splitPercent: 100 });
  });

  it('should open straight onto the program it was started on, adding it to the field with its enrollment ID', async () => {
    const fixture = open({ startProgram: FD_CIC_PROGRAM.key });
    await vi.waitFor(() => expect(store.find(season.id, FD_CIC_PROGRAM.key)).toBeDefined());
    fixture.detectChanges();

    const dialog = fixture.componentInstance;
    expect(dialog.active()?.record.programKey).toBe(FD_CIC_PROGRAM.key);
    expect(dialog.addable().map(d => d.key)).toEqual([WATER_PROGRAM.key]);
    expect(dialog.enrollmentId()).toBe('CI-2026-TATOB28');
    expect(text(fixture)).toContain('Enrollment CI-2026-TATOB28');
  });

  it('should show a program with no enrollment ID without one, and say a 45Z review waits for an estimated CI', async () => {
    const dialog = open().componentInstance;
    await dialog.addProgram(WATER_PROGRAM.key);
    expect(dialog.active()?.record.programKey).toBe(WATER_PROGRAM.key);
    expect(dialog.enrollmentId()).toBe('');

    const water = store.find(season.id, WATER_PROGRAM.key)!;
    const fdCic = (await store.addRecord(season.id, FD_CIC_PROGRAM.key))!;
    expect(dialog.canReview(water)).toBe(false);
    expect(dialog.canReview(fdCic)).toBe(false);
    expect(dialog.officialStatus(fdCic)).toBe('not confirmed');

    score(fdCic);
    expect(dialog.canReview(store.record(fdCic.id)!)).toBe(true);
    await store.flush();
  });

  it('should leave the program off and say why when the backend refuses to add it', async () => {
    vi.spyOn(backend, 'addRecord').mockRejectedValue(new Error('The server is down.'));
    const error = vi.spyOn(toast, 'error');
    const dialog = open().componentInstance;

    await dialog.addProgram(WATER_PROGRAM.key);

    expect(store.forSeason(season.id)).toEqual([]);
    expect(dialog.activeKey()).toBeNull();
    expect(error).toHaveBeenCalledWith('Couldn\'t add the program. The server is down.');
  });

  it('should take an unlocked program off the field', async () => {
    const dialog = open().componentInstance;
    await dialog.addProgram(WATER_PROGRAM.key);

    await dialog.removeProgram();

    expect(store.forSeason(season.id)).toEqual([]);
    expect(dialog.activeKey()).toBeNull();
    expect(dialog.active()).toBeNull();
  });

  // Regression (audit 2026-11-05): opened straight onto a program, removing it used to put it right back,
  // because the startProgram effect re-ran on every store change and re-added what it no longer found.
  it('should keep a program off the field once removed, even when the dialog was opened on it', async () => {
    const fixture = open({ startProgram: WATER_PROGRAM.key });
    const settle = async () => { for (let i = 0; i < 5; i++) { TestBed.tick(); fixture.detectChanges(); await fixture.whenStable(); await new Promise(r => setTimeout(r, 0)); } };
    const programs = () => store.forSeason(season.id).map(r => r.programKey);
    await settle();
    expect(programs()).toEqual([WATER_PROGRAM.key]);

    await fixture.componentInstance.removeProgram();
    await settle();

    expect(programs()).toEqual([]);
    expect(fixture.componentInstance.activeKey()).toBeNull();
  });

  it('should copy at once from another field onto a field with no inputs, and ask first when it has some', async () => {
    const other = await newSeason('TATOB03', 'SOUTH PIVOT IRR', 120);
    score((await store.addRecord(other.season.id, FD_CIC_PROGRAM.key))!);
    const success = vi.spyOn(toast, 'success');
    const dialog = open({ startProgram: FD_CIC_PROGRAM.key }).componentInstance;
    await vi.waitFor(() => expect(dialog.active()?.record.programKey).toBe(FD_CIC_PROGRAM.key));
    const [source] = dialog.copySources();
    expect(source.fieldName).toBe('SOUTH PIVOT IRR');

    dialog.pickCopySource(source.recordId);
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Inputs copied. Edit what\'s different.'));
    const copied = store.find(season.id, FD_CIC_PROGRAM.key)!;
    expect(copied.data).toMatchObject({ expectedYield: 200, syntheticN: 180 });
    expect(copied.copiedFromField).toBe('SOUTH PIVOT IRR');
    expect(dialog.copying()).toBe(false);

    // Now it has inputs: picking again only asks.
    success.mockClear();
    dialog.pickCopySource(source.recordId);
    expect(dialog.pendingCopyFrom()).toBe(source.recordId);
    expect(success).not.toHaveBeenCalled();
  });

  it('should copy to the picked fields, say how many, and close the picker', async () => {
    const south = await newSeason('TATOB03', 'SOUTH PIVOT IRR');
    const west = await newSeason('TATOB04', 'WEST DRYLAND');
    const success = vi.spyOn(toast, 'success');
    const dialog = open({ startProgram: FD_CIC_PROGRAM.key }).componentInstance;
    await vi.waitFor(() => expect(dialog.active()?.record.programKey).toBe(FD_CIC_PROGRAM.key));
    score(dialog.active()!.record);
    expect(dialog.copyTargets().map(t => t.fieldName)).toEqual(['SOUTH PIVOT IRR', 'WEST DRYLAND']);

    dialog.showCopyTo.set(true);
    dialog.toggleCopyTo(south.season.id);
    dialog.toggleCopyTo(west.season.id);
    dialog.toggleCopyTo(west.season.id);
    dialog.toggleCopyTo(west.season.id);
    expect([...dialog.copyToPicked()]).toEqual([south.season.id, west.season.id]);
    await dialog.copyTo();

    expect(success).toHaveBeenCalledWith('Copied to 2 fields.');
    expect(store.find(south.season.id, FD_CIC_PROGRAM.key)?.data).toMatchObject({ expectedYield: 200, syntheticN: 180 });
    expect(store.find(west.season.id, FD_CIC_PROGRAM.key)?.data).toMatchObject({ expectedYield: 200, syntheticN: 180 });
    expect(dialog.showCopyTo()).toBe(false);
    expect(dialog.copyToPicked().size).toBe(0);
  });

  describe('once a 45Z field is confirmed', () => {
    let fixture: ComponentFixture<FieldSeasonDialogComponent>;
    let dialog: FieldSeasonDialogComponent;
    let record: FieldProgramRecord;

    beforeEach(async () => {
      const added = (await store.addRecord(season.id, FD_CIC_PROGRAM.key))!;
      score(added);
      record = (await confirm(added))!;
      fixture = open({ producer: { code: 'TATOBIN', name: 'Tatobin Farms' } });
      dialog = fixture.componentInstance;
    });

    it('should lock the field\'s acres and location, and offer no copying or removing', async () => {
      expect(record.status).toBe('Locked');
      expect(dialog.seasonLocked()).toBe(true);
      expect(dialog.officialStatus(record)).toBe('confirmed');
      expect(dialog.copySources()).toEqual([]);
      expect(dialog.copyTargets()).toEqual([]);
      expect(dialog.intakeInputs()?.disabled).toBe(true);

      dialog.draftSeason!.acres = 10;
      dialog.saveSeason();
      dialog.draftField!.county = 'Reno';
      dialog.saveField();
      await dialog.removeProgram();

      expect(store.season(season.id)?.acres).toBe(80);
      expect(store.field(field.fieldKey)?.county).toBe('Pratt');
      expect(store.record(record.id)?.status).toBe('Locked');
      expect(text(fixture)).toContain('Generate Biofuel Feedstock Report');
      expect(text(fixture)).not.toContain('Remove from this field');
    });

    it('should build the Biofuel Feedstock Report for the producer, and none without a producer', async () => {
      await dialog.generateReport(record);

      expect(reports.download).toHaveBeenCalledTimes(1);
      expect(reports.download.mock.calls[0][0].fileName).toContain('TATOB28');

      reports.download.mockClear();
      fixture.componentRef.setInput('producer', null);
      await dialog.generateReport(record);
      expect(reports.download).not.toHaveBeenCalled();
    });

    it('should unlock only with a reason, closing the prompt before the save', async () => {
      dialog.showReopen = true;
      dialog.reopenReason = '   ';
      await dialog.confirmReopen();
      expect(dialog.showReopen).toBe(true);
      expect(store.record(record.id)?.status).toBe('Locked');

      dialog.reopenReason = 'Wrong nitrogen rate';
      const saving = dialog.confirmReopen();
      expect(dialog.showReopen).toBe(false);
      expect(dialog.reopenReason).toBe('');
      await saving;

      const reopened = store.record(record.id)!;
      expect(reopened.status).toBe('Ready');
      expect(reopened.reopened?.[0].reason).toBe('Wrong nitrogen rate');
      expect(dialog.seasonLocked()).toBe(false);
    });
  });
});
