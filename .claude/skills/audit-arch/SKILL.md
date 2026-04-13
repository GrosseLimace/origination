---
name: audit-arch
description: System-level architecture scan for dependency health, boundary violations, hotspot ranking, and security sweep. Use when assessing overall system structure, dependency graphs, or preparing for major refactoring.
---

# Audit Architecture

Analyze system-level architecture for boundary violations, dependency health, and structural risk using `style-guides/refactoring-guide.md`.

Top-level audit — assesses how layers and modules relate, not class internals.

## Workflow

### Phase 1: Explore

- Check for `.claude/rules/project-config.md`. If present, read it to load project-specific configuration. If missing, warn that results will be more accurate with a project config and fall back to auto-discovering project structure (scan for `angular.json`, `*.csproj`, `Controllers/`, `Services/`, `Repositories/`, etc.).
- Read `style-guides/refactoring-guide.md` before making any findings.
- Determine scope:
  1. **Full system** — `/audit-arch` → scan all layers.
  2. **Layer subset** — `/audit-arch controllers` → scan one layer only.
  3. **Dependency focus** — `/audit-arch dependencies` → skip size/security, focus on dependency graph.
- Scan the directories listed in project config "Architecture Layers" (or auto-detected directories).
- **Efficiency:** Don't read full files during discovery. Grep for constructor signatures and `private readonly` fields. Only read full files when a finding needs deeper investigation.
- Build system inventory — per class: name, file path, line count, constructor dependency count + list, public method count. Per layer summary: count, avg lines, max lines + which class.

### Phase 2: Findings

Review the system inventory and produce findings before proposing changes.

**Dependency graph** — map every constructor injection. Classify each arrow:
- **Standard** — follows the expected flow in project config "Expected Dependency Flow"
- **Accepted Deviation** — listed in project config "Accepted Layer Deviations"
- **Violation** — everything else

Violations to flag:
- Controller injecting a service/external class directly (bypassing business logic AND data layers)
- Repository injecting another repository (circular dependency risk)
- Business logic layer injecting DbContext directly (bypassing repository)
- Any circular dependency chain
- H5: dependency flowing wrong direction

**Smell detection** — check against `style-guides/refactoring-guide.md`:
- Architecture smells: A1, A2, A3, A4, A5, A6, A7, G11, H3, H5, V1

Command-specific notes:
- H3: check controller method signatures for ORM model types in return values or parameters
- V1: scan frontend feature folders for imports crossing into sibling feature folders (shared locations OK)
- A7/S9: check auth attributes per project config "Security Conventions"

**Cross-feature import scan** (frontend) — if V1 violations found, build matrix:

| Source Feature | Imports From | Files |
|---------------|-------------|-------|

**Size analysis** — flag classes exceeding: 500 (notable), 1000 (concerning), 1500 (critical).

**Security sweep** — check every controller for the auth attributes specified in project config "Security Conventions".

### Phase 3: Proposal

Present a findings-first report with:
- System map table (per-layer inventory)
- Dependency flow matrices
- Security summary
- Findings with severity

**Hotspot ranking** — rank top concerns by impact, recommend lower-level skills for each:
- Large classes → `/audit-component`
- Feature areas with violations → `/audit-feature`
- Problematic methods → `/audit-method`

**Tech debt links:** If project config specifies a tech debt file, link findings to existing entries. Note systemic patterns visible in the dependency graph.

This audit is primarily diagnostic. Do not make code changes until the user explicitly approves specific fixes.

### Phase 4: Implement

Only after explicit user approval:

- Fix targeted issues (e.g., adding missing auth attributes, removing unused interfaces).
- Do not restructure layers or move classes between projects without a migration plan.
- Keep changes small and verifiable.

### Phase 5: Verify

Run the narrowest deterministic checks available, typically:

- `dotnet build` or `ng build`
- Full test suite
- Lint if configured

If verification is unavailable, say so explicitly.

### Phase 6: Report

Report findings by severity with file references, then summarize:

- System map (per-layer: count, avg lines, max lines, max class)
- Dependency flow (per layer, with convention classification)
- Findings with severity and location
- Security summary (per controller: auth attribute, API visibility, status)
- Hotspot ranking with recommended next audits
- Verdict: **Healthy** / **Debt Accumulating** / **Structural Risk** with rationale and trend

## Stop Conditions

- No recognizable project structure found (no project config and auto-discovery fails).
- Codebase is too large for a single pass and user has not selected a layer subset.
- Architecture issues require organizational decisions beyond code changes.

## References

- `style-guides/refactoring-guide.md`
- `.claude/rules/project-config.md` (when present)
