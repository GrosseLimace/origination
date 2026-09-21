# Audit: Code Review (`code-review`)

Scope: correctness bugs, race conditions, and logic errors across `api/` and `client/` not already covered by the dotnet/angular/sql style-guide audits

**Findings:** 19 open — 0 critical, 9 high, 9 medium, 1 low
**Opened:** 2026-09-19 | **Last verified:** 2026-09-19

## High

### Dashboard's cached-data restore ignores the selected planting year, only checks trade unit (`code-review.dashboard-cache-missing-year-key`)
- **Files:** `dashboard.component.ts`, `app-state.service.ts`
- `DashboardCacheEntry` has no year field; `selectedPlantingYear` resets to the current year on every component construction while the cache survives navigation. Changing planting year, navigating away, and returning silently re-applies figures from whichever year was last cached.
- **Related findings:** `angular.god-components-zero-test-coverage`
- **Suggested fix:** Add `plantingYear` to `DashboardCacheEntry` and require it to match `selectedPlantingYear()` before restoring.

### _loadDashboardData has no stale-response guard, unlike its sibling loaders in the same file (`code-review.dashboard-summary-load-race`)
- **Files:** `dashboard.component.ts`
- Unlike sibling loaders that increment `_loadRequestId` and check it before applying results, `_loadDashboardData` applies responses unconditionally. Rapid year/TU navigation lets an older response overwrite newer data.
- **Suggested fix:** Apply the same `_loadRequestId` guard used by the other loaders.

### Saved-list NLQ result cache (customerIds) is never invalidated as the customer roster grows (`code-review.saved-list-cache-stale-on-customer-roster-growth`)
- **Files:** `customer-list.component.ts`
- The cache resets only on trade-unit change or list switch, not when `customers()` grows via progressive per-producer merges. Newly-arrived customers that would match stay silently excluded from results.
- **Suggested fix:** Invalidate the cache whenever `customers()` materially changes.

### Selecting a linked producer never cancels in-flight per-customer fetches, unlike every other selection path (`code-review.linked-customer-select-missing-cancel`)
- **Files:** `home.component.ts`
- `handleSelectLinkedCustomer` skips the `_cancelSelection$.next()` call every other selection path makes. Clicking linked producer B then C quickly can let B's stale fetch overwrite C's displayed data.
- **Suggested fix:** Call `_cancelSelection$.next()` at the top of `handleSelectLinkedCustomer`.

### Planting-intentions cache-hit path never bumps the in-flight request counter, unlike the cache-miss path (`code-review.planting-intentions-request-id-cache-hit-gap`)
- **Files:** `home.component.ts`
- The cache-hit branch sets signals directly without bumping `_piRequestId`, so an older in-flight fetch can still land and overwrite freshly-restored cached data.
- **Suggested fix:** Increment `_piRequestId` on every selection path, including the cache-hit branch.

### DP-contracts fetch in build-list can reapply stale-trade-unit data after the shared cache was correctly reset (`code-review.build-list-dp-contracts-stale-tu-race`)
- **Files:** `build-list.component.ts`, `app-state.service.ts`, `data-preload.service.ts`
- `_ensureDpForQuery()` has no request-id or TU-match check on its response handler, only a concurrency guard. Switching trade units mid-fetch can let a stale response re-flip `dpContractsLoaded=true` with the wrong TU's rows, corrupting a cache shared app-wide.
- **Suggested fix:** Capture the trade-unit key at fetch start and discard the response if `selectedTradeUnits()` no longer matches it.

### Ticket self-heal effect can adopt another trade unit's ticket data (`code-review.stale-cross-tradeunit-tickets-adopted`)
- **Files:** `build-list.component.ts`
- `_appStateTicketsEffect` compares array lengths with no check that the appState data belongs to the currently selected trade unit; `DataPreloadService` clears that cache independently with no ordering guarantee, opening a window where a query silently runs against the wrong trade unit's deliveries.
- **Suggested fix:** Tag cached ticket data with the trade-unit key it was fetched for before adopting it.

### Free-text unconfirmed-contract NLQ query uses narrower logic than the canonical rule used everywhere else (`code-review.nlq-unconfirmed-contract-excludes-null-status`)
- **Files:** `nlq-filter.service.ts`, `contract-status.ts`
- Inline check requires a non-null status; the canonical `isContractUnconfirmed()` (used by Insights and the refine-panel checkbox) treats NULL/empty as unconfirmed too — the most common unconfirmed case is silently dropped from Build A List text queries.
- **Suggested fix:** Replace the inline check with a call to `isContractUnconfirmed(ct)`.

### New bid-sheet location inserts aren't protected against the same unique-constraint race the rest of the class handles (`code-review.bulk-bid-location-insert-race`)
- **Files:** `BidSheetRepository.cs`
- `BulkUpsertBidsAsync` saves new `BidSheetLocation` rows with no try/catch, unlike `CreateLocationAsync`/`UpdateLocationAsync` which both reconcile unique violations. A concurrent duplicate-location race loses the whole bulk batch.
- **Related findings:** `sql.n-plus-one-bid-insert-reconciliation`
- **Suggested fix:** Wrap the new-location save in the same unique-violation catch/reconcile pattern used elsewhere in the class.

## Medium

### CreateLocationAsync/UpdateLocationAsync's reconcile-the-race catch block never actually reconciles anything (`code-review.reconcile-only-handles-bids-not-locations`)
- **Files:** `BidSheetRepository.cs`
- The catch calls `ReconcileDuplicateBidInsertsAsync()`, which only inspects `BidSheetLocationBid` entities, never `BidSheetLocation` — the call always returns false and rethrows, making the log/comment misleading.
- **Related findings:** `sql.n-plus-one-bid-insert-reconciliation`, `code-review.bulk-bid-location-insert-race`
- **Suggested fix:** Implement real location-collision reconciliation, or remove the misleading catch/log.

### Dashboard upsert methods scope their existing-row lookup to item[0]'s TradeUnitKey/Year, not each item's own (`code-review.dashboard-upsert-batch-scope-assumption`)
- **Files:** `DashboardRepository.cs`
- A batch containing items for different TU/Year combos gets mis-scoped against item 0's map, throwing on the unique index and aborting the whole transaction.
- **Suggested fix:** Key `existingMap` off the full (TradeUnitKey, PlantingYear, Crop) tuple across all distinct combinations present.

### Usage tracking silently drops every request that ends in an unhandled exception (`code-review.usage-tracking-drops-requests-on-exception`)
- **Files:** `UsageTrackingMiddleware.cs`, `Program.cs`
- Registered inside the exception handler's scope; if the downstream call throws, the activity record is never written, undercounting error-rate/session data for the failures that matter most.
- **Related findings:** `dotnet.security-audit-middleware-dead-code`
- **Suggested fix:** Wrap the downstream call in try/finally so the activity record is always recorded.

### GeocodeService.SearchAsync caches only the first result but returns the full list, so a later cache hit silently truncates to 1 (`code-review.geocode-search-cache-truncates-results`)
- **Files:** `GeocodeService.cs`
- A cache miss returns up to 5 candidates but caches only the first; the next identical search returns just that one point.
- **Suggested fix:** Cache the full result list keyed by query+limit, or skip caching multi-result searches.

### GeocodeBatchAsync doesn't use the shared rate-limiting semaphore, allowing bursts past Nominatim's 1 req/sec policy (`code-review.geocode-batch-bypasses-rate-limiter`)
- **Files:** `GeocodeService.cs`
- Only self-paces with its own internal delay; concurrent callers can burst past the documented rate limit and risk an IP-level throttle.
- **Suggested fix:** Have `GeocodeBatchAsync` acquire the shared rate limiter like `GeocodeSingleAsync` does.

### In-flight HTTP request dedup cache can be evicted while the underlying call is still pending (`code-review.api-dedupe-finalize-fires-per-subscriber`)
- **Files:** `api.service.ts`, `data-preload.service.ts`
- `finalize` sits downstream of `shareReplay`, so teardown runs per-subscriber, not once when the shared call completes. Switching trade units and back before the original response lands fires a duplicate HTTP request.
- **Suggested fix:** Move `finalize` upstream of `shareReplay`.

### Contract pacing is computed two different, contradictory ways in the same service (`code-review.nlq-pacing-open-vs-all-contracts-mismatch`)
- **Files:** `nlq-filter.service.ts`
- The free-text pacing handler uses open contracts only; the refine-panel flag uses all contracts regardless of closed status — same business question, two different answers from the same file.
- **Suggested fix:** Pick one contract set and use it consistently in both blocks.

### Manage-Members customer search has no in-flight request cancellation (`code-review.member-search-missing-cancellation`)
- **Files:** `build-list.component.ts`
- `searchMembers()` debounces via `setTimeout` but doesn't cancel an already-in-flight request; overlapping requests can resolve out of order and show stale results.
- **Related findings:** `angular.god-components-zero-test-coverage`
- **Suggested fix:** Route through an RxJS `Subject` + `switchMap` instead of raw `setTimeout`+subscribe.

### A refine change can be permanently stranded if it lands while a different note-scope fetch is in flight (`code-review.scoped-notes-fetch-supersession-gap`)
- **Files:** `build-list.component.ts`
- `_ensureNotesForQuery` is a no-op while a fetch is in flight, silently dropping the request for a newly staged scope; nothing re-invokes it once the older fetch resolves.
- **Related findings:** `angular.god-components-zero-test-coverage`
- **Suggested fix:** Re-check the current desired scope when a scoped-notes fetch resolves and re-fire if it has changed.

## Low

### Ticket dates compared with local-time getters can misclassify Jan 1 tickets (`code-review.ticket-date-local-getters-year-boundary`)
- **Files:** `build-list.component.ts`, `ticket.model.ts`
- `hasDeliveriesThisYear` reads a local-time `getFullYear()` on a UTC-midnight-parsed date string; in any US timezone a Jan 1 ticket can render as Dec 31 of the prior year.
- **Suggested fix:** Parse with UTC-aware getters instead of local-time `Date` getters.

## Overall health

Correctness health is mixed-to-good at the "obvious bug" level (no crashes, no gross logic inversions) but weak at the concurrent/rapid-interaction level, especially in the untested Angular god components. Six of the nineteen findings above share the same root-cause pattern — a fetch's response handler applies data without checking whether the selection/trade-unit/year context it was requested for is still current — recurring independently across home, dashboard, build-list, and customer-list. This strongly suggests a shared "stale-response guard" utility/pattern rather than six one-off patches, and directly explains why the zero-test-coverage finding on those same files is high-priority: these are exactly the races unit tests would have caught. On the .NET side, bugs are more isolated and generally have narrower blast radius.
