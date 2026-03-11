import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';

export const authGuard: CanActivateFn = (route, state) => {
  return inject(MsalGuard).canActivate(route, state);
};
