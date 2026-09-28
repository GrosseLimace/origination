# Audit: Error Handling (`error-handling`)

Style guide: `style-guides/error-handling.md`
Scope: exception flow and API error contracts across `api/GrainOriginatorPortal.Api`, and `client/` error handling

**Findings:** 2 open (1 high, 1 medium) — 6 resolved, 1 accepted
**Opened:** 2026-09-19 | **Last verified:** 2026-09-28

## Reconciliation note (2026-09-28)

Calibration re-run, scoped to `error-handling` only. Re-read both remaining open findings against current `HEAD`: `api.service.ts`'s `handleError()` (lines 88-124) is unchanged — still wraps every `HttpErrorResponse` into a bare `Error` with `.status`/`.traceId` bolted on, no `ApiError` type exists, `error.code` is still never read. `EntitlementsController.GetCatalog` (`EntitlementsController.cs:155-159`) still catches `Exception`, logs at Warning, and returns `Ok(new EntitlementsCatalogResponse())` unconditionally. Neither finding has regressed or been fixed since the 2026-09-21 pass. A targeted grep for new empty catch blocks (`api/` and `client/src/`) turned up nothing on the .NET side; the one Angular hit (`activity-summary.component.ts`) is presentational `localStorage`/date-parsing defensiveness with explanatory comments, not a contract-swallowing gap, so it was not logged as a new finding. No new findings this pass.

## Reconciliation note (2026-09-21)

Six of the original nine findings were fixed on `fix_AuditPhase1Findings` and merged to `main` via PR #615 before this pass started: the `[ApiController]` validation envelope gap, ad hoc controller error bodies, the 429/`Retry-After` gap, the diagnostics geocode resilience bypass, the missing frontend `traceId` surface, and the missing 401 branch in `api.service.ts`. `inconsistent-client-retry-coverage` was dispositioned `accepted` (a product call, not a code gap). This pass re-verified the two remaining open findings against current code and sampled `GlobalExceptionHandler.cs`, `Program.cs` middleware/health-check wiring, and `GlobalExceptionHandlerTests.cs` for regressions or new gaps — found none. No new findings this pass.

## High

### No client-side type models the backend's standard error contract, enabling systemic silent swallowing (`error-handling.angular-silent-swallowing`)
- **Files:** `client/src/app/core/services/api.service.ts`
- Re-verified 2026-09-21: `handleError()` now reads `traceId` and has both 401 and 403 branches (both previously-open gaps are fixed), but it still unwraps every `HttpErrorResponse` into a bare `Error` with unsafely-cast `.status`/`.traceId` properties — no `ApiError` class/interface exists anywhere in the Angular app, and `error.code` is still discarded. Root cause of the angular-domain finding's component-level symptom is unchanged.
- **Suggested fix:** Introduce one typed `ApiError` class built centrally in `handleError()`, make it the only error type `ApiService` ever throws, and require callers to branch on `.category`/`.code` instead of string-matching messages.

## Medium

### Catalog/lookup endpoints swallow backend dependency failures into HTTP 200 with empty or partial data (`error-handling.catalog-endpoints-fail-open-to-200-on-dependency-failure`)
- **Files:** `Controllers/EntitlementsController.cs`, `Controllers/NotesController.cs`
- Re-verified 2026-09-21: `GetCatalog` (`EntitlementsController.cs:155`) and the three independent `catch(Exception)` blocks in `NotesController`'s mention-catalog lookup still log at Warning and return `Ok(...)` regardless of which upstream source failed — confirmed still present, and the code comments indicate this is deliberate ("returning empty lists").
- **Suggested fix:** Add a `degraded` flag to these responses instead of silently returning indistinguishable-from-success empty/partial data. Whether the mention picker should instead return an error status is a product call, not a pure code fix.

## Accepted

### Client-side retry on transient failures is applied ad hoc in only 2 of dozens of call sites (`error-handling.inconsistent-client-retry-coverage`)
- **Files:** `bid-sheet.component.ts`, `build-list.component.ts`, `api.service.ts`
- Dispositioned `accepted` in the prior reconciliation pass — not pursued as a fix.

## Resolved (this reconciliation)

- `error-handling.apicontroller-default-validation-bypasses-standard-error-envelope` (high)
- `error-handling.controllers-return-adhoc-error-bodies-bypassing-envelope` (medium)
- `error-handling.rate-limit-429-skips-exception-handler-and-retry-after` (medium)
- `error-handling.diagnostics-geocode-bypasses-nominatim-resilience-pipeline` (medium)
- `error-handling.traceid-never-surfaced-to-frontend` (medium)
- `error-handling.no-401-session-expiry-handling-client` (low)

## Overall health

The .NET side remains a well-built foundation: `GlobalExceptionHandler` correctly maps all exception categories to status/log-level/structured fields (`{TraceId}`, `{ErrorCode}`, `{ErrorCategory}`) per §4.1/§4.2, sets `Retry-After` on 429/503, exposes exception `Debug` detail only in Development, and is covered by `GlobalExceptionHandlerTests.cs`. `/health/live` and `/health/ready` are both wired in `Program.cs` per §8. Most of the edge-case gaps found in the original pass (the `[ApiController]` envelope short-circuit, the bypassed 429 path, ad hoc controller bodies, the missing traceId/401 surfacing on the client) are now fixed. What remains is the Angular side's lack of a typed error contract (`ApiError`) and a small, apparently deliberate set of catalog endpoints that fail open to 200 instead of signaling degradation.
