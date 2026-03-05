import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { Customer, Note, SavedList } from '../models';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;
  let toastSpy: jasmine.SpyObj<ToastService>;

  const baseUrl = 'http://localhost:5000/api';

  beforeEach(() => {
    toastSpy = jasmine.createSpyObj('ToastService', ['show', 'success', 'error', 'info', 'warning', 'dismiss']);

    TestBed.configureTestingModule({
      providers: [
        ApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: toastSpy },
      ],
    });

    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // --------------------------------------------------------------------------
  // Customer Operations
  // --------------------------------------------------------------------------

  describe('getCustomers()', () => {
    it('should return customers on success', (done) => {
      const mockCustomers: Customer[] = [
        { id: 1, name: 'Test Farm', sourceCustomerId: 'C001' } as Customer,
      ];

      service.getCustomers().subscribe((customers) => {
        expect(customers.length).toBe(1);
        expect(customers[0].name).toBe('Test Farm');
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/customers`);
      expect(req.request.method).toBe('GET');
      req.flush(mockCustomers);
    });

    it('should return empty array and show toast on error', (done) => {
      service.getCustomers().subscribe((customers) => {
        expect(customers).toEqual([]);
        expect(toastSpy.show).toHaveBeenCalled();
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/customers`);
      req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });
    });

    it('should show session expired message on 401', (done) => {
      service.getCustomers().subscribe((customers) => {
        expect(customers).toEqual([]);
        expect(toastSpy.show).toHaveBeenCalledWith('Session expired. Please sign in again.', 'error');
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/customers`);
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    });

    it('should show permission message on 403', (done) => {
      service.getCustomers().subscribe((customers) => {
        expect(customers).toEqual([]);
        expect(toastSpy.show).toHaveBeenCalledWith('You do not have permission to perform this action.', 'error');
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/customers`);
      req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    });

    it('should append tradeUnits as query params', () => {
      service.getCustomers(['TU1', 'TU2']).subscribe();

      const req = httpMock.expectOne((r) => r.url === `${baseUrl}/customers`);
      expect(req.request.params.getAll('tradeUnits')).toEqual(['TU1', 'TU2']);
      req.flush([]);
    });
  });

  // --------------------------------------------------------------------------
  // Trade Units
  // --------------------------------------------------------------------------

  describe('getTradeUnits()', () => {
    it('should return trade unit list on success', (done) => {
      service.getTradeUnits().subscribe((units) => {
        expect(units).toEqual(['TU1', 'TU2']);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/customers/trade-units`);
      req.flush(['TU1', 'TU2']);
    });

    it('should return empty array on error', (done) => {
      service.getTradeUnits().subscribe((units) => {
        expect(units).toEqual([]);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/customers/trade-units`);
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  // --------------------------------------------------------------------------
  // Notes
  // --------------------------------------------------------------------------

  describe('getNotes()', () => {
    it('should return notes on success', (done) => {
      const mockNotes: Partial<Note>[] = [{ id: 1, content: 'Follow up call' }];

      service.getNotes().subscribe((notes) => {
        expect(notes.length).toBe(1);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/notes`);
      req.flush(mockNotes);
    });
  });

  describe('deleteNote()', () => {
    it('should complete on success', (done) => {
      service.deleteNote(1).subscribe({
        complete: () => done(),
      });

      const req = httpMock.expectOne(`${baseUrl}/notes/1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('should rethrow error and show toast on failure', (done) => {
      service.deleteNote(1).subscribe({
        error: (err) => {
          expect(err.status).toBe(500);
          expect(toastSpy.show).toHaveBeenCalled();
          done();
        },
      });

      const req = httpMock.expectOne(`${baseUrl}/notes/1`);
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  // --------------------------------------------------------------------------
  // Saved Lists
  // --------------------------------------------------------------------------

  describe('getSavedLists()', () => {
    it('should return saved lists on success', (done) => {
      const mockLists: Partial<SavedList>[] = [{ id: 1, name: 'My List' }];

      service.getSavedLists().subscribe((lists) => {
        expect(lists.length).toBe(1);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/savedlists`);
      req.flush(mockLists);
    });

    it('should return empty array on error', (done) => {
      service.getSavedLists().subscribe((lists) => {
        expect(lists).toEqual([]);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/savedlists`);
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('deleteSavedList()', () => {
    it('should rethrow error and show toast on failure', (done) => {
      service.deleteSavedList(1).subscribe({
        error: (err) => {
          expect(err.status).toBe(403);
          expect(toastSpy.show).toHaveBeenCalledWith(
            'You do not have permission to perform this action.',
            'error'
          );
          done();
        },
      });

      const req = httpMock.expectOne(`${baseUrl}/savedlists/1`);
      req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    });
  });
});
