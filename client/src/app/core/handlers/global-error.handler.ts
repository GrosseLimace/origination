import { ErrorHandler, inject, Injectable, Injector, isDevMode, NgZone } from '@angular/core';

import { AppInsightsService } from '@core/services/app-insights.service';
import { ToastService } from '@core/services/toast.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toastService = inject(ToastService);
  private readonly ngZone = inject(NgZone);
  // Resolved on first use, not injected: the ErrorHandler is created during bootstrap, before
  // HttpClient and MSAL, which AppInsightsService depends on.
  private readonly injector = inject(Injector);

  // ---------------------------------------------------------
  handleError(error: unknown): void {
    const message = this.extractMessage(error);

    // Log full error for debugging (dev only — CWE-532)
    if (isDevMode()) {
      console.error('[GlobalErrorHandler]', error);
    }

    // Reported before the chunk-load early return on purpose: a burst of those right after a deploy
    // is worth seeing, even though the user is spared the toast.
    this.report(error);

    // Skip chunk-load errors (lazy route not yet downloaded) — Angular retries automatically
    if (message.includes('ChunkLoadError') || message.includes('Loading chunk')) {
      return;
    }

    // Show user-facing toast outside Angular's zone to avoid change-detection loops
    this.ngZone.run(() => {
      this.toastService.error('An unexpected error occurred. Please try again.');
    });
  }

  // ---------------------------------------------------------
  private report(error: unknown): void {
    // Never let reporting an error become a second error.
    try {
      this.injector.get(AppInsightsService).trackException(error);
    } catch { /* telemetry unavailable */ }
  }

  // ---------------------------------------------------------
  private extractMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
  }
}
