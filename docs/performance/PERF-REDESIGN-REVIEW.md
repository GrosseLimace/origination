# Performance Redesign Review — Broad Architecture Pass

**Status:** Findings & recommendations — no code changes made
**Date:** 2026-07-12
**Scope:** Whole application (API, data layer, Angular client, bundle), redesign-level options explicitly in scope
**Predecessor:** [`API-DATA-LOADING-FINDINGS.md`](API-DATA-LOADING-FINDINGS.md) — this review builds on it and does not repeat its detail
**Method:** Four parallel code sweeps (backend endpoint trace, client data-flow, data-layer/schema, app-flow docs digest), independent spot-verification of every HIGH claim cited below, and two live measurements: a production bundle build and a **full dev-session HAR capture** (949 entries, 427 API calls, analyzed 2026-07-13 — see [Section 3.1](#31--measured-one-dev-session-har-2026-07-13)). Dev SQL measurements for the serving-layer design remain **pending** — see [Section 12](#12--measurement--validation-plan).

---

## Table of Contents

- [1 — Executive summary](#1--executive-summary)
- [2 — Evidence legend](#2--evidence-legend)
- [3 — The core architectural problem](#3--the-core-architectural-problem)
- [4 — Flagship redesign: an app-owned serving layer](#4--flagship-redesign-an-app-owned-serving-layer)
- [5 — Server-side query & aggregation API](#5--server-side-query--aggregation-api)
- [6 — Server-side response caching](#6--server-side-response-caching)
- [7 — Client data-orchestration fixes](#7--client-data-orchestration-fixes)
- [8 — Rendering & bundle](#8--rendering--bundle)
- [9 — Backend quick wins](#9--backend-quick-wins)
- [10 — SQL / index opportunities](#10--sql--index-opportunities)
- [11 — Housekeeping & corrections](#11--housekeeping--corrections)
- [12 — Measurement & validation plan](#12--measurement--validation-plan)
- [13 — Prioritized roadmap](#13--prioritized-roadmap)

---

## 1 — Executive summary

The app's performance profile is dominated by one architectural decision: **on login and on every trade-unit change, the client downloads trade-unit-wide (sometimes company-wide) datasets into browser memory, and nearly every screen then searches, filters, and aggregates those arrays client-side.** Contracts (~115K rows client-side), notes (~28.8K), customers (~16.7K), tickets, stored grain, and planting intentions all follow this pattern. Every layer pays for it: ODS queries carry 120–300s command timeouts as a mitigation, the browser holds and re-scans everything per keystroke, and in zoneless Angular, signal writes to those big arrays re-check 25 non-OnPush components in full. A measured dev session (Section 3.1) makes it concrete: **login took 34.95 s, of which all but ~2.4 s of API time was one endpoint — `/api/notes` shipping a 31.6 MB payload it was never asked for — and that same payload was re-downloaded five times in six minutes,** degrading every concurrent request while it streamed.

Three structural moves would change this profile fundamentally, and they compose (each makes the next cheaper):

1. **Build an app-owned serving layer** (Section 4) — extend the already-proven `dbo.Customer`/`dbo.CustomerTradeUnit` sync pattern to Tickets and Storage, and fix the Contracts projection. This is the "local synced ticket table" the code comments have asked for, generalized. Critically, **this is not throwaway work if the GraphQL-over-DB2 POC lands** — the serving tables and everything above them are source-agnostic; only the sync loaders would be re-pointed from ODS views to GraphQL. This inverts the caution in the predecessor doc.
2. **Move query and aggregation server-side** (Section 5) — paginated/searched list endpoints as the default (not the fallback), `GROUP BY` endpoints for the ~15 client-side aggregation sites, and a split of the 3,120-line NLQ engine into client-side intent parsing + server-side query execution.
3. **Make one owner of client data loading and fix rendering costs** (Sections 7–8) — today two independent pipelines fetch the same six datasets on every trade-unit change; 25 of 44 components lack OnPush; nothing is virtualized; and Leaflet ships eagerly on every page for a screen most users never open (measured: it's what's blowing the bundle budget).

Alongside these, Section 9 lists verified quick wins (a hidden second ODS round-trip on every contract fetch, N+1 loops in background jobs, double-fetch mutation patterns, missing DbContext pooling), and Section 11 closes out stale artifacts — including archiving `customer-trade-unit-map.md`, whose problem was already solved app-side without anyone marking it done.

What was confirmed *healthy* is worth stating: async hygiene is clean (no sync-over-async anywhere, cancellation tokens end-to-end), response compression is on and correctly ordered, SQL parameterization is disciplined throughout, request de-dup and search debounce exist on the client, and several past perf fixes (`GetTodaysAsync`, the sargable-prefix rewrite, the Customer sync) are well-executed models to replicate.

---

## 2 — Evidence legend

| Tag | Meaning |
|---|---|
| **[MEASURED]** | Backed by a live measurement (dev SQL timing from the predecessor doc, the bundle build run for this review, or the dev-session HAR analyzed in 3.1). |
| **[VERIFIED]** | Claim re-checked directly in code during this review (call sites, counts, wiring) — behavior confirmed, magnitude not yet measured. |
| **[STATIC]** | Found by code sweep, plausible and specific, but neither re-verified line-by-line nor measured. Validate before investing. |

Per this team's working agreement, **no SQL or architecture recommendation below should be acted on without dev measurement first** (Section 12).

---

## 3 — The core architectural problem

The data pipeline today, per screen docs and code:

```
login / TU change
  └─ DataPreloadService: customers + contracts + today's-tickets  (blocking "core group" gate)
  │   └─ background group: notes, planting intentions, stored grain, saved lists, …
  └─ home.component._loadAllData(): customers, contracts, notes, storedGrain, … (AGAIN — see 7.1)
        ↓
  appState signals hold TU-wide arrays in browser memory
        ↓
  screens filter/aggregate client-side:
    - NLQ engine scans all arrays per query (build-list, customer-list, home)
    - insights/dashboard/activity-summary/tickets-table reduce() over full arrays
    - customer profile filters the TU-wide arrays down to one producer
```

Costs at each layer, all traceable to the same root:

- **ODS**: the bulk paths need 300s command timeouts (`ContractRepository.cs:31`, `TicketRepository.cs:414` **[VERIFIED]**); the unfiltered contract load measured 585K reads / 6.3s **[MEASURED]**; `vw_CurrentTickets` is ~2–3.8M rows.
- **API/serialization**: the Notes over-fetch measured ~11.3MB / ~1 minute, nearly all serialization+transfer, not SQL **[MEASURED]**.
- **Client memory/CPU**: per-keystroke scans over ~115K contracts + 28.8K notes; every `appState` write triggers zoneless CD across non-OnPush children (8.1).
- **UX**: the slowest core-group call gates Insights and Dashboard behind one spinner (per-dataset flags reportedly in flight — verify status before duplicating).

The predecessor doc treats the symptoms endpoint-by-endpoint. The redesigns below treat the root.

### 3.1 — Measured: one dev session (HAR, 2026-07-13)

A ~6.5-minute dev session (login → browsing → TU switch → several screens) captured as a HAR is now the ground truth for the claims above. Headline numbers **[MEASURED]**:

- **`/api/notes` dominates everything.** Called **5×** in one session; every call returned the identical **31.6 MB decompressed** payload (Brotli-compressed on the wire — compression *is* working; the HAR's `bodySize:-1` under HTTP/2 hides wire size, but the predecessor doc's ~11.3 MB observation is consistent with the compressed transfer). Server TTFB was **< 930 ms every time**; the remaining **23–44 s per call** is streaming/receiving the payload. The login burst took **34.95 s end-to-end and was gated entirely by notes — every other API call in the initial burst completed in < 800 ms, finishing ~2.4 s after the first API call fired.** Fixing the three dropped-`tradeUnits` call sites (predecessor §2.4) is therefore the single largest UX win available at any price.
- **Server contention while notes streams.** During each notes transfer, unrelated trivial endpoints (2-byte responses) spiked from ~200 ms to **3.3–5.9 s of *server* wait** (one click-event POST hit 9.4 s). Likely the dev App Service tier's CPU saturating on serializing+Brotli-compressing 31.6 MB — worth confirming, but it means the notes payload taxes *every concurrent user and request*, not just the caller.
- **The dual-preload pipeline (7.1) is confirmed on the wire**: on initial load and on every TU switch, six endpoints (`contracts`, `plantingintentions`, `commodities`, `savedlists`, `customers`, `dashboardplantingestimates`) fire **twice, ~0.5 s apart, from the same initiator stack**.
- **Reference data re-fetched, byte-identical, on every navigation**: `/api/commodities` (733 KB) fetched **13×**, plus `producerdetails`, `mention-catalog`, `commodities/planting`, `dashboardplantingestimates` — the client-and-HTTP-caching opportunity in Section 6 quantified.
- **Post-index bulk endpoints are respectable now**: `tickets?tradeUnits=…` 523 KB / 1.6 s worst-case standalone; `contracts?tradeUnits=…` 398 KB / ~0.7 s outside contention windows. The index work banked in the predecessor doc shows up clearly here.
- **AAD login costs ~8 s before the first API call** (redirect chain + double app-shell load, ~780 KB extra transfer — inherent to MSAL redirect flow, low priority).
- Two **new issues** surfaced (not in any code sweep): a **systematic 8/8 failure rate on `PUT /api/producerdetails/customer/{id}`** (500s across eight different customers — functional bug, Section 11.6), and **450 direct OpenStreetMap tile requests with a 67% mid-flight abort rate** during map use (Section 11.7).

Full analysis with request-level tables: [`sweeps/har-analysis.md`](sweeps/har-analysis.md) (see its errata note on the compression claim).

---

## 4 — Flagship redesign: an app-owned serving layer

### 4.1 The pattern is already proven in this codebase

Migrations `20260513152851` → `20260513203133` plus `CustomerSyncBackgroundService`/`CustomerSyncService` replaced live queries against the 12–14s `originations.vw_CustomerTradeUnits` view with synced, indexed `dbo.Customer` + `dbo.CustomerTradeUnit` tables (covering index `IX_CustomerTradeUnit_TradeUnit_IsActive` purpose-built for the TU-scope query). All the major repositories resolve trade-unit scope from these tables today **[VERIFIED]**. This is a working, in-production example of exactly the pattern the rest of this section proposes — soft-delete upsert sync via a `BackgroundService`, app-owned indexing, no ODS write access required.

### 4.2 Tickets read model — the single highest-value item **[STATIC, design gated on measurements]**

`TicketRepository.LoadTicketsByContractAndCustomerScopeAsync` still round-trips the multi-million-row `vw_CurrentTickets` on demand, with in-code comments stating the bulk scan "can run 2–3+ minutes" and that *"a local synced ticket table is the durable fix."* Proposed shape (consistent with the earlier design discussion recorded in the predecessor doc):

- `dbo.Ticket` app-owned table; historical days immutable once loaded, "today" refreshed on a short interval (single-digit minutes — Insights' Spot Loads is the freshness-sensitive consumer).
- Indexing freedom the ODS view can never give: covering indexes per real query shape (CustomerCode-scoped, ContractNumber-scoped, today's-unapplied), and a real `date` column replacing the string-typed `TicketBlDate` lexicographic comparisons (`TicketRepository.cs:267`, `CustomerRepository.GetOpenActivityTradeUnitsAsync`) **[VERIFIED pattern]**.
- Open design question for the ODS team: does `base.Ticket` carry a modified-timestamp/run-stamp not exposed by the view? With one, sync is incremental; without, it's a windowed re-sync (e.g., last N days re-pulled + occasional full reconcile), which the Customer sync already demonstrates is viable.

### 4.3 Storage read model — `REPORT_RUN_STAMP` is a ready-made sync key **[VERIFIED pattern]**

Both `StoredGrainRepository` (`StoredGrainSql`) and `TicketRepository.GetActiveStorageCommoditiesAsync` re-derive `MAX(REPORT_RUN_STAMP)` from `ctrm.vw_GNTA39D1` via a scalar subquery on every call, and the stored-grain query joins `vw_GNP003` on `LTRIM(RTRIM(...)) = LTRIM(RTRIM(...))` — non-sargable on both sides, unfixable by any index. A synced `dbo.StoredGrain` table refreshed **only when the run stamp advances** (cheap poll: `SELECT MAX(REPORT_RUN_STAMP)`) eliminates the MAX subquery, the non-sargable join, and the storage-gate scan that today sits inside the *core preload path* (`getTodaysTickets`'s C-prefix gating) — the documented cause of the Insights/Dashboard spinner delay.

### 4.4 Contracts — projection first, sync if measurements demand it

Two options, not mutually exclusive:

- **(a) Kill the width and the side-query** — the bulk path is `SELECT c.*` (~75 columns) and then a **second** STRING_SPLIT-joined ODS query per fetch (`EnrichWithHedgeMarketMonthAsync`, `ContractRepository.cs:412-443`, called from both `GetAsync` L124 and `GetByCustomerAsync` L164 **[VERIFIED]**) purely to backfill `HedgeMarketMonthDescription`/`PriceMarketMonthDescription` missing from `vw_CurrentContracts`. Ask the ODS team to add the two columns to the view (removes the side-query entirely), and project only the columns the client actually consumes. This alone may make a synced contract table unnecessary.
- **(b) `dbo.Contract` synced table** — same pattern as 4.2 if measurements show the projected view query is still too slow for the bulk path.

### 4.5 GraphQL-over-DB2 contingency — why the serving layer is the *safe* bet

The predecessor doc flagged ODS-pathway investment as potentially throwaway. For the serving layer, that concern applies **only to the sync loaders** (`Load*Async` methods reading ODS views). The tables, indexes, repositories, aggregation endpoints, and client all sit *above* the serving layer and are source-agnostic. If GraphQL lands: re-point the loaders at GraphQL, keep everything else. If it doesn't: nothing was bet on it. The serving layer also **de-risks the GraphQL migration itself** — the app stops caring what's upstream. What *would* be throwaway under GraphQL: further deep ODS index tuning beyond the cheap wins already banked, and any fix predicated on ODS view changes (4.4a — worth doing anyway because it's near-zero effort for the ODS team).

### 4.6 Reference-data caches — finish what's started

`dbo.ElevatorCache` already exists in `ApplicationDbContext`, but `TicketRepository.PopulateElevatorLocations` queries the live ODS `Elevator`/`Location` views directly **[STATIC — verify wiring]**. Either wire the cache in or remove it. Commodity conversions (`vw_GNP024`) are a smaller candidate for the same treatment.

---

## 5 — Server-side query & aggregation API

### 5.1 Lists default to server search + pagination

Already identified in the predecessor doc (Section 2.2) — restated here because the serving layer (Section 4) is what makes it fully achievable for *tickets and contracts*, not just customers. The pattern to standardize: `/search`-style endpoints with a result cap (the existing `/customers/search` 15-cap is the model), paged list endpoints for grids, and bulk arrays retired as the rendered row source.

### 5.2 Split the NLQ engine: parse client-side, match server-side

`nlq-filter.service.ts` (3,120 lines, three consumers: build-list, customer-list, home) conflates two jobs:

1. **Intent parsing** — phrase → structured filter ("notes mentioning drought in the last 30 days" → `{entity: notes, text: "drought", dateRange: …}`). Pure CPU on a short string; keep client-side for per-keystroke responsiveness.
2. **Matching/execution** — applying that filter across contracts/notes/tickets/customers. Today this scans bulk arrays in the browser; it should become a **server-side query endpoint** taking the structured filter and returning matched customer IDs + display data. Against serving-layer tables with purpose-built indexes, a debounced per-keystroke call is plausible; if cross-entity queries prove too slow for live-filter, build-list degrades gracefully to submit-to-search while customer-list/home (narrower needs) stay live.

This preserves the NLQ UX, deletes the reason the client needs notes/tickets/contracts bulk arrays at all, and answers the predecessor doc's open questions 1–4 with a concrete architecture. **Prerequisite:** measure real per-TU row counts (Section 12) — if a typical TU's slice is small, an interim "TU-scoped + projected columns" bulk load buys time; company-wide arrays never make sense.

### 5.3 `GROUP BY` endpoints for dashboard/summary tiles **[STATIC]**

~15 client sites reduce full row arrays into a handful of numbers: `dashboard.component.ts` (totals at 1185-1187, monthly crop map at 812-833, acre sums at 292-333), `activity-summary.component.ts` (crop group-bys at 262/299, quality averages at 343-344), `tickets-table.component.ts:233-238`, `insights.component.ts` tiles, `customer-print-report.component.ts`, `unshipped-bushels.component.ts`. Each is a natural `GROUP BY` endpoint returning tens of numbers instead of shipping thousands of rows. Sequence these *after* the serving layer exists (SQL-side aggregation against ODS views would just move the pain).

### 5.4 Customer search — both variants need redesign at scale

- `SearchOdsAsync` **[VERIFIED shape]**: a type-ahead endpoint running per-word leading-wildcard `LIKE` plus `LEFT(col,1)` and `NOT LIKE '%DUP%'` predicates **directly against live `base.vw_CurrentCustomers`** per keystroke-driven request — likely the most expensive per-request pattern in the app. Route it through synced `dbo.Customer` instead (the sync exists; confirm the ODS variant's extra fields/statuses are synced or syncable).
- `SearchAsync` (app DB) **[VERIFIED shape]**: leading-wildcard `LIKE` across 5 columns per word + 5×-nested-`REPLACE` phone matching. App-owned table = full freedom: add a persisted computed `PhoneDigits` column (indexed), and adopt SQL Server full-text indexing (or n-gram columns) for name/city search. Fine at today's 16.7K rows; fix before the roster grows.

---

## 6 — Server-side response caching

The security model makes this unusually easy: **trade units are a UX filter, not an access boundary** — any authenticated user may read any customer's data (documented, accepted design). Therefore TU-scoped read responses are **shareable across users**, and the API can cache them keyed on `(endpoint, TU-set, params)` with no per-user cache partitioning:

- Short-TTL `IMemoryCache`/output caching on the heavy TU-scoped GETs (contracts, tickets, notes, stored grain): even 60–120s TTLs would collapse the duplicate load from multiple originators in the same TU and from the client's own duplicate-pipeline bug (7.1) during the transition.
- Freshness bounds from the business docs: ODS is minutes-latent anyway; "today's tickets" is the most freshness-sensitive (keep TTL ≤ the sync interval chosen in 4.2); Insights already has a Refresh button (`forceReload()`) — wire it to a cache-bypass header.
- Reference data: `QueryLibrary`, trade units, bid-sheet metadata should adopt the existing `CommodityService.GetCachedAsync` cache-aside helper **[VERIFIED it exists and is clean]**. The client side needs the same discipline: the HAR shows `/api/commodities` (733 KB) fetched **13× in one session, byte-identical every time** **[MEASURED]** — server memory-caching alone doesn't stop the transfer; add client-side caching (extend `_dedupe` into a TTL cache for reference endpoints) and/or `Cache-Control`/ETag headers so the browser can 304.
- Note: this is a *mitigation and multiplier*, not a substitute for Sections 4–5 — a cache miss still costs the full ODS query.

---

## 7 — Client data-orchestration fixes

### 7.1 One owner for preload **[MEASURED]** — HIGH

`DataPreloadService` (subscribes to `appState.selectedTradeUnits`, `data-preload.service.ts:21,31`) and `home.component.ts` (own TU signal + `_loadAllData()` at L194) **independently fetch nearly the same six datasets on every trade-unit change**, with different merge logic (Home re-merges FK extras; the preload service doesn't). `ApiService._dedupe` only collapses *concurrent* same-key calls — this is a race, not a guarantee, and divergent post-processing means results can differ by which pipeline lands last. **The HAR confirms it on the wire (3.1): six endpoints double-fire ~0.5 s apart — far enough apart that `_dedupe`'s in-flight window misses several of them — at initial load and on every TU switch in the capture.** Redesign: `DataPreloadService` becomes the single fetch owner; Home reads `appState` signals only (Insights already works exactly this way and is the reference consumer). This also removes Home's ~20 mirror signals double-writing the same data into a second signal graph.

### 7.2 Smaller orchestration fixes

- **`getCommodities()`/`getPlantingCommodities()` not `_dedupe`d** (`api.service.ts:617-626`) unlike ~15 sibling endpoints, and called from both pipelines — concrete duplicate round-trips today **[VERIFIED]**. One-line fix each.
- **Per-dataset loading gates** instead of the single `dataLoading` spinner — reportedly already in flight; verify status before duplicating (predecessor doc 3.2).
- **`customer-profile.component.ts`**: 13 `effect()`s; the HTTP-firing ones (`historicalContracts` :327-333, `fieldTags` :352-359) lack the stale-response guard (`_customerRequestId` pattern) that `home.component.ts` uses one level up — rapid customer-clicking can land stale data **[STATIC]**. Quick fix; also consolidate the non-HTTP reset effects.
- **List virtualization**: still absent app-wide (`@angular/cdk` is already a dependency; `ScrollingModule` unused). Stopgap that pays regardless of server-side fixes.

---

## 8 — Rendering & bundle

### 8.1 OnPush coverage — 19 of 44 components **[VERIFIED count]** — HIGH, cheap

In a zoneless app, a Default-strategy component is re-checked in full (every binding, every template method call) on **every** CD tick scheduled by any signal write anywhere. The page shells are correctly OnPush (bid-sheet, build-list, dashboard, insights, customer-profile, customer-list), but their data-heavy children are not: `contracts-table`, `tickets-table`, `planting-intentions-table`, `contract-pacing-card`, `activity-summary`, `year-over-year-chart`, `customer-map`, `producer-insights`, `edit-customer-dialog`, and `home.component` itself, among 25 total. They already consume `input()` signals, so adding `changeDetection: ChangeDetectionStrategy.OnPush` should be near-free mechanically. Given how often `appState`'s large-array signals are written, this is the highest CPU-per-effort ratio on the client.

### 8.2 Eager Leaflet is what's blowing the bundle budget **[MEASURED]**

Production build (run for this review): **initial bundle 1.05MB raw / 222KB transfer — fails the 1MB error budget by ~45KB**. The cause is in `angular.json`: `leaflet.js` + `leaflet.markercluster.js` sit in the global `scripts` array (**181.7KB raw / 44.6KB transfer, eager on every page load**), and maplibre/mapbox-draw/MarkerCluster CSS sit in the global `styles` bundle (268KB raw) — for map features on the Bid Sheet and Fields tab that most sessions never open. Meanwhile a `leaflet-markercluster` **lazy** chunk (34KB) also exists — the library likely ships twice. The mapping *JS* libraries are otherwise correctly lazy (maplibre's 839KB chunk is lazy; all feature routes `loadComponent`). Fix: remove the global `scripts`/`styles` entries and import Leaflet + CSS inside the lazy map components; the budget failure disappears and every non-map page load sheds ~45KB+ transfer and parse cost.

(Note: the HAR analysis reported "Leaflet did not load on first page" — that's URL-based matching; the eager copy hides inside the hashed `scripts-*.js` bundle, which *did* load in the initial shell. The build output above, not the HAR URL grep, is authoritative here.)

### 8.3 Lower-priority rendering notes **[STATIC]**

Per-row template method calls in `customer-list.component.html` (`getFormattedLocation()` etc. — fold into pure pipes or precompute; compounds with no-virtualization), hand-rolled chart components recomputing datasets with `Math.max(...spread)` per effect run, bid-sheet's permanent 10s "time since refresh" tick (verify teardown + keep the write cheap), `mapGeocodeCache` never cleared in `clearAll()`.

---

## 9 — Backend quick wins

All verified in code unless noted; none require schema or API-contract changes.

| # | Finding | Where | Impact | Fix |
|---|---|---|---|---|
| 1 | Second ODS STRING_SPLIT query per contract fetch to backfill 2 columns; failures silently swallowed | `ContractRepository.cs:412-443` (called L124, L164) **[VERIFIED]** | HIGH | Short-term: log failures properly. Real fix: ODS view adds the 2 columns (4.4a) |
| 2 | N+1 `FirstOrDefaultAsync`-in-loop in daily/feature/weekly usage aggregation jobs | `UsageRepository.cs:418, 481, 529` **[STATIC]** | MED (grows with users) | Batch-load into dictionary first — pattern already correct in `DashboardRepository` / `ProducerDetailsRepository.GetAllAsync` |
| 3 | Double DB fetch on every Note / PlantingIntention mutation (controller 404-pre-check + repo re-fetch) | `NotesController.cs:68-116`, `PlantingIntentionsController.cs:80-117` **[STATIC]** | MED (every edit) | Drop controller pre-check; repos already return null on not-found |
| 4 | `PUT /api/customers/{id}`: two identical reads around a documented no-op write | `CustomerService.cs:55-65` **[STATIC]** | LOW | Collapse, or implement the real write path |
| 5 | No `AddDbContextPool` on any of the three contexts | `DependencyInjection.cs:23-82` **[STATIC]** | LOW–MED under load | Swap registration; verify no per-request context state |
| 6 | No context-level `NoTracking` default (117 per-call `AsNoTracking()`s — a foot-gun, not a current bug) | context registrations **[STATIC]** | LOW | `UseQueryTrackingBehavior(NoTracking)` + explicit `AsTracking()` on the ~15 mutation fetches |
| 7 | Bid-sheet metadata: 3 near-identical `Distinct()` queries per load; `GetAllLocationsAsync` unscoped `Include(Bids)` | `BidSheetRepository.cs:271-302, 42-49` **[STATIC]** | LOW–MED | Combine; scope by TU |
| 8 | `GetOdsCustomerRowAsync`: `TOP 1` without `ORDER BY` | `CustomerRepository.cs:789-805` **[STATIC]** | Correctness risk | Add ORDER BY |
| 9 | Retention cleanup delete unbatched | `UsageRepository.cs:587-598` **[STATIC]** | LOW | `DELETE TOP(n)` loop |
| 10 | Silent `catch → empty result` masks timeouts as "no data" in perf-critical repos | `StoredGrainRepository.GetAsync`, hedge enrich, `PopulateElevatorLocations` **[STATIC]** | Observability | Narrow catches, log at error level |

Confirmed clean (no action): sync-over-async (zero occurrences), cancellation-token propagation, response compression, MSAL/auth middleware per-request cost, STRING_SPLIT/UNION ALL usage (deliberate and correct), client subscription hygiene and search debounce.

---

## 10 — SQL / index opportunities

Constraints honored: ODS = **index changes only**; Origination app DB = full freedom. All require dev measurement before applying (Section 12); note that `HasIndex` declarations on ODS *view* entities in `OriginationDbContext` are EF metadata only — they create nothing and must not be read as real indexes.

| Opportunity | DB | Notes |
|---|---|---|
| Full-text index (or persisted n-gram/`PhoneDigits` computed columns + indexes) on `dbo.Customer` for search | Origination | Enables 5.4; app-owned so table changes allowed |
| Real typed-date + covering indexes on the **serving-layer** tables (`dbo.Ticket`, `dbo.StoredGrain`, `dbo.Contract`) | Origination | The point of Section 4 — index freedom ODS views can't offer |
| Further `vw_CurrentCustomers`-backing index work for `SearchOdsAsync` | ODS | Likely **not worth it** — 5.4's re-route to synced `dbo.Customer` is better and survives GraphQL |
| `ctrm.vw_GNTA39D1` — already indexed in dev (predecessor #4); the remaining `LTRIM(RTRIM())` join and MAX-subquery costs are **not index-fixable** | ODS | Fix belongs in the query/serving layer (4.3), not more indexes |
| Contract bulk path | ODS | Confirmed not index-fixable (75-column projection); fix is 4.4 |

---

## 11 — Housekeeping & corrections

1. **Archive [`customer-trade-unit-map.md`](customer-trade-unit-map.md)** — verified stale: its referenced file paths no longer exist, and its proposed ODS-side table was superseded by the app-side `dbo.Customer`/`dbo.CustomerTradeUnit` sync (migrations `20260513*`), which solves the same problem without ODS write access. Mark superseded with a pointer; it currently reads as pending work.
2. **`UserEntitlementService.ValidateCustomerAccessAsync` is dead code with a latent bottleneck** **[VERIFIED — zero live callers]**: it queries the slow live `vw_CustomerTradeUnits` view per call. If ever wired into the request path it reintroduces the exact 12–14s problem the sync eliminated. Re-point it at the synced tables *before* anyone wires it in — or delete it.
3. **`FarmRepository`/`FarmsController`** — repository is a stub returning empties; no Angular caller found for the bare endpoint. Confirm and remove.
4. **Pre-EF-migration `.sql` scripts** under `scripts/` and `api/.../Scripts/` duplicate what later became EF migrations — confirm historical and quarantine/label to avoid a second source of schema truth.
5. **Observability remains the prerequisite for prod prioritization** — unchanged from predecessor doc Section 5 (no OTel/App Insights JS). Every prod-impact claim in this review is inferred from dev measurement + code shape, not real user telemetry.
6. **`PUT /api/producerdetails/customer/{id}` failed 8-of-8 times in the HAR session** **[MEASURED]** — 500s across eight different customer IDs during a grid-editing burst. Systematic, not transient; a functional bug outside this review's perf scope but too consistent to leave unreported. Related perf smell from the same capture: the client fired `linked-to`/`pacing` fetches *and these PUTs* in tight per-row double-bursts across ~30 customers — investigate why row rendering/editing issues a write per row instead of batching.
7. **Direct OpenStreetMap tile usage with 67% aborted requests** **[MEASURED]** — 450 browser requests to `*.tile.openstreetmap.org` in one map interaction, 273 aborted mid-flight in under 2 s (tile-grid re-request churn on pan/zoom or double-initialized tile layer). Also a third-party dependency worth an explicit decision: OSM's public tile servers carry a usage policy that discourages production enterprise traffic — fold into the maps `PATH-TO-PRODUCTION.md` question list.

---

## 12 — Measurement & validation plan

Completed for this review: production bundle build (Section 8.2) and dev-session HAR capture + analysis (Section 3.1) — the HAR validated the dual-preload pipeline, quantified the notes cost (23–44 s × 5 calls/session), quantified reference-data re-fetch waste, and surfaced two new issues (11.6, 11.7).

Pending, in order of value:

1. **Per-TU row-count profile** (dev SQL): contracts/tickets/notes/stored-grain counts for a typical and a worst-case trade unit. This single measurement decides how aggressive Section 5 must be (TU-scoped bulk load as interim vs. straight to server-side query). For notes specifically: measure the TU-scoped payload size to predict the win from fixing the dropped-`tradeUnits` call sites before shipping it.
2. **Serving-layer feasibility numbers** (dev SQL): full-pull duration of `vw_CurrentTickets` for a nightly sync window; whether `base.Ticket` exposes a change-detection column (ask ODS team); `REPORT_RUN_STAMP` advance cadence on `vw_GNTA39D1`.
3. **Contention confirmation** (dev): reproduce the notes-in-flight server-wait spikes from 3.1 while watching App Service CPU (or run two concurrent notes fetches) to confirm the dev-tier-CPU-saturation hypothesis vs. connection-pool exhaustion — determines whether the fix is purely payload-size or also pool sizing.
4. **Repro + root-cause `PUT /api/producerdetails/customer/{id}` 500s** (11.6) — check API logs for the exception; 8/8 failure suggests it reproduces on demand.
5. **Before/after timings** for each quick win in Section 9 as it's implemented, recorded in the predecessor doc's style. A repeat HAR of the same click-path after fixes land is the cheapest regression check; a headed-Playwright session remains the escalation for repeatable timing runs.

---

## 13 — Prioritized roadmap

Sequenced so each tier funds confidence in the next. Effort: S (≤1 day), M (days), L (weeks), XL (multi-week redesign).

| Pri | Item | Section | Impact | Effort | Risk | ODS/GraphQL contingency |
|---|---|---|---|---|---|---|
| 1 | Predecessor-doc fixes still open (**Notes TU param** — measured 23–44 s × 5/session and gates login; contracts-by-customer on profile; stored-grain call site) | pred. §2, 3.1 | **HIGHEST — measured** | S | Low | None |
| 2 | Single preload owner (kill `home._loadAllData`) + `_dedupe` commodities + reference-data client caching | 7.1, 7.2, 6 | HIGH (measured: 6 endpoints ×2 per TU change; 733 KB ×13/session) | M | Low | None — source-agnostic |
| 3 | OnPush on the 25 Default components | 8.1 | HIGH (client CPU) | S–M | Low | None |
| 4 | De-eager Leaflet + mapping CSS | 8.2 | MED (every page load; fixes budget failure) | S | Low | None |
| 5 | Backend quick wins #1–5 (hedge-enrich logging, N+1 jobs, mutation double-fetch, pooling); root-cause producerdetails PUT 500s (11.6) alongside | 9, 11.6 | MED | S–M | Low | None |
| 6 | Server-side response caching on heavy TU-scoped GETs + reference-data cache adoption | 6 | MED–HIGH (multi-user + transition relief) | M | Low–Med (freshness tuning) | None |
| 7 | **Storage read model** (`REPORT_RUN_STAMP`-keyed sync) — un-gates the core preload path | 4.3 | HIGH | L | Med | Loader re-points if GraphQL lands |
| 8 | **Tickets read model** | 4.2 | HIGH (largest single item) | XL | Med | Loader re-points |
| 9 | Contracts projection + ODS view column ask; synced table only if still slow | 4.4 | HIGH | M–L | Low–Med | View-ask is ODS-specific but near-free |
| 10 | Server search/pagination as list default; retire bulk arrays as row source | 5.1 | HIGH | L | Med | None (serving layer beneath it) |
| 11 | **NLQ split**: client parse / server match | 5.2 | HIGH (deletes the bulk-array dependency) | XL | Med–High (UX parity across 3 consumers) | None |
| 12 | `GROUP BY` endpoints for dashboard/summary tiles | 5.3 | MED | M–L | Low | None |
| 13 | Customer search redesign (full-text / computed columns; retire `SearchOdsAsync` live-ODS path) | 5.4 | MED (grows) | M | Low | Improves under either source |
| 14 | Virtualization, profile-effect guards, rendering cleanup batch | 7.2, 8.3 | LOW–MED | M | Low | None |
| 15 | Housekeeping: archive stale doc, dead code, .sql scripts | 11 | Hygiene | S | Low | — |

**The end state this roadmap builds toward:** the browser holds view-models, not datasets — every screen asks the API a question (search, page, aggregate) answered in tens of milliseconds from app-owned indexed tables, the upstream source (ODS today, GraphQL tomorrow) is an implementation detail of background sync jobs, and login-to-interactive is bounded by one small paged query instead of the slowest company-wide bulk load.

---

## Related docs

- [`API-DATA-LOADING-FINDINGS.md`](API-DATA-LOADING-FINDINGS.md) — predecessor investigation: measured index work, over-fetching bugs, NLQ open questions.
- [`customer-trade-unit-map.md`](customer-trade-unit-map.md) — **superseded** (see Section 11.1).
- Sweep working papers backing this synthesis (raw agent reports, preserved as-captured; where they conflict with this doc, this doc's verified/errata'd version wins):
  - [`sweeps/backend-sweep.md`](sweeps/backend-sweep.md) — endpoint inventory + backend findings
  - [`sweeps/client-sweep.md`](sweeps/client-sweep.md) — per-screen data-flow + client findings
  - [`sweeps/data-layer-sweep.md`](sweeps/data-layer-sweep.md) — DbContext/repository/SQL-shape inventory
  - [`sweeps/app-flow-digest.md`](sweeps/app-flow-digest.md) — per-screen purpose/data/freshness digest
  - [`sweeps/har-analysis.md`](sweeps/har-analysis.md) — measured dev-session waterfall (with errata)
