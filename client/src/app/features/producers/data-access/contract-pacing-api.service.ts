import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '@env/environment';
import { injectApiErrorHandler } from '@core/http/api-error-handler';
import { dedupeRequests } from '@core/http/dedupe-requests';
import { Contract } from '@models';

/** The API's contract pacing (`ContractPacingController`, which needs contract-pacing:read). */
@Injectable({ providedIn: 'root' })
export class ContractPacingApiService {
  private readonly http = inject(HttpClient);
  private readonly handleError = injectApiErrorHandler();
  private readonly dedupe = dedupeRequests();
  private readonly baseUrl = environment.apiBaseUrl;

  /** A producer's closed contracts, for the year-over-year pacing comparison. */
  historicalContracts(customerId: number): Observable<Contract[]> {
    return this.dedupe(`contracts-pacing:${customerId}`,
      // Rethrows rather than swallowing: on the CTRM path an empty list is indistinguishable from a
      // failed read, and the pacing card would silently show no history.
      this.http.get<Contract[]>(`${this.baseUrl}/contracts/pacing/${customerId}`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }
}
