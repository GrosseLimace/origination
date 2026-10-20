# Audit: Clean Slop (`clean-slop`)

Scope: dead code, duplication, and stale artifacts across `api/`, `client/`, `scripts/`, and `SECURITY-REVIEWS/scripts/`

**Findings:** 27 total — 19 resolved, 4 open, 1 wont_fix, 1 accepted, 2 resolved (CTRM copy-paste drift) (0 critical, 5 high, 13 medium, 7 low by original severity, plus 2 new low/medium findings opened 2026-10-13)
**Opened:** 2026-09-19 | **Last verified:** 2026-10-13

## 2026-10-13 reconciliation

Re-verified the two findings still open from the 2026-09-28 pass by re-reading/re-grepping every file each one names — both unchanged, both still blocked on a product decision rather than a mechanical cleanup: `dead-farms-api-vertical` (all five files still present, still zero callers) and `duplicated-commodity-taxonomy` (all four util files still separate, still disagree on corn/wheat/milo groupings).

Sampled the rest of the repo for new slop since the last pass (dead infrastructure via commented-code/TODO/NotImplementedException sweeps, phantom patterns via single-implementation-interface and factory/manager/wrapper class name scans, copy-paste drift via `shared/utils` duplication check, comment noise via stale-marker sweeps). The 56 single-implementation interfaces under `Interfaces/` and `Services/I*.cs` are a deliberate DI/test-mocking convention (every one backs a mockable seam used in the test suite), not AI ceremony — not flagged. `shared/utils/*.ts` remains well-factored with no new duplication. No new stale `TODO`/`FIXME` markers; the two regex hits were false positives (a phone-format placeholder and "dead code" used descriptively inside an intentional design-decision comment). Found two new, narrow items:

### Fully commented-out `getPricingInfo_old` left "for reference" (`clean-slop.dead-commented-pricing-logic`) — low
- **Files:** `client/src/app/features/customers/components/contracts-table/contracts-table.component.ts` (lines 595-627)
- A 33-line method is commented out in its entirety under a `// --- PREVIOUS logic (kept for reference) ---` banner, directly above the live replacement. Pure dead weight, trivially recoverable from git history.
- **Suggested fix:** Delete lines 595-627.

### Four `ApiService` client methods have zero call sites (`clean-slop.orphaned-api-service-methods`) — medium
- **Files:** `client/src/app/core/services/api.service.ts`, `api/GrainOriginatorPortal.Api/Services/ProducerDetailsService.cs`
- `deleteProducerDetails`, `getAppliedTicketsByContract`, `getUnappliedTicketsByCustomer`, and `geocodeSearch` are defined but never invoked anywhere in `client/src` (checked every public `ApiService` method's call sites by script). Two are confirmed dead rather than merely suspected: `ProducerDetailsService.cs`'s own code comment (lines 197-198) states outright that `deleteProducerDetails` on the client is dead code, kept only as a backend speed bump; and `geocodeSearch`'s single-address `/geocode/search` call was superseded by the batch `/geocode/batch` endpoint, which `customer-map.component.ts` now calls directly via `HttpClient`, stranding the old wrapper. `getAppliedTicketsByContract` has a doc comment on the neighboring method claiming applied tickets load "lazily per-contract via {@link getAppliedTicketsByContract}", but nothing calls it — the described lazy-load flow was never wired up. Two more currently-uncalled methods in the same file, `getElevators` and `getBidMonths`, were deliberately **not** flagged: they sit in the actively-developed bid-sheet feature (recent WIP commits touch that area), so near-term scaffolding is more plausible than slop.
- **Suggested fix:** Delete the four confirmed-orphaned methods (and the now-pointless doc-comment cross-reference near line 410), or wire up the lazy per-contract ticket load if that feature is still intended.

## 2026-09-28 reconciliation

Re-verified the two findings still open from the 2026-09-21 pass (dead Farms API vertical, disagreeing commodity taxonomies) by re-reading/re-grepping every file each one names — both unchanged, both still blocked on a product decision rather than a mechanical cleanup.

Also reviewed the new CTRM GraphQL integration (`Services/Ctrm/`, `Infrastructure/Ctrm/`, `CtrmKeepWarmService.cs` — roughly 5,300 lines across 16 files) merged since the last pass, since it's the only material change to the repo in that window. It's well-engineered: nearly every non-obvious method carries a WHY comment (e.g. `ContractRepositorySwitch`'s doc comment explains *why* the source flag is read per-call instead of captured at construction), and the `ContractRepositorySwitch`/`TicketRepositorySwitch` pair's structural duplication is deliberate and explicitly cross-referenced in their doc comments, not slop. Found two new copy-paste-drift findings instead: the same `ReadInt`/`ReadBool` config-parsing helper is independently reimplemented six times across the vertical (and the copies have already started to diverge — different `CultureInfo` handling, one dropped the fallback parameter), and `ResolveScoularIdAsync` is duplicated near-verbatim between the Contract and Ticket repositories. Both were subsequently fixed the same day — see `AUDIT-TRACKING.json` (`clean-slop.ctrm-config-reader-duplicated-six-times`, `clean-slop.ctrm-resolve-scoularid-duplicated`) for resolution detail.

## Open (2)

### Entire Farms REST API is a non-functional stub with no caller (`clean-slop.dead-farms-api-vertical`) — high
- **Files:** `Controllers/FarmsController.cs`, `Services/FarmService.cs`, `Services/IFarmService.cs`, `Repositories/FarmRepository.cs`, `Interfaces/IFarmRepository.cs`
- Re-verified 2026-10-13: all five files still exist unchanged, no real callers. Unchanged since 2026-09-21.
- **Suggested fix:** Remove the whole Farms vertical, or explicitly return 501/404. Keep-or-delete is a product call.

### Independently-maintained commodity taxonomy/alias maps overlap but disagree (`clean-slop.duplicated-commodity-taxonomy`) — medium
- **Files:** `shared/utils/commodity-aliases.ts`, `shared/utils/crop-group-match.ts`, `shared/utils/contract-status.ts`, `shared/utils/production-coverage.ts`
- Re-verified 2026-10-13: still separate, still disagree on corn/wheat/milo groupings. Unchanged since 2026-09-21.
- **Related findings:** `angular.duplicated-commodity-taxonomy-logic`
- **Suggested fix:** Extract one shared builder/lookup table, but only as a product decision on which taxonomy wins.

## Open — new 2026-10-13 (2)

See the "2026-10-13 reconciliation" section above for `clean-slop.dead-commented-pricing-logic` (low) and `clean-slop.orphaned-api-service-methods` (medium).

## 2026-09-21 reconciliation

Independently re-verified all 23 findings against the current repo state (not just the tracker's prior "Fixed on branch fix_AuditPhase1Findings" notes) by reading or grepping every file each finding names. All 19 prior "resolved" claims held up under direct inspection — most were fixed by outright deletion (`qa-setup.sql`, `migrate-bid-sheet.sql`, the six stale `Scripts/` files, `CheckMbpLocationCoverage.sql`, `admin.guard.ts`, the footer/tabs/textarea components, the duplicate `customer-map` folder, `core/services/index.ts`) or by call sites being repointed at the surviving shared implementation (`buildLbsPerBushelMap`, `IRequestContextService`, `IGeocodeService`, `formatAccountingMoney`, `toSavedListPayload`). Two are notable because the actual fix took a different shape than the suggested one: `commodityRowClass()` was kept and the dashboard call site was changed to use it (rather than deleting the wrapper), and the customers-signal drift bug was fixed by adding the missing `appState.setCustomers(...)` call rather than removing the duplicate local signal entirely. The two still-open items (dead Farms API vertical, disagreeing commodity taxonomies) were re-confirmed unchanged and still require a product decision, not a mechanical cleanup. `wont_fix` and `accepted` items are unchanged. No corrections to prior status were needed and no new clean-slop findings were added in this pass; see `AUDIT-TRACKING.json` for per-finding re-verification notes.

## Resolved (21)

19 fixed on branch `fix_AuditPhase1Findings`, merged to main 2026-09-21 via PR #615, and independently re-confirmed 2026-09-21 by reading the current file contents (not just trusting the merge). 2 more (the CTRM config-reader and ResolveScoularIdAsync duplication) fixed same-day on 2026-09-28 — see that section above.

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
- **`clean-slop.ctrm-config-reader-duplicated-six-times`** (medium) — extracted `CtrmConfig.ReadInt`/`ReadBool`; all six (plus a seventh inline copy) now delegate to it; both CultureInfo/signature drifts fixed in the same pass.
- **`clean-slop.ctrm-resolve-scoularid-duplicated`** (low) — extracted `CtrmProducerCode.ResolveAsync`; both repositories delegate through a one-line wrapper.

## Accepted (1)

### CardFooterComponent exported but never consumed (`clean-slop.unused-card-footer-export`) — low
- **Files:** `shared/components/card/card.component.ts`
- Still exported, still zero import sites outside the file. Kept deliberately — one member of a five-part card family whose other four are used, and the sibling `DialogFooterComponent` is used in 8 files. Recorded in STYLE-DEVIATIONS.md.

## Won't fix (1)

### B4_migrate_createdby.sql repeats the same UPDATE/JOIN mapping pattern 18 times instead of building it once (`clean-slop.b4-createdby-repeated-update-blocks`) — low
- **Files:** `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`
- Pattern is unchanged. One-time remediation script from April 2026; whether it still matters depends on whether it has already been run in each environment, which the repo doesn't record. Tracked as an open question rather than a code change.

## Verification

No build/tests run in the 2026-10-13 pass (out of scope per the invoking instructions — a separate baseline step covers it). Both new findings are read-only observations; no source files were modified.
