import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { of, Subject, firstValueFrom, timeout, throwError } from 'rxjs';
import { UserRolesService } from './user-roles.service';

/**
 * usageDashboardGuard blocks navigation on `ready$()`, so anything that stops this service from
 * emitting doesn't fail loudly — it hangs the route forever with no redirect and no error. The
 * no-account branch used to return EMPTY, which completes WITHOUT emitting, so `_ready$` never
 * received a value and `ready$()` never completed. These pin that every path resolves.
 */
describe('UserRolesService', () => {
  let inProgress$: Subject<InteractionStatus>;
  let accounts: unknown[];
  let activeAccount: unknown;
  let httpGet: ReturnType<typeof vi.fn>;

  /** ready$() with a hard deadline — a hang is the bug under test, so waiting forever would
   *  present as a timed-out suite rather than a failed assertion. */
  const readyWithin = (svc: UserRolesService, ms = 500) =>
    firstValueFrom(svc.ready$().pipe(timeout(ms)));

  beforeEach(() => {
    inProgress$ = new Subject<InteractionStatus>();
    accounts = [{ username: 'cegr@scoular.com' }];
    activeAccount = accounts[0];
    httpGet = vi.fn(() => of({ userId: 'CEgr', roles: ['Admin'] }));

    TestBed.configureTestingModule({
      providers: [
        UserRolesService,
        { provide: HttpClient, useValue: { get: httpGet } },
        { provide: MsalBroadcastService, useValue: { inProgress$ } },
        {
          provide: MsalService,
          useValue: {
            instance: {
              getActiveAccount: () => activeAccount,
              getAllAccounts: () => accounts,
            },
          },
        },
      ],
    });
  });

  it('resolves with the roles /api/me returns', async () => {
    const svc = TestBed.inject(UserRolesService);

    inProgress$.next(InteractionStatus.None);

    expect(await readyWithin(svc)).toEqual(['Admin']);
    expect(svc.canViewUsageDashboard()).toBe(true);
  });

  it('resolves with NO roles when there is no account, rather than hanging', async () => {
    // The regression: EMPTY here meant ready$() never completed and the guard never decided.
    activeAccount = null;
    accounts = [];
    const svc = TestBed.inject(UserRolesService);

    inProgress$.next(InteractionStatus.None);

    // Resolves (doesn't hang) and fails closed (no roles ⇒ the guard denies and redirects).
    expect(await readyWithin(svc)).toEqual([]);
    expect(svc.canViewUsageDashboard()).toBe(false);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('resolves with NO roles when /api/me errors', async () => {
    // How HttpClient actually fails: the observable errors, it doesn't throw from get().
    httpGet.mockImplementation(() => throwError(() => new Error('500')));
    const svc = TestBed.inject(UserRolesService);

    inProgress$.next(InteractionStatus.None);

    expect(await readyWithin(svc)).toEqual([]);
    expect(svc.canViewUsageDashboard()).toBe(false);
  });

  it('resolves with NO roles even if something throws synchronously while building the request', async () => {
    // Not how HttpClient behaves, but a synchronous throw inside the switchMap projection escapes
    // the inner catchError and errors the outer stream — which used to mean tap never ran and the
    // guard hung. The outer catchError makes "ready$() always resolves" hold regardless of how
    // the failure arrives.
    httpGet.mockImplementation(() => {
      throw new Error('boom');
    });
    const svc = TestBed.inject(UserRolesService);

    inProgress$.next(InteractionStatus.None);

    expect(await readyWithin(svc)).toEqual([]);
  });

  it('resolves with NO roles when the response carries none', async () => {
    httpGet.mockImplementation(() => of({ userId: 'CEgr', roles: [] }));
    const svc = TestBed.inject(UserRolesService);

    inProgress$.next(InteractionStatus.None);

    expect(await readyWithin(svc)).toEqual([]);
  });

  it('waits for MSAL to settle before resolving', async () => {
    const svc = TestBed.inject(UserRolesService);

    // An in-flight interaction must not resolve the guard early — that's the race ready$() exists
    // to avoid on the first post-sign-in navigation.
    inProgress$.next(InteractionStatus.Login);
    await expect(readyWithin(svc, 50)).rejects.toThrow();

    inProgress$.next(InteractionStatus.None);
    expect(await readyWithin(svc)).toEqual(['Admin']);
  });

  it('exposes the short name derived from the /api/me userId', async () => {
    // The usage dashboard defaults its manager filter to this, and the manager directory keys
    // people by the UPN prefix — so the '@scoular.com' must come off here, once.
    httpGet.mockImplementation(() => of({ userId: 'CEgr@scoular.com', roles: ['Admin'] }));
    const svc = TestBed.inject(UserRolesService);

    inProgress$.next(InteractionStatus.None);
    await readyWithin(svc);

    expect(svc.userId()).toBe('CEgr@scoular.com');
    expect(svc.userShortName()).toBe('CEgr');
  });

  it('passes an already-short userId through unchanged', async () => {
    httpGet.mockImplementation(() => of({ userId: 'CEgr', roles: [] }));
    const svc = TestBed.inject(UserRolesService);

    inProgress$.next(InteractionStatus.None);
    await readyWithin(svc);

    expect(svc.userShortName()).toBe('CEgr');
  });

  it('leaves the short name empty when /api/me fails', async () => {
    // Failing closed: the dashboard then falls back to "All Managers" rather than defaulting to a
    // name it does not have.
    httpGet.mockImplementation(() => throwError(() => new Error('boom')));
    const svc = TestBed.inject(UserRolesService);

    inProgress$.next(InteractionStatus.None);
    await readyWithin(svc);

    expect(svc.userShortName()).toBe('');
  });

  it('replays to a late subscriber', async () => {
    // The guard often subscribes AFTER /api/me has already answered; ReplaySubject(1) has to
    // hand it the cached roles instead of waiting for another emission that never comes.
    const svc = TestBed.inject(UserRolesService);
    inProgress$.next(InteractionStatus.None);
    await readyWithin(svc);

    expect(await readyWithin(svc)).toEqual(['Admin']);
  });
});
