import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import type { FdCicScore, FdCicScoreRequest } from '../models/fd-cic.model';
import { FdCicApiService } from './fd-cic-api.service';

const BASE = `${environment.apiBaseUrl}/fd-cic`;

const request: FdCicScoreRequest = {
  crop: 'Corn', state: 'IA', county: 'Story', actualYield: 200, expectedYield: 190, syntheticN: 180, niFraction: 0.5,
  coverCrop: 'No cover crop', tillage: 'No till', manure: [],
};

const score = { label: 'USDA FD-CIC v1.2', ci: 3070.745, scorable: true } as FdCicScore;

/** Requests start on a microtask (reads happen inside computed signals), so let it run. */
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('FdCicApiService', () => {
  let service: FdCicApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(FdCicApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should start a score as loading, post it once for the crop year, then return the result', async () => {
    expect(service.score(2026, request)).toEqual({ status: 'loading' });
    expect(service.score(2026, request)).toEqual({ status: 'loading' });
    await tick();

    const call = http.expectOne(`${BASE}/2026/score`);
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(request);
    call.flush(score);

    expect(service.score(2026, request)).toEqual({ status: 'done', score });
    await tick();
    http.expectNone(`${BASE}/2026/score`);
  });

  it('should treat different inputs or a different year as a different score', async () => {
    service.score(2026, request);
    service.score(2026, { ...request, syntheticN: 150 });
    service.score(2027, request);
    await tick();
    expect(http.match(r => r.url.endsWith('/score'))).toHaveLength(3);
  });

  it('should keep the API\'s validation message, and hide server details', async () => {
    service.score(2026, request);
    service.score(2026, { ...request, county: 'Nowhere' });
    await tick();
    const [first, second] = http.match(r => r.url.endsWith('/score'));
    second.flush({ error: { code: 'VALIDATION_ERROR', message: 'One or more fields failed validation.',
      details: [{ field: 'county', message: 'Nowhere County, IA is not in USDA FD-CIC v1.2\'s county list.' }] } },
      { status: 400, statusText: 'Bad Request' });
    first.flush({ error: { code: 'FD_CIC_VERSION_UNAVAILABLE', message: 'A service dependency is unavailable.' } },
      { status: 503, statusText: 'Service Unavailable' });

    expect(service.score(2026, { ...request, county: 'Nowhere' })).toEqual({ status: 'error', message: 'Nowhere County, IA is not in USDA FD-CIC v1.2\'s county list.' });
    expect(service.score(2026, request)).toEqual({ status: 'error', message: 'The USDA calculator is unavailable right now.' });
  });

  it('should load the states and each state\'s counties once', async () => {
    expect(service.states()).toEqual([]);
    expect(service.counties('IA')).toEqual([]);
    expect(service.counties('')).toEqual([]);
    await tick();
    http.expectOne(`${BASE}/states`).flush(['IA', 'KS']);
    http.expectOne(r => r.url === `${BASE}/counties` && r.params.get('state') === 'IA').flush(['Boone', 'Story']);

    expect(service.states()).toEqual(['IA', 'KS']);
    expect(service.counties('IA')).toEqual(['Boone', 'Story']);
    await tick();
    http.expectNone(`${BASE}/states`);
  });
});
