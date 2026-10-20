# Audit: SQL (`sql`)

Style guide: `style-guides/sql.md`
Scope: `api/GrainOriginatorPortal.Api/Scripts`, `api/GrainOriginatorPortal.Infrastructure/Data` (migrations, `ApplicationDbContext`, repositories), `scripts/`, `SECURITY-REVIEWS/scripts/`

**Findings:** 19 total — 5 open, 5 accepted, 1 won't-fix, 8 resolved
**Opened:** 2026-09-19 | **Last verified:** 2026-10-13

## What was checked this pass

- Re-verified all 5 still-open findings from the 2026-09-28 pass against the current working tree (two weeks later): `sql.ambiguous-displayname-join-createdby-backfill`, `sql.customertradeunit-cascade-delete-breaks-pattern`, `sql.fromsqlraw-interpolated-string`, `sql.nocheck-foreign-keys-never-revalidated`, `sql.hardcoded-location-data-duplicated`. All five are unchanged — same files, same code shape, same unresolved risk. Details and file/line evidence added to each entry in AUDIT-TRACKING.json.
- Diffed the schema surface for what changed since 2026-09-28: 18 new EF migrations landed, all building out the new Bin Sites feature (`AddProducerBinSite` through `DropProducerDetailsBinCapacity`, 2026-10-07 through 2026-10-09) plus a toggle-table add/drop pair (`AddCtrmSourceToggleUsers`/`DropCtrmSourceToggleUsers`) and a dashboard view drop (`DropUsageDashboardViewAllUsers`). Also newly present on `main` since the last pass: `20260811142608_AddBarchartFeed` (five new `dbo.Barchart*` tables + two views), merged in from the Bid Sheet branch on 2026-10-08.
- Read the Bin Sites migrations in full, including the two data-only ones (`MoveBinCapacityAndGrainOntoBinSites`, `CombineGrainOnFarmAndBinSitePrompts`): FK's are explicit `NoAction` with rationale comments (matching the established pattern — unlike the open cascade finding), every new FK column is indexed (`IX_ProducerBinSite_CustomerId`, `IX_ProducerGrainOnFarm_BinSiteId`), nullability changes are set-based and documented, and the data migrations are idempotent/non-destructive by construction (`Down()` is intentionally a no-op where restoring would be unsafe, with that documented). No new schema-quality or migration-safety issues.
- Read `AddBarchartFeed` in full: five tables, two views, all explicit column lists and types, one new string-typed PK (`BarchartInstrument.Symbol`) that mirrors the already-accepted `ElevatorCache.ElevatorCode` natural-key pattern (external vendor identifier, documented in the migration's XML doc). No new finding — see the updated note on `sql.unjustified-string-primary-keys`.
- Confirmed `scripts/_VerifySchema.sql` is still being kept current: its last update note (2026-10-09, `BinSitesModifiedAt`) matches the most recent migration, and the table/column/index counts in its header comments track the Bin Sites and Barchart schema growth commit-by-commit.
- Independently re-derived the FK/index coverage check (which foreign-key columns lack a supporting index) directly from `ApplicationDbContextModelSnapshot.cs` rather than relying on the prior pass's conclusion, since this is the kind of check a naive grep gets wrong (composite indexes with the FK column as a non-first-matched token). Confirmed clean: every FK column across `CustomerCommodity`, `CustomerLink`, `ProducerReminders`, and the five `Customer`-FK'd Producer* tables has a supporting single- or composite-column index.
- Did not inspect a live database (Dev/QA/Prod). All schema conclusions are migration/snapshot-evidence, not runtime-verified, same as every prior pass.

## Open

### CustomerTradeUnit→Customer cascade delete breaks the codebase's own documented pattern, and manual rows now exist (`sql.customertradeunit-cascade-delete-breaks-pattern`)
- **Severity:** high
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/ApplicationDbContext.cs`, `api/GrainOriginatorPortal.Infrastructure/Repositories/CustomerRepository.cs`
- Every other FK to `Customer` is explicit `NoAction` with a rationale comment; `CustomerTradeUnit`'s is `Cascade`, uncommented (`ApplicationDbContext.cs:588-591`, unchanged this pass).
- `PUT /api/customers/{id}/trade-units` is live, `[Authorize]`-only with no admin gate (accepted risk AR-03), and inserts `CustomerTradeUnit` rows with `IsManual = true` on real requests, so real hand-curated membership now sits behind this `Cascade` FK.
- What's still true: nothing hard-deletes a `Customer` row today (`CustomerSyncService.SyncAsync` is upsert + soft-delete only), so no data has actually been lost — the gap is the FK shape, not an observed incident.

### Ambiguous DisplayName join can mis-assign UPN during CreatedBy backfill (`sql.ambiguous-displayname-join-createdby-backfill`)
- **Severity:** medium
- **Files:** `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`
- Joins `CreatedBy`/`ModifiedBy` to `UserTradeUnitSnapshot.DisplayName`, which is not unique; duplicate display names can get an arbitrary/wrong UserId remapped in. Unchanged this pass (re-read in full; still joins Notes/PlantingIntentions/ProducerDetails/SavedLists/Dashboard* tables the same way).
- Still blocked on an unrecorded fact: has this script already run in each environment? Not something the repo can answer.

### FromSqlRaw fed a C#-interpolated string instead of FromSqlInterpolated (`sql.fromsqlraw-interpolated-string`)
- **Severity:** medium
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/CustomerRepository.cs`
- `SearchAsync` builds the WHERE clause text via C# string interpolation (parameter *names* only, lines ~140-156), then passes it to `FromSqlRaw` with a matching `SqlParameter[]` built through `SqlSanitization.SanitizeCsv`'s allow-list regex. Still correctly parameterized, still one careless edit away from a real injection. Unchanged this pass.

### Foreign keys added WITH NOCHECK are never revalidated (`sql.nocheck-foreign-keys-never-revalidated`)
- **Severity:** medium
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/Migrations/20260513195804_AddCustomerFkAndCustomerLink.cs`
- Three FKs (`Notes`, `ProducerDetails`, `ProducerPlantingIntentions` → `Customer`) were added `WITH NOCHECK` with a promised later `WITH CHECK CHECK CONSTRAINT` pass that never happened. Unchanged this pass; re-grepped the whole `api/` tree for `WITH CHECK CHECK CONSTRAINT` and the only hit is still the comment in this same file. Next step is a read-only orphan-row count per environment, not a code change.

### Location master data hardcoded independently in one remaining script (`sql.hardcoded-location-data-duplicated`)
- **Severity:** low
- **Files:** `api/GrainOriginatorPortal.Api/Scripts/PopulateMbpLocationSynonym.sql`
- `PopulateMbpLocationSynonym.sql` still embeds ~1,000+ literal location rows rather than sourcing from a tracked location table, and still has the `@maxDeletePct` guard on its MERGE. No functional change this pass.

## Accepted (real, deliberately not fixed — see `docs/application-context/STYLE-DEVIATIONS.md`)

- **`sql.migration-down-applies-unrelated-destructive-changes`** (high) — `AddNoteCustomerCode.cs` `Down()` still widens `ProducerDetails.Id`/`Notes.Id` to `bigint`, unrelated to `Up()`. Accepted: migrations run forward-only in this deploy workflow.
- **`sql.unjustified-string-primary-keys`** (medium) — `ElevatorCache.ElevatorCode` and `UserTradeUnitSnapshot`'s composite key remain string-typed. Accepted: natural key from ODS. Re-checked this pass that no new child table has added an FK against either string key — none has. Noting a consistent precedent, not a new instance: `AddBarchartFeed` (merged to main 2026-10-08) gives `BarchartInstrument` a string PK (`Symbol`, the vendor's own identifier) with two child tables FK'd to it by cascade — same external-natural-key shape, similarly documented.
- **`sql.yn-flags-as-nvarchar-not-bit`** (low) — `MbpLocationSynonym` Y/N columns remain `nvarchar`. Accepted: faithful mirror of an external export.
- **`sql.executesqlraw-interpolated-constant`** (low) — `UsageRepository.cs` still splices a private `const` into an interpolated SQL string. Accepted: no runtime value ever reaches the string.
- **`sql.select-star-in-raw-sql`** (low) — `ContractRepository.cs`/`CustomerRepository.cs` still use `SELECT c.*` mapped onto full entity types. Accepted: entity is the shape contract.

## Won't fix

- **`sql.grouptradeunits-fk-missing-index`** (medium) — not applicable; `GroupTradeUnits` and its only creator script are both gone.

## Resolved

All fixed on branch `fix_AuditPhase1Findings` (PR #615) unless noted, and re-confirmed still absent/fixed this pass:

- **`sql.inconsistent-table-definitions-producerdetails-savedlists`** (critical), **`sql.handrolled-ddl-faked-migration-history`** (high), **`sql.linkedproducerids-column-type-mismatch`** (high), **`sql.unguarded-mass-delete-merge`** (medium), **`sql.orphaned-stale-script-nonexistent-column`** (medium), **`sql.non-idempotent-alter-scripts`** (low), **`sql.n-plus-one-bid-insert-reconciliation`** (low) — all as previously recorded.
- **`sql.stale-schema-verification-script`** (high) — regenerated 2026-09-21 and, notably, kept current since: `_VerifySchema.sql`'s header comments still track every schema-affecting commit, most recently through the 2026-10-09 Bin Sites changes, right up to the latest migration in the repo.

## Blind spots

- No live database (Dev/QA/Prod) was inspected in this pass; all conclusions rest on migration files, the EF model snapshot, and the standalone `.sql` scripts in the repo.
- `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`'s open finding still depends on operational state (has it run per environment?) that isn't recorded anywhere in the repo.
- The cascade-delete finding's live-write-path confirmation came from tracing `CustomersController`/`CustomerService`/`CustomerRepository` code, not from checking whether any `CustomerTradeUnit` rows with `IsManual = 1` actually exist in a real database yet — the code path is reachable and used in principle, but row-level confirmation would need live DB access.
