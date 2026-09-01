import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { UserRolesService } from '@core/services/user-roles.service';

// Gates the usage-dashboard routes to Admins plus the server's UsageDashboard:Viewers
// allowlist (surfaced by /api/me as the synthetic `UsageDashboardViewer` role). Waits for
// UserRolesService like adminGuard so the first post-sign-in navigation doesn't race /api/me.
// Display-only convenience — every dashboard endpoint re-enforces the same policy server-side.
export const usageDashboardGuard: CanActivateFn = () => {
  const userRoles = inject(UserRolesService);
  const router = inject(Router);
  return userRoles.ready$().pipe(
    map(roles => roles.includes('Admin') || roles.includes('UsageDashboardViewer')
      ? true
      : router.createUrlTree(['/']))
  );
};
