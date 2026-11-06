import { Provider, computed, signal } from '@angular/core';
import { of } from 'rxjs';

import { PermissionId } from '@core/access/permission-ids.generated';
import { PermissionLoad, PermissionService } from '@core/access/permission.service';

/**
 * A PermissionService for specs: already loaded, holding exactly the permissions given. `grant`
 * replaces them, and anything that reads `has` or `hasAll` in a computed or template updates, as it
 * would after a real load.
 */
export function permissionStub(granted: readonly PermissionId[] = [], userId = '') {
  const held = signal<ReadonlySet<string>>(new Set(granted));
  const id = signal(userId);
  return {
    userId: id.asReadonly(),
    userShortName: computed(() => id().split('@')[0]),
    has: (permission: PermissionId) => held().has(permission),
    hasAll: (permissions: readonly PermissionId[]) => permissions.every(p => held().has(p)),
    loaded: () => of<PermissionLoad>('loaded'),
    grant: (...permissions: PermissionId[]) => held.set(new Set(permissions)),
  };
}

export type PermissionStub = ReturnType<typeof permissionStub>;

/** Provides `stub` (or a stub holding no permissions) as the PermissionService. */
export function providePermissions(stub: PermissionStub = permissionStub()): Provider {
  return { provide: PermissionService, useValue: stub };
}
