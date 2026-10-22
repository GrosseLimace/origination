# USDA FD-CIC v1.2: how the CI score is calculated (read from the workbook)

## 1. Source and provenance

| Item | Value |
|---|---|
| Source file | `usda-fdcic-ver1.2_9_11_2026.xlsm` (Excel macro-enabled workbook) |
| Version labels found | `Crop Inputs!C1` = "Version 1.2"; `Disclaimer!C6` = "USDA FD-CIC Ver. 1.2"; `Disclaimer!C4` = "USDA FD-CIC  SOFTWARE" |
| Document properties | created 2020-02-20; last modified 2026-09-11 by USDA OCE (`docProps/core.xml`) |
| Date read | 2026-10-22 |
| Calc settings | `<calcPr calcId="191028" iterate="1" iterateDelta="1E-5"/>`: iterative calculation is on. No circular references were found in the scoring formulas. |

**How this was produced.** Everything here comes from reading the package parts as data. Each part was streamed with `unzip -p` and parsed with small Node scripts. Nothing was opened in Excel and no macro ran. The zip was never extracted to disk. Shared formulas were expanded to show each cell's real formula. Values marked "cached" are the last values Excel saved in the file.

**License / notice: review needed before we ship a port.** This write-up is for a planned C# re-implementation. Before any code ships, someone needs to review the workbook's USDA/Argonne notice.
- The only notice text found in the workbook is the USDA disclaimer on sheet `Disclaimer`:
  - `C13`: "THIS SOFTWARE AND MANUAL ARE SUPPLIED "AS IS" WITHOUT WARRANTY OF ANY KIND."
  - `C14`: "Neither the United States Government, nor the United States Department of Agriculture, nor the Office of the Chief Economist at USDA, nor any of their employees, makes any warranty, express or implied, or assumes any legal liability or responsibility for the accuracy, completeness, or usefulness of any information, data, apparatus, product, or process disclosed, or represents that its use would not infringe privately owned rights"
  - `C8`: contact `sm.oce.oeep.BiofuelFeedstocks@usda.gov`
- I found **no Argonne notice text** (no "Argonne", "copyright" or "license" string) in any XML part, in shared strings, or in the VBA strings. The workbook does point back to Argonne's GREET model in three ways:
  - an external link to `C:\45Z-CF GREET_2026\...\GREET1_2025.xlsm` (`xl/externalLinks/externalLink1.xml.rels`);
  - about 900 inherited GREET defined names pointing to `[1]...`;
  - legacy GREET-sync VBA.
- The PNG images (`xl/media/*.png`) were not inspected and could carry logos or notices.
- The USDA FD-CIC User Guide PDF linked from `Instructions!C11` was not reviewed.

Sheet map (from `xl/workbook.xml` and `xl/_rels/workbook.xml.rels`):

| Part | Sheet | State |
|---|---|---|
| sheet1 | Disclaimer | visible |
| sheet2 | Crop Inputs | visible (the only input/output sheet; sheet-protected) |
| sheet3 | Instructions | visible |
| sheet4 | Glossary | visible |
| sheet5 | Guidance on N test results | visible |
| sheet6 | USDA Helper Sheet | hidden (protected) |
| sheet7 | CSA | hidden |
| sheet8 | IEF_Indir | hidden |
| sheet9 | IEF_dir | hidden |
| sheet10 | NI_Impact | hidden |
| sheet11 | Inputs for Natl Est Avg | hidden |
| sheet12 | State_County | hidden (not referenced by any formula or name) |
| sheet13 | Parameters | hidden |

Formula counts per sheet:

| Sheet | Formulas |
|---|---|
| Crop Inputs | 309 (about 30 per MU column) |
| USDA Helper Sheet | 5 |
| Inputs for Natl Est Avg | 9 |
| Parameters | 4 |
| All other sheets | 0 (CSA, IEF_*, NI_Impact and State_County are pure value tables) |

No formula in any sheet references the external GREET workbook (`[1]`).

---

## 2. Calculation flow for one management unit (column C = MU #1)

Columns D..L (MU #2..#10) contain the same formulas, shifted by column. Column M holds the "Estimated National Average".

### 2.0 Notation and named items used below

| Name | Resolves to | Value |
|---|---|---|
| `USDACrop` | `'Crop Inputs'!$C$4` | "Corn" / "Sorghum" / "Soybean" / "Canola" (list validation) |
| `USDAFieldNumber` | `'Crop Inputs'!$C$5` | 1..10 |
| `MaxFields` | `'USDA Helper Sheet'!$J$22` | 10 |
| `g_to_lb`, `lb2g` | `Parameters!$B$3` | 453.592 (**g per lb**, despite the name) |
| `N2O_N_to_N2O` | `Parameters!$B$16` | 1.5714285714285714 (= 44/28) |
| `N2O_GWP` | `Parameters!$B$45` | 265 (IPCC AR5) |
| `FIPSTable` | Excel table `'USDA Helper Sheet'!D2:G3114`, columns FIPS, Name, State, MLRA | |
| `{Crop}farming_Ninbiomass_residue` | `Parameters!B21` (Corn), `B24` (Soybean), `B34` (Sorghum), `B30` (Canola) | used via `INDIRECT` |
| `Soybeanfarming_Nfixation_N2O_factor` | `Parameters!$B$25` | 7.3 g N2O/bu |
| `USDA{Crop}{Component}` | `'USDA Helper Sheet'!B4:B41` | hard-coded national-average components (§3.1) |

**The geographic key is MLRA, not county.** Every hidden lookup (CSA, IEF_dir, IEF_Indir, NI_Impact) is keyed by the county's MLRA (USDA Major Land Resource Area). The formulas get it with `VLOOKUP(C12, FIPSTable[], 4, FALSE)`, i.e. the 4th column of FIPSTable. County matters only because it maps to an MLRA.

**Matching rules a port must reproduce:**
- `MATCH` with match type 0 is **case-insensitive**. The CSA and NI_Impact crop headers are lower-case ("corn"), while `USDACrop` is "Corn".
- MLRA codes are stored as numbers (e.g. 103) or text (e.g. "94A") consistently across all tables. A port should treat them as strings.

### 2.1 Location → FIPS → MLRA

| Cell | Formula (stored) | Meaning |
|---|---|---|
| C10 | input | State abbreviation. Validation list = `StateListAbv` = `FIPSTable3[State]` (`'USDA Helper Sheet'!P3:P3114`). |
| C11 | input | County name. Validation list = `INDIRECT(C10)`, i.e. the named range for that state (e.g. `IA` = `'USDA Helper Sheet'!$E$757:$E$855`). |
| C12 | `{=INDEX(FIPSTable[FIPS],MATCH(C10&C11,FIPSTable[State]&FIPSTable[Name],0))}` (array) | County FIPS, found by exact match on State+Name. With the default "None"/"None" it returns "None" (the last table row, D3114). |
| C24, C87 | same formula as C12 | Duplicates of FIPS. **Not used by any formula.** |
| (inline) | `VLOOKUP(C12,FIPSTable[],4,FALSE)` | MLRA of the county. Used inside C25, C26, C72, C79, C80, C82. |

### 2.2 Yield for CI (clamp)

| Cell | Formula | Meaning |
|---|---|---|
| C14 | input | Actual average yield (bu/ac) |
| C15 | input | Expected yield (bu/ac): crop-insurance yield, or a USDA transitional/County Benchmark yield |
| C16 | `=IF(C14<('USDA Helper Sheet'!$J$4*'Crop Inputs'!C15),'USDA Helper Sheet'!$J$4*'Crop Inputs'!C15,IF(C14>('USDA Helper Sheet'!$J$3*'Crop Inputs'!C15),'USDA Helper Sheet'!$J$3*'Crop Inputs'!C15, 'Crop Inputs'!C14))` | **Yield for CI** = clamp(actual, 0.8 × expected, 1.2 × expected). J4 = 0.8 ("Lower bound on yield range"), J3 = 1.2 ("Upper bound on yield boundary"). |

Edge cases:
- If C15 = 0 (left blank) and C14 > 0, then C16 = 1.2 × 0 = 0, and every per-bushel term becomes `#DIV/0!`.
- Rows 16-17 are hidden on the sheet.
- C17 ("Total production at this CI") has **no formula** and stays empty.

### 2.3 Nitrogen use intensity (NUI) and NUE terms

| Cell | Formula | Meaning (corn cached value) |
|---|---|---|
| C18 | input | Total synthetic N applied, lb N/ac |
| C20 | `=C18/C16` | **User NUI**, lb N per bu (yield for CI) |
| C21 | `=INDEX(Parameters!$B$49:$E$54, 5, MATCH(USDACrop,Parameters!$B$49:$E$49),1)` | Default NUI behind the national average = `Parameters!B53:E53`, by crop. Corn 0.83702596. The `MATCH` has no match type (approximate), but the headers `canola, corn, sorghum, soybean` are sorted, so it works as an exact lookup. |
| C27 | `=INDEX(Parameters!$B$49:$E$54, 6, MATCH(USDACrop,Parameters!$B$49:$E$49),1)` | "USDA NUE Threshold" = `Parameters!B54:E54`. Corn 0.9774. |
| C23 | `=C21/C27` | "NUE Adjustment Factor". **A per-crop constant that does not depend on user input.** Corn 0.85638. |
| C25 | `{=IFERROR(INDEX(IEF_dir!$D$4:$D$405, MATCH(VLOOKUP(C12,FIPSTable[],4,FALSE)&USDACrop,IEF_dir!$C$4:$C$405&IEF_dir!$A$4:$A$405,0),1),NA())}` | Direct-N2O implied emission factor (IEF) for the MLRA and crop, **in percent** (e.g. 1.217 means 1.217% of applied N is emitted as N2O-N). |
| C26 | `{=IFERROR(INDEX(IEF_Indir!$D$4:$D$405, MATCH(VLOOKUP(C12,FIPSTable[],4,FALSE)&USDACrop,IEF_Indir!$C$4:$C$405 & IEF_Indir!$A$4:$A$405,0),1),NA())}` | Indirect-N2O IEF, in percent. |

`Parameters!B53:E53` are themselves formulas:

| Cell | Crop | Formula |
|---|---|---|
| B53 | canola | `='Inputs for Natl Est Avg'!E51/'Inputs for Natl Est Avg'!F10` |
| C53 | corn | `='Inputs for Natl Est Avg'!B51/'Inputs for Natl Est Avg'!B10` |
| D53 | sorghum | `='Inputs for Natl Est Avg'!D51/'Inputs for Natl Est Avg'!D10` |
| E53 | soybean | `='Inputs for Natl Est Avg'!C51/'Inputs for Natl Est Avg'!C10` |

Each one is (national total N lb/ac) ÷ (national yield). The supporting cells are:
- Row 51 = `SUM(rows 20:26)`, the seven N-fertilizer products.
- Canola yield is entered in lb (`E10`) and converted with `F10 = E10/Parameters!B50` (50 lb/bu).

### 2.4 Mapping the practice choices to a column in the hidden tables

CSA and NI_Impact select a **column** by joining text from five header rows: crop (row 2), cover crop (row 10), tillage (row 11), row 12 and row 13. The key is built the same way in every lookup:

```
USDACrop & C29 & C31 & C58 & C59
   vs  {sheet}!$C$2:$X$2 & $C$10:$X$10 & $C$11:$X$11 & $C$12:$X$12 & $C$13:$X$13
```

- C29: cover crop. List = `'USDA Helper Sheet'!$I$27:$I$29` = Cover crop / Cover crop with grazing / No cover crop.
- C31: tillage. List = `'USDA Helper Sheet'!$I$32:$I$34` = Reduced till / No till / None of the above.
- C58 is a hidden row fixed at "None of the above". C59 is a hidden row fixed at "None used" (§5).

Both tables have one column per crop × cover × tillage combination: 9 columns per crop, 36 in total, all in C..AL. Rows 3-6 hold the model scenario codes. For example, corn + No till + Cover crop maps to scenario `NTRT_ccR`. For sorghum, "No till" maps to `NTIT` scenarios.

The **row** is chosen by MLRA within a fixed block:

| Block (rows) | Content | Used by |
|---|---|---|
| 16-247 | Change in SOC, g CO2e/bu (CSA). The same block exists in NI_Impact. | C72 (CSA only) |
| 248-479 | % change in direct N2O vs. CSU baseline (fraction) | C79 (both CSA and NI_Impact) |
| 480-711 | % change in indirect N2O vs. CSU baseline (fraction) | C80 (both CSA and NI_Impact) |
| 712-943 | Change in SOC, g CO2e/acre | **unused** |
| 944-1175 | % change in fuel use vs. CSU baseline (fraction) | C82 (CSA only). All zeros in NI_Impact; NI_Impact's block is unused. |

Each block covers the same 232 MLRAs in column B.

### 2.5 Emissions from N fertilizer manufacture and transport (C70)

| Cell | Formula |
|---|---|
| C70 | `=OFFSET(C66,4,(MaxFields+3-COLUMN(C66)))*(C20/C27)` |

`OFFSET(C66, 4, 10+3-3)` resolves to **`M70`**, the national-average N-fertilizer component:

| Cell | Formula |
|---|---|
| M70 | `=IF(USDACrop="Corn",USDACornNFert,IF(USDACrop="Soybean",USDASoyNFert,IF(USDACrop="Sorghum",USDASorgNFert,USDACanolaNFert)))` |

So: **C70 = NationalNFert[crop] × (User NUI ÷ NUE threshold)**, in g CO2e/bu.
- The scaling uses C27 (the threshold), not C21 (the default NUI).
- Manure N does not enter this term.

### 2.6 Soil carbon (C72)

| Cell | Formula |
|---|---|
| C72 | `{=-(IFERROR(INDEX(CSA!$C$16:$AL$247,MATCH(VLOOKUP(C12,FIPSTable[],4,FALSE),CSA!$B$16:$B$247,0),MATCH(USDACrop&C29&C31&C58&C59,CSA!$C$2:$AL$2&CSA!$C$10:$AL$10&CSA!$C$11:$AL$11&CSA!$C$12:$AL$12&CSA!$C$13:$AL$13,0)),NA()))}` |

C72 = **−CSA_SOC[MLRA, crop+cover+tillage]**, in g CO2e/bu.
- The CSA table stores sequestration as positive numbers, so a positive table value becomes a credit (a negative CI contribution).
- The comment on `Crop Inputs!B72` and the note at `Instructions!P233` say: positive = SOC loss, negative = sequestration.
- The "None of the above" + "No cover crop" (`base`) column is 0 in every MLRA that has data.
- **The value is already per bushel.** It does not depend on the user's yield or acres.
- Where CSA has the text `"NA"`, `-("NA")` gives `#VALUE!`. An unknown MLRA or combination gives `#N/A`.

### 2.7 Direct N2O (C79), including manure, residue, inhibitor, and practice effects

| Cell | Formula |
|---|---|
| C79 | `{=(C23*((C18*g_to_lb)/C16) * (C25/100) * N2O_GWP * N2O_N_to_N2O*(1+C33*IFERROR(INDEX(NI_Impact!$C$248:$DX$479,MATCH(VLOOKUP(C12,FIPSTable[],4,FALSE),NI_Impact!$B$248:$B$479,0),MATCH(USDACrop&C29&C31&C58&C59,NI_Impact!$C$2:$DX$2&NI_Impact!$C$10:$DX$10&NI_Impact!$C$11:$DX$11&NI_Impact!$C$12:$DX$12&NI_Impact!$C$13:$DX$13,0)),NA())) + INDIRECT(USDACrop&"farming_Ninbiomass_residue")*(C25/100) * N2O_N_to_N2O * N2O_GWP+C23*(C45/C16) * (C25/100) * N2O_GWP * N2O_N_to_N2O)*(1+IFERROR(INDEX(CSA!$C$248:$AV$479,MATCH(VLOOKUP(C12,FIPSTable[],4,FALSE),CSA!$B$248:$B$479,0),MATCH(USDACrop&C29&C31&C58&C59,CSA!$C$2:$AV$2&CSA!$C$10:$AV$10&CSA!$C$11:$AV$11&CSA!$C$12:$AV$12&CSA!$C$13:$AV$13,0)),NA()))+IF(USDACrop="Soybean", Soybeanfarming_Nfixation_N2O_factor * N2O_GWP,0)}` |

In plain terms, with `k = 265 × 44/28` and `IEFd = C25/100`:

```
synN_g_per_bu    = C18 [lb N/ac] * 453.592 / C16
manureN_g_per_bu = C45 [g N/ac] / C16
residueN_g_per_bu = Parameters!{B21|B24|B34|B30}           (constant per crop)
NI_dir  = NI_Impact[rows 248-479][MLRA, practice col]       (fraction, typically negative)
CSA_dir = CSA[rows 248-479][MLRA, practice col]             (fraction)

C79 = ( C23*synN*IEFd*k*(1 + C33*NI_dir)
      + residueN*IEFd*k
      + C23*manureN*IEFd*k ) * (1 + CSA_dir)
      + (crop == Soybean ? 7.3 * 265 : 0)
```

Notes:
- **The nitrification-inhibitor (NI) effect applies only to the synthetic-N term.** It scales linearly with C33 (fraction 0-1).
- **Manure N is multiplied by C23** (the NUE adjustment) and by the IEF. It is not affected by the inhibitor.
- **Crop residue N** is a per-bushel constant. It is not multiplied by C23 and not affected by the inhibitor, but it **is** affected by the practice factor `(1+CSA_dir)`.
- **Soybean branch:** the N-fixation term (7.3 g N2O/bu × 265 = 1,934.5 g CO2e/bu) is added **outside** the practice multiplier.
- If the NI_Impact cell holds the text `"NA"`, the result is `#VALUE!` **even when C33 = 0**, because `0*"NA"` is still an error.

### 2.8 Indirect N2O (C80)

| Cell | Formula |
|---|---|
| C80 | `{=( C23*((C18*g_to_lb)/C16) *(C26/100)* N2O_GWP * N2O_N_to_N2O*(1+C33*IFERROR(INDEX(NI_Impact!$C$480:$DX$711,MATCH(VLOOKUP(C12,FIPSTable[],4,FALSE),NI_Impact!$B$480:$B$711,0),MATCH(USDACrop&C29&C31&C58&C59,NI_Impact!$C$2:$DX$2&NI_Impact!$C$10:$DX$10&NI_Impact!$C$11:$DX$11&NI_Impact!$C$12:$DX$12&NI_Impact!$C$13:$DX$13,0)),NA())) + INDIRECT(USDACrop&"farming_Ninbiomass_residue")*(C26/100) * N2O_N_to_N2O * N2O_GWP+C23*(C45/C16) * (C26/100) * N2O_GWP * N2O_N_to_N2O)*(1+IFERROR(INDEX(CSA!$C$480:$AV$711,MATCH(VLOOKUP(C12,FIPSTable[],4,FALSE),CSA!$B$480:$B$711,0),MATCH(USDACrop&C29&C31&C58&C59,CSA!$C$2:$AV$2&CSA!$C$10:$AV$10&CSA!$C$11:$AV$11&CSA!$C$12:$AV$12&CSA!$C$13:$AV$13,0)),NA()))}` |

This has the same structure as C79, with three differences:
- it uses C26 (the indirect IEF);
- it reads NI_Impact rows 480-711 and CSA rows 480-711;
- it has **no** soybean N-fixation term.

C81 = `=C79+C80` gives total N2O.

### 2.9 Manure / amendment N (C45, C46)

| Cell | Formula | Meaning |
|---|---|---|
| C36 / C39 / C42 | input | Manure type 1/2/3. List = `'USDA Helper Sheet'!$I$13:$I$21` (8 types + "None"). **Not referenced by any formula.** |
| C37 / C40 / C43 | input | Amount, in tons/ac (solid) or 1,000 gal/ac (liquid) |
| C38 / C41 / C44 | input | N content, in lb N/ton or lb N/1,000 gal |
| C49..C56 | hidden rows | Legacy "soil amendment" block (types C49/C53 = "None"; amounts and N contents C50/C51/C54/C55 = 0; C52/C56 = 0 and unreferenced) |
| C45 | `=(C37*C38+C40*C41+C43*C44+C50*C51+C54*C55)*lb2g` | Total amendment N, **g N/ac**, used in C79/C80 |
| C46 | `=(C37*C38+C40*C41+C43*C44+C50*C51+C54*C55)` | Same total in lb N/ac. **Not referenced.** |

Manure type does **not** change the score. Only amount × N content does, so solid and liquid are treated identically. Manure type is used only by VBA input checks (§6).

### 2.10 On-farm energy (C82)

| Cell | Formula |
|---|---|
| C82 | `{=IF(USDACrop="Corn",USDACornOnFarm,IF(USDACrop="Soybean",USDASoyOnFarm,IF(USDACrop="Sorghum",USDASorgOnFarm,USDACanolaOnFarm)))*(1+IFERROR(INDEX(CSA!$C$944:$AV$1175,MATCH(VLOOKUP(C12,FIPSTable[],4,FALSE),CSA!$B$944:$B$1175,0),MATCH(USDACrop&C29&C31&C58&C59,CSA!$C$2:$AR$2&CSA!$C$10:$AR$10&CSA!$C$11:$AR$11&CSA!$C$12:$AR$12&CSA!$C$13:$AR$13,0)),NA()))+IF(USDACrop="Corn",USDACornOnFarmOthers,IF(USDACrop="Soybean",USDASoyOnFarmOthers,IF(USDACrop="Sorghum",USDASorgOnFarmOthers, USDACanolaOnFarmOthers)))}` |

**C82 = NatlOnFarm_DieselGasoline[crop] × (1 + CSA_fuel%[MLRA, practice]) + NatlOnFarm_Others[crop]**
- Only the diesel + gasoline part (`'USDA Helper Sheet'!B7/B17/B27/B37`) is scaled by the practice.
- The "others" part (natural gas, LPG, electricity; `B8/B18/B28/B38`) is a constant.
- The practice effect is typical of tillage. For example, MLRA 103 corn No till gives −35.3% and Reduced till −19.3%, while cover crop adds about +14-15% (one more field pass).
- The INDEX range (C:AV) and the header MATCH range (C:AR) both start at column C, so the column offsets agree.

### 2.11 Other chemicals (C83)

| Cell | Formula |
|---|---|
| C83 | `=IF(USDACrop="Corn",USDACornOther,IF(USDACrop="Soybean",USDASoyOther,IF(USDACrop="Sorghum",USDASorgOther,USDACanolaOther)))` |

This is a national per-crop constant, the same for every user (P, K, herbicide, insecticide, etc.).

### 2.12 Urea and lime CO2 (C84)

| Cell | Formula |
|---|---|
| C84 | `=IF(USDACrop="Corn",(USDACornUrea*(C20/C27)+USDACornLime),IF(USDACrop="Soybean",(USDASoyUrea*(C20/C27)+USDASoyLime),IF(USDACrop="Canola",(USDACanolaUrea*(C20/C27)+USDACanolaLime),(USDASorgUrea*(C20/C27)+USDASorgLime))))` |

**C84 = NatlUrea[crop] × (C20/C27) + NatlLime[crop]**
- Urea CO2 scales the same way as the N-fertilizer term.
- Lime is constant. It is non-zero only for corn (302.5).

### 2.13 Total CI and comparison to the national average

| Cell | Formula | Meaning |
|---|---|---|
| B68 | `= USDACrop&" "&'USDA Helper Sheet'!I36` | Label, e.g. "Corn Carbon Intensity (CI) Score (g CO2e/bushel)" |
| **C68** | `=SUM(C70,C72,C82:C83,C$84)+C81` | **CI = NFert + SOC + Energy + OtherChem + Urea/Lime + (DirectN2O + IndirectN2O)**, in g CO2e/bu. Any error in a component makes the total an error. |
| M68 | `{=SUM(_xlfn._xlws.FILTER(M70:M84,ISNUMBER(M70:M84)))-SUM(M73:M80)}` | National average = M70 + M81 + M82 + M83 + M84. M73/M74 duplicate M79/M80 and are subtracted back out. Cached 6019.5488 for corn. |
| M70 | (see §2.5) | National N-fertilizer component |
| M73, M79 | `=IF(USDACrop="Corn",USDACornDN2o,...)` | National direct N2O |
| M74, M80 | `=IF(USDACrop="Corn",USDACornIndN2O,...)` | National indirect N2O |
| M81 | `=M79+M80` | National total N2O |
| M82 | `=IF(USDACrop="Corn",USDACornOnFarm+USDACornOnFarmOthers,...)` | National on-farm energy |
| M83 | (same pattern as C83) | National other chemicals |
| M84 | `=IF(USDACrop="Corn",(USDACornUrea+USDACornLime),...)` | National urea and lime |
| C98 | `=IFERROR((C68-OFFSET(C68,0,(MaxFields+3-COLUMN(C68))))/OFFSET(C68,0,(MaxFields+3-COLUMN(C68))),"")` | % change vs. national = (C68 − M68)/M68, as a fraction. Returns "" on error. |
| C99 | `=IFERROR((C68-OFFSET(C68,0,(MaxFields+3-COLUMN(C68)))),"")` | Absolute change = C68 − M68 |

Cells shown on the sheet but not used in the score:
- C66 = `=C8` (MU name header).
- D67 = `=OFFSET(D70,0,(USDAFieldNumber-COLUMN(D72)+3))` is a hidden helper that is not referenced.
- D85 is a stray formula that is not referenced.
- C89:C92 echo C29/C31/C58/C59 for display. These rows are hidden.

**Per-crop branches, summarized:**
- Every national constant is selected by crop through the `IF(USDACrop=...)` chains or the `USDA{Crop}...` names.
- `Parameters!B49:E54` gives the NUI default and threshold.
- The residue N comes from `INDIRECT(crop&"farming_Ninbiomass_residue")`.
- Only soybean gets the N-fixation term.
- CSA and NI_Impact columns exist per crop. Sorghum's no-till scenario is `NTIT` rather than `NTRT`.
- The IEF rows are per crop+MLRA.
- The order of the urea/lime IF chain differs (it tests Canola before falling through to Sorghum) but gives the same result.

### 2.14 Consolidated algorithm (one MU)

```
mlra   = FIPS[state, county].MLRA
y      = clamp(actual, 0.8*expected, 1.2*expected)
nui    = synN_lb / y
adj    = DefaultNUI[crop] / Threshold[crop]
col    = practiceColumn(crop, cover, tillage, "None of the above", "None used")
nfert  = Natl[crop].NFert * nui / Threshold[crop]
soc    = -CSA.SOC_g_per_bu[mlra, col]
dir    = (adj*synN_g/y*IEFdir*k*(1+niFrac*NI.dir[mlra,col]) + residueN[crop]*IEFdir*k + adj*manureN_g/y*IEFdir*k)
         * (1+CSA.dir[mlra,col]) + (soy ? 7.3*265 : 0)
ind    = (adj*synN_g/y*IEFind*k*(1+niFrac*NI.ind[mlra,col]) + residueN[crop]*IEFind*k + adj*manureN_g/y*IEFind*k)
         * (1+CSA.ind[mlra,col])
energy = Natl[crop].DieselGas * (1+CSA.fuel[mlra,col]) + Natl[crop].OtherEnergy
chem   = Natl[crop].OtherChem
ulime  = Natl[crop].Urea * nui / Threshold[crop] + Natl[crop].Lime
CI     = nfert + soc + dir + ind + energy + chem + ulime
NatlCI = sum(Natl[crop].*)
pct    = (CI - NatlCI)/NatlCI ; abs = CI - NatlCI
```
where `k = 265*44/28`, `IEF* = table value / 100`, and `synN_g = synN_lb*453.592`.

**Check: the national constants can be partly reproduced.** For corn, using national N = 155.687 lb/ac, yield 186, IEF 1%/0.374% (`Parameters!C38/C39`), residue 141.6 g N/bu with residue factors 1%/0.264% (`Parameters!C22/D22`), and without C23:
- direct = 1581.1 + 589.7 = 2170.7, which matches `Helper!B5`;
- indirect = 591.3 + 155.7 = 747.0, which matches `B6`.

For soybean, direct = 208.0 + 2319.5 + 1934.5 = 4461.97, which matches `B15`.

The other national components (N-fertilizer upstream, energy, chemicals, urea, lime) are hard-coded and cannot be derived from this workbook. They presumably come from GREET.

---

## 3. Lookup tables

### 3.1 USDA Helper Sheet: national-average components (`'USDA Helper Sheet'!A3:B42`)

All values are hard-coded constants except the totals (`B12/B22/B32/B42 = SUM(...)`). Units are g CO2e/bu, and the note at A44 says "Calculated based on GWP AR5".

| Component | Corn (B4..B11) | Soybean (B14..B21) | Sorghum (B24..B31) | Canola (B34..B41) |
|---|---|---|---|---|
| N fertilizer upstream (`*NFert`) | 1274.9292 | 167.6975 | 1509.9057 | 3086.8834 |
| Direct N2O (`*DN2O`) | 2170.7100 | 4461.9698 | 2492.9215 | 6975.0793 |
| Indirect N2O (`*IndN2O`) | 746.9826 | 690.1279 | 864.1000 | 2377.8781 |
| On-farm diesel+gasoline (`*OnFarm`) | 543.3561 | 1030.3585 | 684.5410 | 899.5088 |
| On-farm others (`*OnFarmOthers`) | 272.0935 | 236.3981 | 5.0479 | 40.4301 |
| Other chemicals (`*Other`) | 474.5550 | 1064.7645 | 595.1426 | 1036.3889 |
| Urea CO2 (`*Urea`) | 234.4064 | 30.8326 | 277.6088 | 1114.1370 |
| Lime CO2 (`*Lime`) | 302.5160 | 0 | 0 | 0 |
| **Total** | **6019.5488** | **7682.1489** | **6429.2676** | **15530.3055** |

Full-precision values are in the cells. The calc script used 17 significant digits.

### 3.2 FIPSTable (`'USDA Helper Sheet'!D2:G3114`, Excel table `FIPSTable`)

- Columns: FIPS (number), Name (county), State (2-letter), MLRA (number or text).
- 3,111 counties plus a final "None/None/None" row (D3114), with MLRA blank. Sorted by FIPS.
- 49 state codes (48 contiguous states + DC) and 209 distinct MLRAs.
- No duplicate State+Name keys.

A copy, `FIPSTable3` (`N2:Q3114`, sorted by State, Name), supplies the state dropdown (`StateListAbv`). Per-state named ranges (`AL`...`WY`, e.g. `IA` = `E757:E855`) supply the county dropdowns.

| FIPS | Name | State | MLRA |
|---|---|---|---|
| 1001 | Autauga | AL | 133C |
| 17113 | McLean | IL | 108 |
| 19169 | Story | IA | 103 |
| 20055 | Finney | KS | 72 |
| 38017 | Cass | ND | 56A |

### 3.3 IEF_dir (`IEF_dir!A3:D405`) and IEF_Indir (`IEF_Indir!A3:D405`)

- Columns: A Crop (Corn/Soybean/Sorghum/Canola), B Indicator (`DirN2O` / `IndirN2O`), C MLRA2022, D `base` value.
- Values are **percent of N emitted as N2O-N**. Headers D1/D2 read "No cover crop" / "None of the above", meaning the base scenario.
- 402 data rows (4-405): Corn 176, Soybean 123, Sorghum 84, Canola 19. Both sheets have the same MLRA sets.
- Lookup key: MLRA & Crop.

| Sheet row | Crop | MLRA | IEF_dir D | IEF_Indir D |
|---|---|---|---|---|
| 4 | Canola | 7 | 1.470086 | 0.055716 |
| 56 | Corn | 72 | 1.337752 | 0.160530 |
| 72 | Corn | 103 | 1.217355 | 0.203338 |
| 77 | Corn | 108 | 1.244110 | 0.181934 |
| 310 | Soybean | 108 | 1.271683 | 0.184617 |

### 3.4 CSA (`CSA!A2:AL1175`)

Conservation-practice adjustments, by MLRA and scenario.
- Header rows: 2 = crop (lower case), 3 = FD-CIC ID, 4/15 = scenario code, 5/6 = model cover/tillage codes, 7 = `BAU_FSN`/`SN`, 8 = `stnd`, 10/11/12/13 = the match labels from §2.4.
- 36 value columns (C..AL; 9 per crop).
- Five 232-row blocks, keyed by MLRA in column B (see §2.4).
- Missing combinations hold the text `"NA"`. Rows with data, per crop: corn 177 MLRAs, soybean 123, sorghum 84, canola 19.
- The `base` column is 0 in every block.

Example: MLRA 103 (Story, IA), corn columns.

| Block | base | ccR | NTRT | NTRT_ccR | RT | RT_ccR | ccGraze | RT_ccGraze | NTRT_ccGraze |
|---|---|---|---|---|---|---|---|---|---|
| SOC g CO2e/bu (row 77) | 0 | 856.03 | 2384.0 | 3499.9 | 391.18 | 1286.4 | 910.6 | 1029.9 | 3128.8 |
| dir N2O Δ (row 309) | 0 | −0.00673 | −0.01292 | −0.0354 | −0.01536 | −0.01862 | 0.03361 | 0.01661 | −0.00216 |
| indir N2O Δ (row 541) | 0 | −0.13547 | −0.08786 | −0.24425 | −0.01912 | −0.15673 | −0.14425 | −0.11856 | −0.19695 |
| fuel Δ (row 1005) | 0 | 0.14662 | −0.35268 | −0.20606 | −0.19253 | −0.04591 | 0.13885 | −0.05368 | −0.21383 |

Other example SOC rows (g CO2e/bu, before the sign flip):
- MLRA 108, soybean NTRT_ccR = 7930.2
- MLRA 72, sorghum NTIT_ccR = 4831.7
- MLRA 56A, canola RT_ccR = 4799.0
- MLRA 2, corn ccR = 989.6

### 3.5 NI_Impact (`NI_Impact!A2:AL1175`)

- Same block layout and MLRA rows as CSA. The column order differs (base, ccR, ccGraze, NTRT, ...) but the formulas match on header text, so order does not matter.
- Values are the fractional change in N2O from applying a nitrification inhibitor to 100% of synthetic N. They are applied as `1 + C33 × value`.
- Only rows 248-479 (direct) and 480-711 (indirect) are used. The other blocks are populated but unused; the fuel block is all zeros.
- `"NA"` cells: 4,725 in the direct block, with the same per-crop coverage as CSA.
- The formulas reference up to column DX, but data ends at AL.

| MLRA | Crop / practice | dir (rows 248-479) | indir (rows 480-711) |
|---|---|---|---|
| 103 | corn base | −0.14665 | −0.13422 |
| 103 | corn NTRT | −0.17526 | −0.14821 |
| 108 | corn RT_ccGraze | −0.20172 | −0.12856 |
| 108 | soybean base | **+0.06868** | −0.06296 |
| 56A | canola RT_ccR | −0.25472 | −0.16747 |

Note that some soybean "base" NI effects are **positive**: the inhibitor increases N2O.

### 3.6 Parameters (`Parameters!A1:J57`)

See §4. The per-crop block `B49:E54` is the key table:

| Row | canola | corn | sorghum | soybean |
|---|---|---|---|---|
| 50 Bushel weight (lb/bu) | 50 | 56 | 56 | 60 |
| 51 Moisture (%) | 8.5 | 15.5 | 14 | 13 |
| 52 Dry matter content | 45.75 | 47.32 | 48.16 | 52.2 |
| 53 Default NUI (formula) | 2.581882 | 0.837026 | 0.991294 | 0.110098 |
| 54 USDA assumed NUI threshold | 2.8424 | 0.9774 | 1.1585 | 0.0988 |

Rows 50-52 are **not used** by any formula.

### 3.7 Inputs for Natl Est Avg (`'Inputs for Natl Est Avg'!A2:F52`)

- Default national input values by crop (columns B Corn, C Soybean, D Sorghum, E Canola): farm size, yield, diesel, gasoline, natural gas, LPG, electricity, seven N products, P, K, lime, herbicide, insecticide, sulfur, fungicide.
- **Only** these cells feed the score, through `Parameters!B53:E53` → C21 → C23:
  - row 10 (yield);
  - `F10 = E10/Parameters!B50` (canola yield lb→bu);
  - row 51 (`=SUM(B20:B26)`, total N).
- Everything else is documentation of how the hard-coded national constants were derived. Row 52 ("NUE for National Estimated Average") repeats the same ratio.

Examples:

| Input | Corn | Soybean | Sorghum | Canola |
|---|---|---|---|---|
| Yield | 186 bu | 53 bu | 72.6 bu | 2033.88 lb (40.68 bu) |
| Total N, row 51 (lb N/ac) | 155.687 | 5.835 | 71.968 | 105.025 |
| Diesel, row 13 (gal/ac) | 7.222 | 3.684 | 3.840 | 3.031 |

### 3.8 State_County (`State_County!A1:AY255`)

A legacy state-by-column county list (51 columns, 3,193 cells). It is **not referenced** by any formula, defined name, or validation in the workbook.

---

## 4. Parameters and constants

| Name(s) | Cell | Value | Meaning / where used |
|---|---|---|---|
| `g_to_lb`, `lb2g` | Parameters!B3 | 453.592 | g per lb. C45, C79, C80. |
| `btu_to_MJ`, `MJ2btu` | B4 | 947.817 | Btu/MJ. Unused. |
| `tonne2lb` | B5 | 4.535925E-4 | tonne/lb. Unused. |
| `kg_to_lb`, `kg2lb` | B6 | 0.4535925 | kg/lb. Unused. |
| `lb2bu_CanCorn` | B7 | 56 | lb/bu. Unused. |
| `L_to_gal` | B8 | 3.78541 | Unused. |
| `acre2hectare` | B9 | 2.47105 | acre/ha. Unused. |
| `kg2g`, `MJ2kJ`, `kWh2kJ`, `GJ2kJ` | B10..B13 | 1000 / 1000 / 3600 / 1e6 | Unused. |
| `ton2g` | B14 | 907184.74 | Unused. |
| `NG_density` | B15 | 22 g/ft3 | Unused. |
| `N2O_N_to_N2O` | B16 | 1.571428571 | 44/28. C79, C80. |
| `CO2_C_to_CO2` | B17 | 3.666667 | Unused. |
| `Urea_N_to_CO2` | B18 | 1.571428571 | Unused. |
| `Cornfarming_Ninbiomass_residue` | B21 | 141.6 | Corn residue N, g N/bu. C79/C80 via INDIRECT. |
| `Cornfarming_biomass_N2O_factor` / `_direct_` / `_indirect_` | B22 / C22 / D22 | 0.01264 / 0.01 / 0.00264 | Residue N2O-N factors. Not used by the formulas; they reproduce the national constants. |
| `Soybeanfarming_Ninbiomass_residue` | B24 | 557 | Soybean residue N, g N/bu. C79/C80. |
| `Soybeanfarming_Nfixation_N2O_factor` | B25 | 7.3 | g N2O/bu from N fixation. C79 (soybean only). |
| `Soybeanfarming_biomass_*` | B26/C26/D26 | 0.01264/0.01/0.00264 | Unused. |
| `Nfertilizer_N2O_factor_US_soybean` | B27 | 0.01374 | Unused. |
| `Soybeanfarming_Nfixation_N2O_N_factor` | B28 | 4.6454545 | g N2O-N/bu. Unused. |
| `Canolafarming_Ninbiomass_residue` | B30 | 503.85494 | Canola residue N, g N/bu (D30 = 10.077 g/wet lb). C79/C80. |
| `Canolafarming_biomass_*` | B31/C31/D31 | 0.01264/0.01/0.00264 | Unused. |
| `Nfertilizer_N2O_factor_US_canola` | B32 | 0.01374 | Unused. |
| `Sorghumfarming_Ninbiomass_residue` | B34 | 149 | Sorghum residue N, g N/bu. C79/C80. |
| `Sorghumfarming_biomass_*` | B35/C35/D35 | 0.01264/0.01/0.00264 | Unused. |
| `Nfertilizer_N2O_factor_US_sorghum` | B36 | 0.01374 | Unused. |
| `Nfertilizer_direct_N2O_factor_US(_corn)` | C38 | 0.01 | National direct EF. Not referenced by formulas; reproduces the national constants. |
| `Nfertilizer_indirect_N2O_factor_US(_corn)` | C39 | 0.00374 | National indirect EF. Same as above. |
| `Nfertilizer_N2O_factor_US_corn` | C40 | 0.01374 | Total EF. Unused. |
| `CO2_GWP` / `CH4_GWP` / `N2O_GWP` / `Biogenic_CH4_GWP` | B43 / B44 / B45 / B46 | 1 / 30 / 265 / 28 | IPCC AR5. Only N2O_GWP is used (C79, C80). |
| Default NUI | B53:E53 | see §3.6 | C21 → C23 |
| NUE / NUI threshold | B54:E54 | 2.8424 / 0.9774 / 1.1585 / 0.0988 | C27 → C23, C70, C84 |
| Likely max N content (lb N/unit) | B56:J57 | Swine S 20, Beef S 40, Dairy S 21, Poultry S 94, Swine L 69, Beef L 96, Dairy L 32, Poultry L 115, None 0 | **VBA warning only** (§6). Not in any formula. |
| Yield upper bound | 'USDA Helper Sheet'!J3 | 1.2 | C16 clamp |
| Yield lower bound | 'USDA Helper Sheet'!J4 | 0.8 | C16 clamp |
| `MaxFields` | 'USDA Helper Sheet'!J22 | 10 | OFFSET to column M (national average) |
| `USDAOldFieldRange` | 'USDA Helper Sheet'!J1 | `=COUNTA('Crop Inputs'!C8:OFFSET('Crop Inputs'!C8,0,16000))` = 10 | VBA UI only |

`Soybean_yield`, `Canola_yield`, `Spring_wheat_yield` and `Winter_wheat_yield` all point to `'Inputs for Natl Est Avg'!$E$7` (farm size = 1000). They are inherited GREET names and unused.

---

## 5. Inputs that do not affect the score, and hidden/fixed inputs

**Informational only (not referenced by any scoring formula):**

| Cell | Input |
|---|---|
| C3 | Date. Validation: ≥ 46188, i.e. 2026-06-15. |
| C9 | MU name |
| C13 | MU size (acres) |
| C17 | Total production; empty, no formula |
| C36 / C39 / C42 | Manure **type**. Only amount × N content matter, but VBA uses the type to validate input. |
| C46 | Amendment N in lb |
| C24, C87 | Duplicate FIPS |
| C89:C92 | Practice echo rows |

`C5` (number of MUs) only shows or hides columns D..L through VBA and the hidden helper D67.

**Hidden / fixed inputs:**
- **C58** (hidden row 58) is fixed at "None of the above". Its list validation is `"Spring only,Split in-season,None of the above"`, which is **N-fertilizer timing**.
- **C59** (hidden row 59) is fixed at "None used". VBA strings show the old option list `"None used,Nitrification inhibitor"`, so this was the earlier yes/no **inhibitor** practice. It has been replaced by the C33 fraction.
- Both cells are part of the practice-column key `crop&cover&tillage&C58&C59`. Rows 12 and 13 of CSA and NI_Impact contain **only** "None of the above" / "None used" in all 36 columns. Choosing "Spring only", "Split in-season" or "Nitrification inhibitor" would therefore match no column and turn soil carbon, both N2O terms, and energy into `#N/A`. In v1.2 these practices are effectively disabled.
- VBA strings also show the old combination rules:
  - "Spring Only is not valid with Cover Crop enabled when modeling Corn"
  - "Nitrification inhibitor is not allowed when using Split in-season…"
  - "Spring Only and Split in-season are not valid when modeling Soybeans"
  - "Spring Only is not valid when modeling Sorghum"
- **Rows 49-56** (hidden): a legacy "soil amendment" block, with types C49/C53 = "None" and amounts = 0. C50×C51 and C54×C55 are still summed into C45. VBA references "Changed Soil Amount" and "No Soil amendment Type Selected".

---

## 6. VBA (`xl/vbaProject.bin`, read with a strings dump only; nothing executed)

These findings come from printable fragments of the compressed module source, so they are partial.

**Nothing found in VBA changes the arithmetic.** Each recognized routine either drives the UI or edits inputs:

- `Worksheet_Change` on Crop Inputs (module `USDAInterface`):
  - when C5 changes, it calls `RefreshPage`, which shows or hides MU columns, and then `Application.Calculate`;
  - when a state (row 10) changes, it sets the county to "None";
  - when the field count increases, it copies the state and county into newly shown columns.
- Input validation, which reverts a bad entry and shows a message box:
  - a manure amount or N content entered with type "None" is rejected;
  - a manure amount or N content must be > 0 when a type is selected;
  - N content is compared with `Parameters!B56:J57` ("The specified N content lies outside the probable bounds…"). This is only a warning.
- Warning text: "The USDA FD-CIC does not have sufficient data to calculate a CI score for this combination of crop, state, and county", shown as "Invalid Crop and Region Selection".
- `ResetAllFields` and `ResetField1Inputs`..`ResetField10Inputs` (Reset buttons). They use `FormulaR1C1`, presumably to restore defaults. The exact cells written could not be read from strings.
- `Print_Out` / `PrintPreview` (print area `B1:M99`); `GoToInstructions`, `GoToGlossary`, `GoToNContent`, `GoToCropInputs`; `Workbook_Open` (its body was not recoverable from strings); `RemoveValidations`, `ManageComments`.

**Legacy code from GREET-derived tools** (sheet names that do not exist in this workbook):
- `wb2.Worksheets("Parameters").Range("Nfertilizer_N2O_factor_US").Value = wb1.Worksheets("Inputs")...`
- `...Range("Sugarcanefarming_Ninbiomass_residue")...`
- writes to `"Intermediate"`, `"Results_DomesticCrops"`, `"Multi-year Inputs"`, plus `Jump_to_sugarcane_*` / `canadian_corn_*` routines.

These would need a second, external GREET workbook (`wb1`). `Nfertilizer_N2O_factor_US` is not even a defined name in this file. I found no sign that they are wired to buttons or to `Workbook_Open`, but strings alone cannot prove that.

---

## 7. Re-implementation checklist (C#)

Build these in order:

1. **Reference data loaders**, as immutable, versioned tables with a `"FD-CIC 1.2"` tag:
   1. `FipsTable` (FIPS, County, State, MLRA as string). Lookup key = (State, County), case-insensitive.
   2. `IefTable` (Crop, MLRA) → (DirectPct, IndirectPct) from IEF_dir and IEF_Indir, rows 4-405.
   3. `PracticeTable` from CSA: (MLRA, crop, cover, tillage) → SocGPerBu, DirN2OFrac, IndN2OFrac, FuelFrac (blocks 16, 248, 480, 944). The text `"NA"` maps to *missing*.
   4. `NiImpactTable` from NI_Impact: (MLRA, crop, cover, tillage) → NiDirFrac, NiIndFrac (blocks 248, 480).
   5. `NationalAverages[crop]`: 8 components from `'USDA Helper Sheet'!B4:B41`.
   6. `CropParams[crop]`: DefaultNui (or derive it from the Natl Est Avg N total and yield), NuiThreshold, ResidueN_gPerBu, and the soybean N-fixation 7.3 g N2O/bu.
   7. Constants: 453.592 g/lb, 44/28, GWP_N2O = 265, yield band 0.8 / 1.2.
2. `ResolveMlra(state, county)`.
3. `YieldForCi(actual, expected)` (clamp). Guard against expected = 0.
4. `Nui(synN, yieldForCi)` and `NueAdjustment(crop)` = DefaultNui / Threshold.
5. `PracticeKey(crop, cover, tillage)`. Fix timing = "None of the above" and NI flag = "None used", and reject other values (Excel would return #N/A).
6. `NFertilizer()`, `SoilCarbon()`, `DirectN2O()`, `IndirectN2O()`, `OnFarmEnergy()`, `OtherChemicals()`, `UreaLime()`, following §2.14 exactly. Keep the term grouping (NI applies only to synthetic N; the soybean fixation term sits outside the practice factor).
7. `TotalCi()`, `NationalAverageCi(crop)`, `PercentChange()`, `AbsoluteChange()`.
8. **Error semantics.** Return a typed "insufficient data" result wherever Excel would show `#N/A`, `#VALUE!` or `#DIV/0!`:
   - an MLRA with no row for the crop;
   - a `"NA"` table cell (even when NI = 0);
   - yield = 0;
   - corn in MLRA 77D: CSA has it but IEF does not.
9. Use `double` throughout, without intermediate rounding. Compare with Excel at a tolerance of about 1e-9 relative.

### Suggested Excel-vs-port test cases (1 MU each)

The "predicted" columns were computed from the formulas above by a scratch script that read the dumped tables. They are **not Excel output**; the point of the test is to confirm them in Excel.

| # | Crop | State / County (MLRA) | Actual / Expected yield → yield for CI | Syn N lb/ac | Cover crop | Tillage | NI fraction | Manure (amount × lb N) | Exercises |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Corn | IA / Story (103) | 200 / 190 → 200 (in band) | 180 | No cover crop | **No till** | **0.5** | none | no-till SOC and fuel, inhibitor at 50% |
| 2 | Corn | IL / McLean (108) | 140 / 200 → **160 (low clamp)** | 170 | **Cover crop with grazing** | Reduced till | 0 | **Swine liquid 5 × 30 + Beef solid 10 × 12** (270 lb N) | grazing cover, low clamp, liquid + solid manure |
| 3 | Soybean | IL / McLean (108) | 75 / 55 → **66 (high clamp)** | 10 | Cover crop | No till | 0 | none | soybean branch (N fixation), high clamp |
| 4 | Sorghum | KS / Finney (72) | 80 / 80 → 80 | 90 | Cover crop | No till (NTIT) | 0.25 | Dairy liquid 4 × 25 | sorghum NTIT column, partial NI, manure |
| 5 | Canola | ND / Cass (56A) | 40 / 45 → 40 | 100 | Cover crop | Reduced till | 0.5 | Poultry solid 2 × 60 | canola branch and small MLRA coverage |

Predicted outputs (g CO2e/bu):

| # | N fert C70 | SOC C72 | Dir N2O C79 | Indir N2O C80 | Energy C82 | Other chem C83 | Urea/lime C84 | **CI C68** | Natl M68 | % C98 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1173.97 | −2383.97 | 2304.64 | 359.38 | 623.82 | 474.55 | 518.36 | **3070.75** | 6019.55 | −48.99% |
| 2 | 1385.93 | −1395.66 | 6460.72 | 746.66 | 797.15 | 474.55 | 557.33 | **9026.69** | 6019.55 | +49.96% |
| 3 | 257.17 | −7930.21 | 6321.42 | 351.87 | 1098.04 | 1064.76 | 47.28 | **1210.34** | 7682.15 | −84.25% |
| 4 | 1466.24 | −4831.67 | 5951.53 | 152.56 | 628.59 | 595.14 | 269.58 | **4231.98** | 6429.27 | −34.18% |
| 5 | 2715.03 | −4798.95 | 17478.51 | 843.61 | 796.58 | 1036.39 | 979.93 | **19051.10** | 15530.31 | +22.67% |

Additional sanity cases worth running:
- **Corn in a county whose MLRA is 77D.** Expect `#N/A` (missing IEF).
- **Any crop with county "None".** Expect `#N/A`.
- **Corn in Story with national-like inputs** (yield 186/186, N 155.687, no practices, NI 0). The predicted CI is 5646.40, which is **not** equal to the national 6019.55, because C70/C84 scale by NUI/threshold and the N2O terms use the local IEF and C23.

---

## 8. Open questions / ambiguities

1. **License.** No Argonne notice text was found in the workbook (only the USDA "AS IS" disclaimer, `Disclaimer!C13:C14`). The images, the User Guide PDF, and the GREET license that covers the GREET-derived constants and VBA all need legal review.
2. **NUE scaling basis.** N fertilizer (C70) and urea (C84) scale the national value by `NUI / threshold` (C27), not `NUI / default NUI` (C21). So a grower at exactly the national NUI scores about 14% below the national N-fertilizer emissions (corn factor 0.856). C23 (= default/threshold) also scales the synthetic and manure N2O terms. Is this the intended "threshold credit"? The workbook does not explain it.
3. **Manure is multiplied by C23** and gets the full IEF. It is excluded from the upstream N-fertilizer and urea terms, and manure type is ignored. Confirm this is intended.
4. **SOC per bushel.** SOC (C72) is a per-bushel value from CSA rows 16-247. It does not use the grower's yield. The per-acre block (rows 712-943), which would allow dividing by actual yield, is unused. Confirm the per-bushel table is authoritative.
5. **NI on soybean can raise N2O** (positive NI_Impact values, e.g. MLRA 108 soybean base +0.069). Data or intent?
6. **Hidden fixed inputs C58/C59.** If USDA later enables fertilizer timing or a binary inhibitor flag, the tables will need new columns; v1.2 has none (rows 12/13 are uniform).
7. **Data gaps.**
   - Corn MLRA 77D is in CSA/NI_Impact but missing from IEF_dir/IEF_Indir, so the tool errors for those counties.
   - 172 counties can't be scored for corn, 553 for soybean, 1,224 for sorghum and 2,907 for canola (their MLRA has no data).
   - The VBA warning covers some of these cases, but how the warning is triggered was not readable from strings.
8. **Formula ranges.** Some formulas look at more columns than the tables fill: NI_Impact up to DX, and CSA INDEX up to AV while the MATCH header stops at AR or AV. Harmless today, but if USDA adds columns these ranges could misalign.
9. **`Workbook_Open` and the Reset macros.** Their full bodies could not be recovered from `strings`. If certainty is needed that no macro writes to Parameters or the Helper tables when the workbook opens, decompile the VBA in a sandbox (still without running it).
10. **National-average provenance.** These constants are hard-coded (Helper B4:B41):
    - N-fertilizer upstream,
    - on-farm energy,
    - other chemicals,
    - urea,
    - lime.

    The default inputs on "Inputs for Natl Est Avg" document where they came from. They presumably came from GREET 2025, but the conversion cannot be reproduced from this workbook. Only the direct and indirect N2O national values were re-derived (§2.14).
11. **Rounding / display.** Cell number formats were not examined. The port should compare unrounded values, and confirm the precision of any number reported to customers against the format the Crop Inputs sheet displays.
12. **Expected yield = 0** produces `#DIV/0!` (the clamp collapses to 0). The data validation on C15 only enforces ≥ 0, so the port should require expected > 0.
