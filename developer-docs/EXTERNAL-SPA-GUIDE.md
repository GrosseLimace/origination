# Origination - External SPA Guide

This guide covers external SPA accessibility for the Origination application. External apps are delivered as separate Angular SPAs on Azure Static Web Apps, with API traffic routed through Azure API Management (APIM) -- the App Service remains fully private.

## Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [External API Specification](#external-api-specification)
- [Building the External Angular SPA](#building-the-external-angular-spa)
- [Deploying to Static Web App](#deploying-to-static-web-app)
- [Request Process](#request-process)
- [Security Notes](#security-notes)

## Overview

What external SPA accessibility means at Scoular:

- External apps are hosted on **Azure Static Web Apps (SWA)**, separate from the main App Service
- API calls go through **Azure API Management (APIM)**, not directly to the App Service
- The App Service stays **fully private** -- no internet exposure
- Authentication uses the **same MSAL/Entra ID** as the desktop app
- Access restricted to **company-managed devices** via Entra ID Conditional Access

## Architecture

```
External User (company-managed device)
     |
     | Entra ID CA policy (device compliance)
     v
Static Web App (external Angular SPA)
  - Managed certificate (free, auto-renewed)
  - Custom domain: origination.scoular.com (prod) / ext-origination-dev.scoular.com (dev)
     |
     | MSAL auth token
     v
APIM (api{env}.scoular.com)
  - Data Integrations team manages API operations
  - App Gateway + WAF in front
     |
     | Private endpoint
     v
App Service (fully private)
```

---

## Prerequisites

Before requesting external access:

1. **Identify which user workflows need external access** (field operations, quick data entry)
2. **Determine the minimal API endpoint set** those workflows require
3. **Generate an OpenAPI specification** for your external endpoints (see next section)
4. **Coordinate with your team lead** -- external access requires infrastructure provisioning

---

## External API Specification

When you decide to add external SPA support, produce an **OpenAPI specification** for your external endpoints. This is the contract document used by three teams and can be consumed by Azure APIOps tooling for automated APIM configuration.

### What to Produce

Create an `openapi/` directory in your repo root:

```
openapi/
  specification.yaml    # OpenAPI 3.0 spec for external endpoints
  README.md             # Summary of workflows and offline requirements
```

This is a **living document** — keep it updated as your external API evolves. Both the Infrastructure and Data Integrations teams reference this directory directly from your repo.

### OpenAPI Specification (specification.yaml)

Generate a standard OpenAPI 3.0 spec covering only the external-facing endpoints:

```yaml
openapi: 3.0.3
info:
  title: Origination External API
  version: '1.0'
  description: External-facing API endpoints for Origination field operations
paths:
  /transactions/transfer:
    post:
      operationId: submitTransfer
      summary: Submit bin-to-bin grain transfer
      tags: [transfers]
      security:
        - entraId: [api://{scope}]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TransferRequest'
      responses:
        '201':
          description: Transfer created
        '202':
          description: Transfer queued (offline)
  /bins/{id}:
    get:
      operationId: getBin
      summary: Get bin details
      tags: [bins]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: Bin details
components:
  securitySchemes:
    entraId:
      type: oauth2
      flows:
        implicit:
          authorizationUrl: https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1/oauth2/v2.0/authorize
          scopes:
            api://{scope}: Access Origination API
```

**Key points:**
- Paths are relative to the APIM path prefix (e.g., `/transactions/transfer` not `/api/transactions/transfer`)
- Include request/response schemas in `components/schemas` where possible
- Include security scheme referencing Entra ID OAuth2
- Only include endpoints needed for external access — not the full API

### README.md (Workflow and Offline Summary)

Include a README in the `openapi/` directory summarizing workflows and offline behavior — information that doesn't fit in the OpenAPI spec:

| Workflow | Description | Offline Behavior |
|----------|-------------|------------------|
| Bin Transfer | Submit bin-to-bin grain transfer | Queue in IndexedDB, sync when online |
| Air Space Edit | Update bin air space measurement | Fail gracefully with error |
| Bin Notes | Add/edit bin comments | Fail gracefully with error |
| Dashboard | View location summary | Serve from cache |

### Consumers

| Team | What They Use |
|------|---------------|
| Infrastructure | Populates `externalApp.externalApiEndpoints` in app-config.json from the spec, creates SWA + WAF policy |
| Data Integrations | Imports `specification.yaml` into APIM via APIOps or portal. Reviews and configures APIM policies (rate limiting, caching, transforms) |
| App Dev (you) | Builds the external Angular SPA against these endpoints. Can use the OpenAPI spec to generate TypeScript API clients |

---

## Building the External Angular SPA

### Key Guidelines

- **Separate build**: Create a separate Angular project or use a build configuration that only includes external routes/components. Do NOT serve the full desktop app.
- **MSAL authentication**: Same Entra ID tenant (`1521f999-f722-4a4f-9747-166f93e9b0d1`). Uses a dedicated External SPA app registration (`Origination External - {Env}`). Use the same `provideAppInitializer` bootstrap pattern documented in the main [CLAUDE.md](CLAUDE.md) **Angular MSAL Setup** section — it applies here identically. The only practical difference: because external SPAs typically have **no public routes**, nearly every cold start lands in Case C1 (`ssoSilent`) or Case C2 (`loginRedirect`) rather than Case B (cached account). That's expected — filter App Insights `customEvents` on `name startswith "MSAL.Bootstrap"` to see the distribution for your app.
- **API base URL**: Varies by environment (see table below). The Angular app stores the base URL and appends each endpoint path (e.g., `${environment.apiBaseUrl}/transactions/transfer`).
- **App Insights**: Use the `AppInsightsService` wrapper + `forwardMsalEventsToAppInsights` helper documented in [CLAUDE.md](CLAUDE.md) (sections **Angular (Client-Side)** and **CSP Allow-List for MSAL and App Insights**). The external SPA writes to the same App Insights instance as the desktop app — tag-via-`ai.cloud.role` distinguishes the two in queries (e.g., `cloud_RoleName startswith "origination-external-spa"`).
- **Offline support**: Consider IndexedDB for queueing write operations and service workers for caching read-heavy data.

### API Base URL by Environment

| Environment | Base URL | Route | Why |
|-------------|----------|-------|-----|
| Local dev | `https://localhost:5001/api` | Direct to .NET API | Standard local development |
| Dev (SWA) | `https://origination-dev.scoular.com/api` | Direct to App Service | No APIM in dev -- keep dev endpoints private |
| QA (SWA) | `https://apiqa.scoular.com/{apimPathPrefix}` | Through APIM | External access via APIM gateway |
| Prod (SWA) | `https://api.scoular.com/{apimPathPrefix}` | Through APIM | External access via APIM gateway |

**Dev calls the App Service directly** -- not APIM. Dev API endpoints should not be added to APIM. The dev SWA (`ext-origination-dev.scoular.com`) calls the App Service custom domain, which requires CORS configuration (the external SPA is cross-origin to the App Service).

**QA/Prod use split-horizon DNS** -- the SWA custom domain matches the App Service custom domain (e.g., `origination-qa.scoular.com`). External DNS resolves to the App Gateway (APIM path), while internal DNS resolves to the App Service private endpoint. The SWA always goes through APIM (external path) since Static Web Apps run on Azure's public infrastructure.

**QA/Prod call APIM** -- the Data Integrations team creates API operations at the APIM path prefix (e.g., `/external/origination/v1`). The APIM path prefix will differ from the app's internal `/api` path structure.

### CORS for Dev Environment

The dev App Service needs to allow the external SWA origin. Add `ext-origination-dev.scoular.com` to the allowed origins in `appsettings.Development.json` (or the environment-specific app settings):

```json
{
  "AllowedOrigins": [
    "http://localhost:4200",
    "https://ext-origination-dev.scoular.com"
  ]
}
```

### Example Environment Files

**`environment.ts`** (local dev -- `ng serve`):
```typescript
export const environment = {
  production: false,
  apiBaseUrl: 'https://localhost:5001/api',
  msalConfig: {
    auth: {
      clientId: '<DEV_EXTERNAL_SPA_CLIENT_ID>',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'http://localhost:4200',
    }
  },
  apiConfig: {
    scopes: ['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev'],
    uri: 'https://localhost:5001/api'
  }
};
```

**`environment.dev.ts`** (deployed dev SWA -- direct to App Service):
```typescript
export const environment = {
  production: true,
  apiBaseUrl: 'https://origination-dev.scoular.com/api',
  msalConfig: {
    auth: {
      clientId: '<DEV_EXTERNAL_SPA_CLIENT_ID>',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'https://ext-origination-dev.scoular.com',
    }
  },
  apiConfig: {
    scopes: ['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev'],
    uri: 'https://origination-dev.scoular.com/api'
  }
};
```

**`environment.qa.ts`** (deployed QA SWA -- through APIM):
```typescript
export const environment = {
  production: true,
  apiBaseUrl: 'https://apiqa.scoular.com/{apimPathPrefix}',
  msalConfig: {
    auth: {
      clientId: '<QA_EXTERNAL_SPA_CLIENT_ID>',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'https://origination-qa.scoular.com',
    }
  },
  apiConfig: {
    scopes: ['api://<APIM_SCOPE>/<scope-name>'],
    uri: 'https://apiqa.scoular.com/{apimPathPrefix}'
  }
};
```

---

## Deploying to Static Web App

Deployment uses GitHub Actions with the SWA CLI and OIDC workload identity (same authentication as App Service deploys — no deployment tokens needed):

- The GitHub Actions service principal has **Contributor** on the SWA resource
- Use `azure/login@v3` for OIDC authentication (same as App Service deploys)
- Use the `@azure/static-web-apps-cli` npm package (`swa deploy`) with `--resource-group` and `--app-name`
- Do NOT use `azure/static-web-apps-deploy@v1` (requires Docker, incompatible with self-hosted runners)

### Sample Workflow Step

```yaml
- name: Azure Login (OIDC)
  uses: azure/login@v3
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}

- name: Install SWA CLI
  run: npm install -g @azure/static-web-apps-cli

- name: Deploy to Static Web App
  run: |
    swa deploy ./external/dist/browser \
      --resource-group rg-origination-dev-eus \
      --app-name swa-origination-dev-eus \
      --env production
```

---

## Request Process

Steps to request external access for Origination:

1. **Create the `openapi/` directory** with your OpenAPI spec and commit to your repo
2. **Notify the Infrastructure team** (they will add `externalApp` config to app-config.json)
3. **Infrastructure creates**: SWA resource, External SPA app registration, WAF policy
4. **Data Integrations creates**: APIM operations from your endpoint spec
5. **Infrastructure provides**: External SPA Client ID, SWA deployment token, APIM path prefix
6. **You build and deploy** the external Angular SPA to the SWA

---

## Security Notes

- The App Service is **NEVER** exposed to the internet for external access
- APIM provides the first authentication layer (OAuth2 validation) before requests reach your API
- WAF (App Gateway) provides DDoS protection and managed rule sets in front of APIM
- Entra ID Conditional Access enforces device compliance (company-managed devices only)
- The App Insights connection string is write-only and visible in the browser bundle -- do not include PII in custom telemetry

---

*Document version: 1.7 | 2026-04-21*
