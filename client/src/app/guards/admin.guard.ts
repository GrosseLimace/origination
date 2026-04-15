import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { filter, take, map } from 'rxjs/operators';

export const adminGuard: CanActivateFn = () => {
  const msalService = inject(MsalService);
  const broadcastService = inject(MsalBroadcastService);
  const router = inject(Router);

  return broadcastService.inProgress$.pipe(
    filter(status => status === InteractionStatus.None),
    take(1),
    map(() => {
      const account = msalService.instance.getActiveAccount()
        ?? msalService.instance.getAllAccounts()[0];
      const roles = (account?.idTokenClaims as any)?.roles as string[] | undefined;
      if (roles?.includes('Admin')) {
        return true;
      }
      return router.createUrlTree(['/']);
    })
  );
};
