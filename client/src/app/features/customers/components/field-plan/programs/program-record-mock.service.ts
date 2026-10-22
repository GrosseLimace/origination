import { Injectable, inject, signal } from '@angular/core';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { FieldProgramRecord, FieldSeason, ProgramEnrollment } from '@models';
import { ProgramRegistry } from './program-registry';
import { ProgramEnrollmentMockService } from './program-enrollment-mock.service';
import { fsaKey } from './program-enrollment';

/**
 * PROTOTYPE ONLY: in-memory sustainability program records, one per program per field season. The
 * program's definition decides what its data holds, when it is complete and what is frozen at
 * finalize; this store applies the shared lifecycle:
 *
 *   added (the producer's enrollment ID is issued if they have none) → Draft → Ready (scored)
 *   → actual yield entered after harvest → enrollment's harvest marked complete → Final (frozen),
 *     reopenable with a reason unless the producer's attested enrollment holds it.
 *
 * Originators never finalize field by field: marking the enrollment's harvest complete does.
 */
@Injectable({ providedIn: 'root' })
export class ProgramRecordMockService {
  private readonly registry = inject(ProgramRegistry);
  private readonly plan = inject(FieldPlanMockService);
  private readonly enrollments = inject(ProgramEnrollmentMockService);
  readonly records = signal<FieldProgramRecord[]>([]);
  private _nextId = 1;

  // ── Reads ─────────────────────────────────────────────────────────────────

  record(id: string): FieldProgramRecord | undefined {
    return this.records().find(r => r.id === id);
  }

  forSeason(seasonId: string): FieldProgramRecord[] {
    return this.records().filter(r => r.seasonId === seasonId);
  }

  find(seasonId: string, programKey: string): FieldProgramRecord | undefined {
    return this.records().find(r => r.seasonId === seasonId && r.programKey === programKey);
  }

  /** A season with a finalized record is locked: its acres are part of a frozen result. */
  hasFinal(seasonId: string): boolean {
    return this.forSeason(seasonId).some(r => r.status === 'Final');
  }

  /**
   * The producer's live enrollment this record belongs to (by program, producer and year). A field
   * only joins its enrollment once its FSA farm, tract and field numbers are in.
   */
  enrollmentFor(record: FieldProgramRecord): ProgramEnrollment | undefined {
    const season = this.plan.season(record.seasonId);
    const field = season && this.plan.field(season.fieldKey);
    return season && field && fsaKey(field) ? this.enrollments.current(record.programKey, field.customerId, season.year) : undefined;
  }

  /** Every record in an enrollment: the producer's records in its program and year whose fields have FSA numbers. */
  forEnrollment(enrollment: ProgramEnrollment): FieldProgramRecord[] {
    return this.records().filter(r => {
      if (r.programKey !== enrollment.programKey) return false;
      const season = this.plan.season(r.seasonId);
      const field = season && this.plan.field(season.fieldKey);
      return !!season && !!field && !!fsaKey(field) && field.customerId === enrollment.customerId && season.year === enrollment.year;
    });
  }

  /**
   * Issues the producer's enrollment ID for each program on the field, once the field has its FSA
   * numbers. Called when a program is added and when the field's FSA numbers change.
   */
  ensureEnrollments(fieldKey: string): void {
    const field = this.plan.field(fieldKey);
    if (!field || !fsaKey(field)) return;
    for (const r of this.records()) {
      const season = this.plan.season(r.seasonId);
      if (season?.fieldKey === fieldKey) this.enrollments.ensureFor(r.programKey, field.customerId, season.year);
    }
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * Adds a program to a field season. The data starts from the program's defaults, plus whatever the
   * program carries over from the field's last season in it. If the field has its FSA numbers, the
   * producer's enrollment ID for the program and year is issued now (if they don't have one).
   */
  add(seasonId: string, programKey: string): FieldProgramRecord | undefined {
    const season = this.plan.season(seasonId);
    const field = season && this.plan.field(season.fieldKey);
    const def = this.registry.get(programKey);
    if (!season || !field || !def || !def.appliesTo(season.cropLabel)) return undefined;
    const existing = this.find(seasonId, programKey);
    if (existing) return existing;

    let data = def.blankData();
    let copiedFromYear: number | undefined;
    // The field's most recent earlier season that was in this program (a year out of it is skipped).
    const priorSeason = this.plan.seasons()
      .filter(s => s.fieldKey === season.fieldKey && s.year < season.year && this.find(s.id, programKey))
      .sort((a, b) => b.year - a.year)[0];
    const prior = priorSeason && this.find(priorSeason.id, programKey);
    if (priorSeason && prior) {
      const carried = def.copyForward(prior.data, priorSeason.cropLabel, season.cropLabel);
      if (carried && Object.keys(carried).length > 0) {
        data = { ...data, ...carried };
        copiedFromYear = priorSeason.year;
      }
    }

    const record: FieldProgramRecord = { id: `r${this._nextId++}`, seasonId, programKey, data, status: 'Draft', copiedFromYear };
    record.status = this._status(record, season);
    this.records.update(rs => [...rs, record]);
    this.ensureEnrollments(field.fieldKey);
    return record;
  }

  /** Saves a record's data. A finalized record is locked until reopened. */
  update(record: FieldProgramRecord): void {
    const current = this.record(record.id);
    const season = this.plan.season(record.seasonId);
    if (!current || !season || current.status === 'Final') return;
    const next = { ...current, data: record.data };
    next.status = this._status(next, season);
    this.records.update(rs => rs.map(r => (r.id === record.id ? next : r)));
  }

  /**
   * Harvest is complete for the enrollment: finalizes every record in it that has nothing missing.
   * Returns the ones left open, with what they still need (45Z: usually the actual yield).
   */
  completeHarvest(enrollment: ProgramEnrollment): { recordId: string; missing: string[] }[] {
    this.enrollments.setHarvestComplete(enrollment.key, true);
    const leftOpen: { recordId: string; missing: string[] }[] = [];
    for (const r of this.forEnrollment(enrollment).filter(x => x.status !== 'Final')) {
      const def = this.registry.get(r.programKey)!;
      const season = this.plan.season(r.seasonId)!;
      const field = this.plan.field(season.fieldKey)!;
      const missing = def.finalizeMissing(r.data, season, field);
      if (missing.length) leftOpen.push({ recordId: r.id, missing });
      else this.finalize(r.id, 'harvest complete');
    }
    return leftOpen;
  }

  /** Freezes a record's inputs and outputs. Called by harvest complete, not by originators. */
  finalize(id: string, by: string): boolean {
    const current = this.record(id);
    const season = current && this.plan.season(current.seasonId);
    const field = season && this.plan.field(season.fieldKey);
    const def = current && this.registry.get(current.programKey);
    if (!current || !season || !field || !def || current.status === 'Final') return false;
    if (def.finalizeMissing(current.data, season, field).length > 0) return false;
    const frozen = { ...def.freeze(current.data, season, field), finalizedBy: by, finalizedAt: new Date().toISOString() };
    this.records.update(rs => rs.map(r => (r.id === id ? { ...r, status: 'Final', frozen } : r)));
    return true;
  }

  /**
   * Reopens a finalized record for correction, and its enrollment's harvest with it. Refused while
   * the producer's attested enrollment holds it.
   */
  reopen(id: string): boolean {
    const current = this.record(id);
    const season = current && this.plan.season(current.seasonId);
    if (!current || !season || current.status !== 'Final' || this.enrollments.lockedBy(id)) return false;
    const reopened: FieldProgramRecord = { ...current, frozen: undefined, status: 'Draft' };
    reopened.status = this._status(reopened, season);
    this.records.update(rs => rs.map(r => (r.id === id ? reopened : r)));
    const enrollment = this.enrollmentFor(reopened);
    if (enrollment) this.enrollments.setHarvestComplete(enrollment.key, false);
    return true;
  }

  /** Takes a program off a field season. A finalized record stays. */
  remove(id: string): void {
    this.records.update(rs => rs.filter(r => r.id !== id || r.status === 'Final'));
  }

  /** Removes every unfinalized record on a season, when the field comes off the crop row. */
  removeForSeason(seasonId: string): void {
    this.records.update(rs => rs.filter(r => r.seasonId !== seasonId || r.status === 'Final'));
  }

  private _status(record: FieldProgramRecord, season: FieldSeason): FieldProgramRecord['status'] {
    if (record.status === 'Final') return 'Final';
    const def = this.registry.get(record.programKey);
    return def && def.missing(record.data, season).length === 0 ? 'Ready' : 'Draft';
  }
}
