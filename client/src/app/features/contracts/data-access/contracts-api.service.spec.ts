import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { ContractsApiService } from './contracts-api.service';

const BASE = environment.apiBaseUrl;

describe('ContractsApiService', () => {
  let service: ContractsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ContractsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ── Contracts ──────────────────────────────────────────────────────────────

  it('getContracts() calls GET /contracts', () => {
    service.getContracts().subscribe();
    const req = httpMock.expectOne(`${BASE}/contracts`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getContractsByCustomer() calls GET /contracts/customer/:id', () => {
    service.getContractsByCustomer(7).subscribe();
    const req = httpMock.expectOne(`${BASE}/contracts/customer/7`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  // ── Tickets ────────────────────────────────────────────────────────────────

  it('getTickets() calls GET /tickets', () => {
    service.getTickets().subscribe();
    const req = httpMock.expectOne(`${BASE}/tickets`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getTicketsByCustomer() calls GET /tickets/customer/:id', () => {
    service.getTicketsByCustomer(3).subscribe();
    const req = httpMock.expectOne(`${BASE}/tickets/customer/3`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getPricingLinesByCustomer() calls GET /contracts/pricing-lines/by-customer with the producer code', () => {
    service.getPricingLinesByCustomer('S-1').subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/contracts/pricing-lines/by-customer`);
    expect(req.request.params.get('scoularId')).toBe('S-1');
    req.flush([]);
  });

  it('getTodaysTickets() calls GET /tickets/today with the trade units', () => {
    service.getTodaysTickets(['2190']).subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/tickets/today`);
    expect(req.request.params.getAll('tradeUnits')).toEqual(['2190']);
    req.flush([]);
  });
});
