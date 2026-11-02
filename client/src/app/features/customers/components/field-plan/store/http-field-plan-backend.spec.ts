import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { ApiError } from '@core/errors/api-error';
import type { FieldProgramRecord, ProgramEnrollment } from '@models';
import { HttpFieldPlanBackend } from './http-field-plan-backend';

const BASE = `${environment.apiBaseUrl}/field-plan`;

const record = {
  id: '7', seasonId: '3', programKey: '45z-fdcic', data: { expectedYield: 190 }, status: 'Ready',
  copiedFromYear: null, copiedFromField: null, frozen: null, official: null, reopened: null,
};
const enrollment = {
  key: 'e1', programKey: '45z-fdcic', customerId: 9, year: 2026, status: 'Open',
  attestation: { signerName: '', signedOn: '', method: 'eSign', documentRef: '', confirmations: { recordsAccurate: false } },
  attestedBy: null, attestedAt: null, snapshot: null, withdrawnReason: null,
};

describe('HttpFieldPlanBackend', () => {
  let backend: HttpFieldPlanBackend;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    backend = TestBed.inject(HttpFieldPlanBackend);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should load a producer and drop nulls, so optional parts read as absent', async () => {
    const loading = backend.load(9);
    http.expectOne(`${BASE}/customer/9`).flush({ fields: [], seasons: [], records: [record], enrollments: [enrollment] });
    const snapshot = await loading;

    expect(snapshot.records[0]).toEqual({ id: '7', seasonId: '3', programKey: '45z-fdcic', data: { expectedYield: 190 }, status: 'Ready' });
    expect('frozen' in snapshot.records[0]).toBe(false);
    expect('snapshot' in snapshot.enrollments[0]).toBe(false);
  });

  it('should send only what the API declares (it refuses unknown properties)', async () => {
    const field = backend.createField({ splitId: 'TATOB43', customerId: 9, name: 'Jarboe West', splitPercent: 50, effectiveDate: '', state: 'KS', county: '', splitSource: 'Manual' });
    const req = http.expectOne(`${BASE}/fields`);
    // SPLITS-GRAPHQL: name and share are sent for a split typed by hand; the server ignores them for CTRM's.
    expect(req.request.body).toEqual({
      customerId: 9, splitId: 'TATOB43', state: 'KS', county: null, name: 'Jarboe West', splitPercent: 50, effectiveDate: null,
    });
    req.flush({});
    await field;

    const saved = backend.updateRecord('7', { expectedYield: 190 }, 'Ready', 'NORTH 80');
    const put = http.expectOne(`${BASE}/records/7`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ data: { expectedYield: 190 }, copiedFromField: 'NORTH 80' });
    put.flush(record);
    expect(await saved).not.toHaveProperty('frozen');

    const season = backend.updateSeason({ id: '3', fieldKey: 'TATOB43', plantingIntentionId: 10, year: 2026, cropLabel: 'Corn', acres: 120 });
    const seasonReq = http.expectOne(`${BASE}/seasons/3`);
    expect(seasonReq.request.body).toEqual({ acres: 120 });
    seasonReq.flush({});
    await season;
  });

  it('should confirm with the yield and ticket keys, and the server rescores and locks', async () => {
    const confirming = backend.confirm('7', 205, ['P1', 'P2']);
    const req = http.expectOne(`${BASE}/records/7/confirm`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ actualYield: 205, ticketKeys: ['P1', 'P2'], reviewedWithProducer: true });
    req.flush({ ...record, status: 'Locked', frozen: { basis: 'Estimate' } });

    const locked: FieldProgramRecord = await confirming;
    expect(locked.status).toBe('Locked');
    expect(locked.frozen).toEqual({ basis: 'Estimate' });
  });

  it('should return undefined for a program without enrollment (204)', async () => {
    const ensuring = backend.ensureEnrollment('no-enrollment-program', 9, 2026);
    const req = http.expectOne(`${BASE}/enrollments`);
    expect(req.request.body).toEqual({ programKey: 'no-enrollment-program', customerId: 9, year: 2026 });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(await ensuring).toBeUndefined();
  });

  it('should send the attestation alone, and return the reopened record without nulls', async () => {
    const attestation = backend.updateAttestation(enrollment as unknown as ProgramEnrollment);
    const req = http.expectOne(`${BASE}/enrollments/e1/attestation`);
    expect(Object.keys(req.request.body)).toEqual(['attestation']);
    req.flush(enrollment);
    await attestation;

    const reopening = backend.reopen('7', 'wrong yield');
    const reopen = http.expectOne(`${BASE}/records/7/reopen`);
    expect(reopen.request.body).toEqual({ reason: 'wrong yield' });
    reopen.flush({ ...record, frozen: null });
    expect(await reopening).toEqual({ id: '7', seasonId: '3', programKey: '45z-fdcic', data: { expectedYield: 190 }, status: 'Ready' });
  });

  it('should reject with the server\'s message, which the store shows', async () => {
    const confirming = backend.confirm('7', 205, ['P1']);
    http.expectOne(`${BASE}/records/7/confirm`).flush(
      { error: { code: 'FIELD_PLAN_STALE_TICKETS', message: 'Some of those tickets are no longer this field\'s in CTRM.' } },
      { status: 409, statusText: 'Conflict' });

    const error: unknown = await confirming.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Some of those tickets are no longer this field\'s in CTRM.');
  });
});
