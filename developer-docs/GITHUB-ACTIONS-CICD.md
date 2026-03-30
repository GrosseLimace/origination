# Origination - GitHub Actions CI/CD Guide

This guide covers the GitHub Actions CI/CD pipeline for the Origination application, deployed from `scoular.ghe.com/IT/origination`.

## Contents

- [Overview](#overview)
- [Self-Hosted Runners](#self-hosted-runners)
- [Workflow Configuration](#workflow-configuration)
- [Workload Identity Federation (Zero-Secret Auth)](#workload-identity-federation-zero-secret-auth)
- [Repository Secrets](#repository-secrets)
- [Environments and Deployment Approvals](#environments-and-deployment-approvals)
- [Azure Permissions (What Your Workflow Can Do)](#azure-permissions-what-your-workflow-can-do)
- [npm Registry Authentication (@it packages)](#npm-registry-authentication-it-packages)
- [Troubleshooting](#troubleshooting)
- [References](#references)
- [Mobile SWA Deployment](#mobile-swa-deployment)

## Overview

- **Repository**: `scoular.ghe.com/IT/origination`
- **Runners**: Self-hosted (corporate network)
- **Authentication**: OIDC via Workload Identity Federation (zero secrets)
- **Environments**: `dev` (auto), `qa` (approval), `prod` (approval)

---

## Self-Hosted Runners

All workflow jobs must use self-hosted runners:

```yaml
runs-on: self-hosted
```

**Key characteristics:**
- Runners are on the corporate network (direct access to internal resources: SQL servers, Key Vault, private endpoints)
- Pre-installed tools: .NET SDK, Node.js, Git, Azure CLI
- NOT GitHub-hosted runners (no per-minute billing, no internet egress restrictions)
- Do NOT use `runs-on: ubuntu-latest` or other GitHub-hosted labels

---

## Workflow Configuration

### OIDC Login Step

Every job that interacts with Azure must include the `id-token: write` permission and the Azure login step:

```yaml
jobs:
  deploy:
    runs-on: self-hosted
    environment: dev  # or qa, prod
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

**Subscription selection:**
- Dev and QA: `${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}`
- Prod: `${{ secrets.AZURE_SUBSCRIPTION_ID_PROD }}`

### Deploy Step

```yaml
      - name: Deploy to App Service
        uses: azure/webapps-deploy@v3
        with:
          app-name: app-origination-dev-eus  # or -qa-eus / -eus for prod
          package: ./publish
```

**App Service naming:**

| Environment | App Service Name |
|-------------|------------------|
| Dev | `app-origination-dev-eus` |
| QA | `app-origination-qa-eus` |
| Prod | `app-origination-eus` |

### EF Core Migrations (Optional)

If your workflow runs Entity Framework Core migrations, there are two parts: the **workflow step** and a required **design-time factory** in your C# code.

#### Workflow step

```yaml
      - name: Run EF Migrations
        run: |
          dotnet tool restore
          dotnet ef database update --project src/Application.Api
        env:
          ConnectionStrings__DefaultConnection: "Server=azrscosqld01.database.windows.net;Database=Origination;Authentication=Active Directory Default;TrustServerCertificate=True"
```

> **Important: `Active Directory Default` and self-hosted runners**
>
> The connection string uses `Authentication=Active Directory Default`, which internally uses
> `DefaultAzureCredential` from the Azure.Identity library. This credential type tries multiple
> authentication methods in order: Environment, Workload Identity, **Managed Identity**, then Azure CLI.
>
> The self-hosted runners have a **system-assigned managed identity** (from the VMSS). Because
> `DefaultAzureCredential` tries managed identity *before* Azure CLI, it will authenticate as the
> **runner's VMSS identity** -- not as the workflow's service principal set up by `azure/login`.
> The VMSS identity does not have database access, so the connection will fail with:
> `Login failed for user '<token-identified principal>'`.
>
> To fix this, your EF Core project must include a **design-time factory** that excludes managed
> identity from the credential chain. See the next section.

#### Design-time factory (required for CI/CD migrations)

Your EF Core infrastructure project needs an `IDesignTimeDbContextFactory` that acquires the
Azure AD token explicitly, skipping `ManagedIdentityCredential`. This factory is only used by
`dotnet ef` commands -- it does **not** affect runtime behavior on the App Service.

```csharp
using Azure.Core;
using Azure.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace YourApp.Infrastructure.Data;

/// <summary>
/// Design-time factory for EF Core migrations (used by dotnet ef commands).
/// Excludes ManagedIdentityCredential so self-hosted CI/CD runners authenticate
/// via Azure CLI (the service principal from azure/login) instead of the
/// runner VMSS managed identity.
/// </summary>
public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");

        if (string.IsNullOrEmpty(connectionString))
        {
            throw new InvalidOperationException(
                "Connection string not found. Set the 'ConnectionStrings__DefaultConnection' environment variable.");
        }

        // Remove the Authentication parameter -- we handle token acquisition ourselves
        // to control which credential is used.
        var builder = new SqlConnectionStringBuilder(connectionString);
        builder.Authentication = SqlAuthenticationMethod.NotSpecified;

        var connection = new SqlConnection(builder.ConnectionString);

        // Exclude ManagedIdentityCredential so the runner VMSS identity is not used.
        // This falls through to AzureCliCredential, which uses the SP from azure/login.
        var credential = new DefaultAzureCredential(new DefaultAzureCredentialOptions
        {
            ExcludeManagedIdentityCredential = true
        });

        var token = credential.GetToken(
            new TokenRequestContext(new[] { "https://database.windows.net/.default" }));
        connection.AccessToken = token.Token;

        var optionsBuilder = new DbContextOptionsBuilder<AppDbContext>();
        optionsBuilder.UseSqlServer(connection, sqlOptions =>
        {
            sqlOptions.EnableRetryOnFailure(
                maxRetryCount: 5,
                maxRetryDelay: TimeSpan.FromSeconds(30),
                errorNumbersToAdd: null);
            sqlOptions.CommandTimeout(60);
            sqlOptions.MigrationsHistoryTable("__EFMigrationsHistory", "dbo");
        });

        return new AppDbContext(optionsBuilder.Options);
    }
}
```

**Prerequisites:**
- Add `Azure.Identity` NuGet package to the infrastructure project (if not already referenced)
- Add a `.config/dotnet-tools.json` manifest with `dotnet-ef` in your backend project root:
  ```json
  {
    "version": 1,
    "isRoot": true,
    "tools": {
      "dotnet-ef": {
        "version": "10.0.2",
        "commands": ["dotnet-ef"]
      }
    }
  }
  ```

**What this does NOT affect:**
- **Runtime on App Service**: The App Service uses `Program.cs` DI configuration (not this factory). Its own managed identity authenticates correctly because it *is* the intended identity.
- **Local development**: Developers don't have IMDS on their machines, so managed identity is skipped anyway. `AzureCliCredential` picks up their `az login` session.

### Complete Workflow Example

```yaml
name: Deploy Origination

on:
  push:
    branches: [main]
    paths-ignore:
      - 'developer-docs/**'
      - 'style-guides/**'
      - '*.md'
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        type: choice
        options: [dev, qa, prod]

jobs:
  build:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Build and Publish
        run: dotnet publish src/Application.Api -c Release -o ./publish

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: app
          path: ./publish

  deploy-dev:
    needs: build
    runs-on: self-hosted
    environment: dev
    if: github.event_name == 'push' || github.event.inputs.environment == 'dev'
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Download artifact
        uses: actions/download-artifact@v4
        with:
          name: app
          path: ./publish

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}

      - name: Deploy to Dev
        uses: azure/webapps-deploy@v3
        with:
          app-name: app-origination-dev-eus
          package: ./publish

  deploy-qa:
    needs: deploy-dev
    runs-on: self-hosted
    environment: qa
    if: github.event_name == 'push' || github.event.inputs.environment == 'qa'
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Download artifact
        uses: actions/download-artifact@v4
        with:
          name: app
          path: ./publish

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}

      - name: Deploy to QA
        uses: azure/webapps-deploy@v3
        with:
          app-name: app-origination-qa-eus
          package: ./publish

  deploy-prod:
    needs: deploy-qa
    runs-on: self-hosted
    environment: prod
    if: github.event_name == 'push' || github.event.inputs.environment == 'prod'
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Download artifact
        uses: actions/download-artifact@v4
        with:
          name: app
          path: ./publish

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_PROD }}

      - name: Deploy to Prod
        uses: azure/webapps-deploy@v3
        with:
          app-name: app-origination-eus
          package: ./publish
```

---

## Workload Identity Federation (Zero-Secret Auth)

The pipeline authenticates to Azure using OIDC (OpenID Connect) tokens issued by GitHub Actions. No client secrets are stored or rotated.

```
GitHub Actions Runner
    |
    | (1) Request OIDC token from GHE
    v
GHE OIDC Provider (https://token.actions.scoular.ghe.com)
    |
    | (2) Signed JWT with subject claim
    v
Azure AD (Entra ID)
    |
    | (3) Validate token against federated credential
    v
"Origination - GitHub Actions" App Registration
    |
    | (4) Issue Azure access token
    v
Azure Resources (App Service, Resource Group, SQL)
```

**App Registration**: `Origination - GitHub Actions`
- Single registration shared across all environments
- Three federated credentials (one per environment)
- No client secret -- OIDC tokens only
- **OIDC Issuer**: `https://token.actions.scoular.ghe.com`

**Subject claims** (must match exactly):

| Environment | Subject Claim |
|-------------|---------------|
| Dev | `repo:IT/origination:environment:dev` |
| QA | `repo:IT/origination:environment:qa` |
| Prod | `repo:IT/origination:environment:prod` |

---

## Repository Secrets

These secrets are configured at the repository level by the infrastructure team. You do not need to create or manage them.

| Secret | Description |
|--------|-------------|
| `AZURE_CLIENT_ID` | Application (Client) ID of the "Origination - GitHub Actions" app registration |
| `AZURE_TENANT_ID` | Scoular tenant ID (`1521f999-f722-4a4f-9747-166f93e9b0d1`) |
| `AZURE_SUBSCRIPTION_ID_NONPROD` | Non-prod subscription (`9ae7649f-19b3-4bf0-b593-b51ce94b5ee5`) |
| `AZURE_SUBSCRIPTION_ID_PROD` | Production subscription (`53575e56-bade-48c9-a763-6964ecd3bf2f`) |

---

## Environments and Deployment Approvals

| Environment | Trigger | Approval Required | Subscription |
|-------------|---------|-------------------|--------------|
| `dev` | Automatic on push to `main` | No | Non-Prod |
| `qa` | After dev succeeds | Yes -- deployers group | Non-Prod |
| `prod` | After qa succeeds | Yes -- deployers group | Prod |

**How to approve a deployment:**
1. Navigate to the workflow run in the GHE repository
2. Click **"Review deployments"** on the pending environment
3. Select the environment and click **"Approve and deploy"**

**Manual dispatch**: Workflows can include `workflow_dispatch` with an environment input to deploy a specific environment on demand.

---

## Azure Permissions (What Your Workflow Can Do)

### RBAC Roles (per environment)

| Role | Scope | Purpose |
|------|-------|---------|
| Reader | Resource Group | View all resources, read configuration |
| Website Contributor | App Service | Deploy code, restart app, manage slots, view logs |
| Monitoring Contributor | Application Insights | Write deployment annotations |

**What this allows:**
- Deploy application code via `azure/webapps-deploy`
- Restart the App Service
- View resource configuration and deployment logs
- Write release annotations to Application Insights on each deployment

**What this does NOT allow:**
- Modify infrastructure (Bicep deployments, networking, Key Vault)
- Access Key Vault secrets directly
- Change App Service configuration/app settings
- Modify database server settings

### SQL Database Roles (per environment)

| Role | Database | Purpose |
|------|----------|---------|
| db_datareader | Origination | Read all tables |
| db_datawriter | Origination | Insert/update/delete rows |
| db_ddladmin | Origination | Create/alter/drop tables, indexes, views |

**SQL User**: `Origination - GitHub Actions`

**What this allows:**
- Run Entity Framework Core migrations
- Seed data
- Execute integration tests that read/write the database

**SQL Servers:**
| Environment | Server |
|-------------|--------|
| Dev | `azrscosqld01.database.windows.net` |
| QA | `azrscosqlq01.database.windows.net` |
| Prod | `azrscosqlp01.database.windows.net` |

---

## npm Registry Authentication (@it packages)

If your application consumes `@it` scoped npm packages (e.g., `@it/design-system`, `@it/angular-components`) from the GHE Packages registry, your workflow needs to authenticate before `npm ci`.

### Setup

1. **Commit an `.npmrc`** to your Angular/frontend project directory with scope routing:

```ini
@it:registry=https://npm.scoular.ghe.com/
```

2. **Add a workflow step** before `npm ci` to inject the `GITHUB_TOKEN`:

```yaml
    - name: Authenticate to GHE npm registry
      shell: pwsh
      working-directory: ./your-frontend-directory
      run: |
        Add-Content -Path .npmrc -Value "//npm.scoular.ghe.com/:_authToken=$($env:GITHUB_TOKEN)"
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

    - name: Install dependencies
      working-directory: ./your-frontend-directory
      run: npm ci
```

The `GITHUB_TOKEN` is auto-generated per workflow run — no PAT creation, rotation, or repo secrets required. The token injection only exists for the duration of the job and is never committed.

> **Requirement**: Both the consuming repo and the npm package source must be in the **IT** organization on `scoular.ghe.com`. For cross-org scenarios, use a classic PAT stored as a repository secret.

For full details on the GHE npm registry (publishing, consuming, troubleshooting), see the [npm Packages Guide](style-guides/npm-packages-guide.md).

---

## Troubleshooting

### "AADSTS700024: Client assertion is not within its valid time range"
The runner's system clock is out of sync. Contact the infrastructure team to check NTP on the self-hosted runner.

### "AADSTS70021: No matching federated identity record found"
The `environment` in your workflow job must match exactly: `dev`, `qa`, or `prod` (case-sensitive). Verify the job has `environment: dev` (not `environment: Dev` or `environment: development`).

### "ForbiddenError" on deploy
The workflow identity does not have `Website Contributor` on the target App Service. Contact the infrastructure team to verify RBAC assignments.

### Azure login succeeds but operations fail with wrong subscription
Verify you are using the correct subscription secret:
- Dev/QA: `AZURE_SUBSCRIPTION_ID_NONPROD`
- Prod: `AZURE_SUBSCRIPTION_ID_PROD`

### SQL connection fails with "Login failed for user '&lt;token-identified principal&gt;'"
This means a token was obtained but SQL Server could not map it to a database user. On self-hosted runners, this almost always means `DefaultAzureCredential` used the **runner VMSS managed identity** instead of the workflow service principal. See [EF Core Migrations](#ef-core-migrations-optional) for the required design-time factory that excludes managed identity from the credential chain.

### SQL connection fails with "Login failed" (other)
- Verify the SQL user `Origination - GitHub Actions` exists on the target database
- Ensure you are using `Authentication=Active Directory Default` (not SQL auth)
- Check that the Azure login step completed successfully before the SQL step

---

## References

- [APP-REGISTRATIONS.md](APP-REGISTRATIONS.md) -- Full app registration details including the GitHub Actions registration
- [START-HERE.md](START-HERE.md) -- Infrastructure overview and getting started
- [Microsoft: Workload Identity Federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation)
- [azure/login action](https://github.com/azure/login)
- [azure/webapps-deploy action](https://github.com/azure/webapps-deploy)

---

## Mobile SWA Deployment

If this application has a mobile SPA, it deploys to Azure Static Web App via a separate workflow or job.

### SWA Resource Names

| Environment | Static Web App | Custom Domain |
|-------------|---------------|---------------|
| Dev | `swa-origination-dev-eus` | `m-origination-dev.scoular.com` |
| QA | `swa-origination-qa-eus` | `m-origination-qa.scoular.com` |
| Prod | `swa-origination-eus` | `m-origination.scoular.com` |

### Sample SWA Deploy Workflow

```yaml
  deploy-mobile-swa:
    runs-on: self-hosted
    environment: dev
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}

      - name: Build Mobile SPA
        run: |
          cd mobile
          npm ci
          npm run build -- --configuration=dev

      - name: Deploy to Static Web App
        uses: azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.SWA_DEPLOYMENT_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: 'upload'
          app_location: 'mobile/dist/browser'
          skip_api_build: true
          skip_app_build: true
```

**Note:** The SWA deployment token can be retrieved from the Azure portal or via CLI: `az staticwebapp secrets list --name swa-origination-dev-eus --query "properties.apiKey" -o tsv`. Store it as a GHE environment secret named `SWA_DEPLOYMENT_TOKEN`.

---

*Document version: 1.2 | 2026-03-26*
