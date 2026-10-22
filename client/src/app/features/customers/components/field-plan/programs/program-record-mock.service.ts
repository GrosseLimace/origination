import { Injectable, inject, signal } from '@angular/core';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { FieldProgramRecord, FieldSeason } from '@models';
import { ProgramRegistry } from './program-registry';
import { ProgramEnrollmentMockService } from './program-enrollment-mock.service';

/**
 * PROTOTYPE ONLY: in-memory sustainability program records, one per program per field season. The
 * program's definition decides what its data holds, when it is complete and what is frozen at
 * finalize; this store only applies the shared lifecycle (Draft → Ready → Final, reopen, locks).
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

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * Adds a program to a field season. The data starts from the program's defaults, with whatever the
   * program carries over from the field's previous season in the same program.
   */
  add(seasonId: string, programKey: string): FieldProgramRecord | undefined {
    const season = this.plan.season(seasonId);
    const def = this.registry.get(programKey);
    if (!season || !def || !def.appliesTo(season.cropLabel)) return undefined;
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
   * Finalizes a record with the program's end-of-season numbers (45Z: actual yield) and freezes its
   * inputs and outputs. Refused while the program says anything is missing.
   */
  finalize(id: string, endOfSeason: Record<string, unknown>, by = 'you'): boolean {
    const current = this.record(id);
    const season = current && this.plan.season(current.seasonId);
    const field = season && this.plan.field(season.fieldKey);
    const def = current && this.registry.get(current.programKey);
    if (!current || !season || !field || !def || current.status === 'Final') return false;
    const data = { ...(current.data as object), ...endOfSeason };
    if (def.finalizeMissing(data, season).length > 0) return false;
    const frozen = { ...def.freeze(data, season, field), finalizedBy: by, finalizedAt: new Date().toISOString() };
    this.records.update(rs => rs.map(r => (r.id === id ? { ...r, data, status: 'Final', frozen } : r)));
    return true;
  }

  /** Reopens a finalized record for correction. Refused while an attested enrollment holds it. */
  reopen(id: string): boolean {
    const current = this.record(id);
    const season = current && this.plan.season(current.seasonId);
    if (!current || !season || current.status !== 'Final' || this.enrollments.lockedBy(id)) return false;
    const reopened: FieldProgramRecord = { ...current, frozen: undefined, status: 'Draft' };
    reopened.status = this._status(reopened, season);
    this.records.update(rs => rs.map(r => (r.id === id ? reopened : r)));
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
