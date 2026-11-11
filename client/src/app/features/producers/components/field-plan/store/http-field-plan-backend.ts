import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError } from '@core/errors/api-error';
import { environment } from '@env/environment';
import { FieldProgramRecord, FieldSeason, FieldTickets, ProducerField, ProgramRecordStatus } from '../../../models/field-plan.model';
import type { ConfirmReview, FieldPlanBackend, FieldPlanSnapshot } from './field-plan-backend';

/**
 * Drops null properties, so optional fields read as absent, as they do from the in-memory backend
 * (record.frozen, record.official…).
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
    };
  }

  createField(field: Omit<ProducerField, 'fieldKey'>): Promise<ProducerField> {
    return this.send(this.http.post<ProducerField>(`${this.base}/fields`, {
      customerId: field.customerId, splitId: field.splitId, state: field.state || null, county: field.county || null,
      // SPLITS-GRAPHQL: used only while splits are typed by hand; with CTRM's splits query the server takes CTRM's.
      name: field.name || null, splitPercent: field.splitPercent || null, effectiveDate: field.effectiveDate || null,
    }));
  }

  updateField(field: ProducerField): Promise<ProducerField> {
    return this.send(this.http.put<ProducerField>(`${this.base}/fields/${encodeURIComponent(field.fieldKey)}`, {
      state: field.state || null, county: field.county || null,
      // Kept only for a split typed by hand (the server ignores them for CTRM's).
      name: field.name || null, splitPercent: field.splitPercent || null,
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

  async reopen(id: string, reason: string): Promise<FieldProgramRecord> {
    return withoutNulls(await this.send(this.http.post<FieldProgramRecord>(`${this.base}/records/${id}/reopen`, { reason })));
  }

  fieldTickets(id: string): Promise<FieldTickets> {
    return this.send(this.http.get<FieldTickets>(`${this.base}/records/${id}/tickets`));
  }

  /** The server reads the tickets again and uses its own bushels; it only needs which ones were kept. */
  async confirm(id: string, actualYield: number, ticketKeys: readonly string[], review: ConfirmReview): Promise<FieldProgramRecord> {
    return withoutNulls(await this.send(this.http.post<FieldProgramRecord>(`${this.base}/records/${id}/confirm`, {
      actualYield, ticketKeys, reviewedWithProducer: review.recordkeepingReviewed, tDiscPasses: review.tDiscPasses,
    })));
  }

  private async send<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (e) {
      throw e instanceof HttpErrorResponse ? ApiError.fromHttpErrorResponse(e) : ApiError.fromUnknown(e);
    }
  }
}
