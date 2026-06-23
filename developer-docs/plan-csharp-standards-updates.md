# Plan 2: Full structural refactor to align with `style-guides/csharp-guide.md`

*Created: 2026-05-21. Supersedes Issues 7 and 8 of [plan-csharp-standards-updates.md](plan-csharp-standards-updates.md). Folds the LOW/MEDIUM mechanical fixes (old Issues 1–6) in as Phase 0 stepping stones.*

---

## Why this plan replaces the old one

The previous plan's Issues 7 (extract `UsageDashboardController` into a service) and 8 (split `IDataService` into smaller interfaces) rearrange the same conflation — controllers reach into a god-service that does both EF queries and "service" work, and entities double as API response shapes. The C# guide mandates a sharper separation than that:

```
Api  →  Infrastructure
```

| Layer | Responsibility | Lives in |
|-------|----------------|----------|
| **Controller** | HTTP routing, model binding, status codes. Thin orchestration only. | `Api/Controllers/` |
| **Service** | Business logic, entity ↔ DTO mapping, cross-repository coordination. | `Api/Services/` (impl) + `Api/Interfaces/` (contracts) |
| **Response DTO** | Wire shape for clients. Decoupled from DB schema. | `Api/Models/Responses/` |
| **Request DTO** | Wire shape for inbound payloads with validation attributes. | `Api/Models/Requests/` |
| **Repository** | Raw EF queries. No business logic, no mapping. Returns entities. | `Infrastructure/Repositories/` (impl) + `Infrastructure/Interfaces/` (contracts) |
| **Entity** | EF-mapped types. Never returned from controllers. | `Infrastructure/Data/Entities/` |
| **DbContext + Configurations** | EF wiring. Never injected outside repositories. | `Infrastructure/Data/` |

If a controller injects a `DbContext`, the structure has failed. Today, **5 controllers** do exactly that. If an entity is returned from a controller, the wire contract is coupled to schema. Today, **almost every controller** does this.

---

## Goal

End state matches the guide's reference layout, scoped to this codebase:

```
GrainOriginatorPortal.sln
api/
├── GrainOriginatorPortal.Api/
│   ├── Controllers/                  # HTTP endpoints, thin
│   ├── Services/                     # Business logic, mapping
│   │   ├── ICustomerService.cs       # (interface → could live under Interfaces/)
│   │   ├── CustomerService.cs
│   │   ├── IFarmService.cs
│   │   ├── FarmService.cs
│   │   └── …                         # one pair per domain
│   ├── Models/
│   │   ├── Requests/                 # Inbound DTOs (records)
│   │   └── Responses/                # Outbound DTOs (records, NEW)
│   ├── Exceptions/                   # Unchanged
│   ├── Filters/                      # Unchanged
│   ├── Middleware/                   # Unchanged
│   ├── Json/                         # Unchanged
│   ├── GlobalUsings.cs
│   └── Program.cs                    # Calls Infrastructure DI extension
│
├── GrainOriginatorPortal.Infrastructure/   # NEW PROJECT
│   ├── Data/
│   │   ├── ApplicationDbContext.cs
│   │   ├── EntitlementsDbContext.cs
│   │   ├── OriginationDbContext.cs
│   │   ├── ApplicationDbContextFactory.cs
│   │   ├── Migrations/
│   │   ├── Entities/                 # All EF-mapped types (moved from Api/Models/)
│   │   └── Configurations/           # EF fluent configs (NEW — currently inline in DbContext)
│   ├── Repositories/                 # Per-domain EF query impls
│   ├── Interfaces/                   # IxxxRepository contracts
│   └── DependencyInjection.cs        # AddInfrastructure(IConfiguration) extension
│
└── GrainOriginatorPortal.Api.Tests/  # existing; expand coverage
```

Compiler-enforced layering: `Api → Infrastructure` only. Removes any temptation to inject `DbContext` into a controller.

---

## Current vs. target — what moves

### Files that move from `Api/Models/` to `Infrastructure/Data/Entities/`

These are EF-mapped types currently doubling as API responses:

```
BidSheetLocation.cs              ContractPricingLine.cs
BidSheetLocationBid.cs           Coordinates.cs
BidSheetLocationOrder.cs         Customer.cs
BidSheetPreference.cs            CustomerCommodity.cs
Commodity.cs                     CustomerLink.cs
CommodityConversion.cs           CustomerTradeUnit.cs
Contract.cs                      CustomerTradeUnitView.cs
DashboardActualHarvest.cs        ESignEnrollment.cs
DashboardMarketShare.cs          Elevator.cs
DashboardPlantingEstimate.cs     ElevatorCache.cs
Farm.cs                          FeatureUsageDaily.cs
HarvestWindow.cs                 Location.cs
Note.cs                          PlantingIntention.cs
ProducerDetails.cs               QueryLibraryItem.cs
QuerySearchLog.cs                SavedList.cs
StoredGrain.cs                   Ticket.cs
TicketQuality.cs                 UserActivity.cs
UserActivityDaily.cs             UserClickEvent.cs
UserPreference.cs                UserSession.cs
UserTradeUnitAccess.cs           UserTradeUnitSnapshot.cs
WeeklyLoginAggregate.cs
```

### Files that stay in `Api/Models/` (response DTOs after this refactor)

Today only 3 response DTOs exist (`ApiErrorResponse`, `GeocodeResult`, `GeocodeSearchResult`). After this refactor, ~40 new response DTOs (records) will live in `Models/Responses/`. The `UsageDashboardDtos.cs` types (~24 classes) become records and split into one file per type, also under `Models/Responses/`. The `ClickEventRequest` already in that file moves to `Models/Requests/ClickEventRequest.cs`.

### Files that move from `Api/Data/` to `Infrastructure/Data/`

```
ApplicationDbContext.cs
ApplicationDbContextFactory.cs
EntitlementsDbContext.cs
OriginationDbContext.cs
Migrations/  (entire folder)
```

### Services that stay in `Api/Services/`

- `UserEntitlementService.cs` / `IUserEntitlementService.cs` — Cross-cutting authz, fine where it is, but will inject `IEntitlementsRepository` instead of `EntitlementsDbContext` after Phase 2.
- `CustomerSyncService.cs`, `CustomerSyncBackgroundService.cs` — orchestrate sync logic. They become services that call repositories.
- `UsageTrackingBackgroundService.cs`, `UsageAggregationBackgroundService.cs` — same: services that delegate writes to repositories.
- `ApimDataService.cs` — **delete in Phase 5** (placeholder pre-dating the structural split; once domain services exist, an HTTP backend becomes one HTTP-based repository per domain, not one god-class).

### Services that get created (new — domain layer)

One per bounded area, replacing chunks of `SqlDataService`:

```
ICustomerService / CustomerService
IFarmService / FarmService
IContractService / ContractService
ITicketService / TicketService
IPlantingIntentionService / PlantingIntentionService
INoteService / NoteService
IProducerDetailsService / ProducerDetailsService
IDashboardService / DashboardService
ICommodityService / CommodityService
IStoredGrainService / StoredGrainService
ISavedListService / SavedListService
IBidSheetService / BidSheetService
IQueryLibraryService / QueryLibraryService
IUsageDashboardService / UsageDashboardService     # extracted from UsageDashboardController
IUserPreferenceService / UserPreferenceService     # extracted from UserPreferencesController
IUserTradeUnitService / UserTradeUnitService       # extracted from UserTradeUnitsController
IGeocodeService / GeocodeService                   # extracted from GeocodeController
```

### Repositories that get created (new — data layer)

Roughly one per service, in `Infrastructure/Repositories/`:

```
ICustomerRepository / CustomerRepository
IFarmRepository / FarmRepository
IContractRepository / ContractRepository
ITicketRepository / TicketRepository
IPlantingIntentionRepository / PlantingIntentionRepository
INoteRepository / NoteRepository
IProducerDetailsRepository / ProducerDetailsRepository
IDashboardRepository / DashboardRepository
ICommodityRepository / CommodityRepository
IStoredGrainRepository / StoredGrainRepository
ISavedListRepository / SavedListRepository
IBidSheetRepository / BidSheetRepository
IQueryLibraryRepository / QueryLibraryRepository
IUsageRepository / UsageRepository                 # UserActivity, UserSession, UserClickEvent, etc.
IUserPreferenceRepository / UserPreferenceRepository
IEntitlementsRepository / EntitlementsRepository   # for UserEntitlementService
ICustomerSyncRepository / CustomerSyncRepository   # ODS view + appDB upserts
```

### What gets deleted at the end

- `Api/Interfaces/IDataService.cs`
- `Api/Services/SqlDataService.cs`
- `Api/Services/ApimDataService.cs`

---

## Cross-cutting decisions to make UP FRONT

These choices set the tone for every domain migration. Decide before Phase 2 starts.

### Decision 1 — Entity-shape vs. reshaped response DTOs

The simplest path is `XResponse` records that match the entity property-for-property. That keeps the SPA unchanged but provides zero schema-independence. The richer path reshapes the DTO (hide DB columns, flatten relationships, rename for the wire). That's expensive but it's the whole point of the layering.

**Recommendation:** start with entity-shape DTOs (mechanical, SPA stays as-is), and only reshape when a real need shows up (e.g., adding a computed field, hiding a sensitive column). Don't bundle SPA changes into this refactor.

### Decision 2 — Mapping mechanism

Three choices:
1. Hand-rolled extension methods (`customer.ToResponse()`) — explicit, zero dependencies, what the guide example shows.
2. AutoMapper or Mapperly — less boilerplate but adds a dependency.
3. Constructor on the response record taking the entity — concise but couples the DTO to the entity.

**Recommendation:** hand-rolled extension methods in a `Mappings/` folder under each service, keeping the mapping next to the service that owns it. This matches the guide's "Manual DTO Mapping" key decision.

### Decision 3 — Repository interface shape

Repositories return **entities**, never DTOs. They can accept filter records (`new CustomerFilter(...)`) but should not contain business rules.

```csharp
public interface ICustomerRepository
{
    Task<IReadOnlyList<Customer>> GetAllAsync(CustomerFilter filter, CancellationToken cancellationToken);
    Task<Customer?> GetByIdAsync(long id, CancellationToken cancellationToken);
    Task UpdateAsync(Customer customer, CancellationToken cancellationToken);
    // …
}
```

Service does the entity → response mapping and any logic.

### Decision 4 — Tests

Test coverage is thin: 4 controller-level files + 2 utility files. Before refactoring each domain, add at least one "golden path" integration-style test for each affected endpoint so regression detection isn't purely manual. Use `WebApplicationFactory<Program>` with an in-memory or test-container SQL Server.

**This adds work but it's the only way to keep this refactor from being a leap of faith.**

---

## Phase plan

Phases are independent enough to ship one at a time. After each, the app builds, tests pass, and the SPA continues to work.

---

### Phase 0 — Mechanical cleanup (no structural change)

Independent of the layering work. Reduces noise so the structural diffs are cleaner.

| # | Task | Source |
|---|------|--------|
| 0.1 | Convert 4 request DTOs to records + move `UpdateCustomerRequest.cs` → `Models/Requests/` | Old Plan Issue 1 |
| 0.2 | Convert the 23 response DTOs in `UsageDashboardDtos.cs` to records; move `ClickEventRequest` to `Models/Requests/ClickEventRequest.cs` | Old Plan Issue 2 (corrected) |
| 0.3 | Rename `CancellationToken ct` → `cancellationToken` across 10 files | Old Plan Issue 3 |
| 0.4 | Add `[Produces("application/json")]` + `[ProducesResponseType]` on `UserTradeUnitsController` | Old Plan Issue 4 |
| 0.5 | Add `{id:int}` route constraints to 4 routes (Planting × 2, SavedLists × 2) | Old Plan Issue 5 |
| 0.6 | (DEFER) XML `<summary>` docs — skip unless `<GenerateDocumentationFile>true</GenerateDocumentationFile>` is also enabled | Old Plan Issue 6 |

**Verification:** `dotnet build` + `dotnet test`. No behavior change.

---

### Phase 1 — Create `Infrastructure` project, move EF artifacts only

Pure file relocation + project plumbing. No service-layer changes yet.

**Steps:**

1. `dotnet new classlib -n GrainOriginatorPortal.Infrastructure -o api/GrainOriginatorPortal.Infrastructure --framework net10.0`
2. Add to solution: `dotnet sln GrainOriginatorPortal.sln add api/GrainOriginatorPortal.Infrastructure/GrainOriginatorPortal.Infrastructure.csproj`
3. `dotnet add api/GrainOriginatorPortal.Api/GrainOriginatorPortal.Api.csproj reference api/GrainOriginatorPortal.Infrastructure/GrainOriginatorPortal.Infrastructure.csproj`
4. Move physical files (preserve git history with `git mv`):
   - `api/GrainOriginatorPortal.Api/Data/*.cs` → `api/GrainOriginatorPortal.Infrastructure/Data/`
   - `api/GrainOriginatorPortal.Api/Data/Migrations/` → `api/GrainOriginatorPortal.Infrastructure/Data/Migrations/`
   - All entity files from `api/GrainOriginatorPortal.Api/Models/*.cs` (the list above) → `api/GrainOriginatorPortal.Infrastructure/Data/Entities/`
5. Update namespaces inside moved files: `GrainOriginatorPortal.Api.Data` → `GrainOriginatorPortal.Infrastructure.Data`; `GrainOriginatorPortal.Api.Models` → `GrainOriginatorPortal.Infrastructure.Data.Entities` for entity types.
6. Add `Infrastructure/DependencyInjection.cs` with `public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)` containing the three `AddDbContext<>` blocks currently in `Program.cs`.
7. Replace those `AddDbContext` blocks in `Program.cs` with a single `builder.Services.AddInfrastructure(builder.Configuration);`.
8. Fix `using` statements across the Api project (Controllers, Services, the existing `SqlDataService`, `ApimDataService`, `Filters`, etc.) so they reference the new namespaces.
9. Update `GlobalUsings.cs`: add `global using GrainOriginatorPortal.Infrastructure.Data.Entities;` so controllers and services continue to resolve `Customer`, `Note`, etc. by short name **temporarily** — this will be cleaned up in Phase 3 when controllers stop seeing entities.
10. Move EF tooling support: `ApplicationDbContextFactory.cs` follows the DbContext. Run `dotnet ef migrations list -p api/GrainOriginatorPortal.Infrastructure -s api/GrainOriginatorPortal.Api` to confirm the design-time factory still resolves.
11. Tests project: add reference to `Infrastructure` if any test reaches into entities.

**Verification:**
- `dotnet build GrainOriginatorPortal.sln` clean.
- `dotnet test` all green.
- `dotnet ef migrations list` works.
- Run the API; smoke-test 4–5 endpoints across domains.

**Risk:** EF migration tooling needs both `-p Infrastructure` and `-s Api` flags after the move. Document this in `developer-docs/` if not already there.

---

### Phase 2 — Introduce repository layer per domain

One domain at a time. Each domain's PR is independently shippable.

**Pattern per domain** (using Customer as the example):

1. Create `Infrastructure/Interfaces/ICustomerRepository.cs` with method signatures lifted from the customer-related members of `IDataService`.
2. Create `Infrastructure/Repositories/CustomerRepository.cs` implementing it. Move the corresponding method bodies out of `SqlDataService` into `CustomerRepository`. Keep `IHttpContextAccessor` / `ILogger` / `IMemoryCache` injection where needed.
3. Register in `Infrastructure/DependencyInjection.cs`: `services.AddScoped<ICustomerRepository, CustomerRepository>();`
4. In `SqlDataService`, keep the `IDataService.GetCustomersAsync(...)` etc. methods, but make them **call** `_customerRepository.GetAllAsync(...)`. `SqlDataService` now becomes a passthrough during the transition.
5. Run tests, smoke-test endpoints. No behavior change.

**Domain order** (smallest-blast-radius first → biggest):

1. `IQueryLibraryRepository` (~2 methods, low traffic)
2. `ICommodityRepository` (~3 methods)
3. `IStoredGrainRepository` (~2 methods)
4. `ISavedListRepository` (~3 methods)
5. `IProducerDetailsRepository` (~4 methods)
6. `IFarmRepository` (~4 methods)
7. `IPlantingIntentionRepository` (~6 methods)
8. `INoteRepository` (~7 methods)
9. `ITicketRepository` (~4 methods)
10. `IContractRepository` (~7 methods)
11. `IDashboardRepository` (~9 methods)
12. `ICustomerRepository` (~6 methods, but Customer is referenced by nearly everything else)
13. `IBidSheetRepository` (~14 methods — largest)

Also extract the **helpers** in `SqlDataService` (`SanitizeCsv`, `SanitizeIdentifierCsv`, `ResolveDisplayNamesAsync`, `GetCurrentUser`, `GetTraceId`):
- `SanitizeCsv` + `SanitizeIdentifierCsv` → `Infrastructure/Data/SqlSanitization.cs` (static utility).
- `ResolveDisplayNamesAsync` → `IDisplayNameLookupRepository` (it queries `UserTradeUnitSnapshot`, so it's a repo concern).
- `GetCurrentUser` + `GetTraceId` → these read `IHttpContextAccessor`. They belong on a request-scoped helper in `Api/Services/` (e.g., `IRequestContextService`) since they're about the *current request*, not data.

**Verification per domain:**
- `dotnet build` clean.
- `dotnet test` all green for the affected controller's test file.
- Add a golden-path test for the domain if one doesn't exist.

**Exit criterion for Phase 2:** `SqlDataService` contains zero EF / SQL code — every method just forwards to a repository.

---

### Phase 3 — Introduce service layer + response DTOs per domain

Same domain order as Phase 2. For each domain:

1. Create `Api/Services/I{Domain}Service.cs` and `Api/Services/{Domain}Service.cs`.
2. Service constructor injects the corresponding `I{Domain}Repository` from Phase 2 (and any other dependencies — e.g., `INoteService` injects `ICustomerTradeUnitRepository` for the trade-unit lookup currently inline in `NotesController.Create`).
3. Create response DTOs under `Api/Models/Responses/`. Initial shape = entity shape (Decision 1). Use `record` + `init`. One file per type.
4. Create mapping extension methods under `Api/Services/Mappings/{Domain}Mappings.cs` — pure entity → response DTO transformations.
5. Service methods return DTOs, never entities. Move any business logic currently in the controller (e.g., the customer-tradeunit derivation in `NotesController.Create`) into the service.
6. Migrate the controller:
   - Constructor: replace `IDataService _dataService` with `I{Domain}Service _service`.
   - Action methods: return DTOs from the service.
   - Remove any `DbContext` injection (move that data work into the new service + repository).
   - Stays unchanged: `[ApiController]`, `[Authorize]`, route templates, `[Produces]`/`[ProducesResponseType]` (update typeof to the new DTO type).
7. Update the controller's test fixture: mock `I{Domain}Service` instead of `IDataService`. Update existing tests to assert against DTOs.

**Verification per domain:**
- `dotnet build` + `dotnet test`.
- Manually exercise endpoints via the SPA — the wire shape stays compatible (because of Decision 1).

**Exit criterion for Phase 3:** every controller in the `IDataService` family injects a domain service, not `IDataService`. No controller injects a `DbContext`.

---

### Phase 4 — Migrate controllers that bypass `IDataService` today

These need new services from scratch (no `SqlDataService` chunk to lift).

| Controller | New service | New repository | Notes |
|------------|-------------|----------------|-------|
| `UsageDashboardController` (1041 lines) | `IUsageDashboardService` | `IUsageRepository` | Most work. Lift the two private helpers and 8+ endpoint-specific aggregations into the service. Keep DTO shape unchanged on the wire. |
| `UserPreferencesController` (65 lines) | `IUserPreferenceService` | `IUserPreferenceRepository` | Small. Trivial migration. |
| `UserTradeUnitsController` (99 lines) | `IUserTradeUnitService` | `IEntitlementsRepository` (+ `ICustomerTradeUnitRepository` for fallback) | Move the file-scoped `UserTradeUnitRow` private class into the service. |
| `GeocodeController` (307 lines) | `IGeocodeService` | (no repository — HTTP integration) | Service owns the `IHttpClientFactory` + cache. Move the static `_rateLimiter` / `_lastNominatimCall` into the service as a singleton-scoped field. Controller becomes ~30 lines. |
| `DiagnosticsController` (601 lines) | `IDiagnosticsService` (optional) | direct DbContexts acceptable here | Dev-only. Acceptable to keep DbContext injection since it's diagnostic-by-design. If migrated, gate it on `IsDevelopment` only. |
| `NotesController` (one inline DB query) | already migrated in Phase 3 | move the inline `CustomerTradeUnits` lookup into `NoteService` | Small cleanup. |

**Verification:** integration tests on `/api/usage-dashboard/*` paths, `/api/userpreferences`, `/api/usertradeunits`, `/api/geocode/*`.

---

### Phase 5 — Delete the placeholders

1. Delete `Api/Interfaces/IDataService.cs`.
2. Delete `Api/Services/SqlDataService.cs`.
3. Delete `Api/Services/ApimDataService.cs`. (If APIM is genuinely on the roadmap, replace it with HTTP-based repositories — one per domain — implementing the same `IxxxRepository` contracts. This becomes a switchable registration in `DependencyInjection.cs`.)
4. Remove `using GrainOriginatorPortal.Api.Interfaces;` from `Program.cs` and `GlobalUsings.cs`.
5. Remove the `global using GrainOriginatorPortal.Infrastructure.Data.Entities;` line added in Phase 1 step 9 — at this point, no Api-layer code outside the `Mappings/` folders should reference entity types.

**Verification:** `dotnet build` clean, `dotnet test` green, smoke test the SPA.

---

### Phase 6 — Background services + cross-cutting cleanup

Now that repositories exist, the long-running services should use them:

- `CustomerSyncService` → inject `ICustomerSyncRepository` instead of resolving `ApplicationDbContext` / `OriginationDbContext` from a scope. Service stays in `Api/Services/` (orchestration).
- `UsageTrackingBackgroundService` → inject `IUsageRepository`. Currently calls `db.UserActivities.Add(...)` in a `foreach`; that pattern moves to `usageRepository.AddBatchAsync(...)`.
- `UsageAggregationBackgroundService` → inject `IUsageRepository`.
- `UserEntitlementService` → inject `IEntitlementsRepository` instead of `EntitlementsDbContext` directly.

**Verification:** start the app, watch background-service log output for one full cycle (~5 minutes of customer sync) to confirm no regressions.

---

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| **SPA contract breakage during entity → DTO migration.** | Decision 1: keep DTO property names identical to entity shape. Reshape only when there's a specific reason. SPA changes deferred to a separate effort. |
| **Refactoring without test coverage.** | Add at least one golden-path test per domain before its Phase 2 PR. `WebApplicationFactory<Program>` is the fastest path. |
| **EF migrations break after DbContext moves.** | Test `dotnet ef migrations list -p Infrastructure -s Api` immediately after Phase 1. Document the new flags in `developer-docs/`. |
| **Phase 1 touches every file's `using` directives** — large mechanical diff, hard to review. | Land Phase 1 as a single PR with no other changes. Reviewer focuses on namespaces and references, not logic. |
| **Performance regression from extra mapping layer.** | Manual mapping is cheap. If hot paths emerge, profile before optimizing — don't pre-emptively cache or skip mapping. |
| **`SqlDataService` helpers (`SanitizeCsv`, etc.) are referenced from tests.** | `SanitizeCsvTests.cs` exists. Update test using-statements to point at the new static class. |
| **Refactor lands while feature work is in flight on the same files.** | Each phase is a discrete PR. Coordinate timing with whoever's editing `NotesController` / `BidSheetController` etc. Merge-conflict cost is real for the 13 services. |
| **Half-done migration becomes the new permanent state.** | Treat Phase 5 (deletions) as a hard exit gate. If Phase 5 doesn't ship, the codebase is in a worse state than before — two patterns coexist. |

---

## Out of scope

These belong in their own efforts:

- **Angular client refactor.** This plan keeps response DTOs entity-shaped on purpose. Reshaping the wire contract is a separate exercise.
- **Two-database consolidation.** Three DbContexts (ODS / Application / Entitlements) remain. Merging them is a database concern, not a code-layering one.
- **`base.Contract` historical schema cleanup.** SQL-side concern.
- **Permissions model rebuild.** Tracked by `style-guides/permissions-model-guide.md`; out of scope here.
- **Logging / observability rework.** `style-guides/logging-guide.md` audit is separate.
- **APIM backend implementation.** Phase 5 deletes the placeholder. If APIM goes live, that's a Phase 7 (HTTP-based repositories) not covered here.

---

## Acceptance criteria (overall)

Refactor is done when **all** of these hold:

- [ ] `GrainOriginatorPortal.Infrastructure` project exists with `Data/`, `Repositories/`, `Interfaces/`, `DependencyInjection.cs`.
- [ ] `Api` references `Infrastructure`. `Infrastructure` has zero references to `Api`.
- [ ] No controller injects a `DbContext`, `IMemoryCache`, or `IHttpClientFactory` directly (except `DiagnosticsController`, by exemption).
- [ ] No controller returns an EF entity type. Every `ActionResult<T>` resolves to a type under `Models/Responses/`.
- [ ] No service injects a `DbContext`. Services depend on `I{Domain}Repository` only (plus other services + cross-cutting concerns like `ILogger`, `IHttpContextAccessor`).
- [ ] `IDataService`, `SqlDataService`, `ApimDataService` are deleted.
- [ ] `dotnet build` clean, `dotnet test` green, smoke test passes for every controller's primary endpoint.

---

## Sequencing summary

```
Phase 0  ── mechanical cleanup (independent, can interleave with anything)
Phase 1  ── create Infrastructure project, relocate EF artifacts
   └── Phase 2.1 .. 2.13  ── one repository per domain (13 PRs)
         └── Phase 3.1 .. 3.13  ── one service + DTOs per domain (13 PRs)
               └── Phase 4  ── migrate non-IDataService controllers
                     └── Phase 5  ── delete SqlDataService + IDataService + ApimDataService
                           └── Phase 6  ── background services + cross-cutting cleanup
```

Each leaf is independently shippable. Total: roughly 30 PRs, sequenced over weeks-to-months depending on parallelism with feature work.

---

## Verification matrix (per phase)

| Phase | Build | Test | EF migrations | SPA smoke | Golden-path tests |
|-------|-------|------|---------------|-----------|-------------------|
| 0     | ✓     | ✓    | n/a           | optional  | n/a               |
| 1     | ✓     | ✓    | ✓             | ✓         | n/a               |
| 2.x   | ✓     | ✓    | n/a           | per-domain| **add if missing** |
| 3.x   | ✓     | ✓    | n/a           | per-domain| update mocks      |
| 4     | ✓     | ✓    | n/a           | ✓ (UsageDashboard especially) | add for usage endpoints |
| 5     | ✓     | ✓    | n/a           | ✓         | n/a               |
| 6     | ✓     | ✓    | n/a           | watch background-service logs for one cycle | n/a |
