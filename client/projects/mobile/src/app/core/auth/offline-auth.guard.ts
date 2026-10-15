import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MsalGuard, MsalService } from '@azure/msal-angular';

import { ConnectivityService } from '../offline/connectivity.service';

/**
 * Offline-tolerant route guard (ported from Burdi's offline-auth.guard.ts, INC0966632).
 *
 * The stock MsalGuard is online-only: with no usable session it fires a full-page redirect to
 * Entra, which cannot load in a dead zone and leaves the PWA blank. Behaviour here:
 *   online              → delegate to MsalGuard unchanged (account check + loginRedirect)
 *   offline + account   → allow; the page works from the service-worker cache and the sync queue
 *   offline + no account → /offline, a clear "reconnect to sign in" screen
 *
 * Known gap (same as Burdi): a token that expires mid-session while offline can still trip the
 * MsalInterceptor on a foreground call; pages are cache-first so that path is rarely hit.
 */
export const offlineAuthGuard: CanActivateFn = (route, state) => {
  const connectivity = inject(ConnectivityService);
  const msal = inject(MsalService);
  const router = inject(Router);

  if (connectivity.online()) {
    return inject(MsalGuard).canActivate(route, state);
  }

  if (msal.instance.getAllAccounts().length > 0) {
    return true;
  }

  return router.createUrlTree(['/offline'], { queryParams: { returnUrl: state.url } });
};
