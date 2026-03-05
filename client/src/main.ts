import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { MsalModule, MsalInterceptor, MsalGuard } from '@azure/msal-angular';
import { PublicClientApplication, InteractionType } from '@azure/msal-browser';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { environment } from './environments/environment';

const msalInstance = new PublicClientApplication({
  auth: {
    clientId: environment.msalConfig.clientId,
    authority: `https://login.microsoftonline.com/${environment.msalConfig.tenantId}`,
    redirectUri: environment.msalConfig.redirectUri,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  }
});

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    importProvidersFrom(
      MsalModule.forRoot(
        msalInstance,
        {
          interactionType: InteractionType.Redirect,
          authRequest: { scopes: [environment.msalConfig.apiScope] }
        },
        {
          interactionType: InteractionType.Redirect,
          protectedResourceMap: new Map([
            [environment.apiBaseUrl + '/*', [environment.msalConfig.apiScope]]
          ])
        }
      )
    ),
    { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
    MsalGuard,
  ]
}).catch((err) => console.error(err));
