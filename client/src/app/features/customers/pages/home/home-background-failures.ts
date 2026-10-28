import { Injectable, inject, isDevMode } from '@angular/core';
import { ToastService } from '@core/services/toast.service';

/**
 * When a background load or save on the producer page fails, say so. These subscriptions used to
 * carry `error: () => {}`, so an API outage showed up only as panels that were quietly empty
 * or stale, with nothing in the console for support to go on (audit finding
 * angular.home-component-silent-error-swallowing).
 *
 * Nothing here was asked for by the user: these are background loads and refreshes, so the
 * bar for interrupting is high and repetition buys nothing. Once someone has been told the
 * data is stale, telling them again does not help them. So a sustained outage is worth at
 * most one message a minute, and the same failing source stays quiet for five minutes after
 * it has spoken. The wording is deliberately vague about scope, because the toast that gets
 * through may be standing in for several failures that were suppressed behind it.
 *
 * Dev builds still log every failure, unthrottled, so local debugging sees everything.
 *
 * Provided by HomeComponent, so the page and the stores it delegates to share one throttle.
 */
@Injectable()
export class HomeBackgroundFailures {
  private static readonly BackgroundFailureQuietMs = 60_000;
  private static readonly BackgroundFailurePerSourceQuietMs = 5 * 60_000;

  private readonly toastService = inject(ToastService);
  private readonly _backgroundFailureToastAt = new Map<string, number>();
  private _lastBackgroundFailureToastAt = 0;

  report(what: string, err: unknown): void {
    if (isDevMode()) console.error(`[Home] failed to ${what}`, err);
    const now = Date.now();
    const lastForSource = this._backgroundFailureToastAt.get(what) ?? 0;
    if (now - lastForSource < HomeBackgroundFailures.BackgroundFailurePerSourceQuietMs) return;
    if (now - this._lastBackgroundFailureToastAt < HomeBackgroundFailures.BackgroundFailureQuietMs) return;
    this._backgroundFailureToastAt.set(what, now);
    this._lastBackgroundFailureToastAt = now;
    this.toastService.error(`Failed to ${what}. Some data may be missing or out of date.`);
  }
}
