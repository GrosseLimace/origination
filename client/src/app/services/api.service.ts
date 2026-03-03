import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
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
  ContractPricingLine
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
  private baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  // ==========================================================================
  // Customer Operations
  // ==========================================================================

  /** Fetches all customers in the system */
  getCustomers(tradeUnits?: string[]): Observable<Customer[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Customer[]>(`${this.baseUrl}/customers`, { params });
  }

  /** Searches customers by name (max 15 results) */
  searchCustomers(searchTerm: string, tradeUnits?: string[]): Observable<Customer[]> {
    let params = new HttpParams().set('searchTerm', searchTerm);
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Customer[]>(`${this.baseUrl}/customers/search`, { params });
  }

  /** Fetches all unique trade units / organization codes */
  getTradeUnits(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/customers/trade-units`);
  }

  /** Fetches all trade unit groups with their member trade units */
  getTradeUnitGroups(): Observable<{ id: number; groupName: string; tradeUnits: { tradeUnitCode: string }[] }[]> {
    return this.http.get<{ id: number; groupName: string; tradeUnits: { tradeUnitCode: string }[] }[]>(`${this.baseUrl}/tradeunitgroups`);
  }

  /** Fetches a single customer by ID */
  getCustomerById(id: number): Observable<Customer> {
    return this.http.get<Customer>(`${this.baseUrl}/customers/${id}`);
  }

  /** Updates an existing customer's information */
  updateCustomer(customer: Customer): Observable<Customer> {
    return this.http.put<Customer>(`${this.baseUrl}/customers/${customer.id}`, customer);
  }

  // ==========================================================================
  // Contract Operations
  // ==========================================================================

  /** Fetches all contracts in the system */
  getContracts(tradeUnits?: string[]): Observable<Contract[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts`, { params });
  }

  /** Fetches all contracts for a specific customer */
  getContractsByCustomer(customerId: number): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts/customer/${customerId}`);
  }

  /** Fetches pricing lines for a specific contract by its sourceContractId */
  getPricingLines(sourceContractId: string): Observable<ContractPricingLine[]> {
    const params = new HttpParams().set('sourceContractId', sourceContractId);
    return this.http.get<ContractPricingLine[]>(
      `${this.baseUrl}/contracts/pricing-lines`, { params }
    );
  }

  /** Fetches all pricing lines for a customer's contracts by sourceCustomerId */
  getPricingLinesByCustomer(sourceCustomerId: string): Observable<ContractPricingLine[]> {
    const params = new HttpParams().set('sourceCustomerId', sourceCustomerId);
    return this.http.get<ContractPricingLine[]>(
      `${this.baseUrl}/contracts/pricing-lines/by-customer`, { params }
    );
  }

  // ==========================================================================
  // Ticket Operations (Grain delivery tickets)
  // ==========================================================================

  /** Fetches all delivery tickets in the system */
  getTickets(tradeUnits?: string[]): Observable<Ticket[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets`, { params });
  }

  /** Fetches all delivery tickets for a specific customer */
  getTicketsByCustomer(customerId: number): Observable<Ticket[]> {
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/customer/${customerId}`);
  }

  // ==========================================================================
  // Planting Intention Operations
  // ==========================================================================

  /** Fetches all planting intentions in the system */
  getPlantingIntentions(): Observable<PlantingIntention[]> {
    return this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions`);
  }

  /** Fetches all planting intentions for a specific customer */
  getPlantingIntentionsByCustomer(customerId: number): Observable<PlantingIntention[]> {
    return this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions/customer/${customerId}`);
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
    return this.http.post<PlantingIntention>(`${this.baseUrl}/plantingintentions`, data);
  }

  /** Updates an existing planting intention */
  updatePlantingIntention(id: number, data: {
    crop: string;
    type?: string;
    description?: string;
    acres: number;
    plantingYear: number;
  }): Observable<PlantingIntention> {
    return this.http.put<PlantingIntention>(`${this.baseUrl}/plantingintentions/${id}`, data);
  }

  /** Deletes a planting intention */
  deletePlantingIntention(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/plantingintentions/${id}`);
  }

  /** Gets saved dashboard planting estimates for a trade unit key + year */
  getDashboardPlantingEstimates(tradeUnitKey: string, plantingYear: number): Observable<DashboardPlantingEstimate[]> {
    const params = new HttpParams().set('tradeUnitKey', tradeUnitKey).set('plantingYear', plantingYear);
    return this.http.get<DashboardPlantingEstimate[]>(`${this.baseUrl}/dashboardplantingestimates`, { params });
  }

  /** Upserts dashboard planting estimates (yield only) for a trade unit key + year */
  upsertDashboardPlantingEstimates(estimates: { tradeUnitKey: string; crop: string; plantingYear: number; yieldEstimate?: number | null }[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/dashboardplantingestimates/upsert`, estimates);
  }

  /** Gets saved dashboard market shares for a trade unit key + year */
  getDashboardMarketShares(tradeUnitKey: string, plantingYear: number): Observable<DashboardMarketShare[]> {
    const params = new HttpParams().set('tradeUnitKey', tradeUnitKey).set('plantingYear', plantingYear);
    return this.http.get<DashboardMarketShare[]>(`${this.baseUrl}/dashboardplantingestimates/marketshares`, { params });
  }

  /** Upserts dashboard market shares for a trade unit key + year */
  upsertDashboardMarketShares(shares: { tradeUnitKey: string; cropCategory: string; plantingYear: number; marketSharePct?: number | null }[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/dashboardplantingestimates/marketshares/upsert`, shares);
  }

  // ==========================================================================
  // Note Operations (Customer contact notes)
  // ==========================================================================

  /** Fetches all notes in the system */
  getNotes(): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes`);
  }

  /** Fetches all notes for a specific customer */
  getNotesByCustomer(customerId: number): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes/customer/${customerId}`);
  }

  /** Creates a new note for a customer */
  createNote(customerId: number, content: string, tradeUnit?: string): Observable<Note> {
    return this.http.post<Note>(`${this.baseUrl}/notes`, { customerId, content, tradeUnit });
  }

  /** Toggles the pinned status of a note */
  toggleNotePin(id: number): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}/toggle-pin`, {});
  }

  /** Updates the content of a note */
  updateNote(id: number, content: string): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}`, { content });
  }

  /** Deletes a note */
  deleteNote(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/notes/${id}`);
  }

  // ==========================================================================
  // Producer Details Operations
  // ==========================================================================

  /** Fetches all producer details records */
  getAllProducerDetails(): Observable<ProducerDetails[]> {
    return this.http.get<ProducerDetails[]>(`${this.baseUrl}/producerdetails`);
  }

  /** Fetches producer details for a specific customer */
  getProducerDetails(customerId: number): Observable<ProducerDetails> {
    return this.http.get<ProducerDetails>(`${this.baseUrl}/producerdetails/customer/${customerId}`);
  }

  /** Creates or updates producer details for a customer */
  saveProducerDetails(customerId: number, data: { sourceCustomerId?: string | null; customerName: string; totalAcres?: number | null; binCapacity?: number | null; primaryContact?: string | null; commodities?: string | null; linkedProducerIds?: string | null }): Observable<ProducerDetails> {
    return this.http.put<ProducerDetails>(`${this.baseUrl}/producerdetails/customer/${customerId}`, data);
  }

  /** Deletes producer details for a customer */
  deleteProducerDetails(customerId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/producerdetails/customer/${customerId}`);
  }

  // ==========================================================================
  // Stored Grain Operations
  // ==========================================================================

  /** Fetches all stored grain records in the system */
  getStoredGrain(): Observable<StoredGrain[]> {
    return this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain`);
  }

  /** Fetches all stored grain records for a specific customer */
  getStoredGrainByCustomer(customerId: number): Observable<StoredGrain[]> {
    return this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain/customer/${customerId}`);
  }

  // ==========================================================================
  // Commodity Operations
  // ==========================================================================

  /** Fetches all active commodities from the lookup table */
  getCommodities(): Observable<Commodity[]> {
    return this.http.get<Commodity[]>(`${this.baseUrl}/commodities`);
  }

  // ==========================================================================
  // Saved List Operations (Customer query lists)
  // ==========================================================================

  /** Fetches all saved customer lists */
  getSavedLists(): Observable<SavedList[]> {
    return this.http.get<SavedList[]>(`${this.baseUrl}/savedlists`);
  }

  /** Creates a new saved list (stores only the query prompt, not customer IDs) */
  createSavedList(data: { name: string; query: string; tradeUnits?: string }): Observable<SavedList> {
    return this.http.post<SavedList>(`${this.baseUrl}/savedlists`, data);
  }

  /** Deletes a saved list by ID */
  deleteSavedList(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/savedlists/${id}`);
  }
}
