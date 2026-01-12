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

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = 'http://localhost:5000/api';

  constructor(private http: HttpClient) {}

  // Customers
  getCustomers(): Observable<Customer[]> {
    return this.http.get<Customer[]>(`${this.baseUrl}/customers`);
  }

  getCustomerById(id: string): Observable<Customer> {
    return this.http.get<Customer>(`${this.baseUrl}/customers/${id}`);
  }

  updateCustomer(customer: Customer): Observable<Customer> {
    return this.http.put<Customer>(`${this.baseUrl}/customers/${customer.id}`, customer);
  }

  // Farms
  getFarms(): Observable<Farm[]> {
    return this.http.get<Farm[]>(`${this.baseUrl}/farms`);
  }

  getFarmById(id: string): Observable<Farm> {
    return this.http.get<Farm>(`${this.baseUrl}/farms/${id}`);
  }

  getFarmsByCustomer(customerId: string): Observable<Farm[]> {
    return this.http.get<Farm[]>(`${this.baseUrl}/farms/customer/${customerId}`);
  }

  createFarm(data: { name: string; location: string; acres: number }): Observable<string> {
    return this.http.post<string>(`${this.baseUrl}/farms`, data);
  }

  // Contracts
  getContracts(): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts`);
  }

  getContractsByCustomer(customerId: string): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts/customer/${customerId}`);
  }

  getContractsByFarm(farmId: string): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts/farm/${farmId}`);
  }

  // Tickets
  getTickets(): Observable<Ticket[]> {
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets`);
  }

  getTicketsByCustomer(customerId: string): Observable<Ticket[]> {
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/customer/${customerId}`);
  }

  getTicketsByFarm(farmId: string): Observable<Ticket[]> {
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/farm/${farmId}`);
  }

  // Planting Intentions
  getPlantingIntentions(): Observable<PlantingIntention[]> {
    return this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions`);
  }

  getPlantingIntentionsByCustomer(customerId: string): Observable<PlantingIntention[]> {
    return this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions/customer/${customerId}`);
  }

  createPlantingIntention(data: {
    customerId: string;
    farmId: string;
    crop: string;
    acres: number;
    variety: string;
    plantingDate: Date;
    estimatedYield: number;
  }): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/plantingintentions`, data);
  }

  updatePlantingIntention(id: string, data: {
    crop: string;
    acres: number;
    variety: string;
    plantingDate: Date;
    estimatedYield: number;
  }): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/plantingintentions/${id}`, data);
  }

  // Notes
  getNotes(): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes`);
  }

  getNotesByCustomer(customerId: string): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes/customer/${customerId}`);
  }

  createNote(customerId: string, content: string): Observable<Note> {
    return this.http.post<Note>(`${this.baseUrl}/notes`, { customerId, content });
  }

  toggleNotePin(id: string): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}/toggle-pin`, {});
  }

  // Stored Grain
  getStoredGrain(): Observable<StoredGrain[]> {
    return this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain`);
  }

  getStoredGrainByCustomer(customerId: string): Observable<StoredGrain[]> {
    return this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain/customer/${customerId}`);
  }

  // Saved Lists
  getSavedLists(): Observable<SavedList[]> {
    return this.http.get<SavedList[]>(`${this.baseUrl}/savedlists`);
  }

  createSavedList(data: { name: string; query: string; customerIds: string[] }): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/savedlists`, data);
  }

  deleteSavedList(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/savedlists/${id}`);
  }
}
