# Audit: Test Gap Analysis (`test-gaps`)

Scope: coverage breadth across `api/GrainOriginatorPortal.Api.Tests` (xUnit) and `client/` (Vitest)
Baseline (unverified this run per the audit's hard limits — no test suite executed): dotnet 535/535 and vitest 601/601 as of the last reconciliation; the gap is coverage breadth, not currently-failing tests.

**Findings:** 10 total, 6 open (2 critical, 4 high/medium split below), 3 resolved, plus this run's 4 new opens
**Opened:** 2026-09-19 | **Last reconciled:** 2026-09-28

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

## Weak-test sweep

No widespread weak-test pattern found. Existing Angular specs use `@testing-library/angular` with behavior-focused queries rather than implementation-detail assertions; existing xUnit tests favor `[Theory]`/`[InlineData]` with specific value assertions. The one "illusory coverage" case: `ContractRepository`'s test file only covers one static pure-function helper, none of the class's actual EF/SQL-backed query methods (folded into the repository-layer-gap finding above). Pricing-calculation coverage is a bright spot: all three Angular calculators (cancel-roll, check, profitability) have dedicated spec files, and no equivalent untested server-side pricing-math logic was found.

## Overall coverage health

The gap continues to concentrate in code with the most real-world blast radius rather than being spread evenly: the five largest Angular feature components and the two largest .NET repositories remain the biggest unmitigated pieces from the original pass, and this run's new findings show the same pattern repeating on the newest surface (CTRM/organic work) — the orchestration/background-service layer and one shared formatting/pacing util are the gaps, while the CTRM GraphQL integration itself and the new organic/grain-on-farm pure-utils are, like the pricing calculators before them, comparatively well covered. Where tests exist they are qualitatively solid, so the fix remains breadth, not a rewrite. Highest-leverage next tests, in priority order: (1) `contract-status.ts` pacing/confirmation rules (cheap, pure function, already documented one drift bug), (2) `CtrmCustomerCodes.Normalize` (cheap, pure function, guards a measured API failure mode), (3) `formatAccountingMoney` (cheap, pure function, already drifted once), (4) `TicketRepository`/`UsageRepository` baseline tests, (5) `CtrmKeepWarmService` cadence-gating tests, (6) god-component logic extraction + specs (highest effort, highest total risk reduction, now with 4 bug-fix commits as live evidence of the cost of deferring it).
