# DP Contracts

Delayed-pricing (DP) contract positions: grain a producer has delivered against a DP contract that is
still accruing storage-style charges. Presented as a **DP Contracts** tab on the producer page,
immediately to the right of **Storage**, and deliberately built to mirror Storage.

## Source

| | |
| --- | --- |
| ODS view | `ctrm.vw_GNTA70D1` (base tables `ctrm.GNTA70D1`, `stg.GNTA70D1`) |
| Grain | One row per ticket line — ticket prefix/number/suffix + sequence, per trade unit |
| Liveness filter | Latest `Report_Run_Stamp` snapshot **and** `Net_Quantity > 0` |
| Dedupe | `ROW_NUMBER()` over the natural key, ordered by `Report_Line`, keeping row 1 |

Every column in the view is CHAR-padded and declared `NOT NULL`, so trimming is mandatory and
`ISNULL` is pointless — an absent value arrives as blanks or a floor date, never as `NULL`.

## Where DP reads come from (updated 2026-08-13)

**Every environment reads its own ODS.** There is no cross-environment override anywhere; DP behaves
exactly like every other ODS-backed feature, and running locally prompts for no extra sign-in.

| Environment | DP reads from | State |
| --- | --- | --- |
| Local (`appsettings.Development.json`) | Dev ODS (`ODSConnection`) | Tab shows its empty state until the Dev ODS loads the view. |
| Deployed Dev | Dev ODS | Same — waiting on ODS data. |
| QA | QA ODS | Same — waiting on ODS data. |
| Prod | Prod ODS | Has data; the tab is populated. |

`ctrm.vw_GNTA70D1` is still **empty in Dev and QA** (`ctrm`, `stg`, and the view itself all return 0
rows). That is a *data* gap, not a config gap: when ODS loads the view, the tab populates on its own
with **no code or config change**. Treat all four environments as identically wired.

### The override (opt-in, local only)

DP reads go through `DpOdsDbContext`
(`api/GrainOriginatorPortal.Infrastructure/Data/DpOdsDbContext.cs`), which inherits all ODS mappings
from `OriginationDbContext` and differs *only* in which connection string it binds:
`ConnectionStrings:ODSDpConnection`, falling back to `ODSConnection` when absent. Since the key is
absent everywhere, the two contexts are currently equivalent.

The key is kept — commented out in `appsettings.Development.json` — as an escape hatch for validating
displayed values against prod, the only environment with data. Enabling it locally is safe because
every DP path is strictly read-only (`DpContractRepository` has no insert, update, or delete), and it
uses `Authentication=Active Directory Interactive` so *only* that connection prompts for a prod-admin
account while the other four stay on your normal account. **Never set it in a deployed environment** —
it would also require IT/DBA to grant that App Service's managed identity read access to another
environment's ODS, which is deliberately not in place.

Caveat that applies only while the override is enabled: DP rows come from prod while producer identity
still comes from the **local** app DB (`dbo.Customer`), because the customer-code → `CustomerId` join
happens in C# (Azure SQL has no cross-database joins). A prod producer with no matching `ScoularId`
locally resolves to `CustomerId` 0 and is filtered out — the safe direction to fail, since it omits a
position rather than attributing it to the wrong producer.

To retire the mechanism entirely: point `DpContractRepository` back at `OriginationDbContext`, remove
the `AddDbContext<DpOdsDbContext>` registration in `Infrastructure/DependencyInjection.cs`, delete
`DpOdsDbContext.cs`, and drop the `protected OriginationDbContext(DbContextOptions)` constructor added
for it.

## Two deliberate divergences from Storage

**1. Location comes from the trade unit, resolved in C#.** Storage joins `ctrm.vw_GNP026` inside its
ODS query on `Elevator_Code` + `Location_Code`. `vw_GNTA70D1` has *neither* column — only
`Company_Code`, `Division_Code`, and `Trade_Unit_Code`. A trade unit code **is** a bare `LocationId` in
`dbo.MbpLocationSynonym` (e.g. `"2115"` → `"Adrian, MO"`), which is the same bridge the trade-unit
selector uses, so location is resolved through `IMbpLocationSynonymRepository` after the query.
Because that table lives in the app DB it cannot be joined in SQL. `DisplayName` is already the full
`"City, ST"` string, so the model carries a single `LocationName` rather than Storage's city/state
pair. Unmatched trade units render `—`; there is deliberately no `Division_Code` fallback, since a
division can span several towns and would risk showing the wrong place.

**2. Bushels are nullable, and null means "show nothing".** The view reports quantity in whatever
`Quantity_Uom` says — a `char(2)` CTRM code. Conversion is `DpBushelConversion.ToBushels`:

| `Quantity_Uom` | Result |
| --- | --- |
| `BU` | quantity as-is (no factor needed, so it works even for commodities missing from `vw_GNP024`) |
| `LB` | `quantity / LbsPerUnit` |
| `CW` | `quantity * 100 / LbsPerUnit` |
| `TN` | `quantity * 2000 / LbsPerUnit` |
| blank, unrecognized, or no conversion factor | **`null`** |

Factors come from `ctrm.vw_GNP024` (`CommodityConversion.LbsPerUnit` = pounds per bushel).

`null` must render as `—` and be **excluded** from group totals. It must never fall back to the raw
`quantity`, which could be in pounds and therefore wrong by ~56×. Group headers disclose an
`N without bushel conversion` count so a total is never read as complete when it isn't. Do not add a
"close enough" fallback.

Dates get the same treatment via `DpBushelConversion.NullIfSentinel`: the view's `NOT NULL` date
columns report "no date" as a floor value (`0001-01-01` from the AS/400, `1900-01-01` from the ODS
load), which would otherwise render as `1/1/01`.

## Files

| Layer | Path |
| --- | --- |
| Entity | `api/GrainOriginatorPortal.Infrastructure/Data/Entities/DpContract.cs` (keyless, `SqlQueryRaw` result type — no `DbSet`) |
| Conversion helper | `api/GrainOriginatorPortal.Infrastructure/Data/DpBushelConversion.cs` (pure static, unit-tested) |
| Context | `api/GrainOriginatorPortal.Infrastructure/Data/DpOdsDbContext.cs` |
| Repository | `api/GrainOriginatorPortal.Infrastructure/Repositories/DpContractRepository.cs` |
| Service | `api/GrainOriginatorPortal.Api/Services/DpContractService.cs` |
| DTO / mapper | `Models/Responses/DpContractResponse.cs`, `Services/Mappings/DpContractMappings.cs` |
| Controller | `api/GrainOriginatorPortal.Api/Controllers/DpContractsController.cs` |
| Client model | `client/src/app/models/dp-contract.model.ts` |
| Tab component | `client/src/app/features/customers/components/dp-contracts-table/` |
| Tests | `api/.../Services/DpContractTests.cs`, `client/.../dp-contracts-table.component.spec.ts` |

## Endpoints

- `GET /api/dpcontracts?tradeUnits=A,B` — entitlement-scoped list. Resolves the requested trade units
  to producers and then loads **all** of their DP positions (cross-TU), matching Storage's semantics
  that the scope is producers, not rows. Fails closed with `503 ENTITLEMENTS_DB_UNAVAILABLE` when
  entitlements can't be read, rather than returning unauthorized rows (CWE-285).
- `GET /api/dpcontracts/customer/{customerId}` — single producer. Deliberately **not**
  entitlement-scoped: trade-unit entitlements are a UX default, not an access boundary (same rule as
  Storage).

Both fail soft at the repository layer (log + return `[]`), and the two enrichment passes degrade
independently: a `MbpLocationSynonym` outage costs the location cell, a `vw_GNP024` outage costs the
bushel figures, neither costs the tab.

## Reference row (real prod data, provided 2026-08-04)

Useful for sanity-checking the mapping. One row, field by field:

```
Report_Run_Date      2026-05-05      Report_Run_Time      2216
Report_Line          319             Report_Mode          D / DAILY
Company_Code         20              Division_Code        20
Trade_Unit_Code      1340            Contract_Cmdy_Code   P
Ticket_Prefix        H               Ticket_Number        370145        Ticket_Suffix  (blank)
Bol_Date             2025-08-19      Sequence_Number      316657104
Contract_Prefix_Type P               Contract_Prefix_Cmdy C
Contract_Number      PL84649         Contract_Suffix      A
Commodity_Code       YC              Ticket_Status        U/L
Customer_Id          ABCFARM          Gross/Net_Quantity   812.50 / 812.50   Quantity_Uom  BU
Storage_Program_Code D25             Storage_Days         259           Decide_Free_Days  0
Storage_Rate         0.300000        Status               2 / "INITIAL CHARGE 2 - CHARGE/BU/D"
Initial_Storage_Date 2025-08-19      Paid_Thru_Date       2025-08-19
Charged_From_Date    2025-08-19      Charged_Thru_Date    2025-12-31
Unpaid_Handling_Amt  0.00            Receivable_Amount    243.75
Prepaid_Amount       0.00            Unearned_Storage_Amt 0.00          Currency_Code  USD
```

Confirmed by this row:

- **`Quantity_Uom` = `BU`** — the bushel pass-through is the live path; the LB/CW/TN conversions are a
  guard, not the norm.
- **Arithmetic is coherent:** `812.50 bu × $0.300 = $243.75` = `Receivable_Amount`, so the Rate,
  Storage Amount, and derived Cents/Bu (30.0¢) columns all reconcile. Note the rate behaves as a flat
  charge per bushel here despite the "CHARGE/BU/D" wording — it is **not** multiplied by
  `Storage_Days` (259).
- **`Storage_Days`** is days from `Initial_Storage_Date` to the report run date (2025-08-19 → 2026-05-05
  ≈ 259), *not* the `Charged_From`→`Charged_Thru` span (~134 days).
- **`Status` is a numbered charge stage**, not Storage's `S`/`F`/`D` state codes — which is why the
  liveness filter here is `Net_Quantity > 0` on the latest snapshot rather than a status allow-list.
- **`Customer_Id` is alphanumeric** (`ABCFARM`), which `SanitizeCsv` preserves.
- **`Contract_Number` carries its own letters** (`PL84649`), so `Contract_Prefix_Type` +
  `Contract_Prefix_Cmdy` are **not** prepended — that produced a double-prefixed "PC PL84649". They
  are exposed as separate fields instead.

## Open questions

- **⚠ `Status` = charge stage — does one ticket get MULTIPLE rows?** "INITIAL CHARGE **2**" implies
  numbered stages. The `ROW_NUMBER()` partition therefore **includes `Status`**, so distinct charge
  stages survive dedupe (silently dropping a charge row would understate what a producer owes). If a
  ticket does carry several stages in one snapshot, two things need a decision: whether the tab should
  show one row per stage, and whether `Receivable_Amount` is **incremental** (safe to sum, as the group
  total currently does) or **cumulative** (summing would double-count). **This is the highest-value
  thing to confirm.**
- **`Report_Mode`** is `D`/`DAILY` in the sample. If a single `Report_Run_Stamp` can also contain
  another mode (e.g. monthly), an explicit `Report_Mode = 'D'` filter would be cheaper and clearer than
  relying on the window function.
- **Snapshot freshness.** The sample's `Report_Run_Stamp` is 2026-05-06, three months before it was
  supplied. `MAX(Report_Run_Stamp)` always takes the newest available run, so this is correct either
  way — but if the report genuinely stopped running in May, the tab will show stale positions.
- **Row volume.** Storage is excluded from dashboard recalculation because 100k+ rows arriving late
  cause an expensive recompute (`dashboard.component.ts`). If DP is comparably large it should follow
  the same exclusion.
- **Unapplied-ticket overlap.** Storage unload tickets are gated out of the Unapplied Tickets count
  once priced out (`GateCustomerStorageTickets`, keyed on `C`-prefix contracts). The sample's
  `Ticket_Status` is `U/L` and `Contract_Prefix_Type` is `P`, so DP deliveries may well also be sitting
  in the Unapplied Tickets tab — meaning one delivery could appear in both places. `ContractPrefixType`
  and `TicketStatus` are carried on the model specifically so this can be assessed without a schema
  change.
