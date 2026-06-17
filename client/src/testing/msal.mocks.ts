import { of } from 'rxjs';
import { InteractionStatus } from '@azure/msal-browser';

/** Minimal account shape the app reads off MSAL (name/username). */
export interface FakeAccount {
  name?: string;
  username?: string;
}

/**
 * A test double for `MsalService`. By default there is NO signed-in account, so
 * any token/photo fetch the component kicks off short-circuits (returns EMPTY) and
 * the test stays free of outstanding HTTP. Pass an account when a test needs one.
 */
export function makeMsalServiceMock(account: FakeAccount | null = null): any {
  const accounts = account ? [account] : [];
  return {
    instance: {
      getActiveAccount: () => account,
      getAllAccounts: () => accounts,
      setActiveAccount: () => undefined,
      initialize: () => Promise.resolve(),
      handleRedirectObservable: () => of(null),
      loginRedirect: () => Promise.resolve(),
      logoutRedirect: () => Promise.resolve(),
      acquireTokenSilent: () => Promise.resolve({ accessToken: 'test-access-token' }),
    },
    // Service-level methods return observables in @azure/msal-angular.
    logoutRedirect: () => of(undefined),
    loginRedirect: () => of(undefined),
    acquireTokenSilent: () => of({ accessToken: 'test-access-token' }),
  };
}

/** A test double for `MsalBroadcastService`. `inProgress$` reports "no interaction in
 *  progress", matching the steady state the app waits for. */
export function makeMsalBroadcastMock(): any {
  return {
    inProgress$: of(InteractionStatus.None),
    msalSubject$: of(),
  };
}
