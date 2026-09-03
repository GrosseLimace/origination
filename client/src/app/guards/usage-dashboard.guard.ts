import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { UserRolesService } from '@core/services/user-roles.service';

// Gates the usage-dashboard routes to the Admin app role — how the "Origination App {Env} Super
// Users" group grants dashboard access. Waits for UserRolesService like adminGuard so the first
// post-sign-in navigation doesn't race /api/me. Display-only convenience — every dashboard endpoint
// re-enforces the same policy server-side, and separately scopes WHAT the caller sees.
export const usageDashboardGuard: CanActivateFn = () => {
  const userRoles = inject(UserRolesService);
  const router = inject(Router);
  return userRoles.ready$().pipe(
    map(roles => roles.includes('Admin')
      ? true
      : router.createUrlTree(['/']))
  );
};
