import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { environment } from '@env/environment';
import { ApiError } from '@core/errors/api-error';
import { FdCicScore, FdCicScoreRequest, FdCicScoreState } from '../models/fd-cic.model';

/**
 * The 45Z carbon-intensity calculator on the API (USDA FD-CIC), and the state/county lists a field's
 * location is picked from.
 *
 * Reads are synchronous and signal-backed, so they can be called from templates and computed
 * signals (the program definition's preview, the row roll-up): the first read of something not yet
 * loaded returns a loading state and starts the request, and the signal updates when it lands.
 * Scores are cached by their exact inputs, so the chip, the form and the row roll-up for the same
 * field share one request, and going back to an earlier value costs nothing.
 */
@Injectable({ providedIn: 'root' })
export class FdCicApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/fd-cic`;

  private readonly _scores = signal<ReadonlyMap<string, FdCicScoreState>>(new Map());
  private readonly _states = signal<string[] | null>(null);
  private readonly _counties = signal<ReadonlyMap<string, string[]>>(new Map());
  private readonly _requested = new Set<string>();

  /** A field's score for a crop year. Starts the calculation the first time these inputs are asked for. */
  score(year: number, request: FdCicScoreRequest): FdCicScoreState {
    const key = `${year}|${JSON.stringify(request)}`;
    const state = this._scores().get(key);
    if (state) return state;
    this.once(key, () => this.http.post<FdCicScore>(`${this.base}/${year}/score`, request).subscribe({
      next: score => this.setScore(key, { status: 'done', score }),
      error: (e: unknown) => this.setScore(key, { status: 'error', message: messageOf(e) }),
    }));
    return { status: 'loading' };
  }

  /** The states a field can be in; empty until loaded. */
  states(): string[] {
    const states = this._states();
    if (states) return states;
    this.once('states', () => this.http.get<string[]>(`${this.base}/states`).subscribe({
      next: list => this._states.set(list),
      error: () => this._states.set([]),
    }));
    return [];
  }

  /** The counties in a state, as USDA's table names them; empty until loaded. */
  counties(state: string): string[] {
    if (!state) return [];
    const counties = this._counties().get(state);
    if (counties) return counties;
    this.once(`counties|${state}`, () => this.http.get<string[]>(`${this.base}/counties`, { params: { state } }).subscribe({
      next: list => this.setCounties(state, list),
      error: () => this.setCounties(state, []),
    }));
    return [];
  }

  /**
   * Starts a request once per key. Deferred to a microtask because callers read inside computed
   * signals and templates, where writing a signal (the loading state) is not allowed.
   */
  private once(key: string, start: () => void): void {
    if (this._requested.has(key)) return;
    this._requested.add(key);
    queueMicrotask(start);
  }

  private setScore(key: string, state: FdCicScoreState): void {
    this._scores.update(m => new Map(m).set(key, state));
  }

  private setCounties(state: string, list: string[]): void {
    this._counties.update(m => new Map(m).set(state, list));
  }
}

function messageOf(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const apiError = ApiError.fromHttpErrorResponse(error);
    // A 503 means the year's USDA version is switched off; the server keeps the details in its log.
    return apiError.category === 'server' ? 'The USDA calculator is unavailable right now.' : apiError.message;
  }
  return 'The USDA calculator is unavailable right now.';
}
