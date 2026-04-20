import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { UserRolesService } from '@core/services/user-roles.service';

// Gates routes to users whose app-role set (from /api/me) includes `Admin`.
// Waits for UserRolesService to finish loading so the first navigation after
// sign-in doesn't race the `/api/me` response and redirect admins away.
export const adminGuard: CanActivateFn = () => {
  const userRoles = inject(UserRolesService);
  const router = inject(Router);
  return userRoles.ready$().pipe(
    map(roles => roles.includes('Admin') ? true : router.createUrlTree(['/']))
  );
};
