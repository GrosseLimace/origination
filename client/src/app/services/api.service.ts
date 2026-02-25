import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
  DashboardPlantingEstimate
} from '../models';

/**
 * ApiService provides HTTP methods for communicating with the .NET Web API backend.
 * All methods return RxJS Observables for async data handling.
 * Base URL points to the local API server (http://localhost:5000/api).
 */
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = 'http://localhost:5000/api';

  constructor(private http: HttpClient) {}

  // ==========================================================================
  // Customer Operations
  // ==========================================================================

  /** Fetches all customers in the system */
  getCustomers(tradeUnits?: string[]): Observable<Customer[]> {
    const params = tradeUnits && tradeUnits.length > 0
      ? '?' + tradeUnits.map(tu => `tradeUnits=${encodeURIComponent(tu)}`).join('&')
      : '';
    return this.http.get<Customer[]>(`${this.baseUrl}/customers${params}`);
  }

  /** Searches customers by name (max 15 results) */
  searchCustomers(searchTerm: string, tradeUnits?: string[]): Observable<Customer[]> {
    const tradeUnitParams = tradeUnits && tradeUnits.length > 0
      ? '&' + tradeUnits.map(tu => `tradeUnits=${encodeURIComponent(tu)}`).join('&')
      : '';
    return this.http.get<Customer[]>(`${this.baseUrl}/customers/search?searchTerm=${encodeURIComponent(searchTerm)}${tradeUnitParams}`);
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
    const params = tradeUnits && tradeUnits.length > 0
      ? '?' + tradeUnits.map(tu => `tradeUnits=${encodeURIComponent(tu)}`).join('&')
      : '';
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts${params}`);
  }

  /** Fetches all contracts for a specific customer */
  getContractsByCustomer(customerId: number): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts/customer/${customerId}`);
  }

  // ==========================================================================
  // Ticket Operations (Grain delivery tickets)
  // ==========================================================================

  /** Fetches all delivery tickets in the system */
  getTickets(tradeUnits?: string[]): Observable<Ticket[]> {
    const params = tradeUnits && tradeUnits.length > 0
      ? '?' + tradeUnits.map(tu => `tradeUnits=${encodeURIComponent(tu)}`).join('&')
      : '';
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets${params}`);
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
    description?: string;
    acres: number;
    plantingYear: number;
  }): Observable<PlantingIntention> {
    return this.http.post<PlantingIntention>(`${this.baseUrl}/plantingintentions`, data);
  }

  /** Updates an existing planting intention */
  updatePlantingIntention(id: number, data: {
    crop: string;
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
    return this.http.get<DashboardPlantingEstimate[]>(
      `${this.baseUrl}/dashboardplantingestimates?tradeUnitKey=${encodeURIComponent(tradeUnitKey)}&plantingYear=${plantingYear}`
    );
  }

  /** Upserts dashboard planting estimates for a trade unit key + year */
  upsertDashboardPlantingEstimates(estimates: { tradeUnitKey: string; crop: string; plantingYear: number; yieldEstimate?: number | null; marketSharePct?: number | null; actualHarvestHandle?: number | null }[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/dashboardplantingestimates/upsert`, estimates);
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

  /** Creates a new saved list from a natural language query */
  createSavedList(data: { name: string; query: string; customerIds: number[] }): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/savedlists`, data);
  }

  /** Deletes a saved list by ID */
  deleteSavedList(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/savedlists/${id}`);
  }
}
