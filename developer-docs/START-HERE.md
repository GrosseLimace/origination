# Origination - Start Here

This is your starting point for understanding the Azure infrastructure behind Origination. All resources described here are provisioned and managed by the infrastructure team through a standard app template system.

## Contents

- [Related Documentation](#related-documentation)
- [What You Get](#what-you-get)
- [URLs and Endpoints](#urls-and-endpoints)
- [Environment Variables](#environment-variables)
- [Authentication](#authentication)
- [SQL Database Access](#sql-database-access)
- [Key Vault](#key-vault)
- [Deployment](#deployment)
- [Quick Start Checklist](#quick-start-checklist)

## Related Documentation

| Document | What It Covers |
|----------|---------------|
| [CLAUDE.md](CLAUDE.md) | Full Azure infrastructure context for Claude Code (auto-read) |
| [APP-REGISTRATIONS.md](APP-REGISTRATIONS.md) | App registration client IDs, scopes, redirect URIs, MSAL setup |
| [ENTRA-ID-GROUPS-GUIDE.md](ENTRA-ID-GROUPS-GUIDE.md) | Entra ID groups, Azure RBAC roles, SQL permission groups |
| [ACCESS-PACKAGES-USER-GUIDE.md](ACCESS-PACKAGES-USER-GUIDE.md) | How to request access via My Access portal |
| [ACCESS-PACKAGES-APPROVER-GUIDE.md](ACCESS-PACKAGES-APPROVER-GUIDE.md) | How to approve access requests and manage assignments |
| [GITHUB-ACTIONS-CICD.md](GITHUB-ACTIONS-CICD.md) | CI/CD pipeline setup, OIDC authentication, deployment workflows |
| [deploy-workflow.yml.sample](deploy-workflow.yml.sample) | Sample GitHub Actions workflow ready to customize |
| [EXTERNAL-SPA-GUIDE.md](EXTERNAL-SPA-GUIDE.md) | External SPA architecture (Static Web App + APIM) |
| [CUSTOM-DOMAINS.md](../CUSTOM-DOMAINS.md) | Custom domain and SSL certificate configuration |

## What You Get

Your Origination application runs on fully managed Azure infrastructure with private networking, automated SSL certificates, and enterprise security.

### Compute and Hosting
- **App Service** (Linux, .NET 10.0, 64-bit, always-on)
  - Dev/QA: Shared P2v4 App Service Plan (2 vCores, 8 GB RAM, shared across multiple apps)
  - Prod: P1v4 (dedicated App Service Plan)

### Data and Storage
- **SQL Database** (Azure SQL, managed identity authentication)
  - Dev/QA: Serverless, 0.5-2 vCores, auto-pause 60 min
  - Prod: Hyperscale Serverless, 0.5-2 vCores, no auto-pause
- **Key Vault** — Secure storage for secrets with RBAC-based access, private endpoint, and audit logging

### Networking
- **Private Endpoints** for App Service, Key Vault, and SQL
- **VNet Integration** for outbound traffic
- **Private DNS Resolver** (`10.102.1.10`) for private endpoint name resolution
- **Dev environments** are always private-only regardless of app configuration

### Monitoring
- **Application Insights** — Performance monitoring, exception tracking, SQL query tracking
- **Smart Detection** — Automatic Failure Anomalies alerting (action group per app, configurable by dev team)

### Security
- **Managed Identity** — No passwords for Azure service access
- **Entra ID Authentication** — Single sign-on with Scoular accounts
- **TLS 1.2+** — All connections encrypted
- **Automated SSL** — Let's Encrypt certificates auto-renewed monthly

### Custom Domains

| Environment | URL |
|-------------|-----|
| Dev | `https://origination-dev.scoular.com` |
| QA | `https://origination-qa.scoular.com` |
| Prod | `https://origination.scoular.com` |

## URLs and Endpoints

| Environment | Application URL | Default Azure URL |
|-------------|----------------|-------------------|
| Dev | https://origination-dev.scoular.com | app-origination-dev-eus.azurewebsites.net |
| QA | https://origination-qa.scoular.com | app-origination-qa-eus.azurewebsites.net |
| Prod | https://origination.scoular.com | app-origination-eus.azurewebsites.net |

### External SPA (if enabled)

| Environment | External SPA URL (testing) | External SPA URL (public) | SWA Resource |
|-------------|--------------------------|--------------------------|--------------|
| Dev | `https://ext-origination-dev.scoular.com` | *(dev is internal only)* | `swa-origination-dev-eus` |
| QA | `https://ext-origination-qa.scoular.com` | `https://origination-qa.scoular.com` | `swa-origination-qa-eus` |
| Prod | `https://ext-origination.scoular.com` | `https://origination.scoular.com` | `swa-origination-eus` |

External SPA Client IDs are in [APP-REGISTRATIONS.md](APP-REGISTRATIONS.md).

## Environment Variables

Your App Service is pre-configured with these variables (do not add them manually):

| Variable | Dev | QA | Prod |
|----------|-----|-----|------|
| `ASPNETCORE_ENVIRONMENT` | Dev | QA | *(not set)* |
| `KeyVaultUri` | https://kv-orig-dev-eus.vault.azure.net/ | https://kv-orig-qa-eus.vault.azure.net/ | https://kv-orig-eus.vault.azure.net/ |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | *(auto-configured)* | *(auto-configured)* | *(auto-configured)* |
| `AzureAd__TenantId` | `1521f999-f722-4a4f-9747-166f93e9b0d1` | `1521f999-f722-4a4f-9747-166f93e9b0d1` | `1521f999-f722-4a4f-9747-166f93e9b0d1` |
| `AzureAd__ClientId` | `00078a10-3f3f-4d17-9350-fe90401125ae` | `f3fcab2b-98c8-4622-86bd-c874d281b22a` | `e1458bcd-7212-4ea0-a836-7e08d03b5bbf` |
| `AzureAd__Audience` | `api://00078a10-3f3f-4d17-9350-fe90401125ae` | `api://f3fcab2b-98c8-4622-86bd-c874d281b22a` | `api://e1458bcd-7212-4ea0-a836-7e08d03b5bbf` |

See [APP-REGISTRATIONS.md](APP-REGISTRATIONS.md) for the specific Client IDs per environment.

## Authentication

- **API (Backend)**: Entra ID via `Microsoft.Identity.Web`. Tenant: `1521f999-f722-4a4f-9747-166f93e9b0d1`
- **SPA (Frontend)**: MSAL with redirect to custom domain
- **Scopes**:
  - Dev: `api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev`
  - QA: `api://f3fcab2b-98c8-4622-86bd-c874d281b22a/Origination.Application.QA`
  - Prod: `api://e1458bcd-7212-4ea0-a836-7e08d03b5bbf/Origination.Application.Prod`
- **App Roles**: JWT access tokens include a `roles` claim (e.g., `Admin` or `User`) based on group membership. Use `[Authorize(Roles = "Admin")]` in .NET to enforce role-based access. See [ENTRA-ID-GROUPS-GUIDE.md](ENTRA-ID-GROUPS-GUIDE.md) for group-to-role mapping details.

See [APP-REGISTRATIONS.md](APP-REGISTRATIONS.md) for SPA client IDs, redirect URIs, and MSAL configuration examples.

## SQL Database Access

### Application Runtime
- Uses App Service **Managed Identity** (automatic, no password)
- Connection string `DefaultConnection` is pre-configured with `Authentication=Active Directory Default`
- Traffic routes through private endpoint (never public internet)

```csharp
var connectionString = Configuration.GetConnectionString("DefaultConnection");
```

### Developer Access
Request the **Developer Access** package at [myaccess.microsoft.com](https://myaccess.microsoft.com) to get SQL permission group memberships for Dev/QA. Connect with Azure AD authentication using Azure Data Studio, SSMS, or VS Code.

| Environment | Server |
|-------------|--------|
| Dev | `azrscosqld01.database.windows.net` |
| QA | `azrscosqlq01.database.windows.net` |
| Prod | `azrscosqlp01.database.windows.net` |

Database name: `Origination` (all environments)

See [ENTRA-ID-GROUPS-GUIDE.md](ENTRA-ID-GROUPS-GUIDE.md) for SQL permission group details.

## Key Vault

Retrieved via environment variable `KeyVaultUri`. Your app's managed identity has read access automatically.

```csharp
var keyVaultUrl = builder.Configuration["KeyVaultUri"];
builder.Configuration.AddAzureKeyVault(new Uri(keyVaultUrl), new DefaultAzureCredential());
// Access secrets via Configuration["secret-name"]
```

| Environment | Key Vault |
|-------------|-----------|
| Dev | `kv-orig-dev-eus` |
| QA | `kv-orig-qa-eus` |
| Prod | `kv-orig-eus` |

## Deployment

Deployments use **GitHub Actions** with OIDC authentication (zero secrets). See [GITHUB-ACTIONS-CICD.md](GITHUB-ACTIONS-CICD.md) for full pipeline setup, or start with the [deploy-workflow.yml.sample](deploy-workflow.yml.sample).

| Environment | Trigger | Approval | App Service |
|-------------|---------|----------|-------------|
| Dev | Push to `main` | Automatic | `app-origination-dev-eus` |
| QA | After dev succeeds | Required | `app-origination-qa-eus` |
| Prod | After QA succeeds | Required | `app-origination-eus` |

## Quick Start Checklist

For new developers joining the Origination team:

1. Request the **Developer Access** package at [myaccess.microsoft.com](https://myaccess.microsoft.com) (search "Origination")
2. Wait 15-30 minutes for group membership to propagate
3. Review [APP-REGISTRATIONS.md](APP-REGISTRATIONS.md) for client IDs and MSAL setup
4. Configure local development (`appsettings.Development.json` with Dev client IDs)
5. Run `az login --tenant 1521f999-f722-4a4f-9747-166f93e9b0d1` for local Azure auth
6. Test connection to Dev environment at `https://origination-dev.scoular.com`

---

*Document version: 1.7 | 2026-04-01*
