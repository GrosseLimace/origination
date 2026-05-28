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
  Elevator,
  CommodityConversion,
  HarvestWindow,
  UsageDashboardSummary,
  UsageDashboardUser,
  UsageDashboardInactiveUser,
  DailyActive,
  FeatureSessions,
  QueryLibraryUsage,
  QuerySearchGap,
  WeeklyTrend,
  ActivityBreakdown,
  UnderusedFeature,
  UserUsageDetail,
  QueryLibraryItem
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

  /** Fetches trade unit groups assigned to the currently authenticated user from the Entitlements database */
  getUserTradeUnits(): Observable<{ groupName: string; tradeUnitCodes: string[] }[]> {
    return this.http.get<{ groupName: string; tradeUnitCodes: string[] }[]>(`${this.baseUrl}/usertradeunits`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Searches the ODS customer master for producers not yet in our tables (onboarding fallback). */
  searchOdsCustomers(searchTerm: string): Observable<Customer[]> {
    const params = new HttpParams().set('searchTerm', searchTerm);
    return this.http.get<Customer[]>(`${this.baseUrl}/customers/search-ods`, { params })
      .pipe(catchError(() => of([] as Customer[])));
  }

  /** Assigns trade units to a producer, onboarding them into our tables if not present. */
  assignTradeUnits(customerId: number, tradeUnitCodes: string[]): Observable<Customer> {
    return this.http.put<Customer>(`${this.baseUrl}/customers/${customerId}/trade-units`, { tradeUnitCodes })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** A producer's active trade-unit memberships (code + isManual) for the edit dialog. */
  getCustomerTradeUnits(customerId: number): Observable<{ tradeUnit: string; isManual: boolean }[]> {
    return this.http.get<{ tradeUnit: string; isManual: boolean }[]>(`${this.baseUrl}/customers/${customerId}/trade-units`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** All trade units in the system (code + description) for the onboarding assign dropdown. */
  getAllTradeUnits(): Observable<{ code: string; description?: string }[]> {
    return this._dedupe('all-trade-units',
      this.http.get<{ code: string; description?: string }[]>(`${this.baseUrl}/trade-units`)
        .pipe(catchError(() => of([] as { code: string; description?: string }[])))
    );
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

  /** Fetches customers whose linkedProducerIds contains the given source id (incoming links). */
  getCustomersLinkedTo(sourceId: string): Observable<Customer[]> {
    return this.http.get<Customer[]>(`${this.baseUrl}/customers/linked-to/${encodeURIComponent(sourceId)}`)
      .pipe(catchError(() => of([] as Customer[])));
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

  /** Fetches closed historical contracts for Contract Pacing year-over-year comparison. */
  getHistoricalContractsForPacing(customerId: number): Observable<Contract[]> {
    return this._dedupe(`contracts-pacing:${customerId}`,
      this.http.get<Contract[]>(`${this.baseUrl}/contracts/pacing/${customerId}`)
        .pipe(catchError(() => of([] as Contract[])))
    );
  }

  /** Fetches ALL purchase contracts (open + closed) from base.Contract for a specific crop year, scoped to the given trade units. Used by the Planting Intentions Dashboard's Harvest & Contracts tab. */
  getContractsByCropYear(cropYear: number, tradeUnits?: string[]): Observable<Contract[]> {
    let params = new HttpParams();
    if (tradeUnits && tradeUnits.length > 0) {
      for (const tu of tradeUnits) params = params.append('tradeUnits', tu);
    }
    const tuKey = (tradeUnits && tradeUnits.length > 0) ? tradeUnits.slice().sort().join(',') : '';
    return this._dedupe(`contracts-by-crop-year:${cropYear}:${tuKey}`,
      this.http.get<Contract[]>(`${this.baseUrl}/contracts/by-crop-year/${cropYear}`, { params })
        .pipe(catchError(() => of([] as Contract[])))
    );
  }

  /** Fetches all contracts for a specific customer */
  getContractsByCustomer(customerId: number, scoularId?: string): Observable<Contract[]> {
    let params = new HttpParams();
    if (scoularId) params = params.set('scoularId', scoularId);
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

  /** Fetches all pricing lines for a customer's contracts by scoularId */
  getPricingLinesByCustomer(scoularId: string): Observable<ContractPricingLine[]> {
    const params = new HttpParams().set('scoularId', scoularId);
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
  getTicketsByCustomer(customerId: number, scoularId?: string): Observable<Ticket[]> {
    let params = new HttpParams();
    if (scoularId) params = params.set('scoularId', scoularId);
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/customer/${customerId}`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Per-producer unapplied tickets — the fast, narrowly-scoped fetch the home page fires on
   *  producer select. Applied tickets are loaded lazily per-contract via {@link getAppliedTicketsByContract}. */
  getUnappliedTicketsByCustomer(customerId: number, scoularId?: string): Observable<Ticket[]> {
    let params = new HttpParams();
    if (scoularId) params = params.set('scoularId', scoularId);
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/customer/${customerId}/unapplied`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Lazy per-contract applied-tickets fetch — fires when the contracts table expands a row.
   *  Contract numbers may contain spaces (e.g. "PC  13042") so the id must be URL-encoded. */
  getAppliedTicketsByContract(sourceContractId: string): Observable<Ticket[]> {
    return this.http.get<Ticket[]>(`${this.baseUrl}/tickets/contract/${encodeURIComponent(sourceContractId)}/applied`)
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
    category?: string;
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
    category?: string;
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
    return this._dedupe('producerdetails',
      this.http.get<ProducerDetails[]>(`${this.baseUrl}/producerdetails`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches producer details for a specific customer */
  getProducerDetails(customerId: number): Observable<ProducerDetails> {
    return this.http.get<ProducerDetails>(`${this.baseUrl}/producerdetails/customer/${customerId}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Creates or updates producer details for a customer */
  saveProducerDetails(customerId: number, data: { scoularId?: string | null; customerName: string; totalAcres?: number | null; binCapacity?: number | null; primaryContact?: string | null; commodities?: string | null; linkedProducerIds?: string | null }): Observable<ProducerDetails> {
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

  /** Fetches commodity conversion factors (lbs per bushel) from ODS */
  getCommodityConversions(): Observable<CommodityConversion[]> {
    return this._dedupe('commodity-conversions',
      this.http.get<CommodityConversion[]>(`${this.baseUrl}/commodities/conversions`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches harvest delivery windows per commodity */
  getHarvestWindows(): Observable<HarvestWindow[]> {
    return this._dedupe('harvest-windows',
      this.http.get<HarvestWindow[]>(`${this.baseUrl}/commodities/harvest-windows`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  // ==========================================================================
  // Query Library Operations
  // ==========================================================================

  /** Fetches all active query library items, sorted by category then sort order. */
  getQueryLibrary(): Observable<QueryLibraryItem[]> {
    return this.http.get<QueryLibraryItem[]>(`${this.baseUrl}/query-library`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Logs a query library search for gap analysis. Fire-and-forget. */
  logQuerySearch(searchText: string, matchedQueryId?: number): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/query-library/search-log`, {
      searchText,
      matchedQueryId: matchedQueryId ?? null
    }).pipe(catchError(() => of(undefined as unknown as void)));
  }

  // ==========================================================================
  // Saved List Operations (Customer query lists)
  // ==========================================================================

  /** Fetches all saved customer lists — deserializes JSON strings to objects */
  getSavedLists(): Observable<SavedList[]> {
    const parseJson = <T>(val: string | null | undefined): T | undefined => {
      if (!val) return undefined;
      try { return JSON.parse(val) as T; } catch { return undefined; }
    };
    return this._dedupe('savedlists',
      this.http.get<any[]>(`${this.baseUrl}/savedlists`).pipe(
        map(lists => lists.map(l => ({
          ...l,
          filters: parseJson<RefinementFilters>(l.filters),
          includedCustomerIds: parseJson<number[]>(l.includedCustomerIds),
          excludedCustomerIds: parseJson<number[]>(l.excludedCustomerIds),
        }))),
        catchError(e => this.handleError(e))
      )
    );
  }

  /** Creates a new saved list */
  createSavedList(data: { name: string; query: string; tradeUnits?: string; filters?: RefinementFilters; includedCustomerIds?: number[]; excludedCustomerIds?: number[] }): Observable<SavedList> {
    const payload = {
      ...data,
      filters: data.filters && Object.keys(data.filters).length > 0 ? JSON.stringify(data.filters) : null,
      includedCustomerIds: data.includedCustomerIds?.length ? JSON.stringify(data.includedCustomerIds) : null,
      excludedCustomerIds: data.excludedCustomerIds?.length ? JSON.stringify(data.excludedCustomerIds) : null,
    };
    return this.http.post<SavedList>(`${this.baseUrl}/savedlists`, payload)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates an existing saved list by ID */
  updateSavedList(id: number, data: { name: string; query: string; tradeUnits?: string; filters?: RefinementFilters; includedCustomerIds?: number[]; excludedCustomerIds?: number[] }): Observable<SavedList> {
    const payload = {
      ...data,
      filters: data.filters && Object.keys(data.filters).length > 0 ? JSON.stringify(data.filters) : null,
      includedCustomerIds: data.includedCustomerIds?.length ? JSON.stringify(data.includedCustomerIds) : null,
      excludedCustomerIds: data.excludedCustomerIds?.length ? JSON.stringify(data.excludedCustomerIds) : null,
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
    return this._dedupe(`bidsheet-elevators-${tradeUnitCode ?? 'all'}`,
      this.http.get<Elevator[]>(`${this.baseUrl}/bidsheet/elevators`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Gets bid sheet locations (with nested bids) for a trade unit */
  getBidSheetLocations(tradeUnitCode: string): Observable<BidSheetLocation[]> {
    return this._dedupe(`bidsheet-locations-${tradeUnitCode}`,
      this.http.get<BidSheetLocation[]>(`${this.baseUrl}/bidsheet/locations`, { params: { tradeUnitCode } })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Gets all bid sheet locations across all trade units (for map display) */
  getAllBidSheetLocations(): Observable<BidSheetLocation[]> {
    return this._dedupe('bidsheet-all-locations',
      this.http.get<BidSheetLocation[]>(`${this.baseUrl}/bidsheet/locations`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Creates a new bid sheet location with initial bids */
  createBidSheetLocation(location: {
    name?: string; address?: string; city?: string; state?: string;
    latitude?: number; longitude?: number; elevatorCode?: string;
    tradeUnitCode?: string; groupName?: string; isScoularFacility?: boolean;
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

  /** Deletes all bids for a specific commodity on a location */
  deleteBidSheetBids(locationId: number, commodityCode: string, tradeUnitCode: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/bidsheet/locations/${locationId}/bids/${encodeURIComponent(commodityCode)}?tradeUnitCode=${encodeURIComponent(tradeUnitCode)}`)
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
    return this._dedupe(`bidsheet-cropyears-${tradeUnitCode}`,
      this.http.get<number[]>(`${this.baseUrl}/bidsheet/cropyears`, { params: { tradeUnitCode } })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Gets distinct commodity codes from bids for a trade unit */
  getBidCommodities(tradeUnitCode: string): Observable<string[]> {
    return this._dedupe(`bidsheet-commodities-${tradeUnitCode}`,
      this.http.get<string[]>(`${this.baseUrl}/bidsheet/commodities`, { params: { tradeUnitCode } })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Gets distinct bid months for a trade unit and crop year */
  getBidMonths(tradeUnitCode: string, cropYear: number): Observable<number[]> {
    return this._dedupe(`bidsheet-months-${tradeUnitCode}-${cropYear}`,
      this.http.get<number[]>(`${this.baseUrl}/bidsheet/bidmonths`, { params: { tradeUnitCode, cropYear: cropYear.toString() } })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Gets the saved location order for the current user and a trade unit key. Returns null if not set. */
  getBidSheetLocationOrder(tradeUnitKey: string): Observable<{ locationOrder: string } | null> {
    return this._dedupe(`bidsheet-location-order-${tradeUnitKey}`,
      this.http.get<{ locationOrder: string }>(`${this.baseUrl}/bidsheet/location-order`, { params: { tradeUnitKey } })
        .pipe(catchError(() => of(null)))
    );
  }

  /** Saves the location order for the current user and a trade unit key. */
  setBidSheetLocationOrder(tradeUnitKey: string, locationOrder: string): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/bidsheet/location-order`, { tradeUnitKey, locationOrder })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Gets saved bid sheet preferences (crop, month, year) for the current user and a trade unit key. */
  getBidSheetPreference(tradeUnitKey: string): Observable<{ tradeUnitKey: string; cropCode: string | null; month: number | null; cropYear: number | null; cropOrder: string | null; hiddenCrops: string | null; selectedMonths: string | null } | null> {
    return this._dedupe(`bidsheet-preference-${tradeUnitKey}`,
      this.http.get<{ tradeUnitKey: string; cropCode: string | null; month: number | null; cropYear: number | null; cropOrder: string | null; hiddenCrops: string | null; selectedMonths: string | null }>(`${this.baseUrl}/bidsheet/preference`, { params: { tradeUnitKey } })
        .pipe(catchError(() => of(null)))
    );
  }

  /** Saves bid sheet preferences for the current user and a trade unit key. */
  setBidSheetPreference(tradeUnitKey: string, cropCode: string | null, month: number | null, cropYear: number | null, cropOrder?: string | null, hiddenCrops?: string | null, selectedMonths?: string | null): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/bidsheet/preference`, { tradeUnitKey, cropCode, month, cropYear, cropOrder, hiddenCrops, selectedMonths })
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

  // =========================================================================
  // Usage Dashboard
  // =========================================================================

  private usageParams(from: string, to: string, tradeUnitKey?: string, extra?: Record<string, string>): Record<string, string> {
    const p: Record<string, string> = { from, to };
    if (tradeUnitKey) p['tradeUnitKey'] = tradeUnitKey;
    if (extra) Object.assign(p, extra);
    return p;
  }

  getUsageDashboardSummary(from: string, to: string, tradeUnitKey?: string): Observable<UsageDashboardSummary> {
    return this.http.get<UsageDashboardSummary>(`${this.baseUrl}/usage-dashboard/summary`, { params: this.usageParams(from, to, tradeUnitKey) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageDashboardUsers(from: string, to: string, tradeUnitKey?: string, status?: string): Observable<UsageDashboardUser[]> {
    const extra: Record<string, string> = {};
    if (status && status !== 'all') extra['status'] = status;
    return this.http.get<UsageDashboardUser[]>(`${this.baseUrl}/usage-dashboard/users`, { params: this.usageParams(from, to, tradeUnitKey, extra) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageDailyActive(from: string, to: string, tradeUnitKey?: string): Observable<DailyActive[]> {
    return this.http.get<DailyActive[]>(`${this.baseUrl}/usage-dashboard/daily-active`, { params: this.usageParams(from, to, tradeUnitKey) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageFeatureSessions(from: string, to: string, tradeUnitKey?: string, screen?: string): Observable<FeatureSessions[]> {
    const extra: Record<string, string> = {};
    if (screen && screen !== 'all') extra['screen'] = screen;
    return this.http.get<FeatureSessions[]>(`${this.baseUrl}/usage-dashboard/feature-sessions`, { params: this.usageParams(from, to, tradeUnitKey, extra) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageWeeklyTrend(tradeUnitKey?: string): Observable<WeeklyTrend[]> {
    const params: Record<string, string> = {};
    if (tradeUnitKey) params['tradeUnitKey'] = tradeUnitKey;
    return this.http.get<WeeklyTrend[]>(`${this.baseUrl}/usage-dashboard/weekly-trend`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageActivityBreakdown(from: string, to: string, tradeUnitKey?: string): Observable<ActivityBreakdown[]> {
    return this.http.get<ActivityBreakdown[]>(`${this.baseUrl}/usage-dashboard/activity-breakdown`, { params: this.usageParams(from, to, tradeUnitKey) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageDashboardInactive(from: string, to: string, tradeUnitKey?: string, daysThreshold?: number): Observable<UsageDashboardInactiveUser[]> {
    const extra: Record<string, string> = {};
    if (daysThreshold) extra['daysThreshold'] = daysThreshold.toString();
    return this.http.get<UsageDashboardInactiveUser[]>(`${this.baseUrl}/usage-dashboard/inactive`, { params: this.usageParams(from, to, tradeUnitKey, extra) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageQueryLibraryUsage(from: string, to: string, tradeUnitKey?: string): Observable<QueryLibraryUsage[]> {
    return this.http.get<QueryLibraryUsage[]>(`${this.baseUrl}/usage-dashboard/query-library-usage`, { params: this.usageParams(from, to, tradeUnitKey) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageQuerySearchGaps(from: string, to: string, tradeUnitKey?: string): Observable<QuerySearchGap[]> {
    return this.http.get<QuerySearchGap[]>(`${this.baseUrl}/usage-dashboard/query-search-gaps`, { params: this.usageParams(from, to, tradeUnitKey) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageUnderusedFeatures(from: string, to: string, tradeUnitKey?: string): Observable<UnderusedFeature[]> {
    return this.http.get<UnderusedFeature[]>(`${this.baseUrl}/usage-dashboard/underused-features`, { params: this.usageParams(from, to, tradeUnitKey) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUserUsageDetail(userId: string, from: string, to: string, tradeUnitKey?: string): Observable<UserUsageDetail> {
    return this.http.get<UserUsageDetail>(
      `${this.baseUrl}/usage-dashboard/users/${encodeURIComponent(userId)}/detail`,
      { params: this.usageParams(from, to, tradeUnitKey) }
    ).pipe(catchError(e => this.handleError(e)));
  }
}
