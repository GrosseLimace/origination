import { Injectable, inject } from '@angular/core';
import { EnrollableRecord, FieldProgramRecord, FieldSeason, ProducerField, ProgramEnrollment, ProgramRecordStatus } from '@models';
import { ProgramRegistry } from '../programs/program-registry';
import { blankAttestation, enrollmentBlockers, formatEnrollmentId } from '../programs/program-enrollment';
import type { FieldPlanBackend, FieldPlanSnapshot, ReopenResult } from './field-plan-backend';

/** A deep copy, as a JSON round trip, the way data comes back from the API (undefined fields drop out). */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * PROTOTYPE ONLY: plays the field-plan server in the browser until the database is approved. It holds
 * every producer's fields, seasons, program records and enrollments in memory (a reload starts over)
 * and enforces the rules the real server will own: one enrollment ID sequence per program, duplicate
 * claims refused at attestation, no reopening a field an attested enrollment holds, and locking.
 * Everything handed out is a copy, as if it had come over the wire.
 */
@Injectable({ providedIn: 'root' })
export class InMemoryFieldPlanBackend implements FieldPlanBackend {
  private readonly registry = inject(ProgramRegistry);

  private fields: ProducerField[] = [];
  private seasons: FieldSeason[] = [];
  private records: FieldProgramRecord[] = [];
  private enrollments: ProgramEnrollment[] = [];
  private nextSeasonId = 1;
  private nextRecordId = 1;
  /** Per program, so each program's IDs run from 000001 across every producer and year. */
  private readonly nextSeq = new Map<string, number>();

  async load(customerId: number): Promise<FieldPlanSnapshot> {
    const fields = this.fields.filter(f => f.customerId === customerId);
    const keys = new Set(fields.map(f => f.fieldKey));
    const seasons = this.seasons.filter(s => keys.has(s.fieldKey));
    const seasonIds = new Set(seasons.map(s => s.id));
    return copy({
      fields,
      seasons,
      records: this.records.filter(r => seasonIds.has(r.seasonId)),
      enrollments: this.enrollments.filter(e => e.customerId === customerId),
    });
  }

  // ── Fields and seasons ───────────────────────────────────────────────────

  /** A field is one CTRM split, so its key is the split ID, and a split is one producer's field. */
  async createField(field: Omit<ProducerField, 'fieldKey'>): Promise<ProducerField> {
    const splitId = field.splitId.trim().toUpperCase();
    const existing = this.fields.find(f => f.fieldKey === splitId);
    if (existing && existing.customerId !== field.customerId) throw new Error(`Split ${splitId} is another producer's field.`);
    if (existing) return copy(existing);
    const created: ProducerField = { ...copy(field), splitId, fieldKey: splitId };
    this.fields.push(created);
    return copy(created);
  }

  /** Only the location changes: the split ID, name, split % and effective date are CTRM's. */
  async updateField(field: ProducerField): Promise<ProducerField> {
    const i = this.indexOf(this.fields, f => f.fieldKey === field.fieldKey, 'field');
    this.fields[i] = { ...this.fields[i], state: field.state, county: field.county };
    return copy(this.fields[i]);
  }

  async addSeason(season: Omit<FieldSeason, 'id'>): Promise<FieldSeason> {
    this.indexOf(this.fields, f => f.fieldKey === season.fieldKey, 'field');
    const created: FieldSeason = { ...copy(season), id: `s${this.nextSeasonId++}` };
    this.seasons.push(created);
    return copy(created);
  }

  async updateSeason(season: FieldSeason): Promise<FieldSeason> {
    const i = this.indexOf(this.seasons, s => s.id === season.id, 'season');
    if (this.records.some(r => r.seasonId === season.id && r.status === 'Locked')) {
      throw new Error('This field has a locked harvest estimate, so its acres can\'t change.');
    }
    this.seasons[i] = copy(season);
    return copy(season);
  }

  async removeSeason(seasonId: string): Promise<void> {
    if (this.records.some(r => r.seasonId === seasonId && r.status === 'Locked')) {
      throw new Error('This field has a locked harvest estimate and can\'t come off the crop row.');
    }
    this.records = this.records.filter(r => r.seasonId !== seasonId);
    this.seasons = this.seasons.filter(s => s.id !== seasonId);
  }

  // ── Program records ─────────────────────────────────────────────────────

  async addRecord(record: Omit<FieldProgramRecord, 'id'>): Promise<FieldProgramRecord> {
    this.indexOf(this.seasons, s => s.id === record.seasonId, 'season');
    const existing = this.records.find(r => r.seasonId === record.seasonId && r.programKey === record.programKey);
    if (existing) return copy(existing);
    const created: FieldProgramRecord = { ...copy(record), id: `r${this.nextRecordId++}` };
    this.records.push(created);
    return copy(created);
  }

  async updateRecord(id: string, data: unknown, status: ProgramRecordStatus, copiedFromField?: string): Promise<FieldProgramRecord> {
    const i = this.indexOf(this.records, r => r.id === id, 'program record');
    if (this.records[i].status === 'Locked') throw new Error('This harvest estimate is locked; unlock it to make changes.');
    if (status === 'Locked') throw new Error('Harvest estimates are locked by harvest complete, not by saving.');
    this.records[i] = { ...this.records[i], data: copy(data), status, ...(copiedFromField ? { copiedFromField } : {}) };
    return copy(this.records[i]);
  }

  async removeRecord(id: string): Promise<void> {
    this.records = this.records.filter(r => r.id !== id || r.status === 'Locked');
  }

  async lock(id: string, by: string): Promise<FieldProgramRecord> {
    const i = this.indexOf(this.records, r => r.id === id, 'program record');
    const current = this.records[i];
    if (current.status === 'Locked') return copy(current);
    const season = this.seasons.find(s => s.id === current.seasonId)!;
    const field = this.fields.find(f => f.fieldKey === season.fieldKey)!;
    const def = this.registry.get(current.programKey);
    if (!def) throw new Error(`Unknown program ${current.programKey}.`);
    const missing = def.lockMissing(current.data, season, field);
    if (missing.length > 0) throw new Error(`Still needed before locking: ${missing.join(', ')}.`);
    // The real server rescores here with its own calculator rather than trusting the client.
    // Always a planning estimate: an official result is a separate thing (see FieldProgramRecord.official).
    const frozen = { ...def.freeze(current.data, season, field), basis: 'Estimate' as const, lockedBy: by, lockedAt: new Date().toISOString() };
    this.records[i] = { ...current, status: 'Locked', frozen };
    return copy(this.records[i]);
  }

  async reopen(id: string, reason: string): Promise<ReopenResult> {
    const i = this.indexOf(this.records, r => r.id === id, 'program record');
    const current = this.records[i];
    if (current.status !== 'Locked' || !current.frozen) throw new Error('Only a locked harvest estimate can be unlocked.');
    if (!reason.trim()) throw new Error('Give a reason for reopening.');
    if (this.heldBy(id)) throw new Error('The producer\'s attested enrollment holds this record, so it can\'t be reopened.');

    const season = this.seasons.find(s => s.id === current.seasonId)!;
    const def = this.registry.get(current.programKey);
    const reopened: FieldProgramRecord = {
      ...current,
      frozen: undefined,
      status: def && def.missing(current.data, season).length === 0 ? 'Ready' : 'Draft',
      reopened: [...(current.reopened ?? []), { reason: reason.trim(), at: new Date().toISOString(), frozen: current.frozen }],
    };
    this.records[i] = reopened;

    // Reopening a field reopens its enrollment's harvest.
    const field = this.fields.find(f => f.fieldKey === season.fieldKey)!;
    const e = this.enrollments.findIndex(x => x.programKey === current.programKey && x.customerId === field.customerId
      && x.year === season.year && x.status !== 'Withdrawn');
    if (e >= 0) this.enrollments[e] = { ...this.enrollments[e], harvestCompleteAt: undefined };
    return copy({ record: reopened, enrollment: e >= 0 ? this.enrollments[e] : undefined });
  }

  // ── Enrollments ─────────────────────────────────────────────────────────

  async ensureEnrollment(programKey: string, customerId: number, year: number): Promise<ProgramEnrollment | undefined> {
    const existing = this.enrollments.find(e => e.programKey === programKey && e.customerId === customerId && e.year === year && e.status !== 'Withdrawn');
    const config = this.registry.get(programKey)?.enrollment;
    if (existing || !config) return existing && copy(existing);
    const seq = this.nextSeq.get(programKey) ?? 1;
    this.nextSeq.set(programKey, seq + 1);
    const created: ProgramEnrollment = {
      key: crypto.randomUUID(), programKey, enrollmentId: formatEnrollmentId(config.idPrefix, year, seq),
      customerId, year, status: 'Open', attestation: blankAttestation(config.statements),
    };
    this.enrollments.push(created);
    return copy(created);
  }

  async updateAttestation(enrollment: ProgramEnrollment): Promise<ProgramEnrollment> {
    const i = this.indexOf(this.enrollments, e => e.key === enrollment.key, 'enrollment');
    if (this.enrollments[i].status !== 'Open') throw new Error('Only an open enrollment\'s attestation can change.');
    this.enrollments[i] = { ...this.enrollments[i], attestation: copy(enrollment.attestation) };
    return copy(this.enrollments[i]);
  }

  async attest(key: string, listed: readonly EnrollableRecord[]): Promise<ProgramEnrollment> {
    const i = this.indexOf(this.enrollments, e => e.key === key, 'enrollment');
    const e = this.enrollments[i];
    if (e.status !== 'Open') throw new Error('Only an open enrollment can be attested.');
    const statements = this.registry.get(e.programKey)?.enrollment?.statements ?? [];
    // Checked against every producer's enrollments: a field can't be claimed twice.
    const blockers = enrollmentBlockers(e, listed, this.enrollments, statements);
    if (blockers.length > 0) throw new Error(`Before attesting: ${blockers.join('; ')}.`);
    this.enrollments[i] = { ...e, status: 'Attested', attestedBy: 'you', attestedAt: new Date().toISOString(), snapshot: copy([...listed]) };
    return copy(this.enrollments[i]);
  }

  async setHarvestComplete(key: string, complete: boolean): Promise<ProgramEnrollment> {
    const i = this.indexOf(this.enrollments, e => e.key === key, 'enrollment');
    this.enrollments[i] = { ...this.enrollments[i], harvestCompleteAt: complete ? new Date().toISOString() : undefined };
    return copy(this.enrollments[i]);
  }

  async withdraw(key: string, reason: string): Promise<ProgramEnrollment> {
    const i = this.indexOf(this.enrollments, e => e.key === key, 'enrollment');
    if (!reason.trim()) throw new Error('Give a reason for withdrawing.');
    if (this.enrollments[i].status !== 'Withdrawn') {
      this.enrollments[i] = { ...this.enrollments[i], status: 'Withdrawn', withdrawnReason: reason.trim() };
    }
    return copy(this.enrollments[i]);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private heldBy(recordId: string): ProgramEnrollment | undefined {
    return this.enrollments.find(e => e.status === 'Attested' && (e.snapshot ?? []).some(r => r.recordId === recordId));
  }

  private indexOf<T>(items: T[], match: (item: T) => boolean, what: string): number {
    const i = items.findIndex(match);
    if (i < 0) throw new Error(`That ${what} no longer exists.`);
    return i;
  }
}
