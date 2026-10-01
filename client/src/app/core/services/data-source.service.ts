import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { DataSource, UserRolesService } from './user-roles.service';
import { environment } from '../../../environments/environment';

/**
 * The signed-in user's choice between ODS and CTRM (GraphQL) for contracts and tickets.
 *
 * Exists so a few approved testers can compare the two sources side by side on production data before
 * everyone is switched (2026-10-01). The browser only expresses a preference: it is stored here, sent on
 * every API request as the `X-Data-Source-Preference` header by `DataSourcePreferenceInterceptor`, and
 * honoured by the server solely for users on its allow-list (`Ctrm:SourceToggleUsers`). For anyone else
 * the header is ignored, so the control is shown only when `GET /api/me` says the user may choose.
 *
 * Changing the preference reloads the page. Every screen caches contracts and tickets it has already
 * loaded (AppState, the home page's prefetch maps, Build a List's local copies), and a reload is the one
 * way to guarantee no screen ever shows rows from both sources at once.
 */
@Injectable({ providedIn: 'root' })
export class DataSourceService {
  /** localStorage key. Per browser, per user profile, survives sign-out like the What's New marker. */
  static readonly StorageKey = 'origination.dataSourcePreference';
  /** Request header the interceptor sends; must match CtrmSourceChoice.PreferenceHeader on the server. */
  static readonly Header = 'X-Data-Source-Preference';

  private readonly userRoles = inject(UserRolesService);
  private readonly _preference = signal<DataSource | null>(DataSourceService.readStored());

  /** Whether the server allows this user to choose. Drives whether the control renders at all. */
  readonly canChoose: Signal<boolean> = this.userRoles.canChooseDataSource;

  /** The environment default the server reported. */
  readonly defaultSource: Signal<DataSource> = this.userRoles.defaultDataSource;

  /** The stored preference, or null when the user has never chosen (= the default). */
  readonly preference: Signal<DataSource | null> = this._preference.asReadonly();

  /** What this user's reads actually route to, as far as the browser can know: the preference when the
   *  user may choose and has chosen, otherwise the environment default. */
  readonly effectiveSource = computed<DataSource>(() =>
    this.canChoose() && this._preference() ? this._preference()! : this.defaultSource());

  /** Hover prefetch and the click re-read only pay off against CTRM, where the server answers from a warm
   *  trade-unit cache with a live read behind it. The compiled flag covers environments that default to
   *  CTRM; a tester who has switched to CTRM in an ODS environment gets the same behaviour. */
  readonly readAheadEnabled = computed(() => environment.ctrmReadAheadEnabled || this.effectiveSource() === 'ctrm');

  /** Persist the choice and reload so nothing on screen mixes the two sources. */
  setPreference(source: DataSource): void {
    if (!this.canChoose()) return;
    if (this._preference() === source) return;
    try { localStorage.setItem(DataSourceService.StorageKey, source); } catch { /* storage unavailable */ }
    this._preference.set(source);
    this.reload();
  }

  /** Back to the environment default. */
  clearPreference(): void {
    if (this._preference() === null) return;
    try { localStorage.removeItem(DataSourceService.StorageKey); } catch { /* storage unavailable */ }
    this._preference.set(null);
    this.reload();
  }

  /** The header value for the interceptor, read straight from storage so the interceptor needs no
   *  dependency on this service's signals (and so the very first request after a reload carries it). */
  static readStored(): DataSource | null {
    try {
      const value = localStorage.getItem(DataSourceService.StorageKey);
      return value === 'ods' || value === 'ctrm' ? value : null;
    } catch {
      return null;
    }
  }

  /** Separated so tests can stub it; window.location.reload is not stubbable in jsdom. */
  protected reload(): void {
    window.location.reload();
  }
}
