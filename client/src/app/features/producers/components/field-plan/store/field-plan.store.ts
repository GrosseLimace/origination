import { Injectable, inject, signal } from '@angular/core';
import { FieldProgramRecord, FieldSeason, FieldTickets, ProducerField } from '../../../models/field-plan.model';
import { alreadyShown } from '@core/http/shown-errors';
import { ToastService } from '@core/services/toast.service';
import { ProgramRegistry } from '../programs/program-registry';
import { enrollmentIdFor } from '../programs/program-enrollment';
import { ConfirmReview, FIELD_PLAN_BACKEND, FieldPlanSnapshot } from './field-plan-backend';

/** Another field this year whose program inputs can be copied onto a field. */
export interface CopySource {
  recordId: string;
  fieldName: string;
  cropLabel: string;
  status: FieldProgramRecord['status'];
  /** On the same crop row as the field being copied onto. */
  sameRow: boolean;
}

/** A field this year that a record's inputs can be copied onto, and what copying would do there. */
export interface CopyTarget {
  seasonId: string;
  fieldName: string;
  cropLabel: string;
  /**
   * empty: the field has no inputs for the program yet. replace: its inputs will be replaced.
   * partial: a different crop, so only the inputs the program carries between crops. locked: locked.
   */
  effect: 'empty' | 'replace' | 'partial' | 'locked';
}

/** How long typing pauses before an edit is saved. */
export const SAVE_DEBOUNCE_MS = 400;

type LoadState = 'loading' | 'loaded' | 'error';

/**
 * The field plan on the client: producers' fields (CTRM splits, with a location), each field's acres on
 * a crop row, and its sustainability program records.
 *
 * Reads are synchronous signal reads, so templates and computed signals use them directly. A producer's
 * data is there once `ensureLoaded(customerId)` has brought it in from the backend (FIELD_PLAN_BACKEND).
 *
 * Writes come in two kinds:
 * - edits while typing (`updateRecord`, `updateField`, `updateSeason`) apply at once, so scores and chips
 *   move, and are saved after a pause, latest value wins, one save in flight per item;
 * - structural changes (add, remove, confirm, reopen) wait for
 *   the backend, after any pending edits are saved, and return a Promise.
 * A failed save shows an error and reloads the producer from the backend, so the screen never shows
 * something that wasn't kept.
 *
 * The program lifecycle: added (the field's enrollment ID is derived) → Draft → Ready (scored)
 * → after harvest, reviewed with its CTRM tickets and confirmed (45Z) → Locked, with the confirmed CI as the official result.
 * A confirmed field is unlocked with a reason; that is the only way a confirmed CI changes.
 */
@Injectable({ providedIn: 'root' })
export class FieldPlanStore {
  private readonly backend = inject(FIELD_PLAN_BACKEND);
  private readonly registry = inject(ProgramRegistry);
  private readonly toast = inject(ToastService);

  // Written only here; everything outside reads the readonly views (audit 2026-11-05), so no component
  // can change the store's data without going through a method that also saves it.
  private readonly _fields = signal<ProducerField[]>([]);
  private readonly _seasons = signal<FieldSeason[]>([]);
  private readonly _records = signal<FieldProgramRecord[]>([]);
  readonly fields = this._fields.asReadonly();
  readonly seasons = this._seasons.asReadonly();
  readonly records = this._records.asReadonly();

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
    } catch (e) {
      if (this._loadRequest.get(customerId) !== request) return;
      this.setLoad(customerId, 'error');
      if (!alreadyShown(e)) this.toast.error('Couldn\'t load this producer\'s fields. Try again in a moment.');
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

  /** A season with a locked record is locked: its acres are part of a frozen result. */
  hasLocked(seasonId: string): boolean {
    return this.forSeason(seasonId).some(r => r.status === 'Locked');
  }

  /** A record's enrollment ID: its program's prefix, the crop year and the field's split ID. Undefined for a program without one. */
  enrollmentIdOf(record: FieldProgramRecord): string | undefined {
    const prefix = this.registry.get(record.programKey)?.enrollment?.idPrefix;
    const season = this.season(record.seasonId);
    const field = season && this.field(season.fieldKey);
    return prefix && season && field ? enrollmentIdFor(prefix, season.year, field.splitId) : undefined;
  }

  // ── Edits while typing (saved after a pause) ─────────────────────────────

  /** Saves a field's location. The split ID, name and split % are CTRM's and don't change here. */
  updateField(field: ProducerField): void {
    if (!this.field(field.fieldKey)) return;
    const next = { ...field };
    this._fields.update(fs => fs.map(f => (f.fieldKey === next.fieldKey ? next : f)));
    this.queue(`field:${next.fieldKey}`, next.customerId, () => this.backend.updateField(this.field(next.fieldKey) ?? next));
  }

  /** Saves a season's acres. A season with a locked record is locked. */
  updateSeason(season: FieldSeason): void {
    const customerId = this.customerOfSeason(season.id);
    if (customerId === undefined || this.hasLocked(season.id)) return;
    const next = { ...season };
    this._seasons.update(ss => ss.map(s => (s.id === next.id ? next : s)));
    this.queue(`season:${next.id}`, customerId, () => this.backend.updateSeason(this.season(next.id) ?? next));
  }

  /** Saves a record's data; its status follows from what the program still needs. A locked record is locked until reopened. */
  updateRecord(id: string, data: unknown): void {
    const current = this.record(id);
    const season = current && this.season(current.seasonId);
    const customerId = current && this.customerOfSeason(current.seasonId);
    if (!current || !season || customerId === undefined || current.status === 'Locked') return;
    const next: FieldProgramRecord = { ...current, data };
    next.status = this.statusOf(next, season);
    this._records.update(rs => rs.map(r => (r.id === id ? next : r)));
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
      this._fields.update(fs => [...fs.filter(f => f.fieldKey !== created.fieldKey), created]);
      return created;
    });
  }

  /** Puts a field on a crop row (a planting intention) for its year. */
  async addSeason(fieldKey: string, intentionId: number, year: number, cropLabel: string, acres: number): Promise<FieldSeason | undefined> {
    return this.write('add the field to this crop', async () => {
      const created = await this.backend.addSeason({ fieldKey, plantingIntentionId: intentionId, year, cropLabel, acres });
      this._seasons.update(ss => [...ss, created]);
      return created;
    });
  }

  /** Takes a field off a crop row, with its unlocked program records. Refused once anything on it is locked. */
  async removeSeason(seasonId: string): Promise<boolean> {
    if (this.hasLocked(seasonId)) return false;
    return (await this.write('remove the field', async () => {
      await this.backend.removeSeason(seasonId);
      this._records.update(rs => rs.filter(r => r.seasonId !== seasonId));
      this._seasons.update(ss => ss.filter(s => s.id !== seasonId));
      return true;
    })) ?? false;
  }

  /**
   * Adds a program to a field season. The data starts from the program's defaults, plus whatever the
   * program carries over from the field's last season in it. Its enrollment ID is derived (enrollmentIdOf).
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

    return this.write('add the program', async () => {
      const record = await this.backend.addRecord(draft);
      this._records.update(rs => [...rs.filter(r => r.id !== record.id), record]);
      return record;
    });
  }

  /** Takes a program off a field season. A locked record stays. */
  async removeRecord(id: string): Promise<void> {
    const current = this.record(id);
    if (!current || current.status === 'Locked') return;
    await this.write('remove the program', async () => {
      await this.backend.removeRecord(id);
      this._records.update(rs => rs.filter(r => r.id !== id));
    });
  }

  /** Unlocks a confirmed CI for correction, with the reason kept in its history. */
  async reopen(id: string, reason: string): Promise<boolean> {
    const current = this.record(id);
    if (!current || current.status !== 'Locked' || !reason.trim()) return false;
    const record = await this.write('reopen the field', () => this.backend.reopen(id, reason));
    if (!record) return false;
    this.putRecord(record);
    return true;
  }

  /** The field's CTRM tickets for its crop year (not kept in the store: the review reads them fresh). Throws on failure. */
  async fieldTickets(recordId: string): Promise<FieldTickets> {
    return this.backend.fieldTickets(recordId);
  }

  /**
   * Confirms a 45Z field after harvest with the producer: the actual yield and the tickets kept. The record
   * comes back locked with its confirmed CI (the official result). Undefined when refused; the store has said why.
   */
  async confirm(recordId: string, actualYield: number, ticketKeys: readonly string[], review: ConfirmReview): Promise<FieldProgramRecord | undefined> {
    await this.flush();
    const confirmed = await this.write('confirm the CI', () => this.backend.confirm(recordId, actualYield, ticketKeys, review));
    if (confirmed) this.putRecord(confirmed);
    return confirmed;
  }

  /** Notes that a confirmed field's Biofuel Feedstock Report is in Doc Store (the server has written the same id). */
  reportSaved(recordId: string, documentId: string): void {
    const record = this.record(recordId);
    if (record?.official) this.putRecord({ ...record, official: { ...record.official, reportDocumentId: documentId } });
  }

  ledgerSaved(recordId: string, documentId: string): void {
    const record = this.record(recordId);
    if (record?.official) this.putRecord({ ...record, official: { ...record.official, ledgerDocumentId: documentId } });
  }

  // ── Copying inputs between fields (same producer, program and year) ────────

  /**
   * The producer's other fields in the program this year whose inputs can be copied onto this season:
   * this crop row's first, then the rest by name. Ones the program would carry nothing from are left out.
   */
  copySources(seasonId: string, programKey: string): CopySource[] {
    const target = this.season(seasonId);
    const customerId = target && this.customerOfSeason(seasonId);
    const def = this.registry.get(programKey);
    if (!target || customerId === undefined || !def) return [];
    return this.records()
      .flatMap(r => {
        const season = this.season(r.seasonId);
        const field = season && this.field(season.fieldKey);
        if (r.programKey !== programKey || !season || !field || season.id === seasonId || season.year !== target.year
          || field.customerId !== customerId || !carries(def.copyForward(r.data, season.cropLabel, target.cropLabel))) return [];
        return [{ recordId: r.id, fieldName: field.name, cropLabel: season.cropLabel, status: r.status, sameRow: season.plantingIntentionId === target.plantingIntentionId }];
      })
      .sort((a, b) => Number(b.sameRow) - Number(a.sameRow) || a.fieldName.localeCompare(b.fieldName));
  }

  /** The producer's other fields this year that a record's inputs can be copied onto, by name. */
  copyTargets(sourceRecordId: string): CopyTarget[] {
    const source = this.record(sourceRecordId);
    const from = source && this.season(source.seasonId);
    const customerId = from && this.customerOfSeason(from.id);
    const def = source && this.registry.get(source.programKey);
    if (!source || !from || customerId === undefined || !def) return [];
    const full = Object.keys(def.copyForward(source.data, from.cropLabel, from.cropLabel) ?? {}).length;
    return this.seasons()
      .flatMap(season => {
        const field = this.field(season.fieldKey);
        if (season.id === from.id || season.year !== from.year || field?.customerId !== customerId || !def.appliesTo(season.cropLabel)) return [];
        const carried = def.copyForward(source.data, from.cropLabel, season.cropLabel);
        if (!carries(carried)) return [];
        const existing = this.find(season.id, source.programKey);
        const effect: CopyTarget['effect'] = existing?.status === 'Locked' ? 'locked'
          : Object.keys(carried!).length < full ? 'partial'
          : existing && JSON.stringify(existing.data) !== JSON.stringify(def.blankData()) ? 'replace'
          : 'empty';
        return [{ seasonId: season.id, fieldName: field.name, cropLabel: season.cropLabel, effect }];
      })
      .sort((a, b) => a.fieldName.localeCompare(b.fieldName));
  }

  /**
   * Copies a record's inputs onto other field seasons this year, by the program's copy rule (45Z: every
   * input for the same crop, tillage and cover crop only across crops, never the actual yield). The
   * program is added where a field doesn't have it; locked ones are skipped. Each copied record
   * keeps the source field's name.
   */
  async copyInputs(sourceRecordId: string, targetSeasonIds: readonly string[]): Promise<{ copied: number; skipped: number }> {
    const source = this.record(sourceRecordId);
    const from = source && this.season(source.seasonId);
    const sourceField = from && this.field(from.fieldKey);
    const def = source && this.registry.get(source.programKey);
    const result = { copied: 0, skipped: 0 };
    if (!source || !from || !sourceField || !def) return result;
    const allowed = new Set(this.copyTargets(sourceRecordId).filter(t => t.effect !== 'locked').map(t => t.seasonId));
    for (const seasonId of targetSeasonIds) {
      const season = this.season(seasonId);
      if (!season || !allowed.has(seasonId)) {
        result.skipped++;
        continue;
      }
      const target = this.find(seasonId, source.programKey) ?? await this.addRecord(seasonId, source.programKey);
      if (!target || target.status === 'Locked') {
        result.skipped++;
        continue;
      }
      const data = { ...(target.data as object), ...def.copyForward(source.data, from.cropLabel, season.cropLabel) };
      const status = this.statusOf({ ...target, data }, season);
      const saved = await this.write('copy the inputs', () => this.backend.updateRecord(target.id, data, status, sourceField.name));
      if (saved) {
        this.putRecord(saved);
        result.copied++;
      } else {
        result.skipped++;
      }
    }
    return result;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private statusOf(record: FieldProgramRecord, season: FieldSeason): FieldProgramRecord['status'] {
    if (record.status === 'Locked') return 'Locked';
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
      if (!alreadyShown(e)) this.toast.error(`Couldn't ${what}. ${e instanceof Error ? e.message : ''}`.trim());
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
        if (!alreadyShown(e)) this.toast.error(`Couldn't save your change. ${e instanceof Error ? e.message : ''}`.trim());
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
    this._records.update(rs => rs.map(r => (r.id === record.id ? record : r)));
  }

  private replaceCustomer(customerId: number, snapshot: FieldPlanSnapshot): void {
    const keys = new Set(this.fields().filter(f => f.customerId === customerId).map(f => f.fieldKey));
    const seasonIds = new Set(this.seasons().filter(s => keys.has(s.fieldKey)).map(s => s.id));
    this._fields.update(fs => [...fs.filter(f => f.customerId !== customerId), ...snapshot.fields]);
    this._seasons.update(ss => [...ss.filter(s => !keys.has(s.fieldKey)), ...snapshot.seasons]);
    this._records.update(rs => [...rs.filter(r => !seasonIds.has(r.seasonId)), ...snapshot.records]);
  }

  private setLoad(customerId: number, state: LoadState): void {
    this._load.update(m => new Map(m).set(customerId, state));
  }
}

/** A copy rule's result carries something. */
function carries(carried: object | null | undefined): boolean {
  return !!carried && Object.keys(carried).length > 0;
}
