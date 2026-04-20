import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { MsalGuard, MsalService } from '@azure/msal-angular';

// Delegate directly to MsalGuard. It coordinates with MSAL's interaction
// state internally; wrapping it in our own `inProgress$ -> filter(None) -> take(1)`
// pre-gate caused per-click navigations to hang whenever MSAL happened to be
// mid-interaction (e.g. a silent token refresh) at click time — the Observable
// never emitted before Angular unsubscribed it and the router silently dropped
// the navigation, producing the "dead click, fixed by refresh" symptom.
//
// Before delegating, if the user isn't signed in yet we save the target URL to
// sessionStorage so main.ts can restore it after Azure AD bounces them back
// through the login redirect — otherwise deep links like /insights/xyz would
// drop the user on / after login.
export const authGuard: CanActivateFn = (route, state) => {
  const msalService = inject(MsalService);
  const hasAccount = !!msalService.instance.getActiveAccount()
    || msalService.instance.getAllAccounts().length > 0;
  if (!hasAccount && state.url && state.url !== '/' && state.url.startsWith('/')) {
    try { sessionStorage.setItem('deepLinkUrl', state.url); } catch { /* sessionStorage unavailable */ }
  }
  return inject(MsalGuard).canActivate(route, state);
};
