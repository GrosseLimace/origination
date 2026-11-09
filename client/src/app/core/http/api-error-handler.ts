import { inject, isDevMode } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { ToastService } from '@core/services/toast.service';
import { ApiError } from '@core/errors/api-error';

/**
 * The error path every API client shares: `catchError(e => this.handleError(e))`. Call it from a field initializer
 * (it injects the toast service). A 401 tells the user their session expired; every failure becomes one typed
 * {@link ApiError}.
 */
export function injectApiErrorHandler(): (error: unknown) => Observable<never> {
  const toastService = inject(ToastService);

  return (error: unknown): Observable<never> => {
    if (isDevMode()) {
      console.error('API Error:', error);
    }

    if (error instanceof HttpErrorResponse) {
      // A 403 has already been shown by forbiddenInterceptor, for every API client, not just this one.
      if (error.status === 401) {
        // Previously fell through to the generic path, where most call sites swallow the error —
        // so a revoked or expired session showed the user nothing at all. MSAL still drives the
        // re-auth; this only makes sure they're told why the screen stopped working.
        toastService.error('Your session has expired — please refresh the page to sign in again.');
      }
      // One typed error for every HTTP failure: the server's real message (fallback order in
      // ApiError.fromHttpErrorResponse), status, code, field details and correlation id. The API
      // builds a "(Ref: …)" message around that id so a user can quote it to support, so it has to
      // survive the trip to the call site.
      return throwError(() => ApiError.fromHttpErrorResponse(error));
    }

    return throwError(() => ApiError.fromUnknown(error));
  };
}
