# Angular Audit — 2026-10-20

**Findings:** 2 open (both low) — 26 resolved/accepted (0 critical, 0 high, 0 medium open)
**Opened:** 2026-09-19 | **Last verified:** 2026-10-20

> **Note (2026-10-20):** This pass is a correction as much as a re-verification. The prior prose
> summary here (dated 2026-10-13) said "14 open — 1 critical, 6 high, 6 medium, 1 low", but
> `AUDIT-TRACKING.json` — the source of truth per the calibration run's own convention — already
> showed every one of those 14 as `resolved` or `accepted`, most of it closed out by a large
> decomposition effort (god-component extraction into page-scoped stores/utils, OnPush rollout,
> spec backfill) that landed across ~50 commits between 2026-10-14 and 2026-10-19 — after the prior
> prose was written but evidently not updated alongside the JSON. This pass re-derives the prose
> from the current JSON state plus fresh spot-checks, and found two new low-severity findings in
> the course of doing so (both recorded in the JSON).

## Scope

Re-audited `client/` (Angular 21.2, standalone components, zoneless change detection, Tailwind v4
+ `@it/design-system`) against `style-guides/angular.md` from the `audit-angular` skill. Given 28
pre-existing angular findings already in `AUDIT-TRACKING.json`, this run focused on: (1)
reconciling the stale prose against the JSON, (2) spot-verifying that the mass "resolved" status
changes actually hold in the current tree, and (3) sampling the newly-written code (the
decomposition stores) for regressions of previously-fixed patterns, rather than re-deriving the
full audit from scratch.

## What was checked

- **`git log --since=2026-10-13 -- client/`**: ~50 commits, mostly `refactor(home|build-list|
  dashboard|bid-sheet)` extracting logic into page-scoped stores/utils, plus `test(...)`
  characterization specs, `perf(...)` OnPush conversions, and targeted `fix(...)` commits matching
  the four "small leftovers" the 2026-10-13 pass had flagged (Refined marker ignoring DP,
  build-list producer-details merge, dashboard failure-misreporting, home notes-spinner flash).
- **God-component test coverage** (`angular.god-components-zero-test-coverage`, was critical):
  `build-list.component.ts`, `bid-sheet.component.ts`, `home.component.ts`,
  `dashboard.component.ts` all now have `.component.spec.ts` (plus characterization specs for the
  extracted stores). Confirmed resolved.
- **`any` usage** (`angular.any-type-widespread-usage`, was high): recounted via grep — down to 20
  non-spec sites from the previously-recorded 39. Confirmed resolved.
- **OnPush adoption** (`angular.inconsistent-onpush-adoption`, was medium): recounted — **49 of
  49** components now use `ChangeDetectionStrategy.OnPush` (was 23/49). Confirmed resolved.
- **Component test-coverage gap** (`angular.broad-unit-test-coverage-gap`, was medium): recounted
  — **48 of 49** components now have a `.spec.ts` (was 28/49). One gap remains:
  `sheet-multi-select.component.ts` has no spec — **new low finding**
  (`angular.sheet-multi-select-missing-spec`).
- **Silent error swallowing** (`angular.no-typed-error-contract-silent-swallowing`, was high):
  recounted — down to 4 non-spec `error: () => {}` sites from the previously-recorded 10.
  Confirmed resolved (no typed error contract still doesn't exist, but that was the high-level
  "silent swallowing" claim and it's materially improved; not re-opening).
- **`@it/design-system` acceptance** (`angular.design-system-classes-unused`, accepted): confirmed
  `docs/application-context/STYLE-DEVIATIONS.md` still exists and documents the Tailwind-token
  decision. No change.
- **New store files from the Home decomposition**
  (`home-linked-producers.store.ts`, `home-notes.store.ts`, `home-planting.store.ts`,
  `home-reminders.store.ts`, `home-saved-lists.store.ts`): checked each for the raw-signal pattern
  that `angular.components-bypass-app-state-service` had already flagged and fixed on
  `AppStateService`. Three are clean. Two — `home-notes.store.ts` (`isLoadingNotes`,
  `isSavingNote`, `noteSaveSucceededCounter`) and `home-reminders.store.ts`
  (`isLoadingReminders`, `isSavingReminder`, `reminderSaveSucceededCounter`) — expose public
  `signal()` fields marked `readonly` (which only blocks property reassignment) without
  `.asReadonly()` (which would block external `.set()`/`.update()`). **New low finding**
  (`angular.home-stores-raw-signals-no-asreadonly`): the same anti-pattern reintroduced in new
  code written during the very refactor that fixed the original instance.

## What was not reviewed

Consistent with "sample, don't exhaust":
- Full re-audit of every extracted util/store for correctness beyond the two checks above
- `core/services/*` business logic beyond the error-swallowing recount
- E2E (Playwright) test content/coverage
- Full lint/build run (out of scope for this invocation)
- The 9 low-severity feature-specific findings resolved 2026-10-14 (unshipped-bushels alias
  filter, stored-grain search/sort, year-over-year backslash, cached conversion maps, home notes
  spinner, build-list Refined marker, build-list producer-details merge, dashboard
  failure-misreporting) — each has git history (see commits above) directly matching its
  `resolution_notes`; not independently re-verified line-by-line this pass.

## Findings

| Severity | Count | Status | Representative |
|---|---|---|---|
| Critical | 0 | — | (god-components-zero-test-coverage resolved 2026-10-13/14) |
| High | 0 | — | (any-type, error-swallowing, route-guard-hang, state-boundary all resolved; design-system drift accepted) |
| Medium | 0 | — | (OnPush, coverage gap, template-function-calls, bootstrap-swallow, subscribe-cleanup all resolved) |
| Low | 2 open, 10 resolved | — | New: raw signals in two Home stores; missing spec on `sheet-multi-select` |

Full detail for all 30 angular findings (2 open, 28 resolved/accepted) is in
`AUDIT-TRACKING.json` (`audit: "angular"`).

## Notes for the next pass

- The decomposition effort (god-component → stores/utils) materially closed out the single
  largest open-findings cluster from this audit (critical test-coverage gap, OnPush adoption,
  broad coverage gap, several feature bugs) in about a week of commits. Worth recognizing as the
  "specs first, then decomposition" sequencing finally landing, four releases after it was first
  recommended.
- Keep an eye on new page-scoped stores for the raw-signal pattern — it's an easy thing to miss
  when extracting from a component (where a raw signal is harmless, since only the component
  itself held the reference) into a service/store (where other consumers now hold the reference
  too).
- Whoever runs the next angular pass should diff the prose doc against the JSON's open/resolved
  counts *before* writing a new summary, not after — that's what let the 2026-10-13 prose drift
  from the JSON for a full week.
