import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ToastService } from './toast.service';
import {
  Customer,
  Contract,
  Ticket,
  PlantingIntention,
  Note,
  StoredGrain,
  SavedList,
  Commodity,
  ProducerDetails,
  DashboardPlantingEstimate,
  DashboardMarketShare,
  DashboardActualHarvest,
  ContractPricingLine,
  RefinementFilters
} from '../models';
import { environment } from '../../environments/environment';

/**
 * ApiService provides HTTP methods for communicating with the .NET Web API backend.
 * All methods return RxJS Observables for async data handling.
 */
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = environment.apiUrl;
  private toastService = inject(ToastService);

  constructor(private http: HttpClient) {}

  private handleError(operation: string): (error: HttpErrorResponse) => Observable<never>;
  private handleError<T>(operation: string, fallback: T): (error: HttpErrorResponse) => Observable<T>;
  private handleError<T>(operation: string, fallback?: T) {
    return (error: HttpErrorResponse): Observable<any> => {
      const message = error.status === 401
        ? 'Session expired. Please sign in again.'
        : error.status === 403
        ? 'You do not have permission to perform this action.'
        : `${operation} failed. Please try again.`;
      this.toastService.show(message, 'error');
      if (fallback !== undefined) return new Observable<T>(obs => { obs.next(fallback); obs.complete(); });
      return throwError(() => error);
    };
  }

  // ==========================================================================
  // Customer Operations
  // ==========================================================================

  /** Fetches all customers in the system */
  getCustomers(tradeUnits?: string[]): Observable<Customer[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Customer[]>(`${this.baseUrl}/customers`, { params }).pipe(catchError(this.handleError('Load customers', [])));
  }

  /** Searches customers by name (max 15 results) */
  searchCustomers(searchTerm: string, tradeUnits?: string[]): Observable<Customer[]> {
    let params = new HttpParams().set('searchTerm', searchTerm);
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Customer[]>(`${this.baseUrl}/customers/search`, { params }).pipe(catchError(this.handleError('Search customers', [])));
  }

  /** Fetches all unique trade units / organization codes */
  getTradeUnits(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/customers/trade-units`).pipe(catchError(this.handleError('Load trade units', [])));
  }

  /** Fetches all trade unit groups with their member trade units */
  getTradeUnitGroups(): Observable<{ id: number; groupName: string; tradeUnits: { tradeUnitCode: string }[] }[]> {
    return this.http.get<{ id: number; groupName: string; tradeUnits: { tradeUnitCode: string }[] }[]>(`${this.baseUrl}/tradeunitgroups`).pipe(catchError(this.handleError('Load trade unit groups', [])));
  }

  /** Fetches a single customer by ID */
  getCustomerById(id: number): Observable<Customer> {
    return this.http.get<Customer>(`${this.baseUrl}/customers/${id}`).pipe(catchError(this.handleError('Load customer')));
  }

  /** Updates an existing customer's information */
  updateCustomer(customer: Customer): Observable<Customer> {
    return this.http.put<Customer>(`${this.baseUrl}/customers/${customer.id}`, customer).pipe(catchError(this.handleError('Update customer')));
  }

  // ==========================================================================
  // Contract Operations
  // ==========================================================================

  /** Fetches all contracts in the system */
  getContracts(tradeUnits?: string[]): Observable<Contract[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts`, { params }).pipe(catchError(this.handleError('Load contracts', [])));
  }

  /** Fetches all contracts for a specific customer */
  getContractsByCustomer(customerId: number): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts/customer/${customerId}`).pipe(catchError(this.handleError('Load contracts', [])));
  }

  /** Fetches pricing lines for a specific contract by its sourceContractId */
  getPricingLines(sourceContractId: string): Observable<ContractPricingLine[]> {
    const params = new HttpParams().set('sourceContractId', sourceContractId);
    return this.http.get<ContractPricingLine[]>(
      `${this.baseUrl}/contracts/pricing-lines`, { params }
    ).pipe(catchError(this.handleError('Load pricing lines', [])));
  }

  /** Fetches all pricing lines for a customer's contracts by sourceCustomerId */
  getPricingLinesByCustomer(sourceCustomerId: string): Observable<ContractPricingLine[]> {
    const params = new HttpParams().set('sourceCustomerId', sourceCustomerId);
    return this.http.get<ContractPricingLine[]>(
      `${this.baseUrl}/contracts/pricing-lines/by-customer`, { params }
    ).pipe(catchError(this.handleError('Load pricing lines', [])));
  }

  // ==========================================================================
  // Ticket Operations (Grain delivery tickets)
  // ==========================================================================

  /** Fetches all delivery tickets in the system */
  getTickets(tradeUnits?: string[]): Observable<Ticket[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets`, { params }).pipe(catchError(this.handleError('Load tickets', [])));
  }

  /** Fetches all delivery tickets for a specific customer */
  getTicketsByCustomer(customerId: number): Observable<Ticket[]> {
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/customer/${customerId}`).pipe(catchError(this.handleError('Load tickets', [])));
  }

  // ==========================================================================
  // Planting Intention Operations
  // ==========================================================================

  /** Fetches all planting intentions in the system */
  getPlantingIntentions(): Observable<PlantingIntention[]> {
    return this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions`).pipe(catchError(this.handleError('Load planting intentions', [])));
  }

  /** Fetches all planting intentions for a specific customer */
  getPlantingIntentionsByCustomer(customerId: number): Observable<PlantingIntention[]> {
    return this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions/customer/${customerId}`).pipe(catchError(this.handleError('Load planting intentions', [])));
  }


  /** Creates a new planting intention record */
  createPlantingIntention(data: {
    customerId: number;
    customerName: string;
    customerCode: string;
    tradeUnit: string;
    crop: string;
    type?: string;
    description?: string;
    acres: number;
    plantingYear: number;
  }): Observable<PlantingIntention> {
    return this.http.post<PlantingIntention>(`${this.baseUrl}/plantingintentions`, data).pipe(catchError(this.handleError('Create planting intention')));
  }

  /** Updates an existing planting intention */
  updatePlantingIntention(id: number, data: {
    crop: string;
    type?: string;
    description?: string;
    acres: number;
    plantingYear: number;
  }): Observable<PlantingIntention> {
    return this.http.put<PlantingIntention>(`${this.baseUrl}/plantingintentions/${id}`, data).pipe(catchError(this.handleError('Update planting intention')));
  }

  /** Deletes a planting intention */
  deletePlantingIntention(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/plantingintentions/${id}`).pipe(catchError(this.handleError('Delete planting intention')));
  }

  /** Gets saved dashboard planting estimates for a trade unit key + year */
  getDashboardPlantingEstimates(tradeUnitKey: string, plantingYear: number): Observable<DashboardPlantingEstimate[]> {
    const params = new HttpParams().set('tradeUnitKey', tradeUnitKey).set('plantingYear', plantingYear);
    return this.http.get<DashboardPlantingEstimate[]>(`${this.baseUrl}/dashboardplantingestimates`, { params }).pipe(catchError(this.handleError('Load estimates', [])));
  }

  /** Upserts dashboard planting estimates (yield only) for a trade unit key + year */
  upsertDashboardPlantingEstimates(estimates: { tradeUnitKey: string; crop: string; plantingYear: number; yieldEstimate?: number | null }[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/dashboardplantingestimates/upsert`, estimates).pipe(catchError(this.handleError('Save estimates')));
  }

  /** Gets saved dashboard market shares for a trade unit key + year */
  getDashboardMarketShares(tradeUnitKey: string, plantingYear: number): Observable<DashboardMarketShare[]> {
    const params = new HttpParams().set('tradeUnitKey', tradeUnitKey).set('plantingYear', plantingYear);
    return this.http.get<DashboardMarketShare[]>(`${this.baseUrl}/dashboardplantingestimates/marketshares`, { params }).pipe(catchError(this.handleError('Load market shares', [])));
  }

  /** Upserts dashboard market shares for a trade unit key + year */
  upsertDashboardMarketShares(shares: { tradeUnitKey: string; cropCategory: string; plantingYear: number; marketSharePct?: number | null }[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/dashboardplantingestimates/marketshares/upsert`, shares).pipe(catchError(this.handleError('Save market shares')));
  }

  /** Fetches actual prev-year harvest handle rows for a trade unit key + year */
  getDashboardActualHarvest(tradeUnitKey: string, plantingYear: number): Observable<DashboardActualHarvest[]> {
    const params = new HttpParams().set('tradeUnitKey', tradeUnitKey).set('plantingYear', plantingYear);
    return this.http.get<DashboardActualHarvest[]>(`${this.baseUrl}/dashboardplantingestimates/actualharvest`, { params }).pipe(catchError(this.handleError('Load harvest data', [])));
  }

  /** Upserts actual harvest rows for a trade unit key + year */
  upsertDashboardActualHarvest(items: { tradeUnitKey: string; cropCategory: string; plantingYear: number; bushels: number }[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/dashboardplantingestimates/actualharvest/upsert`, items).pipe(catchError(this.handleError('Save harvest data')));
  }

  /** Deletes a single actual harvest row by id */
  deleteDashboardActualHarvest(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/dashboardplantingestimates/actualharvest/${id}`).pipe(catchError(this.handleError('Delete harvest entry')));
  }

  // ==========================================================================
  // Note Operations (Customer contact notes)
  // ==========================================================================

  /** Fetches all notes in the system */
  getNotes(): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes`).pipe(catchError(this.handleError('Load notes', [])));
  }

  /** Fetches all notes for a specific customer */
  getNotesByCustomer(customerId: number): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes/customer/${customerId}`).pipe(catchError(this.handleError('Load notes', [])));
  }

  /** Creates a new note for a customer */
  createNote(customerId: number, content: string, tradeUnit?: string): Observable<Note> {
    return this.http.post<Note>(`${this.baseUrl}/notes`, { customerId, content, tradeUnit }).pipe(catchError(this.handleError('Save note')));
  }

  /** Toggles the pinned status of a note */
  toggleNotePin(id: number): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}/toggle-pin`, {}).pipe(catchError(this.handleError('Update note')));
  }

  /** Updates the content of a note */
  updateNote(id: number, content: string): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}`, { content }).pipe(catchError(this.handleError('Update note')));
  }

  /** Deletes a note */
  deleteNote(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/notes/${id}`).pipe(catchError(this.handleError('Delete note')));
  }

  // ==========================================================================
  // Producer Details Operations
  // ==========================================================================

  /** Fetches all producer details records */
  getAllProducerDetails(): Observable<ProducerDetails[]> {
    return this.http.get<ProducerDetails[]>(`${this.baseUrl}/producerdetails`).pipe(catchError(this.handleError('Load producer details', [])));
  }

  /** Fetches producer details for a specific customer */
  getProducerDetails(customerId: number): Observable<ProducerDetails> {
    return this.http.get<ProducerDetails>(`${this.baseUrl}/producerdetails/customer/${customerId}`).pipe(catchError(this.handleError('Load producer details')));
  }

  /** Creates or updates producer details for a customer */
  saveProducerDetails(customerId: number, data: { sourceCustomerId?: string | null; customerName: string; totalAcres?: number | null; binCapacity?: number | null; primaryContact?: string | null; commodities?: string | null; linkedProducerIds?: string | null }): Observable<ProducerDetails> {
    return this.http.put<ProducerDetails>(`${this.baseUrl}/producerdetails/customer/${customerId}`, data).pipe(catchError(this.handleError('Save producer details')));
  }

  /** Deletes producer details for a customer */
  deleteProducerDetails(customerId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/producerdetails/customer/${customerId}`).pipe(catchError(this.handleError('Delete producer details')));
  }

  // ==========================================================================
  // Stored Grain Operations
  // ==========================================================================

  /** Fetches all stored grain records in the system */
  getStoredGrain(): Observable<StoredGrain[]> {
    return this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain`).pipe(catchError(this.handleError('Load stored grain', [])));
  }

  /** Fetches all stored grain records for a specific customer */
  getStoredGrainByCustomer(customerId: number): Observable<StoredGrain[]> {
    return this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain/customer/${customerId}`).pipe(catchError(this.handleError('Load stored grain', [])));
  }

  // ==========================================================================
  // Commodity Operations
  // ==========================================================================

  /** Fetches all active commodities from the lookup table */
  getCommodities(): Observable<Commodity[]> {
    return this.http.get<Commodity[]>(`${this.baseUrl}/commodities`).pipe(catchError(this.handleError('Load commodities', [])));
  }

  // ==========================================================================
  // Saved List Operations (Customer query lists)
  // ==========================================================================

  /** Fetches all saved customer lists — deserializes the Filters JSON string to an object */
  getSavedLists(): Observable<SavedList[]> {
    return this.http.get<any[]>(`${this.baseUrl}/savedlists`).pipe(
      map(lists => lists.map(l => ({
        ...l,
        filters: l.filters ? JSON.parse(l.filters) as RefinementFilters : undefined
      }))),
      catchError(this.handleError('Load saved lists', []))
    );
  }

  /** Creates a new saved list (stores only the query prompt + optional filters, not customer IDs) */
  createSavedList(data: { name: string; query: string; tradeUnits?: string; filters?: RefinementFilters }): Observable<SavedList> {
    const payload = {
      ...data,
      filters: data.filters && Object.keys(data.filters).length > 0 ? JSON.stringify(data.filters) : null
    };
    return this.http.post<SavedList>(`${this.baseUrl}/savedlists`, payload).pipe(catchError(this.handleError('Save list')));
  }

  /** Updates an existing saved list by ID */
  updateSavedList(id: number, data: { name: string; query: string; tradeUnits?: string; filters?: RefinementFilters }): Observable<SavedList> {
    const payload = {
      ...data,
      filters: data.filters && Object.keys(data.filters).length > 0 ? JSON.stringify(data.filters) : null
    };
    return this.http.put<SavedList>(`${this.baseUrl}/savedlists/${id}`, payload).pipe(catchError(this.handleError('Update list')));
  }

  /** Deletes a saved list by ID */
  deleteSavedList(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/savedlists/${id}`).pipe(catchError(this.handleError('Delete list')));
  }
}
