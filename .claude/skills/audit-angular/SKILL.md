---
name: audit-angular
description: Audit or remediate Angular code against style-guides/angular-guide.md. Use when reviewing Angular components, templates, services, signals, standalone components, Tailwind usage, testing, error handling, change detection, or frontend PR readiness.
---

# Audit Angular

Audit Angular code against `style-guides/angular-guide.md`.

## Workflow

### Phase 1: Explore

- Confirm the repo contains Angular code such as `angular.json`, `project.json`, or `src/app/`.
- Read `style-guides/angular-guide.md` before making any findings.
- Inventory the frontend surface: components, services, directives, pipes, guards, routes, tests, and shared UI primitives.
- Exclude generated output, `dist/`, and vendored files.
- For large repos, split the review into bounded batches such as feature areas, shared UI, routing/state, and tests.
- If useful and supported, optionally use sub-agents to review disjoint Angular subsystems in parallel. Do not depend on sub-agents for the core workflow.

### Phase 2: Findings

Review one batch at a time and produce findings before proposing fixes.

Group findings by the guide's main concern areas:

- standalone component patterns and component structure
- signals, inputs, outputs, and change detection
- services and state boundaries
- template safety and readability
- Tailwind and styling conventions
- testing coverage and error handling
- performance issues such as unnecessary work or poor rendering patterns

Prioritize `P0/P1` issues before standards drift, and say explicitly what has not been reviewed yet if the repo is too large for a single pass.

### Phase 3: Proposal

- Present a findings-first report with severity, affected files, and the relevant guide sections.
- Propose fix batches in reviewable units and explain the regression checks you would run for each batch.
- Do not make code changes until the user explicitly approves implementation.

### Phase 4: Implement

Only after explicit user approval:

- Fix correctness or reliability issues in small batches.
- Keep changes local to the affected feature area unless a shared abstraction is clearly the right fix.
- Do not migrate large architectural patterns, such as widespread standalone adoption, without calling out the blast radius first.

### Phase 5: Verify

Run the narrowest deterministic checks available, typically:

- `ng build`
- targeted tests or `ng test --watch=false`
- lint if configured

Use regression testing after each approved fix batch and again at the end. If verification is unavailable, say so explicitly before proceeding.

### Phase 6: Report

Report findings or completed fixes by severity with file references, then summarize:

- what was reviewed
- what was fixed vs deferred
- which Angular guide sections drove the findings

## Stop Conditions

- No Angular app is present.
- Fixing the issue requires a broad frontend architecture migration.
- A template or state pattern looks intentional but conflicts with the guide.
- Build or test failures appear unrelated and block safe progress.

## References

- `style-guides/angular-guide.md`
