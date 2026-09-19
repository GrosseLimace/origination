# Audit: Error Handling (`error-handling`)

Style guide: `style-guides/error-handling.md`
Scope: exception flow and API error contracts across `api/GrainOriginatorPortal.Api`, and `client/` error handling

**Findings:** 9 open — 0 critical, 2 high, 5 medium, 2 low
**Opened:** 2026-09-19 | **Last verified:** 2026-09-19

## High

### [ApiController] automatic model-validation responses never use the standard error envelope (`error-handling.apicontroller-default-validation-bypasses-standard-error-envelope`)
- **Files:** `Program.cs`, `Models/Requests/CreateNoteRequest.cs`, `Middleware/GlobalExceptionHandler.cs`
- All 23 controllers carry `[ApiController]`, and `Program.cs` never configures `ApiBehaviorOptions.InvalidModelStateResponseFactory`. Any data-annotation failure on the 21 validated request DTOs is short-circuited by the ASP.NET Core framework default into RFC7807 `ValidationProblemDetails` JSON before `GlobalExceptionHandler` or the app's own `ValidationException` ever run — the single most common validation-failure path across the whole write surface never matches the mandated error envelope shape.
- **Suggested fix:** Configure `ApiBehaviorOptions.InvalidModelStateResponseFactory` to build the same `ApiErrorResponse` envelope `GlobalExceptionHandler` produces for a thrown `ValidationException`.

### No client-side type models the backend's standard error contract, enabling systemic silent swallowing (`error-handling.angular-silent-swallowing`)
- **Files:** `client/src/app/core/services/api.service.ts`, `client/src/app/core/services/data-preload.service.ts`
- No `ApiError` class/interface exists anywhere in the Angular app. `ApiService.handleError()` unwraps every `HttpErrorResponse` into a bare `Error` object with an unsafely-cast `.status` property, discarding `error.code`, `error.details`, and `error.traceId` outright. With no shared typed error surface, roughly two dozen `.subscribe({error: () => {}})` blocks and `DataPreloadService`'s uniform `catchError(() => of([]))` (11 datasets) each independently improvise or skip error handling. This is the root CONTRACT gap behind the angular-domain finding's component-level symptom.
- **Related findings:** `angular.no-typed-error-contract-silent-swallowing`
- **Suggested fix:** Introduce one typed `ApiError` class built centrally in `ApiService.handleError()`, make it the only error type `ApiService` ever throws, and require callers to branch on `.category`.

## Medium

### A handful of controllers return raw strings/anonymous objects instead of throwing through GlobalExceptionHandler (`error-handling.controllers-return-adhoc-error-bodies-bypassing-envelope`)
- **Files:** `Controllers/UsageDashboardController.cs`, `Controllers/CustomersController.cs`, `Controllers/BidSheetController.cs`, `Controllers/DiagnosticsController.cs`
- Return ad hoc bodies directly instead of throwing `ValidationException`/`BusinessException`, unlike 59 call sites across 24 other files. The bare-string case is worst: Angular's `handleError()` fallback chain cannot extract anything from a plain string body, falling through to a generic error message.
- **Suggested fix:** Replace with `throw new ValidationException(...)`/`throw new BusinessException(...)` so they flow through `GlobalExceptionHandler`.

### The only real producer of HTTP 429 never gets a Retry-After header or the standard envelope (`error-handling.rate-limit-429-skips-exception-handler-and-retry-after`)
- **Files:** `Program.cs`, `Middleware/GlobalExceptionHandler.cs`
- The `AddRateLimiter` fixed-window limiter is the sole 429 source in the codebase. No `OnRejected` callback is configured, so the rejection bypasses `GlobalExceptionHandler` entirely with an empty body and no headers — `GlobalExceptionHandler`'s own `Retry-After: 30` logic for 429 is dead code.
- **Suggested fix:** Configure `options.OnRejected` on `AddRateLimiter` to write the standard envelope and set `Retry-After`.

### Diagnostics elevator-geocoding bypasses the app's own nominatim retry/circuit-breaker pipeline (`error-handling.diagnostics-geocode-bypasses-nominatim-resilience-pipeline`)
- **Files:** `Controllers/DiagnosticsController.cs`, `Program.cs`, `Services/GeocodeService.cs`
- `GeocodeService` correctly uses the configured `"nominatim"` HttpClient (10s timeout, retry, circuit breaker). `DiagnosticsController.PopulateElevatorCache`/`GeocodeElevatorsBackground` instead call the bare default client against the same host with no resilience, only a per-item catch-and-continue.
- **Related findings:** `dotnet.diagnostics-controller-bypasses-service-layer`
- **Suggested fix:** Resolve the client via `httpFactory.CreateClient("nominatim")` in both diagnostics geocoding paths.

### Catalog/lookup endpoints swallow backend dependency failures into HTTP 200 with empty or partial data (`error-handling.catalog-endpoints-fail-open-to-200-on-dependency-failure`)
- **Files:** `Controllers/EntitlementsController.cs`, `Controllers/NotesController.cs`
- `GetCatalog`/`GetMentionCatalog` wrap DB lookups in `catch(Exception)`, log at Warning, and return `Ok(...)` regardless — the HTTP status never reflects the failure.
- **Related findings:** `dotnet.duplicated-entitlement-catalog-logic`, `angular.no-typed-error-contract-silent-swallowing`
- **Suggested fix:** Add a `degraded` flag to these responses instead of silently returning indistinguishable-from-success empty/partial data.

### Backend traceId is generated and returned but the Angular client never reads or surfaces it (`error-handling.traceid-never-surfaced-to-frontend`)
- **Files:** `client/src/app/core/services/api.service.ts`, `Middleware/CorrelationIdMiddleware.cs`
- `CorrelationIdMiddleware` propagates a traceId into every error response, but `handleError()` never reads `error.error.error.traceId` and no UI surface displays it — a user-reported failure can't be traced back to server logs.
- **Related findings:** `error-handling.angular-silent-swallowing`, `logging.frontend-correlation-id-not-surfaced`
- **Suggested fix:** Extract `traceId` in `handleError()` and have error toasts append `(Ref: {traceId})` for Infrastructure/Unexpected categories.

## Low

### Client error handling branches on 403 but has no equivalent branch for 401 (`error-handling.no-401-session-expiry-handling-client`)
- **Files:** `client/src/app/core/services/api.service.ts`
- `handleError()` special-cases `status===403` with a toast but has no 401 branch, so an expired/revoked session falls through to the generic (often swallowed) error path instead of a session-expired message.
- **Related findings:** `error-handling.angular-silent-swallowing`
- **Suggested fix:** Add a 401 branch that triggers re-authentication or a session-expired toast, mirroring the 403 branch.

### Client-side retry on transient failures is applied ad hoc in only 2 of dozens of call sites (`error-handling.inconsistent-client-retry-coverage`)
- **Files:** `bid-sheet.component.ts`, `build-list.component.ts`, `api.service.ts`
- Only these two components apply retry/timeout handling; the other ~90+ `ApiService` call sites have no timeout or retry, so a transient blip looks identical to a permanent failure everywhere else.
- **Related findings:** `error-handling.angular-silent-swallowing`
- **Suggested fix:** Move a standard `retry({count,delay})` into `ApiService`'s shared pipeline for idempotent GETs.

## Overall health

The .NET side has a genuinely well-built foundation — a proper exception hierarchy, a `GlobalExceptionHandler` that correctly maps categories to status/log-level, dev-only exception detail exposure, and exemplary Polly-based retry+circuit-breaker+timeout configuration — undermined by gaps at its edges: the framework's own `[ApiController]` validation short-circuit was never wired into the custom envelope, the one real 429 source bypasses it completely, and a few controllers/diagnostics paths route around it ad hoc. The Angular side is the weaker half: no typed error contract anywhere on the client, the backend's traceId/error-code richness discarded at the first opportunity, and the resulting lack of a shared mechanism is what allowed roughly two dozen call sites plus the entire `DataPreloadService` to converge independently on "swallow and return empty." Fixing the `[ApiController]` envelope gap and introducing one typed `ApiError` class on the Angular side would resolve the majority of the concrete gaps found here.
