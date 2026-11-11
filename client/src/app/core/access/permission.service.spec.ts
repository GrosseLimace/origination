import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { Subject, firstValueFrom, of, throwError, timeout } from 'rxjs';

import { environment } from '@env/environment';
import { PermissionService } from './permission.service';

/**
 * permissionGuard holds navigation until loaded() emits, so every path through the load has to end
 * in an outcome: a path that never emits doesn't fail loudly, it leaves the route hanging. And every
 * outcome other than a successful load has to leave the user holding nothing.
 */
describe('PermissionService', () => {
  let inProgress$: Subject<InteractionStatus>;
  let accounts: unknown[];
  let httpGet: ReturnType<typeof vi.fn>;

  const response = (permissions: string[], userId = 'CEgr@scoular.com') =>
    ({ userId, roles: ['Admin'], permissions, modules: [], segments: [] });

  /** loaded() with a deadline: a hang is the failure being tested for. */
  const loadedWithin = (svc: PermissionService, ms = 500) => firstValueFrom(svc.loaded().pipe(timeout(ms)));

  function start(): PermissionService {
    const svc = TestBed.inject(PermissionService);
    inProgress$.next(InteractionStatus.None);
    return svc;
  }

  beforeEach(() => {
    inProgress$ = new Subject<InteractionStatus>();
    accounts = [{ username: 'cegr@scoular.com' }];
    httpGet = vi.fn(() => of(response(['notes:read', 'usage-reports:read'])));

    TestBed.configureTestingModule({
      providers: [
        PermissionService,
        { provide: HttpClient, useValue: { get: httpGet } },
        { provide: MsalBroadcastService, useValue: { inProgress$ } },
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => accounts[0] ?? null, getAllAccounts: () => accounts } } },
      ],
    });
  });

  it('loads the permissions /api/me/permissions returns', async () => {
    const svc = start();

    expect(await loadedWithin(svc)).toBe('loaded');
    expect(httpGet).toHaveBeenCalledWith(`${environment.apiBaseUrl}/me/permissions`);
    expect(svc.has('usage-reports:read')).toBe(true);
    expect(svc.has('notes:write')).toBe(false);
  });

  it('holds the modules /api/me/permissions lists, and none until it has answered', async () => {
    httpGet.mockReturnValue(of({ ...response(['bid-sheets:read', 'notes:read']), modules: ['bid-sheet', 'engagement'] }));
    inProgress$ = new Subject<InteractionStatus>();
    TestBed.overrideProvider(MsalBroadcastService, { useValue: { inProgress$ } });
    const svc = TestBed.inject(PermissionService);

    expect(svc.holdsModule('bid-sheet')).toBe(false);

    inProgress$.next(InteractionStatus.None);
    await loadedWithin(svc);

    expect(svc.holdsModule('bid-sheet')).toBe(true);
    expect(svc.holdsModule('engagement')).toBe(true);
    expect(svc.holdsModule('producers')).toBe(false);
  });

  it('holds no module when the load fails', async () => {
    httpGet.mockReturnValue(throwError(() => new Error('500')));
    const svc = start();

    expect(await loadedWithin(svc)).toBe('failed');
    expect(svc.holdsModule('customers')).toBe(false);
  });

  it('holds a list of permissions only when it holds every one', async () => {
    const svc = start();
    await loadedWithin(svc);

    expect(svc.hasAll(['notes:read', 'usage-reports:read'])).toBe(true);
    expect(svc.hasAll(['notes:read', 'notes:write'])).toBe(false);
  });

  it('holds nothing before the load has answered', () => {
    const svc = TestBed.inject(PermissionService);

    expect(svc.has('notes:read')).toBe(false);
  });

  it('waits for MSAL to settle before loading', async () => {
    const svc = TestBed.inject(PermissionService);

    // Deciding during a sign-in would race the first navigation after it.
    inProgress$.next(InteractionStatus.Login);
    await expect(loadedWithin(svc, 50)).rejects.toThrow();
    expect(httpGet).not.toHaveBeenCalled();

    inProgress$.next(InteractionStatus.None);
    expect(await loadedWithin(svc)).toBe('loaded');
  });

  it('ends signed-out, holding nothing, when there is no account', async () => {
    accounts = [];
    const svc = start();

    expect(await loadedWithin(svc)).toBe('signed-out');
    expect(httpGet).not.toHaveBeenCalled();
    expect(svc.has('notes:read')).toBe(false);
  });

  it('ends failed, holding nothing, when the request fails', async () => {
    // The API returns 503 while the grants can't be loaded.
    httpGet.mockImplementation(() => throwError(() => new Error('503')));
    const svc = start();

    expect(await loadedWithin(svc)).toBe('failed');
    expect(svc.has('notes:read')).toBe(false);
    expect(svc.userId()).toBe('');
  });

  it('ends failed even if building the request throws', async () => {
    // Not how HttpClient fails, but a throw here would escape the request's own catchError.
    httpGet.mockImplementation(() => { throw new Error('boom'); });
    const svc = start();

    expect(await loadedWithin(svc)).toBe('failed');
  });

  it('replays the outcome to a later subscriber', async () => {
    // A guard often asks after the load has already answered.
    const svc = start();
    await loadedWithin(svc);

    expect(await loadedWithin(svc)).toBe('loaded');
  });

  it("exposes the user's id and its short name", async () => {
    // The usage dashboard keys people by the part of the UPN before the '@'.
    const svc = start();
    await loadedWithin(svc);

    expect(svc.userId()).toBe('CEgr@scoular.com');
    expect(svc.userShortName()).toBe('CEgr');
  });

  it('passes an id with no domain through as the short name', async () => {
    httpGet.mockImplementation(() => of(response([], 'CEgr')));
    const svc = start();
    await loadedWithin(svc);

    expect(svc.userShortName()).toBe('CEgr');
  });
});
