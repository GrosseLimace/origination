// Angular core
import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// Third-party
import { MsalBroadcastService } from '@azure/msal-angular';
import type { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { firstValueFrom } from 'rxjs';

// Core services
import { ApiService } from './api.service';

type Properties = Record<string, string>;

type Pending =
  | { kind: 'exception'; error: unknown; properties?: Properties }
  | { kind: 'event'; name: string; properties?: Properties };

/** Enough to explain a burst at start-up without holding on to an unbounded backlog. */
const MAX_PENDING = 20;

/** Application Insights' SeverityLevel.Error. A literal so this file does not load the SDK eagerly. */
const SEVERITY_ERROR = 3;

/**
 * Reports the browser app's errors to Application Insights, the same resource the server's own
 * telemetry goes to. Before this, an error in the browser only reached the user as a toast and the
 * team never saw it.
 *
 * Sends three things: unhandled errors (from GlobalErrorHandler, plus unhandled promise rejections),
 * MSAL failures such as a token refresh that did not work, and a page view per route change so an
 * error can be read in context. API calls are NOT tracked from here; the server already records
 * every request.
 *
 * Off until {@link start} runs after sign-in and the server returns a connection string; with none
 * (local dev, or switched off in config) it stays off and everything is dropped. Anything reported
 * before then is held, up to {@link MAX_PENDING} items, and sent once telemetry is on. The SDK is
 * loaded lazily, only when telemetry is actually on.
 *
 * No PII beyond the user's short name (the UPN before the @, as the server's own logs use) and no
 * MSAL error messages, which can echo account details; only their codes.
 */
@Injectable({ providedIn: 'root' })
export class AppInsightsService {
  private readonly api = inject(ApiService);

  private ai: ApplicationInsights | null = null;
  private state: 'idle' | 'starting' | 'on' | 'off' = 'idle';
  private pending: Pending[] = [];

  constructor() {
    // Failures only: success events fire on every token read and would be pure volume.
    inject(MsalBroadcastService).msalSubject$
      .pipe(takeUntilDestroyed())
      .subscribe(msg => {
        if (!msg.error) return;
        const err = msg.error as { name?: string; errorCode?: string; subError?: string };
        this.trackEvent('MSAL.failure', {
          eventType: String(msg.eventType),
          interactionType: String(msg.interactionType ?? ''),
          errorName: err.name ?? '',
          errorCode: err.errorCode ?? '',
          subError: err.subError ?? '',
        });
      });
  }

  /** Turns telemetry on for this session, once. Never throws: telemetry must not be the reason
   *  anything else fails. */
  async start(userId: string | null): Promise<void> {
    if (this.state !== 'idle') return;
    this.state = 'starting';
    try {
      const { connectionString } = await firstValueFrom(this.api.getClientTelemetryConfig());
      if (!connectionString) {
        this.turnOff();
        return;
      }

      const { ApplicationInsights } = await import('@microsoft/applicationinsights-web');
      const ai = new ApplicationInsights({
        config: {
          connectionString,
          enableAutoRouteTracking: true,
          enableUnhandledPromiseRejectionTracking: true,
          // The server records every API request already; tracking them here too would double the
          // volume for little new information.
          disableAjaxTracking: true,
          disableFetchTracking: true,
        },
      });
      ai.loadAppInsights();
      ai.addTelemetryInitializer(envelope => {
        envelope.tags = envelope.tags ?? {};
        envelope.tags['ai.cloud.role'] = 'origination-spa';
      });
      if (userId) ai.setAuthenticatedUserContext(userId, undefined, true);

      this.ai = ai;
      this.state = 'on';
      const held = this.pending;
      this.pending = [];
      for (const item of held) this.send(item);
    } catch {
      this.turnOff();
    }
  }

  trackException(error: unknown, properties?: Properties): void {
    this.enqueue({ kind: 'exception', error, properties });
  }

  trackEvent(name: string, properties?: Properties): void {
    this.enqueue({ kind: 'event', name, properties });
  }

  private enqueue(item: Pending): void {
    if (this.state === 'on') this.send(item);
    else if (this.state !== 'off' && this.pending.length < MAX_PENDING) this.pending.push(item);
  }

  private send(item: Pending): void {
    if (!this.ai) return;
    if (item.kind === 'event') {
      this.ai.trackEvent({ name: item.name, properties: item.properties });
    } else {
      const exception = item.error instanceof Error ? item.error : new Error(String(item.error));
      this.ai.trackException({ exception, severityLevel: SEVERITY_ERROR, properties: item.properties });
    }
  }

  private turnOff(): void {
    this.state = 'off';
    this.pending = [];
  }
}
