import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Contract, ContractPricingLine, Ticket } from '@models';
import { environment } from '@env/environment';
import { injectApiErrorHandler } from '@core/http/api-error-handler';
import { dedupeRequests } from '@core/http/dedupe-requests';

/**
 * The Contracts module's API: the trade units' contracts and tickets, today's tickets, a crop year's contracts, and one
 * producer's contracts, tickets and pricing lines.
 */
@Injectable({ providedIn: 'root' })
export class ContractsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly dedupe = dedupeRequests();
  private readonly handleError = injectApiErrorHandler();

  // ==========================================================================
  // Contracts and pricing lines
  // ==========================================================================

  /** Fetches all contracts in the system */
  getContracts(tradeUnits?: string[]): Observable<Contract[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    const key = `contracts:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this.dedupe(key,
      this.http.get<Contract[]>(`${this.baseUrl}/contracts`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches ALL purchase contracts (open + closed) from base.Contract for a specific crop year, scoped to the given trade units. Used by the Planting Intentions Dashboard's Harvest & Contracts tab. */
  getContractsByCropYear(cropYear: number, tradeUnits?: string[]): Observable<Contract[]> {
    let params = new HttpParams();
    if (tradeUnits && tradeUnits.length > 0) {
      for (const tu of tradeUnits) params = params.append('tradeUnits', tu);
    }
    const tuKey = (tradeUnits && tradeUnits.length > 0) ? tradeUnits.slice().sort().join(',') : '';
    return this.dedupe(`contracts-by-crop-year:${cropYear}:${tuKey}`,
      // Rethrows rather than swallowing: this feeds the planting-coverage prompts, where a failed read
      // returning [] reads as "nobody has contracts for this crop year".
      this.http.get<Contract[]>(`${this.baseUrl}/contracts/by-crop-year/${cropYear}`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all contracts for a specific customer */
  getContractsByCustomer(customerId: number, scoularId?: string): Observable<Contract[]> {
    let params = new HttpParams();
    if (scoularId) params = params.set('scoularId', scoularId);
    return this.http.get<Contract[]>(`${this.baseUrl}/contracts/customer/${customerId}`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Fetches all pricing lines for a customer's contracts by scoularId */
  getPricingLinesByCustomer(scoularId: string): Observable<ContractPricingLine[]> {
    const params = new HttpParams().set('scoularId', scoularId);
    return this.http.get<ContractPricingLine[]>(
      `${this.baseUrl}/contracts/pricing-lines/by-customer`, { params }
    ).pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Tickets (grain delivery tickets)
  // ==========================================================================

  /** Fetches all delivery tickets in the system */
  getTickets(tradeUnits?: string[]): Observable<Ticket[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    const key = `tickets:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this.dedupe(key,
      this.http.get<Ticket[]>(`${this.baseUrl}/tickets`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches today's delivery tickets only — fast path for Spot Loads in Insights */
  getTodaysTickets(tradeUnits?: string[]): Observable<Ticket[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    const key = `tickets:today:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this.dedupe(key,
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
}
