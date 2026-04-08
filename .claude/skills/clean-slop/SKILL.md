---
name: clean-slop
description: Remove AI-generated technical debt without changing behavior: dead code, redundant wrappers, copy-paste drift, comment noise, and over-engineered patterns. Use when the developer asks to clean up cruft, simplify code, remove slop, prepare for review, or reduce maintenance drag.
---

# Clean Slop

Remove synthetic technical debt while preserving behavior.

## Cardinal Rule

If you are not confident a deletion is behavior-preserving, do not delete it. Defer it.

## Workflow

### Phase 1: Explore

- Read `CLAUDE.md` if present for local architecture and invariants.
- Define the scope: full repo, directory, feature, or file set.
- Establish a verification baseline before cleanup where possible.
- For large repos, split the work into bounded batches and summarize each batch before moving on.
- If useful and supported, optionally use sub-agents to scan disjoint areas in parallel. Do not rely on sub-agents for the core workflow.

### Phase 2: Findings

Work through these categories in order:

- dead infrastructure: unused imports, unreferenced private members, commented-out code, stale config
- copy-paste drift: near-duplicate methods, repeated component logic, cloned query patterns
- phantom patterns: interfaces with one implementation, wrappers with no behavior, factories used once
- comment noise: comments that restate code, empty XML docs, stale TODOs

Use fast scans to support review, then read the surrounding code before reporting anything.

### Phase 3: Proposal

Produce a findings-first cleanup plan that includes:

- categories found
- representative examples
- file count by category
- likely high-confidence deletions
- deferred items that need human judgment

For broad scopes, present the plan and wait for explicit user approval before making changes.

### Phase 4: Implement

Only after explicit user approval:

- Remove the highest-confidence dead code first.
- Work in small batches.
- Prefer deletion over refactoring when behavior is unchanged.
- Keep any necessary rewrites minimal and easy to review.

### Phase 5: Verify

Run the narrowest deterministic verification available after each batch:

- build
- targeted tests
- lint or typecheck where relevant

Use regression testing after each approved cleanup batch and again at the end. If the repo lacks meaningful verification for the area, say so before proceeding.

### Phase 6: Report

Summarize:

- items removed by category
- files touched
- net lines removed
- deferred risky items
- verification that was run or not run

## Stop Conditions

- Removing the code would change a public API, schema, or observable behavior.
- You suspect reflection, dynamic dispatch, or framework wiring may still use the code.
- The affected area has little or no test coverage and no other verification path.
- The cleanup would turn into a broad redesign instead of simplification.
