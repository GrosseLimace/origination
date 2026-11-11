import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  Commodity,
  ProducerDetails,
  CommodityConversion,
  HarvestWindow,
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
