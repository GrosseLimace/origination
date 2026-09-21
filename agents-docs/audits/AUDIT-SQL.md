# Audit: SQL (`sql`)

Style guide: `style-guides/sql.md`
Scope: `api/GrainOriginatorPortal.Api/Scripts`, `api/GrainOriginatorPortal.Infrastructure/Data` (migrations, `ApplicationDbContext`), `scripts/`, `SECURITY-REVIEWS/scripts/`

**Findings:** 18 open — 1 critical, 3 high, 8 medium, 6 low
**Opened:** 2026-09-19 | **Last verified:** 2026-09-19

## Critical

### Three mutually-inconsistent definitions of the same tables (ProducerDetails, SavedLists) across ad hoc scripts, qa-setup, and EF migrations (`sql.inconsistent-table-definitions-producerdetails-savedlists`)
- **Files:** `api/GrainOriginatorPortal.Api/Scripts/CreateProducerDetailsTable.sql`, `api/GrainOriginatorPortal.Api/Scripts/CreateSavedListsTable.sql`, `scripts/qa-setup.sql`, `scripts/_VerifySchema.sql`
- `CreateProducerDetailsTable.sql`, `qa-setup.sql`, and the real EF snapshot all disagree on column types and presence; whichever script actually ran in a given environment silently determines that environment's real schema, independent of and diverging from the EF model.
- **Suggested fix:** Archive/delete the stale `Scripts/*.sql` table-creation files; treat EF migrations as the single source of truth, and reconcile any environment seeded from the wrong script.

## High

### Hand-rolled DDL plus faked EF migration history for BidSheet tables (`sql.handrolled-ddl-faked-migration-history`)
- **Files:** `migrate-bid-sheet.sql`, `scripts/backfill-migration-history.sql`
- These scripts hand-build the `BidSheetLocations`/`BidSheetLocationBids` schema in raw SQL, then insert a row into `__EFMigrationsHistory` claiming a migration already ran. EF can never detect drift between this hand-written DDL and its own model.
- **Suggested fix:** Replace this pattern with a real EF migration; add a verification step that diffs the live schema against the EF snapshot before backfilling history rows.

### Migration Down() applies destructive, unrelated schema changes that Up() never made (`sql.migration-down-applies-unrelated-destructive-changes`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/Migrations/20260311180519_AddNoteCustomerCode.cs`
- `Up()` only adds a nullable `Notes.CustomerCode` column, but `Down()` also runs two unrelated `AlterColumn` calls widening `ProducerDetails.Id` and `Notes.Id` from `int` to `bigint`. Rolling back would silently widen both PK columns.
- **Suggested fix:** Remove the two stray `AlterColumn` calls from `Down()` so it only reverses the `CustomerCode` addition.

### LinkedProducerIds column type mismatch between script and canonical schema (`sql.linkedproducerids-column-type-mismatch`)
- **Files:** `api/GrainOriginatorPortal.Api/Scripts/AddLinkedProducerIds_ProducerDetails.sql`, `scripts/qa-setup.sql`
- `AddLinkedProducerIds_ProducerDetails.sql` adds the column as `VARCHAR(1000)`, while `qa-setup.sql`'s canonical definition uses `NVARCHAR(1000)`. If the VARCHAR version is live anywhere, non-ASCII producer names/IDs would be silently corrupted.
- **Suggested fix:** Standardize on `NVARCHAR(1000)` in both places and reconcile via a single tracked migration.

## Medium

### PopulateMbpLocationSynonym.sql runs an unguarded mass-delete MERGE (`sql.unguarded-mass-delete-merge`)
- **Files:** `api/GrainOriginatorPortal.Api/Scripts/PopulateMbpLocationSynonym.sql`
- The `MERGE ... WHEN NOT MATCHED BY SOURCE THEN DELETE` has no row-count threshold check before committing — a bad/truncated source export would silently mass-delete location master rows with only a `PRINT` statement as a trace.
- **Suggested fix:** Add a pre-commit guard that aborts/rolls back if the delete count exceeds a sane percentage of current rows.

### Ambiguous DisplayName join can mis-assign UPN during CreatedBy backfill (`sql.ambiguous-displayname-join-createdby-backfill`)
- **Files:** `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`
- The remediation script joins `Notes.CreatedBy` to `UserTradeUnitSnapshot.DisplayName` to resolve a UPN, but `DisplayName` is not unique in that table, so rows with duplicate DisplayNames can get an arbitrary/wrong UserId.
- **Suggested fix:** Skip or flag rows where `COUNT(DISTINCT UserId) > 1` for a given DisplayName instead of joining blindly.

### Orphaned/stale ops script targets a column that no longer exists (`sql.orphaned-stale-script-nonexistent-column`)
- **Files:** `api/GrainOriginatorPortal.Api/Scripts/DropEstimatedYield_ProducerPlantingIntentions.sql`
- The script drops `ProducerPlantingIntentions.EstimatedYield`, but that column is absent from the current expected schema, indicating stale scripts aren't being cleaned up after use.
- **Related findings:** `clean-slop.stale-ops-scripts`
- **Suggested fix:** Delete the script from the repo now that its one-time purpose is complete, or move completed ops scripts to an archive folder.

### GroupTradeUnits.GroupId foreign key has no supporting index (`sql.grouptradeunits-fk-missing-index`)
- **Files:** `scripts/qa-setup.sql`
- `GroupTradeUnits.GroupId` has an explicit FK to `TradeUnitGroups` but only `TradeUnitCode` is indexed on that table; ON DELETE/ON UPDATE behavior is also left unspecified.
- **Related findings:** `performance.grouptradeunits-missing-index`
- **Suggested fix:** Add a nonclustered index on `GroupTradeUnits.GroupId` and specify explicit delete/update behavior on the FK.

### CustomerTradeUnit->Customer cascade delete breaks the codebase's own documented pattern (`sql.customertradeunit-cascade-delete-breaks-pattern`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/ApplicationDbContext.cs`
- Every other FK to `Customer` in this file is explicitly `NoAction` with a comment explaining it's deliberate. `CustomerTradeUnit`'s Customer FK is `Cascade` with no comment, so a Customer rebuild could silently delete manually-curated rows.
- **Suggested fix:** Change `CustomerTradeUnit`'s Customer FK to `NoAction`/`Restrict` to match the established pattern, or add a comment justifying the difference.

### Unjustified string-typed primary keys (`sql.unjustified-string-primary-keys`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/ApplicationDbContext.cs`
- `ElevatorCache` uses `ElevatorCode` (`nvarchar(50)`) as its PK, and `UserTradeUnitSnapshot` uses a composite key of two string columns, with no documented justification per the style guide's surrogate-key requirement.
- **Suggested fix:** Add a comment documenting why the external code is used as a natural key, or introduce a surrogate INT/BIGINT identity PK with the code as a unique index instead.

### FromSqlRaw fed a C#-interpolated string instead of FromSqlInterpolated (`sql.fromsqlraw-interpolated-string`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/CustomerRepository.cs`
- `SearchAsync`/`SearchOdsAsync` build the WHERE clause via C# string interpolation before passing to `FromSqlRaw`/`SqlQueryRaw` with separate SqlParameters; values are parameterized correctly today, but the pattern is one accidental edit away from real injection.
- **Suggested fix:** Build the WHERE clause via `StringBuilder`/`string.Concat` (not `$"..."`) so the pattern can't be miscopied later with genuinely interpolated data.

### Foreign keys added WITH NOCHECK are never revalidated (`sql.nocheck-foreign-keys-never-revalidated`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/Migrations/20260513195804_AddCustomerFkAndCustomerLink.cs`
- Three FKs were added `WITH NOCHECK` to skip validating pre-existing orphan rows, with a comment noting they should be revalidated later via `WITH CHECK CHECK CONSTRAINT` — no later migration ever does this.
- **Suggested fix:** Add a follow-up migration that cleans up orphan rows and runs `WITH CHECK CHECK CONSTRAINT` on all three, or explicitly document this as an accepted permanent gap.

## Low

### Non-idempotent ALTER scripts will fail if re-run (`sql.non-idempotent-alter-scripts`)
- **Files:** `AddFilters_SavedLists.sql`, `AddLinkedProducerIds_ProducerDetails.sql`, `AddTypeToPlantingIntentions.sql`
- These scripts run bare `ALTER TABLE ADD` statements with no `IF NOT EXISTS` guard, so re-running any of them against an environment where they already applied will error out.
- **Suggested fix:** Wrap each ALTER in an `IF NOT EXISTS (SELECT * FROM sys.columns ...)` guard per the migration standards template.

### Location master data hardcoded independently in two scripts (`sql.hardcoded-location-data-duplicated`)
- **Files:** `api/GrainOriginatorPortal.Api/Scripts/CheckMbpLocationCoverage.sql`, `api/GrainOriginatorPortal.Api/Scripts/PopulateMbpLocationSynonym.sql`
- Both scripts embed roughly a thousand-plus literal location rows independently rather than one sourcing from the other's target table, guaranteeing drift over time.
- **Related findings:** `clean-slop.hardcoded-location-data-duplicated`
- **Suggested fix:** Have the coverage-check script query the populated table directly instead of maintaining a separate hardcoded list.

### Y/N flags modeled as NVARCHAR(1) instead of BIT on app-owned tables (`sql.yn-flags-as-nvarchar-not-bit`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Data/Entities/ElevatorCache.cs`, `api/GrainOriginatorPortal.Infrastructure/Data/Entities/MbpLocationSynonym.cs`
- `OurFacility`, `PushNotificationsHidden`, and `CashBidsHidden` are documented as Y/N values but typed as string/`nvarchar(1)` rather than bool/BIT, pushing string-comparison logic into every consumer.
- **Suggested fix:** Add a bool property with `HasConversion` to Y/N (or migrate the columns to BIT) for these two app-owned tables.

### ExecuteSqlRawAsync built via string interpolation of a compile-time constant (`sql.executesqlraw-interpolated-constant`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/UsageRepository.cs`
- Uses C# interpolation to splice in a private constant into the SQL text; the real runtime cutoff value is passed safely via the parameterized overload, so there is no real injection risk, but it matches the letter of the no-string-interpolated-SQL rule.
- **Suggested fix:** Replace the interpolated string with plain string concatenation for lint/style compliance.

### SELECT c.* used in raw SQL instead of an explicit column list (`sql.select-star-in-raw-sql`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/ContractRepository.cs`, `api/GrainOriginatorPortal.Infrastructure/Repositories/CustomerRepository.cs`
- `FromSqlInterpolated` calls use `SELECT c.*` mapped onto full entity types, brittle to schema drift; `TicketRepository.cs` already documents why the team prefers naming every column explicitly elsewhere in the same codebase.
- **Suggested fix:** Enumerate the mapped columns explicitly, matching `TicketRepository`'s existing pattern.

### N+1 query in bid-insert race-reconciliation retry path (`sql.n-plus-one-bid-insert-reconciliation`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/BidSheetRepository.cs`
- `ReconcileDuplicateBidInsertsAsync` issues one `FirstOrDefaultAsync` DB round trip per colliding bid inside a foreach loop instead of a single batched lookup; low impact since it only runs on the rare unique-constraint-violation retry path.
- **Related findings:** `performance.bidsheet-reconcile-n-plus-one`
- **Suggested fix:** Batch-load all potentially colliding rows in one query keyed by the tuple set, then reconcile in memory (mirroring `BulkUpsertBidsAsync`).
