# Audit: Code Review (`code-review`)

Scope: correctness bugs, race conditions, and logic errors across `api/` and `client/` not already covered by the dotnet/angular/sql style-guide audits

**Findings:** 19 total — 19 resolved, 0 open
**Opened:** 2026-09-19 | **Reconciled:** 2026-09-21 | **Spot-checked:** 2026-09-28

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

## 2026-09-28 calibration pass

Scope for this run: a `code-review`-only pass from the Code Quality Dashboard calibration queue (`audit/pilot-20260928`), one domain per invocation. This is a spot-check-plus-fresh-sample reconciliation, not a from-scratch review.

**Spot-check of prior findings.** Re-verified 2 of the 19 resolved findings against current code (`code-review.dashboard-cache-missing-year-key`, `code-review.dashboard-summary-load-race`) — both still hold, no regressions. One note: the original re-verification note said the cache-key field was named `plantingYear`; the actual field is `year` (`app-state.service.ts` `DashboardCacheEntry.year`). This is a naming drift in the *note text*, not a code regression — the field exists, is documented, and the restore guard in `dashboard.component.ts` correctly checks it alongside `tradeUnitsKey`. Tracker notes corrected. The other 17 findings were not individually re-touched this pass (last verified 2026-09-21) — no code-level evidence of regression was found for them, but they were not re-read line-by-line here.

**Fresh sample of new churn.** 98 commits touched `api/`/`client/` since the 2026-09-21 reconciliation (CTRM GraphQL aliased-batching perf work, organic producer badge, grain-on-farm keyed by commodity code instead of crop group, trade-unit names from preferences, planting-intentions trade-unit assignment, a date-off-by-one fix). Sampled the highest-risk new code by hand:

- `CtrmContractReader.cs` / `CtrmTradeUnitThrottle.cs` (new GraphQL-aliased batching, its own concurrency pool, stale-while-revalidate cache, interactive-vs-background throttle priority) — dense but correct; cache-entry lifecycle (deferred `Lazy<Task>`, `Previous` carry-forward, sweep-by-prefix grace periods) reasoned through and no correctness gap found. Heavily commented with measured rationale and backed by dedicated throttle/aliasing tests.
- `merge-producer-rows.ts` (new dedupe/replace/retract logic for producer row merges) — retract-by-previous-ids-not-by-code reasoning is sound, no gap found.
- `organic-visibility.ts` (new OR-of-two-conditions gate for the organic section) — exact-match code comparison, guarded empty-string NOP id; no gap found.
- `grain-on-farm.ts` (post-migration code/group dual-read logic for the crop-group → commodity-code rename) — legacy-vs-code detection and fallback display logic hold up under the documented edge cases (deactivated commodity, catalog not yet loaded).
- `googleMapsSearchUrl()` (new producer-address Google Maps link) — properly uses `encodeURIComponent` on the query, no injection/malformed-URL risk.

**Result: no new findings opened.** The sampled new code is well-tested (the CTRM batching commit alone added/extended two test files) and follows the same request-id/cache-key discipline the original 19 findings pushed this codebase toward. Residual risk: 98 commits of churn is too much to review exhaustively in one bounded pass — files not sampled (`PlantingIntentionService.cs`, the controller/response DTO changes, `usage-tracking.service.ts`, `nlq-filter.service.ts`, most of the customer-list/customer-profile/tickets-table diffs) carry the same residual risk any unreviewed diff does. If a future pass has more budget, `PlantingIntentionService.ResolveTradeUnitAsync` (new trade-unit-choice validation logic, api/GrainOriginatorPortal.Api/Services/PlantingIntentionService.cs) is the next-highest-value target — it's new business logic with real data-integrity stakes (mis-assigning a producer's planted acres to the wrong trade unit was the bug the 2026-09-21 fix commit addressed) and was not read this pass.
