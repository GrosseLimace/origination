import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { Observable, ReplaySubject, catchError, filter, of, switchMap, take, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

interface MeResponse {
  userId: string;
  roles: string[];
  /** Whether this user may flip contracts and tickets between ODS and CTRM (server allow-list). */
  canChooseDataSource?: boolean;
  /** The environment's default source for contracts and tickets. */
  defaultDataSource?: 'ods' | 'ctrm';
}

export type DataSource = 'ods' | 'ctrm';

/**
 * Holds the current user's app roles for the SPA. The SPA's own ID token does not
 * carry a `roles` claim (the SPA app registration has no app roles defined), so
 * MSAL's `idTokenClaims.roles` is always undefined for this architecture. Role
 * information lives on the API's access token instead, which the backend reflects
 * back via `GET /api/me`. This service calls it once per session after MSAL has
 * a signed-in account, then exposes `roles` / `isAdmin` as signals that the rest
 * of the UI (header, guards) can read synchronously.
 */
@Injectable({ providedIn: 'root' })
export class UserRolesService {
  private readonly http = inject(HttpClient);
  private readonly msalService = inject(MsalService);
  private readonly msalBroadcast = inject(MsalBroadcastService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _roles = signal<string[]>([]);
  private readonly _ready$ = new ReplaySubject<string[]>(1);
  private readonly _canChooseDataSource = signal(false);
  private readonly _defaultDataSource = signal<DataSource>('ods');

  readonly roles: Signal<string[]> = this._roles.asReadonly();
  readonly isAdmin = computed(() => this._roles().includes('Admin'));

  /** Whether the server lists this user in Ctrm:SourceToggleUsers. Presentation only: it decides whether
   *  the ODS / CTRM control is shown. The server re-checks the list on every contract and ticket read, so
   *  a forged true here shows a control that changes nothing. See DataSourceService. */
  readonly canChooseDataSource: Signal<boolean> = this._canChooseDataSource.asReadonly();
  /** The environment's default source for contracts and tickets, as the server reports it. */
  readonly defaultDataSource: Signal<DataSource> = this._defaultDataSource.asReadonly();

  /** Usage-dashboard access: the Admin app role, which is how the "Origination App {Env} Super
   *  Users" group grants it. How MUCH of the dashboard you then see is a separate question —
   *  see canViewAllUsage. */
  readonly canViewUsageDashboard = computed(() => this._roles().includes('Admin'));

  /** Whether to offer the usage-dashboard manager dropdown. Note this is NOT implied by `isAdmin`:
   *  an Admin who isn't on the server's UsageDashboard:ViewAll list is scoped to their own org
   *  subtree, same as anyone else. Presentation only — the server re-derives the scope from config
   *  on every request, so hiding or showing this control cannot change what data comes back. */
  readonly canViewAllUsage = computed(() => this._roles().includes('UsageDashboardViewAll'));

  constructor() {
    this.msalBroadcast.inProgress$.pipe(
      filter(s => s === InteractionStatus.None),
      take(1),
      switchMap(() => {
        const account = this.msalService.instance.getActiveAccount()
          ?? this.msalService.instance.getAllAccounts()[0];
        // No account: resolve to NO roles rather than EMPTY. EMPTY completes without emitting, so
        // the tap below never ran, `_ready$` never received a value, and `ready$()` never
        // completed — leaving every guard that awaits it hanging navigation indefinitely, with no
        // redirect and no error. Emitting an empty role set fails closed (the guards deny and
        // redirect) AND lets navigation finish, which is the same thing the adjacent catchError
        // already does for an HTTP failure.
        if (!account) return of<MeResponse>({ userId: '', roles: [] });
        return this.http.get<MeResponse>(`${environment.apiBaseUrl}/me`).pipe(
          catchError(() => of<MeResponse>({ userId: '', roles: [] }))
        );
      }),
      // Backstop so "ready$() always resolves" holds unconditionally. The inner catchError covers
      // an HTTP failure, which is the realistic case, but anything throwing synchronously inside
      // the switchMap projection would escape it and error this outer stream — and then tap never
      // runs, _ready$ never emits, and every guard awaiting it hangs the route silently. Failing
      // closed with no roles is always preferable to not deciding.
      catchError(() => of<MeResponse>({ userId: '', roles: [] })),
      tap(response => {
        const roles = response?.roles ?? [];
        this._roles.set(roles);
        this._canChooseDataSource.set(response?.canChooseDataSource === true);
        this._defaultDataSource.set(response?.defaultDataSource === 'ctrm' ? 'ctrm' : 'ods');
        this._ready$.next(roles);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  /** Emits the roles array exactly once as soon as `/api/me` has responded. Guards
   *  that need the roles synchronously at route activation can subscribe to this
   *  without racing the MSAL-inProgress handshake. */
  ready$(): Observable<string[]> {
    return this._ready$.pipe(take(1));
  }
}
