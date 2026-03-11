import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { MsalGuard, MsalBroadcastService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { filter, take, switchMap } from 'rxjs/operators';

export const authGuard: CanActivateFn = (...args) => {
  const broadcastService = inject(MsalBroadcastService);
  const msalGuard = inject(MsalGuard);

  return broadcastService.inProgress$.pipe(
    filter(status => status === InteractionStatus.None),
    take(1),
    switchMap(() => msalGuard.canActivate(...args))
  );
};
