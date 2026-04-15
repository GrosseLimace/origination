# Model Layer Smell Detection Guide

## The Mapping Chain

Every data field passes through up to 5 layers. Type changes at any boundary can introduce silent bugs.

```
DB Column (int?, nvarchar, datetime2)
  -> ORM Model (int?, string, DateTime?)    [auto-generated layer — see project-config.md]
    -> DTO (int, string, DateTime)          [null coalesced in repository]
      -> API Model (int or string, string)  [formatted in business logic layer]
        -> JSON (number or "1,234", "2026-04-11")
          -> Frontend Model (number or string)
```

**Known conventions at each boundary:**
- `int?` -> `int`: Null coalescing in repository — expected
- `DateTime` -> `string`: Business logic layer formats dates for JSON — established, do NOT flag
- `int` -> `string` via `.ToString("#,##0")`: Business logic layer formats numbers for display — this IS a smell (M11) because it changes the API contract type

Read `.claude/rules/project-config.md` "Model Layers" for this project's layer-to-directory mappings.

## Model Smell Checklist

### Per-Layer Smells

| ID | Smell | What to look for | Severity |
|----|-------|-----------------|----------|
| M1 | Missing default | TS property without `= 0`, `= ''`, `= false`, `= []` — defaults to `undefined` | Medium |
| M2 | God model | 20+ properties serving multiple purposes (API data + UI state + computed values) | High |
| M4 | API/UI state mixing | UI-only fields (`selected`, `isExpanded`, `inProcess`) alongside API response fields | Medium |
| M5 | Field duplication | Same group of 3+ fields repeated in 3+ models without a shared type | Medium |
| M6 | Interface in class convention | `interface` used where project convention is `class` with defaults (TS only) | Low |
| M7 | Indexed properties | Numbered fields (`value0`-`value6`, `item1`-`item5`) instead of an array | Low |
| M8 | Orphan model | Model imported by 0-1 files — candidate for inlining | Low |
| M9 | Overlapping models | Two models at same layer with 50%+ field overlap, no clear canonical choice | Medium |
| M10 | Naming drift | Same concept has different names across models at same layer | Low |

### Cross-Layer Smells

| ID | Smell | What to look for | Severity |
|----|-------|-----------------|----------|
| M3 | Type drift | Same semantic field changes type across layers without clear reason | High |
| M11 | Business logic type mutation | Business logic layer formats a **numeric** field to string before returning to the API layer — changes the API contract type. DateTime-to-string is the accepted pattern and is NOT flagged. | High |
| M12 | Shape divergence | C# API model and TS model have different field names, counts, or nesting for the same endpoint | Medium |

## Accepted Conventions (do NOT flag)

- Auto-generated ORM models — do not audit or recommend changes
- Classes preferred over interfaces for TS model definitions (unless project convention differs)
- `DateTime` -> `string` conversion for dates is established
- `int?` -> `int` null coalescing in repository layer is expected
- `string.Empty` initialization in C# DTOs/API models is expected
- Feature-scoped models in feature directories are intentional (interfaces OK there)
- Flattened list-view models for grid data sources — flag as M2 for awareness but do not require splitting
- See `.claude/rules/project-config.md` "Accepted Conventions" for project-specific patterns

## Blast-Radius Tiers

When recommending model changes, classify by scope of impact:

| Tier | Definition | Example |
|------|-----------|---------|
| Safe | 0-1 importers, no @Input, no service signature | Inline a response type into its single consumer |
| Low | 2-5 importers, TS-only change | Add missing default to a model |
| Medium | 6-15 importers, or has @Input contracts, TS-only | Split data vs UI state in a model |
| High | TS + C# API model change, or 15+ importers | Retype a field consistently across C# and TS |
| Critical | TS + C# + DTO + business logic mapping change | Extract shared type; fix type chain end-to-end |
