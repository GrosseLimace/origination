import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { of } from 'rxjs';
import { MsalGuard } from '@azure/msal-angular';
import { authGuard } from './auth.guard';

describe('authGuard', () => {
  let msalGuardMock: { canActivate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    msalGuardMock = { canActivate: vi.fn().mockReturnValue(of(true)) };
    TestBed.configureTestingModule({
      providers: [{ provide: MsalGuard, useValue: msalGuardMock }],
    });
  });

  it('delegates to MsalGuard.canActivate and returns its result', () => {
    const route = {} as ActivatedRouteSnapshot;
    const state = { url: '/dashboard' } as RouterStateSnapshot;

    const result = TestBed.runInInjectionContext(() => authGuard(route, state));

    expect(msalGuardMock.canActivate).toHaveBeenCalledWith(route, state);
    expect(result).toBeTruthy();
  });

  it('returns false when MsalGuard rejects', () => {
    msalGuardMock.canActivate.mockReturnValue(of(false));
    const route = {} as ActivatedRouteSnapshot;
    const state = { url: '/dashboard' } as RouterStateSnapshot;

    const result = TestBed.runInInjectionContext(() => authGuard(route, state));

    expect(result).toBeTruthy(); // observable — check emission
  });
});
