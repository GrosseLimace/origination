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
client caches each set of inputs). Field chips and the crop row's roll-up use the same scores. When a field is confirmed after harvest, the
field's inputs, the USDA outputs, the version label, the workbook hash and the formula fingerprint are
frozen together.

The API tests run every case in every embedded pack, so adding a pack whose cases don't reproduce fails the
build.

**Rules for scores the app keeps** (for the storage step):
- Every saved score records the label, workbook hash and formula fingerprint returned with it, next to the
  inputs and outputs it froze.
- A locked harvest estimate is never recalculated under a newer version. It stays on the version that produced it.
- Which version applies to a crop year is a setting, so switching versions is a configuration change, not
  a code release.

**Decision needed (business):** when USDA releases a new version mid-season, should fields that are not yet
locked be rescored under it? Recommended: yes, with a visible "rescored under vX" note. Locked fields
keep their version either way.

## Where field-plan data is kept

The client keeps fields, field seasons, program records and enrollments in `FieldPlanStore`
(`client/src/app/features/customers/components/field-plan/store/`). It loads one producer at a time and
saves through `FIELD_PLAN_BACKEND`. That interface is the shape of the field-plan API: each method names its
endpoint.

**Today:** `InMemoryFieldPlanBackend` stands in for the server, so nothing survives a reload.

The API side is built and approved (2026-10-27), and held off `main` until the feature is ready for QA and PROD:
- the four tables, migration `AddFieldPlanTables`;
- `api/field-plan`;
- the client's `HttpFieldPlanBackend`.

`environment.fieldPlanBackend` picks the backend, and it's `'memory'` everywhere until the tables are approved and applied and CTRM's splits query is live. Locally the API reaches the shared DEV database, so switch to `'api'` only against a database that has the tables.

The proposed tables, rules and endpoints are written up for approval in
[Field Plan — Database Plan](../application-context/Field%20Plan%20-%20Database%20Plan.md).

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
  - `FieldProgramRecord.Official` (JSON, nullable): the official result, kept apart from the estimate (see
    [Estimate vs confirmed (official) CI](#estimate-vs-confirmed-official-ci)). It may become its own table once its shape is known.
- Access is the same as planting intentions: any signed-in user (accepted risks AR-01 to AR-03).
- The server owns two rules:
  - refusing duplicate claims at attestation (a split ID in two enrollments of one program and year);
  - locking the harvest estimate, which rescores with `FdCicService` rather than trusting the client's number.

## Enrollment identifier

Each field in a program has an enrollment ID **derived** from identifiers the system already has, not issued
from a counter: `{program prefix}-{crop year}-{split ID}`, e.g. `CI-2026-TATOB43`. Nobody types it, and in
particular the scale or ticket-entry user never keys an extra ID: a ticket carries the split ID, its crop year
is known, and `FieldPlanStore.resolveEnrollment(program, splitId, cropYear)` finds the field, its record and
the producer's enrollment. The server will offer the same as `GET api/field-plan/enrollment?programKey&splitId&cropYear`.

- The producer's enrollment (producer + program + year) still groups the fields for
  attestation and withdrawal, but has no display ID of its own.
- Withdrawal is kept with its reason. Re-enrolling makes the producer live again under the **same** field
  IDs, since they derive from split and year.
- The format lives in one function, `enrollmentIdFor` (`client/.../field-plan/programs/program-enrollment.ts`).
- **Open (technical design):** the final format; where the crop year comes from (ticket date, contract or
  CTRM crop year); a split growing two crops in one program year (the crop would need to be in the key);
  whether auditors need the ID stored as well as derived.

## Estimate vs confirmed (official) CI

Every CI is a **planning estimate** from the USDA FD-CIC calculator until the field is **confirmed** after
harvest. The business decided on 2026-10-29 that the confirmed CI is the one the Bins use: it's the official
result.

- **Estimates:**
  - Before harvest the estimate is projected from the expected yield; after harvest it uses the actual yield.
  - After harvest each field is confirmed on its own in the Review, which locks it with the confirmed CI. The enrollment-level "Mark harvest complete" button was removed on 2026-10-30: it locked estimates that confirming then replaced.
  - A locked estimate can be unlocked with a reason, which is kept.
  - Screens say "estimate · projected / actual / locked".
- **Confirmed CI:** see [Review with tickets and the Bins' CSV](#review-with-tickets-and-the-bins-csv). The record's `official` result holds:
  - `status: Documented`;
  - the CI, rescored on the server with the confirmed actual yield;
  - the USDA version;
  - the actual yield;
  - the confirmed bushels and tickets;
  - who confirmed it and when.

  An estimate is never copied into it. Screens say "confirmed".
- **Unlocking a confirmed field** moves both its estimate and its confirmed CI into the record's history, with the reason. The field can then be reviewed again.
- **Still open:** whether an official CI will need more than the review (evidence, a verifier, sign-off). `requirements` and `evidence` on the official result are kept for that.

## Review with tickets and the Bins' CSV

1. Once a 45Z field has an estimated CI, its tab shows **Review with tickets…**.
2. The review lists the field's CTRM tickets (`GET api/field-plan/records/{id}/tickets`), **settled or not**. A ticket is listed when:
   - it was delivered under the field's split ID (the ticket detail's customer code);
   - its product code is the crop row's crop (`FieldPlanCropGroups`, ported from the client's `CROP_CODE_MAP`, with a test that keeps them in step);
   - it's in the crop year. CTRM tickets carry no crop year, so:
     - a ticket on one of the producer's or the split's contracts takes **that contract's crop year**;
     - any other ticket counts when its **BL date** is in the crop year's window: `FieldPlan:TicketWindow:{crop}:From/To` (MM-dd), default `08-01` to `07-31` of the next year. **Canola** runs `06-01` to `05-31` (appsettings.json), so a June–July winter canola harvest counts in its own crop year.
   - Net bushels are the split's net pounds ÷ the ODS conversion for the product code. With no conversion there is no figure ("?"), as everywhere in the portal: the ticket starts left out and can't be confirmed. (The standard-weight fallback was removed 2026-10-30.)
3. The originator and the producer go over the inputs and the tickets. Any ticket that isn't the field's can be unticked. **Adding a ticket** (2026-10-30): "+ Add a ticket from outside the crop year" lists the split's other tickets for the crop (on another year's contract, or BL-dated outside the window), newest first, with the reason each is outside. An added ticket joins the table tagged *added* and is kept as `cropYearMatch: "added"` in the confirmed CI and as "Added in review" in the CSV. Only the split's own tickets for the crop can be added, and a ticket another of the field's confirmed CIs already counts (another crop year) is marked and can't be added or confirmed, so no ticket is counted twice. The actual yield is suggested as included bushels ÷ acres and can be edited. The CI at that yield shows live.
4. After harvest, with "Reviewed these inputs and tickets with the producer after harvest" ticked, **Confirm CI** (`POST .../records/{id}/confirm`):
   - reads the tickets again on the server and keeps only the ones listed, so the bushels are CTRM's;
   - sets the actual yield, rescores, locks, and writes the confirmed CI.
   - Confirming is allowed while an attested enrollment holds the record, because attesting comes before harvest and confirming after.
5. **CSV for the Bins' mass balance ledger:** "Download confirmed CI (CSV)" appears on the enrollment card for the producer and year, and in a confirmed review.
   - One row per confirmed ticket: producer code and name, split ID, field, enrollment ID, crop year, commodity, ticket #, product code, BL date, location, contract #, crop year by (contract year, BL date window or added in review), net bushels, settled (Y/N), settled date, CI (g CO2e/bu), USDA version, confirmed by and at.
   - Built in the browser (`programs/fd-cic/confirmed-ci-export.ts`), with spreadsheet formula injection guarded (`shared/utils/csv.ts`).
   - File name: `45Z-confirmed-CI_{producer}_{year}_{yyyymmdd}.csv`.

**To verify on real data:** that tickets name the split ID as their customer code. A split is its own CTRM customer: TATOB02 "T-A TOBIN - PARKER WEST" is synced as a producer with that code. The tickets query is therefore the standard per-customer one. TATOB02 had no deliveries in the last three years, though, so this still needs checking against a split that has delivered.

## Reporting: field-level CI and bushels

The business doesn't plan on one producer-wide average CI. Downstream opportunities may each need a
different CI target, so the question is **how many bushels sit at or below a given CI**, by crop.

- The enrollment card shows a "bushels by CI" ladder per crop: fields lowest CI first, each with its
  bushels and a running total, and a target box ("at or below 3,000 g/bu → 69,000 bu from 2 fields").
  Crop rows show the range of CIs and the bushels, never an average.
- Bushels are acres × actual yield once it's in, otherwise acres × expected yield, marked projected. A
  locked field uses its frozen acres and actual yield.
- Reports and dashboards should work from the same field-level rows: producer, year, crop, field (split
  ID), CI, bushels, projected or actual, status and USDA version. The `FieldProgramRecord` rows (with
  their frozen outputs once locked) are that source. Don't store or show a producer-level average as
  the planning figure.
- The ladder rules live in `client/.../field-plan/programs/ci-ladder.ts` (pure, with tests), so a server
  report can follow the same cases.

## CTRM splits: the fields

A field-plan field is one of the producer's CTRM split IDs (combined customer IDs, e.g. `TATOB43` "T-A TOBIN
- JARBOE WEST", 100%). Producers set up a split per field, and tickets are delivered under it, which is
what ties a delivery to a field. State and county are asked once, the first time a split is used, because 45Z scores by county.

**Go-live: split IDs are typed by hand (SPLITS-GRAPHQL).** The CTRM splits query may not be ready for go-live, so `Ctrm:SplitsSource` defaults to **`manual`**:
- the originator types the split ID (1 to 7 letters or digits, as CTRM customer codes are), a field name (defaulting to the ID) and the producer's share (default 100%);
- the field is stored with `SplitSource = Manual`, and its name and share stay editable;
- the split ID is how the field's tickets are found, so the screen asks the originator to check it against CTRM.

Every temporary spot is marked `SPLITS-GRAPHQL:` in code and config (`git grep SPLITS-GRAPHQL`).

**Once the CTRM splits query exists**, originators pick the split from a type-ahead. The split's name, split % and effective date then come from CTRM and are read-only. Expired splits are hidden; bin-site splits are listed but can't be fields.

- **Endpoint:** `GET api/ctrm-splits/customer/{customerId}` returns `{ source, splits }`, with every split
  including expired and bin-site ones. A producer without a CTRM code is a 404; a failed CTRM read is a
  503, never an empty list.
- **Source today: `manual`** (no list; typed by hand). `sample` (`SampleCtrmSplitReader`, a made-up list) is for local demos only.
  - The CTRM GraphQL query for splits isn't known yet, and CTRM blocks schema introspection (`HC0046`).
  - Integrations were asked for a standalone `customerSplits` query rather than an extension of the customer query.
- **Switching to the CTRM splits query:** `CtrmSplitReader` is built and tested against a placeholder query
  (`CtrmQueries.SplitsByCustomer`, `CtrmSplitDto`). Once Integrations confirm the root field and field names:
  1. Replace the query text and the DTO's property names.
  2. Set `CtrmQueries.SplitsQueryConfirmed = true`.
  3. Set `Ctrm:SplitsSource` to `ctrm` per environment. Until step 2, `ctrm` stops the API at startup, so a
     guessed query is never sent. With `ctrm`, a typed split that isn't in CTRM's list is refused.
  4. Reconcile the fields typed by hand. Match each `Manual` field to CTRM's split by split ID, take CTRM's name, share and effective date, and set `SplitSource = Ctrm`. Report any manual split ID CTRM doesn't know, so it can be corrected; nothing is deleted.
  5. Remove the manual-entry inputs (`crop-fields-panel`, field dialog) and `ManualCtrmSplitReader`, guided by the `SPLITS-GRAPHQL` markers.
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

## Standards review (before the merge to main)

On 2026-10-30 the branch was reviewed against the Scoular standards with the marketplace skills
(`audit-dotnet`, `audit-angular`, `audit-sql`, `audit-security`, `code-review`). Fixed before the merge:
- **Attested snapshot built on the server.** It was kept as the browser sent it; a crafted list could put
  another producer's split in it, or a non-text split ID that broke attesting for everyone in the program and year.
- **A field once per crop per year.** The same split on two rows of the same crop (say irrigated and dryland
  corn) pulled the same tickets twice, so the Bins' CSV would have counted them twice.
- **No uncounted tickets.** A ticket with no bushel figure starts left out of the review and can't be confirmed.
- **Copying inputs onto a scored field** now refreshes the form, so the next edit no longer writes the old inputs back.
- **Smaller fixes:** "settled" is matched exactly, the actual yield is capped at 1,000 bu/ac on screen as in the
  API, a 02-29 ticket window is refused, and the "harvest complete" leftovers and stale comments are gone.

**To do before the screens go live (`fieldPlanBackend: 'api'`):**
1. **Concurrency:** confirm, reopen and edits can race (no concurrency token); unique-index races return 500
   instead of the existing row (the repo's `IsUniqueViolation` pattern in `BidSheetRepository`). Two originators
   confirming two crop years of the same field at the same moment could both count one ticket (the already-counted
   check is read-then-write).
2. **Split ownership while typed by hand:** nothing checks a typed split ID belongs to the producer, and there is
   no way to remove a wrongly claimed field. Check it against CTRM or add an admin path; ends with SPLITS-GRAPHQL.
3. ~~Access~~: any originator can open and change any producer's field plan, by design (decided 2026-10-30);
   recorded under AR-01 and AR-02 in `SECURITY-REVIEWS/ACCEPTED-RISKS.md`.
4. **Server feature flag:** `api/field-plan` answers in QA and PROD although the screens are off there.
5. **Client hardening:** OnPush and signals on the 7 new components; templates out of the larger inline
   components; accessibility (aria-pressed and aria-expanded, the unlock overlay as `<app-dialog>`, Escape on the
   program menu); one USDA score request per keystroke; FD-CIC lookups that stay failed until reload;
   duplicate datalist IDs from the mobile and desktop layouts; component specs for the review, dialog and card.
6. **Server tidy-ups:** interfaces in their own files, status names as shared constants, full
   `ProducesResponseType` lists, `cancellationToken` naming, and ticket-window settings checked at startup.
7. **Data:** ticket product codes outside the crop lists are dropped silently. (Done 2026-10-30: the standard-weight
   fallback was removed, canola has its own window, and the originator can add a ticket the crop year rule missed.)

## Legal

Building the calculator from the workbook was cleared on the assumption that legal approves reproducing
USDA's method and tables, including the GREET-derived national constants. Record the written approval here
when it arrives.
