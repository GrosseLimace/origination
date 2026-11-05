// Angular core
import { Injectable, Injector, inject, isDevMode } from '@angular/core';

// Core services
import { AppInsightsService } from './app-insights.service';

/**
 * Where a screen sends an error it caught and handled itself (a toast, a fallback). GlobalErrorHandler
 * only sees unhandled ones, so these used to reach the console in dev builds and nowhere at all in
 * production (audit 2026-11-05).
 *
 * Dev builds log every one, as before. App Insights is sent the ones the server could not have
 * recorded; {@link AppInsightsService.trackHandledError} decides which, and rate-limits them.
 *
 * AppInsightsService is resolved when something is reported, not injected up front — the same as
 * GlobalErrorHandler — because it needs MSAL to be constructed, and reporting must never become a
 * second error (or a missing provider in a screen's tests).
 */
@Injectable({ providedIn: 'root' })
export class HandledErrorReporter {
  private readonly injector = inject(Injector);

  /** Logs it in dev builds, and sends it on. */
  report(where: string, error: unknown): void {
    if (isDevMode()) console.warn(`[${where}]`, error);
    this.send(where, error);
  }

  /** Sends it on without logging, for callers that already write their own console line. */
  send(where: string, error: unknown): void {
    try {
      this.injector.get(AppInsightsService).trackHandledError(where, error);
    } catch { /* telemetry unavailable */ }
  }
}
