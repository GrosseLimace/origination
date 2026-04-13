---
name: audit-method
description: Deep-dive on a single method for code smells, parameter quality, guard clause structure, bug signals, and testability. Use when a specific method needs focused analysis beyond what /code-review covers.
---

# Audit Method

Analyze a single method for code smells, structural issues, parameter quality, and bug signals using `style-guides/refactoring-guide.md`.

## Workflow

### Phase 1: Explore

- Check for `.claude/rules/project-config.md`. If present, read it to load project-specific configuration (architecture layers, accepted conventions, tech debt references). If missing, warn that results will be more accurate with a project config and fall back to auto-discovering project structure.
- Read `style-guides/refactoring-guide.md` before making any findings.
- Identify the target method:
  1. **Class.method** — e.g., `/audit-method UserService.CreateOrder` → find the file, read the method.
  2. **IDE selection** — if code is selected in the editor, analyze that method.
  3. **No argument** — ask: "Which method? Provide `ClassName.methodName`."
- If overloads exist, analyze all together.
- Find all callers (file:line for each). Check interface/override constraints — signature is locked if so. Identify high-risk callers (stored procedures, external integrations, HTTP endpoints). Check tech debt entries if project config specifies a tech debt file.

### Phase 2: Findings

Review the method and produce findings before proposing fixes.

**Smell detection** — check against `style-guides/refactoring-guide.md`:

- **Primary** (detail each finding):
  - Architecture: S4, S5, S8
  - General: G1, G3, G4, G5, G6, G7, G8, G9, G10, G12, G13
  - Error: E1, E2, E3, E4, E5, E6, E7
  - Security: SEC1, SEC3
  - Both-axis: B2
- **Secondary** (mention if noticed): S7, G2

Classify effort per finding: **Fix** (1-3 lines) / **Refactor** (method rewrite) / **Infrastructure** (cross-cutting).

**Bug signals** — watch for likely defects (not smells):
- String literal typos (misspelled headers, config keys, route paths)
- Dead assignments (immediately overwritten)
- Null path fall-through (null check exists but alternate path skips it)
- Interface/implementation mismatch (parameter names differ)

Report as "Bug signal" in findings.

**Parameter analysis:**

| Check | Signal |
|-------|--------|
| Count | 4+ without parameter object |
| Boolean traps | Parameter used as control flow flag |
| Mutation | Input parameter modified inside method |
| Cohesion | Group of params could be a class/record? |
| Redundancy | Unused or derivable from another param |

**Return path analysis:**
- Consistent return shape across all branches?
- Surprising exits buried in nested logic?
- Mixed early-return guards AND deep if/else? (Pick one)

**Guard clause structure:**
- Could nested conditionals be flattened?
- Null checks at top or scattered?

### Phase 3: Proposal

Present a findings-first report with severity, affected locations, and effort tiers.

**Escalation targets:**
- Containing class is large/god/copy-paste → recommend `/audit-component <ClassName>`
- Layer violation revealed → recommend `/audit-feature <feature>`
- Near-duplicate found → recommend `/audit-component <ClassName>` for consolidation

**Tech debt links:** If project config specifies a tech debt file, link findings to existing entries.

Do not make code changes until the user explicitly approves.

### Phase 4: Implement

Only after explicit user approval:

- Apply refactoring steps in the order proposed.
- Keep changes local to the method unless extraction is clearly the right fix.
- Do not change method signatures that stored procedures or external integrations depend on.

### Phase 5: Verify

Run the narrowest deterministic checks available, typically:

- `dotnet build` or `ng build`
- Targeted tests if available
- Lint if configured

If verification is unavailable, say so explicitly before proceeding.

### Phase 6: Report

Report findings or completed fixes by severity with file references, then summarize:

- What was analyzed (method, callers, constraints)
- Findings with severity and effort classification
- What was fixed vs deferred
- Escalation recommendations
- Verdict: **Clean** / **Refactor** / **Needs Context**

## Stop Conditions

- Method cannot be located in the codebase.
- Method is auto-generated code (ORM models, designer files).
- Refactoring would require changing locked signatures (interface, stored procedure, external API).
- The method is trivial (< 5 lines, no logic branching, no dependencies).

## References

- `style-guides/refactoring-guide.md`
- `.claude/rules/project-config.md` (when present)
