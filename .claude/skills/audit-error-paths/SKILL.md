---
name: audit-error-paths
description: Trace error propagation end-to-end from database to user display, check response shape consistency, logging coverage, and frontend error rendering. Use when investigating broken error paths, silent failures, or inconsistent error handling across layers.
---

# Audit Error Paths

Trace error propagation paths across architectural layers to verify failures are logged, communicated to users, and handled consistently using `style-guides/error-smells-guide.md`.

> Complements `/audit-error-handling` (which checks standards compliance against `error-handling.md`). This skill traces actual error flow across layers and finds broken paths.

## Workflow

### Phase 1: Explore

- Check for `.claude/rules/project-config.md`. If present, read it to load project-specific configuration (especially "Architecture Layers" for layer-to-directory mappings). If missing, warn that results will be more accurate with a project config and fall back to auto-discovering project structure.
- Read `style-guides/error-smells-guide.md` and `style-guides/refactoring-guide.md` before making any findings.
- Determine scope:
  1. **Feature area** — e.g., `/audit-error-paths orders` → trace all error paths from repository to user display.
  2. **Single controller** — e.g., `/audit-error-paths OrderController` → check all endpoints, trace 2-3 representative paths.
  3. **No argument** — full scan: consistency check across all controllers + services + frontend error display.
- **Limits:** Full scan: report findings, don't trace every path. Feature: 3-5 representative paths. Single controller: 2-3 paths.

### Phase 2: Findings

Review error handling across layers and produce findings before proposing fixes.

**Error path tracing** — trace 3-5 representative paths (feature/single-controller scope):

```
ERROR ORIGIN: <what goes wrong>
  → Repository: <catch/log/rethrow/return?>
    → Business logic layer: <catch/transform/propagate?>
      → Controller: <HTTP status? body shape?>
        → Frontend Service: <error handler?>
          → Component: <what does user see?>
VERDICT: Complete / Broken at <layer> / Silent
```

**Response shape consistency** — catalog error patterns per controller:

| Controller | Validation | Not Found | Server Error | Consistent? |
|-----------|-----------|-----------|-------------|-------------|

**Logging coverage:**

| Layer | Files | Has ILogger? | Logs Errors? | Logs Context? |
|-------|-------|-------------|-------------|---------------|

**Frontend error display:**

| Component | errorMessage? | Rendered? | Toast? | User Sees Errors? |
|-----------|-------------|-----------|--------|-------------------|

**Smell detection** — check against the guides:

- **Per-layer** (from `style-guides/refactoring-guide.md`): E1, E2, E3, E4, E5, E6, E7
- **Cross-layer** (from `style-guides/error-smells-guide.md`): E8, E9, E10

### Phase 3: Proposal

Present a findings-first report with error path traces, response shape matrix, logging coverage, and frontend display inventory.

**Escalation targets:**
- External service error handling issues → recommend `/audit-integrations`
- Single class with many error handling issues → recommend `/audit-component <ClassName>`
- Systematic error handling inconsistency across the system → recommend `/audit-arch`

**Tech debt links:** If project config specifies a tech debt file, link findings to existing entries.

Do not make code changes until the user explicitly approves.

### Phase 4: Implement

Only after explicit user approval:

- Fix broken error paths one at a time, starting with High severity (E1, E2, E4, E8).
- Keep changes local to the affected layer unless the fix requires coordinated changes across layers.
- For cross-layer fixes, implement from bottom (repository) to top (component) to avoid breaking intermediate layers.

### Phase 5: Verify

Run the narrowest deterministic checks available, typically:

- `dotnet build` and `ng build`
- Targeted tests
- Manual verification of error display if possible

If verification is unavailable, say so explicitly.

### Phase 6: Report

Report findings or completed fixes by severity with file references, then summarize:

- Error path traces with verdicts
- Response shape consistency matrix
- Logging coverage by layer
- Frontend error display inventory
- Findings with severity and layer
- What was fixed vs deferred
- Escalation recommendations
- Verdict: **Clean** / **Minor** / **Needs Attention** / **Needs Error Strategy**

## Stop Conditions

- No controllers or API endpoints found in the codebase.
- Error handling is entirely delegated to middleware with no per-endpoint logic.
- Frontend is not part of the repository (API-only project) — skip frontend display phases.

## References

- `style-guides/error-smells-guide.md`
- `style-guides/refactoring-guide.md` (for E1-E7)
- `error-handling.md` from the scoular-skills plugin snapshot (complementary standards)
- `.claude/rules/project-config.md` (when present)
