import { Injectable, inject, signal } from '@angular/core';
import { EnrollableRecord, FieldProgramRecord, FieldSeason, ProducerField, ProgramEnrollment } from '@models';
import { ToastService } from '@core/services/toast.service';
import { ProgramRegistry } from '../programs/program-registry';
import { enrollmentBlockers } from '../programs/program-enrollment';
import { FIELD_PLAN_BACKEND, FieldPlanSnapshot } from './field-plan-backend';

/** How long typing pauses before an edit is saved. */
export const SAVE_DEBOUNCE_MS = 400;

type LoadState = 'loading' | 'loaded' | 'error';

/**
 * The field plan on the client: producers' fields (CTRM splits, with a location), each field's acres on
 * a crop row, its sustainability program records, and the producer's program enrollments.
 *
 * Reads are synchronous signal reads, so templates and computed signals use them directly. A producer's
 * data is there once `ensureLoaded(customerId)` has brought it in from the backend (FIELD_PLAN_BACKEND).
 *
 * Writes come in two kinds:
 * - edits while typing (`updateRecord`, `updateField`, `updateSeason`) apply at once, so scores and chips
 *   move, and are saved after a pause, latest value wins, one save in flight per item;
 * - structural changes (add, remove, finalize, reopen, harvest complete, withdraw, issue an ID) wait for
 *   the backend, after any pending edits are saved, and return a Promise.
 * A failed save shows an error and reloads the producer from the backend, so the screen never shows
 * something that wasn't kept.
 *
 * The program lifecycle: added (the producer's enrollment ID is issued with it) → Draft → Ready (scored) → actual yield entered → the enrollment's harvest marked complete →
 * Final (frozen), reopenable with a reason unless the producer's attested enrollment holds it.
 * Originators never finalize field by field.
 */
@Injectable({ providedIn: 'root' })
export class FieldPlanStore {
  private readonly backend = inject(FIELD_PLAN_BACKEND);
  private readonly registry = inject(ProgramRegistry);
  private readonly toast = inject(ToastService);

  readonly fields = signal<ProducerField[]>([]);
  readonly seasons = signal<FieldSeason[]>([]);
  readonly records = signal<FieldProgramRecord[]>([]);
  readonly enrollments = signal<ProgramEnrollment[]>([]);

  private readonly _load = signal<ReadonlyMap<number, LoadState>>(new Map());
  private readonly _loadRequest = new Map<number, number>();
  private _nextLoadRequest = 1;

  /** Debounced edits: the latest value per item, its timer, and whether a save is running. */
  private readonly _pending = new Map<string, { timer?: ReturnType<typeof setTimeout>; save: () => Promise<unknown>; customerId: number }>();
  private readonly _inFlight = new Map<string, Promise<void>>();

  // ── Loading ───────────────────────────────────────────────────────────────

  isLoaded(customerId: number): boolean {
    return this._load().get(customerId) === 'loaded';
  }

  loadFailed(customerId: number): boolean {
    return this._load().get(customerId) === 'error';
  }

  /** Brings a producer's field plan in from the backend, once. Safe to call from effects. */
  ensureLoaded(customerId: number): void {
    const state = this._load().get(customerId);
    if (state === 'loaded' || state === 'loading') return;
    void this.reload(customerId);
  }

  /** Loads (again) from the backend, replacing what's held for the producer. A slower, older load is dropped. */
  async reload(customerId: number): Promise<void> {
    const request = this._nextLoadRequest++;
    this._loadRequest.set(customerId, request);
    this.setLoad(customerId, 'loading');
    try {
      const snapshot = await this.backend.load(customerId);
      if (this._loadRequest.get(customerId) !== request) return;
      this.replaceCustomer(customerId, snapshot);
      this.setLoad(customerId, 'loaded');
    } catch {
      if (this._loadRequest.get(customerId) !== request) return;
      this.setLoad(customerId, 'error');
      this.toast.error('Couldn\'t load this producer\'s fields. Try again in a moment.');
    }
  }

  // ── Reads: fields and seasons ────────────────────────────────────────────

  fieldsFor(customerId: number): ProducerField[] {
    return this.fields().filter(f => f.customerId === customerId);
  }

  field(fieldKey: string): ProducerField | undefined {
    return this.fields().find(f => f.fieldKey === fieldKey);
  }

  seasonsForIntention(intentionId: number): FieldSeason[] {
    return this.seasons().filter(s => s.plantingIntentionId === intentionId);
  }

  season(id: string): FieldSeason | undefined {
    return this.seasons().find(s => s.id === id);
  }

  /** The field's most recent season before `year`: last time's acres, and the key to last time's program data. */
  lastSeason(fieldKey: string, year: number): FieldSeason | undefined {
    return this.seasons()
      .filter(s => s.fieldKey === fieldKey && s.year < year)
      .sort((a, b) => b.year - a.year)[0];
  }

  // ── Reads: program records ───────────────────────────────────────────────

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

  /** The producer's live enrollment this record belongs to (by program, producer and year). */
  enrollmentFor(record: FieldProgramRecord): ProgramEnrollment | undefined {
    const season = this.season(record.seasonId);
    const field = season && this.field(season.fieldKey);
    return season && field ? this.current(record.programKey, field.customerId, season.year) : undefined;
  }

  /** Every record in an enrollment: the producer's records in its program and year. */
  forEnrollment(enrollment: ProgramEnrollment): FieldProgramRecord[] {
    return this.records().filter(r => {
      if (r.programKey !== enrollment.programKey) return false;
      const season = this.season(r.seasonId);
      const field = season && this.field(season.fieldKey);
      return !!season && !!field && field.customerId === enrollment.customerId && season.year === enrollment.year;
    });
  }

  // ── Reads: enrollments ───────────────────────────────────────────────────

  /** The producer's live (Open or Attested) enrollment in a program for the year. */
  current(programKey: string, customerId: number, year: number): ProgramEnrollment | undefined {
    return this.enrollments().find(e => e.programKey === programKey && e.customerId === customerId && e.year === year && e.status !== 'Withdrawn');
  }

  withdrawn(programKey: string, customerId: number, year: number): ProgramEnrollment[] {
    return this.enrollments().filter(e => e.programKey === programKey && e.customerId === customerId && e.year === year && e.status === 'Withdrawn');
  }

  /** The attested enrollment whose signed snapshot holds this record. A finalized record in it can't be reopened. */
  lockedBy(recordId: string): ProgramEnrollment | undefined {
    return this.enrollments().find(e => e.status === 'Attested' && (e.snapshot ?? []).some(r => r.recordId === recordId));
  }

  /** What still stands between an open enrollment and the producer's attestation (checked again by the backend). */
  blockers(enrollment: ProgramEnrollment, listed: readonly EnrollableRecord[]): string[] {
    const statements = this.registry.get(enrollment.programKey)?.enrollment?.statements ?? [];
    return enrollmentBlockers(enrollment, listed, this.enrollments(), statements);
  }

  // ── Edits while typing (saved after a pause) ─────────────────────────────

  /** Saves a field's location. The split ID, name and split % are CTRM's and don't change here. */
  updateField(field: ProducerField): void {
    if (!this.field(field.fieldKey)) return;
    const next = { ...field };
    this.fields.update(fs => fs.map(f => (f.fieldKey === next.fieldKey ? next : f)));
    this.queue(`field:${next.fieldKey}`, next.customerId, () => this.backend.updateField(this.field(next.fieldKey) ?? next));
  }

  /** Saves a season's acres. A season with a finalized record is locked. */
  updateSeason(season: FieldSeason): void {
    const customerId = this.customerOfSeason(season.id);
    if (customerId === undefined || this.hasFinal(season.id)) return;
    const next = { ...season };
    this.seasons.update(ss => ss.map(s => (s.id === next.id ? next : s)));
    this.queue(`season:${next.id}`, customerId, () => this.backend.updateSeason(this.season(next.id) ?? next));
  }

  /** Saves a record's data; its status follows from what the program still needs. A finalized record is locked until reopened. */
  updateRecord(id: string, data: unknown): void {
    const current = this.record(id);
    const season = current && this.season(current.seasonId);
    const customerId = current && this.customerOfSeason(current.seasonId);
    if (!current || !season || customerId === undefined || current.status === 'Final') return;
    const next: FieldProgramRecord = { ...current, data };
    next.status = this.statusOf(next, season);
    this.records.update(rs => rs.map(r => (r.id === id ? next : r)));
    this.queue(`record:${id}`, customerId, () => {
      const latest = this.record(id) ?? next;
      return this.backend.updateRecord(id, latest.data, latest.status);
    });
  }

  /** Saves everything still waiting on a pause. Structural changes call this first so the backend sees the latest values. */
  async flush(): Promise<void> {
    for (const [key, pending] of [...this._pending]) {
      clearTimeout(pending.timer);
      void this.runSave(key);
    }
    await Promise.all([...this._inFlight.values()]);
  }

  // ── Structural changes (wait for the backend) ────────────────────────────

  /** Makes one of the producer's CTRM splits a field (keyed by its split ID), with the location 45Z needs. */
  async createField(field: Omit<ProducerField, 'fieldKey'>): Promise<ProducerField | undefined> {
    const existing = this.field(field.splitId.trim().toUpperCase());
    if (existing?.customerId === field.customerId) return existing;
    return this.write('add the field', async () => {
      const created = await this.backend.createField(field);
      this.fields.update(fs => [...fs.filter(f => f.fieldKey !== created.fieldKey), created]);
      return created;
    });
  }

  /** Puts a field on a crop row (a planting intention) for its year. */
  async addSeason(fieldKey: string, intentionId: number, year: number, cropLabel: string, acres: number): Promise<FieldSeason | undefined> {
    return this.write('add the field to this crop', async () => {
      const created = await this.backend.addSeason({ fieldKey, plantingIntentionId: intentionId, year, cropLabel, acres });
      this.seasons.update(ss => [...ss, created]);
      return created;
    });
  }

  /** Takes a field off a crop row, with its unfinalized program records. Refused once anything on it is final. */
  async removeSeason(seasonId: string): Promise<boolean> {
    if (this.hasFinal(seasonId)) return false;
    return (await this.write('remove the field', async () => {
      await this.backend.removeSeason(seasonId);
      this.records.update(rs => rs.filter(r => r.seasonId !== seasonId));
      this.seasons.update(ss => ss.filter(s => s.id !== seasonId));
      return true;
    })) ?? false;
  }

  /**
   * Adds a program to a field season. The data starts from the program's defaults, plus whatever the
   * program carries over from the field's last season in it. The producer's enrollment ID for the
   * program and year is issued now, if they don't have one.
   */
  async addRecord(seasonId: string, programKey: string): Promise<FieldProgramRecord | undefined> {
    const season = this.season(seasonId);
    const field = season && this.field(season.fieldKey);
    const def = this.registry.get(programKey);
    if (!season || !field || !def || !def.appliesTo(season.cropLabel)) return undefined;
    const existing = this.find(seasonId, programKey);
    if (existing) return existing;

    let data = def.blankData();
    let copiedFromYear: number | undefined;
    // The field's most recent earlier season that was in this program (a year out of it is skipped).
    const priorSeason = this.seasons()
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
    const draft: Omit<FieldProgramRecord, 'id'> = { seasonId, programKey, data, status: 'Draft', copiedFromYear };
    draft.status = this.statusOf({ ...draft, id: '' }, season);

    const created = await this.write('add the program', async () => {
      const record = await this.backend.addRecord(draft);
      this.records.update(rs => [...rs.filter(r => r.id !== record.id), record]);
      return record;
    });
    if (created) await this.ensureEnrollments(field.fieldKey);
    return created;
  }

  /** Takes a program off a field season. A finalized record stays. */
  async removeRecord(id: string): Promise<void> {
    const current = this.record(id);
    if (!current || current.status === 'Final') return;
    await this.write('remove the program', async () => {
      await this.backend.removeRecord(id);
      this.records.update(rs => rs.filter(r => r.id !== id));
    });
  }

  /** Issues the producer's enrollment ID for each program on the field that doesn't have one. Called when a program is added. */
  async ensureEnrollments(fieldKey: string): Promise<void> {
    const field = this.field(fieldKey);
    if (!field) return;
    const wanted = new Map<string, { programKey: string; year: number }>();
    for (const r of this.records()) {
      const season = this.season(r.seasonId);
      if (season?.fieldKey === fieldKey) wanted.set(`${r.programKey}|${season.year}`, { programKey: r.programKey, year: season.year });
    }
    for (const { programKey, year } of wanted.values()) {
      if (this.current(programKey, field.customerId, year) || !this.registry.get(programKey)?.enrollment) continue;
      await this.ensureEnrollment(programKey, field.customerId, year);
    }
  }

  /** The producer's live enrollment, or a new one with its ID issued now (e.g. after a withdrawal). */
  async ensureEnrollment(programKey: string, customerId: number, year: number): Promise<ProgramEnrollment | undefined> {
    return this.write('issue the enrollment ID', async () => {
      const e = await this.backend.ensureEnrollment(programKey, customerId, year);
      if (e) this.putEnrollment(e);
      return e;
    });
  }

  /**
   * Harvest is complete for the enrollment: finalizes every record in it that has nothing missing.
   * Returns the ones left open, with what they still need (45Z: usually the actual yield).
   */
  async completeHarvest(enrollment: ProgramEnrollment): Promise<{ recordId: string; missing: string[] }[]> {
    await this.flush();
    const leftOpen: { recordId: string; missing: string[] }[] = [];
    const marked = await this.write('mark harvest complete', async () => {
      this.putEnrollment(await this.backend.setHarvestComplete(enrollment.key, true));
      return true;
    });
    if (!marked) return leftOpen;
    for (const r of this.forEnrollment(enrollment).filter(x => x.status !== 'Final')) {
      const def = this.registry.get(r.programKey)!;
      const season = this.season(r.seasonId)!;
      const field = this.field(season.fieldKey)!;
      const missing = def.finalizeMissing(r.data, season, field);
      if (missing.length) {
        leftOpen.push({ recordId: r.id, missing });
        continue;
      }
      const finalized = await this.write('finalize a field', () => this.backend.finalize(r.id, 'harvest complete'));
      if (finalized) this.putRecord(finalized);
      else leftOpen.push({ recordId: r.id, missing: ['to be saved (try again)'] });
    }
    return leftOpen;
  }

  /**
   * Reopens a finalized record for correction, with the reason kept in its history, and its enrollment's
   * harvest with it. Refused while the producer's attested enrollment holds it.
   */
  async reopen(id: string, reason: string): Promise<boolean> {
    const current = this.record(id);
    if (!current || current.status !== 'Final' || !reason.trim() || this.lockedBy(id)) return false;
    const result = await this.write('reopen the field', () => this.backend.reopen(id, reason));
    if (!result) return false;
    this.putRecord(result.record);
    if (result.enrollment) this.putEnrollment(result.enrollment);
    return true;
  }

  /** Saves an open enrollment's attestation. An attested enrollment only changes by withdrawal. */
  async updateAttestation(enrollment: ProgramEnrollment): Promise<void> {
    await this.write('save the attestation', async () => this.putEnrollment(await this.backend.updateAttestation(enrollment)));
  }

  /** Records the producer's attestation over the listed records. Refused while anything is outstanding. */
  async attest(key: string, listed: readonly EnrollableRecord[]): Promise<ProgramEnrollment | undefined> {
    const e = this.enrollments().find(x => x.key === key);
    if (!e || e.status !== 'Open' || this.blockers(e, listed).length > 0) return undefined;
    await this.flush();
    return this.write('record the attestation', async () => {
      const attested = await this.backend.attest(key, listed);
      this.putEnrollment(attested);
      return attested;
    });
  }

  /**
   * Withdraws an enrollment with a reason. Its ID and snapshot are kept and the ID is never reissued;
   * the producer's next program input starts a new enrollment with a new ID.
   */
  async withdraw(key: string, reason: string): Promise<void> {
    if (!reason.trim()) return;
    await this.write('withdraw the enrollment', async () => this.putEnrollment(await this.backend.withdraw(key, reason)));
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private statusOf(record: FieldProgramRecord, season: FieldSeason): FieldProgramRecord['status'] {
    if (record.status === 'Final') return 'Final';
    const def = this.registry.get(record.programKey);
    return def && def.missing(record.data, season).length === 0 ? 'Ready' : 'Draft';
  }

  private customerOfSeason(seasonId: string): number | undefined {
    const season = this.season(seasonId);
    return season && this.field(season.fieldKey)?.customerId;
  }

  /** A structural change: saves pending edits, runs it, and shows an error toast if it fails. */
  private async write<T>(what: string, run: () => Promise<T>): Promise<T | undefined> {
    await this.flush();
    try {
      return await run();
    } catch (e) {
      this.toast.error(`Couldn't ${what}. ${e instanceof Error ? e.message : ''}`.trim());
      return undefined;
    }
  }

  private queue(key: string, customerId: number, save: () => Promise<unknown>): void {
    const pending = this._pending.get(key);
    clearTimeout(pending?.timer);
    const timer = setTimeout(() => void this.runSave(key), SAVE_DEBOUNCE_MS);
    this._pending.set(key, { timer, save, customerId });
  }

  /** Runs one item's latest save. If one is already running, this one waits for it, so saves stay in order. */
  private runSave(key: string): Promise<void> {
    const pending = this._pending.get(key);
    if (!pending) return this._inFlight.get(key) ?? Promise.resolve();
    this._pending.delete(key);
    const previous = this._inFlight.get(key) ?? Promise.resolve();
    const run = previous.then(async () => {
      try {
        await pending.save();
      } catch (e) {
        this._pending.delete(key);
        this.toast.error(`Couldn't save your change. ${e instanceof Error ? e.message : ''}`.trim());
        await this.reload(pending.customerId);
      }
    });
    this._inFlight.set(key, run);
    void run.finally(() => {
      if (this._inFlight.get(key) === run) this._inFlight.delete(key);
    });
    return run;
  }

  private putRecord(record: FieldProgramRecord): void {
    this.records.update(rs => rs.map(r => (r.id === record.id ? record : r)));
  }

  private putEnrollment(enrollment: ProgramEnrollment): void {
    this.enrollments.update(es => (es.some(e => e.key === enrollment.key)
      ? es.map(e => (e.key === enrollment.key ? enrollment : e))
      : [...es, enrollment]));
  }

  private replaceCustomer(customerId: number, snapshot: FieldPlanSnapshot): void {
    const keys = new Set(this.fields().filter(f => f.customerId === customerId).map(f => f.fieldKey));
    const seasonIds = new Set(this.seasons().filter(s => keys.has(s.fieldKey)).map(s => s.id));
    this.fields.update(fs => [...fs.filter(f => f.customerId !== customerId), ...snapshot.fields]);
    this.seasons.update(ss => [...ss.filter(s => !keys.has(s.fieldKey)), ...snapshot.seasons]);
    this.records.update(rs => [...rs.filter(r => !seasonIds.has(r.seasonId)), ...snapshot.records]);
    this.enrollments.update(es => [...es.filter(e => e.customerId !== customerId), ...snapshot.enrollments]);
  }

  private setLoad(customerId: number, state: LoadState): void {
    this._load.update(m => new Map(m).set(customerId, state));
  }
}
