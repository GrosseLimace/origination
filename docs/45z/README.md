# 45Z feedstock CI: USDA FD-CIC versions

The app calculates a field's 45Z carbon-intensity (CI) score with USDA's Feedstock Carbon Intensity
Calculator (FD-CIC). USDA publishes the method as an Excel workbook and releases new versions from time
to time. This page records which version the app uses and how to move to a new one.

## Version in use

| | |
|---|---|
| Method | USDA FD-CIC **v1.2** |
| Source workbook | `usda-fdcic-ver1.2_9_11_2026.xlsm` (USDA last modified 2026-09-11), SHA-256 `db3ef7cac515756c9a00d9e74e12e41521feb18c3241abd78016062a2489468a` |
| Data pack | [api/GrainOriginatorPortal.Api/Content/FdCic/v1.2/](../../api/GrainOriginatorPortal.Api/Content/FdCic/v1.2/) |
| How it calculates | [fd-cic-v1.2-method.md](fd-cic-v1.2-method.md) |
| Checked against Excel | 2026-10-22: 7 scored cases matched to 15+ significant digits, and 2 unscorable counties gave Excel's errors ([golden-cases.json](../../api/GrainOriginatorPortal.Api/Content/FdCic/v1.2/golden-cases.json)) |
| Formula fingerprint | `a2ccea4b…` (full value in the pack's `manifest.json`) |

## How versions are kept apart

Each USDA release becomes its own **data pack** folder (`Content/FdCic/v<version>/`), generated from the
workbook by [tools/fdcic-extract](../../tools/fdcic-extract/). Pack files are never edited by hand, except
the case inputs in `golden-cases.json`.

| File | Holds |
|---|---|
| `manifest.json` | Version, source file name and SHA-256, extraction date, formula fingerprint, row counts, a hash of every other file |
| `constants.json` | Unit conversions, the N2O global warming potential, the yield band (0.8-1.2 × expected), and per crop: default NUI, NUI threshold, residue N, soybean N fixation, and the eight national-average components |
| `options.json` | The exact crop, cover crop, tillage and manure labels the tables are keyed by |
| `counties.json` | State + county → FIPS → MLRA (every lookup is by MLRA) |
| `ief.json` | Direct and indirect N2O emission factors by crop and MLRA |
| `csa.json` | Conservation practice adjustments by crop, MLRA and practice: soil carbon, direct and indirect N2O, fuel |
| `ni-impact.json` | Nitrification-inhibitor effect on direct and indirect N2O |
| `formulas.json` | Every scoring formula in the workbook, used to detect method changes |
| `golden-cases.json` | Test inputs with the results Excel calculated for them |

The calculation steps live in code, and the numbers live in the pack. If a new USDA release only changes
numbers, the update is just a new pack. If it changes a formula, the change report says so, and the
calculator gets a new version alongside the old one.

## The calculator in the API

Code lives in [Services/FdCic/](../../api/GrainOriginatorPortal.Api/Services/FdCic/):

| Piece | What it does |
|---|---|
| `FdCicPack` | Loads an embedded pack and refuses it if any data file's SHA-256 differs from its manifest |
| `FdCicMethodV1` | The v1.2 arithmetic (§2.14 of the method write-up), tied to the v1.2 formula fingerprint |
| `FdCicVersionGate` | A version is usable only if a method matches its fingerprint, its test cases were confirmed against the same workbook, and every case reproduces Excel to a relative 1e-9 |
| `FdCicService` | Picks each crop year's version from `FdCic:VersionByYear` in appsettings.json and gates it at startup. A failing version is logged ("FD-CIC vX is switched off: …") and scores nothing; the rest of the app runs normally |

Endpoints (signed-in users; nothing is stored):

| Endpoint | Returns |
|---|---|
| `GET api/fd-cic/versions` | Each version, its years, and whether it passed its gate (and why not) |
| `GET api/fd-cic/{year}/options` | Crop, cover crop, tillage and manure choices, in the version's own labels |
| `GET api/fd-cic/states`, `GET api/fd-cic/counties?state=IA` | The state and county lists a field's location is picked from (every program uses them). A location is entered once for every year, so these come from the newest version that passed its gate |
| `POST api/fd-cic/{year}/score` | The CI and its components, the national average and change, plus the version label, workbook hash and formula fingerprint. Leave out the actual yield for a projected score. Places USDA has no data for come back with `scorable: false` and the reason. `effects` explains the score: each of the field's choices against the workbook default (not a USDA output) |

In the app, the 45Z form asks this endpoint for the score as the originator types (the
client caches each set of inputs). Field chips and the crop row's roll-up use the same scores. At harvest complete, the
field's inputs, the USDA outputs, the version label, the workbook hash and the formula fingerprint are
frozen together.

The API tests run every case in every embedded pack, so adding a pack whose cases don't reproduce fails the
build.

**Rules for scores the app keeps** (for the storage step):
- Every saved score records the label, workbook hash and formula fingerprint returned with it, next to the
  inputs and outputs it froze.
- A finalized score is never recalculated under a newer version. It stays on the version that produced it.
- Which version applies to a crop year is a setting, so switching versions is a configuration change, not
  a code release.

**Decision needed (business):** when USDA releases a new version mid-season, should fields that are not yet
finalized be rescored under it? Recommended: yes, with a visible "rescored under vX" note. Finalized fields
keep their version either way.

## Where field-plan data is kept (database pending approval)

The client keeps fields, field seasons, program records and enrollments in `FieldPlanStore`
(`client/src/app/features/customers/components/field-plan/store/`). It loads one producer at a time and
saves through `FIELD_PLAN_BACKEND`. That interface is the shape of the field-plan API: each method names its
endpoint.

**Today:** `InMemoryFieldPlanBackend` stands in for the server, so nothing survives a reload.

**Once the database is approved:**
- An API-backed implementation replaces it as the single provider.
- The API adds four tables in `ApplicationDbContext`: `ProducerField`, `ProducerFieldSeason`,
  `FieldProgramRecord` and `ProgramEnrollment`.
- `ProducerField` is keyed by the CTRM `SplitId` (unique), with `SplitPercent`, `EffectiveDate`, the split's
  name as CTRM had it, and the `State` and `County` entered for 45Z (see [CTRM splits](#ctrm-splits-the-fields)).
- They follow the producer-table conventions:
  - an `int` identity key and a `long CustomerId` foreign key with `NoAction`;
  - `CreatedBy/At` and `ModifiedBy/At`;
  - soft delete through a query filter;
  - the record's `Data` and frozen result stored as `nvarchar(max)` JSON, like `Note.Mentions`.
  - `FieldProgramRecord.CopiedFromField`: the field a record's inputs were copied from this year, if any.
- Access is the same as planting intentions: any signed-in user (accepted risks AR-01 to AR-03).
- The server owns three rules:
  - the enrollment ID sequence;
  - refusing duplicate claims at attestation (a split ID in two enrollments of one program and year);
  - finalizing, which rescores with `FdCicService` rather than trusting the client's number.

## Reporting: field-level CI and bushels

The business doesn't plan on one producer-wide average CI. Downstream opportunities may each need a
different CI target, so the question is **how many bushels sit at or below a given CI**, by crop.

- The enrollment card shows a "bushels by CI" ladder per crop: fields lowest CI first, each with its
  bushels and a running total, and a target box ("at or below 3,000 g/bu → 69,000 bu from 2 fields").
  Crop rows show the range of CIs and the bushels, never an average.
- Bushels are acres × actual yield once it's in, otherwise acres × expected yield, marked projected. A
  finalized field uses its frozen acres and actual yield.
- Reports and dashboards should work from the same field-level rows: producer, year, crop, field (split
  ID), CI, bushels, projected or actual, status and USDA version. The `FieldProgramRecord` rows (with
  their frozen outputs once finalized) are that source. Don't store or show a producer-level average as
  the planning figure.
- The ladder rules live in `client/.../field-plan/programs/ci-ladder.ts` (pure, with tests), so a server
  report can follow the same cases.

## CTRM splits: the fields

A field-plan field is one of the producer's CTRM split IDs (combined customer IDs, e.g. `TATOB43` "T-A TOBIN
- JARBOE WEST", 100%). Producers set up a split per field, and tickets are delivered under it, which is
what will tie a delivery to a field. Originators pick the split from a type-ahead; they never type a field
name or FSA numbers. The split's name, split % and effective date come from CTRM and are read-only. State
and county are asked once, the first time a split is used, because 45Z scores by county. Expired splits are
hidden; bin-site splits are listed but can't be fields.

- **Endpoint:** `GET api/ctrm-splits/customer/{customerId}` returns `{ source, splits }`, with every split
  including expired and bin-site ones. A producer without a CTRM code is a 404; a failed CTRM read is a
  503, never an empty list.
- **Source today: sample data.** The CTRM GraphQL query for splits isn't known yet, and CTRM blocks schema
  introspection (`HC0046`), so `SampleCtrmSplitReader` returns a made-up list built from the producer's
  code. The screen says "Sample split IDs" while `source` is `sample`.
- **Switching to CTRM:** `CtrmSplitReader` is built and tested against a placeholder query
  (`CtrmQueries.SplitsByCustomer`, `CtrmSplitDto`). Once Lisa/Travis confirm the splits root field and
  field names:
  1. Replace the query text and the DTO's property names.
  2. Set `CtrmQueries.SplitsQueryConfirmed = true`.
  3. Set `Ctrm:SplitsSource` to `ctrm` per environment. Until step 2, `ctrm` stops the API at startup, so a
     guessed query is never sent.
- **Open:** confirming that a landlord's and a tenant's shares are separate split IDs (the duplicate check
  relies on it), and whether 45Z acres should be the whole field or the producer's share.

## Updating to a new USDA version

You need Node and, for step 4, Windows with Excel. Treat the downloaded workbook as untrusted: don't enable
its macros. The tools read it as data, and the Excel check runs with macros forced off and never saves it.

1. **Download** the new workbook from USDA and the matching User Guide. Note the release date.
2. **Extract** a new pack and compare it with the current one:
   ```bash
   node tools/fdcic-extract/extract.mjs <new-workbook.xlsm> api/GrainOriginatorPortal.Api/Content/FdCic/v1.3 \
        --previous api/GrainOriginatorPortal.Api/Content/FdCic/v1.2
   ```
   If USDA moved a table or label, extraction stops with a "Layout check failed" message, and the extractor
   needs updating first. Otherwise it writes the pack and `CHANGES.md`.
3. **Read `CHANGES.md`.**
   - "Formulas unchanged" means a tables-only update: no calculator code changes.
   - Any formula change needs a calculator review. Update the method write-up as `fd-cic-v1.3-method.md`
     and add a v1.3 calculator next to v1.2.
   - The new calculator's `Breakdown` (which inputs drive each component, and which parts are fixed
     national figures) must be reviewed with its formulas; see §2.15 of the method write-up.
     `FdCicBreakdownTests` checks it against the arithmetic.
   - Check the new constants and coverage against USDA's release notes or User Guide.
4. **Confirm the test cases in Excel.** Copy `golden-cases.json` from the previous pack, add cases for anything
   the release changed, then fill in Excel's results:
   ```bash
   node tools/fdcic-extract/golden.mjs <new-workbook.xlsm> api/GrainOriginatorPortal.Api/Content/FdCic/v1.3
   ```
5. **Run the API tests** (`FdCicGoldenCaseTests` picks up the new pack by itself). The calculator must match
   every golden case. A formula change also needs a new `IFdCicMethod` for the new fingerprint, registered in
   Program.cs next to `FdCicMethodV1`.
6. **Review and approve:** a pull request with the pack, `CHANGES.md` and test results. Update the
   "Version in use" table above. `CHANGES.md` stays in the repo as the record of what changed.
7. **Switch the crop year's version** in `FdCic:VersionByYear` (appsettings.json, or an App Service setting
   such as `FdCic__VersionByYear__2027=1.3`) once approved. Check the startup log or `GET api/fd-cic/versions`
   to confirm it passed its gate.

For a tables-only release this should take about a day, most of it review.

## Legal

Building the calculator from the workbook was cleared on the assumption that legal approves reproducing
USDA's method and tables, including the GREET-derived national constants. Record the written approval here
when it arrives.
