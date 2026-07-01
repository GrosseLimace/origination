import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService } from './api.service';
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

  // ── Customers ──────────────────────────────────────────────────────────────

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

  it('searchCustomers() calls GET /customers/search with searchTerm', () => {
    service.searchCustomers('Smith').subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/customers/search`);
    expect(req.request.params.get('searchTerm')).toBe('Smith');
    req.flush([]);
  });

  it('getCustomerById() calls GET /customers/:id', () => {
    service.getCustomerById(42).subscribe();
    const req = httpMock.expectOne(`${BASE}/customers/42`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

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

  it('getPricingLines() calls GET /contracts/pricing-lines with sourceContractId', () => {
    service.getPricingLines('CTR-001').subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/contracts/pricing-lines`);
    expect(req.request.params.get('sourceContractId')).toBe('CTR-001');
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

  // ── Notes ──────────────────────────────────────────────────────────────────

  it('getNotesByCustomer() calls GET /notes/customer/:id', () => {
    service.getNotesByCustomer(5).subscribe();
    const req = httpMock.expectOne(`${BASE}/notes/customer/5`);
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

  // ── Saved Lists ────────────────────────────────────────────────────────────

  it('getSavedLists() calls GET /savedlists and parses filters', () => {
    const raw = [{ id: 1, name: 'My List', query: 'corn', filters: '{"crops":["Corn"]}' }];
    service.getSavedLists().subscribe(lists => {
      expect(lists[0].filters).toEqual({ crops: ['Corn'] });
    });
    const req = httpMock.expectOne(`${BASE}/savedlists`);
    req.flush(raw);
  });

  it('deleteSavedList() calls DELETE /savedlists/:id', () => {
    service.deleteSavedList(3).subscribe();
    const req = httpMock.expectOne(`${BASE}/savedlists/3`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  // ── Producer Details (grain on farm) ────────────────────────────────────────

  it('getProducerDetails() calls GET /producerdetails/customer/:id and round-trips grainOnFarm', () => {
    service.getProducerDetails(42).subscribe(pd => {
      expect(pd.grainOnFarm?.[0]).toEqual({ commodityGroup: 'Corn', bushelsOnHand: 80000, targetBushels: 100000 });
    });
    const req = httpMock.expectOne(`${BASE}/producerdetails/customer/42`);
    expect(req.request.method).toBe('GET');
    req.flush({ id: 1, customerId: 42, customerName: 'Smith', grainOnFarm: [{ commodityGroup: 'Corn', bushelsOnHand: 80000, targetBushels: 100000 }] });
  });

  it('saveProducerDetails() PUTs grainOnFarm in the body', () => {
    service.saveProducerDetails(42, {
      customerName: 'Smith',
      grainOnFarm: [{ commodityGroup: 'Corn', bushelsOnHand: 80000, targetBushels: 100000 }],
    }).subscribe();
    const req = httpMock.expectOne(`${BASE}/producerdetails/customer/42`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.grainOnFarm).toEqual([{ commodityGroup: 'Corn', bushelsOnHand: 80000, targetBushels: 100000 }]);
    req.flush({ id: 1, customerId: 42, customerName: 'Smith' });
  });

  it('getTeamSavedLists() calls GET /savedlists/team with the tradeUnits param and parses filters', () => {
    const raw = [{ id: 7, name: "Joe's List", query: 'wheat', createdBy: 'Joe Originator', filters: '{"crops":["Wheat"]}' }];
    service.getTeamSavedLists('TU1,TU2').subscribe(lists => {
      expect(lists[0].createdBy).toBe('Joe Originator');
      expect(lists[0].filters).toEqual({ crops: ['Wheat'] });
    });
    const req = httpMock.expectOne(r => r.url === `${BASE}/savedlists/team`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('tradeUnits')).toBe('TU1,TU2');
    req.flush(raw);
  });

  it('getTeamMembers() calls GET /savedlists/team-members with the tradeUnits param', () => {
    service.getTeamMembers('TU1,TU2').subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/savedlists/team-members`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('tradeUnits')).toBe('TU1,TU2');
    req.flush([]);
  });

  it('assignSavedList() POSTs /savedlists/assign with targets and stringified filters', () => {
    service.assignSavedList({
      name: 'Corn', query: 'corn', tradeUnits: 'TU1',
      filters: { crops: ['Corn'] }, targetUserIds: ['sam', 'dana'],
    }).subscribe();
    const req = httpMock.expectOne(`${BASE}/savedlists/assign`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.targetUserIds).toEqual(['sam', 'dana']);
    expect(req.request.body.filters).toBe('{"crops":["Corn"]}');
    req.flush([]);
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('propagates HTTP errors as Error objects', () => new Promise<void>((resolve) => {
    service.getCustomers().subscribe({
      error: (err: Error) => {
        expect(err).toBeInstanceOf(Error);
        resolve();
      }
    });
    const req = httpMock.expectOne(`${BASE}/customers`);
    req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });
  }));

  it('surfaces the field-level validation detail over the generic top-level message', () => new Promise<void>((resolve) => {
    service.createBidSheetLocation({ name: 'Dup', tradeUnitCode: 'TU1', bids: [] }).subscribe({
      error: (err: Error) => {
        // Should show the specific detail, not "One or more fields failed validation."
        expect(err.message).toBe('A location named "Dup" already exists in this trade unit. Use a different name.');
        resolve();
      }
    });
    const req = httpMock.expectOne(`${BASE}/bidsheet/locations`);
    req.flush(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more fields failed validation.',
          details: [{ field: 'name', message: 'A location named "Dup" already exists in this trade unit. Use a different name.' }]
        }
      },
      { status: 400, statusText: 'Bad Request' }
    );
  }));
});
