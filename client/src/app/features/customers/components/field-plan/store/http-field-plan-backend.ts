import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError } from '@core/errors/api-error';
import { environment } from '@env/environment';
import { EnrollableRecord, FieldProgramRecord, FieldSeason, ProducerField, ProgramEnrollment, ProgramRecordStatus } from '@models';
import type { FieldPlanBackend, FieldPlanSnapshot, ReopenResult } from './field-plan-backend';

/**
 * Drops null properties, so optional fields read as absent, as they do from the in-memory backend
 * (record.frozen, enrollment.snapshot…).
 */
function withoutNulls<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null)) as T;
}

/**
 * The field plan kept by the API (api/field-plan) and its database. Chosen with
 * `environment.fieldPlanBackend: 'api'`. The server owns the rules (locking rescores on the server, Draft/Ready
 * is its call, a split's name and share come from CTRM), so this only sends requests in the shapes the API
 * declares (it refuses unknown properties) and turns its errors into ApiErrors whose message is the
 * server's, which the store shows in its toasts.
 */
@Injectable({ providedIn: 'root' })
export class HttpFieldPlanBackend implements FieldPlanBackend {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/field-plan`;

  async load(customerId: number): Promise<FieldPlanSnapshot> {
    const s = await this.send(this.http.get<FieldPlanSnapshot>(`${this.base}/customer/${customerId}`));
    return {
      fields: s.fields,
      seasons: s.seasons,
      records: s.records.map(r => withoutNulls(r)),
      enrollments: s.enrollments.map(e => withoutNulls(e)),
    };
  }

  createField(field: Omit<ProducerField, 'fieldKey'>): Promise<ProducerField> {
    return this.send(this.http.post<ProducerField>(`${this.base}/fields`, {
      customerId: field.customerId, splitId: field.splitId, state: field.state || null, county: field.county || null,
    }));
  }

  updateField(field: ProducerField): Promise<ProducerField> {
    return this.send(this.http.put<ProducerField>(`${this.base}/fields/${encodeURIComponent(field.fieldKey)}`, {
      state: field.state || null, county: field.county || null,
    }));
  }

  addSeason(season: Omit<FieldSeason, 'id'>): Promise<FieldSeason> {
    return this.send(this.http.post<FieldSeason>(`${this.base}/seasons`, {
      fieldKey: season.fieldKey, plantingIntentionId: season.plantingIntentionId, year: season.year,
      cropLabel: season.cropLabel, acres: season.acres,
    }));
  }

  updateSeason(season: FieldSeason): Promise<FieldSeason> {
    return this.send(this.http.put<FieldSeason>(`${this.base}/seasons/${season.id}`, { acres: season.acres }));
  }

  async removeSeason(seasonId: string): Promise<void> {
    await this.send(this.http.delete<void>(`${this.base}/seasons/${seasonId}`));
  }

  async addRecord(record: Omit<FieldProgramRecord, 'id'>): Promise<FieldProgramRecord> {
    return withoutNulls(await this.send(this.http.post<FieldProgramRecord>(`${this.base}/records`, {
      seasonId: record.seasonId, programKey: record.programKey, data: record.data, copiedFromYear: record.copiedFromYear ?? null,
    })));
  }

  /** The server works out Draft/Ready itself, so `status` isn't sent. */
  async updateRecord(id: string, data: unknown, _status: ProgramRecordStatus, copiedFromField?: string): Promise<FieldProgramRecord> {
    return withoutNulls(await this.send(this.http.put<FieldProgramRecord>(`${this.base}/records/${id}`, {
      data, copiedFromField: copiedFromField ?? null,
    })));
  }

  async removeRecord(id: string): Promise<void> {
    await this.send(this.http.delete<void>(`${this.base}/records/${id}`));
  }

  /** Locked by the signed-in user on the server, so `by` isn't sent. */
  async lock(id: string, _by: string): Promise<FieldProgramRecord> {
    return withoutNulls(await this.send(this.http.post<FieldProgramRecord>(`${this.base}/records/${id}/lock`, null)));
  }

  async reopen(id: string, reason: string): Promise<ReopenResult> {
    const r = await this.send(this.http.post<{ record: FieldProgramRecord; enrollment: ProgramEnrollment | null }>(
      `${this.base}/records/${id}/reopen`, { reason }));
    return { record: withoutNulls(r.record), ...(r.enrollment ? { enrollment: withoutNulls(r.enrollment) } : {}) };
  }

  /** 204 (no body) for a program without enrollment. */
  async ensureEnrollment(programKey: string, customerId: number, year: number): Promise<ProgramEnrollment | undefined> {
    const e = await this.send(this.http.post<ProgramEnrollment | null>(`${this.base}/enrollments`, { programKey, customerId, year }));
    return e ? withoutNulls(e) : undefined;
  }

  async updateAttestation(enrollment: ProgramEnrollment): Promise<ProgramEnrollment> {
    const a = enrollment.attestation;
    return withoutNulls(await this.send(this.http.put<ProgramEnrollment>(`${this.base}/enrollments/${enrollment.key}/attestation`, {
      attestation: { signerName: a.signerName, signedOn: a.signedOn, method: a.method, documentRef: a.documentRef, confirmations: a.confirmations },
    })));
  }

  async attest(key: string, listed: readonly EnrollableRecord[]): Promise<ProgramEnrollment> {
    return withoutNulls(await this.send(this.http.post<ProgramEnrollment>(`${this.base}/enrollments/${key}/attest`, { listed })));
  }

  async setHarvestComplete(key: string, complete: boolean): Promise<ProgramEnrollment> {
    return withoutNulls(await this.send(this.http.put<ProgramEnrollment>(`${this.base}/enrollments/${key}/harvest-complete`, { complete })));
  }

  async withdraw(key: string, reason: string): Promise<ProgramEnrollment> {
    return withoutNulls(await this.send(this.http.post<ProgramEnrollment>(`${this.base}/enrollments/${key}/withdraw`, { reason })));
  }

  private async send<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (e) {
      throw e instanceof HttpErrorResponse ? ApiError.fromHttpErrorResponse(e) : ApiError.fromUnknown(e);
    }
  }
}
