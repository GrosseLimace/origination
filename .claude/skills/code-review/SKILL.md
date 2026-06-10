---
name: code-review
description: Findings-first code review for correctness, maintainability, readability, standards drift, and test quality. Use when the user asks for a code review, repo audit, PR review, quality pass, or wants help finding bugs and weak tests.
---

# Code Review Skill

Review code the way a strong teammate reviews a risky PR: findings first, grounded in the code, and scoped to the highest-value areas.

This skill is for:

- correctness and regression risk
- maintainability and code organization
- readability and design clarity
- standards drift against local style guides
- test quality and verification gaps

This skill is not a substitute for a dedicated security review or deterministic build/test execution. If verification was not run, say so clearly.

## Workflow

### Phase 1: Explore

Start read-only. Map the repo before reading code deeply.

Use fast discovery commands such as:

```bash
git status --short
rg --files
find . -maxdepth 3 -type d | sort
```

Identify:

- major modules and feature areas
- primary languages and frameworks
- test locations
- generated, vendored, or build-output directories to ignore
- whether the review should focus on the whole repo, a changed area, or a specific feature
- for large repos, which bounded batches should be reviewed first and what remains out of scope for now

For large repos, review one batch at a time and summarize interim findings before moving on. If useful and supported, optionally use sub-agents to review disjoint areas in parallel. Do not depend on sub-agents for the core workflow.

Load only the style guides that matter to the reviewed files:

- `style-guides/csharp.md`
- `style-guides/angular.md`
- `style-guides/sql.md`
- `style-guides/error-handling.md`
- `style-guides/logging.md` when logging or observability changes matter
- `style-guides/git-201.md` when workflow or change hygiene matters

Load `style-guides/security.md` only if the user explicitly wants a security review or the finding is inseparable from security design.

### Phase 2: Plan

Define the review batches before you dive in.

Good batch boundaries:

- top-level modules
- backend vs frontend vs data layer
- app code vs tests
- one bounded subsystem at a time

Prioritize:

- recent churn
- shared abstractions and orchestration points
- large files
- code with weak or missing tests
- areas where multiple systems interact

If the repo is too large to cover fully, say what you will review first and where residual risk will remain.

### Phase 3: Review

Review in multiple focused passes. Do not read the entire repo and then produce a shallow summary.

Passes to apply:

- architecture and boundaries
- correctness and regression risk
- readability and clean code
- tests and verification quality
- repo hygiene and reviewability

Use targeted smell scans to support judgment, then read the surrounding code before reporting anything:

```bash
rg -n "console\\.log|print\\(|Debug\\.WriteLine" .
rg -n "TODO|FIXME|HACK|XXX" .
rg -n "throw new Exception|catch \\(Exception\\)" .
rg -n "duplicate|copy paste|temporary|quick fix" .
```

Do not edit code as part of a standard `/code-review` run unless the user explicitly asks for fixes after seeing the findings.

### Phase 4: Verify

If a finding depends on behavior, build output, or test evidence, run the narrowest deterministic verification you can. Examples:

- targeted unit tests
- focused build/typecheck commands
- lint for the affected area

If you cannot run verification, say that explicitly and downgrade confidence where appropriate.

Before reporting, self-review your own findings:

- confirm the code actually does what you claim
- confirm the cited line is the real issue location
- confirm the issue matters more than a style nit

### Phase 5: Report

Produce a findings-first report in priority order.

Use this structure:

```text
CODE REVIEW

Coverage:
- Reviewed: [modules / directories / file groups]
- Not fully reviewed: [modules / directories / file groups]

Findings:
1. [severity] [file:line] Clear description of the issue, why it matters, and what should happen next
2. ...

Patterns:
- [optional repeated issue across multiple files/modules]

Open Questions:
- [only when needed]

Overall:
- Healthy / Needs targeted cleanup / Needs significant follow-up
- Highest-risk areas: [list]
- Recommended verification: [specific commands or manual checks]
```

## Severity Guidance

| Level | Meaning | Examples |
|-------|---------|----------|
| `BLOCKER` | Likely bug, regression, data loss risk, or unsafe behavior | stale call site, broken condition, invalid state transition, missing authorization in a non-security-focused review |
| `WARNING` | Important maintainability, clarity, design, or test issue that should be fixed soon | duplicated logic, oversized mixed-responsibility module, weak tests around a risky workflow |
| `NIT` | Minor cleanup that does not materially affect behavior | naming tweak, dead comment, small readability improvement |

## Stop Conditions

Stop and say so when:

- the repo is too large for a credible full review in one pass
- you need a build/test result to confirm a finding and cannot run it
- a suspected issue may be intentional and needs product or architectural context
- a security concern dominates the review and should be handed to a dedicated security review

## Reporting Rules

- Include file and line references whenever possible.
- Prefer concrete findings over generic advice.
- Be explicit about what was not reviewed.
- State clearly when no material findings were found in the reviewed scope.
- Use the repo's local style guides as the source of truth, not personal preference.
