---
name: audit-dotnet
description: Audit or remediate C# and .NET code against style-guides/csharp.md. Use when reviewing API controllers, services, domain models, DTOs, DI patterns, async flows, exception handling, tests, or backend PR readiness.
---

# Audit .NET

Audit .NET code against `style-guides/csharp.md`.

## Workflow

### Phase 1: Explore

- Confirm the repo contains `.sln`, `.csproj`, or C# source files.
- Read `style-guides/csharp.md` before making any findings.
- Inventory solution structure, project boundaries, test projects, controllers, services, entities, DTOs, and configuration files.
- Exclude generated files such as `bin/`, `obj/`, and migration snapshots unless they are directly relevant.
- For large repos, split the review into bounded batches such as API, application services, data layer, and tests.
- If useful and supported, optionally use sub-agents to review disjoint subsystems in parallel. Do not make the workflow depend on sub-agents.

### Phase 2: Findings

Review one batch at a time and produce findings before proposing fixes.

Group findings by the guide's main concern areas:

- solution and layer boundaries
- naming and file organization
- controllers, DTOs, and API contracts
- domain/entity design
- dependency injection and service lifetimes
- async/await correctness
- outbound call design, batching, caching, and `HttpClient` usage
- exception handling and test coverage

Prioritize behavior and reliability over formatting-only drift, and be explicit about any areas not yet reviewed.

### Phase 3: Proposal

- Present a findings-first report with severity, affected files, and the relevant guide sections.
- Propose fix batches in reviewable units and explain the regression checks you would run for each batch.
- Do not edit code until the user explicitly approves implementation.

### Phase 4: Implement

Only after explicit user approval:

- Fix high-risk findings in small batches.
- Keep controller changes, service changes, and data-model changes separable where possible.
- Do not broaden into speculative refactors or abstraction churn.

### Phase 5: Verify

Run the narrowest available deterministic checks, typically:

- `dotnet build`
- targeted test projects or `dotnet test`

Use regression testing after each approved fix batch and again at the end. If the code path depends on exception behavior, also verify responses and logging behavior where possible.

### Phase 6: Report

Produce a findings-first report with severity, affected files, and follow-up verification.

## Stop Conditions

- No .NET code is present.
- Fixing the issue requires public API changes, schema changes, or cross-repo changes.
- The guide conflicts with an established project-specific convention that appears intentional.
- Build or test failures block confidence in the fix.

## References

- `style-guides/csharp.md`
- `style-guides/error-handling.md` when exception flow or API error contracts are involved
- `style-guides/logging.md` when backend logging or telemetry findings dominate
