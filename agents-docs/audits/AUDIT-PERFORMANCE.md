# Audit: Performance (`performance`)

Scope: EF Core query patterns and repositories under `api/`, Angular change-detection/template patterns under `client/`, SQL indexing

**Findings:** 8 open — 1 critical, 1 high, 3 medium, 3 low
**Opened:** 2026-09-19 | **Last verified:** 2026-09-19

## Critical

### Per-row template binding invokes an O(tickets x contracts) getter on every change-detection pass (`performance.tickets-table-spot-loads-quadratic-getter`)
- **Files:** `features/customers/components/tickets-table/tickets-table.component.html`, `.ts`
- `tickets-table.component.html` calls `spotTicketIds.has(ticket.id)` inside a `@for` over `group.tickets`. `spotTicketIds` is a plain TS getter, not a `computed()`, that rebuilds a Set by iterating every ticket and, for each unapplied one, running `contracts.some(...)` over the full contracts array. With no `ChangeDetectionStrategy.OnPush`, this recomputes on every CD cycle triggered anywhere in the app, multiplying rendered-row-count x ticket-count x contract-count work. For a producer with hundreds of tickets and dozens of contracts, this is a real, likely user-visible jank source on the Tickets tab.
- **Related findings:** `angular.function-calls-in-template-bindings`
- **Suggested fix:** Convert `spotTicketIds` (and the sibling `unappliedTickets` getter) to `computed()` signals, and add `ChangeDetectionStrategy.OnPush`.

## High

### Primary contracts table has no OnPush and repeats uncached per-row lookups in template bindings (`performance.contracts-table-missing-onpush-uncached-bindings`)
- **Files:** `features/customers/components/contracts-table/contracts-table.component.ts`, `.html`
- Declares no `changeDetection` (defaults to `Default`), so it re-runs full change detection on every app-wide tick. Its template calls `getAppliedTickets(contract)` (an unmemoized `.filter()` over the full tickets input) and `getPricingInfo(contract)` up to 3 times per row, plus `getPricingLinesForContract(contract)` 4-5 times per expanded row — on the most frequently opened customer-profile screen.
- **Related findings:** `angular.function-calls-in-template-bindings`
- **Suggested fix:** Add `ChangeDetectionStrategy.OnPush`; memoize `getAppliedTickets`/`getPricingInfo` per contract (mirroring the existing `pricingLinesMap`/`_deliveryStatsCache` pattern already used for `getDeliveryStats`).

## Medium

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

### N+1 query in bid-insert race-reconciliation retry path is broader than initially scoped (`performance.bidsheet-reconcile-n-plus-one`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/BidSheetRepository.cs`
- `ReconcileDuplicateBidInsertsAsync` loops over EVERY ChangeTracker entry in `EntityState.Added`, not just the one that triggered the unique-constraint exception, issuing one `FirstOrDefaultAsync` per entity. A single unique-constraint race during a large bulk upsert fans out to one round trip per pending insert, not just per actual collision.
- **Related findings:** `sql.n-plus-one-bid-insert-reconciliation`
- **Suggested fix:** Batch-load all potentially colliding rows in one query keyed by the tuple set, then reconcile in memory (mirroring `BulkUpsertBidsAsync`).

## Low

### Redundant re-fetch in ProducerDetailsRepository.UpsertAsync (`performance.producer-details-redundant-refetch`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/ProducerDetailsRepository.cs`
- Calls `GetGrainOnFarmAsync`/`GetContactsAsync` immediately after `SaveChangesAsync`, re-reading rows already known in memory a few lines earlier.
- **Related findings:** `dotnet.redundant-refetch-producer-details`
- **Suggested fix:** Project the response directly from the in-memory `grainItems`/`contactItems` collections instead of re-querying after save.

### GroupTradeUnits.GroupId FK has no supporting index in a stale bootstrap script for a table no longer in the live schema (`performance.grouptradeunits-missing-index`)
- **Files:** `scripts/qa-setup.sql`, `api/GrainOriginatorPortal.Infrastructure/Data/Migrations/20260513051734_RemoveTradeUnitCatalog.cs`
- `qa-setup.sql` creates `GroupTradeUnits` with an unindexed FK, but EF migration `RemoveTradeUnitCatalog` drops this exact table in the real migrated schema (superseded by `vw_UserTradeUnitAccess`). Exposure is limited to legacy QA setups still running the stale script, not live production traffic.
- **Related findings:** `sql.grouptradeunits-fk-missing-index`
- **Suggested fix:** Remove the stale `GroupTradeUnits` table-creation block from `qa-setup.sql` now that the table is superseded/dropped, rather than adding an index to a script recreating a dead table.

### ProducerDetails upsert deletes and reinserts all child rows instead of diffing (`performance.producerdetails-child-table-rebuild-on-every-save`)
- **Files:** `api/GrainOriginatorPortal.Infrastructure/Repositories/ProducerDetailsRepository.cs`
- Unconditionally `RemoveRange`s and re-adds full child row sets (CustomerLink, CustomerCommodity, ProducerGrainOnFarm, ProducerContact) on every save rather than diffing. Low priority given small per-customer row counts, but generates unnecessary audit/identity churn.
- **Related findings:** `dotnet.redundant-refetch-producer-details`
- **Suggested fix:** Low priority; if ever revisited, diff existing vs. incoming rows and only add/remove/update deltas.

## Overall health

The codebase shows clear signs of prior, deliberate perf work — batched EF queries with in-memory dictionary joins, `AsNoTracking` on read paths, contract-scoped ticket loading with documented before/after context, memoized delivery-stats caching, and thoughtful query-narrowing comments. Real gaps cluster in two places: (1) a handful of Angular data-table components that never adopted OnPush or `computed()` memoization, the worst being tickets-table's quadratic `spotTicketIds` getter, a genuine confirmed hotspot on a high-traffic screen; and (2) small, low-frequency redundant round trips on the .NET write side that are correctness-safe but wasteful. No sync-over-async, missing-pagination, or bundle-bloat issues were found in production code. Highest-value next step: convert tickets-table and contracts-table to OnPush + `computed()`, addressing both the critical finding and the broader systemic gap in one pass.
