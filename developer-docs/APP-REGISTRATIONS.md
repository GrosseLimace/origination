# Origination App Registrations

This document contains the configuration details for the Origination application Entra ID (Azure AD) app registrations across all environments.

## Contents

- [Overview](#overview)
- [Authentication Architecture](#authentication-architecture)
- [Dev Environment](#dev-environment)
- [QA Environment](#qa-environment)
- [Production Environment](#production-environment)
- [External SPA (if external app enabled)](#external-spa-if-external-app-enabled)
- [Application Configuration](#application-configuration)
- [Access Management](#access-management)
- [Client Secret Management](#client-secret-management)
- [Enterprise Applications](#enterprise-applications)
- [GitHub Actions (Workload Identity)](#github-actions-workload-identity)
- [App Roles (v2.14)](#app-roles-v214)
- [Troubleshooting](#troubleshooting)
- [References](#references)

## Overview

Two app registration types handle user authentication for Origination:

1. **Origination API** - Backend Web API that validates JWT tokens and exposes API scopes
2. **Origination** - Frontend SPA (Single Page Application) that authenticates users via MSAL

A third registration, **Origination - GitHub Actions**, handles CI/CD pipeline identity and is documented in [GitHub Actions (Workload Identity)](#github-actions-workload-identity) below.

## Authentication Architecture

```
User -> Origination SPA (Angular) -> Origination API (.NET Web API)
         |                               |
    MSAL Authentication            JWT Token Validation
    (Redirect URIs needed)         (No redirect URIs)
```

**Authentication Flow:**
1. User navigates to the SPA
2. SPA uses MSAL to redirect user to Azure AD for authentication
3. Azure AD redirects back to the SPA's redirect URI with tokens
4. SPA obtains an access token with the API's scope
5. SPA calls the API with the token in the `Authorization: Bearer` header
6. API validates the token using `AddMicrosoftIdentityWebApi` middleware

**Key Points:**
- Only the **SPA** needs redirect URIs (it handles user authentication)
- The **API** does not need redirect URIs (it only validates incoming tokens)
- The API Enterprise App is hidden from users in the My Apps portal
- **Redirect URIs must be the site origin** (e.g., `https://origination-dev.scoular.com`), not a dedicated `/auth` route. The Angular `provideAppInitializer` described in `developer-docs/CLAUDE.md` handles the returning `#code=...` hash at any path, so you do not need a separate auth-callback route component in your app

## Dev Environment

### Origination API - Dev

**App Registration Details:**
- **Display Name**: `Origination API - Dev`
- **Application (Client) ID**: `00078a10-3f3f-4d17-9350-fe90401125ae`
- **Tenant ID**: `1521f999-f722-4a4f-9747-166f93e9b0d1` (scoular.com)

**Client Secret:**
- **Stored in Key Vault**: `kv-orig-dev-eus`
- **Secret Name**: `OriginationAPI-ClientSecret`
- **Retrieve with**: `Get-AzKeyVaultSecret -VaultName 'kv-orig-dev-eus' -Name 'OriginationAPI-ClientSecret' -AsPlainText`

**API Scope:**
- **Scope Name**: `Origination.Application.Dev`
- **Scope URI**: `api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev`

**Configuration:**
- **Token Configuration**: Access tokens version 2
- **Supported Account Types**: Single tenant (Accounts in this organizational directory only)

**Enterprise App:**
- **Visible to users**: No (hidden from My Apps portal)
- **Assignment required**: Yes

**App Roles:** Admin, User, and Origination.Application (see [App Roles (v2.14)](#app-roles-v214) for details)

**Access Groups:**
- `Origination App Dev Users` - End users for Dev environment (assigned **User** role)
- `Azure - Origination App - Developer Admins` - Admins with infrastructure access (assigned **Admin** role)

### Origination - Dev (SPA)

**App Registration Details:**
- **Display Name**: `Origination - Dev`
- **Application (Client) ID**: `e0f25943-ae8b-4c2d-8060-c9ffbd448aff`
- **Tenant ID**: `1521f999-f722-4a4f-9747-166f93e9b0d1` (scoular.com)

**Redirect URIs:**

| URI | Purpose |
|-----|---------|
| `https://origination-dev.scoular.com` | Custom domain |
| `http://localhost:4200` | Local development |
| `http://localhost:4201` | Local development |
| `http://localhost:4202` | Local development |

**Front-Channel Logout URL:** `https://origination-dev.scoular.com`

**Configuration:**
- **Platform**: Single-page application (SPA)
- **Token Configuration**: Access tokens and ID tokens enabled
- **Supported Account Types**: Single tenant (Accounts in this organizational directory only)

**Enterprise App:**
- **Visible to users**: Yes (appears in My Apps portal)
- **Assignment required**: Yes

**API Permissions:**
- **Origination API**: `Origination.Application.Dev` (Delegated)
- **Microsoft Graph**: `User.Read` (Delegated)

**Access Groups:**
- `Origination App Dev Users` - End users for Dev environment
- `Azure - Origination App - Developer Admins` - Admins with infrastructure access

## QA Environment

### Origination API - QA

**App Registration Details:**
- **Display Name**: `Origination API - QA`
- **Application (Client) ID**: `f3fcab2b-98c8-4622-86bd-c874d281b22a`
- **Tenant ID**: `1521f999-f722-4a4f-9747-166f93e9b0d1` (scoular.com)

**API Scope:**
- **Scope URI**: `api://f3fcab2b-98c8-4622-86bd-c874d281b22a/Origination.Application.QA`

**Configuration:**
- **Token Configuration**: Access tokens version 2
- **Supported Account Types**: Single tenant (Accounts in this organizational directory only)

**Enterprise App:**
- **Visible to users**: No (hidden from My Apps portal)
- **Assignment required**: Yes

**App Roles:** Admin, User, and Origination.Application (see [App Roles (v2.14)](#app-roles-v214) for details)

**Access Groups:**
- `Origination App QA Users` - End users for QA environment (assigned **User** role)
- `Azure - Origination App - Developer Admins` - Admins with infrastructure access (assigned **Admin** role)

### Origination - QA (SPA)

**App Registration Details:**
- **Display Name**: `Origination - QA`
- **Application (Client) ID**: `c2bb1208-063d-43aa-bad0-6b51d21437b4`
- **Tenant ID**: `1521f999-f722-4a4f-9747-166f93e9b0d1` (scoular.com)

**Redirect URIs:**

| URI | Purpose |
|-----|---------|
| `https://origination-qa.scoular.com` | Custom domain |

**Front-Channel Logout URL:** `https://origination-qa.scoular.com`

**Configuration:**
- **Platform**: Single-page application (SPA)
- **Token Configuration**: Access tokens and ID tokens enabled
- **Supported Account Types**: Single tenant (Accounts in this organizational directory only)

**Enterprise App:**
- **Visible to users**: Yes (appears in My Apps portal)
- **Assignment required**: Yes

**API Permissions:**
- **Origination API**: `Origination.Application.QA` (Delegated)
- **Microsoft Graph**: `User.Read` (Delegated)

**Access Groups:**
- `Origination App QA Users` - End users for QA environment
- `Azure - Origination App - Developer Admins` - Admins with infrastructure access

## Production Environment

### Origination API (Production)

**App Registration Details:**
- **Display Name**: `Origination API`
- **Application (Client) ID**: `e1458bcd-7212-4ea0-a836-7e08d03b5bbf`
- **Tenant ID**: `1521f999-f722-4a4f-9747-166f93e9b0d1` (scoular.com)

**API Scope:**
- **Scope URI**: `api://e1458bcd-7212-4ea0-a836-7e08d03b5bbf/Origination.Application.Prod`

**Configuration:**
- **Token Configuration**: Access tokens version 2
- **Supported Account Types**: Single tenant (Accounts in this organizational directory only)

**Enterprise App:**
- **Visible to users**: No (hidden from My Apps portal)
- **Assignment required**: Yes

**App Roles:** Admin, User, and Origination.Application (see [App Roles (v2.14)](#app-roles-v214) for details)

**Access Groups:**
- `Origination App Users` - End users for Production environment (assigned **User** role)
- `Azure - Origination App - Production Support` - Admins with infrastructure access (assigned **Admin** role)

### Origination (Production SPA)

**App Registration Details:**
- **Display Name**: `Origination`
- **Application (Client) ID**: `958fd665-daa3-42c5-9903-3c9c00638bf1`
- **Tenant ID**: `1521f999-f722-4a4f-9747-166f93e9b0d1` (scoular.com)

**Redirect URIs:**

| URI | Purpose |
|-----|---------|
| `https://origination.scoular.com` | Custom domain |

**Front-Channel Logout URL:** `https://origination.scoular.com`

**Configuration:**
- **Platform**: Single-page application (SPA)
- **Token Configuration**: Access tokens and ID tokens enabled
- **Supported Account Types**: Single tenant (Accounts in this organizational directory only)

**Enterprise App:**
- **Visible to users**: Yes (appears in My Apps portal)
- **Assignment required**: Yes

**API Permissions:**
- **Origination API**: `Origination.Application.Prod` (Delegated)
- **Microsoft Graph**: `User.Read` (Delegated)

**Access Groups:**
- `Origination App Users` - End users for Production environment
- `Azure - Origination App - Production Support` - Admins with infrastructure access

### External SPA (if external app enabled)

When `externalApp.enabled` is true, the **existing SPA app registration** is used for both the desktop and external Angular apps. No separate external app registration is created.

**Dev environment:** The SPA redirect URIs include the external SWA domain (`https://ext-origination-dev.scoular.com`) in addition to the standard desktop domain.

**QA/Prod:** The external SWA uses the same custom domain as the App Service (split-horizon DNS), so the existing SPA redirect URI works for both desktop and external.

## Application Configuration

### App Service App Settings

The following AzureAd settings are automatically deployed to the App Service and can be used by your .NET Web API without hardcoding values in appsettings.json:

| App Setting | Description | Example Value |
|-------------|-------------|---------------|
| `AzureAd__TenantId` | Scoular tenant ID | `1521f999-f722-4a4f-9747-166f93e9b0d1` |
| `AzureAd__ClientId` | API app registration Client ID | `00078a10-3f3f-4d17-9350-fe90401125ae` |
| `AzureAd__Audience` | API audience URI | `api://00078a10-3f3f-4d17-9350-fe90401125ae` |

These settings use the `__` (double underscore) notation which .NET automatically maps to nested configuration (e.g., `AzureAd__ClientId` becomes `AzureAd:ClientId`).

**Benefits of using App Service settings:**
- Same build artifact can deploy to any environment
- No secrets in source control
- Values can be changed without redeploying code

### .NET Web API Configuration (appsettings.json)

If you prefer to use appsettings.json (for local development or as fallback), the settings below will be overridden by App Service app settings when deployed:

```json
{
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "1521f999-f722-4a4f-9747-166f93e9b0d1",
    "ClientId": "00078a10-3f3f-4d17-9350-fe90401125ae",      // Available as AzureAd__ClientId app setting
    "Audience": "api://00078a10-3f3f-4d17-9350-fe90401125ae" // Available as AzureAd__Audience app setting
  }
}
```

### Angular SPA Configuration

**Local development** (`environment.ts` - absolute URL to local .NET API):
```typescript
export const environment = {
  production: false,
  apiUrl: 'https://localhost:5001/api/v1',
  msalConfig: {
    auth: {
      clientId: 'e0f25943-ae8b-4c2d-8060-c9ffbd448aff',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'http://localhost:4200',
    }
  },
  apiConfig: {
    scopes: ['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev'],
    uri: 'https://localhost:5001/api/v1'
  }
};
```

**Deployed environments** (`environment.dev.ts` / `environment.qa.ts` / `environment.prod.ts` - relative URL, same origin):
```typescript
export const environment = {
  production: true,
  apiUrl: '/api/v1',
  msalConfig: {
    auth: {
      clientId: '<SPA_CLIENT_ID>',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'https://origination-dev.scoular.com', // or -qa / no suffix for prod
    }
  },
  apiConfig: {
    scopes: ['api://<API_CLIENT_ID>/Origination.Application.Dev'], // .QA or .Prod for other envs
    uri: '/api/v1'
  }
};
```

Use SPA Client ID for `clientId` and API Client ID for scopes (see tables above).

## Access Management

Group membership is managed through **Access Packages** (recommended) or by the infrastructure team.

- **Dev/QA access**: Request the **Origination - Developer Azure Access** package at [myaccess.microsoft.com](https://myaccess.microsoft.com)
- **Production access**: Request the **Origination - Azure Production Support** package
- **End user access**: Developers with the Developer Access package can manage Dev/QA user groups directly at [Groups I Own](https://myaccount.microsoft.com/groups/groups-i-own)

See [ACCESS-PACKAGES-USER-GUIDE.md](ACCESS-PACKAGES-USER-GUIDE.md) for detailed instructions.

## Managed Identity — Microsoft Graph (Usage Dashboard user filter)

The Usage Dashboard limits its user list to members of the per-environment **app-access group**
(below). An hourly background job enumerates that group's members via **Microsoft Graph** —
authenticating as the API App Service's **system-assigned managed identity** — caches them, and the
dashboard intersects its user list with that cached set. This requires a one-time grant per environment:

- **Graph application permissions:** `GroupMember.Read.All` **and** `User.Read.All` (admin consent), granted to each App Service's managed identity (`app-origination-dev-eus` / `-qa-eus` / `-eus`).
- **Configured group** (`UsageDashboard:AppAccessGroupObjectId` in `appsettings.<Env>.json`):

  | Env | Group | Object ID |
  |-----|-------|-----------|
  | Dev | Origination App Dev Users | `0e4dd29c-b23c-4e11-a2a3-13e1be934c2b` |
  | QA | Origination App QA Users | `8f0e0182-661e-4396-bda3-9fa43217f258` |
  | Prod | Origination App Users | `0cb70d50-df9d-4a98-8385-65112e4a7f50` |

**Fail-open:** if the grant is missing, Graph is unreachable, or the group id is blank, the job logs
a warning and the dashboard shows **all entitlements users** (no filter) — so deploying the code
before the grant is safe; the filter simply activates once the permission is in place. Grant example:

```powershell
# Grant the App Service managed identity Graph app permissions (run per environment).
$mi = Get-MgServicePrincipal -Filter "displayName eq 'app-origination-dev-eus'"
$graph = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
foreach ($perm in 'GroupMember.Read.All','User.Read.All') {
    $role = $graph.AppRoles | Where-Object { $_.Value -eq $perm }
    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $mi.Id `
        -PrincipalId $mi.Id -ResourceId $graph.Id -AppRoleId $role.Id
}
```

## Client Secret Management

### Retrieving the Client Secret

```powershell
# Connect to Azure (if not already connected)
Connect-AzAccount -TenantId '1521f999-f722-4a4f-9747-166f93e9b0d1' -SubscriptionId '9ae7649f-19b3-4bf0-b593-b51ce94b5ee5'

# Get the secret from Key Vault
$secret = Get-AzKeyVaultSecret -VaultName 'kv-orig-dev-eus' -Name 'OriginationAPI-ClientSecret' -AsPlainText
Write-Host "Client Secret: $secret"
```

### Secret Lifecycle (Automated)

Client secrets are managed automatically by the infrastructure deployment system:

- **Expiry:** 6 months (created with `Add-MgApplicationPassword`)
- **Renewal:** A new secret is created when the current one has fewer than 14 days remaining
- **Cleanup:** Expired credentials are removed automatically; excess valid credentials are consolidated
- **Key Vault sync:** New secrets are stored in Key Vault immediately after creation
- **Grace period:** When a new secret is created, the previous one is kept for 24 hours to allow rollover

Automation runs during `deploy.ps1 -Component appservice` and `Validate-AppRegistrations.ps1 -Fix`. No manual rotation is needed under normal circumstances. If manual intervention is required, contact the infrastructure team.

## Enterprise Applications

Each app registration has a corresponding Enterprise Application (Service Principal) configured with "Assignment required: Yes". Users must be members of the appropriate group to access:

| Environment | Access Groups |
|-------------|---------------|
| **Dev** | `Origination App Dev Users` or `Azure - Origination App - Developer Admins` |
| **QA** | `Origination App QA Users` or `Azure - Origination App - Developer Admins` |
| **Prod** | `Origination App Users` or `Azure - Origination App - Production Support` |

## GitHub Actions (Workload Identity)

A separate app registration is used for GitHub Actions CI/CD deployments via OIDC (Workload Identity Federation). Unlike the API and SPA registrations which are per-environment, this is a single registration shared across all environments with per-environment federated credentials.

### Origination - GitHub Actions

**App Registration Details:**
- **Display Name**: `Origination - GitHub Actions`
- **Application (Client) ID**: Stored as `AZURE_CLIENT_ID` repository secret in GHE
- **Tenant ID**: `1521f999-f722-4a4f-9747-166f93e9b0d1` (scoular.com)

**Authentication:** Workload Identity Federation (OIDC) -- no client secret
**OIDC Issuer:** `https://token.actions.scoular.ghe.com`

**Federated Credentials:**

| Environment | Name | Subject Claim |
|-------------|------|---------------|
| Dev | `origination-dev` | `repo:IT/origination:environment:dev` |
| QA | `origination-qa` | `repo:IT/origination:environment:qa` |
| Prod | `origination-prod` | `repo:IT/origination:environment:prod` |

**Azure RBAC (per environment):**

| Role | Scope |
|------|-------|
| Reader | Resource Group |
| Website Contributor | App Service |

**SQL Database Roles (per environment):**

| Role | Database |
|------|----------|
| db_datareader | Origination |
| db_datawriter | Origination |
| db_ddladmin | Origination |

See `GITHUB-ACTIONS-CICD.md` for the full CI/CD developer guide.

## App Roles (v2.14)

Starting with template v2.14, each API app registration defines multiple app roles instead of a single `Origination.Application` role. App roles control what appears in the `roles` claim of JWT access tokens.

### Convention-Based Defaults

If no custom `appRoles` array is defined in `app-config.json`, the following three roles are created automatically:

| Role Value | Display Name | Allowed Members | Purpose |
|------------|-------------|-----------------|---------|
| `Admin` | Admin | Users/Groups + Applications | Full administrative access |
| `User` | User | Users/Groups + Applications | Standard user access |
| `Origination.Application` | Origination Application | Applications only | Service-to-service (daemon) access |

### Custom App Roles

Define custom roles in `app-config.json` to override the convention defaults:

```json
{
  "appRoles": [
    { "value": "Admin", "displayName": "Admin", "description": "Full administrative access" },
    { "value": "Reviewer", "displayName": "Reviewer", "description": "Review-only access" },
    { "value": "User", "displayName": "User", "description": "Standard user access" }
  ]
}
```

When `appRoles` is provided, only the listed roles are created (plus `Origination.Application` for service-to-service access).

### Group-to-Role Assignment

Each Entra ID group is assigned to a specific app role on the API Enterprise Application. The role is determined by:

1. **Explicit override**: The `appRole` property on the group's entry in `entraGroups` config
2. **Naming convention** (default): Groups with "Admin" or "Production Support" in the name are assigned the **Admin** role; all others are assigned the **User** role

| Group | Assigned Role | Reason |
|-------|--------------|--------|
| Azure - Origination App - Developer Admins | Admin | Name contains "Admin" |
| Azure - Origination App - Production Support | Admin | Name contains "Production Support" |
| Origination App Dev Users | User | Default |
| Origination App QA Users | User | Default |
| Origination App Users | User | Default |

### JWT `roles` Claim

Authenticated users receive a `roles` claim in their access token containing the role value(s) assigned to their group. Example decoded token payload:

```json
{
  "roles": ["Admin"],
  "name": "Jane Doe",
  "preferred_username": "jdoe@scoular.com"
}
```

Use `[Authorize(Roles = "Admin")]` in .NET or check the `roles` claim in Angular to enforce role-based access.

### App Role Assignments for Service Principals

The `appRoleAssignments` array in `app-config.json` assigns app roles to service principals (UAMIs, daemon apps) or additional groups beyond the 5 standard Entra groups:

```json
{
  "appRoleAssignments": [
    {
      "principalDisplayName": "uami-myapp-dev-eus",
      "principalId": "<object-id>",
      "appRoleValue": "Origination.Application",
      "environments": ["dev"]
    }
  ]
}
```

Role GUIDs are resolved automatically by the `Sync-AppRoles` function, which preserves existing Azure AD GUIDs across deployments.

## Troubleshooting

### "AADSTS50105: User is not assigned to the application"

This error occurs when a user tries to access the application but is not a member of the assigned group.

**Solution**: Add the user to one of the access groups for the appropriate environment:
- **Dev**: `Origination App Dev Users` (end users) or `Azure - Origination App - Developer Admins` (admins)
- **QA**: `Origination App QA Users` (end users) or `Azure - Origination App - Developer Admins` (admins)
- **Prod**: `Origination App Users` (end users) or `Azure - Origination App - Production Support` (admins)

### "The provided value for the input parameter 'scope' is not valid"

This error indicates the API scope is incorrect in your SPA configuration.

**Solution**: Verify the scope URI matches exactly:
```
api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev
```

### Accessing Key Vault Secret

If you get "Forbidden" when accessing the Key Vault secret, ensure you are a member of the developer group which has "Key Vault Secrets Officer" role on the Key Vault.

## References

- [Microsoft identity platform app registration documentation](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [Configure a single-page application](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration)
- [Protect a web API with Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-protected-web-api-overview)

---

*Document version: 1.5 | 2026-04-21*
