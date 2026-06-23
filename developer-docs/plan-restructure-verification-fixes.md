# Restructure Verification — Findings & Fix Plan

*Created 2026-06-16. Verifies the completed `rebuild_CodeRestructure` branch against
plan-csharp-standards-updates2.md. Branch state: Phases 0–6 committed (HEAD `b1f940f`).
Scope APPROVED 2026-06-16 with corrections (see Execution order).*

---

## Verdict

The refactor is **structurally sound and stable**. `dotnet build` is clean (0 errors)
and `dotnet test` is green (36/36). All seven acceptance criteria are substantively met.
The items below are **cleanup and completeness gaps**, not functional breakage.

### Acceptance criteria — status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `Infrastructure` project with `Data/ Repositories/ Interfaces/ DependencyInjection.cs` | ✅ PASS |
| 2 | `Api → Infrastructure`; Infrastructure has zero refs to Api | ⚠️ PASS w/ cosmetic exception (migration namespaces, see E) |
| 3 | No controller injects `DbContext`/`IMemoryCache`/`IHttpClientFactory` (except Diagnostics) | ✅ PASS |
| 4 | No controller returns an EF entity; all return `Models/Responses` types | ✅ PASS (all 20 controllers verified) |
| 5 | No service injects `DbContext` | ✅ PASS |
| 6 | `IDataService`/`SqlDataService`/`ApimDataService` deleted | ✅ PASS (only comment references remain) |
| 7 | Build clean, tests green | ✅ PASS |

---

## Issues

### A. Orphaned dead test project + stale `IDataService` tests — **HIGH (cleanup)**

The **outer** `api/GrainOriginatorPortal.Api.Tests/` holds a stray `.csproj` (NOT in the solution)
plus four stale files that still `new Mock<IDataService>()` — referencing the deleted interface:
`ControllerAuthorizationTests.cs`, `NotesControllerTests.cs`, `PlantingIntentionsControllerTests.cs`,
`SavedListsControllerTests.cs`. They aren't compiled (the real project is the inner nested folder),
so they rot silently and will fail to compile if anyone re-adds the outer project.

**Fix:** delete the outer `.csproj`, the four stale `.cs` files, the stray
`api/GrainOriginatorPortal.Api.Tests/packages.lock.json`, and stale `bin/`/`obj/`.
Solution already references only the inner project (outer `.sln` entry is a solution folder).

### B. Test coverage regression — **HIGH (highest value)**

`ControllerAuthorizationTests` and `SavedListsControllerTests` existed **only** in the orphaned
outer project, so they were never in the compiled 36-test suite — that coverage is gone now.
(Notes/Planting are fine — inner copies were updated.)

**Fix:** re-create both in the inner project (`SavedListsControllerTests` against `ISavedListService`/
real DI). Then incrementally backfill golden-path tests for the highest-risk untested domains
(Contracts, Tickets, BidSheet, Usage) — Decision 4 of the original plan.

### C. `global using` entities/repos still present — **MEDIUM (reframed)**

[GlobalUsings.cs](../api/GrainOriginatorPortal.Api/GlobalUsings.cs) lines 17 + 19:

```csharp
global using GrainOriginatorPortal.Infrastructure.Data.Entities;   // line 17
global using GrainOriginatorPortal.Infrastructure.Repositories;    // line 19
```

Goal is **"make entity usage explicit/greppable,"** NOT eliminate it. Removing line 17 forces a
scoped `using …Data.Entities;` into ~15–20 service files that legitimately construct entities for
writes (CustomerSync, both Usage services, Dashboard/BidSheet/Note/Planting/ProducerDetails/
SavedList/Customer) — expected and fine. Full elimination would require pushing entity
construction into repos (out of scope).

Line 19 is the more meaningful, smaller fix. Only ~5 files use it (CustomersController,
CustomerService/ICustomerService, BidSheetService, CustomerMappings), only because contract types
(`AssignTradeUnitsResult`, `DeactivateTradeUnitResult`, `BidUpsertInput`,
`CustomerTradeUnitMembership`) live in the impl namespace. **Fix = relocate those contract types
to a non-impl namespace** (e.g. `Infrastructure.Abstractions`/`…Contracts`); then line 19 disappears.

### F. EF migration tooling not verified / flags not documented — **MEDIUM (verification)**

The design-time factory moved to Infrastructure in Phase 1, so
`-p api/GrainOriginatorPortal.Infrastructure -s api/GrainOriginatorPortal.Api` is now mandatory and
was never re-run after the move.

**Fix:** actually run `dotnet ef migrations list` with those flags to confirm the factory resolves,
then add the flags + an `ef migrations add` example to a real developer-docs page.

### Deferred (agreed)

- **D** — split `UsageDashboardDtos.cs` (already records ✅) / move `CustomerTradeUnitInfo.cs` to `Models/Responses/`: pure cosmetics.
- **E** — rename migration namespaces (`…Api.Migrations.ApplicationDb`): churn, zero functional value, minor tooling risk; arguably never.
- **G** — `System.Security.Cryptography.Xml` NU1903 (transitive via `Microsoft.Data.SqlClient`): belongs with the Dependabot/security pass.

---

## Execution order (APPROVED — B → A → F → C) — ✅ COMPLETED 2026-06-16

1. **B — ✅ DONE.** Re-created `ControllerAuthorizationTests` (now covers all 20 controllers) and
   `SavedListsControllerTests` (against `ISavedListService`) in the inner project. Test count
   36 → **82**. Golden-path backfill for Contracts/Tickets/BidSheet/Usage remains as incremental
   follow-up (not blocking).
2. **A — ✅ DONE.** `git rm`'d the orphaned outer `.csproj` + 4 stale `IDataService` test files +
   stray `packages.lock.json`; cleaned stale `bin/`/`obj/`. Outer dir now holds only the real
   nested project.
3. **F — ✅ DONE.** Ran `dotnet ef migrations list -p Infrastructure -s Api --context ApplicationDbContext`
   — design-time factory resolves and lists all migrations. Documented the split flags +
   `az login` requirement in `developer-docs/GITHUB-ACTIONS-CICD.md`.
4. **C — ✅ DONE.** Removed the entities `global using` (line 17) and added explicit scoped
   `using …Data.Entities;` to the **24** Api files that legitimately touch entities (13 mappings +
   9 services + `DiagnosticsController`). Relocated the 4 repository contract types
   (`AssignTradeUnitsResult`, `DeactivateTradeUnitResult`, `CustomerTradeUnitMembership`,
   `BidUpsertInput`) to a new `GrainOriginatorPortal.Infrastructure.Abstractions` namespace
   (`Infrastructure/Abstractions/`) and removed the `Infrastructure.Repositories` global using
   (line 19). No Api code references the impl namespace anymore (verified by grep — only the
   explanatory comment remains).

**Final verification:** `dotnet build GrainOriginatorPortal.sln` clean (0 errors) + `dotnet test`
**82/82 green**. EF `migrations list` resolves with the new flags.

### C, extended — ✅ DONE (internal-consistency polish)

Final sweep found the same impl-namespace coupling **inside** Infrastructure (not crossing into Api):
two interface contracts imported `…Infrastructure.Repositories` for sibling types living in the impl
folder. Fixed for consistency:
- `Repositories/UsageProjections.cs` (the ~16 projection records + `CustomerNameSnapshot`) → moved to
  `Abstractions/UsageProjections.cs`.
- `CurrentCustomerRow` → extracted from inside `CustomerSyncRepository.cs` to `Abstractions/CurrentCustomerRow.cs`.
- `IUsageRepository` + `ICustomerSyncRepository` (and their impls) now import `.Abstractions`.

Result: **no repository interface depends on the impl namespace.** The only remaining
`Infrastructure.Repositories` import is `DependencyInjection.cs` (correct — it registers the impls).
Verified: `dotnet build` clean + `dotnet test` 82/82 green.

### Remaining (deferred, not blocking)

- Golden-path tests for Contracts / Tickets / BidSheet / Usage domains (Decision 4 backfill).
- D / E / G as described above.
