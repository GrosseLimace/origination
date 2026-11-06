import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { environment } from '@env/environment';
import { ToastService } from '@core/services/toast.service';
import { markShown } from './shown-errors';

/** The API's error code for a request the caller lacks a permission for. */
export const PERMISSION_DENIED_CODE = 'AUTHZ_PERMISSION_DENIED';

export const PERMISSION_DENIED_MESSAGE = "You don't have access to this. Ask IT if you need it.";

const FALLBACK_MESSAGE = 'Access denied: you are not authorized for this resource.';

/**
 * The one place a 403 from the API is shown to the user.
 *
 * A missing permission gets a plain-language message; the permission ids the API names are for
 * logs, not users. Any other 403 is a rule about a particular record, such as "only the person who
 * added this location can remove it", so the API's own message is shown. The error is then passed
 * on unchanged and marked as shown, and screens check `alreadyShown(err)` before toasting their own
 * failure message.
 */
export const forbiddenInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiBaseUrl)) return next(request);

  const toast = inject(ToastService);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 403) {
        const message = messageFor(error);
        // Several requests refused together, such as a page's loads, would otherwise stack copies.
        if (!toast.toasts().some(t => t.type === 'error' && t.message === message)) {
          toast.error(message);
        }
        markShown(error);
      }
      return throwError(() => error);
    }),
  );
};

function messageFor(error: HttpErrorResponse): string {
  const body = typeof error.error === 'object' && error.error !== null
    ? error.error as { error?: { code?: string; message?: string } | null; message?: string }
    : null;
  if (body?.error?.code === PERMISSION_DENIED_CODE) return PERMISSION_DENIED_MESSAGE;
  return body?.error?.message || body?.message || FALLBACK_MESSAGE;
}
