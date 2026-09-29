# Audit: SQL (`sql`)

Style guide: `style-guides/sql.md`
Scope: `api/GrainOriginatorPortal.Api/Scripts`, `api/GrainOriginatorPortal.Infrastructure/Data` (migrations, `ApplicationDbContext`, repositories), `scripts/`, `SECURITY-REVIEWS/scripts/`

**Findings:** 19 total — 6 open, 5 accepted, 1 won't-fix, 7 resolved
**Opened:** 2026-09-19 | **Last verified:** 2026-09-28

## What was checked this pass

- Re-verified every still-open finding from the 2026-09-21 pass against the current working tree (one week later): the five prior `open` findings, the `_VerifySchema.sql` "resolved" claim, and the accepted/won't-fix dispositions. All files named still exist and every claim still holds as described, with one exception below.
- Diffed the schema surface for what changed in the last week: `git log --since=2026-09-21` on `**/*.sql` and the migrations folder. Four new migrations landed (`AddCustomerIndustryCode2AndNopId`, `AddFlaxCommoditiesForTradeUnit3811`, `SplitFlaxPlantingCategoryByColour`, `RenameGrainOnFarmGroupToCommodityCode`) plus two new standalone scripts (`AddIndustryCode2AndNopIdToCustomerTradeUnitsView.sql`, `planting-intentions-trade-unit-audit.sql`). Read all six in full — no new schema-quality, injection, or migration-safety issues; they're well-documented (explicit run-order notes, insert-if-missing guards for hand-curated seed data, read-only audit queries) and consistent with the patterns already covered by open/accepted findings.
- Confirmed `scripts/_VerifySchema.sql` is being actively kept current, not just fixed once: its `@Tables`/`@UniqueIndexes`/`@Migrations` counts (40 tables, 21 unique indexes, 53 migrations) match `ApplicationDbContextModelSnapshot.cs` and the migrations folder exactly as of this pass, and three of the intervening commits are literally `chore(schema): add ... to the drift check`. This is the strongest positive signal in the domain this pass.
- Used a sub-agent to trace whether `sql.customertradeunit-cascade-delete-breaks-pattern`'s premise ("inert today, decide before the manual-curation feature ships") still holds. It doesn't — see below.
- Did not inspect a live database (Dev/QA/Prod). All schema conclusions are migration/snapshot-evidence, not runtime-verified, same as every prior pass.

## Open

### CustomerTradeUnit→Customer cascade delete breaks the codebase's own documented pattern, and manual rows now exist (`sql.customertradeunit-cascade-delete-breaks-pattern`) — **severity raised medium → high this pass**
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/ApplicationDbContext.cs`, `api/GrainOriginatorPortal.Infrastructure/Repositories/CustomerRepository.cs`
- Every other FK to `Customer` is explicit `NoAction` with a rationale comment; `CustomerTradeUnit`'s is `Cascade`, uncommented.
- The 2026-09-21 pass called this inert and said "decide before [manual curation] ships." That premise no longer holds: `PUT /api/customers/{id}/trade-units` (`CustomersController.AssignTradeUnits` → `CustomerService.AssignTradeUnitsAsync` → `CustomerRepository.AssignTradeUnitsAsync`, lines 553–651) is live today, `[Authorize]`-only with no admin gate (documented as accepted risk AR-03), and inserts `CustomerTradeUnit` rows with `IsManual = true` on real requests. The feature this finding was gating on (`feature_NewCustomerTradeUnits`) merged 2026-05-27 — before this finding was even first opened.
- What's still true: nothing hard-deletes a `Customer` row today. `CustomerSyncService.SyncAsync` is upsert + soft-delete only (`IsActive = false`), never a rebuild. So no data has actually been lost.
- Why this is now high, not medium: real hand-curated membership data sits behind a `Cascade` FK, and the only thing protecting it is the absence of a hard-delete code path — a fragile invariant to depend on, not a design decision. `docs/application-context/STYLE-DEVIATIONS.md` still frames this as a pending decision ("Decide before that feature lands") and should be updated to reflect that the feature has shipped.

### Ambiguous DisplayName join can mis-assign UPN during CreatedBy backfill (`sql.ambiguous-displayname-join-createdby-backfill`)
- **Severity:** medium
- **Files:** `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`
- Joins `CreatedBy`/`ModifiedBy` to `UserTradeUnitSnapshot.DisplayName`, which is not unique; duplicate display names can get an arbitrary/wrong UserId remapped in. Unchanged this pass.
- Still blocked on an unrecorded fact: has this script already run in each environment? Not something the repo can answer.

### FromSqlRaw fed a C#-interpolated string instead of FromSqlInterpolated (`sql.fromsqlraw-interpolated-string`)
- **Severity:** medium
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/CustomerRepository.cs`
- `SearchAsync` builds the WHERE clause text via C# string interpolation (parameter *names* only), then passes it to `FromSqlRaw` with a matching `SqlParameter[]`. Still correctly parameterized, still one careless edit away from a real injection. Unchanged this pass.

### Foreign keys added WITH NOCHECK are never revalidated (`sql.nocheck-foreign-keys-never-revalidated`)
- **Severity:** medium
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/Migrations/20260513195804_AddCustomerFkAndCustomerLink.cs`
- Three FKs (`Notes`, `ProducerDetails`, `ProducerPlantingIntentions` → `Customer`) were added `WITH NOCHECK` with a promised later `WITH CHECK CHECK CONSTRAINT` pass that never happened. Unchanged this pass; next step is a read-only orphan-row count per environment, not a code change.

### Location master data hardcoded independently in one remaining script (`sql.hardcoded-location-data-duplicated`)
- **Severity:** low
- **Files:** `api/GrainOriginatorPortal.Api/Scripts/PopulateMbpLocationSynonym.sql`
- `CheckMbpLocationCoverage.sql` — the other half of the original duplication — is confirmed still deleted. `PopulateMbpLocationSynonym.sql` still embeds ~1,000+ literal location rows rather than sourcing from a tracked location table. Tracker's `files` list corrected to drop the deleted script.

## Accepted (real, deliberately not fixed — see `docs/application-context/STYLE-DEVIATIONS.md`)

- **`sql.migration-down-applies-unrelated-destructive-changes`** (high) — `AddNoteCustomerCode.cs` `Down()` still widens `ProducerDetails.Id`/`Notes.Id` to `bigint`, unrelated to `Up()`. Accepted: migrations run forward-only in this deploy workflow.
- **`sql.unjustified-string-primary-keys`** (medium) — `ElevatorCache.ElevatorCode` and `UserTradeUnitSnapshot`'s composite key remain string-typed. Accepted: natural key from ODS. Re-checked this pass that no new child table has added an FK against either string key — none has.
- **`sql.yn-flags-as-nvarchar-not-bit`** (low) — `MbpLocationSynonym` Y/N columns remain `nvarchar`. Accepted: faithful mirror of an external export.
- **`sql.executesqlraw-interpolated-constant`** (low) — `UsageRepository.cs` still splices a private `const` into an interpolated SQL string. Accepted: no runtime value ever reaches the string.
- **`sql.select-star-in-raw-sql`** (low) — `ContractRepository.cs`/`CustomerRepository.cs` still use `SELECT c.*` mapped onto full entity types. Accepted: entity is the shape contract.

## Won't fix

- **`sql.grouptradeunits-fk-missing-index`** (medium) — not applicable; `GroupTradeUnits` and its only creator script are both gone.

## Resolved

All fixed on branch `fix_AuditPhase1Findings` (PR #615) unless noted, and re-confirmed still absent/fixed this pass:

- **`sql.inconsistent-table-definitions-producerdetails-savedlists`** (critical), **`sql.handrolled-ddl-faked-migration-history`** (high), **`sql.linkedproducerids-column-type-mismatch`** (high), **`sql.unguarded-mass-delete-merge`** (medium), **`sql.orphaned-stale-script-nonexistent-column`** (medium), **`sql.non-idempotent-alter-scripts`** (low), **`sql.n-plus-one-bid-insert-reconciliation`** (low) — all as previously recorded.
- **`sql.stale-schema-verification-script`** (high) — regenerated 2026-09-21 and, notably, kept current since: `_VerifySchema.sql`'s table/index/migration counts still match the live model snapshot and migrations folder exactly as of 2026-09-28, across three intervening schema-affecting commits that each updated the drift check alongside the schema change.

## Blind spots

- No live database (Dev/QA/Prod) was inspected in this pass; all conclusions rest on migration files, the EF model snapshot, and the standalone `.sql` scripts in the repo.
- `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`'s open finding still depends on operational state (has it run per environment?) that isn't recorded anywhere in the repo.
- The cascade-delete finding's live-write-path confirmation came from tracing `CustomersController`/`CustomerService`/`CustomerRepository` code, not from checking whether any `CustomerTradeUnit` rows with `IsManual = 1` actually exist in a real database yet — the code path is reachable and used in principle, but row-level confirmation would need live DB access.
