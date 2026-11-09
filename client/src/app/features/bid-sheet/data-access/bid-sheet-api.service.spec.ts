import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BidSheetApiService } from './bid-sheet-api.service';
import { environment } from '@env/environment';

const BASE = environment.apiBaseUrl;

describe('BidSheetApiService', () => {
  let service: BidSheetApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [BidSheetApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BidSheetApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

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
