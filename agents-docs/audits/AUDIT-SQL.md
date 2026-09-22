# Audit: SQL (`sql`)

Style guide: `style-guides/sql.md`
Scope: `api/GrainOriginatorPortal.Api/Scripts`, `api/GrainOriginatorPortal.Infrastructure/Data` (migrations, `ApplicationDbContext`, repositories), `scripts/`, `SECURITY-REVIEWS/scripts/`

**Findings:** 19 total — 6 open, 5 accepted, 1 won't-fix, 7 resolved
**Opened:** 2026-09-19 | **Last verified:** 2026-09-21

## What was checked this pass

- Re-read every finding from the 2026-09-19 pass against the current working tree. Most of the files named in that pass's `critical`/`high`/`low` findings (`CreateProducerDetailsTable.sql`, `CreateSavedListsTable.sql`, `scripts/qa-setup.sql`, `migrate-bid-sheet.sql`, `AddLinkedProducerIds_ProducerDetails.sql`, `DropEstimatedYield_ProducerPlantingIntentions.sql`, `CheckMbpLocationCoverage.sql`, `AddFilters_SavedLists.sql`, `AddTypeToPlantingIntentions.sql`) no longer exist in the repo — confirmed via direct file checks, not by trusting the tracker.
- Read the EF Core raw-SQL call sites (`ContractRepository.cs`, `CustomerRepository.cs`, `TicketRepository.cs`, `UsageRepository.cs`) line by line for injection risk. All values reach the database through `SqlParameter`/`FromSqlInterpolated`/parameterized `ExecuteSqlRawAsync` overloads — no live injection path found, consistent with the prior pass's conclusion.
- Read the current `ApplicationDbContextModelSnapshot.cs` (40 tables, 14 explicit FK relationships, 57 indexes) as the source of truth for schema shape, since a live database was not inspected.
- Read the remaining standalone `.sql` scripts (`PopulateCommodities.sql`, `PopulateMbpLocationSynonym.sql`, `backfill-migration-history.sql`, `Manage-UsageDashboardViewAll.sql`, `_VerifySchema.sql`, `B4_migrate_createdby.sql`) in full.
- Confirmed FK-column index coverage by cross-referencing every `HasForeignKey` against a preceding `HasIndex` in the snapshot — all 14 FK columns are indexed.
- Did not inspect a live database (Dev/QA/Prod). All schema conclusions are migration/snapshot-evidence, not runtime-verified.

## Open

### Ambiguous DisplayName join can mis-assign UPN during CreatedBy backfill (`sql.ambiguous-displayname-join-createdby-backfill`)
- **Severity:** medium
- **Files:** `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`
- Joins `CreatedBy`/`ModifiedBy` to `UserTradeUnitSnapshot.DisplayName`, which is not unique; duplicate display names can get an arbitrary/wrong UserId remapped in.
- Blocked on an unrecorded fact: has this script already run in each environment? If PROD is still pending, fix the join before running there; if it already ran, archive the script.

### CustomerTradeUnit→Customer cascade delete breaks the codebase's own documented pattern (`sql.customertradeunit-cascade-delete-breaks-pattern`)
- **Severity:** medium
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/ApplicationDbContext.cs`
- Every other FK to `Customer` is explicit `NoAction` with a rationale comment; `CustomerTradeUnit`'s is `Cascade`, uncommented. Inert today (all rows come from the ODS sync), but time-sensitive: a feature introducing manually-curated `CustomerTradeUnit` rows would make a `Customer` rebuild silently destroy hand-entered membership. Decide before that feature ships.

### FromSqlRaw fed a C#-interpolated string instead of FromSqlInterpolated (`sql.fromsqlraw-interpolated-string`)
- **Severity:** medium
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/CustomerRepository.cs`
- `SearchAsync` builds the WHERE clause text via C# string interpolation (parameter *names* only, e.g. `@w0`), then passes it to `FromSqlRaw` with a matching `SqlParameter[]`. Values are correctly parameterized today — no live injection path — but the pattern is one careless edit away from a real one.

### Foreign keys added WITH NOCHECK are never revalidated (`sql.nocheck-foreign-keys-never-revalidated`)
- **Severity:** medium
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/Migrations/20260513195804_AddCustomerFkAndCustomerLink.cs`
- Three FKs (`Notes`, `ProducerDetails`, `ProducerPlantingIntentions` → `Customer`) were added `WITH NOCHECK` with a comment promising a later `WITH CHECK CHECK CONSTRAINT` pass. That string appears nowhere else in the migration history. Next step is a read-only orphan-row count per environment, not a code change.

### Schema verification script tracks 19 of 99 migrations and 29 of 40 tables (`sql.stale-schema-verification-script`) — **new this pass**
- **Severity:** high
- **Files:** `scripts/_VerifySchema.sql`
- The script hand-maintains `@Tables`/`@Columns`/`@UniqueIndexes`/`@Migrations` snapshots that its own header says must be updated after every migration. The last update matches migration `20260609161126_AddPrintLayoutToBidSheetPreference`; the repo now has 99 migration files running through `20260921152258_AddUsageDashboardViewAllUsers`, and `ApplicationDbContextModelSnapshot.cs` defines 40 tables / 57 indexes versus the script's 29 tables / 15 unique indexes.
- Consequence: every one of the ~80 untracked-but-applied migrations and ~11 untracked tables now surfaces as a `Migration.Extra`/`Table.Extra` **WARN** row on every run, so the script can never again print its single "Database is current" success message. A genuine `FAIL` (real drift) would be buried in permanent, expected WARN noise — the opposite of what a drift-detection script is for.
- **Suggested fix:** regenerate the four snapshot sections from the current model snapshot, and consider generating/checking this script in CI so it cannot silently drift again.

### Location master data hardcoded independently in two scripts (`sql.hardcoded-location-data-duplicated`)
- **Severity:** low
- **Files:** `api/GrainOriginatorPortal.Api/Scripts/PopulateMbpLocationSynonym.sql`
- One of the two originally-duplicated scripts (`CheckMbpLocationCoverage.sql`) has since been deleted, but `PopulateMbpLocationSynonym.sql` still embeds ~1,000+ literal location rows directly in the script rather than sourcing them from a tracked location table.

## Accepted (real, deliberately not fixed — see `docs/application-context/STYLE-DEVIATIONS.md`)

- **`sql.migration-down-applies-unrelated-destructive-changes`** (high) — `AddNoteCustomerCode.cs` `Down()` still widens `ProducerDetails.Id`/`Notes.Id` to `bigint`, unrelated to `Up()`. Accepted because migrations run forward-only in this deploy workflow; rewriting an already-applied migration's `Down()` is judged riskier than leaving it.
- **`sql.unjustified-string-primary-keys`** (medium) — `ElevatorCache.ElevatorCode` and `UserTradeUnitSnapshot`'s composite key remain string-typed. Accepted: `ElevatorCode` is ODS's natural key and every lookup is by code.
- **`sql.yn-flags-as-nvarchar-not-bit`** (low) — `OurFacility`/`PushNotificationsHidden`/`CashBidsHidden` remain `nvarchar` Y/N. Accepted: `MbpLocationSynonym` is a faithful mirror of an external export; converting the type breaks the mirror.
- **`sql.executesqlraw-interpolated-constant`** (low) — `UsageRepository.cs` still splices a private `const` into an interpolated SQL string. Accepted: no runtime value ever reaches the string; the actual cutoff goes through the parameterized overload.
- **`sql.select-star-in-raw-sql`** (low) — `ContractRepository.cs`/`CustomerRepository.cs` still use `SELECT c.*` in `FromSqlInterpolated` calls mapped onto full entity types. Accepted: the entity is the shape contract for these queries; revisit if an ODS view change ever breaks one.

## Won't fix

- **`sql.grouptradeunits-fk-missing-index`** (medium) — not applicable. Migration `20260513051734_RemoveTradeUnitCatalog` drops `GroupTradeUnits` entirely; its only creator (`scripts/qa-setup.sql`) is a deleted pre-CI bootstrap script.

## Resolved since 2026-09-19

All fixed on branch `fix_AuditPhase1Findings`, merged to `main` via PR #615, except where noted:

- **`sql.inconsistent-table-definitions-producerdetails-savedlists`** (critical) — the three conflicting ad hoc/`qa-setup` table-definition scripts are deleted; EF migrations are now the sole schema source.
- **`sql.handrolled-ddl-faked-migration-history`** (high) — `migrate-bid-sheet.sql` (the hand-rolled DDL half of the pair) is deleted.
- **`sql.linkedproducerids-column-type-mismatch`** (high) — both conflicting scripts (`VARCHAR` vs `NVARCHAR`) deleted.
- **`sql.unguarded-mass-delete-merge`** (medium) — fixed in `PopulateMbpLocationSynonym.sql`.
- **`sql.orphaned-stale-script-nonexistent-column`** (medium) — stale script deleted.
- **`sql.non-idempotent-alter-scripts`** (low) — all three non-guarded ALTER scripts deleted.
- **`sql.n-plus-one-bid-insert-reconciliation`** (low) — `BidSheetRepository.ReconcileDuplicateBidInsertsAsync` now issues one batched query over the whole pending set instead of one round trip per colliding bid (confirmed by reading the current implementation, which carries an explicit comment about the change).

## Blind spots

- No live database (Dev/QA/Prod) was inspected in this pass; all conclusions rest on migration files, the EF model snapshot, and the standalone `.sql` scripts in the repo. Whether `__EFMigrationsHistory` in each real environment matches the 99 migration files on disk is unverified — which is exactly the gap `_VerifySchema.sql` was built to catch, and exactly why its staleness (above) matters.
- `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`'s open finding depends on operational state (has it run per environment?) that isn't recorded anywhere in the repo.
