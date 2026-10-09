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
}

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
  private readonly _userId = signal('');
  private readonly _ready$ = new ReplaySubject<string[]>(1);

  readonly roles: Signal<string[]> = this._roles.asReadonly();
  readonly isAdmin = computed(() => this._roles().includes('Admin'));

  /** The signed-in user's UPN as `/api/me` reports it (empty until it has answered). */
  readonly userId: Signal<string> = this._userId.asReadonly();

  /** Short name — the UPN before the '@' — which is the key the usage tables and the manager
   *  directory use. The usage dashboard defaults its manager filter to this. */
  readonly userShortName = computed(() => {
    const id = this._userId();
    const at = id.indexOf('@');
    return at > 0 ? id.slice(0, at) : id;
  });

  /** Usage-dashboard access: the Admin app role, which is how the "Origination App {Env} Super
   *  Users" group grants it. Everyone who can open the dashboard sees the whole organisation and
   *  may filter it by any manager — there is no second "how much do you see" role. */
  readonly canViewUsageDashboard = computed(() => this._roles().includes('Admin'));

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
        this._userId.set(response?.userId ?? '');
        this._roles.set(roles);
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
