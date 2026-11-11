import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { environment } from '@env/environment';
import { ApiError } from '@core/errors/api-error';
import { CtrmSplit } from '../models/field-plan.model';

/** A producer's CTRM splits as they load. `source` is "sample" until the CTRM splits query is confirmed. */
export type CtrmSplitsState =
  | { status: 'loading' }
  | { status: 'done'; source: string; splits: CtrmSplit[] }
  | { status: 'error'; message: string };

/**
 * A producer's CTRM splits (combined customer IDs) from the API: the fields a field plan is built from.
 * Reads are synchronous and signal-backed, like FdCicApiService: the first read starts the request and
 * returns a loading state, and the signal updates when it lands. Each producer is fetched once.
 */
@Injectable({ providedIn: 'root' })
export class CtrmSplitApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/ctrm-splits`;

  private readonly _splits = signal<ReadonlyMap<number, CtrmSplitsState>>(new Map());
  private readonly _requested = new Set<number>();

  /** The producer's splits, including expired and bin-site ones. Starts loading the first time it's asked. */
  splitsFor(customerId: number): CtrmSplitsState {
    const state = this._splits().get(customerId);
    if (state) return state;
    if (!this._requested.has(customerId)) {
      this._requested.add(customerId);
      // Deferred: callers read inside computed signals and templates, where writing a signal isn't allowed.
      queueMicrotask(() => this.fetch(customerId));
    }
    return { status: 'loading' };
  }

  /** Asks again after a failure. */
  retry(customerId: number): void {
    this.set(customerId, { status: 'loading' });
    this.fetch(customerId);
  }

  private fetch(customerId: number): void {
    this.http.get<{ source: string; splits: CtrmSplit[] }>(`${this.base}/customer/${customerId}`).subscribe({
      next: r => this.set(customerId, { status: 'done', source: r.source, splits: r.splits }),
      error: (e: unknown) => this.set(customerId, { status: 'error', message: messageOf(e) }),
    });
  }

  private set(customerId: number, state: CtrmSplitsState): void {
    this._splits.update(m => new Map(m).set(customerId, state));
  }
}

function messageOf(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const apiError = ApiError.fromHttpErrorResponse(error);
    if (error.status === 404) return 'This producer has no CTRM code, so their splits can\'t be looked up.';
    return apiError.category === 'server' ? 'Couldn\'t load the producer\'s splits from CTRM. Try again shortly.' : apiError.message;
  }
  return 'Couldn\'t load the producer\'s splits from CTRM. Try again shortly.';
}
