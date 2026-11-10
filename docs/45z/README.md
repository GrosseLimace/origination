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

Code lives in [Modules/Producers/FieldPlan/FdCic/](../../api/GrainOriginatorPortal.Api/Modules/Producers/FieldPlan/FdCic/):

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

The client keeps fields, field seasons and program records in `FieldPlanStore`
(`client/src/app/features/producers/components/field-plan/store/`). It loads one producer at a time and
saves through `FIELD_PLAN_BACKEND`. That interface is the shape of the field-plan API: each method names its
endpoint.

**Today:** `InMemoryFieldPlanBackend` stands in for the server, so nothing survives a reload.

The API side is built and approved (2026-10-27), and held off `main` until the feature is ready for QA and PROD:
- the tables, migration `AddFieldPlanTables` (its `ProgramEnrollment` table was dropped on 2026-11-03 by `DropProgramEnrollment`);
- `api/field-plan`;
- the client's `HttpFieldPlanBackend`.

`environment.fieldPlanBackend` picks the backend, and it's `'memory'` everywhere until the tables are approved and applied and CTRM's splits query is live. Locally the API reaches the shared DEV database, so switch to `'api'` only against a database that has the tables.

The proposed tables, rules and endpoints are written up for approval in
[Field Plan — Database Plan](../application-context/Field%20Plan%20-%20Database%20Plan.md).

**Once the database is approved:**
- An API-backed implementation replaces it as the single provider.
- The API adds three tables in `ApplicationDbContext`: `ProducerField`, `ProducerFieldSeason` and
  `FieldProgramRecord`. A field is in 45Z when it has a 45Z record; no enrollment or producer attestation is kept.
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
- Access is the same as planting intentions: `field-plans:read` to see a producer's field plan and `field-plans:write` to change it, on any producer (accepted risks AR-01 to AR-03). The FD-CIC calculator needs `carbon-intensity:read`.
  - In the app, the Planting tab shows and loads the field plan only for a user with `field-plans:read`, and "Update total" needs `planting-intentions:write`, since it opens the intention's Edit dialog. The field plan's own controls aren't hidden from a user without `field-plans:write` yet; the API refuses their changes.
- The server owns these rules:
  - a split is one producer's field (a split another producer holds is refused);
  - locking the harvest estimate, which rescores with `FdCicService` rather than trusting the client's number.

## Enrollment identifier

Each field in a program has an enrollment ID **derived** from identifiers the system already has, not issued
from a counter: `{program prefix}-{crop year}-{split ID}`, e.g. `CI-2026-TATOB43`. Nobody types it, and in
particular the scale or ticket-entry user never keys an extra ID: a ticket carries the split ID, its crop year
is known, so the split ID and crop year find the field and its record. The server stores no enrollment ID and
offers no lookup for it (none is built yet).

- There is no producer-level enrollment, attestation or withdrawal (dropped 2026-11-03): a field is in 45Z when it has a
  45Z record, and a confirmed CI changes only by unlocking it with a reason.
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
- **Confirmed CI:** see [The review, the Biofuel Feedstock Report and the Mass Balance Ledger](#the-review-the-biofuel-feedstock-report-and-the-mass-balance-ledger). The record's `official` result holds:
  - `status: Documented`;
  - the CI, rescored on the server with the confirmed actual yield and tillage;
  - the USDA version;
  - the actual yield;
  - the confirmed bushels and tickets;
  - `tDisc` for no till or reduced till: the rating, its designation, the estimated and confirmed tillage, the T-DISC version, and the worksheet (`windows` with each index, `passes` with each tillage intensity); null otherwise. The passes themselves are also kept in the data (`tDiscPasses`);
  - `recordkeepingAcknowledged: true`;
  - who confirmed it and when: `documentedBy` (their UPN, the audit identifier), `documentedByName` (their display name from the sign-in's `name` claim, for documents) and `documentedAt`.

  An estimate is never copied into it. Screens say "confirmed".
- **Unlocking a confirmed field** moves both its estimate and its confirmed CI into the record's history, with the reason. The field can then be reviewed again.
- **`reportDocumentId`** and **`ledgerDocumentId`** are added once the confirmation's Biofuel Feedstock Report and Mass Balance Ledger are in Doc Store (see [45Z documents in Doc Store](#45z-documents-in-doc-store)).
- **Still open:** whether an official CI will need more than the review (evidence, a verifier, sign-off).

## USDA T-DISC

No-till and reduced-till fields need a USDA T-DISC (Tillage Disturbance Index for Soil Carbon) rating before
their CI is confirmed (7 CFR 2100.051). The app rebuilds USDA's T-DISC workbook the same way as FD-CIC.

| | |
|---|---|
| Method | USDA T-DISC **v1.1.1** (one management unit) |
| Source workbook | `usda-tdisc-ver1.1.1_9_4_2026.xlsm` (USDA last modified 2026-09-04), SHA-256 `5f71a1b33e514d9348f28f5a62b553dca60fb4f58e51702a9033d4a4bc7dce9e` |
| Data pack | [api/GrainOriginatorPortal.Api/Content/TDisc/v1.1.1/](../../api/GrainOriginatorPortal.Api/Content/TDisc/v1.1.1/), made by [tools/tdisc-extract](../../tools/tdisc-extract/) |
| Checked against Excel | 2026-11-03: 10 cases (rating, designation and every window) matched ([golden-cases.json](../../api/GrainOriginatorPortal.Api/Content/TDisc/v1.1.1/golden-cases.json)) |
| Formula fingerprint | `cb1d263f…` (`TDiscCalculator.FormulaFingerprint`) |

How the workbook rates a field ('User Input' rows 8-29):
1. Each pass is a tillage window (field preparation, before planting, planting, after planting, harvest) and a T-DISC implement, which has a mixing efficiency and a depth in cm. Each window allows only its own implements. Up to 20 passes.
2. All passes are sorted by depth, then mixing efficiency. Within each window, in that order, a pass adds *mixing efficiency × (depth − the window's earlier intensities)*.
3. A window's index is its total ÷ 30 cm. **The rating is the highest window index.**
4. NT is 0.075 or less, RT 0.252 or less, CT above. The farm, state, county, crop and date on the sheet don't affect the rating.

The pack holds the 93 implements, each window's list, USDA's operation lookup ("If your operation is this, use these T-DISC implements") and the limits. USDA's lookup has three names that don't match its own implement list: two typos (`RESIDUE MGMT, POWER MULCHER` and `RESIDUE MGMT, TRASH WHEEL`, a comma where the list has a colon) are fixed by the extractor, and *Cultivator, rotary on beds; Bedder, hipper, disk hiller* is left out (314 of 315 kept) because its "BEDDER DISK/DISK-HIPPER" could be either of two depths. Both are listed in the manifest.

Code: `Modules/Producers/FieldPlan/TDisc/` (`TDiscPack`, `TDiscCalculator`, `TDiscService`) and `GET api/tdisc/options`. The pack is gated at startup like FD-CIC: if a file's hash, the formula fingerprint or any Excel case doesn't match, "T-DISC v1.1.1 is switched off" is logged and no-till or reduced-till fields can't be confirmed until it's fixed.

**When USDA releases a new T-DISC:** run `node tools/tdisc-extract/extract.mjs <workbook.xlsm> api/GrainOriginatorPortal.Api/Content/TDisc/v<version>`, copy in `golden-cases.json` and run `node tools/tdisc-extract/golden.mjs <workbook.xlsm> <packDir>` (Windows + Excel; macros stay off), then set `TDiscService.CurrentVersion`. A changed fingerprint means the formulas changed: review `TDiscCalculator` (and the client's mirror) before updating `FormulaFingerprint`.

## The review, the Biofuel Feedstock Report and the Mass Balance Ledger

Once a 45Z field has an estimated CI, its tab shows **Confirm CI Score**. The review (2026-11-02; tickets and yield merged 2026-11-03) is five steps, gone through with the producer after harvest. Each step's **Next** waits on that step's own check; a confirmed field opens on step 5 with every step read-only.

1. **Inputs.** The calculator inputs as entered (crop, location, acres, expected yield, nitrogen, inhibitor, cover crop, tillage, manure). "Edit inputs" closes the review.
2. **T-DISC** (no till and reduced till only; otherwise "not needed"). The originator enters the field's passes from last harvest through this one, each a tillage window and a T-DISC implement, picked by USDA's implement name or by an everyday operation from USDA's lookup (which adds a pass per implement). The app rates them as USDA's T-DISC v1.1.1 workbook does (see [USDA T-DISC](#usda-t-disc)) and shows each window's index and the rating live. The passes are saved with the field's data as they're entered. The limits are 7 CFR 2100.051's: **no till 0.075 or less, reduced till 0.252 or less**, above that conventional. A rating that doesn't support the selected tillage **steps it down** (no till → reduced till → none, never up), and the CI is rescored at that tillage; the screen says so before confirming. When a reduced-till field's passes rate no till, the step offers **Change to No till** once the originator ticks that the producer meets the no-till rules (including no till 4 of 5 years); it changes the field's tillage, so the estimate and the recordkeeping follow. An estimate doesn't need T-DISC. The client's `programs/fd-cic/fd-cic-tdisc.ts` mirrors the rating for the screen; the server rates the passes again at confirm, and that one counts.
3. **Tickets & yield.** The field's CTRM tickets (`GET api/field-plan/records/{id}/tickets`), **settled or not**. A ticket is listed when:
   - it was delivered under the field's split ID: the ticket detail's `combinedCustomerId` (added to CTRM's ticket API 2026-11). A split ticket has a row per party, the producer and any partner such as a landlord, each with its own customer code and the split ID. **Every party's row counts, whatever the split percentage** (user decision 2026-11-03); the table's Customer column shows whose row it is. `tickets` has no split filter, so the producer's tickets are read (`CtrmQueries.TicketsBySplitProducer`, its own document so an API without the field fails only this review) and the split's rows kept. A row only a partner holds, on a ticket with no row for the producer, isn't reached;
   - its product code is the crop row's crop (`FieldPlanCropGroups`, ported from the client's `CROP_CODE_MAP`, with a test that keeps them in step);
   - it's in the crop year. CTRM tickets carry no crop year, so:
     - a ticket on one of the producer's or the split's contracts takes **that contract's crop year**;
     - any other ticket counts when its **BL date** is in the crop year's window: `FieldPlan:TicketWindow:{crop}:From/To` (MM-dd), default `08-01` to `07-31` of the next year. The same window applies to every crop, canola included; a ticket outside it (an early canola harvest, say) is added in the review.
   - Net bushels are the split's net pounds ÷ the ODS conversion for the product code. With no conversion there is no figure ("?"), as everywhere in the portal: the ticket starts left out and can't be confirmed.

   Any ticket that isn't the field's can be unticked. **"+ Add a ticket from outside the crop year"** lists the split's other tickets for the crop, newest first, with the reason each is outside; an added one is kept as `cropYearMatch: "added"`. A ticket another of the field's confirmed CIs already counts is marked and can't be added or confirmed, so no ticket is counted twice.
   **Actual yield**, under the ticket table on the same step: suggested as included bushels ÷ acres, editable (up to 1,000 bu/ac). The CI at that yield and the confirmed tillage shows live.
4. **Recordkeeping.** What the producer keeps for 5 years, listed only for the practices the field claims: every field (location and acres, planting date, bushels and sales, expected-yield proof, nutrient plan, fertilizer records), plus nitrification inhibitor, manure, cover crop, tillage (field-pass log, T-DISC worksheet) and the no-till 4-of-5-years promise. Simplified from 7 CFR 2100.031, .051(c), .052(b) and .063; the wording is in `programs/fd-cic/fd-cic-recordkeeping.ts` for the business to edit. The originator ticks that it was reviewed with the producer; the tick is sent as `reviewedWithProducer` and the server refuses a confirm without it.
5. **Confirm CI** (`POST .../records/{id}/confirm` with the actual yield, ticket keys, `tDiscPasses` and `reviewedWithProducer`):
   - reads the tickets again on the server and keeps only the ones listed, so the bushels are CTRM's;
   - refuses a no-till or reduced-till field without passes (`FIELD_PLAN_TDISC_REQUIRED`, 422) or with a pass T-DISC doesn't allow; rates them with `TDiscService`, ignoring any rating in the saved data, and sets the tillage the rating supports;
   - sets the actual yield, rescores, locks, and writes the confirmed CI.

   Once confirmed, step 5 (and the field's tab, beside "View review") offers the report and the ledger.

**Biofuel Feedstock Report** (PDF, one per confirmed field): "Generate Biofuel Feedstock Report". Only the inputs and how the CI was worked out from them; not an attestation (changed 2026-11-03: no certification, tickets, recordkeeping list, attestation, signature, workbook hashes or bushels):
- farm and producer name, producer code, the primary contact's name (when the producer has one), and the field's county and state;
- the field's unique ID (the enrollment ID), split ID, name, acres, crop and crop year;
- every FD-CIC input, including the actual yield, the T-DISC rating, any stepped-down tillage, and the MLRA the county gives;
- the **T-DISC worksheet** for no till or reduced till (every pass with its mixing efficiency, depth and tillage intensity, each window's index, and the rating);
- the **CI calculation**: USDA's seven components and their total, the CI, with the FD-CIC version;
- a footer with who confirmed it (by name) and when.

Built in the browser: content in `programs/fd-cic/feedstock-report.ts` (tested), drawn by `feedstock-report.service.ts` with jsPDF, as the calculators' reports are. File name: `45Z-Biofuel-Feedstock-Report_{producer}_{enrollmentId}_{yyyymmdd}.pdf`.

**Mass Balance Ledger** (CSV for the Bins, one row per confirmed field, not per ticket): "Download Mass Balance Ledger" on the 45Z card above the planting table for the producer and year, and in a confirmed review.
- Columns: producer code and name, split ID, field, enrollment ID, crop year, commodity, acres, confirmed bushels, tickets (count), CI (g CO2e/bu), tillage, USDA version, confirmed by (the originator's name; their sign-in on a field confirmed before names were kept) and at.
- Built in the browser (`programs/fd-cic/mass-balance-ledger.ts`), with spreadsheet formula injection guarded (`shared/utils/csv.ts`).
- File name: `45Z-Mass-Balance-Ledger_{producer}_{year}_{yyyymmdd}.csv`.

## 45Z documents in Doc Store

Asked for by H. Collins on 2026-11-04, after the Doc Store team (Jesse, Charlie) gave the app's managed identity
access in Dev and QA. **Doc Store has no screens for end users**, so Origination is the UI for its
**Sustainability-45z** category (Charlie, 2026-11-05). Doc Store (repo `IT/docstore`) files each document with
free-form JSON metadata, but **it can't list a category's documents by metadata**: its search is full-text and
returns no metadata. So Origination keeps a row per document in **`dbo.FieldPlanDocument`** (migrations
`20261105151619_AddFieldPlanDocument` and `20261105210201_AddFieldPlanDocumentVersions`; review SQL
[scripts/field-plan-AddFieldPlanDocument.sql](../../scripts/field-plan-AddFieldPlanDocument.sql) then
[scripts/field-plan-AddFieldPlanDocumentVersions.sql](../../scripts/field-plan-AddFieldPlanDocumentVersions.sql)).
The dialog lists from that table and downloads are checked against it; Doc Store holds the file and the same
values as metadata for anyone reading it outside the app.

- **Per field and year:** the Biofuel Feedstock Report (PDF) and the field's **45Z Mass Balance Ledger** (CSV, the
  same one-row file as the review's Download button). **Per year:** the producer attestation and other supporting
  documents.
- **Confirming a field's CI saves its report and ledger.** It's the confirmation that saves them, not a
  download. After `confirm` succeeds the browser builds the same PDF and CSV and sends them to
  `POST api/field-plan/records/{id}/report` and `.../ledger`. The server checks that the field is confirmed and sets the metadata
  itself. It then writes each document's row and puts the document id on the official result (`reportDocumentId`,
  `ledgerDocumentId`), so a second save of the same confirmation returns the first document. Step 5 of the review
  shows "saved to Doc Store", or which one wasn't saved with the reason and **Save it now** (which saves only what's
  missing). A failed save never undoes the confirmation.
- **Overwritten and archived.** Nothing is deleted from Doc Store; only the row's `Status` changes:
  - **Overwritten**: a field unlocked and confirmed again gets a new report and ledger, and its previous current
    ones become Overwritten (with `ReplacedByDocStoreId`, who and when).
  - **Archived**: an originator sets any current document aside, with an optional reason (e.g. no longer relevant to
    the year). It can be restored, unless the field has a newer current report or ledger (archive that one first),
    so a field never has two current ones. An archived report isn't overwritten later; it stays Archived.
  - **One current attestation a year** (B. Cozart, 2026-11-05): uploading a new producer attestation archives the
    year's current one in the same save (reason "Replaced by a newer producer attestation.", `ReplacedByDocStoreId`
    set), and the upload form says so first. It can be restored only after the newer one is archived. Other
    supporting documents just add up.
- **"📄 45Z documents"** on the 45Z card's summary line (per producer and crop year; visible without opening the
  card) opens a dialog. With no 45Z fields that year yet, a slim 45Z line shows just this button, so the signed
  attestation can be uploaded before any field or CI. The dialog has two tabs:
  - **Current documents** (the crop year): the signed **annual attestation** first, then each field's **Biofuel
    Feedstock Report** and **45Z Mass Balance Ledger**, each named by field, split and year, then **other supporting
    documents**. Filter by type and, for reports and ledgers, by field. Upload and **Archive** are here.
  - **Version history** (every year): the overwritten and archived documents, marked as such with when, who and
    the archive reason. Filter by year (starts on the dialog's), type, field (reports and ledgers) and status.
    **Restore** for archived ones.
  - On both, the file name or **View** opens the document inside the dialog: a PDF in the browser's own viewer (an
    iframe on a `blob:` URL, as Contract Workspace does; the SPA CSP's `frame-src` allows `blob:`), with Print and
    Download; a ledger as a table (`programs/fd-cic/csv-table.ts`). A browser set to download PDFs gets a plain
    message and Download.
  The attestation is signed outside the app and uploaded here. The app still captures no attestation data
  (05d86c08); it only keeps the file.
- **Routes** (`FieldPlanController`, as the rest of the field plan: `field-plans:read` to list and download, `field-plans:write` for the rest, on any producer, AR-01/AR-02):

  | Route | Does |
  |---|---|
  | `POST records/{id}/report` | Saves a confirmed field's report |
  | `POST records/{id}/ledger` | Saves a confirmed field's Mass Balance Ledger |
  | `GET customer/{customerId}/documents?year=` | Lists the producer's documents, every status (no `year`: all years) |
  | `POST customer/{customerId}/documents` | Uploads an attestation or other document (form: `year`, `documentType` = `ProducerAttestation` or `Other`, `file`) |
  | `GET customer/{customerId}/documents/{documentId}` | Downloads one document |
  | `POST customer/{customerId}/documents/{documentId}/archive` | Archives a current document (body: optional `note`, up to 500 characters) |
  | `POST customer/{customerId}/documents/{documentId}/restore` | Restores an archived document |

- **Category and metadata the server sets** (`FieldPlanDocumentMetadata`): every document is filed under `Sustainability-45z`, with
  - on every document: `documentType` (`ProducerAttestation`, `FeedstockReport`, `MassBalanceLedger` or `Other`), `customerId`, `producerCode` (CTRM), `cropYear`, and `uploadedBy`/`uploadedByName`. Doc Store itself only sees the managed identity, so the originator is recorded here.
  - on reports and ledgers also: `splitId`, `fieldName`, `commodity` (the crop row's code), `fieldProgramRecordId` and `confirmedAt`.
  - The status (overwritten, archived) is only in the table; Doc Store's metadata isn't changed after upload.
- **Checks:**
  - Uploads must be PDF, PNG or JPEG, up to 10 MB. The type is decided by the file's first bytes, never by its name or the browser, and the file name is rebuilt to match.
  - A ledger must be UTF-8 text starting with the ledger's header row, with at least one row (`text/csv`). **The
    Sustainability-45z category has to allow `text/csv`** (ask Charlie; until then the ledger save says so in step 5).
  - A download whose document has no `FieldPlanDocument` row for the route's producer is a 404, so one producer's id can't fetch another's file. The file is served with the row's type and name, not Doc Store's.
  - If the row can't be written after Doc Store took the file, the error is logged as `FIELD_PLAN_DOCUMENT_ORPHANED` with the Doc Store id, for clean-up.
  - Uploads, saves, status changes and downloads are audit-logged (`AUDIT_UPLOAD`, `AUDIT_SAVE_REPORT`,
    `AUDIT_SAVE_LEDGER`, `AUDIT_OVERWRITE`, `AUDIT_ARCHIVE`, `AUDIT_RESTORE`, `AUDIT_DOWNLOAD`).
- **Configuration** (`DocStore` in appsettings): how the app reaches Doc Store, through the shared Platform client
  (`Api/Platform/DocStore`, registered by `AddDocStore`). The category isn't configured there: the field plan names its
  own. `Mode` is one of:
  - `""`: off. Uploads, report saves and downloads answer 503 `DOC_STORE_NOT_CONFIGURED`.
  - `InMemory`: a stand-in that forgets on restart. Local development only; the API refuses to start with it elsewhere.
  - `Http` (`HttpDocStoreClient`): Doc Store through APIM. `POST {BaseUrl}/documents` with the file base64-encoded
    in JSON plus `categoryCode` and `metadata`; `GET {BaseUrl}/documents/{id}/content?deliveryMethod=proxy`. Token for
    `Scope` from the App Service managed identity, or your own `az login` on a laptop. Uploads aren't retried (Doc
    Store doesn't refuse duplicates). Without `BaseUrl` and `Scope` it stays off.

  | Environment | BaseUrl | Scope |
  |---|---|---|
  | Dev | `https://apidev.scoular.com/internal/docstore/v1` | `api://f7f91201-60a7-483b-b9fe-cc540e539879/.default` |
  | QA | `https://apiqa.scoular.com/internal/docstore/v1` | `api://f9577a19-eac4-45f8-997d-e956d6154430/.default` |
  | PROD | `https://api.scoular.com/internal/docstore/v1` | `api://e34afd6c-d7bd-4c06-8ac2-f0e0718fe3e3/.default` |

  From Doc Store's `docs/API-USAGE-GUIDE.md`; they aren't secrets. **PROD needs the managed identity granted the
  category by the Doc Store team before go-live** (Dev and QA were granted 2026-11-04).
- **The screens follow `fieldPlanBackend`**: documents need `'api'` (`FieldPlanDocumentsService.enabled`).

**Checked on QA (2026-11-03):** `tickets(customerId: "TATOB43")` returns nothing, because a split ID isn't a ticket customer. TATOBIN's tickets carry the split in `combinedCustomerId`: TATOB43 has 5 rows in the 2024-25 window, all TATOBIN's, and TATOB02's rows are TATOBIN's, PARKROR's and TAYLSAE's. Not yet checked: that PROD's API has `combinedCustomerId`.

## Reporting: field-level CI and bushels

The business doesn't plan on one producer-wide average CI. Downstream opportunities may each need a
different CI target, so the question is **how many bushels sit at or below a given CI**, by crop.

- The 45Z card shows a "bushels by CI" ladder per crop: fields lowest CI first, each with its
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
- **A field once per crop per year.** The same split on two rows of the same crop (say irrigated and dryland
  corn) pulled the same tickets twice, so the Bins' ledger would have counted them twice.
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
   fallback was removed, and the originator can add a ticket the crop year rule missed, so one window serves every crop.)

## Legal

Building the calculator from the workbook was cleared on the assumption that legal approves reproducing
USDA's method and tables, including the GREET-derived national constants. Record the written approval here
when it arrives.
