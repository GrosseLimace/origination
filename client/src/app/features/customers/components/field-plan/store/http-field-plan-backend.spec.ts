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
  attestedBy: null, attestedAt: null, snapshot: null, harvestCompleteAt: null, withdrawnReason: null,
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
    const field = backend.createField({ splitId: 'TATOB43', customerId: 9, name: 'ignored', splitPercent: 1, effectiveDate: '', state: 'KS', county: '' });
    const req = http.expectOne(`${BASE}/fields`);
    expect(req.request.body).toEqual({ customerId: 9, splitId: 'TATOB43', state: 'KS', county: null });
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

  it('should lock with no body: the server locks as the signed-in user and rescores', async () => {
    const locking = backend.lock('7', 'someone');
    const req = http.expectOne(`${BASE}/records/7/lock`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    req.flush({ ...record, status: 'Locked', frozen: { basis: 'Estimate' } });

    const locked: FieldProgramRecord = await locking;
    expect(locked.status).toBe('Locked');
    expect(locked.frozen).toEqual({ basis: 'Estimate' });
  });

  it('should return undefined for a program without enrollment (204)', async () => {
    const ensuring = backend.ensureEnrollment('graincraft', 9, 2026);
    const req = http.expectOne(`${BASE}/enrollments`);
    expect(req.request.body).toEqual({ programKey: 'graincraft', customerId: 9, year: 2026 });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(await ensuring).toBeUndefined();
  });

  it('should send the attestation alone, and the reopen result without a null enrollment', async () => {
    const attestation = backend.updateAttestation(enrollment as unknown as ProgramEnrollment);
    const req = http.expectOne(`${BASE}/enrollments/e1/attestation`);
    expect(Object.keys(req.request.body)).toEqual(['attestation']);
    req.flush(enrollment);
    await attestation;

    const reopening = backend.reopen('7', 'wrong yield');
    http.expectOne(`${BASE}/records/7/reopen`).flush({ record, enrollment: null });
    expect(await reopening).toEqual({ record: { id: '7', seasonId: '3', programKey: '45z-fdcic', data: { expectedYield: 190 }, status: 'Ready' } });
  });

  it('should reject with the server\'s message, which the store shows', async () => {
    const locking = backend.lock('7', 'x');
    http.expectOne(`${BASE}/records/7/lock`).flush(
      { error: { code: 'FIELD_PLAN_LOCK_INCOMPLETE', message: 'Still needed before locking: actual yield.' } },
      { status: 422, statusText: 'Unprocessable Entity' });

    const error = await locking.catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Still needed before locking: actual yield.');
  });
});
