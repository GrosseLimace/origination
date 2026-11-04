# Field Plan & Sustainability Programs — Database Plan

**Status:** APPROVED 2026-10-27 (H. Collins). Ready to merge 2026-10-30; nothing has been applied to any shared database yet (see below for how each environment gets the tables).
**Date:** 2026-10-27 · **Owner:** H. Collins · **Branch:** `feature_FieldSustainabilityPrograms`

> **Ready to merge (2026-10-30).** The release hold is lifted. The tables ship as one EF Core migration, and
> every deploy workflow (DEV, QA, PROD, all run by hand) runs `dotnet ef database update` before releasing new
> code. **How the tables get built:**
> 1. **DEV first.** The next `release_DEV_*` branch cut from `main` after the merge creates them on its DEV deploy
>    (the "Apply EF Core migrations (Dev)" step logs `Applying migration '20261029193914_AddFieldPlanTables'`).
>    A follow-up change then sets `fieldPlanBackend: 'api'` in `environment.dev.ts` so DEV saves to them.
> 2. **QA and PROD.** Their next routine deploys create the empty tables. `api/field-plan` is live there but
>    the screens stay hidden (`fieldPlanningEnabled` / `carbonIntensityEnabled` off) until a separate go-live
>    release turns them on with `fieldPlanBackend: 'api'`.
> 3. **DBA option.** If the DBA would rather apply QA or PROD by hand, [scripts/field-plan-AddFieldPlanTables.sql](../../scripts/field-plan-AddFieldPlanTables.sql)
>    creates the tables and records the migration, so the deploy skips it (it still creates `ProgramEnrollment`; run [scripts/field-plan-AfterAddFieldPlanTables.sql](../../scripts/field-plan-AfterAddFieldPlanTables.sql) after it, or let the deploy apply `DropProgramEnrollment` and `AddFieldSeasonUniqueRow`). Run it with `SET XACT_ABORT ON` first (the follow-up script sets it itself) so a failed statement rolls back before the migration is recorded; `sqlcmd -b` alone doesn't do that.

> **As-built notes (after approval).** Two changes on 2026-10-29 for go-live (H. Collins with the business). Neither touches an existing table:
> 1. **Split IDs typed by hand.** CTRM's splits query may not be ready for go-live, so `ProducerField` gained `SplitSource` (`Manual` or `Ctrm`). The migration had never been applied anywhere, so it was regenerated as `20261029193914_AddFieldPlanTables` rather than adding a second one, and the review SQL was regenerated with it.
> 2. **The confirmed CI.** `FieldProgramRecord.Official` is no longer an empty placeholder. It holds the CI the originator confirms after harvest, having reviewed the inputs and the field's CTRM tickets with the producer: the bushels, the tickets, and who confirmed it. This needed no schema change; the column already existed.
>
> Two endpoints were added: `GET records/{id}/tickets` and `POST records/{id}/confirm`.
>
> 3. **Harvest complete removed (2026-10-30).** Confirming each field replaced the enrollment-wide "Mark harvest complete", so `records/{id}/lock` and `enrollments/{key}/harvest-complete` were removed; a record is now locked only by confirming it.
> 4. **Enrollment dropped (2026-11-03).** 45Z only calculates and confirms a CI; no producer attestation is captured. `dbo.ProgramEnrollment` and its routes (`enrollments`, `/attestation`, `/attest`, `/withdraw`) are gone, dropped by migration `20261103215107_DropProgramEnrollment` (the optional DBA script [scripts/field-plan-AfterAddFieldPlanTables.sql](../../scripts/field-plan-AfterAddFieldPlanTables.sql) applies it and the next migration). `20261029193914_AddFieldPlanTables` is unchanged because it was already deployed to DEV and QA, so its script still creates the table and the drop follows.
> 5. **One field per crop row (2026-11-03).** Migration `20261103220955_AddFieldSeasonUniqueRow` adds `UQ_ProducerFieldSeason_Field_PlantingIntention`, a unique index on `ProducerFieldSeason (ProducerFieldId, PlantingIntentionId)` with soft-deleted rows excluded. It backs the service's `FIELD_PLAN_FIELD_ON_ROW` check in the database; the service still also refuses a second row of the same crop, which the index can't express.

## What this is

Originators can now plan a producer's crop year field by field and calculate and confirm each field's CI for sustainability programs:
- **45Z:** a carbon-intensity (CI) estimate from USDA's FD-CIC calculator.
- **Later programs:** the tables are program-neutral (a program key plus its own JSON), so another program needs no schema change. 45Z is the only approved program; GrainCraft was prototyped and removed on 2026-10-30.

Today all of it lives in the browser and disappears on reload. These tables keep it.

A **field** is one of the producer's CTRM **split IDs**, e.g. `TATOB43` "JARBOE WEST". Producers already set up a split per field, and tickets are delivered under it. The design and business rules are in [docs/45z/README.md](../45z/README.md).

**Footprint:**
- 3 tables in `dbo`, in `ApplicationDbContext` (a fourth, `ProgramEnrollment`, was dropped on 2026-11-03).
- No changes to existing tables, and no stored procedures.
- Everything ships through the normal migration pipeline.

## How the pieces fit

```
dbo.Customer (existing)
   │
   ├── ① ProducerField ─────────── one row per CTRM split the producer uses as a field
   │        │
   │        └── ② ProducerFieldSeason ── that field on one crop row (planting intention) for a year
   │                 │                      └── dbo.ProducerPlantingIntentions (existing)
   │                 └── ③ FieldProgramRecord ── that season's inputs for one program (45Z)
```

A field is "in 45Z" when it has a 45Z `FieldProgramRecord`. There is no enrollment, attestation or withdrawal: 45Z here only calculates and confirms a CI, and a confirmed CI changes only by unlocking it with a reason.

**Conventions** (the same as planting intentions and bin sites):
- `int` identity keys.
- `long CustomerId` with a foreign key to `dbo.Customer`, `NoAction`, so deleting a customer never cascades into user-entered data.
- `CreatedAt` defaults to UTC. `CreatedBy`, `ModifiedAt` and `ModifiedBy` hold the signed-in user.
- Flexible program data is kept as JSON in `nvarchar(max)` columns, the way `Note.Mentions` and `SavedList.Filters` already are.
- Where rows can be removed, removal is a soft delete (`IsDeleted`, `DeletedAt`, `DeletedBy`) with a model-level query filter. Planting intentions do the same.

---

## The 4 new tables

### ① `dbo.ProducerField`: a producer's field (a CTRM split)

| Column | Type | What it is |
|---|---|---|
| `Id` (PK) | `int` identity | |
| `CustomerId` | `bigint` → `dbo.Customer` | The producer |
| `SplitId` | `nvarchar(20)`, **unique** | CTRM split ID, e.g. `TATOB43`. Stored upper-case. |
| `Name` | `nvarchar(255)` | The split's field name as CTRM had it, e.g. "JARBOE WEST" |
| `SplitPercent` | `decimal(7,3)` | The producer's share, e.g. 66.667 |
| `EffectiveDate` | `date` NULL | When the split took effect in CTRM |
| `State` | `nvarchar(2)` NULL | Where the field is. 45Z needs it; asked once, not every year. |
| `County` | `nvarchar(100)` NULL | 〃 |
| `SplitSource` | `nvarchar(10)`, default `Manual` | `Manual` when the originator typed the split ID, name and share; `Ctrm` when they came from CTRM |
| `CreatedAt/By`, `ModifiedAt/By` | | Audit |

- **`SplitId` is unique across all producers.** A split belongs to one producer, so two producers can never hold the same field.
- **There is no delete.** A field stays once added; it simply has no season in a year it isn't planted.
- **Where `Name`, `SplitPercent` and `EffectiveDate` come from:**
  - From CTRM's splits query (`SplitSource = Ctrm`), they're copied when the field is added and are read-only in the app.
  - Until that query is live, the originator types them (`SplitSource = Manual`). See the as-built notes.

### ② `dbo.ProducerFieldSeason`: a field on a crop row for a year

| Column | Type | What it is |
|---|---|---|
| `Id` (PK) | `int` identity | |
| `ProducerFieldId` | `int` → ① | The field |
| `PlantingIntentionId` | `int` → `dbo.ProducerPlantingIntentions` | The crop row it's planted under |
| `CropYear` | `int` | e.g. 2026 |
| `CropLabel` | `nvarchar(100)` | The crop row's label at the time, e.g. "Irrigated Corn" |
| `Acres` | `decimal(10,2)` NULL | This field's acres on that crop row |
| Audit + soft delete | | |

- A field can sit on more than one crop row in a year (double-cropping), so there is no unique rule here.
- **A season with a confirmed (locked) field can't be removed or have its acres changed.**

### ③ `dbo.FieldProgramRecord`: a season's inputs for one program

| Column | Type | What it is |
|---|---|---|
| `Id` (PK) | `int` identity | |
| `ProducerFieldSeasonId` | `int` → ② | |
| `ProgramKey` | `nvarchar(30)` | `45z-fdcic` (45Z, the only approved program) |
| `Status` | `nvarchar(10)` | `Draft`, `Ready` or `Locked` |
| `Data` | `nvarchar(max)` JSON | The program's inputs (for 45Z: yields, N rate, tillage, cover crop, manure…) |
| `CopiedFromYear` | `int` NULL | Inputs were prefilled from this field's previous year |
| `CopiedFromField` | `nvarchar(255)` NULL | Inputs were copied from this field this year |
| `Frozen` | `nvarchar(max)` JSON NULL | The CI frozen when the field is confirmed: inputs, outputs, CI, and the USDA calculator version that produced it |
| `LockedBy`, `LockedAt` | NULL | Who locked it, and when |
| `Reopened` | `nvarchar(max)` JSON NULL | Each unlock: the reason, when it happened, and the estimate that was unlocked. Kept forever. |
| `Official` | `nvarchar(max)` JSON NULL | The **confirmed CI** (45Z): written when the originator confirms the field after harvest with the producer. It holds the CI rescored at the confirmed actual yield, the USDA version, the bushels and the CTRM tickets, and who confirmed it and when. Null until then. |
| Audit + soft delete | | |

- **One record per program per season.** A unique index on (`ProducerFieldSeasonId`, `ProgramKey`) ignores removed rows.
- **Locked rows are never changed or removed.** To change one, the user unlocks it with a reason, which is kept in `Reopened`.
- **Why JSON:** each program asks for different inputs, and USDA changes the 45Z inputs between versions. JSON lets a new version or program arrive without a migration. Reporting reads the frozen result, which is the same shape for every version (CI, bushels, version label).

### Enrollment IDs are derived

The per-field enrollment ID is not stored. It is derived as `CI-{crop year}-{split ID}`, e.g. `CI-2026-TATOB43`, so nobody types it and tickets can resolve it from the split ID and crop year they already carry. See [Enrollment identifier](../45z/README.md#enrollment-identifier); whether auditors need it stored is still open.

---

## Rules the server enforces

The browser applies these today. Once the tables exist, the API owns them:

1. **A split is one producer's field.** Adding a split that another producer already holds is refused.
2. **Locking rescores on the server.**
   - Confirming a field after harvest locks it. For 45Z, the API recomputes the CI with its own USDA calculator. It stores that result together with the calculator version, workbook hash and formula fingerprint, and never uses the browser's number.
   - A locked estimate is never rescored under a later USDA version.
3. **A locked record can't be edited.** It must be unlocked with a reason first.
4. **A CI is an estimate until it is confirmed.** The frozen result is stamped `basis: Estimate`; only confirming a field after harvest, with the producer and its CTRM tickets, writes `Official` (the confirmed CI).

## Access and auditing

- **Who can read and write:** any signed-in user, the same as planting intentions. This is covered by accepted risks AR-01 to AR-03 in `SECURITY-REVIEWS/ACCEPTED-RISKS.md`, and each new route cites them.
- **Audit logging:** every write logs a structured `AUDIT_*` line with the user, as planting intentions do.
- **Sensitive data:** none of these tables holds PII. They contain producer business data (field names, acres, farming practices).
- **No connection strings or secrets** are added.
- **Rollout:** the feature stays behind the client flags `fieldPlanningEnabled` and `carbonIntensityEnabled`, which are off in QA and PROD. DEV keeps the in-memory version until CTRM's split query is live, so no sample split IDs land in the DEV database.

## API

One controller, `api/field-plan`, matching the client contract in `field-plan-backend.ts`:

| Method | Route | Does |
|---|---|---|
| GET | `customer/{customerId}` | Everything for one producer: fields, seasons, records |
| POST / PUT | `fields`, `fields/{splitId}` | Add a split as a field; set its state/county |
| POST / PUT / DELETE | `seasons`, `seasons/{id}` | Put a field on a crop row; change acres; take it off |
| POST / PUT / DELETE | `records`, `records/{id}` | Add a program to a field; save inputs; remove |
| POST | `records/{id}/reopen` | Unlock a confirmed CI with a reason; both stay in the history |
| GET | `records/{id}/tickets` | The field's CTRM tickets for its crop and crop year, settled or not |
| POST | `records/{id}/confirm` | Confirm the CI after harvest with the producer: actual yield and tickets kept |

## Rollback

The migration (`20261029193914_AddFieldPlanTables`) only creates new tables and their indexes (four, one of which `DropProgramEnrollment` later removed), so its `Down()` drops them. No existing table or row is touched. `DropProgramEnrollment` only drops `dbo.ProgramEnrollment`; its `Down()` recreates it empty.

The exact SQL it runs is in [scripts/field-plan-AddFieldPlanTables.sql](../../scripts/field-plan-AddFieldPlanTables.sql), for DBA review:
- 4 `CREATE TABLE` statements and their indexes;
- no `ALTER`, `DROP`, `UPDATE` or `DELETE`.

It was generated with:

```
dotnet ef migrations script 20261022142931_ExcludeNotesWithoutTradeUnitFromRecap AddFieldPlanTables --idempotent --project api/GrainOriginatorPortal.Infrastructure --startup-project api/GrainOriginatorPortal.Api --context ApplicationDbContext
```

Regenerate it if `main` gains another migration first.

## Open questions that could change the schema

1. **45Z acres:** the whole field's acres, or the producer's split share? Today acres are entered as-is.
2. **Landlord and tenant:** do they always get separate split IDs? Rule 1 assumes yes.
3. **Enrollment ID:** the final format, and whether it must also be stored for auditors.
4. **The official CI:**
   - what it requires (evidence, verifier, sign-off);
   - whether `Official` becomes its own table.
5. **USDA updates mid-season:** should unlocked fields be rescored under the new version?
6. **CTRM splits query** (Integrations): fields and names. It doesn't change these tables, only where `Name`, `SplitPercent` and `EffectiveDate` come from.

## Approval

| Role | Name | Date |
|---|---|---|
| Product owner | H. Collins | 2026-10-27 |
| IT lead / DBA review | H. Collins | 2026-10-27 |
