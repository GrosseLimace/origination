import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError } from '@core/errors/api-error';
import { environment } from '@env/environment';
import { FieldPlanDocument, FieldPlanUploadType } from '../../../models/field-plan.model';

/**
 * A producer's 45Z documents in Doc Store, through the API (Doc Store is reached only by the server, with the
 * app's managed identity). The server sets every document's metadata from its own rows; this sends files only.
 * Needs `fieldPlanBackend: 'api'`: with the in-memory field plan there are no server records to save against.
 * Methods throw ApiError, whose message is the server's.
 */
@Injectable({ providedIn: 'root' })
export class FieldPlanDocumentsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/field-plan`;

  /** Whether 45Z documents are available here: they live beside the field plan in the API. */
  readonly enabled = environment.fieldPlanBackend === 'api';

  list(customerId: number, year?: number): Promise<FieldPlanDocument[]> {
    const query = year ? `?year=${year}` : '';
    return this.send(this.http.get<FieldPlanDocument[]>(`${this.base}/customer/${customerId}/documents${query}`));
  }

  upload(customerId: number, year: number, documentType: FieldPlanUploadType, file: File): Promise<FieldPlanDocument> {
    const form = new FormData();
    form.append('year', String(year));
    form.append('documentType', documentType);
    form.append('file', file, file.name);
    return this.send(this.http.post<FieldPlanDocument>(`${this.base}/customer/${customerId}/documents`, form));
  }

  /** Saves a confirmed field's Biofuel Feedstock Report; a repeat for the same confirmation returns the first. */
  saveReport(recordId: string, pdf: Blob, fileName: string): Promise<FieldPlanDocument> {
    const form = new FormData();
    form.append('file', pdf, fileName);
    return this.send(this.http.post<FieldPlanDocument>(`${this.base}/records/${encodeURIComponent(recordId)}/report`, form));
  }

  /** Saves a confirmed field's Mass Balance Ledger (CSV); a repeat for the same confirmation returns the first. */
  saveLedger(recordId: string, csv: Blob, fileName: string): Promise<FieldPlanDocument> {
    const form = new FormData();
    form.append('file', csv, fileName);
    return this.send(this.http.post<FieldPlanDocument>(`${this.base}/records/${encodeURIComponent(recordId)}/ledger`, form));
  }

  /** Sets a current document aside, with an optional reason. It stays in the version history. */
  archive(customerId: number, documentId: string, note: string | null): Promise<FieldPlanDocument> {
    return this.send(this.http.post<FieldPlanDocument>(
      `${this.base}/customer/${customerId}/documents/${encodeURIComponent(documentId)}/archive`, { note }));
  }

  /** Brings an archived document back to current. */
  restore(customerId: number, documentId: string): Promise<FieldPlanDocument> {
    return this.send(this.http.post<FieldPlanDocument>(
      `${this.base}/customer/${customerId}/documents/${encodeURIComponent(documentId)}/restore`, {}));
  }

  /** The document's bytes, for opening or saving in the browser. */
  async content(customerId: number, documentId: string): Promise<Blob> {
    return this.send(this.http.get(`${this.base}/customer/${customerId}/documents/${encodeURIComponent(documentId)}`, { responseType: 'blob' }));
  }

  private async send<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (e) {
      throw e instanceof HttpErrorResponse ? ApiError.fromHttpErrorResponse(e) : ApiError.fromUnknown(e);
    }
  }
}
