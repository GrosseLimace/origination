import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';

export const authGuard: CanActivateFn = (...args) => {
  return inject(MsalGuard).canActivate(...args);
};
