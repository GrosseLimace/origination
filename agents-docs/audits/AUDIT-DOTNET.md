# Audit: .NET (`dotnet`)

Style guide: `style-guides/csharp.md`
Scope: `api/GrainOriginatorPortal.Api`, `api/GrainOriginatorPortal.Infrastructure`, `api/GrainOriginatorPortal.Api.Tests`

**Findings:** 17 open — 0 critical, 4 high, 5 medium, 8 low
**Opened:** 2026-09-19 | **Last verified:** 2026-09-19

## High

### SecurityAuditMiddleware never runs for the 401/403 cases it exists to log (`dotnet.security-audit-middleware-dead-code`)
- **Files:** `api/GrainOriginatorPortal.Api/Middleware/SecurityAuditMiddleware.cs`, `api/GrainOriginatorPortal.Api/Program.cs`
- The middleware is placed after `app.UseAuthorization()` assuming the response status is finalized there, but ASP.NET Core's authorization middleware short-circuits (Challenge/Forbid) without calling `next()` on standard `[Authorize]` failures — virtually every endpoint. No `IAuthorizationMiddlewareResultHandler` is registered to preserve pipeline continuation, so the security-guide's "log auth denials" control is silently dead code for most real 401/403s.
- **Suggested fix:** Implement a custom `IAuthorizationMiddlewareResultHandler` (or hook the JWT `OnForbidden`/`OnChallenge` events) to log denials, rather than relying on downstream middleware the framework bypasses.

### DiagnosticsController bypasses the service layer and repeats the outbound-call anti-pattern the style guide singles out (`dotnet.diagnostics-controller-bypasses-service-layer`)
- **Files:** `api/GrainOriginatorPortal.Api/Controllers/DiagnosticsController.cs`
- Injects three `DbContext`s and `IHttpClientFactory` directly, runs raw SQL via `SqlQueryRaw`, hand-writes upsert/seed logic with manual `SaveChangesAsync`, and loops over collections making one outbound HTTP call per item inside local try/catch instead of the `GlobalExceptionHandler`.
- **Suggested fix:** Extract schema-introspection, sync, and geocoding concerns into dedicated services (mirroring the existing `CustomerSyncService` pattern) and let exceptions flow to `GlobalExceptionHandler`.

### Duplicated, ad hoc entitlement-catalog logic embedded in two controllers (`dotnet.duplicated-entitlement-catalog-logic`)
- **Files:** `api/GrainOriginatorPortal.Api/Controllers/NotesController.cs`, `api/GrainOriginatorPortal.Api/Controllers/EntitlementsController.cs`
- `NotesController.GetMentionCatalog` and `EntitlementsController.GetCatalog` both inject `TradeUnitPreferencesDbContext` directly and implement near-identical LINQ-heavy trade-unit/group expansion inline, each with its own `try/catch(Exception)` fail-open behavior.
- **Suggested fix:** Extract a shared `IEntitlementsCatalogService` consumed by both controllers; keep the documented fail-open behavior but implement it once.

### Trade-unit entitlement filtering is inconsistently applied across sibling bulk-read endpoints (`dotnet.inconsistent-trade-unit-entitlement-filtering`)
- **Files:** `api/GrainOriginatorPortal.Api/Controllers/StoredGrainController.cs`, `api/GrainOriginatorPortal.Api/Controllers/DpContractsController.cs`, `api/GrainOriginatorPortal.Api/Filters/EnforceTradeUnitAccessAttribute.cs`
- `StoredGrainController` and `DpContractsController` bind a raw `string? tradeUnits` and carry no `[EnforceTradeUnitAccess]` filter, unlike sibling Farms/Tickets/Contracts/Customers endpoints that bind `List<string>? tradeUnits` with enforcement. The shared attribute also silently no-ops on any future action parameter shape it doesn't recognize.
- **Related findings:** `permissions.enforce-trade-unit-access-silent-noop`
- **Suggested fix:** Align both controllers to `List<string>? tradeUnits` + `[EnforceTradeUnitAccess]` (or add an explicit accepted-risk note), and log when no recognized parameter shape is found.

## Medium

### GlobalExceptionHandler swallows all OperationCanceledException as an unlogged client-disconnect (`dotnet.exception-handler-swallows-cancellation`)
- **Files:** `api/GrainOriginatorPortal.Api/Middleware/GlobalExceptionHandler.cs`
- Maps `OperationCanceledException` to an unlogged HTTP 499 unconditionally without checking `httpContext.RequestAborted.IsCancellationRequested`, so an uncaught internal timeout would be silently discarded instead of logged at Error per `error-handling.md`.
- **Suggested fix:** Only treat as unlogged 499 when `RequestAborted.IsCancellationRequested` is true; otherwise log at Error as an infrastructure timeout.

### Inconsistent EF Core command-timeout configuration across the four DbContexts (`dotnet.inconsistent-ef-command-timeout`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/DependencyInjection.cs`
- `OriginationDbContext` and `DpOdsDbContext` set `CommandTimeout(120)`; `ApplicationDbContext` and `TradeUnitPreferencesDbContext` fall back to the 30s SQL default even though the team already knows 30s is sometimes too tight.
- **Suggested fix:** Set an explicit `CommandTimeout` on `ApplicationDbContext` and `TradeUnitPreferencesDbContext`, or document why the 30s default is safe for both.

### EF InMemory test-deviation tracking comment is stale and understates real usage (`dotnet.stale-inmemory-deviation-comment`)
- **Files:** `api/GrainOriginatorPortal.Api.Tests/GrainOriginatorPortal.Api.Tests/GrainOriginatorPortal.Api.Tests.csproj`
- The csproj's "DEVIATION" comment names only two files as users of the banned `Microsoft.EntityFrameworkCore.InMemory` package, but neither uses `.UseInMemoryDatabase` anymore while seven other untracked files do.
- **Suggested fix:** Update the csproj comment and migration plan to name the actual seven files so remediation is scoped against reality.

### Controller test coverage gap — 9 of 23 controllers have zero test at any layer (`dotnet.controller-test-coverage-gap`)
- **Files:** `ContractsController.cs`, `FarmsController.cs`, `MeController.cs`, `StoredGrainController.cs`, `TicketsController.cs`
- Only 8 controllers have a dedicated behavior test file; `MeController` stands out with untested role-resolution branching logic across three claim-name sources plus synthetic role injection.
- **Suggested fix:** Prioritize `MeControllerTests.cs` for role-resolution branches, then TicketsController/StoredGrainController/FarmsController.

### Repository test coverage gap — largest, most complex repositories are untested (`dotnet.repository-test-coverage-gap`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/TicketRepository.cs`, `api/GrainOriginatorPortal.Infrastructure/Repositories/UsageRepository.cs`
- 15 of 21 repositories have zero direct test. `TicketRepository` (729 lines) and `UsageRepository` (915 lines) are the largest files in the folder with zero direct coverage of their query/mutation logic.
- **Related findings:** `test-gaps.repository-layer-gap`
- **Suggested fix:** Add targeted repository tests (real-SQL WebApplicationFactory harness) for `TicketRepository` and `UsageRepository` first.

## Low

### DTOs defined inline in controller files as mutable classes instead of Models/Responses records (`dotnet.dtos-inline-in-controllers`)
- **Files:** `EntitlementsController.cs`, `MeController.cs`, `Models/Responses/UserPreferenceDto.cs`, `Models/Responses/DashboardSummaryResponse.cs`
- Breaks the otherwise-consistent convention (34 files in `Models/Responses`) of one record-per-file with init-only properties.
- **Suggested fix:** Move these into `Models/Responses` as records with init accessors.

### EnforceTradeUnitAccessAttribute silently no-ops on convention drift (`dotnet.entitlement-attribute-silent-noop`)
- **Files:** `api/GrainOriginatorPortal.Api/Filters/EnforceTradeUnitAccessAttribute.cs`
- Independently actionable detail of the trade-unit entitlement filtering finding: the attribute has no observability when no recognized action-parameter shape is found on a decorated action.
- **Related findings:** `dotnet.inconsistent-trade-unit-entitlement-filtering`
- **Suggested fix:** Add a debug/warn log when no recognized action-parameter shape is found.

### File-organization drift from "one type per file" (`dotnet.usage-dashboard-dtos-file-organization`)
- **Files:** `api/GrainOriginatorPortal.Api/Models/UsageDashboardDtos.cs`
- Bundles roughly 30 unrelated record types in a single file, versus the one-type-per-file convention followed elsewhere.
- **Suggested fix:** Split into individual files under `Models/Responses`, or explicitly note this file as a deliberate grouping exception.

### Dead CancellationToken parameter in DiagnosticsController.StartElevatorGeocode (`dotnet.dead-cancellation-token-param`)
- **Files:** `api/GrainOriginatorPortal.Api/Controllers/DiagnosticsController.cs`
- Declares a `CancellationToken` parameter that is never used; the fire-and-forget `Task.Run` captures a fresh `IServiceScopeFactory` instead, making the parameter misleading dead code.
- **Suggested fix:** Remove the unused parameter or wire it into the background task's cancellation path.

### Duplicated hand-rolled parameter validation instead of a request DTO (`dotnet.duplicated-param-validation`)
- **Files:** `api/GrainOriginatorPortal.Api/Controllers/DashboardPlantingEstimatesController.cs`
- A private `ValidateDashboardParams()` checking tradeUnitKey/plantingYear is duplicated across 4 GET actions, while every other validated input in the codebase uses a request record with data annotations.
- **Suggested fix:** Replace with a `[FromQuery]` request record using data-annotation validation.

### CorrelationIdMiddleware accepts the inbound X-Correlation-Id header unbounded and unvalidated (`dotnet.correlation-id-header-unbounded`)
- **Files:** `api/GrainOriginatorPortal.Api/Middleware/CorrelationIdMiddleware.cs`
- The header value is used verbatim (no length cap, no charset restriction), echoed into the response and threaded into every structured log entry, letting a caller inject an arbitrarily long or control-character value.
- **Related findings:** `logging.correlation-id-unvalidated`
- **Suggested fix:** Cap length (e.g. 64 chars) and restrict to alnum+hyphen, falling back to a generated GUID otherwise.

### Repository interface return-type inconsistency (`dotnet.repository-interface-return-type-inconsistency`)
- **Files:** `ITicketRepository.cs`, `IContractRepository.cs`, `ICustomerRepository.cs`, `IBidSheetRepository.cs`, `IDashboardRepository.cs`
- Most repository interfaces return `Task<List<T>>` for read-only collections while a minority correctly return `Task<IReadOnlyList<T>>` per the style guide.
- **Suggested fix:** Standardize on `IReadOnlyList<T>`/`IReadOnlyCollection<T>` for read-only collection return types.

### Redundant re-fetch in ProducerDetailsRepository.UpsertAsync (`dotnet.redundant-refetch-producer-details`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/ProducerDetailsRepository.cs`
- After rebuilding grain-on-farm and contact child rows in memory and saving, the method re-queries them via separate calls instead of reusing the in-memory values.
- **Related findings:** `performance.producer-details-redundant-refetch`
- **Suggested fix:** Project the response directly from the in-memory `grainItems`/`contactItems` collections instead of re-querying after save.
