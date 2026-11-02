import { BrowserCacheLocation, PublicClientApplication } from '@azure/msal-browser';

import { environment } from '../../../environments/environment';

// The app's one MSAL instance. main.ts provides it as MSAL_INSTANCE, and the /cws route wraps it
// directly: provideCwsHostTokenAuth binds its token provider with useValue, before any injector
// exists, so that provider cannot inject(MsalService).
//
// Token storage decision — security-guide.md §4.2:
// "Prefer HttpOnly secure cookies for browser apps where feasible.
//  If using tokens in memory/local storage, document the threat model."
//
// We use SessionStorage (not LocalStorage or memory) because:
//   1. Tokens are cleared when the tab/browser closes — reduces stolen-token window.
//   2. SessionStorage is tab-isolated — tokens are not shared across tabs.
//   3. HttpOnly cookies are not feasible here: the API is on a different origin
//      (separate App Service in production), requiring SameSite=None + Secure cookies,
//      which creates third-party cookie restriction issues in modern browsers.
//   4. XSS is the primary remaining risk. Mitigations in place:
//      - Angular's built-in DOM sanitization prevents reflected/stored XSS.
//      - Exactly ONE bypassSecurityTrust* call in the app: HighlightPipe, which HTML-escapes the
//        text first and then inserts only its own static <mark> markup, so nothing
//        user-controlled reaches the DOM unescaped. Pinned by highlight.pipe.spec.ts — if you add
//        another such call, add it here and test it. (This line previously claimed there were
//        none, which had been untrue since the pipe was written.)
//      - MSAL access tokens are short-lived (~1 hour) and refresh silently.
//      - Content-Security-Policy HTTP headers (set in SecurityHeadersMiddleware) restrict resource loading for both SPA and API responses.
export const msalInstance = new PublicClientApplication({
  auth: {
    ...environment.msalConfig.auth,
  },
  cache: {
    cacheLocation: BrowserCacheLocation.SessionStorage,
  },
});
