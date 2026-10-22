// 1. Angular core
import { APP_INITIALIZER, ErrorHandler, provideZonelessChangeDetection } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { bootstrapApplication } from '@angular/platform-browser';

// 2. Angular router/http
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
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
import { InteractionType } from '@azure/msal-browser';

// 4. App
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { environment } from './environments/environment';
import { GlobalErrorHandler } from './app/core/handlers/global-error.handler';
import { msalInstance } from './app/core/auth/msal-instance';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideRouter(routes, withComponentInputBinding()),
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
    MsalService,
    MsalGuard,
    MsalBroadcastService,
  ],
}).catch((err) => {
  if (!environment.production) {
    console.error(err);
  }
});
