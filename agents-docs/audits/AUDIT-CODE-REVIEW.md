# Audit: Code Review (`code-review`)

Scope: correctness bugs, race conditions, and logic errors across `api/` and `client/` not already covered by the dotnet/angular/sql style-guide audits

**Findings:** 19 total — 19 resolved, 0 open
**Opened:** 2026-09-19 | **Reconciled:** 2026-09-21

## Reconciliation summary

This is the deep-verify pass for the `code-review` domain, mirroring the reconciliation already done for dotnet/angular/sql/error-handling/logging/permissions/clean-slop. The tracker (`AUDIT-TRACKING.json`) already carried a blanket "resolved via PR #615" note on all 19 findings from an earlier bulk status update; this pass individually re-verified each finding against the current state of the referenced file(s) rather than trusting that blanket claim.

**Result: all 19 are genuinely fixed.** Every finding's specific fix was located in the current code (exact line/pattern cited in each tracker entry's `[2026-09-21 re-verified]` note) — no regressions, no partial fixes, no findings that need reopening. Highlights of what's now in place:

- `DashboardCacheEntry` carries a `plantingYear` field as part of its cache key; `_loadDashboardData` now guards on `_loadRequestId` like its siblings.
- The saved-list NLQ cache re-runs when `customers()` grows; `handleSelectLinkedCustomer` cancels prior in-flight fetches; the planting-intentions cache-hit path bumps `_piRequestId`.
- `_ensureDpForQuery` and `_appStateTicketsEffect` both now check the currently-selected trade unit before adopting a response/cache value, closing the two build-list cross-trade-unit races.
- The free-text unconfirmed-contract query now calls the canonical `isContractUnconfirmed()`; the free-text and refine-panel pacing calculations both use the full contract set now, resolving their prior contradiction.
- `BidSheetRepository.BulkUpsertBidsAsync` wraps new-location inserts in the same unique-violation catch/reconcile pattern as the rest of the class, backed by a real `ReconcileDuplicateLocationInsertsAsync` (previously the reconcile call only ever inspected bid entities).
- The three `DashboardRepository` upsert methods now group by (TradeUnitKey, PlantingYear) and build a fresh existing-row map per group, instead of assuming every item in a batch shares item 0's scope.
- `UsageTrackingMiddleware` records the activity record in a `finally` so requests that end in an unhandled exception are no longer invisible to usage analytics.
- `GeocodeService.SearchAsync` caches the full result list (not just the first result); `GeocodeBatchAsync` now acquires the shared rate-limiting semaphore per item.
- `ApiService._dedupe()` moved `finalize` upstream of `shareReplay`, so the in-flight cache entry is only evicted when the shared HTTP call itself completes, not on a single subscriber's teardown.
- Manage-Members search now cancels the prior in-flight request via a dedicated `Subject`; the scoped-notes fetch path now retries a superseded scope once the blocking fetch resolves instead of stranding it.
- `hasDeliveriesThisYear` reads `getUTCFullYear()` instead of a local-time getter, fixing the Jan 1 misclassification for US time zones.

No new findings were opened in this pass — the sampled areas (dashboard, build-list, home, customer-list races; bid-sheet/dashboard repository upsert logic; geocode service; NLQ filter service) showed no additional correctness issues beyond what was already tracked.

## Overall health

Correctness health for this domain is now good: every previously-identified race condition, stale-cache path, and logic mismatch in the sampled Angular components and .NET repositories/services has a confirmed, code-verified fix. The original observation still stands as useful context for future work — six of the original nineteen findings shared the same root-cause pattern (a fetch's response handler applying data without checking whether the selection/trade-unit/year context it was requested for was still current), recurring independently across home, dashboard, build-list, and customer-list. That the fixes landed as targeted per-site guards (request IDs, trade-unit-key comparisons, cache-key year fields) rather than a single shared utility is an acceptable outcome given each site had slightly different cancellation semantics, but a shared "stale-response guard" helper would still be worth extracting if a similar race turns up in new code.
