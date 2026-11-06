import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { Observable, ReplaySubject, catchError, filter, map, of, switchMap, take, tap } from 'rxjs';

import { environment } from '@env/environment';
import { PermissionId } from './permission-ids.generated';

/** What `/api/me/permissions` returns. The SPA reads only the user id and the permissions; it never
 *  looks at roles. */
interface MyPermissionsResponse {
  userId: string;
  roles: string[];
  permissions: string[];
  modules: string[];
  segments: string[];
}

/** How the permissions load ended. Anything but `loaded` leaves the user with no permissions. */
export type PermissionLoad = 'loaded' | 'failed' | 'signed-out';

interface Outcome {
  load: PermissionLoad;
  userId: string;
  permissions: readonly string[];
}

/**
 * The signed-in user's permissions, from `/api/me/permissions`. This is the only place the SPA
 * learns what the user may do; screens, guards and the `*appHasPermission` directive ask it by
 * permission and never by role.
 *
 * It loads once, as soon as MSAL has settled. Until then, and if the load fails, the user holds no
 * permissions, so anything gated stays hidden. `permissionGuard` waits for `loaded()` rather than
 * deciding on that empty set.
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly http = inject(HttpClient);
  private readonly msal = inject(MsalService);
  private readonly msalBroadcast = inject(MsalBroadcastService);

  private readonly _permissions = signal<ReadonlySet<string>>(new Set());
  private readonly _userId = signal('');
  private readonly _loaded$ = new ReplaySubject<PermissionLoad>(1);

  /** The signed-in user's UPN, or empty until the load has answered (and if it failed). */
  readonly userId: Signal<string> = this._userId.asReadonly();

  /** The UPN before the '@', which is the key the usage tables and the manager directory use. */
  readonly userShortName = computed(() => {
    const id = this._userId();
    const at = id.indexOf('@');
    return at > 0 ? id.slice(0, at) : id;
  });

  constructor() {
    this.msalBroadcast.inProgress$.pipe(
      filter(status => status === InteractionStatus.None),
      take(1),
      switchMap(() => this.request()),
      // Every path must end in an outcome: a guard waiting on loaded() would otherwise hold the
      // navigation forever, with no redirect and no error.
      catchError(() => of(failed())),
      tap(outcome => {
        this._userId.set(outcome.userId);
        this._permissions.set(new Set(outcome.permissions));
        this._loaded$.next(outcome.load);
      }),
      takeUntilDestroyed(inject(DestroyRef)),
    ).subscribe();
  }

  /** Whether the user holds the permission. Reads a signal, so templates and `computed` update. */
  has(permission: PermissionId): boolean {
    return this._permissions().has(permission);
  }

  /** Whether the user holds every one of the permissions. */
  hasAll(permissions: readonly PermissionId[]): boolean {
    const held = this._permissions();
    return permissions.every(p => held.has(p));
  }

  /** Emits once, when the load has ended, and replays to later subscribers. */
  loaded(): Observable<PermissionLoad> {
    return this._loaded$.pipe(take(1));
  }

  private request(): Observable<Outcome> {
    const account = this.msal.instance.getActiveAccount() ?? this.msal.instance.getAllAccounts()[0];
    if (!account) return of<Outcome>({ load: 'signed-out', userId: '', permissions: [] });

    return this.http.get<MyPermissionsResponse>(`${environment.apiBaseUrl}/me/permissions`).pipe(
      map((response): Outcome => ({
        load: 'loaded',
        userId: response?.userId ?? '',
        permissions: response?.permissions ?? [],
      })),
      catchError(() => of(failed())),
    );
  }
}

function failed(): Outcome {
  return { load: 'failed', userId: '', permissions: [] };
}

