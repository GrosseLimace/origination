# Audit: Performance (`performance`)

Scope: EF Core query patterns and repositories under `api/`, Angular change-detection/template patterns under `client/`, SQL indexing

**Findings:** 8 total — 3 open (1 high, 2 medium), 2 resolved (1 critical, 1 medium), 2 wont_fix (low), 1 accepted (low)
**Opened:** 2026-09-19 | **Last verified:** 2026-09-21

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

The codebase shows clear signs of prior, deliberate perf work — batched EF queries with in-memory dictionary joins, `AsNoTracking` on read paths, contract-scoped ticket loading with documented before/after context, memoized delivery-stats caching, and thoughtful query-narrowing comments. Both write-side and render-side critical/medium gaps found in the initial pass (the tickets-table quadratic getter and the bid-insert reconciliation N+1) are now confirmed fixed in code. Remaining open gaps are a cluster of Angular data-table components that never adopted OnPush or `computed()` memoization (contracts-table being the highest-traffic offender) — correctness-safe today but a compounding render-cost risk as data volume grows. No sync-over-async, missing-pagination, or bundle-bloat issues were found in production code. Highest-value next step: convert contracts-table to OnPush + `computed()`, closing the last high-severity gap and most of the systemic OnPush-coverage finding in one pass.
