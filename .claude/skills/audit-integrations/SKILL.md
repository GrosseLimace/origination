---
name: audit-integrations
description: External service pattern matrix for auth, retry, timeout, error shape, logging, and async consistency. Use when reviewing how external services are integrated, comparing patterns across services, or standardizing integration approaches.
---

# Audit Integrations

Compare external service integration patterns for consistency in auth, retry, error handling, logging, and async behavior using `style-guides/integration-smells-guide.md`.

## Workflow

### Phase 1: Explore

- Check for `.claude/rules/project-config.md`. If present, read it to load project-specific configuration (especially "External Integrations" for service locations and reference implementation). If missing, warn that results will be more accurate with a project config and fall back to auto-discovering service classes (search for classes injecting `HttpClient`, `IHttpClientFactory`, `RestClient`, or external SDKs).
- Read `style-guides/integration-smells-guide.md` and `style-guides/refactoring-guide.md` before making any findings.
- Determine scope:
  1. **Feature area** — e.g., `/audit-integrations orders` → identify services used by the feature, build pattern matrix.
  2. **Single service** — e.g., `/audit-integrations payments` → deep-dive on service + repository caller + config.
  3. **No argument** — full scan: pattern matrix across all external service classes.
- **Limits:** Full scan: matrix for all, detail top 3 most inconsistent. Feature: matrix for feature's services only.
- Build inventory — per service: file, line count, external system, transport (RestSharp/HttpClient/SDK).

### Phase 2: Findings

Review services and produce findings before proposing fixes.

**Pattern matrix** — assess 7 aspects per service. If project config specifies a reference implementation, use it as the comparison baseline.

| Aspect | What to Check |
|--------|---------------|
| Auth | OAuth, API key, SDK credential? |
| Retry | Retry logic? How many? What triggers? |
| Timeout | Explicit timeout configured? |
| Error shape | Typed response object, bool, exception? |
| Logging | ILogger? Logs requests, responses, exceptions? |
| Async | Fully async? Any `.Wait()`/`.Result`? |
| Config | `IOptions<T>`, string keys, or hardcoded? |

**Smell detection** — check against `style-guides/integration-smells-guide.md`:

| ID | Smell | Severity |
|----|-------|----------|
| I1 | Inconsistent error shape (bool/empty vs typed response) | Medium |
| I2 | Missing retry for transient HTTP failures | Medium |
| I3 | Sync-over-async | High |
| I4 | Missing timeout | Medium |
| I5 | Hardcoded config | Medium |
| I6 | Missing logging | Medium |
| I7 | Token per service (duplicated OAuth) | Low |

**Consistency score** — per service, count how many of the 7 aspects match the reference implementation (if specified).

### Phase 3: Proposal

Present a findings-first report with service inventory, pattern matrix, and consistency scores.

**Migration priority** — rank services by issue count, severity, and effort:

| Priority | Service | Issues | Effort | Risk |
|----------|---------|--------|--------|------|

**Escalation targets:**
- Service with many issues → recommend `/audit-component <ServiceName>`
- Consistency score < 50% across services → recommend `/audit-arch`
- Error handling inconsistency across services → recommend `/audit-error-paths`

**Tech debt links:** If project config specifies a tech debt file, link findings to existing entries.

Do not make code changes until the user explicitly approves.

### Phase 4: Implement

Only after explicit user approval:

- Standardize one service at a time, starting with the highest-priority from the migration table.
- Use the reference implementation as the target pattern.
- Keep changes within the service class and its configuration — avoid touching callers unless the API contract changes.

### Phase 5: Verify

Run the narrowest deterministic checks available, typically:

- `dotnet build`
- Targeted tests for the modified service
- Lint if configured

If verification is unavailable, say so explicitly. External service integrations are difficult to test without the external system — note this.

### Phase 6: Report

Report findings or completed fixes by severity with file references, then summarize:

- Service inventory (per service: system, lines, transport)
- Pattern matrix with consistency scores
- Findings with severity and service
- Migration priority table
- What was fixed vs deferred
- Escalation recommendations
- Verdict: **Clean** / **Minor** / **Needs Attention** / **Needs Standardization**

## Stop Conditions

- No external service classes found in the codebase.
- Project has only one external service (no consistency comparison possible — switch to `/audit-component`).
- Service classes are auto-generated SDK wrappers with no custom logic.

## References

- `style-guides/integration-smells-guide.md`
- `style-guides/refactoring-guide.md` (for S8, S10, S11)
- `.claude/rules/project-config.md` (when present)
