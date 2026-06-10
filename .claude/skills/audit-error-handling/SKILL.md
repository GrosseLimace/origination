---
name: audit-error-handling
description: Audit or remediate exception flow, API error contracts, retries, logging, and observability against style-guides/error-handling.md. Use when reviewing failures, user-facing errors, resilience logic, or backend/frontend error consistency.
---

# Audit Error Handling

Audit error and exception handling against `style-guides/error-handling.md`.

## Workflow

### Phase 1: Explore

- Read `style-guides/error-handling.md` first.
- Identify request boundaries, exception handlers, retry logic, logging calls, health checks, and user-facing error surfaces.
- Locate tests covering failure paths, not just happy paths.
- For large repos, split the review into bounded batches such as API boundaries, retry logic, logging, and tests.
- If useful and supported, optionally use sub-agents to review disjoint subsystems in parallel. Do not require sub-agents.

### Phase 2: Findings

Review one batch at a time and produce findings before proposing fixes.

Group findings by the guide's main concern areas:

- error classification and error-code shape
- exception handling boundaries
- logging structure and prohibited fields
- HTTP status code usage
- retry, backoff, and idempotency
- user-facing messages and observability
- required failure-path tests

### Phase 3: Proposal

- Present a findings-first report with severity, affected files, and the relevant standard areas.
- Propose fix batches in reviewable units and explain the regression checks you would run for each batch.
- Do not make code changes until the user explicitly approves implementation.

### Phase 4: Implement

Only after explicit user approval:

- Fix high-risk misclassification, swallowed exceptions, and bad retry behavior first.
- Keep logging changes and contract changes easy to review.
- Avoid silently changing public error contracts without calling it out.

### Phase 5: Verify

Use focused tests and local checks where available to confirm:

- expected status codes
- expected error payloads
- expected logging side effects
- retry behavior where deterministic

Use regression testing after each approved fix batch and again at the end. If those checks were not run, say so clearly before proceeding.

### Phase 6: Report

Produce a findings-first report with explicit references to the violated standard areas.

## Stop Conditions

- Changing the fix would break a published API contract.
- Logging or alerting behavior depends on infrastructure not available locally.
- The retry strategy reflects a business decision that is not clear from the repo.

## References

- `style-guides/error-handling.md`
- `style-guides/logging.md` when application logging and observability findings dominate
