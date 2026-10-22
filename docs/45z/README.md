# 45Z feedstock CI: USDA FD-CIC versions

The app calculates a field's 45Z carbon-intensity (CI) score with USDA's Feedstock Carbon Intensity
Calculator (FD-CIC). USDA publishes the method as an Excel workbook and releases new versions from time
to time. This page records which version the app uses and how to move to a new one.

## Version in use

| | |
|---|---|
| Method | USDA FD-CIC **v1.2** |
| Source workbook | `usda-fdcic-ver1.2_9_11_2026.xlsm` (USDA last modified 2026-09-11) |
| Data pack | [api/GrainOriginatorPortal.Api/Content/FdCic/v1.2/](../../api/GrainOriginatorPortal.Api/Content/FdCic/v1.2/) |
| How it calculates | [fd-cic-v1.2-method.md](fd-cic-v1.2-method.md) |
| Checked against Excel | 2026-10-22: 7 scored cases matched to 15+ significant digits, and 2 unscorable counties gave Excel's errors ([golden-cases.json](../../api/GrainOriginatorPortal.Api/Content/FdCic/v1.2/golden-cases.json)) |
| Formula fingerprint | `a2ccea4b…` (full value in the pack's `manifest.json`) |

**Open item:** the copy the v1.2 pack was extracted from was re-saved locally on 2026-10-22 after
macros were enabled. Its tables and formulas are identical to USDA's file, but its SHA-256 differs from the
original download. Before go-live, re-download v1.2 from USDA, re-run the extractor and the Excel check
(steps 2-4 below), and commit the pack so `manifest.json` records the original file's hash.

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

**Rules the calculator follows** (to build in the C# port):
- Every saved score records the method version (e.g. `USDA FD-CIC v1.2`) and the pack's hashes, next to the
  inputs and outputs it froze.
- A finalized score is never recalculated under a newer version. It stays on the version that produced it.
- Which version applies to a program year is a setting, so switching versions is a configuration change, not
  a code release.
- A version can't be switched on until its golden cases pass.

**Decision needed (business):** when USDA releases a new version mid-season, should fields that are not yet
finalized be rescored under it? Recommended: yes, with a visible "rescored under vX" note. Finalized fields
keep their version either way.

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
   - Check the new constants and coverage against USDA's release notes or User Guide.
4. **Confirm the test cases in Excel.** Copy `golden-cases.json` from the previous pack, add cases for anything
   the release changed, then fill in Excel's results:
   ```bash
   node tools/fdcic-extract/golden.mjs <new-workbook.xlsm> api/GrainOriginatorPortal.Api/Content/FdCic/v1.3
   ```
5. **Run the API tests.** The calculator must match every golden case in the new pack.
6. **Review and approve:** a pull request with the pack, `CHANGES.md` and test results. Update the
   "Version in use" table above. `CHANGES.md` stays in the repo as the record of what changed.
7. **Switch the program year's version** in configuration once approved.

For a tables-only release this should take about a day, most of it review.

## Legal

Building the calculator from the workbook was cleared on the assumption that legal approves reproducing
USDA's method and tables, including the GREET-derived national constants. Record the written approval here
when it arrives.
