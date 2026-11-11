import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { EngagementApiService } from './engagement-api.service';

const BASE = environment.apiBaseUrl;

describe('EngagementApiService', () => {
  let service: EngagementApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(EngagementApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
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
});
