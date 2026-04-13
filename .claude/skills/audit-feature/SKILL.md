---
name: audit-feature
description: Cross-layer feature area analysis for dependency flow, layer boundary violations, and integration quality. Use when reviewing how a feature's files work together across architectural layers.
---

# Audit Feature

Analyze a feature area across all architectural layers for integration quality, consistency, and code smells using `style-guides/refactoring-guide.md`.

## Workflow

### Phase 1: Explore

- Check for `.claude/rules/project-config.md`. If present, read it to load project-specific configuration. If missing, warn that results will be more accurate with a project config and fall back to auto-discovering project structure.
- Read `style-guides/refactoring-guide.md` before making any findings.
- Identify the target:
  1. **Specific files** — e.g., `/audit-feature UserService.cs UserController.cs` → find and read those files.
  2. **Feature area** — e.g., `/audit-feature payments` → find source files across all layers and read them.
  3. **No argument** — ask: "Which files or feature area should I audit?"
- **Never infer scope from git diffs or commit history.** The user decides what gets reviewed.
- **Limits:** Max 10 source files (`.cs`, `.ts`, `.html`) per pass. Skip auto-generated model directories (per project-config.md Model Layers — rows marked Editable=No). If more than 10, group by layer and ask which to start with.
- **Layer map** — map each file to its architectural layer per project config (or auto-detected layer structure). Read constructors, classify dependencies as Standard / Accepted Deviation / Violation.

### Phase 2: Findings

Review one batch at a time and produce findings before proposing fixes.

**Smell detection** — check against `style-guides/refactoring-guide.md`:

- **Primary** (detail each finding):
  - Architecture: S1, S2, S3, S4, S7, S9, S11
  - General: G11, G14
  - Security: SEC1, SEC2, SEC4
  - Horizontal: H1, H2, H3, H4, H5
  - Vertical: V1, V2
- **Secondary** (report counts only): S6, G2, E1, E7, V3

Command-specific notes:
- H1: check every repository — does it branch on business rules, or just filter/sort?
- V1: check imports for paths reaching into sibling feature folders
- V2: compare this feature's logic against other features

**Cross-file analysis:**
- Duplication — same mapping, validation, or error handling repeated in multiple files?
- Consistency — naming consistent across layers? Error response shapes consistent?
- Contract stability — DTOs, interfaces, and API shapes consistent between layers?
- Layer bleeding — any file reach into a non-adjacent layer (H4, H5)? Repo with business logic (H1)? UI-shaped queries (H2)?
- Feature boundary — imports reaching into another feature's folder (V1)? Logic duplicated across features (V2)?

For each finding: smell ID, file:line, description, severity, suggested fix.

### Phase 3: Proposal

Present a findings-first report with the layer map, dependency flow diagram, and cross-file observations.

**Escalation targets:**
- **Down:** Large class → recommend `/audit-component`. Long method → recommend `/audit-method`.
- **Up:** Systemic dependency issues or pattern repeated across features → recommend `/audit-arch`.
- **Horizontal patterns** (flag when 3+ instances across the feature):
  - 3+ model smells → recommend `/audit-models <feature>`
  - 3+ error handling inconsistencies → recommend `/audit-error-paths <feature>`
  - 3+ layer boundary violations (H1-H5) → note systematic boundary issues
  - Cross-feature imports (V1) → suggest extracting to shared

**Tech debt links:** If project config specifies a tech debt file, link findings to existing entries.

Do not make code changes until the user explicitly approves.

### Phase 4: Implement

Only after explicit user approval:

- Fix correctness or reliability issues in small batches.
- Keep changes local to the affected feature area unless a shared abstraction is clearly the right fix.
- Do not migrate large architectural patterns without calling out the blast radius first.

### Phase 5: Verify

Run the narrowest deterministic checks available, typically:

- `dotnet build` or `ng build`
- Targeted tests or full test suite
- Lint if configured

Use regression testing after each approved fix batch. If verification is unavailable, say so explicitly.

### Phase 6: Report

Report findings or completed fixes by severity with file references, then summarize:

- Files scanned with layer assignments
- Layer map and dependency flow diagram
- Findings with severity
- Cross-file observations
- Secondary observations (counts)
- What was fixed vs deferred
- Escalation recommendations
- Verdict: **Clean** / **Minor** / **Needs Attention**

## Stop Conditions

- Feature area cannot be identified or has no source files.
- More than 10 files require review and user has not selected a subset.
- Fixing issues requires a broad architecture migration across multiple features.
- Layer structure cannot be determined (no project config and auto-discovery finds no recognizable patterns).

## References

- `style-guides/refactoring-guide.md`
- `.claude/rules/project-config.md` (when present)
