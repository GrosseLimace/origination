# Audit: Performance (`performance`)

Scope: EF Core query patterns and repositories under `api/`, Angular change-detection/template patterns under `client/`, SQL indexing

**Findings:** 11 total — 1 open (low), 7 resolved (1 critical, 1 high, 3 medium, 2 low), 2 wont_fix (low), 1 accepted (low)
**Opened:** 2026-09-19 | **Last verified:** 2026-10-20

## Reconciliation (2026-10-20)

This pass found the domain in a fully closed state: all 10 findings on file were already
`resolved`, `wont_fix`, or `accepted` before this pass started (the four that were still "open" in
this document's 2026-10-13 section — contracts-table OnPush, template function calls, OnPush
coverage, usage-dashboard scope caching — had in fact been resolved on 2026-10-13/14 per
`AUDIT-TRACKING.json`'s own notes; this document just hadn't been reconciled against that since.
Moved to the Resolved section below, with the tracker's own resolution notes.)

Did not re-read the whole repo. Spot-checked a few of the resolved findings against current code
(tickets-table `computed()` signals, OnPush coverage via the barchart-picker and bid-sheet
components, contracts-table's memoized lookup maps) — all still hold, no regressions.

Sampled the largest feature work merged since 2026-10-14 (Bid Sheet remodel + BarChart bids going
live in PROD, CTRM-backed customer onboarding search) for new performance risk, since that work
post-dates every finding already on file:

- **BarChart ingest pipeline** (`BarchartIngestService.cs`, `BarchartIngestRepository.cs`) — bulk
  OPENJSON-based loads, not per-row round trips; deactivation guarded by a blast-radius share check.
  No issues found.
- **BarChart catalog reads** (`BarchartCatalogRepository.cs`) — `GetMatchedBidPricesAsync` batches
  price lookups across every requested location key in one query (its own comment names the N+1 it
  replaces, "batched across every key the caller asked about in one round trip instead of one per
  pin"); `GetBidPreviewAsync`'s per-instrument price/quote lookups are correlated subqueries the EF
  provider folds into one SQL statement, not app-side per-row calls.
- **BarChart picker component** (`barchart-picker.component.ts`) — OnPush, 300ms debounce,
  `take: 50` cap, `computed()`-memoized selection state.
- **Bid Sheet map** (`bid-sheet.component.ts`) — the full catalog layer (~4,000 locations) renders
  through a `markerClusterGroup` (leaflet.markercluster), not one unclustered marker per pin.
  Per-pin bid lookups (`_getLatestBid`/`_getDisplayBid`) are O(1) reads against a `computed()`
  `bidLookup()` map, not a scan per pin per map redraw.
- **`CustomerSyncService.cs`** — the nightly ODS-to-app diff loads all ODS and app rows once each,
  diffs via dictionaries in memory, and saves once; no per-customer round trips in the loop bodies.
- **CTRM customer-onboarding search** (new 2026-10-14) — one new finding, see below.

### New finding (low, open)

**`performance.ods-customer-search-unindexed-wildcard-scan`** — Onboarding search
(`CustomerRepository.BuildOdsSearchSql`) runs a leading-wildcard `LIKE` across 3 columns, ANDed per
search word, against `base.vw_CurrentCustomers`, which no index can serve (non-sargable). Already
heavily mitigated: a 3-char server-side minimum (`CustomersController.MinOdsSearchLength`), client
gating so it only fires when no trade-unit/group scope is selected AND the primary `dbo.Customer`
search returned zero rows, a 150ms debounce with `switchMap`, and `TOP 50`. The client's own test
suite already calls this "the slow master scan" in a comment, so the cost is known and accepted —
recorded as an inferred risk for the next Query Store review, not a proven bottleneck. **Files:**
`CustomerRepository.cs`, `CustomersController.cs`, `customer-list.component.ts`.

## Reconciliation (2026-10-13)

Re-verified all 4 open findings against current code; all four still hold unchanged:

- `performance.contracts-table-missing-onpush-uncached-bindings` — still no `changeDetection` declared; `getAppliedTickets()` (contracts-table.component.ts:696) is still a plain unmemoized `.filter().sort()` over the full tickets input.
- `performance.angular-template-function-calls` — unchanged.
- `performance.angular-onpush-coverage-gap` — OnPush coverage now 23/49 components (one net-new component added, no new adopters).
- `performance.usage-dashboard-duplicate-scope-resolution-per-widget` — `GetUserIdSetAsync` in `UsageDashboardService.cs` is still called independently from 10 call sites with no caching.

Also added to the tracker since the last doc pass but previously undocumented here: `performance.ctrm-read-ahead-ungated-on-data-source` (resolved 2026-09-28, see Resolved section) — folded into this reconciliation for completeness.

Sampled the largest feature work merged since 2026-09-28 (Bin Sites & Grain on Farm, Build-a-List prompt library, Usage Dashboard "manager for all", CTRM trade-unit-scoped contract reads — 105 commits touching `api/`/`client/src`):

- **Bin Sites & Grain on Farm (`ProducerDetailsRepository.cs`):** the batch-read path (`GetBinSitesAsync`/grain-on-farm equivalents for a set of customer ids) groups by `CustomerId` into a dictionary before assignment — same batching discipline as the existing `pricingLinesMap` pattern elsewhere in the codebase. No per-producer loop queries found.
- **CTRM trade-unit-scoped contract read becoming the default (`bf320130`):** a measured, deliberate performance change, not a new risk — the commit message documents a drop from 59-128 batched per-producer requests down to 6-21 pages, with live before/after timings (e.g., 34-65s → 16s). The explicit tradeoff (producer-click reads are no longer served from the warm trade-unit cache, so clicks become live per-producer reads again) is a known and accepted cost, not an oversight.

No new findings opened this pass.

## Reconciliation (2026-09-28)

Re-verified all 3 open findings from the 2026-09-21 pass against current code; all three still hold unchanged (no regressions, no fixes):

- `performance.contracts-table-missing-onpush-uncached-bindings` — `contracts-table.component.ts` still declares no `changeDetection`; `getAppliedTickets()` is still an unmemoized filter+sort over the full `tickets()` input.
- `performance.angular-template-function-calls` — same three template files, no `computed()`/pipe conversion added.
- `performance.angular-onpush-coverage-gap` — OnPush coverage moved from 20/47 to 23/49 components (net one net-new adopter versus two net-new components), same named offenders still on `Default`.

Also reviewed the two feature areas merged since the last pass: the CTRM GraphQL integration (`Services/Ctrm`, `Infrastructure/Ctrm`) and the new Usage Dashboard (`Services/UsageDashboardService.cs`, `UsageAggregationBackgroundService.cs`, `Repositories/UsageRepository.cs`).

- **CTRM integration:** no new findings. This code is unusually well-instrumented for performance already — `CtrmContractReader`/`CtrmTicketReader` chunk producer codes, batch them into GraphQL aliases with bounded concurrency (`SemaphoreSlim`), cache trade-unit-wide reads with stale-while-revalidate, and the inline comments cite measured before/after timings (e.g. "62s/587 requests → 4.7-8.3s/59 requests" for the alias-batching change) for every batching decision. `UsageDashboardService`'s name/reference-data lookups (`GetCustomerDisplayNamesAsync`, `GetContractDisplayNamesAsync`, `ResolveTargetNamesAsync`) are all batched by distinct id before a single dictionary-join pass — no per-item loop calls found.
- **Usage Dashboard:** one new low-severity finding — `performance.usage-dashboard-duplicate-scope-resolution-per-widget` (below). Everything else in this service (background aggregation, session-stat merges, classification) works over pre-fetched sets with no loop-per-item DB or HTTP calls.

## Reconciliation (2026-09-21)

Individually re-verified all 8 pre-existing performance findings against current code, rather than trusting the earlier blanket "resolved via PR #615" note where present. Two findings needed that treatment:

- **`performance.tickets-table-spot-loads-quadratic-getter` (critical, resolved)** — Confirmed in code: `tickets-table.component.ts:132` now declares `spotTicketIds = computed<Set<number>>(...)` with an inline comment naming this exact finding, so it recomputes only when `tickets()`/`contracts()` signals change instead of on every CD pass. OnPush itself is still not applied to this component, but that's tracked separately under `performance.angular-onpush-coverage-gap`; the quadratic-recompute defect this finding targeted is genuinely closed via memoization regardless of change-detection strategy.
- **`performance.bidsheet-reconcile-n-plus-one` (medium, resolved)** — Confirmed in code: `BidSheetRepository.cs:463-503` `ReconcileDuplicateBidInsertsAsync` now issues one batched query keyed by distinct `LocationId`/`CropYear` across all pending `Added` entities, then reconciles in-memory via a dictionary keyed on `(LocationId, CommodityCode.ToUpperInvariant(), CropYear, Month)` — replacing the prior per-entity `FirstOrDefaultAsync` fan-out. Inline comments explicitly reference the N+1 pattern being avoided.

The remaining 3 open findings (contracts-table OnPush/memoization gap, template function calls, OnPush coverage gap) were spot-checked and confirmed still present in current code — no regressions, no new fixes. No new findings were opened in this pass.

## Open

### Onboarding search against the ODS customer master runs a leading-wildcard LIKE scan with no supporting index (`performance.ods-customer-search-unindexed-wildcard-scan`) — low
- **Files:** `CustomerRepository.cs`, `CustomersController.cs`, `customer-list.component.ts`
- See "New finding" above.

## Resolved

### Primary contracts table has no OnPush and repeats uncached per-row lookups in template bindings (`performance.contracts-table-missing-onpush-uncached-bindings`) — high
- **Files:** `features/customers/components/contracts-table/contracts-table.component.ts`, `.html`
- Was: no `changeDetection` declared, `getAppliedTickets(contract)`/`getPricingInfo(contract)`/`getPricingLinesForContract(contract)` called repeatedly per row, unmemoized. Fixed 2026-10-13: `getAppliedTickets`/`getPricingInfo` are now lookups into `computed()` Maps built once per data change, and the component is `ChangeDetectionStrategy.OnPush` with explicit `markForCheck()` calls from the two mutation paths (click handlers, customer-change effect) that touch non-signal state. A 30-test behaviour spec was written against the old implementation first and had to pass unchanged through the refactor; mutation-checked.

### Function calls used directly in template bindings re-run expensive work on every change-detection pass (`performance.angular-template-function-calls`) — medium
- **Files:** `customer-profile.component.html`, `contracts-table.component.html`, `dashboard.component.html`
- Fixed 2026-10-14 as part of the OnPush sweep (same underlying work as the contracts-table and OnPush-coverage findings).

### Roughly half of standalone components skip OnPush change detection, compounding into full-tree re-evaluation (`performance.angular-onpush-coverage-gap`) — medium
- **Files:** `activity-summary.component.ts`, `tickets-table.component.ts`, `edit-customer-dialog.component.ts`, `planting-intentions-table.component.ts`, `home.component.ts`
- Was: 20 of 47 components on OnPush. Fixed in two phases (2026-10-13, 2026-10-14): every component in the client is now OnPush, including `home` (after a page-scoped store decomposition) and the app root — each conversion behind a rendering-behaviour spec written first, several catching real stale-render bugs under zoneless `Default` (NG0100) along the way.

### Every usage-dashboard widget endpoint independently re-resolves the same user-scope set (`performance.usage-dashboard-duplicate-scope-resolution-per-widget`) — low
- **Files:** `Services/UsageDashboardService.cs`, `Infrastructure/Repositories/UsageRepository.cs`
- Closed 2026-10-13 as a false positive after checking the code, not the finding text: `GetUserIdSetAsync` has cached the resolved user-id set in `IMemoryCache` for 60 seconds (keyed per manager plus a generation counter an excluded-user edit bumps) since commit `7c8454ae`, predating the first audit pass. The finding's `(tradeUnitKey, managerId)` cache key was also stale — trade-unit scoping was removed from the dashboard by the usage-for-all change.

### N+1 query in bid-insert race-reconciliation retry path is broader than initially scoped (`performance.bidsheet-reconcile-n-plus-one`) — medium
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/BidSheetRepository.cs`
- Was: `ReconcileDuplicateBidInsertsAsync` looped over EVERY ChangeTracker entry in `EntityState.Added`, issuing one `FirstOrDefaultAsync` per entity. Now (verified 2026-09-21): a single batched query loads all candidates by distinct `LocationId`/`CropYear`, reconciled in-memory via a dictionary keyed on `(LocationId, CommodityCode.ToUpperInvariant(), CropYear, Month)`. See `BidSheetRepository.cs:463-503`.

### Per-row template binding invokes an O(tickets x contracts) getter on every change-detection pass (`performance.tickets-table-spot-loads-quadratic-getter`) — critical
- **Files:** `features/customers/components/tickets-table/tickets-table.component.html`, `.ts`
- Was: `spotTicketIds` was a plain TS getter rebuilding a Set by iterating every ticket and scanning every contract, recomputed on every CD cycle app-wide. Now (verified 2026-09-21): `spotTicketIds` is a `computed<Set<number>>()` at `tickets-table.component.ts:132`, recomputing only when `tickets()`/`contracts()` change. Component still lacks `ChangeDetectionStrategy.OnPush`, tracked separately under `performance.angular-onpush-coverage-gap` (now also resolved, above).

### Hover prefetch and the post-click convergence re-read ran regardless of whether the backend was reading CTRM or ODS (`performance.ctrm-read-ahead-ungated-on-data-source`) — medium
- **Files:** `client/src/app/features/customers/pages/home/home.component.ts`, `client/src/environments/environment.prod.ts`
- Was: a 350ms hover prefetch and a 4s post-click convergence re-read (built to hide CTRM GraphQL latency) ran unconditionally. Against ODS they cost extra reads for no benefit; ungated, whichever way PROD was pointed one of the two costs was paid unnecessarily. Now: both gate on a new `environment.ctrmReadAheadEnabled` flag set per-environment to match that environment's `Ctrm:Source`. Shipped ON in Production ahead of the 2026-09-29 CTRM flip, with the known/accepted cost of extra ODS reads (never stale data) in the window between deploy and flag flip.

## Won't fix / Accepted

### Redundant re-fetch in ProducerDetailsRepository.UpsertAsync (`performance.producer-details-redundant-refetch`) — low, wont_fix
- Duplicate of `dotnet.redundant-refetch-producer-details`; tracked and dispositioned there.

### GroupTradeUnits.GroupId FK has no supporting index in a stale bootstrap script for a table no longer in the live schema (`performance.grouptradeunits-missing-index`) — low, wont_fix
- Duplicate of `sql.grouptradeunits-fk-missing-index`. The table is dropped in the real migrated schema (superseded by `vw_UserTradeUnitAccess`); not worth indexing a script that recreates a dead table.

### ProducerDetails upsert deletes and reinserts all child rows instead of diffing (`performance.producerdetails-child-table-rebuild-on-every-save`) — low, accepted
- Row counts per customer are small; not a throughput risk today. Related to the rejected re-fetch finding above.

## Overall health

The codebase shows clear, sustained signs of deliberate perf work across every pass so far: batched
EF queries with in-memory dictionary joins, `AsNoTracking` on read paths, contract-scoped ticket
loading with documented before/after context, memoized delivery-stats caching, and — as of
2026-10-13/14 — every Angular component in the client is now `OnPush` with `computed()`-memoized
per-row lookups, closing out what had been the longest-standing open cluster (contracts-table,
template function calls, and the OnPush coverage gap). The BarChart/Bid Sheet work that shipped
since then (ingest pipeline, catalog search, the ~4,000-pin clustered map) extends the same
batching and memoization discipline rather than regressing it. The one open item from this pass is
a low-severity, already-mitigated inferred risk (ODS onboarding search's non-sargable wildcard
scan) rather than a proven bottleneck. No sync-over-async, missing-pagination, or bundle-bloat
issues were found in production code this pass either.
