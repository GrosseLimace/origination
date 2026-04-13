# Error Handling Smell Detection Guide

> This guide complements `error-handling-guide.md` (which defines prescriptive standards and patterns) with smell detection definitions and layer-specific conventions used by scope-based audit skills.

## The Error Propagation Path

Every error travels through multiple layers from origin to user. A break at any point means the user gets silence instead of feedback. The exact layers depend on your project's architecture (see `.claude/rules/project-config.md` "Architecture Layers"), but the general pattern is:

```
Error origin (DB exception / HTTP timeout / validation failure / external service error)
  → Data access layer: catch? log? rethrow? return error object?
    → Business logic layer: catch? transform? add context?
      → API layer: return proper status code? consistent shape?
        → HTTP Response: status code + JSON body
          → Frontend service layer: error handling?
            → UI component: set error state? show toast? show inline?
              → USER: sees what?
```

Your project may have fewer or more layers. The key questions at each boundary: **Is the error logged? Is it transformed appropriately? Does it reach the next layer?**

## Error Handling by Layer

These conventions describe common roles in a C#/Angular layered architecture. Map them to your project's actual layers via `.claude/rules/project-config.md` "Architecture Layers".

### Data Access Layer (Repositories)
- **Expected:** Let most exceptions propagate. Catch only when recovery is possible or logging is needed.
- **Logging:** Use `ILogger` for external service call failures. Not needed for simple CRUD.
- **Pattern:** `try { ... } catch (DbUpdateException ex) { _logger.LogError(...); throw; }`

### External Service Layer
- **Expected:** Return typed response objects with `Success`/`ErrorMessage` fields.
- **Reference:** See `.claude/rules/project-config.md` "Reference Implementation" for your project's gold standard.
- **Logging:** Always log external HTTP call failures with `ILogger`.
- **Pattern:** `try { ... return response; } catch (Exception ex) { _logger.LogError(ex, "..."); return new Response { Success = false, ErrorMessage = ex.Message }; }`

### Business Logic Layer (Services)
- **Expected:** Transform data access and external service errors into meaningful results. Do not swallow exceptions silently.
- **Logging:** Optional — add context if this layer is the right place to explain what went wrong.
- **Pattern:** Check service response `.Success` before proceeding. Let unexpected exceptions propagate to the API layer.

### API Layer (Controllers)
- **Expected:** Return appropriate HTTP status codes. Validate `ModelState`. Never return stack traces.
- **Standard responses:**
  - `Ok(result)` — success with data
  - `BadRequest(ModelState)` — validation failure
  - `BadRequest("message")` — custom validation error
  - `NotFound()` — resource not found
  - `StatusCode(500)` — should never be explicit; rely on global handler
- **Pattern:** `if (!ModelState.IsValid) return BadRequest(ModelState);`

### Frontend Component Layer
- **Expected:** Display errors to the user via toast notification or inline message.
- **Anti-pattern:** `error: err => this.errorMessage = err` with no template rendering.

## Error Smell Checklist

### Per-Layer Smells

| ID | Smell | What to look for | Severity |
|----|-------|-----------------|----------|
| E1 | Swallowed exception | `catch` block with no logging AND no rethrow — exception disappears silently | High |
| E2 | Sensitive data in logs | Logging passwords, tokens, API keys, PII, connection strings, or full request bodies | High |
| E3 | Missing CancellationToken | Async I/O method without `CancellationToken` parameter | Low |
| E4 | Unsafe error response | Returning stack traces, internal paths, DB errors, or server versions to client | High |
| E5 | Error 200 | Returning HTTP 200 with an error payload instead of proper status code | Medium |
| E6 | Raw exception type | `throw new Exception("...")` instead of a specific exception type | Low |
| E7 | Silent degradation | Method returns default/empty result on failure without logging or setting error state | Medium |

### Cross-Layer Smells (for `/audit-error-paths`)

| ID | Smell | What to look for | Severity |
|----|-------|-----------------|----------|
| E8 | Broken error path | Error handled at layer N, never reaches user. Business logic catches → returns default → controller returns Ok(default) → user sees empty state | High |
| E9 | Inconsistent error shape | Different controllers/endpoints return different error structures for the same failure type | Medium |
| E10 | Missing error display | Component captures error but template never renders it. User gets no feedback. | Medium |

## Accepted Conventions (do NOT flag)

- Controllers returning `BadRequest(ModelState)` for validation failures — established pattern
- Services returning typed response objects — target pattern
- Fire-and-forget HTTP calls with minimal error handling — acceptable for one-shot operations
- `console.error()` in development-only code paths — acceptable if also setting error state
- See `.claude/rules/project-config.md` "Accepted Conventions" for project-specific patterns

## Logging Coverage Expectations

| Layer | ILogger Required? | When |
|-------|------------------|------|
| External Services | Yes | Always — log request URL, response status, exceptions |
| Repositories | Conditional | Only when catching exceptions that won't propagate |
| Business Logic | No | Let exceptions propagate to API layer |
| Controllers | No | Framework handles logging via middleware |
| Frontend Components | No | Unless structured logging infrastructure exists |
