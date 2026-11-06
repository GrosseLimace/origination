import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { rememberDeepLink } from '@core/auth/deep-link';
import { PermissionId } from './permission-ids.generated';
import { PermissionService } from './permission.service';

/** Route data naming the permissions a route needs: `data: requires('usage-reports:read')`. */
export interface RequiresData {
  requires: readonly PermissionId[];
}

/** Builds a route's `data` for `permissionGuard`. Typed, so a misspelled permission won't compile. */
export function requires(...permissions: PermissionId[]): RequiresData {
  return { requires: permissions };
}

/**
 * Lets a route match only when the user holds every permission in its `data.requires`.
 *
 * It waits for the first permissions load, and denies if that load failed: it never decides on the
 * empty set the user holds while permissions are still loading, which would let a typed URL through.
 * A refused route doesn't match, so the router falls through to the catch-all and the route's code is
 * never downloaded.
 */
export const permissionGuard: CanMatchFn = route => {
  const access = inject(PermissionService);
  const router = inject(Router);
  const required = (route.data as Partial<RequiresData> | undefined)?.requires;

  // A gated route that names no permission is a mistake. Refuse it rather than let everyone in.
  if (!required?.length) return false;

  return access.loaded().pipe(
    map(load => {
      if (load === 'signed-out') {
        // The catch-all sends a signed-out user to the home page, where authGuard starts the sign-in.
        // Save the link now, or they land on the home page afterwards instead of where they asked to go.
        const navigation = router.currentNavigation();
        if (navigation) rememberDeepLink(router.serializeUrl(navigation.extractedUrl));
      }
      return load === 'loaded' && access.hasAll(required);
    }),
  );
};
