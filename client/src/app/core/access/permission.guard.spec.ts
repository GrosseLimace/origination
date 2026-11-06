import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ReplaySubject, take } from 'rxjs';

import { PermissionId } from './permission-ids.generated';
import { PermissionLoad, PermissionService } from './permission.service';
import { permissionGuard, requires } from './permission.guard';

@Component({ template: 'gated' })
class GatedPage {}

@Component({ template: 'home' })
class HomePage {}

/** Runs the guard through the real router: a refused route falls through to the catch-all, as in app.routes.ts. */
describe('permissionGuard', () => {
  let loaded$: ReplaySubject<PermissionLoad>;
  let held: ReturnType<typeof signal<ReadonlySet<string>>>;
  let router: Router;

  beforeEach(() => {
    sessionStorage.clear();
    loaded$ = new ReplaySubject<PermissionLoad>(1);
    held = signal<ReadonlySet<string>>(new Set());
    const access = {
      loaded: () => loaded$.pipe(take(1)),
      hasAll: (permissions: readonly PermissionId[]) => permissions.every(p => held().has(p)),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: PermissionService, useValue: access },
        provideRouter([
          { path: 'gated', canMatch: [permissionGuard], data: requires('usage-reports:read', 'usage-exclusions:manage'), component: GatedPage },
          { path: 'unnamed', canMatch: [permissionGuard], component: GatedPage },
          { path: '', component: HomePage },
          { path: '**', redirectTo: '' },
        ]),
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => sessionStorage.clear());

  function load(outcome: PermissionLoad, ...permissions: PermissionId[]): void {
    held.set(new Set(permissions));
    loaded$.next(outcome);
  }

  it('lets the route match when the user holds every permission it requires', async () => {
    load('loaded', 'usage-reports:read', 'usage-exclusions:manage');

    await router.navigateByUrl('/gated');

    expect(router.url).toBe('/gated');
  });

  it('falls through to the catch-all when one permission is missing', async () => {
    load('loaded', 'usage-reports:read');

    await router.navigateByUrl('/gated');

    expect(router.url).toBe('/');
  });

  it('waits for the first load instead of deciding on the empty set held while loading', async () => {
    let settled = false;
    const navigation = router.navigateByUrl('/gated').then(() => settled = true);
    await Promise.resolve();
    expect(settled).toBe(false);

    load('loaded', 'usage-reports:read', 'usage-exclusions:manage');
    await navigation;

    expect(router.url).toBe('/gated');
  });

  it('denies when the permissions could not be loaded', async () => {
    load('failed');

    await router.navigateByUrl('/gated');

    expect(router.url).toBe('/');
  });

  it('refuses a gated route that names no permission', async () => {
    load('loaded', 'usage-reports:read', 'usage-exclusions:manage');

    await router.navigateByUrl('/unnamed');

    expect(router.url).toBe('/');
  });

  it("saves a signed-out user's link, so sign-in brings them back to it", async () => {
    load('signed-out');

    await router.navigateByUrl('/gated?range=30d');

    // The catch-all keeps the query string, so only the path is checked.
    expect(router.url).not.toContain('/gated');
    expect(sessionStorage.getItem('deepLinkUrl')).toBe('/gated?range=30d');
  });

  it("doesn't save the link of a signed-in user who lacks the permission", async () => {
    load('loaded');

    await router.navigateByUrl('/gated');

    expect(sessionStorage.getItem('deepLinkUrl')).toBeNull();
  });
});
