// 1. Angular core
import { APP_INITIALIZER, ErrorHandler, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';

// 2. Angular router/http
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';

// 2b. RxJS
import { firstValueFrom } from 'rxjs';

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
//      - No bypassSecurityTrust* usage anywhere in the app.
//      - MSAL access tokens are short-lived (~1 hour) and refresh silently.
//      - Content-Security-Policy headers on the API block cross-origin resource loading.
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
      useFactory: (msalService: MsalService) => async () => {
        await msalService.instance.initialize();
        // Use the Angular wrapper (not instance.handleRedirectPromise directly) so that
        // setActiveAccount() is called automatically — MsalGuard checks the active account.
        await firstValueFrom(msalService.handleRedirectObservable());
      },
      deps: [MsalService],
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
          ['https://graph.microsoft.com/v1.0/me/photo/$value', ['User.Read']],
        ]),
      },
    },
    { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
    MsalService,
    MsalGuard,
    MsalBroadcastService,
  ],
}).catch((err) => console.error(err));
