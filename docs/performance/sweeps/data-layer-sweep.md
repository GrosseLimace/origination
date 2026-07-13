# Data Layer Performance Sweep — Grain Originator Portal

Date: 2026-07-12
Scope: `api/GrainOriginatorPortal.Infrastructure` (DbContexts + Repositories), `api/GrainOriginatorPortal.Api/Services` (sync/background jobs), `client/src` (aggregation cross-reference), `docs/performance/customer-trade-unit-map.md`. Read-only research — no files modified.

---

## 1. DbContext inventory

### 1.1 `OriginationDbContext` (read-only ODS, Azure SQL Hyperscale)
File: `api/GrainOriginatorPortal.Infrastructure/Data/OriginationDbContext.cs`

| DbSet | Backing object | Key | Notable config |
|---|---|---|---|
| `CustomerTradeUnits` | `originations.vw_CustomerTradeUnits` (view) | none (`HasNoKey`) | `ScoularId` mapped to column `SourceCustomerId` (ODS never renamed; app DB did in migration `20260430164629`). This is the view flagged as slow in the stale perf doc — see §5. |
| `Contracts` | `base.vw_CurrentContracts` (view) | `Id`→`ContractId` | CHAR-padded ODS columns trimmed via `HasConversion` (`CtrmCustomerId`, `SourceContractId`, `ContractNumber`). `HasIndex(ContractNumber)`, `HasIndex(CustomerId)` declared in EF model — **these are metadata only; they do nothing against a view the app doesn't own** (no CREATE INDEX runs). `HedgeMarketMonthDescription`/`PriceMarketMonthDescription` ignored (not in view; filled by a side query — see ContractRepository §2.1). |
| `Tickets` | `base.vw_CurrentTickets` (view) | `Id`→`TicketId` | Same CHAR-pad trimming pattern. FK to `Contract` declared with `DeleteBehavior.NoAction`. Many columns `Ignore()`d (not present in view: `Moisture`, `TestWeight`, `ProteinPercent`, `FarmId`, weights, etc.) — these come from `TicketQuality`. |
| `TicketQualities` | `base.vw_TicketQuality` (view) | `TicketId` | Simple. |
| `ContractPricingLines` | `base.vw_ContractPricing` (view) | none | `FreightAdjustment` ignored — enriched from a second view (below). |
| `ContractPriceFreightAdjustments` | `base.ContractPrice` (view) | none | Minimal read-only projection just for `FreightAdjustment`. |
| `Elevators` | `ctrm.vw_GNP026` (view) | none | Elevator master; `Latitude`/`Longitude` ignored (not present). |
| `Location` (no DbSet property, `Set<Location>()` used ad hoc) | `ctrm.vw_GNP003` (view) | none | Fallback location lookup keyed on `Location_Code`. |
| `CommodityConversions` | `ctrm.vw_GNP024` (view) | none | Unit conversion table. |
| `StoredGrain`, `StorageCommodity` | none (keyless SqlQueryRaw result types) | n/a | Never mapped to a table/view — pure DTOs for raw SQL. |

Disabled/dead DbSets (commented out): `Farm`, `PlantingIntention` (ODS copy), `StoredGrain` proper table, `SavedList` — all superseded by ApplicationDbContext equivalents.

### 1.2 `ApplicationDbContext` (app-owned, read/write, full schema control)
File: `api/GrainOriginatorPortal.Infrastructure/Data/ApplicationDbContext.cs` — 27 DbSets, all `schema: "dbo"`. Full index inventory (45 `HasIndex` calls total):

- **Customer domain**: `Customer` (PK `CustomerId`=ODS id, `ValueGeneratedNever`; `IX_Customer_CustomerName`, `IX_Customer_ScoularId`), `CustomerTradeUnit` (unique `(CustomerId,TradeUnit)`, plus covering index `IX_CustomerTradeUnit_TradeUnit_IsActive` explicitly built for the `WHERE TradeUnit IN (...) AND IsActive=1` scope query), `CustomerLink` (unique `(FromCustomerId,ToCustomerId)` + reverse index), `CustomerCommodity` (unique `(CustomerId,CommodityId)` + reverse index), `ProducerGrainOnFarm` (unique `(CustomerId,CommodityGroup)`).
- **User content**: `Note` (`IX_Notes_CustomerId`, FK NoAction to preserve notes on customer soft-delete), `ProducerDetails` (unique `CustomerId`, 1:1), `PlantingIntention`/`ProducerPlantingIntentions` (`IX_..._CustomerId`, `IX_..._TradeUnit` composite with `PlantingYear`).
- **Dashboard***: `DashboardPlantingEstimates` (unique `TradeUnitKey+Crop+PlantingYear`), `DashboardMarketShares` (unique `TradeUnitKey+CropCategory+PlantingYear`), `DashboardActualHarvests` (non-unique `TradeUnitKey+PlantingYear`).
- **SavedLists, ESignEnrollment** (unique `CustomerCode`), **Commodities** (unique `Code`).
- **BidSheet***: `BidSheetLocations` (`IX_..._TradeUnitCode`), `BidSheetLocationBids` (unique `(LocationId,CommodityCode,CropYear,Month)`), `BidSheetLocationOrders`/`BidSheetPreferences` (unique per `(UserId,TradeUnitKey)`).
- **Usage/telemetry**: `UserActivity`, `UserClickEvent`, `UserSession` (computed column `DurationMinutes` via `DATEDIFF`), `UserActivityDaily` (unique `UserId+ActivityDate`), `FeatureUsageDaily` (unique `ActivityDate+FeatureCode+SubFeatureCode`), `WeeklyLoginAggregate` (unique `WeekStartDate+UserId`), `UserTradeUnitSnapshot` (composite PK `(UserId,TradeUnitCode)`).
- **QueryLibrary/QuerySearchLog, DailyRecapGroup*** (cascade-deleted children).

**27 migrations** exist (`api/GrainOriginatorPortal.Infrastructure/Data/Migrations/`), spanning 2026-03-10 → 2026-07-01. Notable ones for perf/architecture history:
- `20260430164629_RenameSourceCustomerIdToScoularId` — renamed app column but ODS view (`SourceCustomerId`) wasn't touched (external), hence the `HasColumnName` remap in §1.1.
- `20260513152851_CreateCustomerAndCustomerTradeUnit` + `20260513185441_DropCustomerSnapshot` + `20260513195804_AddCustomerFkAndCustomerLink` + `20260513203133_DropRedundantCustomerColumns` — a multi-step migration series that normalized a prior denormalized "CustomerSnapshot" shape into `Customer`+`CustomerTradeUnit`, i.e., **this app already built the app-owned materialized read model that `docs/performance/customer-trade-unit-map.md` proposed building in ODS** (see §5).
- `20260617162219_AddCustomerTradeUnitAuditColumns`, `20260604150610_AddUserDeactivatedToCustomerTradeUnit` — audit/soft-delete refinements on the sync table.

### 1.3 `EntitlementsDbContext` (third context — not mentioned in the task brief)
File: `api/GrainOriginatorPortal.Infrastructure/Data/EntitlementsDbContext.cs` — single keyless view mapping, `dbo.vw_UserTradeUnitAccess`. Read-only, no migrations. Worth flagging to the team: any "two DbContexts" mental model of this codebase is incomplete; there are three, and `EntitlementsRepository` also injects `OriginationDbContext` directly (see §2.6).

### 1.4 `FieldTagDbContext` — ignored per instructions (local-dev-only SQLite POC, unrelated to ODS/perf).

---

## 2. Repository-by-repository query shape findings

Impact legend: HIGH / MED / LOW. "ODS-dependent" = breaks or needs remapping if the GraphQL-over-DB2 POC displaces ODS. "Source-agnostic" = app-owned tables only, portable regardless of ODS's fate.

### 2.1 ContractRepository.cs
- `GetAsync` (L24-126) and `GetByCropYearAsync` (L208-255): two-path strategy — resolve producer `ScoularId`s from `dbo.Customer`/`dbo.CustomerTradeUnit` (app DB, indexed), then `FromSqlInterpolated` a raw query against `base.vw_CurrentContracts`/`base.Contract` joined via `INNER JOIN STRING_SPLIT(csv,',')` to avoid the 2100-parameter IN-clause limit. **HIGH impact, ODS-dependent**: `_context.Database.SetCommandTimeout(300)` at L31 with an explicit comment that this "can run well over the default 30s on larger environments" — a known-slow query already mitigated only by a longer timeout, not a real fix. `SELECT c.*` (L60, L98, L230) is a wide-view all-columns projection.
- `GetByCustomerAsync` (L128-168), `GetHistoricalForPacingAsync` (L170-206): per-customer scoped, `CtrmCustomerId == scoularId` predicate — sargable equality, fast path. LOW-MED, ODS-dependent.
- `EnrichWithHedgeMarketMonthAsync` (L412-443): a **side query per contract batch** against `base.Contract` via `STRING_SPLIT` + `SqlQueryRaw`, wrapped in try/catch that silently swallows failures — masks perf/availability issues from telemetry. MED impact, quick fix (narrow the catch, log at ERROR not WARNING-and-forget) — ODS-dependent.
- `EnrichFreightAdjustmentAsync` (L317-332): batched (not per-row) lookup against `ContractPriceFreightAdjustments`, correct pattern, LOW impact.
- Good design note: no cross-view SQL joins — the app resolves customer scope from its own DB first, then does a single targeted ODS query. This avoids the "join across ODS views without supporting indexes" anti-pattern structurally.

### 2.2 TicketRepository.cs
- `LoadTicketsByContractAndCustomerScopeAsync` (L399-510): **the single most heavily-annotated query in the codebase** — `_context.Database.SetCommandTimeout(300)` (L414) with a comment stating the bulk TU-wide scan "can run 2-3+ minutes" against the ~2M-row `vw_CurrentTickets` because `ContractNumber` "can't seek." Two `UNION ALL` branches (not `UNION`, deliberately avoiding a wasted dedup step — good), each an `INNER JOIN STRING_SPLIT(...)`. **HIGH impact, ODS-dependent, redesign-level** (comment literally says "A local synced ticket table is the durable fix" — the team has already identified this).
- `GetTodaysAsync` (L143-209): explicit optimization comment describing how the old code "scanned the 2M-row view (couldn't seek)" and was rewritten to only hit the CustomerCode-indexed branch, cutting minutes to <2s, and skips quality/elevator enrichment entirely for the same reason. This is a genuinely well-documented, already-executed perf fix — cite as a positive pattern.
- `GetByCustomerAsync` (L211-316): `string.Compare(t.Date, cutoff) >= 0` (L267) — **string-based date comparison** on `TicketBlDate` (stored as string in ODS), relies on ISO `yyyy-MM-dd` lexicographic ordering. Correct today but fragile/non-portable (a DB2/GraphQL source with a real date type would need this rewritten) and non-sargable unless the underlying column supports range seeks as a string. MED impact, ODS-dependent.
- `GetActiveStorageCommoditiesAsync` (L689-726): raw SQL against `ctrm.vw_GNTA39D1` with `s.REPORT_RUN_STAMP = (SELECT MAX(REPORT_RUN_STAMP) FROM ctrm.vw_GNTA39D1)` — a **scalar subquery re-scanning the same view** for its own MAX every call; `REPORT_RUN_STAMP` is exactly the kind of change-detection column that would key a synced/materialized copy (see §3). HIGH impact, ODS-dependent.
- `PopulateElevatorLocations` (L590-679): two batched (not per-ticket) lookups against `Elevators`/`Location`, correct non-N+1 pattern; try/catch swallows failures silently (MED, masks issues).
- Prefix filters throughout (`LIKE 'U%'`/`'L%'`/`'C%'` via `StartsWith`) are correctly sargable; the file explicitly calls out (in comments) that it previously used non-sargable `LEFT(col,1) IN (...)` and rewrote to sargable `LIKE` — another already-fixed issue, good pattern to note.

### 2.3 CustomerRepository.cs
- `SearchAsync` (L72-164) — **highest-risk cluster in the app, all source-agnostic** (`dbo.Customer`/`dbo.ProducerDetails`):
  - L130-136: `LIKE '%'+@w+'%'` across `CustomerName`, `ScoularId`, `MerchandisingCity`, plus a correlated subquery on `ProducerDetails.PrimaryContact`, ANDed per search word. HIGH impact as row counts grow — classic leading-wildcard non-sargable scan, multiplied by word count.
  - L106-107, L124-125 (`StripPhone`): 5x nested `REPLACE(...)` wrapping phone columns then a leading-wildcard `LIKE` — textbook function-wraps-column anti-pattern; mitigated somewhat by a `digits.Length >= 3` gate but still HIGH impact when triggered.
  - L141: `SELECT c.*` on `dbo.Customer` — LOW impact today (app-owned, not currently wide), but an anti-pattern to fix before the table grows.
- `SearchOdsAsync` (L166-234) — **ODS-dependent, HIGH impact**: `TOP 50 ... ORDER BY` correctly paired, explicit column list (good), but `LEFT(c.CustomerName,1) NOT IN ('*','$')` (L184) and `NOT LIKE '%DUP%'`/`'%DO NOT USE%'` (L182-183) are both non-sargable against a live `base.vw_CurrentCustomers` view the app doesn't control indexing on — and the actual type-ahead search (L191-195, per-word leading-wildcard `LIKE`) runs directly against that same live ODS view with no supporting text index. This is a type-ahead/autocomplete endpoint hitting an uncached ODS view per keystroke-driven request — likely the most expensive per-request query pattern in the codebase.
- `GetOpenActivityTradeUnitsAsync` (L674-723) — **ODS-dependent, HIGH impact**: `_context.Database.SetCommandTimeout(120)` (L697) immediately before a Tickets query using the same `string.Compare(t.Date, cutoff)` pattern as TicketRepository §2.2. Positive note: resolves Contracts and Tickets as two independent ODS queries merged via C# `HashSet`, avoiding an ODS-side cross-view join.
- `GetOdsCustomerRowAsync` (L789-805): `TOP 1` with **no `ORDER BY`** — non-deterministic if the view can ever produce >1 row per `CustomerId`. LOW impact, quick fix (add explicit `ORDER BY`) if duplicates are possible.
- `GetLinkedToAsync` (L433-501): 5 sequential (not looped) round trips, source-agnostic; chatty but not N+1. LOW impact, quick win available (combine 2-3 queries) but not urgent.

### 2.4 DashboardRepository.cs — all source-agnostic, no ODS
- Clean batch-upsert pattern throughout `UpsertPlantingEstimatesAsync`/`UpsertMarketSharesAsync`/`UpsertActualHarvestAsync`: one `ToDictionaryAsync` load, in-memory reconcile loop, one `SaveChangesAsync` — **not** N+1, cite as the target style for other aggregation jobs.
- `DashboardPlantingEstimates`/`DashboardMarketShares`/`DashboardActualHarvests` are written via **user/form-driven upserts** (every method takes a `username` param, stamps `CreatedBy`/`ModifiedBy`), not an ODS ETL job — despite superficially looking like ODS-derived aggregates, no sync/background-job write path was found feeding these tables from ODS in either this file or `CustomerRepository.cs`. If a reconciliation against ODS actuals is expected, its write path lives elsewhere (not found in this sweep) — worth a follow-up grep for `DashboardActualHarvest` writers outside this repository.

### 2.5 BidSheetRepository.cs — app-owned only, source-agnostic
- `ReconcileDuplicateBidInsertsAsync` (L390-412): genuine **N+1** — loops over inserted bids issuing one `FirstOrDefaultAsync` per item to resolve a unique-constraint race. LOW impact (rare path, small batches), quick fix (batch-load candidates by `(LocationId,CropYear,Month)` once).
- `GetAllLocationsAsync` (L42-49): `.Include(Bids)` with no filter/paging — loads every location + every bid across all trade units. LOW/MED, grows with bid history; quick fix is scoping by trade unit or paging.
- `GetBidCropYearsAsync`/`GetBidCommoditiesAsync`/`GetBidMonthsAsync` (L271-302): three near-identical `Distinct().OrderBy()` queries that could be combined into one round trip. MED, quick tweak.
- No SELECT *, no raw SQL, no non-sargable predicates otherwise.

### 2.6 EntitlementsRepository.cs / EntitlementsDbContext — flagged HIGH for perf-security overlap
- All 5 methods are simple sargable filtered reads. **But `GetCustomerTradeUnitCodesAsync` (L54-62) queries `_odsContext.CustomerTradeUnits` — i.e., the same `originations.vw_CustomerTradeUnits` view flagged as the 12-14s bottleneck in the stale perf doc — filtered by a single `CustomerId`, per call, live against ODS.**
- Its only caller, `UserEntitlementService.ValidateCustomerAccessAsync` (`api/GrainOriginatorPortal.Api/Services/UserEntitlementService.cs:120-139`), is a per-customer **authorization check** ("Look up customer's trade unit(s) from the live ODS view" — comment at L122) that is designed to run on every customer-scoped request. **However, `grep` across the whole API found zero callers of `ValidateCustomerAccessAsync` outside its own unit test** — it is currently dead/unwired code. This is worth flagging prominently: (a) if/when this method gets wired into a controller or authorization filter, it will reintroduce a per-request hit to the exact slow ODS view the `dbo.Customer`/`dbo.CustomerTradeUnit` sync (§1.2, §5) was built to eliminate; (b) in the meantime, it's dead code with no perf impact today, but also means customer-level access validation via this path isn't actually enforced anywhere the way its doc comment implies. **Impact: HIGH (latent) / none (currently dead). ODS-dependent. Fix: redesign — point this at the synced `dbo.Customer`+`dbo.CustomerTradeUnit` tables instead of the live view, matching how `ContractRepository`/`TicketRepository`/`CustomerRepository` already resolve TU scope.**

### 2.7 UsageRepository.cs
- Three N+1 patterns in daily/weekly aggregation jobs, all source-agnostic (app-owned): `AggregateUserActivityDailyAsync` (L418-419, per-user `FirstOrDefaultAsync` in a loop, MED-HIGH — scales with active-user count), `AggregateFeatureUsageDailyAsync` (L481-484, per feature/subfeature), `AggregateWeeklyLoginsAsync` (L529-530, per-user, weekly cadence lowers urgency). All three should batch-load existing rows before the loop — the exact pattern `ProducerDetailsRepository.GetAllAsync` already does correctly elsewhere in the same codebase (§2.8). Quick tweak, not a redesign.
- `RefreshTradeUnitSnapshotAsync` (L554-585): unparameterized full-table `ExecuteSqlRawAsync("DELETE FROM dbo.UserTradeUnitSnapshot")` then chunked (200/batch) inserts with `ChangeTracker.Clear()` — reasonable, LOW impact.
- `CleanupUsageRetentionAsync` (L587-598): correctly parameterized raw delete (positional `{0}` args, not string interpolation — no injection risk), but no batching (`DELETE TOP (n)` loop) on what could be a large backlog delete — MED risk if the retention job has ever drifted, otherwise LOW.
- All `Aggregate*Async` methods correctly push aggregation to SQL via `GroupBy().Select(Count()/Sum())` — no C#-side re-aggregation of raw rows found in this file, a positive pattern.
- `GetContractDisplayNamesAsync` (L307-317): ODS-dependent (id-list IN against `_odsDb.Contracts`), LOW impact (simple point lookup).

### 2.8 ProducerDetailsRepository.cs — fully source-agnostic
- `GetAllAsync` (L42-104): the **best-practice example in the codebase** — one query for `ProducerDetails`, then three separate batched joins (`CustomerLinks`⋈`Customers`, `CustomerCommodities`⋈`Commodities`, `ProducerGrainOnFarm`) keyed by the full customer-id set, assembled via in-memory `Dictionary` lookups. No per-row query. Cite as the template other aggregation jobs (§2.7) should follow.
- `UpsertAsync` (L106-243): replace-all-children pattern (`RemoveRange`+re-add) for 3 child collections — reasonable for a single-customer upsert, LOW impact.

### 2.9 StoredGrainRepository.cs — heavily ODS-dependent, would need a full rewrite if ODS is displaced
- Core raw SQL (`StoredGrainSql`, L27-88) against `ctrm.vw_GNTA39D1`/`ctrm.vw_GNP003`:
  - L50: `AND REPORT_RUN_STAMP = (SELECT MAX(REPORT_RUN_STAMP) FROM ctrm.vw_GNTA39D1)` — same scalar-subquery-recomputes-MAX pattern as TicketRepository §2.2's storage-commodity query. HIGH impact, and `REPORT_RUN_STAMP` is again the natural sync/change-detection key.
  - L85-86: `LEFT JOIN ... ON LTRIM(RTRIM(loc.Location_Code)) = LTRIM(RTRIM(sg.LOCATION_CODE))` — **non-sargable join predicate**, function-wraps both sides, defeats any index on either column. HIGH impact if `vw_GNP003` isn't tiny.
  - Window function (`ROW_NUMBER() OVER (PARTITION BY ... ORDER BY CASE ...)`) for dedup is a reasonable pattern by itself but compounds with the above two issues into a likely full-scan query.
- `GetAsync` (L90-129): broad try/catch swallows all exceptions to `[]` — masks timeouts as "no data," hiding perf problems from monitoring.
- Positive notes: explicit column lists (no SELECT *), `STRING_SPLIT` fed via a single sanitized `SqlParameter` (not concatenation) — safe pattern consistent with the rest of the codebase.

### 2.10 CustomerSyncRepository.cs (drives the sync job in §5)
- `LoadOdsTradeUnitRowsAsync` (L21-22): **unfiltered full-table pull** of `originations.vw_CustomerTradeUnits` every sync run, no incremental/timestamp filter. HIGH impact if the view is as heavy as its own doc claims (12-14s) — though since this already runs off the request path on a schedule (§5), the impact is to sync-job duration/DB load, not user-facing latency.
- `LoadCurrentCustomerMasterAsync` (L30-51): raw `SqlQueryRaw` against `base.vw_CurrentCustomers`, own comment states "~20s even for a single id"; `SetCommandTimeout(120)` — explicit column list, safely parameterized `STRING_SPLIT`. HIGH impact, ODS-dependent, redesign-level (this view is apparently a top offender independent of the CustomerTradeUnits view — worth cross-referencing against whatever the "Perf findings doc" the user's memory references tracks, to confirm it's not already known).

### 2.11 PlantingIntentionRepository.cs
- `GetAsync` (L22-68): 3 sequential round trips when a TU filter is present (ODS Contracts query → app Customers query → main PlantingIntentions query) — structural, not fixable as a single query because Azure SQL has no cross-database joins between the ODS and app databases (a constraint the codebase itself notes elsewhere). MED impact only if proven hot; redesign-level if so.

### 2.12 CommodityRepository.cs
- `SyncAsync` (L53-139): full re-scan of ODS `Contracts`/`Tickets` (`Distinct()` over `Select`) every run, no run-stamp/timestamp incremental filter — same missing-change-detection-key issue as §2.10. MED impact if run frequently (need to confirm schedule); the in-memory diff/backfill logic afterward operates on small (tens of rows) commodity-code sets, so that part is fine as C#.

### 2.13 SavedListRepository.cs
- `GetByTradeUnitsAsync` (L29-51): `TradeUnits` is a denormalized CSV column — the method pulls all active saved lists with non-null `TradeUnits` into memory and does CSV-split + `HashSet.Contains` matching in C#, acknowledged in-code as deliberately deferred ("per-TU volume is small"). MED long-term risk, redesign (normalize into a join table) if volume grows. Source-agnostic.

### 2.14 NoteRepository.cs
- `GetAsync` (L20-58): no paging/`Take` on the notes list at all (`OrderByDescending(CreatedAt)` then full materialize). LOW today, MED long-term; quick fix (add paging) when it becomes visible. Source-agnostic, sargable TU filter via correlated EXISTS.

### 2.15 Everything else (DailyRecapGroupRepository, FarmRepository, DisplayNameLookupRepository, QueryLibraryRepository, UserPreferenceRepository)
- No significant findings. `FarmRepository` is entirely a stub (Farms table doesn't exist in ODS — all methods return empty/no-op, dead-weight scaffolding). `DisplayNameLookupRepository`'s in-memory nested loop is O(small×small), not a DB concern.

---

## 3. App-owned read-model opportunities (source-agnostic, portable if ODS → GraphQL/DB2 swap happens)

The single biggest opportunity has **already been substantially built**: `dbo.Customer` + `dbo.CustomerTradeUnit`, synced nightly (see §5) from `originations.vw_CustomerTradeUnits`, and now used as the primary scope-resolution path by `ContractRepository`, `TicketRepository`, `CustomerRepository`, `PlantingIntentionRepository`, and `StoredGrainRepository`. Remaining gaps and additional candidates:

1. **`base.vw_CurrentTickets` (~2M rows) — no synced copy exists.** Every "give me tickets for these customers/contracts" call still hits the live ODS view via `STRING_SPLIT` joins, with the codebase's own comments flatly stating "A local synced ticket table is the durable fix" (TicketRepository.cs, §2.2). This is the highest-value redesign candidate in the whole sweep. Natural sync key: `TicketId` (PK-like), change-detection candidates: none of the mapped columns look like a modified-timestamp — would need either a full nightly re-sync (mirroring the Customer sync pattern) or an ODS-side `ModifiedDate`/run-stamp column to do incremental sync (not present in the current EF mapping — worth asking the ODS team if `base.Ticket` has one that isn't exposed via the view).
2. **`ctrm.vw_GNTA39D1` (customer storage) — `REPORT_RUN_STAMP` is a ready-made change-detection column**, used twice (TicketRepository's `GetActiveStorageCommoditiesAsync`, StoredGrainRepository's `StoredGrainSql`) but never leveraged for sync — each call recomputes `MAX(REPORT_RUN_STAMP)` itself. A synced app-owned table keyed on `(CustomerCode, CommodityCode, REPORT_RUN_STAMP)`, refreshed whenever the run stamp advances, would eliminate both the repeated MAX-subquery and the non-sargable `LTRIM(RTRIM())` joins in one move.
3. **`base.vw_CurrentCustomers`** — already synced into `dbo.Customer` for attribute data, but `CustomerSyncRepository.LoadCurrentCustomerMasterAsync` and its ~20s-per-call cost suggest this view is independently expensive; confirm the nightly sync is the only caller (it appears to be) so this isn't also being hit live elsewhere.
4. **Elevator/Location masters (`ctrm.vw_GNP026`, `ctrm.vw_GNP003`)** — small reference data, queried repeatedly (every ticket-location lookup) with no sync; `ElevatorCache` (`dbo.ElevatorCache`, app-owned, already exists per ApplicationDbContext §1.2!) suggests this exact pattern was already solved for elevators — worth checking whether `ElevatorCache` is actually populated/used by `TicketRepository.PopulateElevatorLocations` (it currently queries the live ODS `Elevator`/`Location` entities directly, not `ElevatorCache` — possible missed wiring, follow-up worth a grep of `ElevatorCache` usage).
5. **`ctrm.vw_GNP024` (commodity conversions)** — tiny, low-cardinality reference data; low priority but a candidate for the same cache pattern if hit frequently.

---

## 4. Client-side aggregation opportunities (cross-referenced from `client/src`)

The client fetches raw contract/ticket/customer arrays and aggregates in the browser in many places — these are candidates for server-side `GROUP BY` endpoints or indexed views instead of shipping full row sets:

- `dashboard.component.ts:1185-1187` — total acres, active contract count, total contract value via reduce/filter over full customer/contract arrays.
- `dashboard.component.ts:812-833` — nested `Map<month, Map<crop, bushels>>` build for a monthly crop chart.
- `dashboard.component.ts:292-333` — multiple `.reduce()` calls summing acres and acres×yield across planting intentions.
- `dashboard.component.ts:1204` — grand-total sum of a crop map for percentage-of-total.
- `activity-summary.component.ts:262,299` — manual group-by (reduce into accumulator objects) of planting intentions and stored grain by crop.
- `activity-summary.component.ts:343-344` — average moisture/test-weight computed client-side across ticket arrays.
- `tickets-table.component.ts:233-238` — avg date, total net weight, avg moisture/test-weight/protein computed client-side.
- `insights.component.ts:121,406,557` — quantity sums and nested category→subgroup Map group-bys for insight tiles.
- `customer-profile.component.ts:390-394` — filters full ticket/contract arrays for tab-badge counts.
- `customer-profile.component.ts:513-526` — reduces commodity rows for total contracted quantity / projected yield KPI tile.
- `build-list.component.ts:2539,2564` — per-customer contract-list reduce to totalQty, at two call sites.
- `unshipped-bushels.component.ts:106,108` — sums totalOpenBushels/contract counts across filtered groups.
- `stored-grain-table.component.ts:106-115` — reduces receipts to totalBushels/totalCost per commodity group, then a grand total.
- `customer-print-report.component.ts:221-257,456-473` — recomputes total contract/stored-grain quantity, planting acres, ticket-weight/quality averages entirely client-side for the print report.
- `contracts-table.component.ts:489,540,561` — sums `priceQuantity` across contract lines for row/summary totals.

The dashboard feature and the customer-detail feature (`activity-summary`, `tickets-table`, `customer-profile`, `customer-print-report`) carry the bulk of this — all doing manual reduce/Map grouping over raw API arrays rather than server-side aggregation. Given these already pull from ODS-derived data the API materializes today, pushing these into `GROUP BY` endpoints would also reduce the payload size shipped to the client, independent of any ODS/DB2 migration.

---

## 5. `docs/performance/customer-trade-unit-map.md` — verdict: STALE, superseded

The doc (dated 2026-03-06, "Status: Pending DBA execution") proposes creating an ODS-side table `originations.CustomerTradeUnitMap` + stored proc `usp_RefreshCustomerTradeUnitMap` + nightly SQL Agent job, to replace live queries against `originations.vw_CustomerTradeUnits` (claimed 12-14s per load from a 2M-row `base.Ticket` scan with no usable index).

**Cross-check against current code:**
- **File paths in the doc are stale**: it references `api/GrainOriginatorPortal.Api/Data/OriginationDbContext.cs`, `api/GrainOriginatorPortal.Api/Models/CustomerTradeUnit.cs`, and `api/GrainOriginatorPortal.Api/Services/SqlDataService.cs`. None of these exist at those paths today — `OriginationDbContext.cs` lives in `api/GrainOriginatorPortal.Infrastructure/Data/`, and no `SqlDataService.cs` exists anywhere in the repo (`find` returned nothing). The project has since been restructured into `Api`/`Infrastructure`/`Api.Tests`.
- **The underlying problem was solved — just app-side instead of ODS-side.** Migrations `20260513152851_CreateCustomerAndCustomerTradeUnit` through `20260513203133_DropRedundantCustomerColumns` created exactly the pre-computed, indexed relationship the doc wanted (`dbo.Customer` + `dbo.CustomerTradeUnit`, with the covering index `IX_CustomerTradeUnit_TradeUnit_IsActive` built for the `WHERE TradeUnit IN (...) AND IsActive=1` scope query — functionally the same shape as the doc's proposed `IX_CustomerTradeUnitMap_TradeUnit`). This is refreshed by `CustomerSyncBackgroundService` → `CustomerSyncService.SyncAsync()`, registered in `Program.cs:114-115`, running on a schedule (60s startup delay, then a recurring `nextRun` computed by `ComputeNextRunUtc` — effectively the same "nightly refresh" concept the doc proposed, just via a .NET `BackgroundService` instead of SQL Agent). `ContractRepository`, `TicketRepository`, `CustomerRepository`, and `PlantingIntentionRepository` all resolve their trade-unit scope from `dbo.Customer`/`dbo.CustomerTradeUnit` today, **not** from `originations.vw_CustomerTradeUnits` directly, in their primary/bulk paths.
- **However, the raw ODS view is not fully retired**: `CustomerSyncRepository.LoadOdsTradeUnitRowsAsync` still does the full unfiltered pull from `originations.vw_CustomerTradeUnits` as the sync source (expected — it's the input to the sync), and **`EntitlementsRepository.GetCustomerTradeUnitCodesAsync` still queries the live view per customer-id call** (§2.6) — currently dead code (no live caller), but if wired up would reintroduce exactly the bottleneck this doc describes.
- **Conclusion**: the doc should be marked superseded/closed, not "pending DBA execution" — the DBA-owned ODS-table approach it proposed was never built, but an equivalent (arguably better, since it doesn't require ODS write permissions the team doesn't have) app-owned solution was. Recommend updating or archiving the doc with a pointer to the `Customer`/`CustomerTradeUnit` migrations and `CustomerSyncService`, and flagging `EntitlementsRepository.GetCustomerTradeUnitCodesAsync`/`ValidateCustomerAccessAsync` as the one loose thread that could reopen the original problem if ever wired into the request path.

---

## 6. Hand-written SQL inventory

**Raw SQL / Dapper usage** — no Dapper anywhere in the codebase; all raw SQL goes through EF Core's `FromSqlInterpolated`/`FromSqlRaw`/`SqlQueryRaw`/`ExecuteSqlRawAsync`. Files touching raw SQL:
- `ContractRepository.cs` — `FromSqlInterpolated` (contracts bulk queries), `SqlQueryRaw` (hedge-market-month enrichment).
- `TicketRepository.cs` — `FromSqlInterpolated` (ticket bulk/scope queries), `SqlQueryRaw` (storage-commodity gate).
- `StoredGrainRepository.cs` — `SqlQueryRaw` (core stored-grain query against `ctrm.vw_GNTA39D1`/`vw_GNP003`).
- `CustomerRepository.cs` — raw SQL for search (`SearchAsync`, `SearchOdsAsync`) and `GetOdsCustomerRowAsync`.
- `CustomerSyncRepository.cs` — `SqlQueryRaw` against `base.vw_CurrentCustomers`.
- `UsageRepository.cs` — `ExecuteSqlRawAsync` (full-table snapshot delete, parameterized retention cleanup delete).
- `Data/Entities/StorageCommodity.cs`, `Abstractions/CurrentCustomerRow.cs` — keyless DTOs used only as `SqlQueryRaw<T>` result types, not queries themselves.
- `Controllers/DiagnosticsController.cs` — appeared in the raw-SQL grep; not audited in this sweep (dev-only diagnostics surface, out of the Infrastructure-project scope the task emphasized) — flagged for a follow-up look if diagnostics endpoints are ever exposed beyond dev.

**Standalone `.sql` files** (not part of EF migrations, found via `find *.sql`):
- `migrate-bid-sheet.sql`, `scripts/_VerifySchema.sql`, `scripts/qa-setup.sql`, `scripts/backfill-migration-history.sql`, `SECURITY-REVIEWS/scripts/B4_migrate_createdby.sql`
- `api/GrainOriginatorPortal.Api/Scripts/PopulateCommodities.sql`, `DropEstimatedYield_ProducerPlantingIntentions.sql`, `CreateSavedListsTable.sql`, `CreateProducerDetailsTable.sql`, `AddTypeToPlantingIntentions.sql`, `AddLinkedProducerIds_ProducerDetails.sql`, `AddFilters_SavedLists.sql`
These look like pre-EF-migration or one-off ops scripts (several duplicate what later became proper EF migrations, e.g. `CreateSavedListsTable.sql` vs. the SavedList entity now in `ApplicationDbContext`) — worth a housekeeping pass to confirm they're historical/already-applied and not a second, divergent source of schema truth. Not independently audited for SQL-injection risk in this pass (no evidence any are invoked at runtime — they read as one-off DBA/ops scripts, not embedded resources).

**Security note (informational, not the focus of this sweep):** every raw-SQL call site found across all 15+ repository files uses either EF's `FromSqlInterpolated` (auto-parameterizes interpolated values) or explicit `SqlParameter`/positional-arg parameterization — no string-concatenated SQL text was found. `SqlSanitization.SanitizeCsv`/`SanitizeIdentifierCsv` provide defense-in-depth allowlist filtering before values are even passed as parameters into `STRING_SPLIT`. No `SELECT *` was found in any raw SQL string (all explicit column lists) — the `c.*`/`t.*` shorthand seen in ContractRepository (§2.1) is against EF-mapped view entities, not raw SQL, but still a wide-view-projection concern worth the same fix (explicit columns) for the reasons noted there.

---

## 7. Top-line priority list (cross-file)

| # | Location | Finding | Impact | ODS-dependent | Fix |
|---|---|---|---|---|---|
| 1 | TicketRepository.cs `LoadTicketsByContractAndCustomerScopeAsync` | 2M-row `vw_CurrentTickets` scan, 300s timeout, "durable fix" already identified in-code as a synced ticket table | HIGH | Yes | Redesign — build a synced app-owned ticket table (§3.1) |
| 2 | CustomerSyncRepository.cs `LoadCurrentCustomerMasterAsync` | `vw_CurrentCustomers` ~20s/call even for 1 row | HIGH | Yes | Redesign / confirm no other live callers |
| 3 | StoredGrainRepository.cs L50 + TicketRepository.cs `GetActiveStorageCommoditiesAsync` | Repeated `MAX(REPORT_RUN_STAMP)` subquery + non-sargable `LTRIM(RTRIM())` join against `vw_GNTA39D1`/`vw_GNP003` | HIGH | Yes | Redesign — sync keyed on `REPORT_RUN_STAMP` (§3.2) |
| 4 | CustomerRepository.cs `SearchOdsAsync` | Per-word leading-wildcard `LIKE` + `LEFT(col,1)`/`NOT LIKE '%..%'` directly against live `vw_CurrentCustomers`, type-ahead-driven | HIGH | Yes | Redesign (full-text index if ODS-side, or route through synced Customer table) |
| 5 | CustomerRepository.cs `SearchAsync` | Leading-wildcard LIKE across 5 columns/subquery, 5x nested REPLACE phone-strip | HIGH | No | Redesign (full-text/trigram index, precomputed digits-only column) |
| 6 | EntitlementsRepository.cs `GetCustomerTradeUnitCodesAsync` / `UserEntitlementService.ValidateCustomerAccessAsync` | Live hit to the exact slow `vw_CustomerTradeUnits` view the sync table was built to replace — currently unwired/dead, but latent | HIGH (latent) | Yes | Redesign — point at `dbo.Customer`/`dbo.CustomerTradeUnit` before this is ever wired in |
| 7 | UsageRepository.cs (3 methods) | N+1 `FirstOrDefaultAsync`-in-loop in daily/feature/weekly aggregation jobs | MED-HIGH | No | Quick — batch-load before the loop (pattern already used correctly in ProducerDetailsRepository) |
| 8 | ContractRepository.cs `GetAsync`/`GetByCropYearAsync` | 300s timeout on ODS bulk contract query, `SELECT c.*` | HIGH | Yes | Partially mitigated by app-owned scope resolution already; remaining cost is inherent to the view |
| 9 | CustomerRepository.cs / CustomerRepository.cs `GetOpenActivityTradeUnitsAsync` | 120s timeout, string-based date comparison on ODS Tickets | HIGH | Yes | Redesign if/when ODS column types can change |
| 10 | docs/performance/customer-trade-unit-map.md | Entire doc stale — proposed fix already implemented differently | N/A | — | Archive/update doc, point at `CustomerSyncService` |
| 11 | client/src dashboard + customer-detail features | ~15 sites doing client-side reduce/group-by over full API row sets | MED | No | Add `GROUP BY` endpoints for dashboard/summary tiles |
| 12 | SavedListRepository.cs, NoteRepository.cs | Denormalized CSV column scan; unpaged note history | LOW-MED (scale-dependent) | No | Redesign (normalize) / quick (add paging) |
| 13 | BidSheetRepository.cs `ReconcileDuplicateBidInsertsAsync` | N+1 on rare unique-constraint race path | LOW | No | Quick — batch-load candidates |
| 14 | CommodityRepository.cs / CustomerSyncRepository.cs sync jobs | No incremental/timestamp change-detection key — full re-scan every run | MED (frequency-dependent) | Yes | Redesign if run frequently |

---

## Positive patterns worth preserving/replicating
- `ProducerDetailsRepository.GetAllAsync` — batched multi-join assembly via in-memory dictionaries, zero N+1.
- `UsageRepository`'s `Aggregate*Async` methods — SQL-side `GroupBy`/`Sum`, no C#-side re-aggregation of raw rows.
- Consistent parameterization discipline: every raw-SQL call site uses `SqlParameter`/EF interpolation, never string concatenation; `SqlSanitization.SanitizeCsv`/`SanitizeIdentifierCsv` as a shared allowlist layer before `STRING_SPLIT`.
- `TicketRepository.GetTodaysAsync` and the sargable-prefix rewrite (`LIKE 'X%'` instead of `LEFT(col,1) IN (...)`) — both are documented, already-executed perf fixes with before/after commentary in the code; good models for how to record future fixes.
- The `dbo.Customer`/`dbo.CustomerTradeUnit` sync itself (§5) — a real, working example of displacing a slow ODS view with an app-owned materialized/synced table, which is directly relevant to evaluating the future GraphQL-over-DB2 migration: it demonstrates the team already has a proven pattern (soft-delete upsert sync via a `BackgroundService`) for the exact class of problem that migration will need repeated for Tickets and Storage.
