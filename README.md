# Grain Originator Portal

A web application for grain originators to manage customers, contracts, deliveries, planting intentions, and analytics dashboards.

## Architecture

```
GrainOriginatorPortal/
├── api/
│   ├── GrainOriginatorPortal.Api/          # ASP.NET Core Web API
│   │   ├── Controllers/                    # REST API endpoints
│   │   ├── Data/                           # EF Core DbContexts
│   │   ├── Interfaces/                     # IDataService contract
│   │   ├── Middleware/                     # Security, logging, correlation ID
│   │   ├── Models/                         # Domain models + request records
│   │   └── Services/                       # SqlDataService, ApimDataService
│   └── GrainOriginatorPortal.Api.Tests/    # xUnit + Moq unit tests
│
└── client/                                 # Angular 21 SPA
    └── src/app/
        ├── core/
        │   ├── guards/                     # auth.guard.ts (functional CanActivateFn)
        │   ├── handlers/                   # global-error.handler.ts
        │   └── services/                   # api, app-state, toast, nlq-filter, usage-tracking, theme
        ├── features/
        │   ├── customers/                  # components + home/insights pages
        │   ├── dashboard/
        │   ├── build-list/
        │   ├── bid-sheet/
        │   ├── calculators/
        │   ├── daily-digest/
        │   └── usage-dashboard/
        ├── shared/
        │   └── components/                 # button, badge, card, table, dialog, input, select, etc.
        └── models/                         # TypeScript interfaces
```

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) LTS
- SQL Server access (ODS read-only + Origination application DB)
- Azure AD app registrations (see `developer-docs/CLAUDE.md`)

## Getting Started

### 1. Configure the API

Copy `appsettings.json` secrets to User Secrets (development) or Azure Key Vault (production). Required values: `ConnectionStrings:ApplicationDb`, `ConnectionStrings:OriginationDb`, `AzureAd:*`.

```bash
cd api/GrainOriginatorPortal.Api
dotnet user-secrets set "ConnectionStrings:ApplicationDb" "<your-connection-string>"
```

### 2. Start the API

```bash
cd api/GrainOriginatorPortal.Api
dotnet run          # http://localhost:5000
dotnet watch run    # with hot reload
```

### 3. Start the Angular client

```bash
cd client
npm install         # first time only
npm start           # http://localhost:4200
```

### 4. Run tests

```bash
# API unit tests
cd api/GrainOriginatorPortal.Api.Tests
dotnet test

# Angular tests
cd client
npm test            # Vitest
```

## API Endpoints

All routes require Azure AD bearer token authentication. Base path: `/api/v1`

### Customers (ODS — read-only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/customers` | All active customers with contracts + tickets |
| GET | `/customers/{id}` | Single customer by ID |
| PUT | `/customers/{id}` | Update customer details |

### Contracts (ODS — read-only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/contracts` | All contracts |
| GET | `/contracts/customer/{customerId}` | Contracts for a customer |

### Tickets (ODS — read-only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tickets` | All tickets |
| GET | `/tickets/customer/{customerId}` | Tickets for a customer |
| GET | `/tickets/contract/{contractId}` | Tickets for a contract |

### Notes (application DB — read/write)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/notes` | All notes |
| GET | `/notes/customer/{customerId}` | Notes for a customer |
| POST | `/notes` | Create a note |
| PUT | `/notes/{id}` | Update note content |
| DELETE | `/notes/{id}` | Delete a note |
| PATCH | `/notes/{id}/pin` | Toggle pin status |

### Planting Intentions (application DB — read/write)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/plantingintentions` | All planting intentions |
| GET | `/plantingintentions/customer/{customerId}` | Intentions for a customer |
| POST | `/plantingintentions` | Create a planting intention |
| PUT | `/plantingintentions/{id}` | Update a planting intention |
| DELETE | `/plantingintentions/{id}` | Delete a planting intention |

### Producer Details (application DB — read/write)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/producerdetails/customer/{customerId}` | Details for a customer |
| POST | `/producerdetails` | Upsert producer details |
| DELETE | `/producerdetails/{customerId}` | Delete producer details |

### Saved Lists (application DB — read/write)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/savedlists` | All saved lists for current user |
| POST | `/savedlists` | Create a saved list |
| PUT | `/savedlists/{id}` | Update a saved list |
| DELETE | `/savedlists/{id}` | Delete a saved list |

### Dashboard (application DB — read/write)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboardplantingestimates` | All planting estimates |
| PUT | `/dashboardplantingestimates` | Upsert planting estimates (batch) |
| DELETE | `/dashboardplantingestimates/{tradeUnitKey}/{crop}/{year}` | Delete an estimate |
| GET | `/dashboardmarketshares` | All market shares |
| PUT | `/dashboardmarketshares` | Upsert market shares (batch) |
| DELETE | `/dashboardmarketshares/{tradeUnitKey}/{cropCategory}/{year}` | Delete a market share |
| GET | `/dashboardactualharvestss` | All actual harvests |
| PUT | `/dashboardactualharvestss` | Upsert actual harvests (batch) |
| DELETE | `/dashboardactualharvestss/{tradeUnitKey}/{year}` | Delete an actual harvest |

### Reference Data (application DB — read-only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/commodities` | All active commodities |
| GET | `/storedgrain/customer/{customerId}` | Stored grain (stub, no ODS table yet) |
| GET | `/farms/customer/{customerId}` | Farms (stub, no ODS table yet) |

> Trade unit and trade-unit-group catalog lookups are sourced from the **TradeUnitPreferences** database (`dbo.vw_UserTradeUnitPreferences`, see `/usertradeunits`). Managers assign users to trade units in a separate preferences application, which owns the writes; this app only reads. Replaced the Entitlements DB 2026-08-18. The app DB no longer maintains a local TU catalog.

### Utilities
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/geocode?address={address}` | Geocode an address via Azure Maps |
| GET | `/diagnostics/health` | Health check |
| GET | `/diagnostics/ping` | Ping |
| GET | `/whats-new` | Curated release notes, newest first — see [What's New](docs/application-context/Whats%20New.md) |
| GET | `/version` | Running release number plus the CI-stamped commit and workflow run |

## Data Sources

| DbContext | Database | Access |
|-----------|----------|--------|
| `OriginationDbContext` | ODS (read-only views) | Read only — `vw_CurrentCustomers`, `vw_CurrentContracts`, `vw_CurrentTickets`, `vw_TicketQuality`, `vw_ContractPricing` |
| `ApplicationDbContext` | Origination (application tables) | Read/write — Notes, PlantingIntentions, ProducerDetails, SavedLists, Commodities, Dashboard* tables |

## Authentication

Azure AD bearer tokens via `Microsoft.Identity.Web`. All API endpoints require a valid JWT. The Angular client uses MSAL Angular v5 with a functional `authGuard` applied to all routes.

- Tenant: `1521f999-f722-4a4f-9747-166f93e9b0d1`
- API scope: `api://{clientId}/Origination.Application.Dev` (dev)

## Technology Stack

### Backend
| Package | Version | Purpose |
|---------|---------|---------|
| .NET / ASP.NET Core | 10 | Web framework |
| Entity Framework Core | 10.0.1 | ORM / data access |
| Microsoft.Identity.Web | 3.8.4 | Azure AD JWT authentication |
| Azure.Identity | 1.18.0 | Managed Identity / Key Vault |
| Microsoft.Data.SqlClient | 6.1.4 | SQL Server driver |
| Microsoft.Extensions.Http.Resilience | 10.3.0 | HTTP retry / resilience policies |

### Frontend
| Package | Version | Purpose |
|---------|---------|---------|
| Angular | 21 | SPA framework (zoneless) |
| TypeScript | ~5.9 | Language |
| Tailwind CSS | v4 | Utility-first CSS |
| @it/design-system | ^0.1.1 | Scoular component library |
| MSAL Angular | ^5.1.1 | Azure AD authentication |
| MSAL Browser | ^5.4.0 | Azure AD authentication |
| RxJS | ^7.8 | Reactive programming |
| Leaflet | ^1.9.4 | Maps |
| Vitest | ^4.1.11 | Unit testing |

## Software Bill of Materials (SBOM)

Last Updated: 2026-10-13

### Backend Dependencies (C# / .NET 10)

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| Azure.Extensions.AspNetCore.Configuration.Secrets | 1.5.0 | MIT | Azure Key Vault config provider |
| Azure.Identity | 1.18.0 | MIT | Managed Identity / Key Vault authentication |
| Microsoft.AspNetCore.OpenApi | 10.0.1 | MIT | Swagger / OpenAPI support |
| Microsoft.Data.SqlClient | 6.1.4 | MIT | SQL Server driver |
| Microsoft.EntityFrameworkCore.SqlServer | 10.0.1 | MIT | EF Core ORM for SQL Server |
| Microsoft.EntityFrameworkCore.Design | 10.0.1 | MIT | EF Core design-time tools (dev only) |
| Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore | 10.0.3 | MIT | EF Core health check endpoint |
| Microsoft.Extensions.Http.Resilience | 10.3.0 | MIT | HTTP retry / resilience policies |
| Microsoft.Identity.Web | 3.8.4 | MIT | Azure AD / JWT Bearer authentication |
| System.Security.Cryptography.Xml | 10.0.13 | MIT | XML crypto — transitive (via Microsoft.Identity.Web), pinned to clear EncryptedXml advisories (GHSA-37gx-xxp4-5rgx, GHSA-w3x6-4m5h-cxqf, CVE-2026-47302, CVE-2026-50525 & CVE-2026-50648 DoS, CVE-2026-47304 feature-bypass); raised 2026-10-13 to 10.0.13 for CVE-2026-96958/-96959/-96960 (SignedXml/C14N/EncryptedXml DoS, <= 10.0.12) — the old 10.0.10 pin had fallen inside that range. Pulls System.Security.Cryptography.Pkcs to the matching 10.0.13. Pin covers Infrastructure + tests only: .NET 10 package pruning drops it from the web app, which loads it from the App Service ASP.NET Core runtime |

### Frontend Dependencies (Angular 21 / TypeScript)

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| @angular/core | 21.2.25 | MIT | UI framework (security fixes: hydration DOM-clobbering / HttpTransferCache poisoning ≥21.2.17; HttpTransferCache cache-key ambiguity / cross-request response reuse ≥21.2.19; sanitization bypass via directive host bindings on concrete host elements, GHSA-hh8m-fm6v-7cvg, ≥21.2.20 — not exploitable here, no security-sensitive host bindings exist; moved to 21.2.25 in lockstep with @angular/router, 2026-09-30) |
| @angular/common | 21.2.25 | MIT | Common directives, pipes and HttpClient (security fix: HttpTransferCache bypass leaking authenticated responses when a child client uses withRequestsMadeViaParent, GHSA-p297-fm68-3q8c, ≥21.2.20 — not applicable here, the app does no SSR/hydration) |
| @angular/router | 21.2.25 | MIT | Client-side routing (security fix: SSR denial of service via numeric URL matrix parameters, CVE-2026-101896 — the 21.x fix is "avoid dense elements allocation for numeric URL keys" in 21.2.24, so the ≥22.2.0 the scanner quotes is not required; not exploitable here in any case, the app has no server-side rendering, so the allocation could only run in the requesting user's own browser) |
| @angular/forms | 21.2.25 | MIT | Reactive forms |
| @angular/animations | 21.2.25 | MIT | Animation support |
| @azure/msal-angular | 5.1.1 | MIT | Azure AD authentication (Angular) |
| @azure/msal-browser | 5.4.0 | MIT | MSAL browser runtime |
| @it/design-system | 0.1.1 | Internal | Scoular IT design system components |
| leaflet | 1.9.4 | BSD-2-Clause | Interactive map rendering |
| leaflet.markercluster | ~1.5.3 | MIT | Leaflet marker clustering |
| rxjs | 7.8.2 | Apache-2.0 | Reactive programming (Observables) |
| jspdf | 4.2.1 | MIT | Client-side PDF generation (Profitability calculator report) |
| jspdf-autotable | 5.0.8 | MIT | Tabular layout for jsPDF (calculator report tables) |
| tslib | 2.8.1 | 0BSD | TypeScript runtime helpers |
| zone.js | 0.15.1 | MIT | Angular change detection zone |
| tailwindcss | 4.2.1 | MIT | Utility-first CSS framework |
| vitest | 4.1.11 | MIT | Unit testing framework (CVE fix: ≥4.1.0; security fix ≥4.1.11: `@vitest/mocker` registered a redirect-mock target without checking Vite’s file-serving allowlist, so a client reaching the dev server’s unauthenticated HMR socket could read files outside the project root — `@vitest/ui` and `@vitest/coverage-v8` pinned to the same version to keep the family in lockstep) |
| typescript | 5.9.3 | Apache-2.0 | TypeScript compiler |
| esbuild | ≥0.28.1 | MIT | Bundler — transitive (via @angular/build, vitest), pinned in `overrides` (security fix: RCE via NPM_CONFIG_REGISTRY + Windows path traversal, ≥0.28.1) |
| vite | ≥7.3.5 | MIT | Dev server/bundler — transitive (via @angular/build), pinned in `overrides` (security fix: `server.fs.deny` bypass + launch-editor NTLM disclosure on Windows, ≥7.3.5) |
| @babel/core | ≥7.29.6 | MIT | JS compiler — transitive (via @angular/build, @angular/compiler-cli), pinned in `overrides` (security fix: arbitrary file read via sourceMappingURL, ≥7.29.6) |
| browserslist | ≥4.28.7 | MIT | Browser-target resolution — transitive (via @angular/build, @angular/compiler-cli), pinned in `overrides` (security fixes: uncaught crash / prototype write in normalizeStats via an untrusted browserslist-stats.json, unbounded result-cache growth OOM, ≥4.28.7) |
| tar | ≥7.5.21 | ISC | Tar parser — transitive (via @angular/cli), pinned in `overrides` (security fixes: decompression/parse DoS ≥7.5.19, mapHas/filesFilter stack-overflow DoS ≥7.5.21) |
| pacote | ≥21.5.1 | ISC | npm package fetcher — transitive (via @angular/cli, which pins it exactly), forced in `overrides` (security fix: addGitSha ReDoS/CPU-exhaustion DoS via crafted spec.rawSpec, ≥21.5.1) |
| ws | ≥8.21.0 | MIT | WebSocket — transitive (via happy-dom test env), pinned in `overrides` (security fix: memory-exhaustion DoS, ≥8.21.0) |
| brace-expansion | ≥5.0.12 | MIT | Brace pattern expansion — transitive (via @angular/cli, @analogjs/vite-plugin-angular → minimatch/glob), pinned in `overrides` (security fixes: exponential-time expansion DoS ≥5.0.7, unbounded-length OOM crash ≥5.0.8, unbounded intermediate-array DoS ≥5.0.9, parseCommaParts recursion + push.apply spread stack exhaustion ≥5.0.10, nested-brace recursion stack exhaustion + quadratic-time {a},b} rewrite CPU DoS ≥5.0.12 — the ≥5.0.9 floor itself sat inside that advisory range; dev-tooling-only) |
| postcss | 8.5.23 | MIT | CSS processor — direct dev dep (Tailwind/Angular build), pinned to 8.5.23 and forced across transitives via `overrides` `$postcss` (security fixes: sourceMappingURL path-traversal .map disclosure, incomplete-fix follow-up ≥8.5.23) |
| body-parser | ≥2.3.0 | MIT | HTTP body parsing — transitive (via @angular/cli dev server), pinned in `overrides` (security fix: size-limit enforcement silently disabled on invalid `limit`, ≥2.3.0) |
| qs | ≥6.16.0 <7 | BSD-3-Clause | Query-string parser — transitive (via @angular/cli → @modelcontextprotocol/sdk → express / body-parser), pinned in `overrides` (security fixes ≥6.16.0: bracket-key comma input bypassing arrayLimit/throwOnLimitExceeded → memory-exhaustion DoS; non-callable `constructor.isBuffer` TypeError in stringify → uncaught-throw DoS; dev-tooling-only, `ng mcp` path, not in the app bundle) |
| immutable | ≥5.1.8 | MIT | Immutable collections — transitive (via @angular/build → sass), pinned in `overrides` (security fix: hash-collision algorithmic-complexity DoS in Map/Set, CVE-2026-59880, ≥5.1.8) |
| fast-uri | ≥3.1.8 <4 | BSD-3-Clause | URI parser — transitive (via @angular/build, @angular/cli → ajv), pinned in `overrides` (security fixes: host confusion via failed IDN canonicalization + literal-backslash authority delimiter ≥3.1.5; skipped IDN canonicalization on scheme-relative `resolve()`, double hostname percent-decode SSRF, percent-encoded scheme host confusion / CRLF injection, malformed IPv6 literal silently truncated to a valid address ≥3.1.6; unvalidated port authority injection in `serialize()`, unbalanced IP-literal bracket host confusion ≥3.1.7; inconsistent host case normalization via percent-encoded octets on scheme-relative refs ≥3.1.8 — the ≥3.1.7 floor itself sat inside that advisory range; kept on 3.x to avoid the ajv-breaking 4.x major) |
| hono | ≥4.13.5 <5 | MIT | Web framework — transitive (via @angular/cli dev tooling), pinned in `overrides` (security fixes incl. hono/jsx cross-request context disclosure during SSR, CORS-middleware ReDoS via Access-Control-Request-Headers ≥4.12.34; query helpers parsing parameters after the URL fragment causing cache-key/proxy interpretation differentials, `toSSG()` still writing outside the output directory on consecutive `..` runs, unbounded `parseBody()` dot-notation nesting OOM ≥4.13.5; not used for SSR in this app) |
| undici | ≥7.29.1 <8 | MIT | HTTP/1.1 client — transitive (via @angular/build, @angular/cli dev tooling), pinned in `overrides` (security fixes ≥7.29.1: cross-user cache disclosure + parse-time crash, retry-interceptor response desync, Cache-Control whitespace disclosure, CRLF injection via blob body type, cookie attribute injection, WebSocket permessage-deflate unhandled inflate error process crash; dev-tooling-only, not used at runtime) |
| proxy-addr | ≥2.0.8 <3 | MIT | Trusted-proxy / X-Forwarded-For resolution — transitive (via @angular/cli → express dev server), pinned in `overrides` (security fix ≥2.0.8: an IPv6 trust subnet with zero leading bits, e.g. `::ffff:10.0.0.0/8` or `::/1`, matched EVERY IPv4 client and let it spoof `req.ip` via X-Forwarded-For; dev-tooling-only — our API is .NET, no Express server ships) |
| source-map-js | ≥1.2.2 <2 | BSD-3-Clause | Source map parsing/generation — transitive (via postcss, @tailwindcss/node, sass, @angular/build, vitest), pinned in `overrides` (security fix ≥1.2.2: unbounded indexed-map `offset.line` let a ~134-byte map expand to tens of MB and block the event loop; now capped at 10,000,000; build-time only) |
| @modelcontextprotocol/sdk | ≥1.31.0 <2 | MIT | Model Context Protocol SDK — transitive (via @angular/cli, which pins it EXACTLY, for the `ng mcp` stdio server), pinned in `overrides` (security fix ≥1.31.0: the OAuth CLIENT sent stored refresh tokens / client secrets to whichever authorization server an MCP server named; the CLI uses only the SDK's server + stdio transport and never loads the OAuth client, so not reachable here. Override forces a newer version than the CLI pins — `ng mcp` handshake verified on 1.32.1; drop the override once on an @angular/cli that pins ≥1.31.0) |
| ip-address | ≥10.5.1 | MIT | IP address parser — transitive (via @angular/cli dev tooling → dns/proxy libs), pinned in `overrides` (security fixes ≥10.5.1: leading-zero octet octal/decimal SSRF, CIDR-suffix special-use suppression, IPv4-mapped/NAT64 well-known misclassification, NAT64 local-use 64:ff9b:1::/48 unclassified, and isLinkLocal() matching fe80::/64 instead of fe80::/10 — all trust-boundary bypasses; dev-tooling-only) |
| @hono/node-server | ≥2.0.5 | MIT | Node adapter for hono — transitive (via @angular/cli dev tooling), pinned in `overrides` (security fix: Windows serve-static path traversal via encoded backslash; dev-server-only, not used to serve this app) |
| dompurify | ≥3.4.16 <4 | (MIT OR Apache-2.0) | HTML sanitizer — transitive (via jspdf, PDF export), pinned in `overrides` (security fixes: CUSTOM_ELEMENT_HANDLING bypasses afterSanitizeElements → second-order XSS gadget ≥3.4.12; IN_PLACE node-removing afterSanitize hook leaves detached-subtree event handlers armed → DOM XSS, GHSA-p98j-92pf-mc4p, ≥3.4.16 — the ≥3.4.12 floor itself sat inside that advisory range; neither hook is used here, jspdf only sanitises the HTML it renders to PDF) |
| piscina | ≥5.3.2 <6 | MIT | Worker-thread pool — transitive (via @angular/build), pinned in `overrides` (security fix ≥5.3.2: prototype-pollution gadget in ThreadPool.options → code execution via execArgv / loadBalancer / env, Dependabot #133 — the ≥5.2.0 floor itself sat inside that advisory range; build-tooling only, not in the app bundle) |

## CI/CD

Automated deployments via GitHub Actions on `scoular.ghe.com/IT/origination`. Self-hosted runners with OIDC authentication to Azure.

| Environment | App Service |
|-------------|-------------|
| Dev | `app-origination-dev-eus` |
| QA | `app-origination-qa-eus` |
| Production | `app-origination-eus` |

## Infrastructure as Code

Azure resources are provisioned by IT Infrastructure (see `AZURE-INFRASTRUCTURE.md`). Resources that
the app team owns directly are version-controlled under [`infra/`](infra/):

| Resource | Location | Deploy |
|----------|----------|--------|
| Notes Daily Recap Logic App | [`infra/logic-apps/notes-daily-recap/`](infra/logic-apps/notes-daily-recap/) | `.github/workflows/deploy-logic-app-notes-daily-recap-dev.yml` (manual) |
| Instant Share Note Logic App | [`infra/logic-apps/instant-share-note/`](infra/logic-apps/instant-share-note/) | `.github/workflows/deploy-logic-app-instant-share-note-dev.yml` (manual) |

Logic Apps are stored as parameterized ARM templates and authenticate to Azure (SQL, Microsoft
Graph, Azure OpenAI) via system-assigned managed identity — no secrets in the repo.
