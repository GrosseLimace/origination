# Field Plan & Sustainability Programs — Database Plan

**Status:** APPROVED 2026-10-27 (H. Collins). The tables, API and migration are built on the branch, and nothing has been applied to any shared database yet.
**Date:** 2026-10-27 · **Owner:** H. Collins · **Branch:** `feature_FieldSustainabilityPrograms`

> **Release hold.** The tables ship as one EF Core migration, and every deploy workflow runs
> `dotnet ef database update` before releasing new code. Merging to `main` would therefore create the tables,
> and expose `api/field-plan`, in QA and PROD on their next deploys, even though the screens stay hidden there.
> So the branch stays off `main` until the feature is ready for QA and PROD.
>
> Two ways to get the tables onto DEV before then:
> - a `release_DEV_<date>` branch (`main` plus this branch) deployed to DEV;
> - a DBA running [scripts/field-plan-AddFieldPlanTables.sql](../../scripts/field-plan-AddFieldPlanTables.sql). It records the migration, so a later deploy skips it.

## What this is

Originators can now plan a producer's crop year field by field and enroll those fields in sustainability programs:
- **45Z:** a carbon-intensity (CI) estimate from USDA's FD-CIC calculator.
- **GrainCraft:** wheat.

Today all of it lives in the browser and disappears on reload. These tables keep it.

A **field** is one of the producer's CTRM **split IDs**, e.g. `TATOB43` "JARBOE WEST". Producers already set up a split per field, and tickets are delivered under it. The design and business rules are in [docs/45z/README.md](../45z/README.md).

**Footprint:**
- 4 new tables in `dbo`, in `ApplicationDbContext`.
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
   │                 └── ③ FieldProgramRecord ── that season's inputs for one program (45Z, GrainCraft)
   │
   └── ④ ProgramEnrollment ─────── the producer in one program for one crop year
                                      (attestation, harvest complete, withdrawal)
```

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
| `CreatedAt/By`, `ModifiedAt/By` | | Audit |

- **`SplitId` is unique across all producers.** A split belongs to one producer, so two producers can never hold the same field.
- **There is no delete.** A field stays once added; it simply has no season in a year it isn't planted.
- `Name`, `SplitPercent` and `EffectiveDate` are copied from CTRM when the field is added and are read-only in the app.

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
- **A season with a locked harvest estimate can't be removed or have its acres changed.**

### ③ `dbo.FieldProgramRecord`: a season's inputs for one program

| Column | Type | What it is |
|---|---|---|
| `Id` (PK) | `int` identity | |
| `ProducerFieldSeasonId` | `int` → ② | |
| `ProgramKey` | `nvarchar(30)` | `45z-fdcic` (45Z) or `graincraft` |
| `Status` | `nvarchar(10)` | `Draft`, `Ready` or `Locked` |
| `Data` | `nvarchar(max)` JSON | The program's inputs (for 45Z: yields, N rate, tillage, cover crop, manure…) |
| `CopiedFromYear` | `int` NULL | Inputs were prefilled from this field's previous year |
| `CopiedFromField` | `nvarchar(255)` NULL | Inputs were copied from this field this year |
| `Frozen` | `nvarchar(max)` JSON NULL | The locked harvest estimate: inputs, outputs, CI, and the USDA calculator version that produced it |
| `LockedBy`, `LockedAt` | NULL | Who locked it, and when |
| `Reopened` | `nvarchar(max)` JSON NULL | Each unlock: the reason, when it happened, and the estimate that was unlocked. Kept forever. |
| `Official` | `nvarchar(max)` JSON NULL | **Empty placeholder** for an official/documented CI. Its requirements are still being defined, and nothing writes it yet. |
| Audit + soft delete | | |

- **One record per program per season.** A unique index on (`ProducerFieldSeasonId`, `ProgramKey`) ignores removed rows.
- **Locked rows are never changed or removed.** To change one, the user unlocks it with a reason, which is kept in `Reopened`.
- **Why JSON:** each program asks for different inputs, and USDA changes the 45Z inputs between versions. JSON lets a new version or program arrive without a migration. Reporting reads the frozen result, which is the same shape for every version (CI, bushels, version label).

### ④ `dbo.ProgramEnrollment`: a producer in a program for a crop year

| Column | Type | What it is |
|---|---|---|
| `Id` (PK) | `int` identity | |
| `EnrollmentKey` | `uniqueidentifier`, default `NEWID()`, unique | The ID the app uses (like `ProducerBinSite.SiteKey`) |
| `CustomerId` | `bigint` → `dbo.Customer` | |
| `ProgramKey` | `nvarchar(30)` | |
| `CropYear` | `int` | |
| `Status` | `nvarchar(10)` | `Open`, `Attested` or `Withdrawn` |
| `Attestation` | `nvarchar(max)` JSON | Signer, date, eSign/paper, document reference, confirmations |
| `AttestedBy`, `AttestedAt` | NULL | |
| `Snapshot` | `nvarchar(max)` JSON NULL | The fields listed when the producer attested |
| `HarvestCompleteAt` | `datetime2` NULL | |
| `WithdrawnReason` | `nvarchar(500)` NULL | |
| Audit | | |

- **At most one live enrollment per producer, program and year.** A unique index on (`CustomerId`, `ProgramKey`, `CropYear`) covers only `Open` and `Attested` rows.
- **Withdrawn rows are kept as history.** Re-enrolling creates a new row.
- **The per-field enrollment ID is not stored.** It is derived as `CI-{crop year}-{split ID}`, e.g. `CI-2026-TATOB43`, so nobody types it and tickets can resolve it from the split ID and crop year they already carry. See [Enrollment identifier](../45z/README.md#enrollment-identifier); whether auditors need it stored is still open.

---

## Rules the server enforces

The browser applies these today. Once the tables exist, the API owns them:

1. **A split is one producer's field.** Adding a split that another producer already holds is refused.
2. **No duplicate claims.** A field can't be in two live enrollments of one program and year. Rule 1 and table ④'s unique index make this structural, and the API checks it again at attestation.
3. **Locking rescores on the server.**
   - "Harvest complete" locks each field's estimate. For 45Z, the API recomputes the CI with its own USDA calculator. It stores that result together with the calculator version, workbook hash and formula fingerprint, and never uses the browser's number.
   - A locked estimate is never rescored under a later USDA version.
4. **A locked record can't be edited.** It must be unlocked with a reason first.
5. **No unlocking a field an attested enrollment holds.**
6. **Every CI is an estimate.** The frozen result is stamped `basis: Estimate`; the `Official` column is separate and stays empty.

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
| GET | `customer/{customerId}` | Everything for one producer: fields, seasons, records, enrollments |
| POST / PUT | `fields`, `fields/{splitId}` | Add a split as a field; set its state/county |
| POST / PUT / DELETE | `seasons`, `seasons/{id}` | Put a field on a crop row; change acres; take it off |
| POST / PUT / DELETE | `records`, `records/{id}` | Add a program to a field; save inputs; remove |
| POST | `records/{id}/lock`, `records/{id}/reopen` | Lock the harvest estimate (server rescore); unlock with a reason |
| POST | `enrollments` | Open (or return) the producer's enrollment |
| PUT / POST | `enrollments/{key}/attestation`, `/attest`, `/harvest-complete`, `/withdraw` | Enrollment lifecycle |

The planned `GET api/field-plan/enrollment?programKey&splitId&cropYear` lets tickets and analytics resolve an enrollment without anyone typing an ID. It is documented now and built when analytics needs it.

## Rollback

The migration (`20261027115725_AddFieldPlanTables`) only creates four new tables and their indexes, so its `Down()` drops them. No existing table or row is touched.

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
