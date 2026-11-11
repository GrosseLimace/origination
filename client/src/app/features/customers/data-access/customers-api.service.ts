import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Customer } from '@models';
import { environment } from '@env/environment';
import { CustomerSearch } from '@core/context/customer-search';
import { injectApiErrorHandler } from '@core/http/api-error-handler';
import { dedupeRequests } from '@core/http/dedupe-requests';

/** A producer's membership of one trade unit, as the edit dialog shows it. */
export interface CustomerTradeUnit {
  tradeUnit: string;
  isManual: boolean;
  hasOpenActivity: boolean;
  isActive: boolean;
}

/**
 * The Customers module's API: the trade units' customers, searching them, one customer by id or source id, linked
 * producers, and a producer's trade-unit memberships. It is also core's CustomerSearch, for Help's troubleshooter.
 */
@Injectable({ providedIn: 'root' })
export class CustomersApiService implements CustomerSearch {
  private readonly http = inject(HttpClient);
  private readonly handleError = injectApiErrorHandler();
  private readonly dedupe = dedupeRequests();
  private readonly baseUrl = environment.apiBaseUrl;

  /** Fetches all customers in the system */
  getCustomers(tradeUnits?: string[]): Observable<Customer[]> {
    let params = new HttpParams();
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    const key = `customers:${[...(tradeUnits ?? [])].sort().join(',')}`;
    return this.dedupe(key,
      this.http.get<Customer[]>(`${this.baseUrl}/customers`, { params })
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Searches customers by name (max 15 results), within the trade units when any are given. */
  searchCustomers(searchTerm: string, tradeUnits?: string[]): Observable<Customer[]> {
    let params = new HttpParams().set('searchTerm', searchTerm);
    tradeUnits?.forEach(tu => params = params.append('tradeUnits', tu));
    return this.http.get<Customer[]>(`${this.baseUrl}/customers/search`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Searches the ODS customer master for producers not yet in our tables (onboarding fallback). */
  searchOdsCustomers(searchTerm: string): Observable<Customer[]> {
    const params = new HttpParams().set('searchTerm', searchTerm);
    return this.http.get<Customer[]>(`${this.baseUrl}/customers/search-ods`, { params })
      .pipe(catchError(() => of([] as Customer[])));
  }

  /** Assigns trade units to a producer, onboarding them into our tables if not present. For a
   *  candidate the CTRM onboarding search returned, `customerId` is a negative placeholder and
   *  `scoularId` is what the server onboards by (it mints the real id). */
  assignTradeUnits(customerId: number, tradeUnitCodes: string[], scoularId?: string): Observable<Customer> {
    const body = scoularId ? { tradeUnitCodes, scoularId } : { tradeUnitCodes };
    return this.http.put<Customer>(`${this.baseUrl}/customers/${customerId}/trade-units`, body)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** A producer's trade-unit memberships for the edit dialog. Includes active memberships (shown as
   *  chips) AND previously-removed ones (isActive=false), which the dialog offers as re-addable
   *  suggestions. hasOpenActivity=false on an active locked (isManual=false) TU means it's dormant →
   *  removable.
   *
   *  `includeActivity: false` skips the server's open-activity check (a full contract and unapplied-
   *  ticket read for the producer) for callers that only need the codes; hasOpenActivity then comes
   *  back true on every row and means nothing. */
  getCustomerTradeUnits(customerId: number, options: { includeActivity?: boolean } = {}): Observable<CustomerTradeUnit[]> {
    const params = options.includeActivity === false ? new HttpParams().set('includeActivity', 'false') : undefined;
    return this.http.get<CustomerTradeUnit[]>(`${this.baseUrl}/customers/${customerId}/trade-units`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Removes a producer from a locked (sync-sourced) trade unit they're DORMANT in (no open
   *  contract / unapplied ticket). The server re-validates and returns 409 if they're still active.
   *  Returns the refreshed membership list. (Manual TU removal still goes through assignTradeUnits.) */
  removeDormantTradeUnit(customerId: number, tradeUnit: string): Observable<CustomerTradeUnit[]> {
    return this.http.delete<CustomerTradeUnit[]>(
      `${this.baseUrl}/customers/${customerId}/trade-units/${encodeURIComponent(tradeUnit)}`)
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

  /** Fetches customers whose linkedProducerIds contains the given source id (incoming links). */
  getCustomersLinkedTo(sourceId: string): Observable<Customer[]> {
    return this.http.get<Customer[]>(`${this.baseUrl}/customers/linked-to/${encodeURIComponent(sourceId)}`)
      .pipe(catchError(() => of([] as Customer[])));
  }
}
