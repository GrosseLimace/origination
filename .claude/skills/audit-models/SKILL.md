---
name: audit-models
description: Cross-layer model type tracing, coupling maps, and blast-radius classification. Use when reviewing model consistency across ORM, DTO, API, and frontend layers, or when investigating type drift and model proliferation.
---

# Audit Models

Analyze the model layer horizontally across all architectural tiers for type consistency, coupling, and structural health using `style-guides/model-smells-guide.md`.

## Workflow

### Phase 1: Explore

- Check for `.claude/rules/project-config.md`. If present, read it to load project-specific configuration (especially "Model Layers" for layer-to-directory mappings). If missing, warn that results will be more accurate with a project config and fall back to auto-discovering model directories.
- Read `style-guides/model-smells-guide.md` and `style-guides/refactoring-guide.md` before making any findings.
- Determine scope:
  1. **Feature area** — e.g., `/audit-models orders` → trace from components/services to frontend models, find backend counterparts.
  2. **Single model** — e.g., `/audit-models OrderItem` → read frontend model, backend API model, DTO, ORM model, and business logic mapping code.
  3. **No argument** — full inventory: top-10 coupling hotspots + cross-layer type-drift scan.
- **Limits:** Full scan: top-10 only. Feature: max 15 frontend models + backend counterparts. Skip auto-generated ORM models for smell detection (read-only for type tracing).
- Build inventory — per frontend model: file, line count, type (class/interface/enum), backend API model counterpart, DTO counterpart.

### Phase 2: Findings

Review models and produce findings before proposing fixes.

**Cross-layer field tracing** — for each model (or top-10), trace 3-5 key fields through the chain: ORM type → DTO type → API Model type → Frontend type. Flag M3 (type drift without reason), M11 (business logic layer formats numeric to string).

**Coupling map** (frontend layer) — per frontend model: total importers, classified as @Input (highest friction), Service Sig, Component, Model-to-Model.

**Smell detection** — check against `style-guides/model-smells-guide.md`:
- **Per-layer:** M1, M2, M4, M5, M6, M7, M8, M9, M10
- **Cross-layer:** M3, H3, M11, M12

H3 definition in `style-guides/refactoring-guide.md` — check controller signatures and API model imports for ORM model type references.

**Cross-model analysis:**
- Data clumps — same fields in 3+ models
- Type inconsistency at same layer — same field, different types
- Overlapping models — 50%+ field overlap, which is canonical?
- Business logic mutation points — methods that change field types

### Phase 3: Proposal

Present a findings-first report with:
- Layer inventory
- Cross-layer field trace matrix
- Coupling map with blast-radius tiers
- Findings with severity

**Recommendations by blast radius** — group by: Safe / Low / Medium / High / Critical. Only include tiers with recommendations. Use the blast-radius tiers from `style-guides/model-smells-guide.md`.

**Escalation targets:**
- Dependent layers affected by changes → note blast radius
- ORM model issues → flag as out of scope (auto-generated)
- Pattern repeated across many models → recommend systematic approach

**Tech debt links:** If project config specifies a tech debt file, link findings to existing entries.

Do not make code changes until the user explicitly approves.

### Phase 4: Implement

Only after explicit user approval:

- Start with Safe and Low blast-radius changes.
- For Medium+ changes, confirm the scope of impact before proceeding.
- Keep changes consistent across layers — if retyping a field, update all layers together.

### Phase 5: Verify

Run the narrowest deterministic checks available, typically:

- `dotnet build` and `ng build` (model changes often affect both)
- Targeted tests
- Lint if configured

Use regression testing after each approved fix batch. If verification is unavailable, say so explicitly.

### Phase 6: Report

Report findings or completed fixes by severity with file references, then summarize:

- Layer inventory (per layer: location, file count, line count)
- Cross-layer field trace matrix
- Coupling map with blast-radius classification
- Findings with severity and layer
- Cross-model observations
- Recommendations grouped by blast-radius tier
- What was fixed vs deferred
- Verdict: **Clean** / **Minor** / **Needs Attention** / **Needs Migration Plan**

## Stop Conditions

- No model files can be located in the codebase.
- Model layer structure cannot be determined (no project config and auto-discovery finds no recognizable patterns).
- Changes require modifying auto-generated ORM models.
- High/Critical blast-radius changes require a migration plan beyond this audit's scope.

## References

- `style-guides/model-smells-guide.md`
- `style-guides/refactoring-guide.md` (for H3)
- `.claude/rules/project-config.md` (when present)
