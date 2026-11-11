import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '@env/environment';
import { TDiscOptions } from '../models/tdisc.model';

/**
 * USDA T-DISC's windows, implements and operation lookup (GET api/tdisc/options), loaded once. The review's
 * pass table reads options() (null until loaded, then a signal update); the in-memory backend awaits load().
 */
@Injectable({ providedIn: 'root' })
export class TDiscApiService {
  private readonly http = inject(HttpClient);
  private readonly _options = signal<TDiscOptions | null>(null);
  private readonly _error = signal('');
  private pending: Promise<TDiscOptions> | null = null;

  /** The options, or null while loading (the first read starts the request). */
  options(): TDiscOptions | null {
    if (!this._options() && !this.pending) void this.load().catch(() => undefined);
    return this._options();
  }

  /** Why the options couldn't be loaded; empty otherwise. */
  readonly error = this._error.asReadonly();

  load(): Promise<TDiscOptions> {
    const loaded = this._options();
    if (loaded) return Promise.resolve(loaded);
    this.pending ??= firstValueFrom(this.http.get<TDiscOptions>(`${environment.apiBaseUrl}/tdisc/options`))
      .then(options => {
        this._options.set(options);
        this._error.set('');
        return options;
      })
      .catch((e: unknown) => {
        this.pending = null;
        this._error.set('USDA T-DISC couldn\'t be loaded. Try again in a moment.');
        throw e;
      });
    return this.pending;
  }
}
