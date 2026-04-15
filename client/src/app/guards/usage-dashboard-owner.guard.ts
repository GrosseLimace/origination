import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';

/**
 * Restricts the Usage Dashboard page to a single owner (CEgr) while it's in preview.
 * Everyone else gets redirected to the home page. Tracking still runs for all users —
 * this guard only gates the viewer UI, not the backend write endpoints.
 */
const ALLOWED_EMAIL = 'cegr@scoular.com';

export const usageDashboardOwnerGuard: CanActivateFn = () => {
  const msal = inject(MsalService);
  const router = inject(Router);

  const account = msal.instance.getActiveAccount() ?? msal.instance.getAllAccounts()[0];
  const email = (account?.username ?? '').toLowerCase();
  const normalized = email.includes('@') ? email : (email ? `${email}@scoular.com` : '');

  if (normalized === ALLOWED_EMAIL) return true;
  router.navigate(['/']);
  return false;
};
