# Audit: Clean Slop (`clean-slop`)

Scope: dead code, duplication, and stale artifacts across `api/`, `client/`, `scripts/`, and `SECURITY-REVIEWS/scripts/`

**Findings:** 23 open — 0 critical, 5 high, 12 medium, 6 low
**Opened:** 2026-09-19 | **Last verified:** 2026-09-19

## High

### qa-setup.sql can silently resurrect a trade-unit catalog schema that was deliberately removed (`clean-slop.qa-setup-resurrects-removed-tradeunit-catalog`)
- **Files:** `scripts/qa-setup.sql`, `Migrations/20260513051734_RemoveTradeUnitCatalog.cs`
- The guard only checks table existence; running against an environment where the removal migration already applied would silently resurrect the deprecated `TradeUnits`/`TradeUnitGroups`/`GroupTradeUnits` catalog, deliberately superseded by `vw_UserTradeUnitAccess`.
- **Related findings:** `performance.grouptradeunits-missing-index`, `sql.grouptradeunits-fk-missing-index`
- **Suggested fix:** Delete the stale table-creation blocks from `qa-setup.sql`.

### Entire Farms REST API is a non-functional stub with no caller (`clean-slop.dead-farms-api-vertical`)
- **Files:** `Controllers/FarmsController.cs`, `Services/FarmService.cs`, `Services/IFarmService.cs`, `Repositories/FarmRepository.cs`, `Interfaces/IFarmRepository.cs`
- `FarmRepository` is explicitly documented as a stub since no Farms table exists in the ODS: every read logs a warning and returns empty/null, `CreateAsync` throws `NotImplementedException`. Zero Angular callers and no other C# caller beyond DI registration — a full dead vertical slice.
- **Suggested fix:** Remove the whole Farms vertical, or explicitly return 501/404 and drop the pretend CRUD surface.

### Four fully unused shared UI components (Footer, Tabs, TabContent, Textarea) (`clean-slop.dead-shared-ui-components`)
- **Files:** `shared/components/footer/footer.component.ts`, `shared/components/tabs/tabs.component.ts`, `shared/components/textarea/textarea.component.ts`
- Never imported by any other file in the client (confirmed via grep for both selectors and class names). All other shared UI primitives in the same directory are actively used.
- **Suggested fix:** Delete all three files unless a near-term feature is already slated to use them.

### adminGuard is dead code, and a comment elsewhere falsely claims it protects a route (`clean-slop.dead-admin-guard-with-stale-comment`)
- **Files:** `guards/admin.guard.ts`, `guards/usage-dashboard.guard.ts`, `app.routes.ts`, `excluded-users-panel.component.ts`
- `adminGuard` is an exact functional duplicate of `usageDashboardGuard` but is never referenced in routing. A comment in `excluded-users-panel.component.ts` incorrectly claims the Usage Dashboard is gated by `adminGuard`; the real guard is `usageDashboardGuard`.
- **Suggested fix:** Delete `admin.guard.ts`; fix the misleading comment to name the guard actually in effect.

### HomeComponent duplicates AppStateService's customers signal, causing an actual sync bug (`clean-slop.duplicate-customers-signal-with-drift-bug`)
- **Files:** `home.component.ts`, `app-state.service.ts`
- Dual bookkeeping has already drifted: `_autoSaveCommodities()` updates the local signal after persisting an auto-merged commodity list but never calls `appState.setCustomers(...)`, leaving the global cache — read directly by build-list, insights, and unshipped-bushels — stale until the next full reload.
- **Related findings:** `angular.components-bypass-app-state-service`
- **Suggested fix:** Read `appState.customers` directly instead of keeping a parallel local signal; at minimum add the missing `setCustomers` call.

## Medium

### Dead duplicate CustomerMapComponent with a colliding selector (`clean-slop.duplicate-customer-map-component`)
- **Related findings:** `angular.duplicate-customer-map-component` — see AUDIT-ANGULAR.md for detail.

### Independently-maintained commodity taxonomy/alias maps overlap but disagree (`clean-slop.duplicated-commodity-taxonomy`)
- **Related findings:** `angular.duplicated-commodity-taxonomy-logic` — see AUDIT-ANGULAR.md for detail.

### Two identically-implemented commodity-conversion-map builders live side by side (`clean-slop.duplicate-conversion-map-builder`)
- **Files:** `contract-status.ts`, `production-coverage.ts`, `build-list.component.ts`, `nlq-filter.service.ts`
- `buildConversionMap()` and `buildLbsPerBushelMap()` are functionally identical and both invoked in the same two files.
- **Suggested fix:** Delete `buildConversionMap` and repoint its call sites at `buildLbsPerBushelMap`.

### Six of nine files in api/GrainOriginatorPortal.Api/Scripts/ are completed one-time migrations never archived (`clean-slop.stale-ops-scripts`)
- **Related findings:** `sql.orphaned-stale-script-nonexistent-column`, `sql.inconsistent-table-definitions-producerdetails-savedlists` — see AUDIT-SQL.md for detail.

### Stale, now-inaccurate one-time BidSheet migration script left at the repo root (`clean-slop.stale-bidsheet-script-repo-root`)
- **Files:** `migrate-bid-sheet.sql`, `scripts/backfill-migration-history.sql`, `scripts/_VerifySchema.sql`
- References a migration id with no corresponding `.cs` file; its DDL no longer matches the live schema (missing `Month` column, missing `BidSheetLocationOrders`/`BidSheetPreferences`).
- **Suggested fix:** Delete or archive `migrate-bid-sheet.sql`.

### _VerifySchema.sql's hand-maintained tracking lists have already drifted from each other, defeating its own purpose (`clean-slop.verify-schema-self-inconsistent-maintenance`)
- **Files:** `scripts/_VerifySchema.sql`
- Its 4 parallel lists have drifted independently; running it today produces false WARN rows instead of ever reporting current.
- **Suggested fix:** Commit to atomic updates per migration PR, or generate the lists programmatically from the EF model snapshot.

### OriginationDbContext has stale commented-out DbSets/model configs for entities that moved elsewhere (`clean-slop.stale-dbset-comments-originationdbcontext`)
- **Files:** `Data/OriginationDbContext.cs`
- Comments claim PlantingIntention/StoredGrain/SavedList tables "don't exist yet," but PlantingIntention/SavedList are now live in `ApplicationDbContext` and StoredGrain is actually configured in this same file — the comments are misleading.
- **Related findings:** `clean-slop.dead-farms-api-vertical`
- **Suggested fix:** Delete the stale commented blocks; keep only the accurate Farm one.

### AppException.Context/WithContext is populated but never read anywhere (`clean-slop.dead-appexception-context-mechanism`)
- **Files:** `Exceptions/AppException.cs`, `Exceptions/NotFoundException.cs`, `Middleware/GlobalExceptionHandler.cs`
- `.Context` is set by `NotFoundException` but never read anywhere in the app or its tests — write-only dead infrastructure.
- **Suggested fix:** Wire `Context` into `GlobalExceptionHandler`'s response, or remove the mechanism entirely.

### Identical 4-source UPN-claim-to-shortname extraction copy-pasted in 3 places instead of reusing IRequestContextService (`clean-slop.duplicated-upn-shortname-claim-chain`)
- **Files:** `Services/RequestContextService.cs`, `Controllers/EntitlementsController.cs`, `Controllers/NotesController.cs`, `Middleware/UsageTrackingMiddleware.cs`, `Controllers/UsageDashboardController.cs`
- Two independently-drifted copies of the same claim-fallback logic across 5 files.
- **Related findings:** `dotnet.duplicated-entitlement-catalog-logic`
- **Suggested fix:** Inject `IRequestContextService` into the two controllers instead of reimplementing inline.

### DiagnosticsController hand-rolls Nominatim geocoding twice instead of using the existing rate-limited/cached IGeocodeService (`clean-slop.diagnostics-controller-reimplements-geocoding`)
- **Files:** `Controllers/DiagnosticsController.cs`, `Services/GeocodeService.cs`, `Controllers/GeocodeController.cs`
- Two near-identical ~35-line blocks reinvent what `GeocodeService` already does, less safely (no cache, no fingerprinted logging).
- **Related findings:** `dotnet.diagnostics-controller-bypasses-service-layer`, `error-handling.diagnostics-geocode-bypasses-nominatim-resilience-pipeline`
- **Suggested fix:** Route both entry points through `IGeocodeService`.

### Dead barrel export file for core services (`clean-slop.dead-core-services-barrel`)
- **Files:** `core/services/index.ts`
- Re-exports only 4 of ~10 services; zero consumers use the barrel import anywhere in the client.
- **Suggested fix:** Delete the file.

### Accounting-currency formatting logic duplicated between a Pipe and a report util (`clean-slop.duplicate-accounting-money-format`)
- **Files:** `shared/pipes/accounting-currency.pipe.ts`, `features/calculators/services/calculator-report.service.ts`
- Byte-for-byte identical formatting logic; the report util's own JSDoc admits the duplication is intentional but unconsolidated.
- **Related findings:** `clean-slop.duplicate-conversion-map-builder`
- **Suggested fix:** Extract one shared `formatAccountingCurrency` function.

## Low

### Location master data hardcoded independently in two scripts with identical row counts (`clean-slop.hardcoded-location-data-duplicated`)
- **Related findings:** `sql.hardcoded-location-data-duplicated` — see AUDIT-SQL.md for detail.

### backfill-migration-history.sql's header comment is factually false about which migrations it covers (`clean-slop.backfill-script-phantom-migration-ids`)
- **Files:** `scripts/backfill-migration-history.sql`, `scripts/README-migrations.md`
- 3 of 8 hardcoded migration ids have no corresponding `.cs` file today.
- **Suggested fix:** Correct the header comment.

### B4_migrate_createdby.sql repeats the same UPDATE/JOIN mapping pattern 18 times instead of building it once (`clean-slop.b4-createdby-repeated-update-blocks`)
- **Related findings:** `sql.ambiguous-displayname-join-createdby-backfill` — see AUDIT-SQL.md for detail.

### CardFooterComponent exported but never consumed (`clean-slop.unused-card-footer-export`)
- **Files:** `shared/components/card/card.component.ts`
- Sibling card components are all used; `CardFooterComponent` has zero import sites.
- **Suggested fix:** Remove the unused export.

### commodityRowClass() helper is dead; callers bypass it (`clean-slop.dead-commodity-row-class-wrapper`)
- **Files:** `shared/utils/commodity-color.ts`, `dashboard.component.ts`
- The one real consumer accesses the underlying object directly instead of using the intended accessor.
- **Suggested fix:** Delete the wrapper or fix the call site to use it.

### Repeated parseJson closure and saved-list payload-building in ApiService (`clean-slop.duplicate-saved-list-payload-building`)
- **Files:** `core/services/api.service.ts`
- Identical parsing/payload-building logic copy-pasted 2-3 times in the same file.
- **Suggested fix:** Hoist to shared private helpers.

## Overall health

The repo shows real engineering care in load-bearing logic undermined by a lack of cleanup discipline: dead components with colliding selectors, a fully-stubbed dead API vertical (Farms) still wired into DI, one-time SQL scripts never archived (extending from `Scripts/` to the repo root and `scripts/`), near-identical helper functions introduced in parallel, self-maintained schema-verification lists that have drifted from reality, and at least one case (the customers-signal duplication) where slop has produced a real, live data-staleness bug rather than just dead weight. None of the anticipated leads were false alarms. The SQL-side findings point at a genuine process gap — no lifecycle for one-time ops scripts — worth fixing at the convention level, not just per-file.
