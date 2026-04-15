---
name: audit-component
description: Analyze a single class or Angular component for responsibility cohesion, design quality, and structural health. Use when a specific class needs focused analysis for potential splitting, dependency cleanup, or design improvement.
---

# Audit Component

Analyze a single class or Angular component for design quality, cohesion, and structural health using `style-guides/refactoring-guide.md`.

## Workflow

### Phase 1: Explore

- Check for `.claude/rules/project-config.md`. If present, read it to load project-specific configuration. If missing, warn that results will be more accurate with a project config and fall back to auto-discovering project structure.
- Read `style-guides/refactoring-guide.md` before making any findings.
- Identify the target:
  1. **Class name** — e.g., `/audit-component UserRepository` → find and read it.
  2. **Component name** — e.g., `/audit-component user-form` → read `.ts`, `.html`, `.scss`.
  3. **File path** — e.g., `/audit-component OrderService.cs` → read that file.
  4. **No argument** — ask: "Which class or component should I audit?"
- Also read: interface file (if `I<ClassName>` exists), note whether tests exist (don't read them yet).
- Build an inventory: line count, public methods (with one-line descriptions), private methods (count and names), fields/properties, constructor dependencies (every injected service/repo with type).

### Phase 2: Findings

Review the class and produce findings before proposing fixes.

**Responsibility map** — group public methods by responsibility (cohesive operations sharing fields/dependencies). Per group: methods, fields used, dependencies used, whether it shares state with other groups. Key signal: two groups sharing no fields or dependencies → extraction candidates.

**Smell detection** — check against `style-guides/refactoring-guide.md`:

- **Primary** (detail each finding):
  - Architecture: S6, S7, S9, S10, S11
  - General: G2, G9, G13
  - Error: E1, E2, E4, E5, E7
  - Security: SEC1, SEC2, SEC4, SEC5
  - Horizontal: H1, H4
  - Both-axis: B1
- **Secondary** (report counts only): S4, S5, S8, G1, G4, G5, G6, G8, G10, G12
- **Template smells** (Angular only): T1, T2, T3, T4, T5, T6
- **Style smells** (Angular only): CSS1, CSS2, CSS3, CSS4

Command-specific notes:
- B1: use the responsibility map — flag if 3+ groups share no fields/deps
- H1: for repositories, check whether conditional logic is business rules vs. simple filtering

**Design checks:**
- Public API coherence — cohesive set or grab bag? Public methods only called internally?
- Dependency count — 5+ constructor deps = too many responsibilities signal
- Constructor conventions (C#) — null guards on all injected dependencies
- State management — minimal internal state? Mutable state exposed? Subscriptions cleaned up?
- Error handling consistency — uniform across methods or ad hoc?

**Method flags** — list methods warranting `/audit-method`:
- `methodName` (line X) — one sentence why

### Phase 3: Proposal

Present a findings-first report with severity, affected locations, and the responsibility map.

**Suggested splits** (only if G2 or S6 detected):

| New Class | Methods to Move | Dependencies | Rationale |
|-----------|----------------|-------------|-----------|

**Escalation targets:**
- Cross-layer responsibilities → recommend `/audit-feature <feature>`
- Duplication beyond this class → recommend `/audit-feature <feature>`
- 7+ constructor dependencies → recommend `/audit-arch`
- 3+ model smells → recommend `/audit-models`
- 3+ error handling inconsistencies → recommend `/audit-error-paths`

**Tech debt links:** If project config specifies a tech debt file, link findings to existing entries.

Do not make code changes until the user explicitly approves.

### Phase 4: Implement

Only after explicit user approval:

- Fix correctness or reliability issues in small batches.
- Keep changes local to the class unless extraction is clearly the right fix.
- Do not migrate large architectural patterns without calling out the blast radius first.

### Phase 5: Verify

Run the narrowest deterministic checks available, typically:

- `dotnet build` or `ng build`
- Targeted tests or `dotnet test` / `ng test --watch=false`
- Lint if configured

Use regression testing after each approved fix batch. If verification is unavailable, say so explicitly.

### Phase 6: Report

Report findings or completed fixes by severity with file references, then summarize:

- Responsibility map with cohesion assessment
- Findings with severity and effort classification
- Secondary observations (counts)
- Template & style analysis (Angular only)
- Method flags for deeper analysis
- Suggested splits (if applicable)
- What was fixed vs deferred
- Verdict: **Clean** / **Minor** / **Needs Refactoring** / **Needs Architectural Review**

## Stop Conditions

- Class cannot be located in the codebase.
- Class is auto-generated code (ORM models, designer files, scaffolded code).
- Splitting the class requires a broad architecture migration.
- A design pattern looks intentional but conflicts with the guide — flag and stop.

## References

- `style-guides/refactoring-guide.md`
- `.claude/rules/project-config.md` (when present)
