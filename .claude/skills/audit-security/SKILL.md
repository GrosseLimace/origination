---
name: audit-security
description: Review code and delivery workflows against style-guides/security-guide.md. Use when the developer asks for a security review, deployment-readiness check, auth/authz audit, secret handling review, logging review, or secure coding pass.
---

# Audit Security

Perform a focused security review against `style-guides/security-guide.md`.

## Workflow

### Phase 1: Explore

- Read `style-guides/security-guide.md` first.
- Identify the app tier, auth model, exposed endpoints, secret/config sources, CI/CD files, and logging/monitoring surface.
- Scope the review so it covers the highest-risk paths instead of the whole repo by default.
- For large repos, split the review into bounded batches such as auth, secrets/config, delivery controls, and logging.
- If useful and supported, optionally use sub-agents to review disjoint concern areas in parallel. Do not rely on them for the base workflow.

### Phase 2: Findings

Review one batch at a time and produce findings before proposing fixes.

Group findings by the guide's main concern areas:

- authentication and authorization
- input validation and output encoding
- secret management and Azure identity usage
- API-to-database security boundaries
- CI/CD enforcement and supply-chain controls
- logging, telemetry, release gates, and review artifacts

Classify findings by severity and call out whether they are code, config, or process issues.

### Phase 3: Proposal

- Present a findings-first report with severity, affected files, and release-blocking implications.
- Propose fix batches in reviewable units and explain the regression or policy checks you would run for each batch.
- Do not edit code or config until the user explicitly approves implementation.

### Phase 4: Implement

Only after explicit user approval:

- Make only safe, scoped fixes.
- Prefer tightening obvious gaps over redesigning the entire security model mid-stream.
- If a secure fix would change a public contract or deployment path, report before proceeding.

### Phase 5: Verify

Run any deterministic checks the repo already has, such as focused tests, lint, or policy validation.

Use regression testing after each approved fix batch and again at the end. Do not claim a complete security validation if runtime infrastructure or cloud controls were not inspected.

### Phase 6: Report

Produce a security-focused findings report with escalations and release blockers called out explicitly.

## Stop Conditions

- The review requires cloud-side access, secrets, or infrastructure context that is not available.
- The issue appears to involve a deliberate exception to policy.
- Fixing the issue would require cross-team ownership or coordinated rollout.

## References

- `style-guides/security-guide.md`
- `style-guides/error-handling-guide.md` when error contracts are part of the finding
- `style-guides/logging-guide.md` when logging or observability controls are part of the finding
- For external service pattern consistency (auth, retry, logging across services), use `/audit-integrations` which builds a pattern matrix using `style-guides/integration-smells-guide.md`
