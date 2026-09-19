# Audit: Angular (`angular`)

Style guide: `style-guides/angular.md`
Scope: `client/src/app`

**Findings:** 13 open — 1 critical, 5 high, 5 medium, 2 low
**Opened:** 2026-09-19 | **Last verified:** 2026-09-19

## Critical

### Business-critical "god" components carry zero test coverage (`angular.god-components-zero-test-coverage`)
- **Files:** `features/build-list/pages/build-list/build-list.component.ts`, `features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts`, `features/customers/pages/home/home.component.ts`, `features/dashboard/pages/dashboard/dashboard.component.ts`, `features/customers/components/customer-list/customer-list.component.ts`
- Five files containing the app's most complex logic (bid pricing/map rendering, contract/print orchestration, race-guarded multi-fetch data loading, BFS producer-linking, saved-list/NLQ enrichment) are entirely inside components, up to 4180 lines, with no matching `.spec.ts`.
- **Related findings:** `test-gaps.angular-god-components`
- **Suggested fix:** Extract data-fetching/business logic into dedicated services (more unit-testable), then add specs starting with the highest-risk flows.

## High

### Route guards can hang navigation indefinitely instead of failing closed (`angular.route-guards-can-hang-navigation`)
- **Files:** `guards/admin.guard.ts`, `guards/usage-dashboard.guard.ts`, `core/services/user-roles.service.ts`
- When MSAL interaction settles with no active account, the guard's source pipe returns `EMPTY`, so the backing `ReplaySubject` never emits and `ready$()` never completes — navigation silently stalls with no redirect and no error.
- **Suggested fix:** Race `ready$()` against a timeout or an "unauthenticated" signal that resolves to `router.createUrlTree(['/'])` so the guard always settles.

### @it/design-system (scoular-*) classes are effectively unused across the shared UI kit (`angular.design-system-classes-unused`)
- **Files:** `shared/components/button/button.component.ts`, `shared/components/badge/badge.component.ts`, `shared/components/card/card.component.ts`, `shared/components/dialog/dialog.component.ts`, `shared/components/table/table.component.ts`
- Every shared primitive hand-rolls Tailwind variant maps instead of emitting `scoular-btn`/`scoular-badge`/`scoular-card`/`scoular-modal`/`scoular-table`; warning/destructive variants also use generic Tailwind colors instead of mandated `scoular-yellow`/`scoular-red` tokens. Drift is app-wide since most feature templates build on these wrappers.
- **Suggested fix:** Rewrite the shared primitives to map variant/size inputs onto `scoular-*` classes so feature templates inherit the fix without individual changes.

### Components own state that AppStateService should own, and already reach into it directly (`angular.components-bypass-app-state-service`)
- **Files:** `core/services/app-state.service.ts`, `features/build-list/pages/build-list/build-list.component.ts`, `features/customers/pages/home/home.component.ts`
- `AppStateService` exposes ~30 pieces of state as raw writable `signal()` fields (not `.asReadonly()`). Components call `this.appState.queryLibrary.set(...)` directly, bypassing any service-level update method, so multiple unrelated components can independently mutate shared app state.
- **Suggested fix:** Expose state via `.asReadonly()` and require all writes to go through explicit service methods.

### No typed error contract; silent error swallowing across services and components (`angular.no-typed-error-contract-silent-swallowing`)
- **Files:** `core/services/api.service.ts`, `core/services/data-preload.service.ts`, `features/customers/pages/home/home.component.ts`, `features/usage-dashboard/pages/usage-dashboard/usage-dashboard.component.ts`
- No typed error class exists anywhere in the app. `DataPreloadService` collapses every dataset failure to `[]` with no signal to the UI; roughly two dozen `.subscribe({ error: () => {} })` blocks swallow failures with no toast, no error state, and no distinguishable empty-vs-failed outcome.
- **Related findings:** `error-handling.angular-silent-swallowing`
- **Suggested fix:** Introduce one `ApiError`-style type built centrally in `ApiService`'s error handling, and route every swallowed `error:` callback through `toastService.error(...)` or a component `errorMessage` signal.

### any type used in ~20+ locations against the explicit no-any rule (`angular.any-type-widespread-usage`)
- **Files:** `features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts`, `features/customers/components/map/customer-map.component.ts`, `features/customers/components/customer-map/customer-map.component.ts`, `features/customers/components/customer-list/customer-list.component.ts`, `features/dashboard/pages/dashboard/dashboard.component.ts`, `core/services/api.service.ts`
- `any` is concentrated in Leaflet map interop (`_map: any`, `(marker as any).customerId`, `(L as any).markerClusterGroup`) and in dynamically-shaped HTTP/`forkJoin` results.
- **Suggested fix:** Type Leaflet interop using the already-installed `@types/leaflet`/`@types/leaflet.markercluster`, and give `forkJoin` call sites a proper `Partial<Record<...>>` result interface.

## Medium

### Dead duplicate CustomerMapComponent with a colliding selector (`angular.duplicate-customer-map-component`)
- **Files:** `features/customers/components/customer-map/customer-map.component.ts`, `features/customers/components/customer-map/customer-map.component.html`
- A second, different implementation of `CustomerMapComponent` shares the `app-customer-map` selector with the live one; the duplicate is imported nowhere in the app.
- **Related findings:** `clean-slop.duplicate-customer-map-component`
- **Suggested fix:** Delete the orphaned `components/customer-map/` folder, or confirm intent and rename/consolidate to avoid a same-selector collision if both are ever imported together.

### Inconsistent OnPush adoption on fully signal-driven components (`angular.inconsistent-onpush-adoption`)
- **Files:** `shared/components/badge/badge.component.ts`, `shared/components/button/button.component.ts`, `features/customers/pages/home/home.component.ts`
- Only 20 of 49 components set `ChangeDetectionStrategy.OnPush`; most of the shared UI kit and several feature components are entirely `input()`/signal-driven yet omit it.
- **Suggested fix:** Add `changeDetection: ChangeDetectionStrategy.OnPush` to the remaining signal-driven components (low-risk, mechanical change).

### Function calls used directly in template bindings instead of computed()/pipes (`angular.function-calls-in-template-bindings`)
- **Files:** `features/customers/components/customer-profile/customer-profile.component.html`, `features/customers/components/contracts-table/contracts-table.component.html`, `features/dashboard/pages/dashboard/dashboard.component.ts`
- Recurring pattern (`getContacts()`, `getPricingLinesForContract(contract)`, `commodityChipClass()`, `ticketDisplayNumber()`) re-sorts/re-filters/re-formats on every change-detection pass rather than being memoized.
- **Related findings:** `performance.angular-template-function-calls`
- **Suggested fix:** Convert the highest-traffic offenders (especially ones that sort/filter arrays) to `computed()` signals or pure pipes.

### Broad unit-test coverage gap beyond the god components (`angular.broad-unit-test-coverage-gap`)
- **Files:** `shared/components/card/card.component.ts`, `shared/utils/linked-producers.ts`, `shared/utils/contract-delivery.ts`, `shared/utils/ticket-view-filters.ts`
- 31 of 49 components (63%) have no `.spec.ts`, including the entire shared UI kit and load-bearing utils like the BFS-based `linked-producers.ts`.
- **Related findings:** `test-gaps.angular-shared-components-gap`
- **Suggested fix:** Prioritize specs for shared primitives (high reuse, low cost to test) and untested utils with real branching logic.

### Production bootstrap failures are silently swallowed (`angular.production-bootstrap-failures-swallowed`)
- **Files:** `client/src/main.ts`
- `bootstrapApplication(...).catch` only logs in non-production. A production bootstrap failure produces a blank page with zero diagnostic trail.
- **Related findings:** `logging.bootstrap-failure-not-logged`
- **Suggested fix:** Log unconditionally (or route through the telemetry sink used elsewhere) and render a minimal static fallback message on bootstrap failure.

## Low

### Stale security comment about bypassSecurityTrustHtml usage (`angular.stale-security-comment-bypasssecuritytrusthtml`)
- **Files:** `client/src/main.ts`, `shared/pipes/highlight.pipe.ts`
- `main.ts`'s threat-model comment states no `bypassSecurityTrustHtml` usage anywhere in the app, but `highlight.pipe.ts` does call it (safely, on pre-escaped input, but with no test coverage guarding that).
- **Suggested fix:** Correct the `main.ts` comment to note the one intentional, escaped exception, and add a spec for `highlight.pipe.ts` asserting it rejects unescaped HTML.

### Duplicated crop/commodity taxonomy logic across multiple utils (`angular.duplicated-commodity-taxonomy-logic`)
- **Files:** `shared/utils/contract-status.ts`, `shared/utils/production-coverage.ts`, `shared/utils/commodity-aliases.ts`, `shared/utils/crop-group-match.ts`
- Several utils independently build overlapping commodity-code lookup/conversion maps rather than sharing one source; the codebase's own comments reference a past bug caused by exactly this kind of duplication.
- **Related findings:** `clean-slop.duplicated-commodity-taxonomy`
- **Suggested fix:** Extract one shared builder/lookup table that the individual utils consume.
