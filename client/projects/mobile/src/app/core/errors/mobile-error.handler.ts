import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandler, Injectable, inject, isDevMode } from '@angular/core';

import { NoticeService } from './notice.service';

/**
 * Global error handler: one generic banner for the user (never server text, CWE-209), full detail
 * in the console only in dev (CWE-532). Maps the API's error envelope codes the phone can act on.
 */
@Injectable({ providedIn: 'root' })
export class MobileErrorHandler implements ErrorHandler {
  private readonly notices = inject(NoticeService);

  handleError(error: unknown): void {
    if (isDevMode()) {
      console.error('[MobileErrorHandler]', error);
    }

    const message = messageFor(error);
    if (message) {
      this.notices.error(message);
    }
  }
}

export function messageFor(error: unknown): string | null {
  const unwrapped = (error as { rejection?: unknown })?.rejection ?? error;

  if (unwrapped instanceof HttpErrorResponse) {
    if (unwrapped.status === 0) return 'No connection. Your work is kept on this phone until signal returns.';
    if (unwrapped.status === 401) return 'Your sign-in expired. Reconnect and sign in again.';
    if (unwrapped.status === 403) return "You don't have access to that.";
    if (unwrapped.status === 404) return 'That producer is not in your trade units.';
    if (unwrapped.status === 409) return 'Someone else changed this since you loaded it. Refresh and try again.';
    if (unwrapped.status === 429) return 'Slow down a moment; too many requests.';
    if (unwrapped.status === 503) return 'The data source is waking up. Try again in a minute.';
    return 'Something went wrong talking to the server. Please try again.';
  }

  const text = unwrapped instanceof Error ? unwrapped.message : typeof unwrapped === 'string' ? unwrapped : '';
  // Lazy-route chunk failures resolve on retry; do not alarm the user.
  if (text.includes('ChunkLoadError') || text.includes('Loading chunk')) return null;
  // MSAL interaction errors are handled by the guard/bootstrap path.
  if (text.includes('interaction_in_progress') || text.includes('user_cancelled')) return null;

  return 'An unexpected error occurred. Please try again.';
}
