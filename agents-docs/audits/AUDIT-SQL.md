# Audit: SQL (`sql`)

Style guide: `style-guides/sql.md`
Scope: `api/GrainOriginatorPortal.Api/Scripts`, `api/GrainOriginatorPortal.Infrastructure/Data` (migrations, `ApplicationDbContext`, repositories), `scripts/`, `SECURITY-REVIEWS/scripts/`

**Findings:** 19 total — 0 open, 6 accepted, 1 won't-fix, 12 resolved
**Opened:** 2026-09-19 | **Last verified:** 2026-10-20

## What was checked this pass

This pass found **no new migrations since 2026-10-13** (`20261013163045_RestrictCustomerTradeUnitDeleteAndValidateCustomerFks` is still the newest file on disk), so the schema surface is unchanged from the last reconciliation. The actual work this pass was discovering and fixing a **drift between `AUDIT-TRACKING.json` and this file**: the JSON already recorded five findings as `resolved`/`accepted` (with dates and resolution notes from 2026-10-13/14), but this markdown's `## Open` section still listed all five as open, unchanged since the 2026-09-28 pass. That made the file self-contradictory — the header said "Last verified: 2026-10-13" while the body described a pre-fix world.

Re-verified all five directly against the current working tree (not just trusting the JSON):

- **`sql.customertradeunit-cascade-delete-breaks-pattern`** — confirmed `ApplicationDbContextModelSnapshot.cs` and migration `20261013163045` show the `CustomerTradeUnit`→`Customer` FK re-added without a cascade override (default `NoAction`), matching every sibling FK to `Customer`. Resolved, confirmed.
- **`sql.nocheck-foreign-keys-never-revalidated`** — confirmed migration `20261013163045` contains the `WITH CHECK CHECK CONSTRAINT` statements for all three previously-untrusted FKs (`Notes`, `ProducerDetails`, `ProducerPlantingIntentions`). Resolved, confirmed.
- **`sql.ambiguous-displayname-join-createdby-backfill`** — read `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql` in full; every `CreatedBy`/`ModifiedBy` join now carries the `GROUP BY ... HAVING COUNT(DISTINCT UserId) = 1` guard, across all nine table joins (Notes, ProducerPlantingIntentions, ProducerDetails, SavedLists, three Dashboard* tables, two BidSheet* tables). Resolved, confirmed.
- **`sql.fromsqlraw-interpolated-string`** — read `CustomerRepository.cs` in full; `BuildSearchSql`/`BuildOdsSearchSql` are the only place the WHERE text is assembled, and only fixed fragments plus generated parameter names (`@w{i}`, `@d{i}`, `@tradeUnits`) are interpolated — every typed value is a `SqlParameter` built via `SqlSanitization.SanitizeCsv`'s allow-list regex. Resolved, confirmed.
- **`sql.hardcoded-location-data-duplicated`** — no change to `PopulateMbpLocationSynonym.sql` since the 2026-10-14 acceptance. Accepted, confirmed (was mis-listed as Open).

Also independently re-derived, from a fresh read rather than relying on the tracker:

- Every FK-bearing table sampled (`CustomerTradeUnit`, `ProducerPlantingIntentions`, `Notes`, `ProducerDetails`) has a supporting index on its FK column(s) in the current model snapshot.
- `CustomerRepository`, `ContractRepository`, `TicketRepository`, `UsageRepository` raw-SQL call sites (`FromSqlRaw`, `FromSqlInterpolated`, `ExecuteSqlRawAsync`) all parameterize caller-controlled values correctly; the only interpolated text is fixed SQL fragments, generated parameter names, or `OdsConstants`/private-const values that never carry user input.
- Sampled ops scripts (`CheckCustomerFkOrphans.sql`, `Drop-BidSheetPreGlobalSnapshots.sql`, `Restore-ElapsedBidMonths.sql`, `planting-intentions-trade-unit-audit.sql`) are read-only or guarded by `@DryRun`/idempotency checks, with no new issues.
- Did not inspect a live database (Dev/QA/Prod) this pass either — same blind spot as every prior pass.

No new findings were opened this pass.

## Open

None. All previously-open findings are either resolved or accepted (see below) as of 2026-10-13/14, confirmed again 2026-10-20.

## Accepted (real, deliberately not fixed — see `docs/application-context/STYLE-DEVIATIONS.md`)

- **`sql.migration-down-applies-unrelated-destructive-changes`** (high) — `AddNoteCustomerCode.cs` `Down()` still widens `ProducerDetails.Id`/`Notes.Id` to `bigint`, unrelated to `Up()`. Accepted: migrations run forward-only in this deploy workflow.
- **`sql.unjustified-string-primary-keys`** (medium) — `ElevatorCache.ElevatorCode` and `UserTradeUnitSnapshot`'s composite key remain string-typed. Accepted: natural key from ODS, with `BarchartInstrument.Symbol` as a precedent for the same shape.
- **`sql.yn-flags-as-nvarchar-not-bit`** (low) — `MbpLocationSynonym` Y/N columns remain `nvarchar`. Accepted: faithful mirror of an external export.
- **`sql.executesqlraw-interpolated-constant`** (low) — `UsageRepository.cs` still splices a private `const` into an interpolated SQL string. Accepted: no runtime value ever reaches the string.
- **`sql.select-star-in-raw-sql`** (low) — `ContractRepository.cs`/`CustomerRepository.cs` still use `SELECT c.*` mapped onto full entity types. Accepted: entity is the shape contract.
- **`sql.hardcoded-location-data-duplicated`** (low) — `PopulateMbpLocationSynonym.sql` still embeds ~1,000+ literal location rows. Accepted 2026-10-14: it's a pasted export of the source system and the live QA/PROD load path, guarded by `@maxDeletePct`; a real fix needs a scheduled load from the data team.

## Won't fix

- **`sql.grouptradeunits-fk-missing-index`** (medium) — not applicable; `GroupTradeUnits` and its only creator script are both gone.

## Resolved

All fixed on branch `fix_AuditPhase1Findings` (PR #615) unless noted:

- **`sql.inconsistent-table-definitions-producerdetails-savedlists`** (critical), **`sql.handrolled-ddl-faked-migration-history`** (high), **`sql.linkedproducerids-column-type-mismatch`** (high), **`sql.unguarded-mass-delete-merge`** (medium), **`sql.orphaned-stale-script-nonexistent-column`** (medium), **`sql.non-idempotent-alter-scripts`** (low), **`sql.n-plus-one-bid-insert-reconciliation`** (low) — all as previously recorded.
- **`sql.stale-schema-verification-script`** (high) — regenerated 2026-09-21 and kept current since, most recently through the 2026-10-09 Bin Sites changes.
- **`sql.customertradeunit-cascade-delete-breaks-pattern`** (high) — fixed 2026-10-13: migration `20261013163045` swaps the FK from `Cascade` to the pattern-matching default (`NoAction`).
- **`sql.nocheck-foreign-keys-never-revalidated`** (medium) — fixed 2026-10-13: same migration validates all three previously-untrusted FKs; production had zero orphan rows behind any of them.
- **`sql.ambiguous-displayname-join-createdby-backfill`** (medium) — closed 2026-10-13 on production evidence (no shared `DisplayName` maps to more than one login), and the script was hardened with a `COUNT(DISTINCT UserId) = 1` guard on every join regardless.
- **`sql.fromsqlraw-interpolated-string`** (medium) — fixed 2026-10-14: query building moved into public static `CustomerRepository.BuildSearchSql`/`BuildOdsSearchSql` with a dedicated injection-guard test (`CustomerSearchSqlTests`) that fails the build if a value ever reaches the SQL text directly.

## Blind spots

- No live database (Dev/QA/Prod) was inspected in this pass; all conclusions rest on migration files, the EF model snapshot, and the standalone `.sql` scripts in the repo.
- Row-level confirmation that `CustomerTradeUnit` rows with `IsManual = 1` exist in a real database (beyond the 22,491 counted during the 2026-10-13 production check) was not re-verified this pass.
- This pass's main contribution was tracker hygiene (reconciling this file with `AUDIT-TRACKING.json`), not new schema or query analysis — the schema surface hasn't changed since 2026-10-13, so a deeper re-read of the full migration history was not repeated.
