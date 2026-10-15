import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { MsalGuard, MsalService } from '@azure/msal-angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectivityService } from '../offline/connectivity.service';
import { offlineAuthGuard } from './offline-auth.guard';

describe('offlineAuthGuard', () => {
  const online = signal(true);
  const accounts: unknown[] = [];
  const msalGuard = { canActivate: vi.fn(() => true) };

  beforeEach(() => {
    accounts.length = 0;
    online.set(true);
    msalGuard.canActivate.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectivityService, useValue: { online } },
        { provide: MsalService, useValue: { instance: { getAllAccounts: () => accounts } } },
        { provide: MsalGuard, useValue: msalGuard },
      ],
    });
  });

  const run = (url: string) =>
    TestBed.runInInjectionContext(() =>
      offlineAuthGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );

  it('online: delegates to MsalGuard unchanged', () => {
    expect(run('/customers/1')).toBe(true);
    expect(msalGuard.canActivate).toHaveBeenCalledTimes(1);
  });

  it('offline with a cached account: allows the route without touching MSAL', () => {
    online.set(false);
    accounts.push({ username: 'a@scoular.com' });
    expect(run('/customers/1')).toBe(true);
    expect(msalGuard.canActivate).not.toHaveBeenCalled();
  });

  it('offline with no account: routes to /offline with the return url instead of a blank redirect', () => {
    online.set(false);
    const result = run('/customers/1') as UrlTree;
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result)).toBe('/offline?returnUrl=%2Fcustomers%2F1');
    expect(msalGuard.canActivate).not.toHaveBeenCalled();
  });
});
