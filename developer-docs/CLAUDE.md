# Origination - Azure Infrastructure Context

## Critical Constraint: Network Access

**Outbound:** All environments use a zero-trust outbound NSG. By default, only these destinations are allowed:
- Private endpoint IPs (SQL, APIM, docstore, etc.) resolved at deploy time
- Azure DNS resolver (10.102.1.10)
- Entra ID (AzureActiveDirectory service tag)
- Azure Monitor (AzureMonitor service tag)
- All other RFC 1918 and internet traffic is **denied by default**

Additional outbound destinations can be added via `networking.customOutboundRules` in app-config.json — these apply to **all environments** including Dev.

**Inbound:** This app is private-only. Inbound traffic arrives via private endpoints only (no public internet access).

**When writing code**: External API calls require a custom outbound rule in the NSG. Azure services accessed via private endpoints (SQL, Storage, Key Vault) work without additional rules.

## Pre-configured App Settings

These are automatically deployed - do NOT tell developers to add them:

| Setting | Value/Purpose |
|---------|---------------|
| `ASPNETCORE_ENVIRONMENT` | `Dev`, `QA`, or null (prod) |
| `AzureAd__TenantId` | `1521f999-f722-4a4f-9747-166f93e9b0d1` |
| `AzureAd__ClientId` | API app registration Client ID |
| `AzureAd__Audience` | `api://{ClientId}` |
| `KeyVaultUri` | Key Vault URL |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | App Insights connection |
| `DefaultConnection` (connection string) | SQL with managed identity |

**DNS Configuration**: The App Service uses `dnsConfiguration.dnsServers` (site property) set to `10.102.1.10` (Private Resolver) to resolve private endpoint DNS names.

## Authentication

**App Registration Client IDs**:
| Environment | API (Backend) | SPA (Angular) |
|-------------|---------------|---------------|
| Dev | `00078a10-3f3f-4d17-9350-fe90401125ae` | `e0f25943-ae8b-4c2d-8060-c9ffbd448aff` |
| QA | `f3fcab2b-98c8-4622-86bd-c874d281b22a` | `c2bb1208-063d-43aa-bad0-6b51d21437b4` |
| Prod | `e1458bcd-7212-4ea0-a836-7e08d03b5bbf` | `958fd665-daa3-42c5-9903-3c9c00638bf1` |

### Angular MSAL Setup

**Required packages:**
```
@azure/msal-browser @azure/msal-angular
```

**Deployment architecture**: Angular is built into the .NET API's `wwwroot` folder and served as a single App Service deployment. The .NET app serves Angular static files and handles API routes, so deployed environments use **relative URLs** for the API.

**Environment files**:

`environment.ts` (local development - absolute URL to local .NET API):
```typescript
export const environment = {
  production: false,
  apiUrl: 'https://localhost:5001/api/v1',
  msalConfig: {
    auth: {
      clientId: '<DEV_SPA_CLIENT_ID>',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'http://localhost:4200',
      postLogoutRedirectUri: 'http://localhost:4200',
    }
  },
  apiConfig: {
    scopes: ['api://<DEV_API_CLIENT_ID>/Origination.Application.Dev'],
    uri: 'https://localhost:5001/api/v1'
  }
};
```

`environment.dev.ts` / `environment.qa.ts` / `environment.prod.ts` (deployed - relative URL, same origin):
```typescript
export const environment = {
  production: true,
  apiUrl: '/api/v1',
  msalConfig: {
    auth: {
      clientId: '<SPA_CLIENT_ID>',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'https://origination-dev.scoular.com', // or -qa / no suffix for prod
      postLogoutRedirectUri: 'https://origination-dev.scoular.com', // or -qa / no suffix for prod
    }
  },
  apiConfig: {
    scopes: ['api://<API_CLIENT_ID>/Origination.Application.Dev'], // .QA or .Prod for other envs
    uri: '/api/v1'
  }
};
```

Use SPA Client ID for `clientId` and API Client ID for scopes (see table above). `redirectUri` must be the **site origin** (no path), and must match an entry in the SPA app registration's redirect URIs. Do **not** point `redirectUri` at a dedicated `/auth` route — the bootstrap handler below processes the redirect at any path.

**Front-Channel Logout URL**: The SPA app registration's front-channel logout URL is configured to the environment's base URL (e.g., `https://origination-dev.scoular.com`). This enables single sign-out. Use the same URL as `postLogoutRedirectUri` in MSAL.

**Angular build output** (`angular.json` under `architect > build > options`):
```json
"outputPath": {
    "base": "../backend/src/Application.Api/wwwroot",
    "browser": ""
}
```

Add `fileReplacements` under `configurations` for each deployed environment to swap environment files at build time.

> ⚠️ **Critical: handle MSAL redirects BEFORE Angular bootstraps.**
> Do NOT call `handleRedirectObservable().subscribe()` inside `AppComponent.ngOnInit` as your primary redirect handler. `ngOnInit` runs after Angular's router has already activated routes — the router clears the `#code=...` hash on first navigation before MSAL reads it, MSAL never gets the code, and `MsalGuard` triggers another login redirect. The user loops between `login.microsoftonline.com` and the app indefinitely. Always process the redirect in a `provideAppInitializer` so it completes before bootstrap.

**App bootstrap** (`app.config.ts` — standalone Angular 18+):

```typescript
import { ApplicationConfig, ErrorHandler, inject, provideAppInitializer } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import {
  MsalGuard, MsalInterceptor, MsalBroadcastService, MsalService,
  MSAL_GUARD_CONFIG, MSAL_INSTANCE, MSAL_INTERCEPTOR_CONFIG,
} from '@azure/msal-angular';
import {
  PublicClientApplication, InteractionType, BrowserCacheLocation, IPublicClientApplication,
} from '@azure/msal-browser';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { AppInsightsService, AppInsightsErrorHandler } from './core/services/app-insights.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),

    {
      provide: MSAL_INSTANCE,
      useFactory: () => new PublicClientApplication({
        auth: { ...environment.msalConfig.auth },
        cache: {
          // SessionStorage: per-tab isolation. Tokens don't persist after tab close or
          // across tabs — intentional defense-in-depth against XSS-stolen tokens.
          // Transparent SSO across tabs comes from the Azure AD session cookie, not
          // from MSAL's local cache — see Case C1 (ssoSilent) below.
          cacheLocation: BrowserCacheLocation.SessionStorage,
        },
      }),
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
        protectedResourceMap: new Map<string, string[] | null>([
          [`${environment.apiUrl}/health`, null],                         // health probe: no token required
          [`${environment.apiConfig.uri}/*`, environment.apiConfig.scopes],
        ]),
      },
    },

    { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
    { provide: ErrorHandler, useClass: AppInsightsErrorHandler },         // see Application Insights section
    MsalService,
    MsalGuard,
    MsalBroadcastService,

    provideAppInitializer(async () => {
      const appInsights = inject(AppInsightsService);
      const msal = inject(MSAL_INSTANCE) as IPublicClientApplication;

      try {
        await msal.initialize();

        // Case A: returning from login with a #code=... hash in the URL.
        const result = await msal.handleRedirectPromise();
        if (result?.account) {
          msal.setActiveAccount(result.account);
          appInsights.trackEvent('MSAL.BootstrapRedirectHandled', {
            username: result.account.username,
          });
          return;
        }

        // Case B: same-tab cached account (SessionStorage survives hot-reload and
        // route changes that don't close the tab).
        const cached = msal.getAllAccounts();
        if (cached.length > 0) {
          msal.setActiveAccount(cached[0]);
          appInsights.trackEvent('MSAL.BootstrapCachedAccount', {
            username: cached[0].username,
          });
          return;
        }

        // Case C1: try silent SSO. Hidden iframe + prompt=none against
        // login.microsoftonline.com. Completes in ~300ms when the user has a valid
        // Azure AD session cookie (the typical case for the second, third, ... tab
        // someone opens). No visible redirect, no user interaction.
        try {
          const silent = await msal.ssoSilent({
            scopes: environment.apiConfig.scopes,
          });
          if (silent.account) {
            msal.setActiveAccount(silent.account);
            appInsights.trackEvent('MSAL.BootstrapSsoSilent', {
              username: silent.account.username,
            });
            return;
          }
        } catch (silentErr) {
          // ssoSilent fails when: no SSO cookie, third-party cookies blocked,
          // CSP disallows the iframe, or Azure AD requires interaction (new device,
          // MFA challenge, consent). Fall through to Case C2.
          appInsights.trackEvent('MSAL.BootstrapSsoSilentFailed', {
            errorCode: (silentErr as { errorCode?: string })?.errorCode,
            errorMessage: silentErr instanceof Error ? silentErr.message : String(silentErr),
          });
        }

        // Case C2: last resort — visible top-level redirect BEFORE bootstrap finishes.
        // User sees login.microsoftonline.com briefly (SSO cookie usually auto-submits).
        // This prevents the flash-of-unauthenticated-content because the Angular shell
        // never renders with a guard failure.
        appInsights.trackEvent('MSAL.BootstrapLoginRedirect');
        await msal.loginRedirect({
          scopes: environment.apiConfig.scopes,
          redirectStartPage: window.location.href,                         // preserves deep link
        });
      } catch (err) {
        // Stale storage, nonce mismatch, etc. Don't leave the guard to handle it —
        // that's what causes loops. Log and continue; the guard will retry cleanly.
        appInsights.trackException(err, undefined, { phase: 'MSAL.bootstrap' });
        console.error('MSAL bootstrap failed', err);
      }
    }),
  ],
};
```

**`main.ts` stays minimal** — just bootstrap the app with the config:
```typescript
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
```

**Route configuration** — use `MsalGuard` on protected routes. **No `MsalRedirectComponent` or `/auth` route is required** — the `provideAppInitializer` handles the redirect at any path:

```typescript
import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    canActivate: [MsalGuard],
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
  // Public routes (no guard) for error states the app or MsalGuard redirect to:
  {
    path: 'unauthorized',
    loadComponent: () => import('./features/unauthorized/unauthorized.component').then(m => m.UnauthorizedComponent),
  },
];
```

**Root component** — wire up MSAL event forwarding to App Insights, set the active account once interaction completes, and handle long-running-tab token expiry:

```typescript
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MsalService, MsalBroadcastService } from '@azure/msal-angular';
import { EventType, InteractionRequiredAuthError, InteractionStatus } from '@azure/msal-browser';
import { Subject, filter, takeUntil } from 'rxjs';

import { environment } from '../environments/environment';
import { AppInsightsService } from './core/services/app-insights.service';
import { forwardMsalEventsToAppInsights } from './core/services/msal-telemetry';

@Component({ /* ... */ })
export class AppComponent implements OnInit, OnDestroy {
  private readonly destroying$ = new Subject<void>();
  private readonly msalService = inject(MsalService);
  private readonly msalBroadcastService = inject(MsalBroadcastService);
  private readonly appInsights = inject(AppInsightsService);

  ngOnInit(): void {
    // Forward every MSAL event (login, logout, token acquisition, failures) to
    // App Insights. Makes the auth flow observable end-to-end.
    forwardMsalEventsToAppInsights(this.msalBroadcastService, this.appInsights, this.destroying$);

    // After interaction settles, set App Insights authenticated user context
    // so subsequent telemetry is filterable by UPN.
    this.msalBroadcastService.inProgress$
      .pipe(
        filter((status: InteractionStatus) => status === InteractionStatus.None),
        takeUntil(this.destroying$),
      )
      .subscribe(() => {
        const account = this.msalService.instance.getActiveAccount()
          ?? this.msalService.instance.getAllAccounts()[0];
        if (account) {
          this.msalService.instance.setActiveAccount(account);
          this.appInsights.setAuthenticatedUser(account.username);
        }
      });

    // Long-running-tab recovery. When silent token refresh fails (refresh token
    // expired after ~24h, Conditional Access session control fired, etc.), MSAL
    // emits ACQUIRE_TOKEN_FAILURE. We force a visible redirect to re-establish a
    // session. Without this handler, the UI silently breaks in tabs left open
    // longer than the refresh-token lifetime.
    this.msalBroadcastService.msalSubject$
      .pipe(
        filter((msg) => msg.eventType === EventType.ACQUIRE_TOKEN_FAILURE),
        takeUntil(this.destroying$),
      )
      .subscribe((msg) => {
        if (msg.error instanceof InteractionRequiredAuthError) {
          this.msalService.instance.acquireTokenRedirect({
            scopes: environment.apiConfig.scopes,
          });
        }
      });
  }

  ngOnDestroy(): void {
    this.destroying$.next();
    this.destroying$.complete();
  }
}
```

**How this pattern handles token lifetimes transparently:**

| Timescale | What expires | MSAL behavior | User sees |
|---|---|---|---|
| ~1 hour, every API call | Access token | Interceptor silent-refreshes via refresh token — background POST to `/oauth2/v2.0/token`, no redirect | Nothing |
| ~24 hours (SPA max) | Refresh token | `ACQUIRE_TOKEN_FAILURE` handler fires `acquireTokenRedirect` | Brief flicker through `login.microsoftonline.com`, SSO auto-submits |
| ~90 days (tenant-configurable) | Azure AD session cookie | `acquireTokenRedirect` can't auto-SSO; user prompted for credentials | Actual login prompt (expected) |
| CA-configured | Conditional Access "sign-in frequency" | Same as refresh-token expiry, on the CA-enforced schedule | Brief redirect, auto-SSO if still in window |

### .NET API Authentication Setup

**Required packages:**
```
Microsoft.Identity.Web
Microsoft.Identity.Web.UI (optional, for Swagger auth)
```

**Program.cs:**
```csharp
using Microsoft.Identity.Web;

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));

builder.Services.AddAuthorization();

// CORS only needed for local dev (ng serve on localhost:4200 calling local API)
var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ?? [];
if (allowedOrigins.Length > 0)
{
    builder.Services.AddCors(options =>
        options.AddDefaultPolicy(policy =>
            policy.WithOrigins(allowedOrigins)
                  .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
}

// After Build():
app.UseStaticFiles();          // Serve Angular files from wwwroot
if (allowedOrigins.Length > 0)
    app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapFallbackToFile("index.html");  // SPA fallback for Angular routing
```

**CORS note**: In deployed environments, Angular and the API share the same origin (single App Service), so CORS is not needed. Configure `AllowedOrigins` only in `appsettings.Development.json` for local development with `ng serve`.

**Protect controllers:**
```csharp
[ApiController]
[Authorize]
[Route("api/v1/[controller]")]
public class MyController : ControllerBase { }
```

**appsettings.json** - only this is needed (all other AzureAd settings come from App Settings):
```json
{ "AzureAd": { "Instance": "https://login.microsoftonline.com/" } }
```

### SignalR Authentication

If using SignalR, the WebSocket handshake cannot send HTTP headers. Pass the token via query string:

**Angular client:**
```typescript
const connection = new signalR.HubConnectionBuilder()
  .withUrl(`${environment.apiUrl}/myhub`, {
    accessTokenFactory: () => this.msalService.acquireTokenSilent({
      scopes: environment.apiConfig.scopes
    }).then(result => result.accessToken)
  })
  .build();
```

**.NET Hub configuration:**
```csharp
builder.Services.AddAuthentication().AddMicrosoftIdentityWebApi(/*...*/)
    .EnableTokenAcquisitionToCallDownstreamApi()
    .AddInMemoryTokenCaches();

// In auth config, extract token from query string for SignalR:
options.Events = new JwtBearerEvents
{
    OnMessageReceived = context =>
    {
        var accessToken = context.Request.Query["access_token"];
        var path = context.HttpContext.Request.Path;
        if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/api/v1/myhub"))
        {
            context.Token = accessToken;
        }
        return Task.CompletedTask;
    }
};
```

## Local Development

When running locally (before deploying to App Service):

**Key differences from deployed environment**:
- Internet access IS available locally (unlike deployed app)
- App Settings must be provided via `appsettings.Development.json` or user secrets
- Authentication to Azure services uses developer's identity (Azure CLI, Visual Studio)

**appsettings.Development.json** (for local dev):
```json
{
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "1521f999-f722-4a4f-9747-166f93e9b0d1",
    "ClientId": "00078a10-3f3f-4d17-9350-fe90401125ae",
    "Audience": "api://00078a10-3f3f-4d17-9350-fe90401125ae"
  },
  "KeyVaultUri": "https://kv-orig-dev-eus.vault.azure.net/",
  "AllowedOrigins": ["http://localhost:4200"]
}
```

**SQL connection locally**: Use same connection string - `DefaultAzureCredential` authenticates via Azure CLI or Visual Studio credentials.

**Angular localhost**: `http://localhost:4200`, `:4201`, and `:4202` are pre-configured as redirect URIs in the Dev SPA app registration.

**Backend .gitignore** - exclude Angular build output and publish artifacts:
```
publish/
**/wwwroot/
```

**Authenticate to Azure first**:
```bash
az login --tenant 1521f999-f722-4a4f-9747-166f93e9b0d1
```

## Mapping features (proof of concept)

The app has a MapLibre GL + Azure Maps + LandMapMagic mapping capability: a Customer Profile
**"Fields" tab** (tag a producer's USDA CLU / parcel / hand-drawn field boundaries — persists to a
local SQLite `FieldTagDbContext`) and a rebuilt **Bid Sheet map** (read-only field/parcel context,
CDL crop overlay). This is **local-dev-only POC** — dormant unless `FieldTags:*` config is set,
never migrated into shared Azure SQL, uses a browser-exposed free-tier vendor key.

**Full detail lives in [`docs/maps/`](../docs/maps/)** — start with `docs/maps/README.md`
(as-built architecture) and `docs/maps/PATH-TO-PRODUCTION.md` before extending or productionizing
any of it. Don't duplicate that detail here.

## SQL Database

- **Authentication**: Managed Identity (no credentials needed)
- **Connection**: Use `Configuration.GetConnectionString("DefaultConnection")`
- **Network**: Private Endpoint - traffic stays on Azure backbone, no public internet

**Private Endpoint Architecture**:
```
App Service -> VNet -> Private DNS Resolver (10.102.1.10) -> Private IP -> SQL Server
```

The App Service resolves `azrscosqld01.database.windows.net` to a private IP (e.g., `10.103.24.4`) via the Private DNS Resolver. Traffic never leaves the Azure private network.

```csharp
services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(Configuration.GetConnectionString("DefaultConnection"),
        sql => sql.EnableRetryOnFailure(5, TimeSpan.FromSeconds(30), null)));
```

**Security**: Always use Entity Framework or parameterized queries. Never concatenate user input.

## Key Vault

- **Access**: App's managed identity has read access
- **URL**: Available via `Configuration["KeyVaultUri"]`

```csharp
var keyVaultUrl = builder.Configuration["KeyVaultUri"];
if (!string.IsNullOrEmpty(keyVaultUrl))
{
    // On App Service, use ManagedIdentityCredential directly to avoid
    // DefaultAzureCredential cycling through 8+ providers (~120s timeout).
    // Locally, use the full credential chain for developer convenience.
    var isAppService = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"));
    var credential = isAppService
        ? (Azure.Core.TokenCredential)new ManagedIdentityCredential()
        : new DefaultAzureCredential();

    builder.Configuration.AddAzureKeyVault(new Uri(keyVaultUrl), credential);
}
// Access secrets via Configuration["secret-name"]
```

**Store**: API keys, client secrets, encryption keys. **Don't store**: non-sensitive config.

**Security**: Key Vault access is restricted to private endpoints. All operations are audit-logged to Log Analytics (AuditEvent category). RBAC authorization is enforced — no legacy access policies.

## Application Insights

### .NET (Server-Side)

Auto-configured via `APPLICATIONINSIGHTS_CONNECTION_STRING` (pre-configured in App Settings). Just use `ILogger`:

```csharp
public class MyService(ILogger<MyService> logger)
{
    public void DoWork() => logger.LogInformation("Processing started");
}
```

**Don't log**: passwords, tokens, PII, connection strings.

### Angular (Client-Side)

Client-side telemetry is **required** for any Scoular Angular SPA that uses MSAL. Server-side App Insights (auto-configured via `APPLICATIONINSIGHTS_CONNECTION_STRING`) only captures what the .NET app sees — MSAL errors, Angular template errors, unhandled promise rejections, and interceptor failures all happen in the browser and are invisible to server-side telemetry.

**Required packages:**
```
@microsoft/applicationinsights-web @microsoft/applicationinsights-angularplugin-js
```

**Wrapper service** — create `src/app/core/services/app-insights.service.ts`:

```typescript
import { ErrorHandler, Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApplicationInsights, SeverityLevel } from '@microsoft/applicationinsights-web';
import { AngularPlugin } from '@microsoft/applicationinsights-angularplugin-js';

import { environment } from '../../../environments/environment';

type EnvironmentWithAppInsights = typeof environment & {
  appInsights?: { connectionString?: string };
};

function resolveConnectionString(): string | null {
  const cs = (environment as EnvironmentWithAppInsights).appInsights?.connectionString;
  if (!cs) return null;
  if (cs.startsWith('<') && cs.endsWith('>')) return null;      // placeholder sentinel
  return cs;
}

@Injectable({ providedIn: 'root' })
export class AppInsightsService {
  readonly instance: ApplicationInsights | null;
  private readonly angularPlugin = new AngularPlugin();

  constructor() {
    const connectionString = resolveConnectionString();
    if (!connectionString) {
      this.instance = null;
      return;
    }

    const router = inject(Router);
    const ai = new ApplicationInsights({
      config: {
        connectionString,
        extensions: [this.angularPlugin],
        extensionConfig: { [this.angularPlugin.identifier]: { router } },
        enableAutoRouteTracking: true,
        autoTrackPageVisitTime: true,
      },
    });
    ai.loadAppInsights();
    ai.addTelemetryInitializer((envelope) => {
      envelope.tags = envelope.tags ?? {};
      const tags = envelope.tags as Record<string, string>;
      tags['ai.cloud.role'] =
        `origination-spa-${environment.environmentName ?? 'prod'}`;
    });

    this.instance = ai;
  }

  trackEvent(name: string, properties?: Record<string, unknown>): void {
    this.instance?.trackEvent({ name, properties: properties as never });
  }

  trackException(
    error: unknown,
    severityLevel: SeverityLevel = SeverityLevel.Error,
    properties?: Record<string, unknown>,
  ): void {
    if (!this.instance) return;
    const exception = error instanceof Error ? error : new Error(String(error));
    this.instance.trackException({ exception, severityLevel, properties: properties as never });
  }

  trackTrace(
    message: string,
    severityLevel: SeverityLevel = SeverityLevel.Information,
    properties?: Record<string, unknown>,
  ): void {
    this.instance?.trackTrace({ message, severityLevel, properties: properties as never });
  }

  setAuthenticatedUser(userId: string | null): void {
    if (!this.instance) return;
    if (userId) {
      this.instance.setAuthenticatedUserContext(userId, undefined, true);
    } else {
      this.instance.clearAuthenticatedUserContext();
    }
  }
}

@Injectable({ providedIn: 'root' })
export class AppInsightsErrorHandler implements ErrorHandler {
  private readonly appInsights = inject(AppInsightsService);

  handleError(error: unknown): void {
    this.appInsights.trackException(error);
    console.error(error);
  }
}
```

**MSAL event forwarder** — create `src/app/core/services/msal-telemetry.ts`:

```typescript
import { MsalBroadcastService } from '@azure/msal-angular';
import { EventMessage } from '@azure/msal-browser';
import { SeverityLevel } from '@microsoft/applicationinsights-web';
import { Subject, Subscription, takeUntil } from 'rxjs';

import { AppInsightsService } from './app-insights.service';

export function forwardMsalEventsToAppInsights(
  broadcast: MsalBroadcastService,
  appInsights: AppInsightsService,
  destroying$: Subject<void>,
): Subscription {
  return broadcast.msalSubject$
    .pipe(takeUntil(destroying$))
    .subscribe((msg: EventMessage) => {
      const err = msg.error as {
        name?: string; message?: string; errorCode?: string; subError?: string;
      } | null;
      appInsights.trackEvent(`MSAL.${msg.eventType}`, {
        interactionType: msg.interactionType,
        errorName: err?.name,
        errorCode: err?.errorCode,
        errorSubcode: err?.subError,
        errorMessage: err?.message,
      });
      if (msg.error) {
        appInsights.trackException(msg.error, SeverityLevel.Warning, {
          msalEventType: msg.eventType,
        });
      }
    });
}
```

**Wire into `app.config.ts`**: See the MSAL Setup section above — `AppInsightsErrorHandler` replaces Angular's default `ErrorHandler`, and the `provideAppInitializer` injects `AppInsightsService` to emit bootstrap events. The root component calls `forwardMsalEventsToAppInsights` in `ngOnInit`.

**Connection string placement** — add to each environment file next to the MSAL config:

```typescript
export const environment = {
  // ... existing MSAL / apiConfig ...
  appInsights: {
    connectionString: 'InstrumentationKey=...;IngestionEndpoint=https://{region}.in.applicationinsights.azure.com/;LiveEndpoint=https://{region}.livediagnostics.monitor.azure.com/;ApplicationId=...',
  }
};
```

Get each environment's connection string from its App Insights resource:
```bash
az monitor app-insights component show \
  --app appi-origination-dev-eus \
  --resource-group rg-origination-dev-eus \
  --query connectionString -o tsv
```

For environments not yet provisioned (e.g., prod before first deploy), use a placeholder like `<PROD_CONNECTION_STRING_NOT_YET_PROVISIONED>`. The service detects the `<...>` pattern and skips initialization, so the app still runs — it just sends no telemetry.

**What it captures automatically (via the Angular plugin):**
- Angular route changes → `pageViews`
- Unhandled JavaScript exceptions → `exceptions` (via the `AppInsightsErrorHandler` replacement)
- XMLHttpRequest/fetch dependency calls → `dependencies` (URL, duration, response code)
- Browser and device metrics

**What the MSAL forwarder adds:**
- Every `EventType.*` from `msalSubject$` → `customEvents` named `MSAL.{type}` (e.g., `MSAL.msal:acquireTokenSuccess`, `MSAL.msal:acquireTokenFailure`)
- MSAL error codes and subcodes (`state_mismatch`, `interaction_required`, `consent_required`, `nonce_mismatch`, etc.) captured as event properties — invaluable for diagnosing auth failures
- Bootstrap-phase events emitted from `provideAppInitializer`: `MSAL.BootstrapRedirectHandled`, `MSAL.BootstrapCachedAccount`, `MSAL.BootstrapSsoSilent`, `MSAL.BootstrapSsoSilentFailed`, `MSAL.BootstrapLoginRedirect` — these tell you which auth path a user took without having to read HAR files

**Filter by user** (after `setAuthenticatedUser` fires):
```kusto
union customEvents, pageViews, exceptions, requests
| where timestamp > ago(1h)
| where user_AuthenticatedId == "john.doe@scoular.com"
| order by timestamp asc
```

This cross-table join gives you the full session timeline for a specific user on one screen — page loads, MSAL events, API calls, exceptions — which is usually what you actually want when someone says "the app broke for me at 3pm."

**Custom events** (optional, for product analytics):
```typescript
this.appInsights.trackEvent('TransferSubmitted', { locationId: '42' });
```

**Security note:** The App Insights connection string is visible in the browser JS bundle. Microsoft classifies it as non-secret — it identifies *where* to send telemetry and authorizes *writes only*. An attacker with the connection string can send noise telemetry (costing ingestion budget) but cannot read existing data. **Do not** include PII, tokens, or connection strings in custom event properties — `trackEvent` data is subject to the same retention and query access as all App Insights telemetry.

### CSP Allow-List for MSAL and App Insights

The .NET middleware that sets the `Content-Security-Policy` response header must allow the domains the Angular SPA needs to reach. Without the correct `connect-src` and `frame-src` entries, the browser silently blocks `fetch()` / `XMLHttpRequest` / iframe loads to those hosts — the request never reaches the network, telemetry disappears, and silent SSO degrades to visible redirects. You'll see CSP violation errors only in `DevTools → Console`; they do **not** appear in HAR files (because the browser refuses to send the request) and do **not** appear in App Insights (because the SDK can't post to a blocked endpoint).

**Required `connect-src` entries** (in `SecurityHeadersMiddleware.cs` and `CspNonceMiddleware.cs`):

```csharp
"connect-src 'self' " +
    "https://login.microsoftonline.com https://*.login.microsoftonline.com " +   // MSAL auth endpoints
    "https://graph.microsoft.com " +                                              // User profile/photo (optional)
    "https://*.in.applicationinsights.azure.com " +                               // App Insights ingestion (any region)
    "https://*.livediagnostics.monitor.azure.com; " +                             // App Insights live metrics
```

**Required `frame-src` entry:**
```csharp
"frame-src 'self' https://login.microsoftonline.com"
```
This allows MSAL's `ssoSilent` to load the Microsoft login page inside a hidden iframe. Without it, `ssoSilent` fails and MSAL falls back to the visible `loginRedirect` path (Case C2 in the MSAL Setup section above) — the auth still works but the "transparent SSO across tabs" experience degrades.

**Wildcard semantics**: `https://*.in.applicationinsights.azure.com` matches any single-label subdomain (`eastus-8.in.applicationinsights.azure.com`, `westus2-0.in.applicationinsights.azure.com`, etc.). Azure uses region-specific ingest hostnames, so the wildcard pattern covers every Azure region without broadening beyond the ingestion layer. The same reasoning applies to `*.livediagnostics.monitor.azure.com`.

**If the App Insights resource moves to a different region**, the connection string in your environment file updates automatically (pull it fresh via `az monitor app-insights component show --query connectionString`), but the CSP doesn't need to change — the wildcard handles it.

**Failure mode to recognize**: if App Insights events stop flowing to the portal after a deploy that looked successful, open DevTools → Console and look for entries like:
> Refused to connect to 'https://eastus-8.in.applicationinsights.azure.com/v2/track' because it violates the following Content Security Policy directive: "connect-src 'self' ...".

That's CSP blocking the SDK. Fix by updating the middleware's allow-list.

## Startup Performance

Linux App Service cold starts include ~90s of certificate rehash before `dotnet` runs. Use `ManagedIdentityCredential` on App Service (see Key Vault section above) to save ~60-120s vs `DefaultAzureCredential` cycling through unused credential providers.

## Security Rules

1. **Use managed identity** for Azure services (SQL, Storage, Key Vault)
2. **Use Key Vault** for secrets, not appsettings.json
3. **Parameterized queries only** - never concatenate SQL
4. **Encode output** - use Razor's default encoding, avoid `Html.Raw`
5. **Implement retry logic** for Azure service calls

## GitHub Actions CI/CD

This application deploys via GitHub Actions from `scoular.ghe.com/IT/origination`.

**When creating or modifying GitHub Actions workflows:**
- Use `runs-on: self-hosted` (corporate runners, NOT GitHub-hosted)
- Authenticate to Azure via OIDC (Workload Identity Federation), not stored credentials
- Use GHE environment gates: `dev`, `qa`, `prod`
- Reference secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID_NONPROD`, `AZURE_SUBSCRIPTION_ID_PROD`

**OIDC login step:**
```yaml
permissions:
  id-token: write
  contents: read

steps:
  - name: Azure Login (OIDC)
    uses: azure/login@v3
    with:
      client-id: ${{ secrets.AZURE_CLIENT_ID }}
      tenant-id: ${{ secrets.AZURE_TENANT_ID }}
      subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}  # Use _PROD for prod
```

**Deploy step:**
```yaml
  - name: Deploy to App Service
    uses: azure/webapps-deploy@v3
    with:
      app-name: app-origination-dev-eus  # or -qa-eus / -eus for prod
      package: ./publish
```

**Path filters:** Always include `paths-ignore` to prevent documentation updates from triggering CI/CD:
```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - 'developer-docs/**'
      - 'style-guides/**'
      - '*.md'
```

**npm @it packages:** If the Angular app uses `@it` scoped packages, authenticate to the GHE npm registry with `GITHUB_TOKEN` before `npm ci`. See `developer-docs/GITHUB-ACTIONS-CICD.md` for the workflow step.

**Subscription selection:** Use `AZURE_SUBSCRIPTION_ID_NONPROD` for dev/qa, `AZURE_SUBSCRIPTION_ID_PROD` for prod.

**SQL migrations:** The workflow identity has db_datareader, db_datawriter, db_ddladmin, and database-wide EXECUTE on Origination (the EXECUTE grant lets migrations call user-defined stored procedures, including CREATE PROC + EXEC patterns).
Use `Authentication=Active Directory Default` in the connection string, not connection strings with passwords.
**Important:** On self-hosted runners, `Active Directory Default` uses `DefaultAzureCredential` which tries the runner VMSS managed identity *before* Azure CLI. Your EF Core project must include a design-time `IDesignTimeDbContextFactory` with `ExcludeManagedIdentityCredential = true` to ensure the correct workflow service principal is used. See `developer-docs/GITHUB-ACTIONS-CICD.md` for the full pattern.

See `developer-docs/GITHUB-ACTIONS-CICD.md` for the full CI/CD guide.

## Resource Naming

| Resource | Dev | QA | Prod |
|----------|-----|----|----|
| App Service | `app-origination-dev-eus` | `app-origination-qa-eus` | `app-origination-eus` |
| Key Vault | `kv-orig-dev-eus` | `kv-orig-qa-eus` | `kv-orig-eus` |
| Custom Domain | `origination-dev.scoular.com` | `origination-qa.scoular.com` | `origination.scoular.com` |
| SQL Server | `azrscosqld01` | `azrscosqlq01` | `azrscosqlp01` |
| Database | `Origination` | `Origination` | `Origination` |

---

## External SPA

To add external access to this application, produce an OpenAPI specification for your external endpoints. See `developer-docs/EXTERNAL-SPA-GUIDE.md` for the full guide.

**What Claude Code should do when asked to add external SPA support:**

1. Analyze the codebase for externally-suitable workflows (field operations, quick data entry, read-heavy dashboards accessible on small screens)
2. Identify the minimal set of API endpoints those workflows require
3. Create an `openapi/` directory in the repo root with:
   - `specification.yaml` — OpenAPI 3.0 spec covering only external-facing endpoints
   - `README.md` — workflow summary and offline requirements table

4. The OpenAPI spec is consumed by three teams:
   - **Infrastructure** — populates `externalApp.externalApiEndpoints` in app-config.json
   - **Data Integrations** — imports into APIM via APIOps tooling or portal
   - **App Dev (you)** — builds the external Angular SPA (can generate TypeScript clients from the spec)

5. The external SPA is a separate Angular build targeting Azure Static Web App:
   - Calls APIM (not the App Service directly): `https://api{env}.scoular.com/{apimPathPrefix}/...`
   - Uses MSAL with a dedicated external SPA app registration
   - **Dev**: API scope is the app's own scope (`api://{API_CLIENT_ID}/{AppName}.Application.Dev`) — calls App Service directly
   - **QA/Prod**: API scope is the APIM scope from Data Integrations — calls APIM gateway
   - Same Entra ID tenant, managed device enforcement via Conditional Access

Do NOT expose the App Service to the internet. External access goes through APIM.

---

*Document version: 1.12 | 2026-04-30*
