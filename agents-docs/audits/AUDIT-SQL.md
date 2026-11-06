# Audit: SQL (`sql`)

Style guide: `style-guides/sql.md`
Scope: `api/GrainOriginatorPortal.Api/Scripts`, `api/GrainOriginatorPortal.Infrastructure/Data` (migrations, `ApplicationDbContext`, repositories), `scripts/`, `SECURITY-REVIEWS/scripts/`

**Findings:** 22 total — 3 open, 6 accepted, 1 won't-fix, 12 resolved
**Opened:** 2026-09-19 | **Last verified:** 2026-11-05

## What was checked this pass

The schema surface **did move** since the last reconciliation (2026-10-13/2026-10-20): five new migrations have landed —
`20261020171105_ConvertYearlyBidsToFuturesMonth`, `20261022142931_ExcludeNotesWithoutTradeUnitFromRecap`,
`20261029193914_AddFieldPlanTables`, `20261103215107_DropProgramEnrollment`, and
`20261103220955_AddFieldSeasonUniqueRow` (the field-plan feature: `ProducerField`, `ProgramEnrollment` created
then dropped the same week, `ProducerFieldSeason`, `FieldProgramRecord`). Read each in full:

- `AddFieldPlanTables` — all four new tables have explicit PKs, FK-column indexes (`IX_ProducerField_CustomerId`,
  `IX_ProducerFieldSeason_PlantingIntentionId`, `IX_ProducerFieldSeason_ProducerFieldId`), and a filtered unique
  index (`UQ_FieldProgramRecord_Season_Program ... WHERE IsDeleted = 0`) consistent with the codebase's existing
  soft-delete pattern. No issues.
- `DropProgramEnrollment` / `AddFieldSeasonUniqueRow` — clean, well-commented, reversible (or explicitly and
  justifiably not). No issues.
- `ConvertYearlyBidsToFuturesMonth` — a data-only migration with unusually thorough production-measurement
  commentary; each `UPDATE`/`DELETE` is naturally idempotent (its own `WHERE` becomes false after the first run).
  No issues.

Also re-sampled (not previously covered in this depth) the raw-SQL repository seam beyond `CustomerRepository`:
`ContractRepository`, `TicketRepository` `FromSqlInterpolated` call sites — confirmed the same safe pattern
(only fixed fragments, generated parameter names, and `SanitizeCsv`/`SanitizeIdentifierCsv`-sanitized CSVs are
interpolated; every caller-typed value still travels as a parameter). No new injection-shaped findings.

Three new, non-security findings opened this pass (see Open below) from a closer read of the EF model snapshot:
a function-on-indexed-column performance smell in the ODS onboarding dedupe, a naming/type standards violation
on `ESignEnrollment`'s GUID column, and a cross-table type inconsistency for latitude/longitude. None are
regressions — all three predate this week's migrations and were simply not caught in prior passes.

Did not inspect a live database (Dev/QA/Prod) this pass — same blind spot as every prior pass.

## Open

- **`sql.scoularid-trim-defeats-index-seek`** (medium) — `CustomerRepository.SearchOdsAsync` wraps the indexed
  `Customer.ScoularId` column in `.Trim()` inside a LINQ predicate, which the style guide flags as an anti-pattern
  (function on an indexed column defeats the seek). Candidate set is bounded today (one page of onboarding
  search results), so this is standards drift with headroom risk rather than a confirmed live slow query.
- **`sql.esignenrollment-guid-column-not-uniqueidentifier`** (low) — `ESignEnrollment`'s GUID-shaped column is
  `nvarchar(255)` named `GUID` (CLR property `Guild`, likely a typo), and `eSignEnabled` breaks PascalCase
  column naming. Cosmetic/standards drift, not a correctness issue.
- **`sql.latlong-type-inconsistent-across-tables`** (low) — `BarchartInstrument.Latitude/Longitude` are `float`
  while `ProducerBinSite.Latitude/Longitude` are `decimal(18,15)`; no documented reason for the divergence.

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
