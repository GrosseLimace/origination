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

Use SPA Client ID for `clientId` and API Client ID for scopes (see table above).

**Front-Channel Logout URL**: The SPA app registration's front-channel logout URL is configured to the environment's base URL (e.g., `https://origination-dev.scoular.com`). This enables single sign-out. Use the same URL as `postLogoutRedirectUri` in MSAL.

**Angular build output** (`angular.json` under `architect > build > options`):
```json
"outputPath": {
    "base": "../backend/src/Application.Api/wwwroot",
    "browser": ""
}
```

Add `fileReplacements` under `configurations` for each deployed environment to swap environment files at build time.

**App bootstrap** (`main.ts` for standalone Angular apps):
```typescript
import { MsalGuard, MsalInterceptor, MsalBroadcastService, MsalService, MsalRedirectComponent, MSAL_GUARD_CONFIG, MSAL_INSTANCE, MSAL_INTERCEPTOR_CONFIG } from '@azure/msal-angular';
import { PublicClientApplication, InteractionType, BrowserCacheLocation } from '@azure/msal-browser';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { APP_INITIALIZER } from '@angular/core';

// Create MSAL instance before bootstrap so APP_INITIALIZER can reference it
const msalInstance = new PublicClientApplication({
  auth: {
    ...environment.msalConfig.auth,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    // SessionStorage: tokens cleared on tab close, tab-isolated (not shared across tabs)
    cacheLocation: BrowserCacheLocation.SessionStorage,
  }
});

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    { provide: MSAL_INSTANCE, useValue: msalInstance },
    {
      // Initialize MSAL and process any returning redirect BEFORE the app renders.
      // This prevents the brief flash of unauthenticated content.
      provide: APP_INITIALIZER,
      useFactory: (msalService: MsalService) => () => msalService.instance.initialize(),
      deps: [MsalService],
      multi: true
    },
    {
      provide: MSAL_GUARD_CONFIG,
      useValue: {
        interactionType: InteractionType.Redirect,
        authRequest: { scopes: environment.apiConfig.scopes }
      }
    },
    {
      provide: MSAL_INTERCEPTOR_CONFIG,
      useValue: {
        interactionType: InteractionType.Redirect,
        protectedResourceMap: new Map([
          [environment.apiConfig.uri, environment.apiConfig.scopes]
        ])
      }
    },
    { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
    MsalService,
    MsalGuard,
    MsalBroadcastService
  ]
});
```

**Route configuration** - use `MsalGuard` on routes and `MsalRedirectComponent` for auth callback:
```typescript
import { MsalRedirectComponent } from '@azure/msal-angular';

export const routes: Routes = [
  // MsalRedirectComponent processes the auth redirect before the app renders.
  // Without this, the app briefly flashes unauthenticated content.
  { path: 'auth', component: MsalRedirectComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [MsalGuard] }
];
```

**Root component** - subscribe to MSAL events (redirect is handled by `MsalRedirectComponent`):
```typescript
export class AppComponent implements OnInit {
  constructor(private msalService: MsalService) {}
  ngOnInit(): void {
    this.msalService.handleRedirectObservable().subscribe();
  }
}
```

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
    builder.Configuration.AddAzureKeyVault(new Uri(keyVaultUrl), new DefaultAzureCredential());
}
// Access secrets via Configuration["secret-name"]
```

**Store**: API keys, client secrets, encryption keys. **Don't store**: non-sensitive config.

## Application Insights

Auto-configured. Just use `ILogger`:

```csharp
public class MyService(ILogger<MyService> logger)
{
    public void DoWork() => logger.LogInformation("Processing started");
}
```

**Don't log**: passwords, tokens, PII, connection strings.

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
    uses: azure/login@v2
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

**Subscription selection:** Use `AZURE_SUBSCRIPTION_ID_NONPROD` for dev/qa, `AZURE_SUBSCRIPTION_ID_PROD` for prod.

**SQL migrations:** The workflow identity has db_datareader, db_datawriter, db_ddladmin on Origination.
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

*Document version: 1.2 | 2026-03-12*
