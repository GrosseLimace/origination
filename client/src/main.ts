// 1. Angular core
import { APP_INITIALIZER, ErrorHandler, provideZonelessChangeDetection } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { bootstrapApplication } from '@angular/platform-browser';

// 2. Angular router/http
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';

// 3. Third-party (MSAL)
import {
  MsalInterceptor,
  MsalGuard,
  MsalBroadcastService,
  MsalService,
  MSAL_GUARD_CONFIG,
  MSAL_INSTANCE,
  MSAL_INTERCEPTOR_CONFIG,
} from '@azure/msal-angular';
import { PublicClientApplication, InteractionType, BrowserCacheLocation } from '@azure/msal-browser';

// 4. App
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { environment } from './environments/environment';
import { GlobalErrorHandler } from './app/core/handlers/global-error.handler';
import { DataSourcePreferenceInterceptor } from './app/core/interceptors/data-source-preference.interceptor';

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
const msalInstance = new PublicClientApplication({
  auth: {
    ...environment.msalConfig.auth,
  },
  cache: {
    cacheLocation: BrowserCacheLocation.SessionStorage,
  },
});

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    {
      provide: MSAL_INSTANCE,
      useValue: msalInstance,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: (msalService: MsalService, router: Router) => async () => {
        await msalService.instance.initialize();
        // Process any pending redirect response before guards run.
        // Without this, the auth code from Azure AD is unprocessed when guards
        // execute, causing a login redirect loop on every sign-in.
        try {
          await firstValueFrom(msalService.handleRedirectObservable());
        } catch {
          // Auth errors are handled via MsalBroadcastService; don't block bootstrap.
        }
        // After a successful login redirect, restore the deep link the user originally requested.
        const hasAccount = !!msalService.instance.getActiveAccount()
          || msalService.instance.getAllAccounts().length > 0;
        if (hasAccount) {
          try {
            const savedUrl = sessionStorage.getItem('deepLinkUrl');
            if (savedUrl && savedUrl.startsWith('/') && savedUrl !== '/') {
              sessionStorage.removeItem('deepLinkUrl');
              await router.navigateByUrl(savedUrl);
            }
          } catch {
            // Ignore navigation errors; user falls through to default route.
          }
        }
      },
      deps: [MsalService, Router],
      multi: true,
    },
    {
      provide: MSAL_GUARD_CONFIG,
      useValue: {
        interactionType: InteractionType.Redirect,
        authRequest: { scopes: environment.apiConfig.scopes },
      },
    },
    {
      provide: MSAL_INTERCEPTOR_CONFIG,
      useValue: {
        interactionType: InteractionType.Redirect,
        protectedResourceMap: new Map([
          [environment.apiConfig.uri, environment.apiConfig.scopes],
        ]),
      },
    },
    { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
    // Tells the API which data source (ODS / CTRM) this user prefers for contracts and tickets; the
    // server honours it only for allow-listed testers. See DataSourceService.
    { provide: HTTP_INTERCEPTORS, useClass: DataSourcePreferenceInterceptor, multi: true },
    MsalService,
    MsalGuard,
    MsalBroadcastService,
  ],
}).catch((err) => {
  if (!environment.production) {
    console.error(err);
  }
});
