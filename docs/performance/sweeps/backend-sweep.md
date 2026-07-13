# Backend Performance Sweep — GrainOriginatorPortal.Api

Scope: full controller → service → repository trace for every endpoint in `api/GrainOriginatorPortal.Api` and
`api/GrainOriginatorPortal.Infrastructure`. Excludes deep re-analysis of the four issues already tracked
elsewhere (unfiltered bulk `/api/Contracts` and `/api/Customers`, Notes call sites dropping `tradeUnits`,
`SELECT c.*` 75-column contract query, proposed local synced ticket table) — those are noted only where a
**new** aspect surfaced.

---

## Endpoint inventory

| Endpoint | Backing table/view | Filtered? | Paginated? | Projected? | Cached? | Payload size class |
|---|---|---|---|---|---|---|
| GET /api/contracts | `base.vw_CurrentContracts` (raw SQL, STRING_SPLIT join) + side-query `base.Contract` (hedge enrich) | TU-optional (unfiltered = all active producers) | No | No (`SELECT c.*`, full entity) | No | **Large** — thousands of rows × ~40 cols, doubled round-trips |
| GET /api/contracts/customer/{id} | same view, single `CtrmCustomerId` predicate | Yes (1 customer) | No | No | No | Small |
| GET /api/contracts/pacing/{id} | `base.Contract` (raw SQL) | Yes | No | No | No | Small |
| GET /api/contracts/by-crop-year/{yr} | `base.Contract` via STRING_SPLIT | TU-optional | No | No | No | Large (unfiltered) |
| GET /api/contracts/pricing-lines(-by-customer) | `base.vw_ContractPricing` + `base.ContractPrice` enrich | Yes | No | No | No | Small–Med |
| GET /api/customers | `dbo.Customer` + `dbo.CustomerTradeUnit` (app DB) | TU-optional | No | No | No | Large (unfiltered — all active producers) |
| GET /api/customers/search(-ods) | `dbo.Customer` / `base.vw_CurrentCustomers` (raw SQL, leading-wildcard LIKE) | search-term | ODS variant: TOP 50 | Partial (ODS: explicit column list) | No | Small–Med |
| GET /api/customers/{id}/trade-units | `dbo.CustomerTradeUnit` + 2 ODS activity queries | Yes (1 customer) | No | No | No | Small |
| GET /api/tickets | `base.vw_CurrentTickets` (3.8M-row view, UNION ALL raw SQL) + quality + elevator lookups | TU-optional | No | No (explicit col list, not `*`) | No | **Large** — heaviest read path in the app |
| GET /api/tickets/today | same view, unapplied-only fast path | TU-optional | No | No | No | Med (optimized: enrichment skipped) |
| GET /api/tickets/customer/{id} | same view, single customer scope | Yes | No | No | No | Small–Med |
| GET /api/notes | `dbo.Note` + `Include(Customer)` | TU-optional (string CSV) | No | No | No | Med |
| GET /api/planting-intentions | `dbo.PlantingIntention` + `Include(Customer)` + ODS TU resolution | TU-optional | No | No | No | Med |
| GET /api/stored-grain | `ctrm.vw_GNTA39D1` (raw SQL, window function) | TU-optional | No | Explicit cols | No | Med |
| GET /api/dashboard-planting-estimates/* | `dbo.DashboardPlantingEstimate/-MarketShare/-ActualHarvest` (app DB, tiny tables) | Yes (TU+year) | No | No | No | Tiny |
| GET /api/bid-sheet/* | `dbo.BidSheetLocation/-Bid/-Elevator*` (app DB) | Yes (TU) | No | No | No | Small |
| GET /api/commodities, /planting, /conversions, /harvest-windows | `dbo.Commodity*` (app DB) | No (reference data) | No | No | **Yes** (IMemoryCache, 10 min–1 hr) | Tiny |
| GET /api/trade-units | Entitlements `vw_UserTradeUnitAccess` | No (full catalog by design) | No | No | No | Tiny |
| GET /api/user-trade-units | Entitlements `vw_UserTradeUnitAccess` | Yes (current user) | No | No | No | Tiny |
| GET /api/entitlements/catalog | Entitlements `vw_UserTradeUnitAccess` | Yes (caller's TU overlap) | No | No | No | Small |
| GET /api/usage-dashboard/* | `dbo.UserActivity/-Session/-ClickEvent` + daily aggregates | Yes (date range + Admin-only) | No | Mostly projected | No | Med (admin-only, low volume) |
| GET /api/producer-details | `dbo.ProducerDetails` | No (`GetAll` has no TU filter at all) | No | No | No | Small–Med |
| GET /api/saved-lists, /team, /team-members | `dbo.SavedList` (app DB) | Partial | No | No | No | Small |
| GET /api/query-library | `dbo.QueryLibraryItem` | No (reference data) | No | No | **No** (candidate for caching, see below) | Tiny |
| POST /api/geocode/* | Azure Maps (external) | n/a | n/a | n/a | **Yes** (IMemoryCache, 4 hr sliding) | Tiny |
| GET /api/diagnostics/* | `INFORMATION_SCHEMA.*`, ODS/App/Ent contexts | Dev/QA-gated | n/a | n/a | n/a | Tiny (gated out of prod) |

---

## Findings

### 1. `EnrichWithHedgeMarketMonthAsync` doubles every contract fetch's round-trip (NEW)
**File:** `GrainOriginatorPortal.Infrastructure/Repositories/ContractRepository.cs:412-443`
**Impact: HIGH** — every call to `GetAsync`/`GetByCustomerAsync` (i.e. every hit on `/api/contracts` and
`/api/contracts/customer/{id}`) issues a **second** ODS query against `base.Contract` via `STRING_SPLIT` on
every contract ID just materialized, purely to backfill two columns (`HedgeMarketMonthDescription`,
`PriceMarketMonthDescription`) that aren't exposed by `vw_CurrentContracts`. On the unfiltered path this is a
second STRING_SPLIT join over potentially thousands of IDs against an ODS base table, immediately after the
first STRING_SPLIT join against the view — i.e. contracts data is now fetched via **two** heavy joins per
request instead of one. This is on top of (and independent from) the known "unfiltered bulk load" and
"SELECT c.\*" issues. **Fix:** either add the two columns to a view the ODS team maintains (removing the
side-query entirely) or fold the enrichment into the same STRING_SPLIT-joined query (single round trip) —
redesign, not a quick fix, since it depends on ODS view ownership.

### 2. Double DB fetch on every Notes / PlantingIntentions mutation (NEW)
**Files:**
- `GrainOriginatorPortal.Api/Controllers/NotesController.cs:68-116` (TogglePin/Update/Delete each call
  `_service.GetByIdAsync` first)
- `GrainOriginatorPortal.Api/Services/NoteService.cs:91-106` → `NoteRepository.cs:115-172` (Toggle/Update/Delete
  each do their **own** independent `FirstOrDefaultAsync` fetch)
- Same pattern: `PlantingIntentionsController.cs:80-117` → `PlantingIntentionRepository.cs:130-167`

Every PUT/DELETE on a note or planting intention does a 404-check read (`GetByIdAsync`, untracked, with
`Include(Customer)`) and then the mutation method re-fetches the identical row (tracked) to apply the change —
**two round trips where one suffices**. Low per-call cost (single-row PK lookup) but it's the same shape
repeated across every write endpoint in these two controllers, and it compounds with Include-driven customer
joins on every note/intention edit. **Fix:** drop the controller-level pre-check and let the
repository's own mutation method return `null` on not-found (already implemented) — quick fix, no schema/API
change.

### 3. `CustomerService.UpdateAsync` does 2 identical reads around a documented no-op (NEW)
**File:** `GrainOriginatorPortal.Api/Services/CustomerService.cs:55-65`, `CustomerRepository.cs:503-517`
`PUT /api/customers/{id}` calls `GetByIdAsync` (existence check), then `UpdateAsync` (whose repository
implementation is **explicitly a no-op** — "Location / Phone / Email... cannot be written from here" —
it only logs), then calls `GetByIdAsync` **again** to return "refreshed" data that cannot have changed.
**Impact: LOW** (single PK lookup, small table) but pure waste — 2 redundant SELECTs on every call to an
endpoint whose body currently does nothing. **Fix:** quick — either implement the real write path (FarmIds /
LinkedProducerIds move to ProducerDetails per the comment) or collapse to a single existence check + single
return read.

### 4. Background aggregation jobs are N+1 per user/feature per day (NEW)
**File:** `GrainOriginatorPortal.Infrastructure/Repositories/UsageRepository.cs`
- `AggregateUserActivityDailyAsync` (lines 378-457): loops over every distinct active user for the day and
  issues `FirstOrDefaultAsync` against `UserActivityDaily` **inside the loop** (line 418-419) to check
  for an existing row before upsert.
- `AggregateFeatureUsageDailyAsync` (lines 459-509): same shape, one `FirstOrDefaultAsync` per
  (FeatureCode, SubFeatureCode) pair per day (line 481-484).

**Impact: MED** — runs hourly via `UsageAggregationBackgroundService`, off the user request path, so it
doesn't block anyone today, but it scales linearly with active-user-count × feature-count and will get
slower as usage grows; it's also the only place in the repo layer that doesn't follow the
batch-load-into-dictionary pattern `DashboardRepository`'s upserts already use correctly (see
`DashboardRepository.cs:41-43`, `102-104`, `159-161` for the right pattern). **Fix:** quick — load all
existing `UserActivityDaily`/`FeatureUsageDaily` rows for the target date in one query into a dictionary
keyed on (UserId) / (FeatureCode, SubFeatureCode) first, same shape as the Dashboard upserts.

### 5. No DbContext pooling
**File:** `GrainOriginatorPortal.Infrastructure/DependencyInjection.cs:23-82`
All three DbContexts (`OriginationDbContext`, `ApplicationDbContext`, `EntitlementsDbContext`) are registered
with `AddDbContext`, not `AddDbContextPool`. **Impact: LOW–MED** — pooling mainly saves DbContext
construction/DI overhead per request (not connection pooling, which ADO.NET already does independently), so
under load this is a modest CPU/GC win, not a query-latency fix. Worth adopting since none of the three
contexts do anything (like static per-request state) that would make pooling unsafe. **Fix:** quick — swap
`AddDbContext` → `AddDbContextPool` for all three.

### 6. No global `QueryTrackingBehavior.NoTracking` default; reliance on per-call `AsNoTracking()`
117 call sites correctly call `.AsNoTracking()`, but it's opt-in per query rather than a context-level
default (`UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking)` in `OnConfiguring`/`AddDbContext`, with
explicit `.AsTracking()` on the handful of mutation-fetch queries that need it). **Impact: LOW** today (no
missed call sites found in the read-heavy repos), but it's a foot-gun for future contributors — a new read
query that forgets `AsNoTracking()` silently starts tracking full entity graphs on `OriginationDbContext`,
which is documented as read-only. **Fix:** quick, but touches every context registration and requires
auditing the ~15 tracked mutation queries to make sure they still opt in explicitly.

### 7. `CustomerRepository.SearchAsync` — leading-wildcard `LIKE '%word%'` across up to 5 columns per word
**File:** `CustomerRepository.cs:130-137`
Every search word is matched with `LIKE '%word%'` against `CustomerName`, `ScoularId`, phone (with `REPLACE`
chains — non-sargable), `MerchandisingCity`, plus a correlated subquery into `dbo.ProducerDetails` for
`PrimaryContact`. Leading wildcards defeat index seeks; this runs against `dbo.Customer` (app-owned, likely a
few thousand rows) so today's impact is **LOW**, but it will degrade linearly as the producer base grows and
is the most search-heavy query in the app (fires on every keystroke-driven customer search). **Fix:**
redesign if this table grows — full-text index or trigram index would remove the scan; not urgent at
current row counts.

### 8. Reference-data endpoints without caching
- `GET /api/query-library` (`QueryLibraryController.cs:23-28` → `QueryLibraryService`/`QueryLibraryRepository`)
  — active query-library items are slowly-changing reference data (admin-curated), same shape as
  Commodities, but **not** run through the `IMemoryCache` pattern `CommodityService` already established.
- `GET /api/trade-units` (`TradeUnitsController.cs`) and `GET /api/commodities/harvest-windows`'s sibling
  `GET /api/bid-sheet/cropyears|commodities|bidmonths` metadata endpoints — small, low-QPS, but same
  "changes rarely, fetched often" shape.

**Impact: LOW** (all are small result sets against small tables, not the ODS), but it's a quick, consistent
win — the `CommodityService.GetCachedAsync` helper (`CommodityService.cs:44-58`) is already a reusable
cache-aside pattern; the missing endpoints could adopt it directly with a short TTL.

### 9. Elevator/geocoding maintenance endpoints call third-party APIs sequentially in a loop
**File:** `DiagnosticsController.cs:277-396, 450-592`
`RefreshElevatorCache(geocode:true)`, `StartElevatorGeocode`, and `GeocodeByZip` all loop over elevators and
call Nominatim/zippopotam.us **one at a time**, `await Task.Delay(1100ms)` between calls (justified — respecting
third-party rate limits) but fully sequential with no batching/parallelism within the rate limit. **Impact:
LOW** — Dev/QA-only (`DenyIfNotDevelopment()` gate), admin-only, manual/on-demand trigger, not on any user
request path. No action needed beyond what's already documented.

### 10. Async/blocking — clean
No `.Result`, `.Wait()`, or `.GetAwaiter().GetResult()` found anywhere in `Api` or `Infrastructure`. Every
controller action, service method, and repository method threads `CancellationToken` from the HTTP request
down to the final `ToListAsync`/`FirstOrDefaultAsync`/`SaveChangesAsync` call. `DashboardService.GetSummaryAsync`
deliberately awaits 3 repository calls **sequentially** rather than in parallel — this is explicitly commented
as intentional (`DbContext` isn't thread-safe, and the tables are tiny app tables), which is correct reasoning,
not a bug.

### 11. Middleware / pipeline — mostly solid
- Response compression is enabled (`UseResponseCompression()`, gzip) and ordered correctly (before anything
  writes a body) — this is the biggest win already banked for `/api/customers` / `/api/contracts` /
  `/api/tickets` payload size.
- `System.Text.Json` uses runtime reflection-based serialization (no source-generated `JsonSerializerContext`).
  **Impact: LOW** — source-gen mainly helps AOT/trimming and shaves serialization CPU at high RPS; at this
  app's traffic level it's a minor win, not a bottleneck. Worth revisiting only if CPU profiling ever points
  at JSON serialization.
- `JwtBearerEvents.OnAuthenticationFailed` only fires on failed auth (not every request) — no per-request DB
  hit from auth middleware.
- Rate limiter, CORS, security headers, correlation ID — all lightweight, no DB/IO per request.
- `UsageTrackingMiddleware` writes to a bounded, drop-on-full `Channel<T>` (fire-and-forget) — correctly
  decoupled from the request/response path; no DB write happens inline with the request.

### 12. Query shape risks already well-mitigated
STRING_SPLIT is used consistently and correctly (joined to an indexed column, not used to defeat an index);
UNION ALL (not UNION) is used deliberately where branches are mutually exclusive (`TicketRepository.cs:433-481`)
specifically to avoid the dedup step — this is good practice, not a risk. No `OR`-heavy predicates that block
index seeks were found outside the customer search noted in #7. No views-on-views beyond the documented
ODS-owned view chain.

---

## Summary table (highest impact first)

| # | Finding | Impact | Fix effort |
|---|---|---|---|
| 1 | Hedge-market-month side query doubles every contract fetch | HIGH | Redesign (ODS view change or query merge) |
| 2 | Notes/PlantingIntentions double-fetch on every mutation | MED | Quick |
| 4 | Usage aggregation background jobs N+1 per user/feature/day | MED | Quick |
| 7 | Customer search leading-wildcard LIKE across 5 columns | LOW today, grows | Redesign (full-text/trigram) if it grows |
| 3 | CustomerService.UpdateAsync double-reads around a no-op write | LOW | Quick |
| 5 | No DbContext pooling | LOW–MED | Quick |
| 6 | No context-level NoTracking default | LOW | Quick, but needs an audit pass |
| 8 | Query Library / Trade Units reference data not cached | LOW | Quick (reuse existing cache-aside helper) |
| 9 | Sequential 3rd-party geocode loop in diagnostics | LOW (dev/QA only) | No action needed |
