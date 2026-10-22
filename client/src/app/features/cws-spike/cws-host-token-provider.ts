/*
 * SPIKE: how the Contract Workspace (CWS) gets its Contracts API token. Origination's own MSAL
 * session supplies it, silently, for the Contracts API scope in environment.cws, so CWS runs no MSAL
 * instance of its own and the user signs in once. CWS attaches the token itself, on its own
 * HttpClient, so our MsalInterceptor never sees these requests.
 *
 * A plain object, not an @Injectable: provideCwsHostTokenAuth binds it with useValue, so it exists
 * before any injector does and wraps msalInstance directly rather than inject(MsalService).
 */
import { signal } from '@angular/core';
import { EventType, InteractionRequiredAuthError } from '@azure/msal-browser';
import type { AccountInfo, AuthError } from '@azure/msal-browser';
import type { CwsAccount, CwsTokenProvider } from '@cws/core-auth';

import { environment } from '../../../environments/environment';
import { msalInstance } from '../../core/auth/msal-instance';

/** Set while a sign-in redirect for the Contracts scope is outstanding; cleared by the next token. */
const SIGN_IN_REDIRECT_KEY = 'cwsSignInRedirect';

const currentAccount = (): AccountInfo | null =>
  msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0] ?? null;

// CWS's own MSAL mode also uses localAccountId as the oid.
const toCwsAccount = (account: AccountInfo | null): CwsAccount | null =>
  account ? { oid: account.localAccountId, username: account.username, name: account.name ?? null } : null;

const account = signal(toCwsAccount(currentAccount()));
const signInBlocked = signal(false);

// CWS re-reads the roles whenever account changes (CWS #601), so it has to follow our session.
msalInstance.addEventCallback(
  () => account.set(toCwsAccount(currentAccount())),
  [EventType.ACTIVE_ACCOUNT_CHANGED, EventType.LOGIN_SUCCESS, EventType.LOGOUT_SUCCESS],
);

// Codes only: an Entra error message can name the user, and the token itself is never logged.
// The AADSTS code is what tells consent (65001) apart from role assignment (50105 / 501051).
function logTokenFailure(error: unknown): void {
  const authError = error as Partial<AuthError>;
  console.warn('[CwsTokenProvider] No Contracts API token', {
    errorCode: authError.errorCode,
    subError: authError.subError,
    aadsts: authError.errorMessage?.match(/AADSTS\d+/)?.[0],
    correlationId: authError.correlationId,
  });
}

/** `interactive` is true when a redirect could fix the failure: consent missing or the session expired. */
async function silentToken(scopes: readonly string[]): Promise<{ token: string | null; interactive: boolean }> {
  const signedIn = currentAccount();
  if (!signedIn) return { token: null, interactive: true };
  try {
    const result = await msalInstance.acquireTokenSilent({ scopes: [...scopes], account: signedIn });
    signInBlocked.set(false);
    sessionStorage.removeItem(SIGN_IN_REDIRECT_KEY);
    return { token: result.accessToken, interactive: false };
  } catch (error) {
    // Shows CWS's Sign in button, if its chrome is already on screen.
    signInBlocked.set(true);
    logTokenFailure(error);
    return { token: null, interactive: error instanceof InteractionRequiredAuthError };
  }
}

function signIn(): void {
  sessionStorage.setItem(SIGN_IN_REDIRECT_KEY, 'true');
  // main.ts restores deepLinkUrl after the redirect, the same handoff authGuard uses. Called from
  // CWS's route guard, the navigation into /cws has not committed yet, so location still shows the
  // page before it; land on the CWS home page then.
  const here = location.pathname + location.search;
  sessionStorage.setItem('deepLinkUrl', here.startsWith('/cws') ? here : '/cws');
  msalInstance
    .acquireTokenRedirect({ scopes: [...environment.cws.scopes], account: currentAccount() ?? undefined })
    .catch(logTokenFailure);
}

export const originationCwsTokenProvider: CwsTokenProvider = {
  // Already done by main.ts's APP_INITIALIZER; initialize() returns at once when called again.
  ready: () => msalInstance.initialize(),

  accessToken: async (scopes = environment.cws.scopes) => (await silentToken(scopes)).token,

  // CWS's guard is on every CWS child route, and a false cancels the navigation before CWS's chrome
  // (and its Sign in button) renders. So a failure a redirect can fix starts one here, but only once:
  // back from a redirect with still no token (consent refused or pending), another one would loop.
  async ensureSignedIn() {
    const { token, interactive } = await silentToken(environment.cws.scopes);
    if (token) return true;
    if (!interactive) return false;
    if (sessionStorage.getItem(SIGN_IN_REDIRECT_KEY)) {
      console.warn('[CwsTokenProvider] Still no Contracts API token after a sign-in redirect; not redirecting again');
      return false;
    }
    signIn();
    return false;
  },

  account: account.asReadonly(),
  signInBlocked: signInBlocked.asReadonly(),
  signIn,
  // embedded: true hides CWS's Sign out; Origination's header owns the session.
  signOut: () => undefined,
};
