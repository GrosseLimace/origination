---
name: audit-logging
description: Audit or remediate application logging and observability against style-guides/logging.md. Use when reviewing structured logging, Azure Monitor, Application Insights, Log Analytics usage, Azure SQL auditing, sampling, correlation, dashboards, alerts, or developer-docs logging configuration.
---

# Audit Logging

Audit application logging and observability against `style-guides/logging.md`.

## Workflow

### Phase 1: Explore

- Read `style-guides/logging.md` before making any findings.
- Identify the logging surface in scope: backend services, frontend telemetry, background jobs, Azure Monitor/Application Insights setup, Azure SQL observability, and `developer-docs/` operational notes.
- Inventory current logging libraries, structured fields, trace propagation behavior, telemetry resources, dashboard/query references, and alert/runbook documentation.
- For large repos, split the review into bounded batches such as backend logging, browser telemetry, Azure SQL observability, and `developer-docs/` operational configuration.
- If useful and supported, optionally use sub-agents to review disjoint concern areas in parallel. Do not depend on sub-agents for the core workflow.

### Phase 2: Findings

Review one batch at a time and produce findings before proposing fixes.

Group findings by the guide's main concern areas:

- structured log schema and message-template quality
- log levels, event selection, and noise control
- trace correlation and distributed tracing boundaries
- Application Insights, Azure Monitor, and Log Analytics usage
- sampling and cost-control decisions
- Azure SQL auditing, Query Store, and database observability
- `developer-docs/` completeness for app-specific telemetry settings, KQL, alerts, and runbooks
- privacy, redaction, and sensitive-data handling

Classify findings by severity and state clearly what was reviewed versus what remains unreviewed.

### Phase 3: Proposal

- Present a findings-first report with severity, affected files or operational docs, and the relevant guide sections.
- Distinguish measured telemetry problems from inferred risks due to missing instrumentation or missing access to Azure resources.
- Propose fix batches in reviewable units and explain the regression or validation checks you would run for each batch.
- Do not edit code, docs, or config until the user explicitly approves implementation.

### Phase 4: Implement

Only after explicit user approval:

- Fix the highest-value observability gaps first.
- Keep code, configuration, and documentation changes separable where possible.
- Prefer small, reviewable fixes over broad logging redesigns unless the user explicitly approves a larger change.

### Phase 5: Verify

Use the best deterministic evidence available:

- focused build/test checks for touched code
- verification of structured fields and message templates
- confirmation that correlation IDs or traces are still propagated correctly
- review of KQL, dashboards, or `developer-docs/` references when those are in scope
- validation of Azure SQL observability assumptions against repo-managed configuration or docs

Use regression verification after each approved fix batch and again at the end. If production telemetry or Azure resource access is unavailable, say which conclusions are inferred rather than proven.

### Phase 6: Report

Summarize:

- confirmed logging and observability gaps
- inferred risks caused by missing telemetry, missing documentation, or missing platform access
- what was fixed versus deferred
- what should be updated in `developer-docs/`
- what should be validated directly in Azure after merge

## Stop Conditions

- The review depends on Azure resources, Application Insights data, Log Analytics queries, or alert configuration not available from the repo.
- Fixing the issue would require a broad telemetry architecture redesign without measurement or team approval.
- The logging behavior appears to be controlled by shared platform infrastructure outside the repo's ownership.
- The repo lacks enough context to distinguish app code issues from environment-specific logging configuration.

## References

- `style-guides/logging.md`
- `style-guides/error-handling.md` when error-path logging and trace IDs are central to the finding
- `style-guides/security.md` when privacy, redaction, or security event logging is central to the finding
- `style-guides/sql.md` when Azure SQL performance and auditing signals are central to the finding
