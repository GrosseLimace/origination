# Audit: Clean Slop (`clean-slop`)

Scope: dead code, duplication, and stale artifacts across `api/`, `client/`, `scripts/`, and `SECURITY-REVIEWS/scripts/`

**Findings:** 29 total — 1 open (medium), 1 wont_fix, 1 accepted, 26 resolved
**Opened:** 2026-09-19 | **Last verified:** 2026-10-20

## 2026-10-20 reconciliation

Corrected a stale summary in this document rather than trusting its own prior text: the "Open (2)"
section below had listed `clean-slop.dead-farms-api-vertical` and `clean-slop.duplicated-commodity-taxonomy`
as still open as of 2026-10-13, but `AUDIT-TRACKING.json` already recorded both `resolved` (2026-10-13 and
2026-10-14 respectively). Re-verified both directly against the tree rather than trusting either source
blindly: `find api -iname "*Farm*"` returns zero `FarmsController`/`FarmService`/`FarmRepository` matches
(only the unrelated `ProducerGrainOnFarm` feature, a different noun), confirming commit `6aa88c21`
(2026-10-13, dropping the stray `/api/farms` usage-mapping leftover) was the tail end of a real deletion,
not evidence the vertical still exists. `commodity-aliases.ts` now imports `CROP_CODE_MAP` from
`crop-group-match.ts` and derives its corn/wheat/soy/sorghum codes from it (`withCodes()` helper),
confirming the two taxonomies were actually unified rather than just marked resolved. Both findings are
closed out below; this document's open count is now corrected to match the tracker.

Reviewed every commit touching `api/`, `client/src`, `scripts/`, and `SECURITY-REVIEWS/scripts/` since the
last real clean-slop pass (2026-10-14) — a large batch of perf/OnPush conversions and "move logic into a
feature util" refactors (home page split into page-scoped stores, build-list and bid-sheet split into
`utils/*`, dashboard split into pure-formatter utils). Swept the new/changed files for the same four
categories as prior passes: no new stale `TODO`/`FIXME` markers (the three hits are the same phone-format
placeholder false positive as every prior pass), no new commented-out code blocks (the `// ---` banner
hits are all section headers, not dead logic — checked each of the 14 files that matched), and the
56-ish single-implementation-interface count is unchanged (still the deliberate DI/mocking convention,
not AI ceremony). The extraction refactors themselves are clean: `getDeliveryStats` in
`customer-print-report.component.ts` already delegates to the shared `getContractDeliveryStats` util used
by `contracts-table`/`activity-summary`/`insights`, and the new `utils/*` files created by the bid-sheet
and build-list splits aren't duplicated elsewhere. Found one new copy-paste-drift item instead, in the one
method `customer-print-report.component.ts` does *not* delegate out:

### `customer-print-report` re-implements `contracts-table`'s pricing-status logic and has already drifted (`clean-slop.customer-print-report-duplicates-pricing-status-logic`) — medium
- **Files:** `client/src/app/features/customers/components/customer-print-report/customer-print-report.component.ts` (`getPricingInfo`, ~lines 184-209), `client/src/app/features/customers/components/contracts-table/contracts-table.component.ts` (`_computePricingInfo`, ~lines 522-568)
- `customer-print-report`'s `getPricingInfo` is a hand-copied near-duplicate of `contracts-table`'s pricing-status method, labelled by its own comment as mirroring it (`// --- Pricing logic mirrors contracts-table.component.ts getPricingInfo ---`). Read both in full: same PTC branches, same sequence/quantity math — but the copies have already diverged. `contracts-table`'s version returns a `LOADING` status when `pricingLinesLoaded()` is false and lines are undefined, and applies a 1-bushel float-sum tolerance before flipping a `U`-priced contract from `PARTIAL` to `PRICED` (explained in its own comment as guarding against float epsilon on summed `priceQuantity`). `customer-print-report`'s copy has neither guard: an unloaded pricing-lines map is silently treated as an empty one, and a contract priced to within float epsilon of its quantity can show `PARTIAL` on the printed report while the live table shows `PRICED`. Same pattern as the already-fixed `clean-slop.ctrm-config-reader-duplicated-six-times`.
- **Suggested fix:** Extract the pricing-status computation into a shared util or injectable service both components call, the same way `getDeliveryStats` here already delegates to the shared `getContractDeliveryStats` util.

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

## Open (1)

See the "2026-10-20 reconciliation" section above for `clean-slop.customer-print-report-duplicates-pricing-status-logic` (medium).

## 2026-09-21 reconciliation

Independently re-verified all 23 findings against the current repo state (not just the tracker's prior "Fixed on branch fix_AuditPhase1Findings" notes) by reading or grepping every file each finding names. All 19 prior "resolved" claims held up under direct inspection — most were fixed by outright deletion (`qa-setup.sql`, `migrate-bid-sheet.sql`, the six stale `Scripts/` files, `CheckMbpLocationCoverage.sql`, `admin.guard.ts`, the footer/tabs/textarea components, the duplicate `customer-map` folder, `core/services/index.ts`) or by call sites being repointed at the surviving shared implementation (`buildLbsPerBushelMap`, `IRequestContextService`, `IGeocodeService`, `formatAccountingMoney`, `toSavedListPayload`). Two are notable because the actual fix took a different shape than the suggested one: `commodityRowClass()` was kept and the dashboard call site was changed to use it (rather than deleting the wrapper), and the customers-signal drift bug was fixed by adding the missing `appState.setCustomers(...)` call rather than removing the duplicate local signal entirely. The two still-open items (dead Farms API vertical, disagreeing commodity taxonomies) were re-confirmed unchanged and still require a product decision, not a mechanical cleanup. `wont_fix` and `accepted` items are unchanged. No corrections to prior status were needed and no new clean-slop findings were added in this pass; see `AUDIT-TRACKING.json` for per-finding re-verification notes.

## Resolved (26)

19 fixed on branch `fix_AuditPhase1Findings`, merged to main 2026-09-21 via PR #615, and independently re-confirmed 2026-09-21 by reading the current file contents (not just trusting the merge). 2 more (the CTRM config-reader and ResolveScoularIdAsync duplication) fixed same-day on 2026-09-28 — see that section above. The 2026-10-13 pass added 2 more resolved same-day (`dead-commented-pricing-logic`, `orphaned-api-service-methods`) plus a third (`dead-confirm-dialog`, fixed same day in commit `7c7769d6`). 2 more — `dead-farms-api-vertical` and `duplicated-commodity-taxonomy` — were long-open items finally resolved 2026-10-13/14 at the product owner's direction; see the 2026-10-20 reconciliation note above for how each was verified.

- **`clean-slop.dead-farms-api-vertical`** (high) — whole vertical deleted 2026-10-13 at the product owner's direction (no ODS Farms table is planned): controller, service, repository, interfaces, entity, DTOs, DI registrations, and the stray `/api/farms` usage-mapping leftover (commit `6aa88c21`) all removed. Re-verified 2026-10-20: zero `*Farm*` matches remain under `api/` besides the unrelated `ProducerGrainOnFarm` feature.
- **`clean-slop.duplicated-commodity-taxonomy`** (medium) — `commodity-aliases.ts` now derives its corn/wheat/soy/sorghum codes from `crop-group-match.ts`'s `CROP_CODE_MAP` via a `withCodes()` helper, so the two can no longer disagree on codes (owner-approved 2026-10-14, deliberately excludes barley/canola/oats/sunflower to avoid substring false-matches). Re-verified 2026-10-20 by reading the import and helper directly.
- **`clean-slop.dead-confirm-dialog`** (low) — dead confirm dialog deleted alongside a stray-backslash fix in commit `7c7769d6` (2026-10-13).

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

No build/tests run in the 2026-10-13 or 2026-10-20 passes (out of scope per the invoking instructions — a separate baseline step covers it). All 2026-10-20 findings are read-only observations; no source files were modified.
