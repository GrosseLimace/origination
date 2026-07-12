# Grain Originator Portal — Agent Orientation

A web app for Scoular grain originators to manage customers, contracts, deliveries, planting
intentions, and analytics dashboards. See [`README.md`](README.md) for the full feature list,
API endpoint reference, and SBOM.

## Tech stack

- **Backend**: ASP.NET Core Web API, .NET 10, Entity Framework Core 10.0.1, Azure AD auth via
  `Microsoft.Identity.Web`.
- **Frontend**: Angular 21 (standalone components, signals, **zoneless** —
  `provideZonelessChangeDetection()` in `client/src/main.ts`), TypeScript ~5.9, Tailwind CSS v4,
  MSAL Angular v5.
- **Data**: two `DbContext`s — `OriginationDbContext` (ODS views, **read-only**) and
  `ApplicationDbContext` (Origination app tables, read/write — Notes, PlantingIntentions,
  ProducerDetails, SavedLists, Dashboard* tables). Don't add writes against the ODS context; see
  the `Data Sources` table in `README.md`.

## Repo layout

- `api/` — `GrainOriginatorPortal.Api` (Controllers, Middleware, Models, Services),
  `GrainOriginatorPortal.Infrastructure` (Data/DbContexts, Repositories, Abstractions),
  `GrainOriginatorPortal.Api.Tests` (xUnit + Moq/NSubstitute).
- `client/` — Angular SPA; `src/app/core` (guards, handlers, services), `src/app/features`
  (one folder per screen), `src/app/shared` (components/pipes/services/utils reused across
  features), `src/app/models` (TypeScript interfaces).
- `docs/` — `application-context/` (per-screen UX/business docs) and `maps/` (mapping-features
  design + as-built docs).
- `style-guides/` — this repo's coding standards.
- `developer-docs/` — Azure infrastructure operating context.

## Build / test / run

**Backend** (from `api/GrainOriginatorPortal.Api/`):
```bash
dotnet run                    # http://localhost:5000
dotnet watch run              # hot reload
```
**Backend tests** (from `api/GrainOriginatorPortal.Api.Tests/GrainOriginatorPortal.Api.Tests/`, or
`dotnet test GrainOriginatorPortal.sln` from the repo root):
```bash
dotnet build
dotnet test
```

**Frontend** (from `client/`):
```bash
npm install                   # first time only
npm start                     # ng serve, http://localhost:4200
npm run build                 # ng build
npx tsc --noEmit               # typecheck only
npx ng build --configuration development   # dev-config build check
npm test                      # vitest run
npx vitest run                 # equivalent, explicit
npm run e2e                   # playwright test
```

## Documentation map

Read the relevant doc below before working in its area — don't duplicate what's already written
there.

| Doc | When to read it |
|---|---|
| [`README.md`](README.md) | Full feature list, API endpoint reference, tech stack/SBOM tables. |
| [`developer-docs/CLAUDE.md`](developer-docs/CLAUDE.md) | Azure infra context: outbound NSG rules, pre-configured app settings, App Registration client IDs, Key Vault, MSAL/Angular deployment wiring, App Insights, CI/CD. Read before touching auth, deployment, networking, or Azure config. |
| [`docs/application-context/`](docs/application-context/) | Per-screen UX and business-context docs (one file per screen, plus `Shared Infrastructure.md` and `SECURITY-MODEL.md`). Read the relevant screen doc before changing its behavior. |
| [`docs/maps/README.md`](docs/maps/README.md) | As-built architecture for the mapping features (Customer Profile "Fields" tab, Bid Sheet map). Read before extending either. |
| [`docs/maps/PATH-TO-PRODUCTION.md`](docs/maps/PATH-TO-PRODUCTION.md) | What's left to move the mapping features out of proof-of-concept state (real DB migration, Key Vault secrets, vendor key proxy, NSG rule, etc.). Read this first if picking up mapping-features work. |
| [`docs/maps/OVERVIEW-for-leadership.md`](docs/maps/OVERVIEW-for-leadership.md) | Non-technical summary of the mapping features. Rarely needed by an agent, but exists if a plain-language explanation is requested. |
| [`style-guides/`](style-guides/) | Coding standards: `csharp.md`, `angular.md`, `sql.md`, `security.md`, `error-handling.md`, `logging.md`, `permissions-model.md`, `automated-testing.md`, `npm-packages.md`, `git-101.md`, `git-201.md`, `git-reference.md`, `tagging.md`, `RULE-MANIFEST.md`. |

## Mapping features (proof of concept)

The app has a MapLibre GL + Azure Maps + LandMapMagic mapping capability: a Customer Profile
**"Fields" tab** (tag a producer's USDA CLU / parcel / hand-drawn field boundaries, persisted to a
local SQLite `FieldTagDbContext`) and a rebuilt **Bid Sheet map** (read-only field/parcel context,
CDL crop overlay). This is **local-dev-only POC** — dormant unless `FieldTags:*` config is set,
never migrated into shared Azure SQL, uses a browser-exposed free-tier vendor key. Start with
[`docs/maps/README.md`](docs/maps/README.md) and read
[`docs/maps/PATH-TO-PRODUCTION.md`](docs/maps/PATH-TO-PRODUCTION.md) before extending or
productionizing any of it.
