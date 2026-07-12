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
        │   └── services/                   # api, app-state, toast, nlq-filter, position, theme
        ├── features/
        │   ├── customers/                  # components + home/insights pages
        │   ├── dashboard/
        │   ├── build-list/
        │   ├── position-report/
        │   └── bid-sheet/
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

> Trade unit and trade-unit-group catalog lookups are sourced from the Entitlements database (see `/usertradeunits`). The app DB no longer maintains a local TU catalog.

### Utilities
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/geocode?address={address}` | Geocode an address via Azure Maps |
| GET | `/diagnostics/health` | Health check |
| GET | `/diagnostics/ping` | Ping |

### Field Tagging & Maps (proof of concept)
> Local-development POC — dormant unless configured. See [`docs/maps/`](docs/maps/) for the full
> architecture, and [`docs/maps/PATH-TO-PRODUCTION.md`](docs/maps/PATH-TO-PRODUCTION.md) for what
> moving this to production requires. Routes below use literal prefixes (no `/api/v1`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/customers/{customerId}/field-tags` | List a producer's tagged field boundaries |
| POST | `/api/customers/{customerId}/field-tags` | Tag a CLU field / parcel / drawn polygon |
| DELETE | `/api/customers/{customerId}/field-tags/{id}` | Soft-delete a field tag |
| POST | `/api/customers/{customerId}/field-tags/apply-calculated-acres` | Set `ProducerDetails.TotalAcres` from the sum of tagged fields |
| GET | `/api/field-tag-config` | Runtime map keys for the Customer Profile Fields tab (all-or-nothing gating) |
| GET | `/api/map-config` | Runtime map keys for the Bid Sheet map (per-key independent gating) |

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
| Leaflet | ^1.9.4 | Maps (Build List, Customer maps; Bid Sheet A/B toggle) |
| MapLibre GL | ^4.7.1 | WebGL maps (Fields tab + Bid Sheet — maps POC, see `docs/maps/`) |
| @mapbox/mapbox-gl-draw | ^1.5.1 | Polygon drawing (Fields tab Tier 4 — maps POC) |
| polygon-clipping | ^0.15.7 | Polygon union for CLU tile-seam reconstruction (maps POC) |
| Vitest | ^4.1.8 | Unit testing |
| Playwright | ^1.61.0 | End-to-end testing (dev) |

## Software Bill of Materials (SBOM)

Last Updated: 2026-07-12

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
| Microsoft.EntityFrameworkCore.Sqlite | 10.0.1 | MIT | Local SQLite store for the field-tagging POC (branch-only; to be removed on promotion — see `docs/maps/PATH-TO-PRODUCTION.md`) |
| SQLitePCLRaw.lib.e_sqlite3 | 3.53.3 | Apache-2.0 | Native SQLite engine for the above; pinned to clear NU1903 (GHSA-2m69-gcr7-jv3q) |

### Frontend Dependencies (Angular 21 / TypeScript)

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| @angular/core | 21.2.17 | MIT | UI framework (security fix: hydration DOM-clobbering / HttpTransferCache poisoning, ≥21.2.17) |
| @angular/router | 21.2.17 | MIT | Client-side routing |
| @angular/forms | 21.2.17 | MIT | Reactive forms |
| @angular/animations | 21.2.17 | MIT | Animation support |
| @azure/msal-angular | 5.1.1 | MIT | Azure AD authentication (Angular) |
| @azure/msal-browser | 5.4.0 | MIT | MSAL browser runtime |
| @it/design-system | 0.1.1 | Internal | Scoular IT design system components |
| leaflet | 1.9.4 | BSD-2-Clause | Interactive map rendering |
| leaflet.markercluster | ~1.5.3 | MIT | Leaflet marker clustering |
| maplibre-gl | 4.7.1 | BSD-3-Clause | WebGL vector/raster map rendering (maps POC — Fields tab + Bid Sheet) |
| @mapbox/mapbox-gl-draw | 1.5.1 | ISC | Polygon draw tool on MapLibre (Fields tab Tier 4 — maps POC) |
| polygon-clipping | 0.15.7 | MIT | Polygon boolean ops (union) for CLU tile-seam reconstruction (maps POC) |
| rxjs | 7.8.2 | Apache-2.0 | Reactive programming (Observables) |
| tslib | 2.8.1 | 0BSD | TypeScript runtime helpers |
| zone.js | 0.15.1 | MIT | Angular change detection zone |
| tailwindcss | 4.2.1 | MIT | Utility-first CSS framework |
| vitest | 4.1.8 | MIT | Unit testing framework (CVE fix: ≥4.1.0) |
| typescript | 5.9.3 | Apache-2.0 | TypeScript compiler |
| esbuild | ≥0.28.1 | MIT | Bundler — transitive (via @angular/build, vitest), pinned in `overrides` (security fix: RCE via NPM_CONFIG_REGISTRY + Windows path traversal, ≥0.28.1) |
| vite | ≥7.3.5 | MIT | Dev server/bundler — transitive (via @angular/build), pinned in `overrides` (security fix: `server.fs.deny` bypass + launch-editor NTLM disclosure on Windows, ≥7.3.5) |
| @babel/core | ≥7.29.6 | MIT | JS compiler — transitive (via @angular/build, @angular/compiler-cli), pinned in `overrides` (security fix: arbitrary file read via sourceMappingURL, ≥7.29.6) |
| tar | ≥7.5.16 | ISC | Tar parser — transitive (via @angular/cli), pinned in `overrides` (security fix: PAX header smuggling / parser differential, ≥7.5.16) |
| ws | ≥8.21.0 | MIT | WebSocket — transitive (via happy-dom test env), pinned in `overrides` (security fix: memory-exhaustion DoS, ≥8.21.0) |

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

Logic Apps are stored as parameterized ARM templates and authenticate to Azure (SQL, Microsoft
Graph, Azure OpenAI) via system-assigned managed identity — no secrets in the repo.
