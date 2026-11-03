import { InjectionToken, inject } from '@angular/core';
import { EnrollableRecord, FieldProgramRecord, FieldSeason, FieldTickets, ProducerField, ProgramEnrollment, ProgramRecordStatus, TDiscPass } from '@models';
import { environment } from '@env/environment';
import { InMemoryFieldPlanBackend } from './in-memory-field-plan-backend';
import { HttpFieldPlanBackend } from './http-field-plan-backend';

/** Everything one producer has in the field plan, every year: what the store holds per producer. */
export interface FieldPlanSnapshot {
  fields: ProducerField[];
  seasons: FieldSeason[];
  records: FieldProgramRecord[];
  enrollments: ProgramEnrollment[];
}

/**
 * Where the field plan is kept: the shape of the field-plan API. Each method is one request, and the
 * comment names the endpoint it maps to. `HttpFieldPlanBackend` calls it; `InMemoryFieldPlanBackend` plays the
 * server in the browser until the database is approved (`environment.fieldPlanBackend` picks one for
 * FIELD_PLAN_BACKEND; nothing else changes).
 *
 * Rules that must hold across users belong to the backend, not the store: refusing duplicate claims at
 * attestation, refusing to reopen a field an attested
 * enrollment holds, and confirming (the server rescores with its own FD-CIC calculator, so the
 * client never supplies the score of record). Methods reject (throw) when a rule refuses the change.
 */
export interface FieldPlanBackend {
  /** GET api/field-plan/customer/{customerId} */
  load(customerId: number): Promise<FieldPlanSnapshot>;

  /** POST api/field-plan/fields */
  createField(field: Omit<ProducerField, 'fieldKey'>): Promise<ProducerField>;
  /** PUT api/field-plan/fields/{fieldKey} */
  updateField(field: ProducerField): Promise<ProducerField>;

  /** POST api/field-plan/seasons */
  addSeason(season: Omit<FieldSeason, 'id'>): Promise<FieldSeason>;
  /** PUT api/field-plan/seasons/{id} */
  updateSeason(season: FieldSeason): Promise<FieldSeason>;
  /** DELETE api/field-plan/seasons/{id}: takes its unlocked program records with it. */
  removeSeason(seasonId: string): Promise<void>;

  /** POST api/field-plan/records */
  addRecord(record: Omit<FieldProgramRecord, 'id'>): Promise<FieldProgramRecord>;
  /**
   * PUT api/field-plan/records/{id}: refused once the record is Locked. `copiedFromField` is sent when the
   * data was copied from another field, and kept with the record.
   */
  updateRecord(id: string, data: unknown, status: ProgramRecordStatus, copiedFromField?: string): Promise<FieldProgramRecord>;
  /** DELETE api/field-plan/records/{id}: a Locked record is kept. */
  removeRecord(id: string): Promise<void>;
  /** POST api/field-plan/records/{id}/reopen: unlocks a confirmed CI; refused while an attested enrollment holds the record. */
  reopen(id: string, reason: string): Promise<FieldProgramRecord>;
  /**
   * GET api/field-plan/records/{id}/tickets: the field's CTRM tickets for its crop and crop year, settled or
   * not (delivered under its split ID; the applied contract's crop year, else the BL date in the window).
   */
  fieldTickets(id: string): Promise<FieldTickets>;
  /**
   * POST api/field-plan/records/{id}/confirm: after harvest, with the producer. The server reads the tickets
   * again (its bushels, never ours), checks the T-DISC rating against the tillage (no till and reduced till
   * need one; a rating that doesn't support the tillage steps it down), rescores with this actual yield,
   * locks, and records the confirmed CI with its bushels and tickets as the record's official result.
   */
  confirm(id: string, actualYield: number, ticketKeys: readonly string[], review: ConfirmReview): Promise<FieldProgramRecord>;

  /**
   * POST api/field-plan/enrollments: the producer's live enrollment in the program for the year, or a new
   * one (e.g. re-enrolling after a withdrawal). No ID is issued: each field's is derived from its split ID
   * and the crop year. Undefined for a program without enrollment.
   *
   * Future, for tickets and analytics: GET api/field-plan/enrollment?programKey&splitId&cropYear resolves
   * a split and crop year to its field, record and enrollment (FieldPlanStore.resolveEnrollment), so a
   * scale user never types an enrollment ID.
   */
  ensureEnrollment(programKey: string, customerId: number, year: number): Promise<ProgramEnrollment | undefined>;
  /** PUT api/field-plan/enrollments/{key}/attestation: only while Open. */
  updateAttestation(enrollment: ProgramEnrollment): Promise<ProgramEnrollment>;
  /** POST api/field-plan/enrollments/{key}/attest: refused while anything is outstanding. */
  attest(key: string, listed: readonly EnrollableRecord[]): Promise<ProgramEnrollment>;
  /** POST api/field-plan/enrollments/{key}/withdraw: kept with its reason; re-enrolling uses the same derived field IDs. */
  withdraw(key: string, reason: string): Promise<ProgramEnrollment>;
}

/** In memory or the API, per environment (`fieldPlanBackend`); see the environment files for why. */
export const FIELD_PLAN_BACKEND = new InjectionToken<FieldPlanBackend>('FIELD_PLAN_BACKEND', {
  providedIn: 'root',
  factory: () => environment.fieldPlanBackend === 'api' ? inject(HttpFieldPlanBackend) : inject(InMemoryFieldPlanBackend),
});

/** The review's other answers sent with a confirm. */
export interface ConfirmReview {
  /** The field's passes for USDA T-DISC, rated on the server; needed for no till and reduced till, ignored otherwise. */
  tDiscPasses: TDiscPass[] | null;
  /** The recordkeeping step's tick: what the producer must keep was reviewed with them. */
  recordkeepingReviewed: boolean;
}
