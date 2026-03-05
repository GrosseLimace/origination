# Origination - Azure Infrastructure Context
**For Claude Code**

## Critical Constraint: No Internet Access

The App Service **cannot** access the public internet. Outbound traffic is restricted to:
- Private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- Azure services (Storage, Sql, KeyVault, AzureActiveDirectory, AzureMonitor)

**When writing code**: Cannot call external APIs, download from internet, or use external auth providers. Suggest Azure services or internal alternatives.

---

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

---

## Authentication (.NET API)

```csharp
// Program.cs - AzureAd settings come from App Settings automatically
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));
```

**appsettings.json** - only this is needed:
```json
{ "AzureAd": { "Instance": "https://login.microsoftonline.com/" } }
```

**App Registration Client IDs**:
| Environment | API (Backend) | SPA (Angular) |
|-------------|---------------|---------------|
| Dev | `00078a10-3f3f-4d17-9350-fe90401125ae` | `e0f25943-ae8b-4c2d-8060-c9ffbd448aff` |
| QA | `f3fcab2b-98c8-4622-86bd-c874d281b22a` | `c2bb1208-063d-43aa-bad0-6b51d21437b4` |
| Prod | `e1458bcd-7212-4ea0-a836-7e08d03b5bbf` | `958fd665-daa3-42c5-9903-3c9c00638bf1` |

**Angular MSAL config** uses SPA Client ID for `clientId` and API Client ID for scopes:
```typescript
// environment.ts
msalConfig: { auth: { clientId: '<SPA_CLIENT_ID>' } },
apiConfig: { scopes: ['api://<API_CLIENT_ID>/Origination.Application.Dev'] }
```

---

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
  "KeyVaultUri": "https://kv-origination-dev-eus.vault.azure.net/"
}
```

**SQL connection locally**: Use same connection string - `DefaultAzureCredential` authenticates via Azure CLI or Visual Studio credentials.

**Angular localhost**: `http://localhost:4200` is pre-configured as a redirect URI in the Dev SPA app registration.

**Authenticate to Azure first**:
```bash
az login --tenant 1521f999-f722-4a4f-9747-166f93e9b0d1
```

---

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

---

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

---

## Application Insights

Auto-configured. Just use `ILogger`:

```csharp
public class MyService(ILogger<MyService> logger)
{
    public void DoWork() => logger.LogInformation("Processing started");
}
```

**Don't log**: passwords, tokens, PII, connection strings.

---

## Security Rules

1. **Use managed identity** for Azure services (SQL, Storage, Key Vault)
2. **Use Key Vault** for secrets, not appsettings.json
3. **Parameterized queries only** - never concatenate SQL
4. **Encode output** - use Razor's default encoding, avoid `Html.Raw`
5. **Implement retry logic** for Azure service calls

---

## Resource Naming

| Resource | Dev | QA | Prod |
|----------|-----|----|----|
| App Service | `app-origination-dev-eus` | `app-origination-qa-eus` | `app-origination-eus` |
| Key Vault | `kv-origination-dev-eus` | `kv-origination-qa-eus` | `kv-origination-eus` |
| Custom Domain | `origination-dev.scoular.com` | `origination-qa.scoular.com` | `origination.scoular.com` |
| SQL Server | `azrscosqld01` | `azrscosqlq01` | `azrscosqlp01` |
| Database | `Origination` | `Origination` | `Origination` |

---

## Summary

- **No internet** - use Azure services or internal APIs only
- **Settings pre-configured** - AzureAd, KeyVault, AppInsights, SQL connection
- **Managed identity** - no credentials in code
- **Key Vault for secrets** - access via Configuration
- **Security first** - parameterized queries, encode output, no hardcoded secrets
