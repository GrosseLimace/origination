# Audit: Test Gap Analysis (`test-gaps`)

Scope: coverage breadth across `api/GrainOriginatorPortal.Api.Tests` (xUnit) and `client/` (Vitest)
Baseline: dotnet test 535/535 passing; Angular vitest 601/601 passing across 51 spec files — the gap is coverage breadth, not currently-failing tests.

**Findings:** 6 total, 3 open (2 critical, 1 high), 3 resolved
**Opened:** 2026-09-19 | **Last reconciled:** 2026-09-21

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

Both suites are green (535/535 dotnet, 601/601 vitest) but the number is a floor, not a ceiling: the gap concentrates in exactly the code with the most real-world blast radius — the five largest Angular feature components, the two largest .NET repositories, and the security-critical entitlement fail-open/fail-closed path — while trivial/presentational code and pure calculator logic are comparatively well covered. Where tests exist they are qualitatively solid, so the fix is breadth, not a rewrite. Highest-leverage next tests: (1) `UserEntitlementService`'s untested branches (security-critical, cheap — pure mocking, no DB), (2) the UTC/DateOnly converter round-trip tests (cheap, prevents a bug class that already happened once), (3) `TicketRepository`/`UsageRepository` baseline tests, (4) `linked-producers.ts` BFS edge cases, (5) god-component logic extraction + specs (highest effort, highest total risk reduction).
