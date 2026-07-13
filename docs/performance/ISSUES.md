# Performance Issues Tracker

**Source:** [`PERF-REDESIGN-REVIEW.md`](PERF-REDESIGN-REVIEW.md) (2026-07-12 review) + [`API-DATA-LOADING-FINDINGS.md`](API-DATA-LOADING-FINDINGS.md).
This is the working backlog — one row per actionable issue, ordered by priority tier. Detail, evidence, and design discussion live in the review doc (section refs below); update **Status** here as items move. Statuses: `Open`, `In progress`, `Blocked`, `Done`, `Won't do`.

---

## Table of Contents

- [Tier 1 — Quick wins (S–M effort, measured or verified impact)](#tier-1--quick-wins-sm-effort-measured-or-verified-impact)
- [Tier 2 — Medium efforts](#tier-2--medium-efforts)
- [Tier 3 — Redesigns (the serving layer and what it unlocks)](#tier-3--redesigns-the-serving-layer-and-what-it-unlocks)
- [Functional bugs found during the review](#functional-bugs-found-during-the-review)
- [Housekeeping](#housekeeping)
- [Measurements pending](#measurements-pending)

---

## Tier 1 — Quick wins (S–M effort, measured or verified impact)

| ID | Issue | Review § | Impact | Effort | Status |
|---|---|---|---|---|---|
| PERF-01 | Pass `tradeUnits` at the 3 dropped Notes call sites (`data-preload.service.ts:108`, `build-list.component.ts:1745,:2070`); prefer `getNotesByCustomer` JIT on profile views | 3.1, pred. §2.4 | **Highest — measured**: 31.6 MB × 5/session, gates 34.95 s login | S | Open |
| PERF-02 | Customer Home Page: use `getContractsByCustomer` instead of filtering the TU-wide bulk array (`home.component.ts:246,1153`) | pred. §2.1b | High | S | Open |
| PERF-03 | Pass `tradeUnits` at the unscoped `getStoredGrain()` call (`home.component.ts:259`) | pred. §2.5 | Low-Med | S | Open |
| PERF-04 | Single preload owner: Home consumes `appState` only; kill `home._loadAllData()` duplicate pipeline | 7.1 | High — measured 6 endpoints ×2 per TU change | M | Open |
| PERF-05 | Wrap `getCommodities()`/`getPlantingCommodities()` in `ApiService._dedupe` | 7.2 | Med — measured 733 KB ×13/session | S | Open |
| PERF-06 | Client TTL cache + `Cache-Control`/ETag for reference endpoints (commodities, mention-catalog, producerdetails, dashboardplantingestimates) | 6 | Med | S–M | Open |
| PERF-07 | Add `ChangeDetectionStrategy.OnPush` to the 25 Default-strategy components (tables/cards/charts under Home, `home.component` itself) | 8.1 | High (client CPU, zoneless full-tree recheck) | S–M | Open |
| PERF-08 | De-eager Leaflet: remove `leaflet*` from `angular.json` `scripts`/`styles`, import inside lazy map components (fixes failing 1 MB initial budget; likely double-ship with existing lazy markercluster chunk) | 8.2 | Med — measured 181.7 KB raw eager + mapping CSS | S | Open |
| PERF-09 | Batch-load-then-loop the 3 N+1 aggregation jobs in `UsageRepository` (`:418,:481,:529`) — copy `DashboardRepository`/`ProducerDetailsRepository` pattern | 9 #2 | Med (grows with users) | S | Open |
| PERF-10 | Drop controller-level 404 pre-checks on Notes/PlantingIntentions mutations (repos already null-check) | 9 #3 | Med (every edit ×2 round trips) | S | Open |
| PERF-11 | `AddDbContextPool` for all three contexts | 9 #5 | Low-Med | S | Open |
| PERF-12 | Reference-data endpoints adopt `CommodityService.GetCachedAsync` cache-aside (QueryLibrary, trade units, bid-sheet metadata) | 6, 9 | Low | S | Open |
| PERF-13 | Narrow the silent catch-swallows that mask timeouts as "no data" (`StoredGrainRepository.GetAsync`, hedge enrich, `PopulateElevatorLocations`) | 9 #10 | Observability | S | Open |
| PERF-14 | Misc backend: collapse `CustomerService.UpdateAsync` double-read around no-op; `GetOdsCustomerRowAsync` TOP 1 needs ORDER BY; batch retention delete; combine 3 bid-sheet metadata queries | 9 #4,#7,#8,#9 | Low | S | Open |

## Tier 2 — Medium efforts

| ID | Issue | Review § | Impact | Effort | Status |
|---|---|---|---|---|---|
| PERF-20 | Server-side response caching on heavy TU-scoped GETs, keyed `(endpoint, TU-set, params)` — shareable across users since TU is a UX filter, not an access boundary; wire Insights Refresh to cache-bypass | 6 | Med-High | M | Open |
| PERF-21 | Context-level `NoTracking` default + explicit `AsTracking()` on the ~15 mutation fetches | 9 #6 | Low (foot-gun removal) | S + audit | Open |
| PERF-22 | List virtualization (`cdk-virtual-scroll`) for customer list, build-list, bid-sheet large `@for` lists | 7.2 | Low-Med | M | Open |
| PERF-23 | `customer-profile.component.ts`: stale-response guards on per-customer HTTP effects; consolidate the 13 effects | 7.2 | Med (correctness + churn) | S–M | Open |
| PERF-24 | Contracts: ask ODS team to add `HedgeMarketMonthDescription`/`PriceMarketMonthDescription` to `vw_CurrentContracts` (kills the per-fetch side query); project needed columns instead of `SELECT c.*` | 4.4a, 9 #1 | High | M (+ ODS ask) | Open |
| PERF-25 | Customer search redesign: retire `SearchOdsAsync` live-ODS path (route through synced `dbo.Customer`); full-text/computed `PhoneDigits` column on app DB | 5.4 | Med (grows) | M | Open |
| PERF-26 | Rendering cleanup batch: per-row template calls → pipes; chart effect recompute; bid-sheet 10 s tick teardown check; geocode cache in `clearAll()` | 8.3 | Low | S–M | Open |

## Tier 3 — Redesigns (the serving layer and what it unlocks)

Sequencing note: PERF-30/31 are the foundation; 32–34 get dramatically cheaper once they exist. All survive the ODS→GraphQL displacement (only sync loaders re-point — review §4.5).

| ID | Issue | Review § | Impact | Effort | Status |
|---|---|---|---|---|---|
| PERF-30 | **Storage read model**: app-owned `dbo.StoredGrain` synced on `REPORT_RUN_STAMP` advance — kills the repeated `MAX()` subquery, the non-sargable `LTRIM(RTRIM())` join, and the storage gate inside the core preload | 4.3 | High | L | Open |
| PERF-31 | **Tickets read model**: app-owned synced ticket table (historical immutable, "today" on short interval) — the in-code "durable fix"; blocked on measurements M-2 | 4.2 | High (largest single item) | XL | Open |
| PERF-32 | Server search/pagination as the list default; retire bulk arrays as rendered row source | 5.1 | High | L | Open |
| PERF-33 | **NLQ split**: client-side intent parsing, server-side matching endpoint serving build-list / customer-list / home | 5.2 | High (deletes bulk-array dependency) | XL | Open |
| PERF-34 | `GROUP BY` endpoints replacing the ~15 client-side reduce/aggregation sites (dashboard, activity-summary, tickets-table, insights, print report) | 5.3 | Med | M–L | Open |
| PERF-35 | Contracts synced table — only if PERF-24 measurements show the projected view query is still too slow | 4.4b | High | L | Open |

## Functional bugs found during the review

| ID | Issue | Review § | Status |
|---|---|---|---|
| BUG-01 | `PUT /api/producerdetails/customer/{id}` 500s: `_autoSaveCommodities` double-fires from contracts + tickets callbacks (`home.component.ts:1094,:1140`), racing the delete-all/reinsert `CustomerCommodity` rebuild → duplicate-key `SqlException`. Fix client (single-fire via existing `markIfAllDone` at `:1078`) + harden server (set-reconcile upsert; catch 2601/2627, retry once, 409 on persistent conflict). Root-caused via App Insights 2026-07-13. | 11.6 | Open |
| BUG-02 | OSM tile churn: 450 direct `*.tile.openstreetmap.org` requests, 67% aborted in <2 s (pan/zoom re-request churn or double-initialized tile layer); also an OSM usage-policy question for production — fold into `docs/maps/PATH-TO-PRODUCTION.md` | 11.7 | Open |
| BUG-03 | Latent: `UserEntitlementService.ValidateCustomerAccessAsync` is dead code querying the slow live `vw_CustomerTradeUnits` view — re-point at synced tables or delete before anyone wires it in | 11.2 | Open |

## Housekeeping

| ID | Issue | Review § | Status |
|---|---|---|---|
| HK-01 | Mark `customer-trade-unit-map.md` superseded (solved app-side by `Customer`/`CustomerTradeUnit` sync, migrations `20260513*`) with pointer to `CustomerSyncService` | 11.1 | Open |
| HK-02 | Confirm `FarmRepository`/`FarmsController` dead; remove | 11.3 | Open |
| HK-03 | Confirm pre-EF `.sql` scripts under `scripts/` + `api/.../Scripts/` are historical; label/quarantine | 11.4 | Open |
| HK-04 | Verify `dbo.ElevatorCache` wiring — exists in schema but `PopulateElevatorLocations` queries live ODS views; wire in or remove | 4.6 | Open |
| HK-05 | Observability prerequisite: OTel (.NET 10) + App Insights JS SDK per `developer-docs/CLAUDE.md` — required before prod-impact prioritization | 11.5, pred. §5 | Open |

## Measurements pending

| ID | Measurement | Gates | Status |
|---|---|---|---|
| M-1 | Per-TU row counts (contracts/tickets/notes/stored-grain, typical + worst-case TU) | How aggressive PERF-32/33 must be; predicts PERF-01 payload win | Open |
| M-2 | `vw_CurrentTickets` full-pull duration; `base.Ticket` change-detection column (ask ODS team); `REPORT_RUN_STAMP` cadence | PERF-30/31 design | Open |
| M-3 | Notes-in-flight contention repro with App Service CPU watch (dev) | Whether fix is payload-only or also pool/tier sizing | Open |
| M-4 | Before/after timing per Tier-1 fix as it lands (repeat HAR of same click-path is the cheapest regression check) | Evidence discipline | Open |
