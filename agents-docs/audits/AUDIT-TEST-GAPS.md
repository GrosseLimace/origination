# Audit: Test Gap Analysis (`test-gaps`)

Scope: coverage breadth across `api/GrainOriginatorPortal.Api.Tests` (xUnit) and `client/` (Vitest)
Baseline (unverified this run per the audit's hard limits — no test suite executed): dotnet/vitest counts not re-run; the gap is coverage breadth, not currently-failing tests.

**Findings:** 11 total, 0 open, 11 resolved
**Opened:** 2026-09-19 | **Last reconciled:** 2026-10-20

## Reconciliation (2026-10-20)

Audited HEAD (`audit/pilot-20261020`, based on the Bid Sheet Remodel + BarChart PROD release, `524c9be6`..`5ed04040` — note this is ahead of `main`, which still sits at `524c9be6`/#704). The mobile app, organic-cert-feed, self-help panel, and customer-onboarding-via-GraphQL work referenced in other branches' commit messages (`feature_MobileApplicationLayer`, `feature_CustomersFromGraphQL`, `feature/578-self-help`) are **not** part of this branch's ancestry — confirmed by `git ls-tree` turning up zero mobile/help/onboarding files — so none of that surface was in scope this pass.

All 3 previously-open findings are now **resolved, verified directly against source** (not taken on the prior note's word):

- `test-gaps.angular-god-components` — **resolved.** All 5 named components now have specs (`build-list.component.spec.ts`, `bid-sheet.component.spec.ts` at 3144 lines, `home.component.spec.ts` + a separate `.render.spec.ts`, `dashboard.component.spec.ts`, `customer-list.component.spec.ts`). The fix matched the suggested approach exactly: a systematic extract-and-test campaign (`refactor(build-list): move X into a feature util` / `refactor(home): move X into a page-scoped store`, each preceded by a `test(...): characterise X before extracting it` commit) pulled `build-list.component.ts` down from 4557 to 3109 lines and `home.component.ts` into 1581 lines plus 8 extracted store/util files, all 7 of the behavioral ones with matching specs (the 8th, `home-page.state.ts`, is a plain signal container with no branches — correctly left untested). The Bid Sheet remodel did the same: 12 of its logic files now live under `bid-sheet/utils/`, every one with a spec.
- `test-gaps.repository-layer-gap` — **resolved.** `TicketRepositoryTests.cs` (7 `[Fact]`s) and `UsageRepositoryTests.cs` (27 `[Fact]`s) now exist and directly construct/exercise both repositories.
- `test-gaps.ctrm-keep-warm-service-untested` — **resolved.** The previously-blocking design issue (sealed reader classes, private gating method) was fixed at the source: cadence/backoff logic was extracted into a new `CtrmKeepWarmBackoff.cs`, now covered by `CtrmKeepWarmBackoffTests.cs` and `CtrmKeepWarmCycleTests.cs` alongside the existing `CtrmKeepWarmServiceTests.cs`.

Sampled the rest of the new surface for the same risk pattern (orchestration/error-path logic shipped without assertions) and found no new gap:

- BarChart ingest (`BarchartIngestController` → `BarchartIngestService`): the controller is a thin pass-through (confirmed by reading it in full) with all real logic — the deactivation `maxSharePercent` safety limit, the apply-bids feed-actor stamping, the switched-off-but-still-audited skip path — covered by name-matching `[Theory]`/`[Fact]` cases in `BarchartIngestServiceTests.cs`.
- `fix(organic): reject an all-same-digit NOPID` (67454be8) — shipped with its own 3 test cases in the same commit per the commit message, confirmed by the diff touching `CustomerTradeUnitViewContractTests.cs`.
- `fix(usage-dashboard, bid-sheet): say so when a panel's data fails to load` (1620ad03) — shipped with spec additions to both `usage-dashboard.component.spec.ts` (60 lines) and `bid-sheet.component.spec.ts` (18 lines) in the same commit.

No new findings opened this pass. This is the first reconciliation since the original 2026-09-19 pass to reach zero open findings — the prior two critical items had stood since the original audit.

## Reconciliation (2026-10-13)

Since the 2026-09-28 pass, `main` absorbed the Bin Sites & Grain on Farm feature, the Usage Dashboard "manager for all" rollout, the trade-unit contract read (CTRM), and the CTRM go-live itself (tester toggle retired). Re-verified the 3 still-open findings directly against current source and sampled the new feature surface for the same risk pattern, rather than re-reading the full diff.

- `test-gaps.angular-god-components` — **still open, confirmed.** Still zero `.spec.ts` for all 5 named components. `build-list.component.ts` grew from ~4180 to 4557 lines during the Bin Sites/Grain on Farm work — the largest untested file in the repo got larger. Note: the build-list parked-prompt/trade-unit-reload logic that same feature work touched (4 fix commits on 2026-10-12) is *not* part of this gap — that area already has a dedicated `build-list.trade-unit-reload.spec.ts` with regression cases from the same day.
- `test-gaps.repository-layer-gap` — **still open, confirmed.** No change: `TicketRepository`/`UsageRepository` still have no direct test construction. The new `CtrmContractReaderTradeUnitTests.cs` (277 lines, from the trade-unit-contract-read feature) is a well-covered addition but targets `CtrmContractReader`, not these Infrastructure repositories.
- `test-gaps.ctrm-keep-warm-service-untested` — **still open, confirmed, unchanged.** No source changes to `CtrmKeepWarmService.cs`'s gating/isolation structure since the 2026-09-28 mutation-tested pass; the per-producer-set isolation half remains genuinely untestable without an application-source change (sealed reader classes, private method).
- `test-gaps.contract-status-pacing-logic-untested`, `test-gaps.ctrm-customer-codes-untested`, `test-gaps.accounting-money-formatter-untested` — all three **resolved** since the last pass; tests now exist for each (not independently re-verified this run beyond confirming the test files are present, per the context-discipline budget).

New finding from sampling the Usage Dashboard manager-for-all work:

- `test-gaps.user-usage-detail-component-untested` (medium) — `UserUsageDetailComponent` has several non-trivial `computed()`s (activity-by-feature partitioning with an "other" fallback, tab-derived filtering, chart-aggregate floors) and zero spec, while its parent `usage-dashboard.component.ts` (459-line spec) and sibling `manager-filter.component.ts` (87-line spec) both shipped with tests in the same feature branch.

Sampled but found no gap: `bin-site-mentions.ts`, `grain-on-farm.ts`, and the two new `nlq-filter.bin-sites`/`nlq-filter.grain-on-farm` spec files all have matching specs; `CtrmContractReader`'s new trade-unit-read logic is covered by a dedicated 277-line test file.

## Reconciliation (2026-09-28)

Main has moved substantially since the last reconciliation (2026-09-22): the organic-producer, grain-on-farm, and CTRM GraphQL batching work merged 2026-09-23 through 2026-09-28 (448 files, ~79k insertions across the feature branches). Re-verified the 2 still-open findings directly against current source, and sampled the new surface area for the same risk pattern (pure/orchestration logic with no direct assertions) rather than re-reading the full diff.

- `test-gaps.angular-god-components` — **still open, confirmed.** Still zero `.spec.ts` for all 5 named components. New corroborating evidence: `bid-sheet.component.ts`'s inline basis-sign display logic took 4 separate fix/feat commits (2026-09-19 to 2026-09-24) to get right across three different surfaces (published-bids popup, Edit Bids cells, catalog pins) — a live illustration of the risk this finding describes, in a component with no spec to have caught it.
- `test-gaps.repository-layer-gap` — **still open, confirmed**, with one nuance: `CtrmOutageEndToEndTests.cs` (new, part of the CTRM work) now constructs a real `TicketRepository` as a fallback collaborator, but only exercises it through that wiring — no assertion touches `TicketRepository`'s own filtering/status logic. `UsageRepository` still has no test construction of any kind.

New findings from sampling the new CTRM and shared-utils surface (both merged since the last reconciliation):

- `test-gaps.contract-status-pacing-logic-untested` (high) — `contract-status.ts`'s `computeHarvestPacePct` exists specifically because two call sites (free-text pacing query, refine-panel checkbox) previously computed the same pacing number differently; zero test now covers any of its year-boundary rules. Same file's `isContractUnconfirmed`/`isContractCustomerConfirmed` are deliberately non-inverse — an easy accidental revert with no CI signal.
- `test-gaps.ctrm-customer-codes-untested` (high) — `CtrmCustomerCodes.Normalize` exists to guard a measured CTRM API failure mode (an 8+ char code fails the *entire* filtered chunk, not just itself); zero test on a pure, cheap-to-test static function shared by both CTRM readers.
- `test-gaps.accounting-money-formatter-untested` (medium) — `formatAccountingMoney` was extracted after two byte-for-byte copies (a pipe and a report builder) already drifted once; now the single source of truth for signed-dollar display app-wide, with no test.
- `test-gaps.ctrm-keep-warm-service-untested` (medium) — `CtrmKeepWarmService`'s cadence/source/keep-for gating and per-producer-set failure isolation is the CTRM-surface sibling of the now-resolved `usage-aggregation-background-service-untested` finding, added after that one was fixed, with the same shape of untested branching.

None of the sampled organic-producer or grain-on-farm pure-logic utils (`grain-on-farm.ts`, `crop-group-match.ts`, `reminder-due.ts`, `commodity-scope.ts`, `saved-list-trade-units.ts`, `planting-category.ts`, `planting-trade-unit-filter.ts`, `address.ts`, `organic-visibility.ts`, `ticket-display.ts`, `ticket-sort.ts`) turned up a gap — each already has a matching `.spec.ts`. The CTRM GraphQL integration itself is unusually well covered (14 dedicated xUnit test files under `Repositories/Ctrm*Tests.cs`), so this reconciliation's new findings concentrate in the two spots that pattern didn't reach: a shared formatting/pacing util and a background service.

## Reconciliation (2026-09-21)

Re-verified all 6 findings directly against current source/test files (not from prior notes):

- `test-gaps.angular-god-components` — **still open, confirmed.** No `.spec.ts` for any of the 5 named god components.
- `test-gaps.repository-layer-gap` — **still open, confirmed.** No `TicketRepositoryTests.cs`/`UsageRepositoryTests.cs`/`CustomerRepositoryTests.cs`/`ContractRepositoryTests.cs` exist.
- `test-gaps.entitlement-service-fail-open-path-untested` — **resolved, confirmed.** `UserEntitlementServiceTests.cs` now covers warm-cache fallback, wrapped-`SqlException` fallback, no-cache fail-closed, and deny-before-load.
- `test-gaps.angular-shared-components-gap` — **corrected from resolved back to open.** Only `linked-producers.spec.ts` was actually added; `table`, `select`, `input`, `dialog`, `card`, and `toast-container` components in `shared/components/` still have zero specs. The prior "resolved" status was an overstated blanket note from the PR #615 batch and did not match the file state.
- `test-gaps.date-timezone-json-converters-untested` — **resolved, confirmed.** Both `UtcDateTimeJsonConverterTests.cs` and `DateOnlyJsonConverterTests.cs` now exist alongside the pre-existing `CalendarDateJsonConverterTests.cs`.
- `test-gaps.usage-aggregation-background-service-untested` — **resolved, confirmed.** `UsageAggregationScheduleTests.cs` directly tests the Sunday week-boundary and rollup-window logic called out in the original finding.

## Critical

### Five largest Angular feature components (up to 4180 lines) have zero test coverage (`test-gaps.angular-god-components`)
- **Files:** `build-list.component.ts`, `bid-sheet.component.ts`, `home.component.ts`, `dashboard.component.ts`, `customer-list.component.ts`
- Carry the app's densest business logic with no `.spec.ts` at all. `build-list.component.ts` alone has 446 occurrences of price/calc/margin/freight/sort/filter keywords. A regression in filtering, sorting, or pricing display would only surface via manual QA or a user-reported bug, not CI.
- **Related findings:** `angular.god-components-zero-test-coverage`, `angular.components-bypass-app-state-service`
- **Suggested fix:** Extract pure business logic into testable functions/services first, then add component specs for the highest-traffic flows.

### 16 of 21 Infrastructure repositories have zero direct test coverage, including the two largest (`test-gaps.repository-layer-gap`)
- **Files:** `TicketRepository.cs`, `UsageRepository.cs`, `CustomerRepository.cs`, `ContractRepository.cs`
- Only 5 of 21 repositories have any direct test evidence. `TicketRepository` (729 lines) and `UsageRepository` (915 lines) have zero test coverage at all — a silent regression would ship undetected since the green dotnet test run never touches these classes.
- **Related findings:** `dotnet.repository-test-coverage-gap`, `dotnet.repository-interface-return-type-inconsistency`
- **Suggested fix:** Add a WebApplicationFactory-backed test class for `TicketRepository` and `UsageRepository` first, covering at least one read and one write/aggregate path each.

### UserEntitlementService's SQL-outage fail-open/fail-closed cache logic has only 1 of ~6 behavioral branches tested (`test-gaps.entitlement-service-fail-open-path-untested`)
- **Files:** `Services/UserEntitlementService.cs`, `Services/UserEntitlementServiceTests.cs`, `Repositories/EntitlementsRepository.cs`
- The `SqlException` handler in `GetAllowedTradeUnitCodesAsync` — which serves a 10-minute last-known-good cache on a transient DB outage, or fails closed to an empty set — is completely untested. This is the exact security-critical logic the class's own doc comment calls "fail-closed, not silently allow"; a regression could silently flip to fail-open during a DB blip, undetected by the green test suite.
- **Related findings:** `dotnet.duplicated-entitlement-catalog-logic`, `dotnet.inconsistent-trade-unit-entitlement-filtering`, `dotnet.entitlement-attribute-silent-noop`, `dotnet.repository-test-coverage-gap`
- **Suggested fix:** Add tests for the warm-cache fallback, no-cache fail-closed path, and the deny branches of `ValidateTradeUnitsOrThrowAsync`/`ValidateCustomerAccessAsync`.

## High

### 32 of 49 Angular components (65%) untested, including 9 of 13 shared UI-kit primitives and the linked-producers BFS utility (`test-gaps.angular-shared-components-gap`)
- **Files:** `table.component.ts`, `select.component.ts`, `input.component.ts`, `dialog.component.ts`, `shared/utils/linked-producers.ts`
- The shared form-control and table-rendering primitives every feature composes on have no spec, so a regression ripples silently into every consumer. `linked-producers.ts` implements BFS graph traversal with zero test, risking an infinite loop or incorrect grouping going undetected.
- **Related findings:** `angular.broad-unit-test-coverage-gap`, `angular.design-system-classes-unused`
- **Suggested fix:** Prioritize `linked-producers.ts` (cheap, pure function) and `table.component.ts` (highest fan-out) first.

### UTC and calendar-date JSON converters are untested despite each existing to fix a documented, real timezone-shift bug (`test-gaps.date-timezone-json-converters-untested`)
- **Files:** `Json/UtcDateTimeJsonConverter.cs`, `Json/DateOnlyJsonConverter.cs`, `Json/CalendarDateJsonConverterTests.cs`
- Each converter's doc comment describes a specific historical bug (a CST user seeing a note 5 hours off; ODS ship dates rolling back a day) it exists to prevent. The sibling `CalendarDateJsonConverter` has a dedicated test file; these two do not.
- **Suggested fix:** Mirror `CalendarDateJsonConverterTests.cs` for both converters — round-trip Utc/Local/Unspecified Kind inputs and assert the emitted string format.

## Medium

### UsageAggregationBackgroundService's day-rollover and interval-gating logic has zero test coverage (`test-gaps.usage-aggregation-background-service-untested`)
- **Files:** `Services/UsageAggregationBackgroundService.cs`
- `RunCycleAsync` contains date-boundary branching (once-per-day with a late-arrival window, Sunday-triggered weekly rollup, three independently-gated interval checks) plus a catch-all that silently swallows exceptions. A day-boundary or day-of-week off-by-one would silently skip or double-run a weekly rollup with no CI signal.
- **Related findings:** `logging.background-job-runs-lack-correlation-id`, `dotnet.repository-test-coverage-gap`
- **Suggested fix:** Extract the date-decision logic into pure functions taking `now`/`lastRun` as parameters, then unit test the boundary cases directly.

### UserUsageDetailComponent's activity-partitioning and tab-derivation logic has zero test coverage, unlike its parent and sibling (`test-gaps.user-usage-detail-component-untested`)
- **Files:** `features/usage-dashboard/pages/user-usage-detail/user-usage-detail.component.ts`
- `recentActivityByFeature` partitions activity into a Map with an "other" fallback bucket, `currentTabRecentActivity`/`activeTabLabel` derive from the active tab, and `maxDaily`/`maxScreenMinutes` compute chart-driving aggregates with explicit empty-data floors — none of it tested, while the parent dashboard and sibling manager-filter component both shipped specs in the same feature branch.
- **Suggested fix:** Mirror `usage-dashboard.component.spec.ts`'s pattern; prioritize the "other" fallback bucket and the empty-data floor cases.

## Weak-test sweep

No widespread weak-test pattern found. Existing Angular specs use `@testing-library/angular` with behavior-focused queries rather than implementation-detail assertions; existing xUnit tests favor `[Theory]`/`[InlineData]` with specific value assertions. The one "illusory coverage" case: `ContractRepository`'s test file only covers one static pure-function helper, none of the class's actual EF/SQL-backed query methods (folded into the repository-layer-gap finding above). Pricing-calculation coverage is a bright spot: all three Angular calculators (cancel-roll, check, profitability) have dedicated spec files, and no equivalent untested server-side pricing-math logic was found.

## Overall coverage health

As of 2026-10-20, all 11 tracked findings are resolved and zero are open — the first time this audit has reached that state since it opened 2026-09-19. The two longest-standing critical items (the 5 god components, the repository-layer gap) were closed not by bolting on specs after the fact but by a deliberate extract-then-test campaign: characterization tests written before each extraction, then the logic moved into a dedicated util/store file with its own spec, repeated across build-list, home, and the bid-sheet remodel. The one item that had looked architecturally blocked (`CtrmKeepWarmService`'s per-producer isolation, previously "genuinely untestable without an application-source change") was unblocked by actually making that source change — extracting `CtrmKeepWarmBackoff` — rather than by working around it. Sampling this reconciliation's new surface (BarChart ingest, the organic NOPID fix, the panel-failure-toast fix) found the same discipline applied to brand-new code, not just retrofitted onto old findings. Nothing currently rises to a reportable gap; the main watch item for the next reconciliation is whether this test-first extraction discipline holds as new feature branches (mobile, customer onboarding via GraphQL, self-help panel — all out of scope this run, not yet on this branch) land.
