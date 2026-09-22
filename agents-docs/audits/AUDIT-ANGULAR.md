# Angular Audit — 2026-09-21

## Scope

Audited `client/` (Angular 21, standalone components, zoneless change detection, Tailwind v4 + `@it/design-system`) against `style-guides/angular.md` from the `audit-angular` skill. This is a single-domain pass per the Code Quality Dashboard calibration run; only `angular` was in scope.

## What was checked

- **Version/config compliance**: `package.json`, `angular.json`, `tsconfig.json` — Angular 21.2, Tailwind 4.2, `strict: true` + `strictTemplates`/`strictInjectionParameters`/`strictInputAccessModifiers` all present. Compliant.
- **Template control flow**: searched for `*ngIf`/`*ngFor`/`*ngSwitch` (legacy structural directives) — none found; the app uses `@if`/`@for`/`@switch` throughout, and every `@for` sampled has a `track` expression.
- **Standalone/NgModule usage**: no `NgModule` or `standalone: false` found — fully standalone.
- **XSS surface**: exactly one `bypassSecurityTrustHtml` call app-wide (`HighlightPipe`), and it HTML-escapes input before wrapping it, then only injects its own static `<mark>` markup. Verified safe; also self-documented and pinned by a spec and a comment in `main.ts`.
- **Observable cleanup**: sampled ~35 files using `.subscribe()`; the overwhelming majority correctly pipe through `takeUntilDestroyed(this.destroyRef)`. No unmanaged-subscription leaks found in the sampled set.
- **`any` usage**: 39 occurrences across 14 files; most are incidental (test mocks, narrow casts). One genuine pattern-level issue found in `bid-sheet.component.ts` (see findings).
- **Design system usage**: no redefinition of `scoular-*` classes in `styles.css`; import order (`@it/design-system` before `tailwindcss`) is correct.
- **Inline `template:` usage** (guide requires `templateUrl` except for very simple templates): 10 components use inline templates, all small UI primitives (button, badge, card, table, dialog, etc.) with a handful of lines each — consistent with the guide's stated exception, not flagged.
- **Component size and test coverage**: walked directory sizes and spec-file presence per feature area. This surfaced the audit's main findings — see below.
- **MSAL/auth bootstrap** (`main.ts`): zoneless change detection correctly configured via `provideZonelessChangeDetection()`; token storage decision is explicitly documented against the security guide with a stated threat model. No issues.

## What was not reviewed

Given the "sample, don't exhaust" mandate for this run, the following were not individually read line-by-line and may warrant a follow-up pass:
- `core/services/*` business logic correctness (only spec presence and subscription-cleanup patterns were checked)
- `shared/directives`, `shared/utils` implementation detail
- E2E (Playwright) test content/coverage
- Full lint/build run (explicitly out of scope for this invocation)

## Findings

| ID | Severity | Summary |
|---|---|---|
| `angular.untested-god-components` | High | The four largest feature components (build-list 4,244 lines, bid-sheet 3,005, home 2,220, dashboard 1,707 — ~11k lines total) have **zero** `.spec.ts` files. |
| `angular.god-components-need-decomposition` | Medium | Those same four components mix data-fetching, view-state, and business logic in one class each, contrary to the guide's single-responsibility and service-delegation guidance — and are very likely *why* they're untested. |
| `angular.home-component-silent-error-swallowing` | Medium | `home.component.ts` has 17 `error: () => {}` no-op handlers on API subscriptions — failures are invisible to users and unlogged. The same shape recurs 34 times across 9 files app-wide; home.component.ts is the worst concentration. |
| `angular.bid-sheet-any-cast-hides-payload-mismatch` | Low | Two `as any` casts in `bid-sheet.component.ts` exist specifically to smuggle a `bids: []` field that isn't part of `BidSheetLocation` past the compiler's excess-property check. |

Full detail, file lists, and suggested fixes are in `agents-docs/audits/AUDIT-TRACKING.json` under `audit: "angular"`.

## Notes for the next pass

- The test-coverage and god-component findings are linked (`related_findings`) since fixing decomposition would likely make testing dramatically easier — but they're tracked separately since one is a testing gap and the other is a structural/design issue.
- The silent-error-swallowing pattern is broader than `home.component.ts` alone; a dedicated sweep of all 34 occurrences across the app would be a reasonable follow-up if error-observability becomes a priority.
