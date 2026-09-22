# Audit: Clean Slop (`clean-slop`)

Scope: dead code, duplication, and stale artifacts across `api/`, `client/`, `scripts/`, and `SECURITY-REVIEWS/scripts/`

**Findings:** 23 total — 19 resolved, 2 open, 1 wont_fix, 1 accepted (0 critical, 5 high, 12 medium, 6 low by original severity)
**Opened:** 2026-09-19 | **Last verified:** 2026-09-21

## 2026-09-21 reconciliation

Independently re-verified all 23 findings against the current repo state (not just the tracker's prior "Fixed on branch fix_AuditPhase1Findings" notes) by reading or grepping every file each finding names. All 19 prior "resolved" claims held up under direct inspection — most were fixed by outright deletion (`qa-setup.sql`, `migrate-bid-sheet.sql`, the six stale `Scripts/` files, `CheckMbpLocationCoverage.sql`, `admin.guard.ts`, the footer/tabs/textarea components, the duplicate `customer-map` folder, `core/services/index.ts`) or by call sites being repointed at the surviving shared implementation (`buildLbsPerBushelMap`, `IRequestContextService`, `IGeocodeService`, `formatAccountingMoney`, `toSavedListPayload`). Two are notable because the actual fix took a different shape than the suggested one: `commodityRowClass()` was kept and the dashboard call site was changed to use it (rather than deleting the wrapper), and the customers-signal drift bug was fixed by adding the missing `appState.setCustomers(...)` call rather than removing the duplicate local signal entirely. The two still-open items (dead Farms API vertical, disagreeing commodity taxonomies) were re-confirmed unchanged and still require a product decision, not a mechanical cleanup. `wont_fix` and `accepted` items are unchanged. No corrections to prior status were needed and no new clean-slop findings were added in this pass; see `AUDIT-TRACKING.json` for per-finding re-verification notes.

## Open (2)

### Entire Farms REST API is a non-functional stub with no caller (`clean-slop.dead-farms-api-vertical`) — high
- **Files:** `Controllers/FarmsController.cs`, `Services/FarmService.cs`, `Services/IFarmService.cs`, `Repositories/FarmRepository.cs`, `Interfaces/IFarmRepository.cs`
- Re-verified 2026-09-21: all five files still exist unchanged. `FarmRepository` is explicitly documented as a stub since no Farms table exists in the ODS: every read logs a warning and returns empty/null, `CreateAsync` throws `NotImplementedException`. Zero real Angular callers (grep hits are all test-fixture customer names like "Alpha Farms") and no other C# caller beyond DI registration — a full dead vertical slice.
- **Suggested fix:** Remove the whole Farms vertical, or explicitly return 501/404 and drop the pretend CRUD surface. Keep-or-delete is a product call, not a mechanical cleanup.

### Independently-maintained commodity taxonomy/alias maps overlap but disagree (`clean-slop.duplicated-commodity-taxonomy`) — medium
- **Files:** `shared/utils/commodity-aliases.ts`, `shared/utils/crop-group-match.ts`, `shared/utils/contract-status.ts`, `shared/utils/production-coverage.ts`
- Re-verified 2026-09-21: both files still exist as separate, independently-maintained synonym lists that disagree (corn/wheat/milo groupings differ), so this is deliberately not unified — reconciling them would change query results.
- **Related findings:** `angular.duplicated-commodity-taxonomy-logic`
- **Suggested fix:** Extract one shared builder/lookup table, but only as a product decision on which taxonomy wins.

## Resolved (19)

All fixed on branch `fix_AuditPhase1Findings`, merged to main 2026-09-21 via PR #615, and independently re-confirmed 2026-09-21 by reading the current file contents (not just trusting the merge).

- **`clean-slop.qa-setup-resurrects-removed-tradeunit-catalog`** (high) — `scripts/qa-setup.sql` deleted outright.
- **`clean-slop.dead-shared-ui-components`** (high) — `shared/components/footer/`, `tabs/`, `textarea/` all deleted.
- **`clean-slop.dead-admin-guard-with-stale-comment`** (high) — `guards/admin.guard.ts` deleted; only `auth.guard.ts` and `usage-dashboard.guard.ts` remain.
- **`clean-slop.duplicate-customers-signal-with-drift-bug`** (high) — `home.component.ts` still keeps a local `customers` signal, but `_autoSaveCommodities`'s success callback now calls `appState.setCustomers(updated)`, closing the drift gap (minimal fix, not the fuller refactor).
- **`clean-slop.duplicate-customer-map-component`** (medium) — orphaned `components/customer-map/` folder deleted; only `components/map/customer-map.component.ts` remains.
- **`clean-slop.duplicate-conversion-map-builder`** (medium) — `buildConversionMap` deleted from `contract-status.ts`; both call sites use `buildLbsPerBushelMap`.
- **`clean-slop.stale-ops-scripts`** (medium) — all six completed one-time scripts deleted from `api/GrainOriginatorPortal.Api/Scripts/`.
- **`clean-slop.stale-bidsheet-script-repo-root`** (medium) — `migrate-bid-sheet.sql` deleted from repo root.
- **`clean-slop.verify-schema-self-inconsistent-maintenance`** (medium) — `scripts/_VerifySchema.sql` rewritten to derive expectations from `ApplicationDbContextModelSnapshot.cs` instead of 4 hand-maintained lists.
- **`clean-slop.stale-dbset-comments-originationdbcontext`** (medium) — stale commented DbSet/modelBuilder blocks removed from `OriginationDbContext.cs`; replaced with one accurate comment.
- **`clean-slop.dead-appexception-context-mechanism`** (medium) — `Context`/`WithContext` removed from `AppException.cs`; `NotFoundException.cs` no longer calls it.
- **`clean-slop.duplicated-upn-shortname-claim-chain`** (medium) — `EntitlementsController.cs` and `NotesController.cs` now inject `IRequestContextService` and call `GetCurrentUserShortName()`.
- **`clean-slop.diagnostics-controller-reimplements-geocoding`** (medium) — `DiagnosticsController.cs` now routes through `IGeocodeService`'s structured parameters.
- **`clean-slop.dead-core-services-barrel`** (medium) — `core/services/index.ts` deleted.
- **`clean-slop.duplicate-accounting-money-format`** (medium) — both `accounting-currency.pipe.ts` and `calculator-report.service.ts` now delegate to shared `formatAccountingMoney` in `shared/utils/accounting-money.ts`.
- **`clean-slop.hardcoded-location-data-duplicated`** (low) — `CheckMbpLocationCoverage.sql` deleted outright, removing the duplicated hardcoded location list.
- **`clean-slop.backfill-script-phantom-migration-ids`** (low) — header comment in `backfill-migration-history.sql` corrected to name the three squashed migration ids explicitly.
- **`clean-slop.dead-commodity-row-class-wrapper`** (low) — kept the wrapper; `dashboard.component.ts`'s row-class map now calls `commodityRowClass()` instead of reaching into the underlying object directly.
- **`clean-slop.duplicate-saved-list-payload-building`** (low) — `api.service.ts` now has a single `toSavedListPayload<T>` helper used by all three write methods.

## Accepted (1)

### CardFooterComponent exported but never consumed (`clean-slop.unused-card-footer-export`) — low
- **Files:** `shared/components/card/card.component.ts`
- Re-verified 2026-09-21: still exported, still zero import sites outside the file. Kept deliberately — one member of a five-part card family whose other four are used, and the sibling `DialogFooterComponent` is used in 8 files. Recorded in STYLE-DEVIATIONS.md.

## Won't fix (1)

### B4_migrate_createdby.sql repeats the same UPDATE/JOIN mapping pattern 18 times instead of building it once (`clean-slop.b4-createdby-repeated-update-blocks`) — low
- **Files:** `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`
- Re-verified 2026-09-21: pattern is unchanged. One-time remediation script from April 2026; whether it still matters depends on whether it has already been run in each environment, which the repo doesn't record. Tracked as an open question rather than a code change.
- **Related findings:** `sql.ambiguous-displayname-join-createdby-backfill`

## Overall health

The 2026-09-19 audit found a repo with real engineering care in load-bearing logic undermined by a lack of cleanup discipline. PR #615 closed out 19 of 23 findings the same week, almost entirely by deletion or by repointing call sites at the surviving shared implementation — a healthy sign that the findings were accurate and the fixes were the cheap, low-risk kind (delete dead code, converge on one already-correct helper) rather than risky rewrites. The two items still open both require a product decision (keep-or-delete Farms; which commodity taxonomy wins) rather than more engineering effort, and the one `wont_fix` is blocked on an operational fact (has this script already run in each environment) the repo doesn't track anywhere.
