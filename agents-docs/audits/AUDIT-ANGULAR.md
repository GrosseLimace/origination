# Angular Audit — 2026-09-21

**Findings:** 14 open — 1 critical, 6 high, 6 medium, 1 low (9 resolved)
**Opened:** 2026-09-19 | **Last verified:** 2026-10-13

> **Note (2026-10-13):** Reconciliation pass only (per the Code Quality Dashboard's one-domain-per-invocation calibration run). `AUDIT-TRACKING.json` remains the source of truth for status. Re-verified all 14 still-open angular findings against the current repo state — every one reproduced exactly as last recorded; nothing regressed and nothing newly resolved. The god-component line counts have grown further (build-list 4,244→4,557; home 2,220→2,562; dashboard 1,707→1,750; bid-sheet essentially flat at ~3,003) and `edit-customer-dialog.component.ts`'s uncleaned subscribe() count grew from 7 to 8. No new findings were opened this pass — see "What was checked" below for what was sampled.

## Scope

Re-audited `client/` (Angular 21.2, standalone components, zoneless change detection, Tailwind v4 + `@it/design-system`) against `style-guides/angular.md` from the `audit-angular` skill. This is a single-domain pass per the Code Quality Dashboard calibration run; only `angular` was in scope. Given a full finding set already existed from the 2026-09-19/21/22/28 passes, this run focused on re-verifying every open finding's quantitative claims (line counts, occurrence counts, file existence) rather than re-deriving the whole audit from scratch.

## What was checked

- **Version/config compliance**: `package.json` (`@angular/core` 21.2.25, `tailwindcss` 4.2.1, `@it/design-system` 0.1.1), `tsconfig.json` (`strict: true`, `strictTemplates`/`strictInjectionParameters`/`strictInputAccessModifiers` all present). Still compliant.
- **Template control flow**: no `*ngIf`/`*ngFor`/`*ngSwitch` found — `@if`/`@for`/`@switch` used throughout.
- **Standalone/NgModule usage**: no `NgModule` or `standalone: false` found.
- **XSS surface**: `HighlightPipe`'s single `bypassSecurityTrustHtml` call still HTML-escapes input before wrapping it in a static `<mark>` tag — confirmed safe again, no change.
- **Observable cleanup**: re-sampled the components flagged for god-component size (`build-list`, `bid-sheet`, `home`, `dashboard`) — all still consistently pipe `.subscribe()` through `takeUntilDestroyed(this.destroyRef)`. Separately re-confirmed the two known exceptions (`edit-customer-dialog.component.ts`, `planting-intentions-table.component.ts`) still have no cleanup wiring.
- **`any` usage**: recounted — still exactly 39 non-spec sites, same concentration (Leaflet interop in `bid-sheet`/`customer-map`, `api.service.ts` dynamic payloads).
- **OnPush adoption**: recounted — still 23 of 49 components.
- **Component test-coverage gap**: recounted — still 28 of 49 components (57%) have a `.spec.ts`; the same ~21 remain untested, including the five largest files.
- **God-component sizes**: re-measured all five — all either grew or held flat; none gained a `.component.spec.ts`.
- **AppStateService raw signals**: recounted — still 14 raw `signal()` fields, zero `.asReadonly()`.
- **Silent error swallowing**: recounted — still exactly 10 non-spec `error: () => {}` sites, still no `ApiError`/`AppError`-style typed error class anywhere in `src/app`.
- **Production bootstrap failure handling**: `main.ts` still only logs via `console.error` when `!environment.production`.
- **Commodity taxonomy duplication**: all four flagged util files still exist, each still building its own lookup/conversion map.
- **Accessibility gaps**: dialog `keydown.escape` handling and close/dismiss `aria-label`s both re-confirmed still absent.
- **Function-calls-in-templates**: `customer-profile.component.html`'s `getContacts()` and `contracts-table.component.html`'s `getPricingLinesForContract(contract)` both still called directly in `@for`/`@if` bindings; could not reproduce the `dashboard.component.ts` example specifically (those identifiers no longer appear there), suggesting partial unrelated cleanup, but the pattern persists elsewhere.

## What was not reviewed

Consistent with the "sample, don't exhaust" mandate:
- `core/services/*` business logic correctness beyond the specific claims above
- `shared/directives`, `shared/utils` implementation detail beyond the taxonomy-duplication check
- E2E (Playwright) test content/coverage
- Full lint/build run (explicitly out of scope for this invocation)

## Findings

All 14 open findings are unchanged in substance from the prior pass; see `AUDIT-TRACKING.json` (`audit: "angular"`) for full detail, file lists, and per-finding verification history. Summary by severity:

| Severity | Count | Representative finding |
|---|---|---|
| Critical | 1 | God components (`build-list`, `bid-sheet`, `home`, `dashboard`, `customer-list`) carry zero test coverage |
| High | 6 | `any`-type usage (39 sites); `AppStateService` raw signals with no `.asReadonly()`; no typed error contract / silent swallowing (10 sites) |
| Medium | 6 | Inconsistent OnPush adoption (23/49); broad test-coverage gap (21/49 untested); function calls in template bindings; production bootstrap failures swallowed; two components with uncleaned `.subscribe()` |
| Low | 1 | Duplicated commodity-taxonomy lookup logic across 4 utils |

Nine prior findings remain `resolved`/`accepted`/`wont_fix` and were not re-litigated (route-guard hang fix, duplicate `CustomerMapComponent`, stale security comment, home-component error-swallowing fix, bid-sheet `as any` fix, design-system-class deviation, dialog escape-key and aria-label gaps tracked separately as still-open low findings above).

## Notes for the next pass

- The god-component findings keep growing (not shrinking) release over release — worth flagging to the team that the "specs first, then decomposition" sequencing decision from 2026-09-21 has not yet been acted on across four releases.
- `edit-customer-dialog.component.ts`'s subscribe-without-cleanup count grew 7→8 between passes, suggesting new API calls are still being added to this file without picking up the `takeUntilDestroyed` pattern used everywhere else in the app — a lint rule or snippet could catch this going forward.
