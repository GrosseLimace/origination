import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { MobileApiService, newClientRequestId } from './mobile-api.service';

describe('MobileApiService', () => {
  let api: MobileApiService;
  let http: HttpTestingController;
  const base = environment.apiBaseUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(MobileApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('searches with q, repeated tradeUnits and limit', async () => {
    const pending = api.searchCustomers('smith', ['1001', '1002'], 25);
    const req = http.expectOne((r) => r.url === `${base}/customers`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('smith');
    expect(req.request.params.getAll('tradeUnits')).toEqual(['1001', '1002']);
    expect(req.request.params.get('limit')).toBe('25');
    req.flush([]);
    expect(await pending).toEqual([]);
  });

  it('browses without q when no term is given', async () => {
    const pending = api.searchCustomers(undefined, ['1001']);
    const req = http.expectOne((r) => r.url === `${base}/customers`);
    expect(req.request.params.has('q')).toBe(false);
    expect(req.request.params.getAll('tradeUnits')).toEqual(['1001']);
    req.flush([]);
    expect(await pending).toEqual([]);
  });

  it('posts a note with the idempotency id in the body, under the customer route', async () => {
    const body = { clientRequestId: newClientRequestId(), content: 'Met at the bin site' };
    const pending = api.createNote(42, body);
    const req = http.expectOne(`${base}/customers/42/notes`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ id: 1, customerId: 42, content: body.content, createdBy: 'me', createdAt: '2026-09-23T00:00:00Z', isPinned: false }, { status: 201, statusText: 'Created' });
    expect((await pending).id).toBe(1);
  });

  it('an acres-only save omits the lists, so the server keeps the stored sites and grain', async () => {
    const pending = api.updateProducerDetails(7, { clientRequestId: newClientRequestId(), totalAcres: 1200, expectedModifiedAt: '2026-09-01T00:00:00Z' });
    const req = http.expectOne(`${base}/customers/7/details`);
    expect(req.request.method).toBe('PUT');
    expect(Object.keys(req.request.body).sort()).toEqual(['clientRequestId', 'expectedModifiedAt', 'totalAcres']);
    req.flush({ customerId: 7, binSites: [], grainOnFarm: [] });
    expect((await pending).customerId).toBe(7);
  });

  it('omits cropYear when not given and includes it when given', async () => {
    const a = api.getTicketSummary(3);
    http.expectOne((r) => r.url === `${base}/customers/3/tickets/summary` && !r.params.has('cropYear')).flush({ totalTickets: 0, totalBushels: 0, groups: [] });
    await a;
    const b = api.getTicketSummary(3, 2026);
    http.expectOne((r) => r.url === `${base}/customers/3/tickets/summary` && r.params.get('cropYear') === '2026').flush({ totalTickets: 0, totalBushels: 0, groups: [] });
    await b;
  });

  it('generates RFC 4122 v4 ids', () => {
    expect(newClientRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
