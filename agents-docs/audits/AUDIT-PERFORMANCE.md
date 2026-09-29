# Audit: Performance (`performance`)

Scope: EF Core query patterns and repositories under `api/`, Angular change-detection/template patterns under `client/`, SQL indexing

**Findings:** 9 total — 4 open (1 high, 2 medium, 1 low), 2 resolved (1 critical, 1 medium), 2 wont_fix (low), 1 accepted (low)
**Opened:** 2026-09-19 | **Last verified:** 2026-09-28

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

## High (open)

### Primary contracts table has no OnPush and repeats uncached per-row lookups in template bindings (`performance.contracts-table-missing-onpush-uncached-bindings`)
- **Files:** `features/customers/components/contracts-table/contracts-table.component.ts`, `.html`
- Declares no `changeDetection` (defaults to `Default`), so it re-runs full change detection on every app-wide tick. Its template calls `getAppliedTickets(contract)` (an unmemoized `.filter()` over the full tickets input) and `getPricingInfo(contract)` up to 3 times per row, plus `getPricingLinesForContract(contract)` 4-5 times per expanded row — on the most frequently opened customer-profile screen.
- **Related findings:** `angular.function-calls-in-template-bindings`
- **Suggested fix:** Add `ChangeDetectionStrategy.OnPush`; memoize `getAppliedTickets`/`getPricingInfo` per contract (mirroring the existing `pricingLinesMap`/`_deliveryStatsCache` pattern already used for `getDeliveryStats`).

## Medium (open)

### Function calls used directly in template bindings re-run expensive work on every change-detection pass (`performance.angular-template-function-calls`)
- **Files:** `customer-profile.component.html`, `contracts-table.component.html`, `dashboard.component.html`
- Verified: `getContacts()` in customer-profile (fresh array allocation + sort per evaluation), `getPricingLinesForContract`/`ticketDisplayNumber` in contracts-table, `commodityChipClass` in dashboard — none memoized via `computed()`/pipes.
- **Related findings:** `angular.function-calls-in-template-bindings`
- **Suggested fix:** Convert the highest-traffic offenders (especially ones that sort/filter arrays) to `computed()` signals or pure pipes.

### Roughly half of standalone components skip OnPush change detection, compounding into full-tree re-evaluation (`performance.angular-onpush-coverage-gap`)
- **Files:** `activity-summary.component.ts`, `tickets-table.component.ts`, `edit-customer-dialog.component.ts`, `planting-intentions-table.component.ts`, `home.component.ts`
- Only 20 of 47 components declare `ChangeDetectionStrategy.OnPush`. `activity-summary` and `tickets-table` in particular do multiple filter/reduce/sort passes over arrays in plain getters rather than `computed()`. Systemic risk that compounds any `AppStateService` signal update into full-tree re-evaluation.
- **Related findings:** `angular.inconsistent-onpush-adoption`
- **Suggested fix:** Adopt OnPush as the default for new/touched components; prioritize the customer-profile subtree (home -> contracts-table, tickets-table, activity-summary) first.

## Low (open)

### Every usage-dashboard widget endpoint independently re-resolves the same user-scope set (`performance.usage-dashboard-duplicate-scope-resolution-per-widget`)
- **Files:** `Services/UsageDashboardService.cs`, `Infrastructure/Repositories/UsageRepository.cs`
- The usage-dashboard page fires roughly nine separate widget requests on load (`summary`, `users`, `daily-active`, `feature-sessions`, `weekly-trend`, `activity-breakdown`, `underused-features`, `query-library-usage`, `query-search-gaps`), and each one independently calls `GetUserIdSetAsync`, which re-queries `UserTradeUnitSnapshots`/subtree lookup and `UsageDashboardExcludedUsers` from scratch for the same `(tradeUnitKey, managerId)` pair. `AppAccessService.GetAccessSetAsync` — the costlier external-facing piece of the same chain — is already `IMemoryCache`-backed; this is the one remaining uncached piece.
- Each underlying query targets a small table with no join fan-out, so this is an inferred, low-impact optimization opportunity, not a measured bottleneck.
- **Suggested fix:** Cache the resolved user-id set per `(tradeUnitKey, managerId)` with a short TTL, mirroring the `AppAccessService` pattern.

## Resolved

### N+1 query in bid-insert race-reconciliation retry path is broader than initially scoped (`performance.bidsheet-reconcile-n-plus-one`) — medium
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/BidSheetRepository.cs`
- Was: `ReconcileDuplicateBidInsertsAsync` looped over EVERY ChangeTracker entry in `EntityState.Added`, issuing one `FirstOrDefaultAsync` per entity. Now (verified 2026-09-21): a single batched query loads all candidates by distinct `LocationId`/`CropYear`, reconciled in-memory via a dictionary keyed on `(LocationId, CommodityCode.ToUpperInvariant(), CropYear, Month)`. See `BidSheetRepository.cs:463-503`.

### Per-row template binding invokes an O(tickets x contracts) getter on every change-detection pass (`performance.tickets-table-spot-loads-quadratic-getter`) — critical
- **Files:** `features/customers/components/tickets-table/tickets-table.component.html`, `.ts`
- Was: `spotTicketIds` was a plain TS getter rebuilding a Set by iterating every ticket and scanning every contract, recomputed on every CD cycle app-wide. Now (verified 2026-09-21): `spotTicketIds` is a `computed<Set<number>>()` at `tickets-table.component.ts:132`, recomputing only when `tickets()`/`contracts()` change. Component still lacks `ChangeDetectionStrategy.OnPush`, tracked separately under `performance.angular-onpush-coverage-gap`.

## Won't fix / Accepted

### Redundant re-fetch in ProducerDetailsRepository.UpsertAsync (`performance.producer-details-redundant-refetch`) — low, wont_fix
- Duplicate of `dotnet.redundant-refetch-producer-details`; tracked and dispositioned there.

### GroupTradeUnits.GroupId FK has no supporting index in a stale bootstrap script for a table no longer in the live schema (`performance.grouptradeunits-missing-index`) — low, wont_fix
- Duplicate of `sql.grouptradeunits-fk-missing-index`. The table is dropped in the real migrated schema (superseded by `vw_UserTradeUnitAccess`); not worth indexing a script that recreates a dead table.

### ProducerDetails upsert deletes and reinserts all child rows instead of diffing (`performance.producerdetails-child-table-rebuild-on-every-save`) — low, accepted
- Row counts per customer are small; not a throughput risk today. Related to the rejected re-fetch finding above.

## Overall health

The codebase shows clear signs of prior, deliberate perf work — batched EF queries with in-memory dictionary joins, `AsNoTracking` on read paths, contract-scoped ticket loading with documented before/after context, memoized delivery-stats caching, and thoughtful query-narrowing comments. Both write-side and render-side critical/medium gaps found in the initial pass (the tickets-table quadratic getter and the bid-insert reconciliation N+1) are confirmed fixed in code and remain so a week later. Remaining open gaps are a cluster of Angular data-table components that never adopted OnPush or `computed()` memoization (contracts-table being the highest-traffic offender) — correctness-safe today but a compounding render-cost risk as data volume grows. The CTRM GraphQL integration merged since the last pass is, if anything, a model example of this codebase's performance discipline: every batching/concurrency/caching decision is measured and the measurements are left in the code as comments. No sync-over-async, missing-pagination, or bundle-bloat issues were found in production code. Highest-value next step unchanged: convert contracts-table to OnPush + `computed()`, closing the last high-severity gap and most of the systemic OnPush-coverage finding in one pass.
