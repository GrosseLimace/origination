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
| GET | `/tradeunitgroups` | Trade unit groups with trade units |
| GET | `/storedgrain/customer/{customerId}` | Stored grain (stub, no ODS table yet) |
| GET | `/farms/customer/{customerId}` | Farms (stub, no ODS table yet) |

### Utilities
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/geocode?address={address}` | Geocode an address via Azure Maps |
| GET | `/diagnostics/health` | Health check |
| GET | `/diagnostics/ping` | Ping |

## Data Sources

| DbContext | Database | Access |
|-----------|----------|--------|
| `OriginationDbContext` | ODS (read-only views) | Read only — `vw_CurrentCustomers`, `vw_CurrentContracts`, `vw_CurrentTickets`, `vw_TicketQuality`, `vw_ContractPricing` |
| `ApplicationDbContext` | Origination (application tables) | Read/write — Notes, PlantingIntentions, ProducerDetails, SavedLists, TradeUnits, Commodities, Dashboard* tables |

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
| Azure.Identity | 1.17.1 | Managed Identity / Key Vault |
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
| Vitest | ^4.0.18 | Unit testing |

## Software Bill of Materials (SBOM)

Last Updated: 2026-03-10

### Backend Dependencies (C# / .NET)
| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| Microsoft.AspNetCore.App | 10.0 | MIT | Web framework |
| Microsoft.EntityFrameworkCore.SqlServer | 10.0.1 | MIT | ORM + SQL Server provider |
| Microsoft.Identity.Web | 3.8.4 | MIT | Azure AD / MSAL JWT auth |
| Microsoft.Identity.Web.MicrosoftGraph | 3.8.4 | MIT | MS Graph integration |
| Azure.Identity | 1.17.1 | MIT | Managed Identity, Key Vault access |
| Azure.Security.KeyVault.Secrets | 4.7.0 | MIT | Key Vault secrets |
| Microsoft.Data.SqlClient | 6.1.4 | MIT | SQL Server data provider |
| Microsoft.Extensions.Http.Resilience | 10.3.0 | MIT | HTTP retry / circuit breaker |
| Microsoft.ApplicationInsights.AspNetCore | 2.22.0 | MIT | Application monitoring |
| Swashbuckle.AspNetCore | 7.x | MIT | OpenAPI / Swagger |

### Frontend Dependencies (Angular / TypeScript)
| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| @angular/core | ^21 | MIT | Angular framework |
| @angular/router | ^21 | MIT | Client-side routing |
| @azure/msal-angular | ^5.1.1 | MIT | Azure AD MSAL integration |
| @azure/msal-browser | ^5.4.0 | MIT | Azure AD browser auth |
| @it/design-system | ^0.1.1 | Internal | Scoular UI component library |
| tailwindcss | ^4 | MIT | Utility CSS framework |
| @tailwindcss/postcss | ^4.2.1 | MIT | PostCSS plugin for Tailwind v4 |
| rxjs | ^7.8 | Apache-2.0 | Reactive programming |
| leaflet | ^1.9.4 | BSD-2-Clause | Interactive maps |
| @types/leaflet | ^1.9 | MIT | Leaflet TypeScript types |
| vitest | ^4.0.18 | MIT | Unit testing framework |
| @vitest/coverage-v8 | ^4 | MIT | Code coverage |
| happy-dom | ^16 | MIT | DOM environment for tests |
| typescript | ~5.9 | Apache-2.0 | TypeScript compiler |

## CI/CD

Automated deployments via GitHub Actions on `scoular.ghe.com/IT/origination`. Self-hosted runners with OIDC authentication to Azure.

| Environment | App Service |
|-------------|-------------|
| Dev | `app-origination-dev-eus` |
| QA | `app-origination-qa-eus` |
| Production | `app-origination-eus` |
