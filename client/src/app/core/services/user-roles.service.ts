import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { EMPTY, Observable, ReplaySubject, catchError, filter, of, switchMap, take, tap } from 'rxjs';
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
  private readonly _ready$ = new ReplaySubject<string[]>(1);

  readonly roles: Signal<string[]> = this._roles.asReadonly();
  readonly isAdmin = computed(() => this._roles().includes('Admin'));

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
        if (!account) return EMPTY;
        return this.http.get<MeResponse>(`${environment.apiBaseUrl}/me`).pipe(
          catchError(() => of<MeResponse>({ userId: '', roles: [] }))
        );
      }),
      tap(response => {
        const roles = response?.roles ?? [];
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
