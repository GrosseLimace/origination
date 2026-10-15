import { ApplicationConfig, ErrorHandler, inject, isDevMode, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import {
  MSAL_GUARD_CONFIG,
  MSAL_INSTANCE,
  MSAL_INTERCEPTOR_CONFIG,
  MsalBroadcastService,
  MsalGuard,
  MsalInterceptor,
  MsalService,
} from '@azure/msal-angular';
import { BrowserCacheLocation, InteractionType, PublicClientApplication } from '@azure/msal-browser';

import { routes } from './app.routes';
import { MobileAuthPort } from './core/auth/auth.port';
import { MsalAuthService } from './core/auth/msal-auth.service';
import { bootstrapMsal } from './core/auth/msal-bootstrap';
import { MobileErrorHandler } from './core/errors/mobile-error.handler';
import { SyncQueueService } from './core/offline/sync-queue.service';
import { environment } from '../environments/environment';

// Token storage: SessionStorage, same decision and threat model as the desktop app (see
// client/src/main.ts) and Burdi (security review H-13). Consequence on phones: iOS discards a
// backgrounded PWA freely and each relaunch is a new session, so every cold open goes through
// ssoSilent (case C1 in msal-bootstrap.ts) and offline-after-relaunch is not possible. That is the
// v1 offline scope ("survive a signal drop mid-session") until MEETING-QUESTIONS.md Q3 says otherwise.
const msalInstance = new PublicClientApplication({
  auth: {
    ...environment.msal,
    // CP1 = Continuous Access Evaluation: Entra can revoke this token near-real-time on sign-out,
    // password change or risk. The compensating control for browser token lifetime (ADR-001, exception 3).
    clientCapabilities: ['CP1'],
  },
  cache: {
    cacheLocation: BrowserCacheLocation.SessionStorage,
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptorsFromDi()),
    { provide: ErrorHandler, useClass: MobileErrorHandler },

    // ---- MSAL ---------------------------------------------------------------------------------
    { provide: MSAL_INSTANCE, useValue: msalInstance },
    {
      provide: MSAL_GUARD_CONFIG,
      useValue: {
        interactionType: InteractionType.Redirect,
        authRequest: { scopes: environment.apiScopes },
      },
    },
    {
      provide: MSAL_INTERCEPTOR_CONFIG,
      useValue: {
        interactionType: InteractionType.Redirect,
        // Both the glob and the bare base URL: msal-angular 5.2+ matches strictly, and a bare base
        // alone silently stops matching sub-paths (Burdi lesson, app.config.ts:57-71).
        protectedResourceMap: new Map<string, string[] | null>([
          [`${environment.apiBaseUrl}/*`, environment.apiScopes],
          [environment.apiBaseUrl, environment.apiScopes],
        ]),
      },
    },
    { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
    MsalService,
    MsalGuard,
    MsalBroadcastService,
    { provide: MobileAuthPort, useExisting: MsalAuthService },

    // Process the redirect BEFORE the router runs, or the auth code in the URL hash is lost and the
    // guard loops back to login (documented in developer-docs/CLAUDE.md "Angular MSAL Setup").
    provideAppInitializer(() => bootstrapMsal(inject(MsalService))),
    // Start the offline queue once; it drains whenever connectivity returns.
    provideAppInitializer(() => { inject(SyncQueueService).start(); }),

    // ---- PWA ------------------------------------------------------------------------------------
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
