import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Customer,
  Farm,
  Contract,
  Ticket,
  PlantingIntention,
  Note,
  StoredGrain,
  SavedList
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
  getCustomers(): Observable<Customer[]> {
    return this.http.get<Customer[]>(`${this.baseUrl}/customers`);
  }

  /** Fetches a single customer by ID */
  getCustomerById(id: string): Observable<Customer> {
    return this.http.get<Customer>(`${this.baseUrl}/customers/${id}`);
  }

  /** Updates an existing customer's information */
  updateCustomer(customer: Customer): Observable<Customer> {
    return this.http.put<Customer>(`${this.baseUrl}/customers/${customer.id}`, customer);
  }

  // ==========================================================================
  // Farm Operations
  // ==========================================================================

  /** Fetches all farms in the system */
  getFarms(): Observable<Farm[]> {
    return this.http.get<Farm[]>(`${this.baseUrl}/farms`);
  }

  /** Fetches a single farm by ID */
  getFarmById(id: string): Observable<Farm> {
    return this.http.get<Farm>(`${this.baseUrl}/farms/${id}`);
  }

  /** Fetches all farms belonging to a specific customer */
  getFarmsByCustomer(customerId: string): Observable<Farm[]> {
    return this.http.get<Farm[]>(`${this.baseUrl}/farms/customer/${customerId}`);
  }

  /** Creates a new farm and returns the generated ID */
  createFarm(data: { name: string; location: string; acres: number }): Observable<string> {
    return this.http.post<string>(`${this.baseUrl}/farms`, data);
  }

  // ==========================================================================
  // Contract Operations
  // ==========================================================================

  /** Fetches all contracts in the system */
  getContracts(): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts`);
  }

  /** Fetches all contracts for a specific customer */
  getContractsByCustomer(customerId: string): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts/customer/${customerId}`);
  }

  /** Fetches all contracts associated with a specific farm */
  getContractsByFarm(farmId: string): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts/farm/${farmId}`);
  }

  // ==========================================================================
  // Ticket Operations (Grain delivery tickets)
  // ==========================================================================

  /** Fetches all delivery tickets in the system */
  getTickets(): Observable<Ticket[]> {
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets`);
  }

  /** Fetches all delivery tickets for a specific customer */
  getTicketsByCustomer(customerId: string): Observable<Ticket[]> {
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/customer/${customerId}`);
  }

  /** Fetches all delivery tickets associated with a specific farm */
  getTicketsByFarm(farmId: string): Observable<Ticket[]> {
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/farm/${farmId}`);
  }

  // ==========================================================================
  // Planting Intention Operations
  // ==========================================================================

  /** Fetches all planting intentions in the system */
  getPlantingIntentions(): Observable<PlantingIntention[]> {
    return this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions`);
  }

  /** Fetches all planting intentions for a specific customer */
  getPlantingIntentionsByCustomer(customerId: string): Observable<PlantingIntention[]> {
    return this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions/customer/${customerId}`);
  }

  /** Creates a new planting intention record */
  createPlantingIntention(data: {
    customerId: string;
    farmId: string;
    crop: string;
    acres: number;
    plantingYear: number;
    estimatedYield: number;
  }): Observable<PlantingIntention> {
    return this.http.post<PlantingIntention>(`${this.baseUrl}/plantingintentions`, data);
  }

  /** Updates an existing planting intention */
  updatePlantingIntention(id: string, data: {
    crop: string;
    acres: number;
    plantingYear: number;
    estimatedYield: number;
  }): Observable<PlantingIntention> {
    return this.http.put<PlantingIntention>(`${this.baseUrl}/plantingintentions/${id}`, data);
  }

  /** Deletes a planting intention */
  deletePlantingIntention(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/plantingintentions/${id}`);
  }

  // ==========================================================================
  // Note Operations (Customer contact notes)
  // ==========================================================================

  /** Fetches all notes in the system */
  getNotes(): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes`);
  }

  /** Fetches all notes for a specific customer */
  getNotesByCustomer(customerId: string): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes/customer/${customerId}`);
  }

  /** Creates a new note for a customer */
  createNote(customerId: string, content: string): Observable<Note> {
    return this.http.post<Note>(`${this.baseUrl}/notes`, { customerId, content });
  }

  /** Toggles the pinned status of a note */
  toggleNotePin(id: string): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}/toggle-pin`, {});
  }

  /** Updates the content of a note */
  updateNote(id: string, content: string): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}`, { content });
  }

  /** Deletes a note */
  deleteNote(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/notes/${id}`);
  }

  // ==========================================================================
  // Stored Grain Operations
  // ==========================================================================

  /** Fetches all stored grain records in the system */
  getStoredGrain(): Observable<StoredGrain[]> {
    return this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain`);
  }

  /** Fetches all stored grain records for a specific customer */
  getStoredGrainByCustomer(customerId: string): Observable<StoredGrain[]> {
    return this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain/customer/${customerId}`);
  }

  // ==========================================================================
  // Saved List Operations (Customer query lists)
  // ==========================================================================

  /** Fetches all saved customer lists */
  getSavedLists(): Observable<SavedList[]> {
    return this.http.get<SavedList[]>(`${this.baseUrl}/savedlists`);
  }

  /** Creates a new saved list from a natural language query */
  createSavedList(data: { name: string; query: string; customerIds: string[] }): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/savedlists`, data);
  }

  /** Deletes a saved list by ID */
  deleteSavedList(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/savedlists/${id}`);
  }
}
