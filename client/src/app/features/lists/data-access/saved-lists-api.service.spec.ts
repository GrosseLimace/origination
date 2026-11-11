import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { SavedListsApiService } from './saved-lists-api.service';

const BASE = environment.apiBaseUrl;

describe('SavedListsApiService', () => {
  let service: SavedListsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(SavedListsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

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

  it('updateSavedList() PUTs /savedlists/:id with empty collections sent as null', () => {
    service.updateSavedList(4, { name: 'Corn', query: 'corn', filters: {}, includedCustomerIds: [7], excludedCustomerIds: [] }).subscribe();
    const req = httpMock.expectOne(`${BASE}/savedlists/4`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ name: 'Corn', query: 'corn', filters: null, includedCustomerIds: '[7]', excludedCustomerIds: null });
    req.flush({ id: 4 });
  });

  it('getQueryLibrary() calls GET /query-library', () => {
    service.getQueryLibrary().subscribe();
    httpMock.expectOne(`${BASE}/query-library`).flush([]);
  });
});
