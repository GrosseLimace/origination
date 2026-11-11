import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { CustomersApiService } from './customers-api.service';

const BASE = environment.apiBaseUrl;

describe('CustomersApiService', () => {
  let service: CustomersApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CustomersApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('searchCustomers() calls GET /customers/search with the term and any trade units', () => {
    service.searchCustomers('Smith', ['TU1', 'TU2']).subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/customers/search`);
    expect(req.request.params.get('searchTerm')).toBe('Smith');
    expect(req.request.params.getAll('tradeUnits')).toEqual(['TU1', 'TU2']);
    req.flush([]);
  });

  it('searchOdsCustomers() calls GET /customers/search-ods, and finds no one when it fails', () => {
    let found: unknown;
    service.searchOdsCustomers('Zed').subscribe(customers => found = customers);
    const req = httpMock.expectOne(r => r.url === `${BASE}/customers/search-ods`);
    expect(req.request.params.get('searchTerm')).toBe('Zed');
    req.flush('down', { status: 500, statusText: 'Server Error' });
    expect(found).toEqual([]);
  });

  it('getCustomers() calls GET /customers', () => {
    service.getCustomers().subscribe();
    const req = httpMock.expectOne(`${BASE}/customers`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getCustomers() passes tradeUnits as repeated params', () => {
    service.getCustomers(['TU1', 'TU2']).subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/customers`);
    expect(req.request.params.getAll('tradeUnits')).toEqual(['TU1', 'TU2']);
    req.flush([]);
  });

  it('getCustomers() shares one request between callers asking for the same trade units at once', () => {
    service.getCustomers(['TU2', 'TU1']).subscribe();
    service.getCustomers(['TU1', 'TU2']).subscribe();
    httpMock.expectOne(r => r.url === `${BASE}/customers`).flush([]);
  });

  it('getCustomerById() calls GET /customers/:id', () => {
    service.getCustomerById(42).subscribe();
    const req = httpMock.expectOne(`${BASE}/customers/42`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('getCustomerBySourceId() escapes the source id', () => {
    service.getCustomerBySourceId('AB/12').subscribe();
    httpMock.expectOne(`${BASE}/customers/by-source/AB%2F12`).flush({});
  });

  it('getCustomersLinkedTo() treats a failure as no links', () => {
    let links: unknown;
    service.getCustomersLinkedTo('JONESFA').subscribe(result => links = result);
    httpMock.expectOne(`${BASE}/customers/linked-to/JONESFA`).flush(null, { status: 500, statusText: 'Internal Server Error' });
    expect(links).toEqual([]);
  });

  it('getCustomerTradeUnits() asks for the activity check by default', () => {
    service.getCustomerTradeUnits(42).subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/customers/42/trade-units`);
    expect(req.request.params.has('includeActivity')).toBe(false);
    req.flush([]);
  });

  it('getCustomerTradeUnits() can skip the activity check', () => {
    service.getCustomerTradeUnits(42, { includeActivity: false }).subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/customers/42/trade-units`);
    expect(req.request.params.get('includeActivity')).toBe('false');
    req.flush([]);
  });

  it('removeDormantTradeUnit() calls DELETE /customers/:id/trade-units/:code', () => {
    service.removeDormantTradeUnit(42, '1085').subscribe();
    const req = httpMock.expectOne(`${BASE}/customers/42/trade-units/1085`);
    expect(req.request.method).toBe('DELETE');
    req.flush([]);
  });

  it('assignTradeUnits() sends only the codes for an existing producer', () => {
    service.assignTradeUnits(42, ['1085']).subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/customers/42/trade-units`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ tradeUnitCodes: ['1085'] });
    req.flush({ id: 42 });
  });

  it('assignTradeUnits() sends the producer code for a CTRM onboarding candidate (placeholder id)', () => {
    service.assignTradeUnits(-1234567890123456, ['1085'], 'JONESFA').subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/customers/-1234567890123456/trade-units`);
    expect(req.request.body).toEqual({ tradeUnitCodes: ['1085'], scoularId: 'JONESFA' });
    req.flush({ id: 5000000000000777 });
  });
});
