import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { ApiError } from '@core/errors/api-error';
import { environment } from '@env/environment';

const BASE = environment.apiBaseUrl;

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

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

  // ── Notes ──────────────────────────────────────────────────────────────────

  it('getNotesByCustomer() calls GET /notes/customer/:id', () => {
    service.getNotesByCustomer(5).subscribe();
    const req = httpMock.expectOne(`${BASE}/notes/customer/5`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getNotesLastContact() calls GET /notes/last-contact', () => {
    service.getNotesLastContact().subscribe();
    const req = httpMock.expectOne(`${BASE}/notes/last-contact`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('createNote() calls POST /notes with body', () => {
    service.createNote(5, 'Good contact', 'TU1').subscribe();
    const req = httpMock.expectOne(`${BASE}/notes`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ customerId: 5, content: 'Good contact', tradeUnit: 'TU1' });
    req.flush({});
  });

  it('deleteNote() calls DELETE /notes/:id', () => {
    service.deleteNote(9).subscribe();
    const req = httpMock.expectOne(`${BASE}/notes/9`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('toggleNotePin() calls PUT /notes/:id/toggle-pin', () => {
    service.toggleNotePin(4).subscribe();
    const req = httpMock.expectOne(`${BASE}/notes/4/toggle-pin`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
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

  // ── Producer Details (grain on farm) ────────────────────────────────────────

  it('getProducerDetails() calls GET /producerdetails/customer/:id and round-trips grainOnFarm', () => {
    service.getProducerDetails(42).subscribe(pd => {
      expect(pd.grainOnFarm?.[0]).toEqual({ commodityCode: 'Corn', bushelsOnHand: 80000, targetBushels: 100000 });
    });
    const req = httpMock.expectOne(`${BASE}/producerdetails/customer/42`);
    expect(req.request.method).toBe('GET');
    req.flush({ id: 1, customerId: 42, customerName: 'Smith', grainOnFarm: [{ commodityCode: 'Corn', bushelsOnHand: 80000, targetBushels: 100000 }] });
  });

  it('saveProducerDetails() PUTs grainOnFarm in the body', () => {
    service.saveProducerDetails(42, {
      customerName: 'Smith',
      grainOnFarm: [{ commodityCode: 'Corn', bushelsOnHand: 80000, targetBushels: 100000 }],
    }).subscribe();
    const req = httpMock.expectOne(`${BASE}/producerdetails/customer/42`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.grainOnFarm).toEqual([{ commodityCode: 'Corn', bushelsOnHand: 80000, targetBushels: 100000 }]);
    req.flush({ id: 1, customerId: 42, customerName: 'Smith' });
  });

  it('saveProducerDetails() PUTs contacts in array order and round-trips them on read', () => {
    const contacts = [
      { name: 'Dad', phone: '(402) 555-1111', isPrimary: true },
      { name: 'Acme Insurance', email: 'claims@acme.com', isPrimary: false },
    ];
    service.saveProducerDetails(42, { customerName: 'Smith', contacts }).subscribe();
    const put = httpMock.expectOne(`${BASE}/producerdetails/customer/42`);
    expect(put.request.body.contacts).toEqual(contacts);
    put.flush({ id: 1, customerId: 42, customerName: 'Smith' });

    service.getProducerDetails(42).subscribe(pd => {
      expect(pd.contacts?.[0]).toEqual({ name: 'Dad', phone: '(402) 555-1111', isPrimary: true, sortOrder: 0 });
    });
    const get = httpMock.expectOne(`${BASE}/producerdetails/customer/42`);
    get.flush({ id: 1, customerId: 42, customerName: 'Smith', contacts: [{ name: 'Dad', phone: '(402) 555-1111', isPrimary: true, sortOrder: 0 }] });
  });

  it('saveProducerDetails() omits contacts from the body when the caller does not pass them (server preserves rows)', () => {
    service.saveProducerDetails(42, { customerName: 'Smith' }).subscribe();
    const req = httpMock.expectOne(`${BASE}/producerdetails/customer/42`);
    expect('contacts' in req.request.body).toBe(false);
    req.flush({ id: 1, customerId: 42, customerName: 'Smith' });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('propagates HTTP errors as Error objects', () => new Promise<void>((resolve) => {
    service.getUserTradeUnits().subscribe({
      error: (err: Error) => {
        expect(err).toBeInstanceOf(Error);
        resolve();
      }
    });
    const req = httpMock.expectOne(`${BASE}/usertradeunits`);
    req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });
  }));

  it('throws an ApiError carrying the envelope, with status and traceId at their old property names', () => {
    let caught: unknown;
    service.getUserTradeUnits().subscribe({ error: e => caught = e });
    httpMock.expectOne(`${BASE}/usertradeunits`).flush(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong (Ref: t-9)', traceId: 't-9' } },
      { status: 500, statusText: 'Internal Server Error' }
    );

    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(500);
    expect(err.traceId).toBe('t-9');
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.category).toBe('server');
    expect(err.message).toBe('Something went wrong (Ref: t-9)');
  });

  it('throws a network ApiError when the request never got a response', () => {
    let caught: unknown;
    service.getUserTradeUnits().subscribe({ error: e => caught = e });
    httpMock.expectOne(`${BASE}/usertradeunits`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).category).toBe('network');
    expect((caught as ApiError).status).toBe(0);
  });

  it('still tells the user their session expired on a 401', () => {
    const spy = vi.spyOn(TestBed.inject(ToastService), 'error');
    let caught: unknown;
    service.getUserTradeUnits().subscribe({ error: e => caught = e });
    httpMock.expectOne(`${BASE}/usertradeunits`).flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(spy).toHaveBeenCalledWith('Your session has expired — please refresh the page to sign in again.');
    expect((caught as ApiError).category).toBe('unauthorized');
  });

  it('leaves a 403 to forbiddenInterceptor: no toast here, and the error keeps the server\'s message', () => {
    // A toast here as well as the interceptor's would show every 403 twice.
    const spy = vi.spyOn(TestBed.inject(ToastService), 'error');
    let caught: unknown;

    service.getUserTradeUnits().subscribe({ error: e => caught = e });
    httpMock.expectOne(`${BASE}/usertradeunits`).flush(
      { error: { code: 'AUTHORIZATION_FORBIDDEN', message: 'Not your trade unit' } },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(spy).not.toHaveBeenCalled();
    expect((caught as ApiError).category).toBe('forbidden');
    expect((caught as ApiError).message).toBe('Not your trade unit');
  });

  it('does not toast other failures — the call site decides how to show them', () => {
    const spy = vi.spyOn(TestBed.inject(ToastService), 'error');
    service.getUserTradeUnits().subscribe({ error: () => {} });
    httpMock.expectOne(`${BASE}/usertradeunits`).flush(null, { status: 500, statusText: 'Internal Server Error' });
    expect(spy).not.toHaveBeenCalled();
  });
});
