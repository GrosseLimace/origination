import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PlantingIntention, StoredGrain, DpContract, DashboardPlantingEstimate } from '@models';
import { DashboardMarketShare } from '../models/dashboard-market-share.model';
import { DashboardActualHarvest } from '../models/dashboard-actual-harvest.model';
import { DashboardSummary } from '../models/dashboard-summary.model';
import { environment } from '@env/environment';
import { injectApiErrorHandler } from '@core/http/api-error-handler';
import { dedupeRequests } from '@core/http/dedupe-requests';

/**
 * The Producers module's API: planting intentions, the Planting Dashboard's summary, estimates, market shares and
 * actual harvest, stored grain and DP contracts, for the trade units and for one producer.
 */
@Injectable({ providedIn: 'root' })
export class ProducersApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly dedupe = dedupeRequests();
  private readonly handleError = injectApiErrorHandler();

  // ==========================================================================
  // Planting Intention Operations
  // ==========================================================================

  /** Fetches planting intentions, optionally filtered by trade units */
  getPlantingIntentions(tradeUnits?: string[], plantingYear?: number): Observable<PlantingIntention[]> {
    let params = new HttpParams();
    if (tradeUnits?.length) params = params.set('tradeUnits', tradeUnits.join(','));
    if (plantingYear != null) params = params.set('plantingYear', plantingYear.toString());
    const key = `plantingintentions:${[...(tradeUnits ?? [])].sort().join(',')}:${plantingYear ?? ''}`;
    return this.dedupe(key,
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
  // Stored Grain Operations
  // ==========================================================================

  /** Fetches all stored grain records in the system */
  getStoredGrain(tradeUnits?: string[]): Observable<StoredGrain[]> {
    let params = new HttpParams();
    if (tradeUnits?.length) params = params.set('tradeUnits', tradeUnits.join(','));
    const key = `storedgrain:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this.dedupe(key,
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
    return this.dedupe(key,
      this.http.get<DpContract[]>(`${this.baseUrl}/dpcontracts`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all DP contract positions for a specific customer */
  getDpContractsByCustomer(customerId: number): Observable<DpContract[]> {
    return this.http.get<DpContract[]>(`${this.baseUrl}/dpcontracts/customer/${customerId}`)
      .pipe(catchError(e => this.handleError(e)));
  }
}
