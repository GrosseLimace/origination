import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  PlantingIntention,
  Note,
  NoteLastContact,
  Reminder,
  ReminderDue,
  StoredGrain,
  Commodity,
  ProducerDetails,
  DashboardPlantingEstimate,
  DashboardMarketShare,
  DashboardActualHarvest,
  DashboardSummary,
  CommodityConversion,
  HarvestWindow,
  NoteMention,
  GraphTeamsChannel,
  MentionCatalog,
  DpContract
} from '@models';
import { environment } from '@env/environment';
import { injectApiErrorHandler } from '@core/http/api-error-handler';
import { dedupeRequests } from '@core/http/dedupe-requests';

/**
 * ApiService provides HTTP methods for communicating with the .NET Web API backend.
 * All methods return RxJS Observables for async data handling.
 */
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  // In-flight request deduplication: concurrent callers of the same slow endpoint share one request.
  private readonly _dedupe = dedupeRequests();
  private readonly handleError = injectApiErrorHandler();

  /** Where the browser sends its error telemetry, or null when it is off. Swallows its own failure
   *  without a toast: telemetry being unavailable is not something the user can act on. */
  getClientTelemetryConfig(): Observable<{ connectionString: string | null }> {
    return this.http.get<{ connectionString: string | null }>(`${this.baseUrl}/clienttelemetry`)
      .pipe(catchError(() => of({ connectionString: null })));
  }

  // ==========================================================================
  // The user's and the system's trade units
  // ==========================================================================
  // The customer calls, the searches included, are the Customers module's (CustomersApiService).

  /** Fetches trade unit groups assigned to the currently authenticated user from the TradeUnitPreferences database */
  getUserTradeUnits(): Observable<{ groupName: string; tradeUnitCodes: string[]; tradeUnits: { code: string; description?: string }[] }[]> {
    return this.http.get<{ groupName: string; tradeUnitCodes: string[]; tradeUnits: { code: string; description?: string }[] }[]>(`${this.baseUrl}/usertradeunits`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches the full entitlements directory (people / trade units / TU groups) used by the
   *  Daily Digest Recap Group picker. One call returns all three lists. */
  getEntitlementsCatalog(): Observable<import('@models').EntitlementsCatalog> {
    return this.http.get<import('@models').EntitlementsCatalog>(`${this.baseUrl}/entitlements/catalog`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** All trade units in the system (code + description) for the onboarding assign dropdown. */
  getAllTradeUnits(): Observable<{ code: string; description?: string }[]> {
    return this._dedupe('all-trade-units',
      this.http.get<{ code: string; description?: string }[]>(`${this.baseUrl}/trade-units`)
        .pipe(catchError(() => of([] as { code: string; description?: string }[])))
    );
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

  /** Updates an existing planting intention. `tradeUnit` omitted = leave the stored trade unit as is;
   *  a value must be one of the producer's trade units (the API returns 400 otherwise). */
  updatePlantingIntention(id: number, data: {
    crop: string;
    category?: string;
    type?: string;
    description?: string;
    acres: number;
    plantingYear: number;
    tradeUnit?: string;
  }): Observable<PlantingIntention> {
    return this.http.put<PlantingIntention>(`${this.baseUrl}/plantingintentions/${id}`, data)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Moves every one of a producer's planting intentions from one trade unit to another. Used when
   *  a producer is unassigned from a trade unit and the originator says where the acres now count.
   *  The target must be one of the producer's active trade units (the API returns 400 otherwise). */
  retagPlantingIntentions(customerId: number, fromTradeUnit: string, toTradeUnit: string): Observable<{ moved: number }> {
    return this.http.post<{ moved: number }>(`${this.baseUrl}/plantingintentions/retag`, { customerId, fromTradeUnit, toTradeUnit })
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

  /** Fetches notes. With no options this is the full set; the options narrow the read SERVER-SIDE
   *  so note-scoped prompts don't pull all ~28.8k notes:
   *   - `sinceDays`   — only notes created within the last N days (date-recency prompts).
   *   - `contentAny`  — only notes whose text contains ANY of these keywords (content search).
   *   - `authorAny`   — only notes whose author (CreatedBy/ModifiedBy) contains ANY of these.
   *   - `pinnedOnly`  — only pinned notes.
   *  Each is a SUPERSET the caller then matches exactly, so results are unchanged — just fewer
   *  rows over the wire. Every distinct option set gets its own dedupe key so a partial slice never
   *  collides with (or masquerades as) the full-set cache. */
  getNotes(tradeUnits?: string[], opts?: { sinceDays?: number; contentAny?: string[]; authorAny?: string[]; pinnedOnly?: boolean; customerIds?: number[] }): Observable<Note[]> {
    const params: string[] = [];
    if (tradeUnits?.length) params.push(`tradeUnits=${encodeURIComponent(tradeUnits.join(','))}`);
    if (opts?.sinceDays != null && opts.sinceDays > 0) params.push(`sinceDays=${opts.sinceDays}`);
    if (opts?.contentAny?.length) params.push(`contentAny=${encodeURIComponent(opts.contentAny.join(','))}`);
    if (opts?.authorAny?.length) params.push(`authorAny=${encodeURIComponent(opts.authorAny.join(','))}`);
    if (opts?.pinnedOnly) params.push('pinnedOnly=true');
    if (opts?.customerIds?.length) params.push(`customerIds=${encodeURIComponent(opts.customerIds.join(','))}`);
    const url = params.length ? `${this.baseUrl}/notes?${params.join('&')}` : `${this.baseUrl}/notes`;
    const scopeParams = params.filter(p => !p.startsWith('tradeUnits=')).sort().join('&');
    const key = `notes:${[...(tradeUnits ?? [])].sort().join(',')}:${scopeParams}`;
    return this._dedupe(key,
      this.http.get<Note[]>(url).pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Per-customer "last contacted" aggregate — tiny rows (no note bodies), all trade units.
   *  Feeds the list badges; payload is bounded by customer count, not note count. */
  getNotesLastContact(): Observable<NoteLastContact[]> {
    return this._dedupe('notes-last-contact',
      this.http.get<NoteLastContact[]>(`${this.baseUrl}/notes/last-contact`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all notes for a specific customer */
  getNotesByCustomer(customerId: number): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes/customer/${customerId}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Creates a new note for a customer (optionally with "@" mentions) */
  createNote(customerId: number, content: string, tradeUnit?: string, mentions?: NoteMention[]): Observable<Note> {
    return this.http.post<Note>(`${this.baseUrl}/notes`, { customerId, content, tradeUnit, mentions })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Lookup data (people / trade units / groups) for the note "@" mention picker */
  /** The Teams channels the signed-in user belongs to. The API reads these from Graph
   *  on-behalf-of the caller, so the browser never talks to Graph and never holds a Graph token.
   *  An empty list means consent has not been granted in this environment. */
  getMyTeamsChannels(): Observable<GraphTeamsChannel[]> {
    return this.http
      .get<GraphTeamsChannel[]>(`${this.baseUrl}/teamschannels/mine`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Registers a Teams channel the composer read from Graph, or returns the row that already
   *  exists for it. Idempotent, so the composer calls it on every pick without checking first.
   *  Returns the registry id the note mention must carry. */
  registerTeamsChannel(body: {
    teamId: string; teamName: string; channelId: string; displayName: string; channelEmail: string;
  }): Observable<{ id: number; displayName: string; teamName: string; channelId: string }> {
    return this.http
      .post<{ id: number; displayName: string; teamName: string; channelId: string }>(
        `${this.baseUrl}/teamschannels`, body)
      .pipe(catchError(e => this.handleError(e)));
  }

  getMentionCatalog(): Observable<MentionCatalog> {
    return this._dedupe('mention-catalog',
      this.http.get<MentionCatalog>(`${this.baseUrl}/notes/mention-catalog`)
        .pipe(catchError(() => of<MentionCatalog>({ people: [], tradeUnits: [], tradeUnitGroups: [], appGroups: [], teamsChannels: [] })))
    );
  }

  /** Toggles the pinned status of a note */
  toggleNotePin(id: number): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}/toggle-pin`, {})
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates the content of a note. `mentions` MUST be supplied whenever the caller knows them:
   *  omitting it leaves the note's existing mentions untouched, while passing [] clears them.
   *  (Sending nothing used to wipe them outright — every edit silently destroyed a note's
   *  mentions and their highlighting.) */
  updateNote(id: number, content: string, mentions?: NoteMention[]): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}`, { content, mentions })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a note */
  deleteNote(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/notes/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Reminder Operations (personal producer follow-ups)
  // ==========================================================================
  // Every route below is scoped server-side to the signed-in user: reminders are private, so
  // these never return or touch another originator's follow-ups.

  /** The signed-in user's reminders for one producer, soonest due first. */
  getRemindersByCustomer(customerId: number, includeCompleted = false): Observable<Reminder[]> {
    const query = includeCompleted ? '?includeCompleted=true' : '';
    return this.http.get<Reminder[]>(`${this.baseUrl}/reminders/customer/${customerId}${query}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Every OPEN reminder the signed-in user owns — tiny rows feeding the producer-list badge.
   *  Payload is bounded by the user's own follow-ups, not by the team's. */
  getMyReminders(): Observable<ReminderDue[]> {
    return this._dedupe('reminders-mine',
      this.http.get<ReminderDue[]>(`${this.baseUrl}/reminders/mine`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Creates a follow-up reminder. `dueAt` must be a UTC ISO string. */
  createReminder(customerId: number, dueAt: string, subject?: string, notes?: string): Observable<Reminder> {
    return this.http.post<Reminder>(`${this.baseUrl}/reminders`, { customerId, dueAt, subject, notes })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Edits the due date, subject or notes of one of the user's own reminders. */
  /** Saves an edit. `timeZone` rides along because the API moves the Outlook event in the same call
   *  when the due date changed, and Graph needs a local time plus a zone name. */
  updateReminder(id: number, dueAt: string, subject?: string, notes?: string, timeZone?: string): Observable<Reminder> {
    return this.http.put<Reminder>(`${this.baseUrl}/reminders/${id}`, { dueAt, subject, notes, timeZone })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Marks a reminder complete, or reopens it. */
  setReminderCompleted(id: number, isCompleted: boolean): Observable<Reminder> {
    return this.http.put<Reminder>(`${this.baseUrl}/reminders/${id}/complete`, { isCompleted })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Puts an existing reminder on the caller's own Outlook calendar. The API writes the event via
   *  Graph on-behalf-of the user and records the id, so the browser never touches Graph. A reminder
   *  that comes back with a null `outlookEventId` means the calendar could not be written, and the
   *  row keeps offering the retry. */
  addReminderToOutlook(id: number, body: { timeZone: string; producerLink: string }): Observable<Reminder> {
    return this.http.post<Reminder>(`${this.baseUrl}/reminders/${id}/outlook`, body)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes one of the user's own reminders. */
  deleteReminder(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/reminders/${id}`)
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

  /** Creates or updates producer details for a customer. `contacts` and `binSites` array order is
   *  the display order; omitting either property entirely preserves the customer's existing rows. */
  saveProducerDetails(customerId: number, data: { scoularId?: string | null; customerName: string; totalAcres?: number | null; primaryContact?: string | null; primaryPhone?: string | null; commodities?: string | null; linkedProducerIds?: string | null; grainOnFarm?: { binSiteKey?: string | null; commodityCode: string; bushelsOnHand?: number | null; bushelsSold?: number | null; targetBushels?: number | null; lastBid?: number | null; grade?: string | null }[]; contacts?: { name: string; phone?: string | null; email?: string | null; isPrimary?: boolean }[]; binSites?: { siteKey?: string; name: string; latitude?: number | null; longitude?: number | null; capacity?: number | null }[] }): Observable<ProducerDetails> {
    return this.http.put<ProducerDetails>(`${this.baseUrl}/producerdetails/customer/${customerId}`, data)
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
  // DP Contract Operations
  // ==========================================================================

  /** Fetches all DP (delayed-pricing) contract positions in the system */
  getDpContracts(tradeUnits?: string[]): Observable<DpContract[]> {
    let params = new HttpParams();
    if (tradeUnits?.length) params = params.set('tradeUnits', tradeUnits.join(','));
    const key = `dpcontracts:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this._dedupe(key,
      this.http.get<DpContract[]>(`${this.baseUrl}/dpcontracts`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all DP contract positions for a specific customer */
  getDpContractsByCustomer(customerId: number): Observable<DpContract[]> {
    return this.http.get<DpContract[]>(`${this.baseUrl}/dpcontracts/customer/${customerId}`)
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

  /** Curated commodities flagged for the Planting Intentions crop dropdown (subset of getCommodities). */
  getPlantingCommodities(): Observable<Commodity[]> {
    return this.http.get<Commodity[]>(`${this.baseUrl}/commodities/planting`)
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

  // =========================================================================
  // Geocoding
  // =========================================================================

  /** Free-text geocode search via backend proxy */
  geocodeSearch(query: string): Observable<Array<{ lat: number; lng: number }>> {
    return this.http.get<Array<{ lat: number; lng: number }>>(`${this.baseUrl}/geocode/search`, { params: { q: query, limit: '1' } })
      .pipe(catchError(() => of([])));
  }

}
