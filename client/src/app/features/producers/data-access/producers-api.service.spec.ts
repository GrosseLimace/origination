import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { ProducersApiService } from './producers-api.service';

const BASE = environment.apiBaseUrl;

describe('ProducersApiService', () => {
  let service: ProducersApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ProducersApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ── DP Contracts ───────────────────────────────────────────────────────────

  it('getDpContracts() calls GET /dpcontracts', () => {
    service.getDpContracts().subscribe();
    const req = httpMock.expectOne(`${BASE}/dpcontracts`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getDpContracts() passes tradeUnits as a comma-joined param', () => {
    service.getDpContracts(['TU1', 'TU2']).subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/dpcontracts`);
    expect(req.request.params.get('tradeUnits')).toBe('TU1,TU2');
    req.flush([]);
  });

  it('getDpContractsByCustomer() calls GET /dpcontracts/customer/:id', () => {
    service.getDpContractsByCustomer(42).subscribe();
    const req = httpMock.expectOne(`${BASE}/dpcontracts/customer/42`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  // ── Planting Intentions ────────────────────────────────────────────────────

  it('createPlantingIntention() calls POST /plantingintentions', () => {
    const data = {
      customerId: 1, customerName: 'Smith', customerCode: 'S01',
      tradeUnit: 'TU1', crop: 'Corn', acres: 200, plantingYear: 2026
    };
    service.createPlantingIntention(data).subscribe();
    const req = httpMock.expectOne(`${BASE}/plantingintentions`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({});
  });

  it('deletePlantingIntention() calls DELETE /plantingintentions/:id', () => {
    service.deletePlantingIntention(11).subscribe();
    const req = httpMock.expectOne(`${BASE}/plantingintentions/11`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('getStoredGrainByCustomer() calls GET for one producer', () => {
    service.getStoredGrainByCustomer(7).subscribe();
    const req = httpMock.expectOne(r => r.url.startsWith(`${BASE}/`) && r.url.includes('7'));
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });
});
