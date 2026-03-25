import { inject, Injectable, isDevMode } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, of, throwError, shareReplay } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';
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
  DashboardSummary,
  ContractPricingLine,
  RefinementFilters,
  BidSheetEntry,
  BidSheetLocation,
  BidSheetLocationBid,
  Elevator
} from '@models';
import { environment } from '@env/environment';
import { ToastService } from '@core/services/toast.service';

/**
 * ApiService provides HTTP methods for communicating with the .NET Web API backend.
 * All methods return RxJS Observables for async data handling.
 */
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(ToastService);
  private readonly baseUrl = environment.apiBaseUrl;

  // ---------------------------------------------------------
  // In-flight request deduplication — prevents duplicate concurrent calls to the same
  // slow ODS endpoint (e.g. from HomeComponent._loadAllData() and DataPreloadService).
  // When a second caller requests the same key while the first is still in-flight,
  // they share one HTTP request and both receive the same response.
  private readonly _inFlight = new Map<string, Observable<any>>();

  private _dedupe<T>(key: string, request: Observable<T>): Observable<T> {
    const cached = this._inFlight.get(key);
    if (cached) return cached as Observable<T>;
    const shared = request.pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      finalize(() => this._inFlight.delete(key))
    );
    this._inFlight.set(key, shared);
    return shared;
  }

  private handleError(error: unknown): Observable<never> {
    if (isDevMode()) {
      console.error('API Error:', error);
    }

    if (error instanceof HttpErrorResponse && error.status === 403) {
      const message = error.error?.error?.message || 'Access denied: you are not authorized for this resource.';
      this.toastService.error(message);
    }

    return throwError(() => error instanceof Error ? error : new Error('Server error'));
  }

  // ==========================================================================
  // Customer Operations
  // ==========================================================================

  /** Fetches all customers in the system */
  getCustomers(tradeUnits?: string[]): Observable<Customer[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    const key = `customers:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this._dedupe(key,
      this.http.get<Customer[]>(`${this.baseUrl}/customers`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Searches customers by name (max 15 results) */
  searchCustomers(searchTerm: string, tradeUnits?: string[]): Observable<Customer[]> {
    let params = new HttpParams().set('searchTerm', searchTerm);
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Customer[]>(`${this.baseUrl}/customers/search`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches all unique trade units / organization codes */
  getTradeUnits(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/customers/trade-units`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches all trade unit groups with their member trade units */
  getTradeUnitGroups(): Observable<{ id: number; groupName: string; tradeUnits: { tradeUnitCode: string }[] }[]> {
    return this.http.get<{ id: number; groupName: string; tradeUnits: { tradeUnitCode: string }[] }[]>(`${this.baseUrl}/tradeunitgroups`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches trade unit groups assigned to the currently authenticated user from the Entitlements database */
  getUserTradeUnits(): Observable<{ groupName: string; tradeUnitCodes: string[] }[]> {
    return this.http.get<{ groupName: string; tradeUnitCodes: string[] }[]>(`${this.baseUrl}/usertradeunits`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches a single customer by ID */
  getCustomerById(id: number): Observable<Customer> {
    return this.http.get<Customer>(`${this.baseUrl}/customers/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches a single customer by their source system ID (CTRM customer code) */
  getCustomerBySourceId(sourceId: string): Observable<Customer> {
    return this.http.get<Customer>(`${this.baseUrl}/customers/by-source/${encodeURIComponent(sourceId)}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates an existing customer's information (sends only fields accepted by UpdateCustomerRequest DTO) */
  updateCustomer(customer: Customer): Observable<Customer> {
    return this.http.put<Customer>(`${this.baseUrl}/customers/${customer.id}`, {
      location: customer.location,
      phone: customer.phone,
      email: customer.email,
      linkedProducerIds: customer.linkedProducerIds
    }).pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Contract Operations
  // ==========================================================================

  /** Fetches all contracts in the system */
  getContracts(tradeUnits?: string[]): Observable<Contract[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    const key = `contracts:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this._dedupe(key,
      this.http.get<Contract[]>(`${this.baseUrl}/contracts`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all contracts for a specific customer */
  getContractsByCustomer(customerId: number, sourceCustomerId?: string): Observable<Contract[]> {
    let params = new HttpParams();
    if (sourceCustomerId) params = params.set('sourceCustomerId', sourceCustomerId);
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts/customer/${customerId}`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches pricing lines for a specific contract by its sourceContractId */
  getPricingLines(sourceContractId: string): Observable<ContractPricingLine[]> {
    const params = new HttpParams().set('sourceContractId', sourceContractId);
    return this.http.get<ContractPricingLine[]>(
      `${this.baseUrl}/contracts/pricing-lines`, { params }
    ).pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches all pricing lines for a customer's contracts by sourceCustomerId */
  getPricingLinesByCustomer(sourceCustomerId: string): Observable<ContractPricingLine[]> {
    const params = new HttpParams().set('sourceCustomerId', sourceCustomerId);
    return this.http.get<ContractPricingLine[]>(
      `${this.baseUrl}/contracts/pricing-lines/by-customer`, { params }
    ).pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Ticket Operations (Grain delivery tickets)
  // ==========================================================================

  /** Fetches all delivery tickets in the system */
  getTickets(tradeUnits?: string[]): Observable<Ticket[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    const key = `tickets:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this._dedupe(key,
      this.http.get<Ticket[]>(`${this.baseUrl}/tickets`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches today's delivery tickets only — fast path for Spot Loads in Insights */
  getTodaysTickets(tradeUnits?: string[]): Observable<Ticket[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    const key = `tickets:today:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this._dedupe(key,
      this.http.get<Ticket[]>(`${this.baseUrl}/tickets/today`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all delivery tickets for a specific customer */
  getTicketsByCustomer(customerId: number, sourceCustomerId?: string): Observable<Ticket[]> {
    let params = new HttpParams();
    if (sourceCustomerId) params = params.set('sourceCustomerId', sourceCustomerId);
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/customer/${customerId}`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Planting Intention Operations
  // ==========================================================================

  /** Fetches planting intentions, optionally filtered by trade units */
  getPlantingIntentions(tradeUnits?: string[], plantingYear?: number): Observable<PlantingIntention[]> {
    let params = new HttpParams();
    if (tradeUnits?.length) params = params.set('tradeUnits', tradeUnits.join(','));
    if (plantingYear != null) params = params.set('plantingYear', plantingYear.toString());
    const key = `plantingintentions:${[...(tradeUnits ?? [])].sort().join(',')}:${plantingYear ?? ''}`;
    return this._dedupe(key,
      this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all planting intentions for a specific customer */
  getPlantingIntentionsByCustomer(customerId: number): Observable<PlantingIntention[]> {
    return this.http.get<PlantingIntention[]>(`${this.baseUrl}/plantingintentions/customer/${customerId}`)
      .pipe(catchError(e => this.handleError(e)));
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
    return this.http.post<PlantingIntention>(`${this.baseUrl}/plantingintentions`, data)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates an existing planting intention */
  updatePlantingIntention(id: number, data: {
    crop: string;
    type?: string;
    description?: string;
    acres: number;
    plantingYear: number;
  }): Observable<PlantingIntention> {
    return this.http.put<PlantingIntention>(`${this.baseUrl}/plantingintentions/${id}`, data)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a planting intention */
  deletePlantingIntention(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/plantingintentions/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Gets all 3 dashboard datasets in one request (estimates + market shares + actual harvest) */
  getDashboardSummary(tradeUnitKey: string, plantingYear: number): Observable<DashboardSummary> {
    const params = new HttpParams().set('tradeUnitKey', tradeUnitKey).set('plantingYear', plantingYear);
    return this.http.get<DashboardSummary>(`${this.baseUrl}/dashboardplantingestimates/summary`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Gets saved dashboard planting estimates for a trade unit key + year */
  getDashboardPlantingEstimates(tradeUnitKey: string, plantingYear: number): Observable<DashboardPlantingEstimate[]> {
    const params = new HttpParams().set('tradeUnitKey', tradeUnitKey).set('plantingYear', plantingYear);
    return this.http.get<DashboardPlantingEstimate[]>(`${this.baseUrl}/dashboardplantingestimates`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Upserts dashboard planting estimates (yield only) for a trade unit key + year */
  upsertDashboardPlantingEstimates(estimates: { tradeUnitKey: string; crop: string; plantingYear: number; yieldEstimate?: number | null }[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/dashboardplantingestimates/upsert`, estimates)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Gets saved dashboard market shares for a trade unit key + year */
  getDashboardMarketShares(tradeUnitKey: string, plantingYear: number): Observable<DashboardMarketShare[]> {
    const params = new HttpParams().set('tradeUnitKey', tradeUnitKey).set('plantingYear', plantingYear);
    return this.http.get<DashboardMarketShare[]>(`${this.baseUrl}/dashboardplantingestimates/marketshares`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Upserts dashboard market shares for a trade unit key + year */
  upsertDashboardMarketShares(shares: { tradeUnitKey: string; cropCategory: string; plantingYear: number; marketSharePct?: number | null }[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/dashboardplantingestimates/marketshares/upsert`, shares)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches actual prev-year harvest handle rows for a trade unit key + year */
  getDashboardActualHarvest(tradeUnitKey: string, plantingYear: number): Observable<DashboardActualHarvest[]> {
    const params = new HttpParams().set('tradeUnitKey', tradeUnitKey).set('plantingYear', plantingYear);
    return this.http.get<DashboardActualHarvest[]>(`${this.baseUrl}/dashboardplantingestimates/actualharvest`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Upserts actual harvest rows for a trade unit key + year */
  upsertDashboardActualHarvest(items: { tradeUnitKey: string; cropCategory: string; plantingYear: number; bushels: number }[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/dashboardplantingestimates/actualharvest/upsert`, items)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a single actual harvest row by id */
  deleteDashboardActualHarvest(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/dashboardplantingestimates/actualharvest/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Note Operations (Customer contact notes)
  // ==========================================================================

  /** Fetches notes, optionally filtered by trade units */
  getNotes(tradeUnits?: string[]): Observable<Note[]> {
    const url = tradeUnits?.length
      ? `${this.baseUrl}/notes?tradeUnits=${encodeURIComponent(tradeUnits.join(','))}`
      : `${this.baseUrl}/notes`;
    const key = `notes:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this._dedupe(key,
      this.http.get<Note[]>(url).pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all notes for a specific customer */
  getNotesByCustomer(customerId: number): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes/customer/${customerId}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Creates a new note for a customer */
  createNote(customerId: number, content: string, tradeUnit?: string): Observable<Note> {
    return this.http.post<Note>(`${this.baseUrl}/notes`, { customerId, content, tradeUnit })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Toggles the pinned status of a note */
  toggleNotePin(id: number): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}/toggle-pin`, {})
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates the content of a note */
  updateNote(id: number, content: string): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}`, { content })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a note */
  deleteNote(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/notes/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Producer Details Operations
  // ==========================================================================

  /** Fetches all producer details records */
  getAllProducerDetails(): Observable<ProducerDetails[]> {
    return this.http.get<ProducerDetails[]>(`${this.baseUrl}/producerdetails`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches producer details for a specific customer */
  getProducerDetails(customerId: number): Observable<ProducerDetails> {
    return this.http.get<ProducerDetails>(`${this.baseUrl}/producerdetails/customer/${customerId}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Creates or updates producer details for a customer */
  saveProducerDetails(customerId: number, data: { sourceCustomerId?: string | null; customerName: string; totalAcres?: number | null; binCapacity?: number | null; primaryContact?: string | null; commodities?: string | null; linkedProducerIds?: string | null }): Observable<ProducerDetails> {
    return this.http.put<ProducerDetails>(`${this.baseUrl}/producerdetails/customer/${customerId}`, data)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes producer details for a customer */
  deleteProducerDetails(customerId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/producerdetails/customer/${customerId}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Stored Grain Operations
  // ==========================================================================

  /** Fetches all stored grain records in the system */
  getStoredGrain(tradeUnits?: string[]): Observable<StoredGrain[]> {
    let params = new HttpParams();
    if (tradeUnits?.length) params = params.set('tradeUnits', tradeUnits.join(','));
    const key = `storedgrain:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this._dedupe(key,
      this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all stored grain records for a specific customer */
  getStoredGrainByCustomer(customerId: number): Observable<StoredGrain[]> {
    return this.http.get<StoredGrain[]>(`${this.baseUrl}/storedgrain/customer/${customerId}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // User Preference Operations
  // ==========================================================================

  getUserPreference(): Observable<{ selectedGroupNames: string[]; selectedTradeUnits: string[] }> {
    return this.http.get<{ selectedGroupNames: string[]; selectedTradeUnits: string[] }>(`${this.baseUrl}/userpreferences`)
      .pipe(catchError(e => this.handleError(e)));
  }

  saveUserPreference(selectedGroupNames: string[], selectedTradeUnits: string[]): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/userpreferences`, { selectedGroupNames, selectedTradeUnits })
      .pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Commodity Operations
  // ==========================================================================

  /** Fetches all active commodities from the lookup table */
  getCommodities(): Observable<Commodity[]> {
    return this.http.get<Commodity[]>(`${this.baseUrl}/commodities`)
      .pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Saved List Operations (Customer query lists)
  // ==========================================================================

  /** Fetches all saved customer lists — deserializes the Filters JSON string to an object */
  getSavedLists(): Observable<SavedList[]> {
    return this._dedupe('savedlists',
      this.http.get<any[]>(`${this.baseUrl}/savedlists`).pipe(
        map(lists => lists.map(l => ({
          ...l,
          filters: l.filters ? (() => { try { return JSON.parse(l.filters) as RefinementFilters; } catch { return undefined; } })() : undefined
        }))),
        catchError(e => this.handleError(e))
      )
    );
  }

  /** Creates a new saved list (stores only the query prompt + optional filters, not customer IDs) */
  createSavedList(data: { name: string; query: string; tradeUnits?: string; filters?: RefinementFilters }): Observable<SavedList> {
    const payload = {
      ...data,
      filters: data.filters && Object.keys(data.filters).length > 0 ? JSON.stringify(data.filters) : null
    };
    return this.http.post<SavedList>(`${this.baseUrl}/savedlists`, payload)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates an existing saved list by ID */
  updateSavedList(id: number, data: { name: string; query: string; tradeUnits?: string; filters?: RefinementFilters }): Observable<SavedList> {
    const payload = {
      ...data,
      filters: data.filters && Object.keys(data.filters).length > 0 ? JSON.stringify(data.filters) : null
    };
    return this.http.put<SavedList>(`${this.baseUrl}/savedlists/${id}`, payload)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a saved list by ID */
  deleteSavedList(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/savedlists/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  // =========================================================================
  // Bid Sheet Operations
  // =========================================================================

  /** Gets elevators from ODS. If tradeUnitCode omitted, returns all. */
  getElevators(tradeUnitCode?: string): Observable<Elevator[]> {
    const params: any = {};
    if (tradeUnitCode) params.tradeUnitCode = tradeUnitCode;
    return this.http.get<Elevator[]>(`${this.baseUrl}/bidsheet/elevators`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Gets bid sheet locations (with nested bids) for a trade unit */
  getBidSheetLocations(tradeUnitCode: string): Observable<BidSheetLocation[]> {
    return this.http.get<BidSheetLocation[]>(`${this.baseUrl}/bidsheet/locations`, { params: { tradeUnitCode } })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Creates a new bid sheet location with initial bids */
  createBidSheetLocation(location: {
    name?: string; address?: string; city?: string; state?: string;
    latitude?: number; longitude?: number; elevatorCode?: string;
    tradeUnitCode?: string; groupName?: string;
    bids: Array<{ commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string }>;
  }): Observable<BidSheetLocation> {
    return this.http.post<BidSheetLocation>(`${this.baseUrl}/bidsheet/locations`, location)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates a bid sheet location's metadata */
  updateBidSheetLocation(id: number, location: Partial<BidSheetLocation>): Observable<BidSheetLocation> {
    return this.http.put<BidSheetLocation>(`${this.baseUrl}/bidsheet/locations/${id}`, location)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a bid sheet location and all its bids */
  deleteBidSheetLocation(id: number, tradeUnitCode: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/bidsheet/locations/${id}?tradeUnitCode=${encodeURIComponent(tradeUnitCode)}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Bulk upserts bids (used by the edit-bids grid) */
  bulkUpsertBidSheetBids(bids: Array<{
    name?: string; elevatorCode?: string; tradeUnitCode?: string; groupName?: string;
    latitude?: number; longitude?: number;
    commodityCode: string; commodityName?: string; commodityCategory?: string;
    cropYear: number; bid: string;
  }>): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/bidsheet/bids/bulk`, bids)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Gets distinct crop years from bids for a trade unit */
  getBidCropYears(tradeUnitCode: string): Observable<number[]> {
    return this.http.get<number[]>(`${this.baseUrl}/bidsheet/cropyears`, { params: { tradeUnitCode } })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Gets distinct commodity codes from bids for a trade unit */
  getBidCommodities(tradeUnitCode: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/bidsheet/commodities`, { params: { tradeUnitCode } })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Gets the reference elevator for the current user and a trade unit. Returns null if not set. */
  getBidSheetReference(tradeUnitCode: string): Observable<{ tradeUnitCode: string; elevatorCode: string } | null> {
    return this.http.get<{ tradeUnitCode: string; elevatorCode: string }>(`${this.baseUrl}/bidsheet/reference`, { params: { tradeUnitCode } })
      .pipe(catchError(() => of(null)));
  }

  /** Sets or updates the reference elevator for the current user and a trade unit. */
  setBidSheetReference(tradeUnitCode: string, elevatorCode: string): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/bidsheet/reference`, { tradeUnitCode, elevatorCode })
      .pipe(catchError(e => this.handleError(e)));
  }

  // =========================================================================
  // Geocoding
  // =========================================================================

  /** Free-text geocode search via backend proxy */
  geocodeSearch(query: string): Observable<Array<{ lat: number; lng: number }>> {
    return this.http.get<Array<{ lat: number; lng: number }>>(`${this.baseUrl}/geocode/search`, { params: { q: query, limit: '1' } })
      .pipe(catchError(() => of([])));
  }
}
