# Refactoring & Code Smell Reference Guide

## Scope

- Only flag smells in code you are actively touching or the user explicitly asks you to review
- If you spot something adjacent, mention it briefly — do not fix it unless asked
- Never refactor and add features in the same change
- Don't abstract until there are 3+ instances of the pattern

## Smells to Watch For

### Service & Component Architecture Smells
| ID | Smell | What to look for |
|----|-------|-----------------|
| S1 | Duplicated mapping | Same DTO-to-model mapping repeated in multiple repositories or services |
| S2 | Fat controller | Business logic living in a controller instead of the business logic layer |
| S3 | Fat service | Direct data access in a business logic class instead of going through a repository |
| S4 | N+1 queries | Loop-based DB calls instead of pre-load into Dictionary/HashSet then lookup |
| S5 | Subscription leak | Missing `takeUntilDestroyed` on UI-bound observables |
| S6 | God component | Angular component doing data fetching, transformation, and presentation |
| S7 | Copy-paste service | Nearly identical service methods that differ by one parameter |
| S8 | Sync-over-async | `.Wait()`, `.Result`, `.GetAwaiter().GetResult()` on async calls — thread pool starvation risk |
| S9 | Missing auth attribute | Controller missing auth attribute (see `.claude/rules/project-config.md` Security Conventions) |
| S10 | Singleton HttpClient | `new HttpClient()` or `new RestClient()` outside `IHttpClientFactory` — socket exhaustion |
| S11 | Config-by-string | `IConfiguration` with string key lookups instead of `IOptions<T>` |

### Architecture — Known Conventions (do NOT flag as smells)

See `.claude/rules/project-config.md` "Accepted Layer Deviations" for project-specific accepted patterns.

### General Code Smells
| ID | Smell | What to look for |
|----|-------|-----------------|
| G1 | Long method | Method exceeds ~40 lines or does more than one logical thing |
| G2 | Large class | Class has 10+ public methods or 15+ fields — likely has multiple responsibilities |
| G3 | Deep nesting | 3+ levels of if/for/try — flatten with early returns, extraction, or guard clauses |
| G4 | Feature envy | Method uses another class's data more than its own — logic belongs elsewhere |
| G5 | Data clumps | Same group of 3+ fields/params always travel together — extract to an object |
| G6 | Primitive obsession | 5+ loose parameters passed together instead of a parameter object |
| G7 | Boolean blindness | Method takes 2+ boolean params — replace with enums, options object, or named methods |
| G8 | Magic strings/numbers | Hardcoded values without a named constant to explain their meaning |
| G9 | Dead code | Unused methods, unreachable branches, commented-out blocks |
| G10 | Overly broad catch | `catch (Exception)` or `catch (error)` swallowing all errors without distinction |
| G11 | Shotgun surgery | One logical change requires edits across 4+ files — signals tight coupling |
| G12 | Loose equality | `==` / `!=` in TypeScript instead of `===` / `!==` |
| G13 | Missing loading/error state | HTTP call with no loading indicator or missing error handler |
| G14 | Repeated UI pattern | Same signal/method/template block repeated in 3+ components in a feature |

### System Architecture Smells
| ID | Smell | What to look for |
|----|-------|-----------------|
| A1 | Layer bypass | Controller with business logic injecting Repository directly (beyond accepted passthrough) |
| A2 | Circular dependency | Repository A → Repository B → Repository A, or any transitive cycle |
| A3 | God class cluster | 3+ classes in same feature area each exceeding 500 lines |
| A4 | Orphan interface | Interface with no implementation, or implementation with no DI registration |
| A5 | Missing business logic layer | Controller doing business logic without a service layer |
| A6 | Error handling inconsistency | External services AND controllers with inconsistent error response shapes, logging patterns, or retry strategies |
| A7 | Security gap | Controller missing auth attributes (per `.claude/rules/project-config.md` Security Conventions) |

### Horizontal (Layer) Smells
| ID | Smell | What to look for |
|----|-------|-----------------|
| H1 | Fat repository | Repository containing business/conditional logic (branching on business rules, orchestrating multiple operations) that belongs in the business logic layer. Simple filtering/sorting is OK — flag decision logic. |
| H2 | UI-shaped query | SQL/EF query that filters, sorts, or formats specifically for a single screen layout instead of returning general-purpose data. Signal: column aliases matching UI labels, or WHERE clauses that encode display logic. |
| H3 | Leaking ORM type | ORM entity (with navigation properties, nullable types) returned directly from a controller or used as an API model. Data should flow through DTO/API model layers. |
| H4 | Cross-layer import | Class importing types from both the data layer and the presentation layer. Each class should import from at most one adjacent layer. |
| H5 | Reverse dependency | Dependency flowing the wrong direction in the layer stack — e.g., repository referencing a controller type, data layer depending on presentation types, or any dependency flowing upward against the expected flow. Distinct from A2 (circular): a reverse dep can be one-way and still be wrong. |

### Vertical (Feature/Slice) Smells
| ID | Smell | What to look for |
|----|-------|-----------------|
| V1 | Cross-feature import | Component or service in one feature folder directly importing from another feature's folder. Shared logic should live in shared services, models, or utilities. |
| V2 | Cross-feature duplication | Same validation, formatting, calculation, or mapping logic implemented independently in 2+ feature areas. Differs from S7 (within-file copy-paste): V2 is the same pattern scattered across feature boundaries. Should be extracted to shared. |
| V3 | Implicit shared state | Service in feature A directly mutating or subscribing to state owned by feature B's service without a clear contract (public API, documented Subject, or shared service). |

### Both-Axis Smells
| ID | Smell | What to look for |
|----|-------|-----------------|
| B1 | Divergent change | Class with 3+ responsibility groups that change for unrelated reasons. Signal: git history shows the same file modified in unrelated PRs/features. Indicates the class sits at the wrong layer or straddles multiple slices. |
| B2 | Inappropriate intimacy | Two classes/services that access each other's internal implementation details — private fields via reflection, internal methods, implementation-specific data structures, or assumptions about the other's internal state. |

### Error Handling Smells
E1-E7 (per-layer) and E8-E10 (cross-layer) are defined in `style-guides/error-smells-guide.md`. Vertical audits check E1-E7; `/audit-error-paths` checks the full E1-E10 set.

| ID | Smell | Severity |
|----|-------|----------|
| E1 | Swallowed exception | High |
| E2 | Sensitive data in logs | High |
| E3 | Missing CancellationToken | Low |
| E4 | Unsafe error response | High |
| E5 | Error 200 | Medium |
| E6 | Raw exception type | Low |
| E7 | Silent degradation | Medium |

### Security Smells
| ID | Smell | What to look for |
|----|-------|-----------------|
| SEC1 | Hardcoded secret | Passwords, API keys, connection strings, or tokens as string literals in source code |
| SEC2 | Missing CSRF protection | Controller accepting POST/PUT/DELETE without anti-forgery token validation on form endpoints |
| SEC3 | Sanitization bypass | Angular `bypassSecurityTrustHtml`, `bypassSecurityTrustUrl`, etc. — XSS risk |
| SEC4 | Missing input validation | API endpoint accepting user input with no validation attributes or manual checks |
| SEC5 | Unsafe token storage | Auth tokens in `localStorage`/`sessionStorage` instead of HttpOnly cookies (non-auth UI state is fine) |

### Template Smells (Angular components)
| ID | Smell | What to look for |
|----|-------|-----------------|
| T1 | Inline style | `style="..."` attribute in template — blocks design system adoption, hard to maintain |
| T2 | Non-semantic interactive | `<div>` or `<span>` with `(click)` handler — should be `<button>` for keyboard nav and screen readers |
| T3 | Missing alt text | `<img>` without `alt` attribute (use `alt=""` for decorative images) |
| T4 | Missing accessible label | Interactive element without visible label text, `aria-label`, or `aria-labelledby` |
| T5 | Deep template nesting | 4+ levels of `*ngIf`/`*ngFor`/`@if`/`@for` nesting |
| T6 | Template duplication | Same HTML block (3+ lines) repeated 3+ times in the template |

### Style Smells (Angular components)
| ID | Smell | What to look for |
|----|-------|-----------------|
| CSS1 | !important overuse | 3+ `!important` declarations in a single stylesheet |
| CSS2 | Hardcoded color | Color hex/rgb values not using CSS custom properties or design system tokens |
| CSS3 | Hardcoded dimension | Magic pixel values for layout repeated without a variable or comment |
| CSS4 | Unused selector | CSS class/selector defined in stylesheet but never referenced in the component's template |

## How to Propose Changes

- State the smell, its location (file:line), and the cost of leaving it
- Propose the smallest fix that addresses the smell
- Respect existing inconsistencies unless the user asks you to normalize them
- When suggesting extraction, name the new unit clearly and explain where it belongs in the architecture

## Do NOT During Refactoring

- Change method signatures that stored procedures or external integrations depend on
- Touch auto-generated ORM models
- Rename things purely for style when the existing name is understood in context
- Add layers (base classes, middleware, new abstractions) unless duplication is clearly painful
- Introduce design patterns (Strategy, Factory, etc.) for a single use case

## Accepted Conventions (do NOT flag)

These apply across all audit skills. Project-specific exceptions go in `.claude/rules/project-config.md`.

- Fire-and-forget HTTP calls do NOT need `takeUntilDestroyed` (one-shot calls)
- `sessionStorage` for non-auth UI state (filter preferences, etc.) is acceptable. Only flag `localStorage`/`sessionStorage` for auth tokens (SEC5).
- Library-managed inline styles on grid/chart containers are acceptable if the library controls them.
- See `.claude/rules/project-config.md` "Accepted Conventions" for project-specific patterns.

## Scope-Based Audit Skills

Vertical skills go deep on a single unit; horizontal skills go broad across a single concern. Each flags up or down when findings exceed its scope.

**Vertical (depth-first):**

| Skill | Scope | Purpose | Checks |
|-------|-------|---------|--------|
| `/audit-method` | Single method | Is this function well-written? Produces refactored code if warranted. | G, S, E, SEC + B2 |
| `/audit-component` | Single class/component | Is this unit well-designed? Responsibility map + cohesion analysis. | G, S, E, SEC, T, CSS + H1, H4, B1 |
| `/audit-feature` | Feature area (cross-layer) | Is this slice well-integrated? Layer map + cross-file analysis. | G, S, SEC + H1-H5, V1-V2 |
| `/audit-arch` | Full system | Are the seams between things right? Dependency graph + hotspot ranking. | A + H3, H5, V1 |

**Horizontal (breadth-first):**

| Skill | Concern | Purpose | Checks |
|-------|---------|---------|--------|
| `/audit-models` | Models/DTOs across layers | Cross-layer field tracing, coupling maps, blast-radius tiers. Guide: `style-guides/model-smells-guide.md` | M + H3 |
| `/audit-error-paths` | Error handling & observability | Trace error propagation paths end-to-end, response shape consistency, frontend error display. Guide: `style-guides/error-smells-guide.md` | E1-E10 |
| `/audit-integrations` | External service patterns | Pattern matrix (auth, retry, error, logging, async) across all services. Guide: `style-guides/integration-smells-guide.md` | I1-I7 |
