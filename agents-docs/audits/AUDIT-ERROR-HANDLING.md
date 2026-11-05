# Audit: Error Handling (`error-handling`)

Style guide: `style-guides/error-handling.md`
Scope: exception flow and API error contracts across `api/GrainOriginatorPortal.Api`, and `client/` error handling

**Findings:** 10 total — 1 open, 8 resolved, 1 accepted
**Opened:** 2026-09-19 | **Last verified:** 2026-11-05

## Reconciliation note (2026-11-05)

Calibration re-run, scoped to `error-handling` only. Re-verified all previously-resolved findings
against current `HEAD` (no regressions — see below) and sampled new ground: a 36-file grep of
`catch (Exception ...)` across `Services/`, `Controllers/`, and `Infrastructure/Repositories/`
(empty catch blocks, `throw ex;`, silent swallows — none found), the resilience pipelines for the
Nominatim/Graph/CTRM `HttpClient`s and all four `DbContext` registrations (`EnableRetryOnFailure`,
correctly paired with `CreateExecutionStrategy()` in the one place with an explicit transaction),
and the `[Authorize]`/JWT-bearer-driven 401/403 path, which hadn't been examined in prior passes.

One new finding opened:

- **`error-handling.authz-short-circuit-missing-standard-envelope`** (medium) — ASP.NET Core's
  authorization middleware short-circuits on a failed `[Authorize]` check without throwing, so
  `GlobalExceptionHandler` (which only catches thrown exceptions via `app.UseExceptionHandler()`)
  never runs for these 401/403s. `AuthorizationAuditResultHandler.cs` adds the required audit log
  line but explicitly documents that it "delegates to the default implementation so the response
  is written exactly as before" — i.e. the framework's bare response, not the app's standard
  envelope. This is the same class of bug the team already fixed once for model-validation 400s
  (`ModelValidationEnvelopeTests.cs` pins that fix); the fix was never extended to the 401/403
  short-circuit path. See `AUDIT-TRACKING.json` for full detail and suggested fix.

Also re-verified, no change: `client/src/app/core/errors/api-error.ts`'s typed `ApiError` contract
is unchanged and still the sole error type `api.service.ts` throws; the catalog/lookup endpoints
(`EntitlementsController.GetCatalog`, `NotesController.GetMentionCatalog`) still set `Degraded =
true` rather than failing open silently; `GlobalExceptionHandler.cs` and
`GlobalExceptionHandlerTests.cs` are unchanged.

## Reconciliation note (2026-10-20)

Calibration re-run, scoped to `error-handling` only. This file's `## High`/`## Medium` sections had drifted from `AUDIT-TRACKING.json`: the JSON already recorded both remaining findings as `resolved` (`angular-silent-swallowing` on 2026-10-14, `catalog-endpoints-fail-open-to-200-on-dependency-failure` on 2026-10-13, same day as this file's prior "Last verified" stamp), but this markdown still listed them as open. Re-verified both directly against the current working tree rather than trusting either source blindly:

- **`error-handling.angular-silent-swallowing`** — `client/src/app/core/errors/api-error.ts` now exists: a typed `ApiError` class with `status`/`code`/`details`/`traceId`/`category` (derived via `categorizeStatus()`), built via `ApiError.fromHttpErrorResponse()` / `ApiError.fromUnknown()`. `api.service.ts`'s `handleError()` (line ~132) now throws only `ApiError`. Resolved, confirmed.
- **`error-handling.catalog-endpoints-fail-open-to-200-on-dependency-failure`** — `EntitlementsController.GetCatalog` (`EntitlementsController.cs:150-154`) and all three catches in `NotesController.GetMentionCatalog` (lines 166, 200, 221) now set `Degraded = true` on their response object before returning `Ok(...)` instead of returning indistinguishable-from-success empty data. The endpoints still answer 200 by design (product call, documented in both reconciliation history and code comments) but the client can now detect the degraded state. Resolved, confirmed. Also checked that the `EntitlementsDirectoryService` extraction (`e9699fc5`, pulled the directory read out of the controller) didn't regress this — the `Degraded`-setting catches stayed in the controllers, not the new service, so the flag still gets set correctly.

Also sampled the backend changes since the 2026-10-13 pass for new error-handling issues: `ClientTelemetryController.cs` (new, serves an App Insights connection string — no failure modes, nothing to catch), the Diagnostics-service-extraction refactor (`a5355b87`, controller bodies moved into six services, behavior-preserving per its own commit message), and `CtrmWarmReads.cs` (new seam for keep-warm isolation, inherits the already-reviewed `CtrmServerTimeoutRetry`/`CtrmKeepWarmBackoff` resilience pattern). No new findings.

No new findings were opened this pass; both previously-tracked gaps are now closed.

## Reconciliation note (2026-10-13)

Calibration re-run, scoped to `error-handling` only. Substantial feature work has landed since the 2026-09-28 pass (BarChart ingest feed, CTRM server-timeout retry/keep-warm backoff, planting intentions, producer details, bin sites/grain-on-farm) — roughly 80 backend files touched. Sampled the new resilience- and exception-flow-relevant code rather than the whole diff:

- `CtrmServerTimeoutRetry.cs` and `CtrmKeepWarmBackoff.cs` (new): bounded, config-clamped retry/backoff with fail-safe defaults (missing config → 0 retries), structured `LogWarning` on each retry, and documented reasoning for every magic number. Matches §6.
- `BarchartIngestController.cs` / `BarchartIngestService.cs` (new): no ad hoc try/catch in the controller — relies on `GlobalExceptionHandler`, consistent with the established pattern. Service wraps transient failures via `catch (Exception ex) when (ex is not OperationCanceledException)`, logs, and rethrows; validation failures throw a typed `ValidationException`. No swallowing found.
- `ProducerDetailsService.GetAllAsync` and `PlantingIntentionService.CreateAsync` (changed): both catch narrowly (`SqlException`/general with rethrow), log with context, and either rethrow or wrap into a typed `InfrastructureException` with the correct 503 — exactly the §3.4 pattern.
- `Program.cs`: `UseExceptionHandler()` and both `/health/live` + `/health/ready` endpoints confirmed still wired after the merges.
- Re-verified both remaining open findings against current `HEAD`: unchanged (see below).
- Checked `home.component.ts`'s silent `error: () => {}` subscriptions (flagged by the angular domain as `angular.no-typed-error-contract-silent-swallowing`, re-verified today under that domain at 10 remaining sites) — this is the same root cause as this domain's `angular-silent-swallowing` finding (no typed `ApiError` contract), not a separate error-handling gap; not duplicated here.

No new findings this pass.

## Reconciliation note (2026-09-28)

Calibration re-run, scoped to `error-handling` only. Re-read both remaining open findings against current `HEAD`: `api.service.ts`'s `handleError()` (lines 88-124) is unchanged — still wraps every `HttpErrorResponse` into a bare `Error` with `.status`/`.traceId` bolted on, no `ApiError` type exists, `error.code` is still never read. `EntitlementsController.GetCatalog` (`EntitlementsController.cs:155-159`) still catches `Exception`, logs at Warning, and returns `Ok(new EntitlementsCatalogResponse())` unconditionally. Neither finding has regressed or been fixed since the 2026-09-21 pass. A targeted grep for new empty catch blocks (`api/` and `client/src/`) turned up nothing on the .NET side; the one Angular hit (`activity-summary.component.ts`) is presentational `localStorage`/date-parsing defensiveness with explanatory comments, not a contract-swallowing gap, so it was not logged as a new finding. No new findings this pass.

## Reconciliation note (2026-09-21)

Six of the original nine findings were fixed on `fix_AuditPhase1Findings` and merged to `main` via PR #615 before this pass started: the `[ApiController]` validation envelope gap, ad hoc controller error bodies, the 429/`Retry-After` gap, the diagnostics geocode resilience bypass, the missing frontend `traceId` surface, and the missing 401 branch in `api.service.ts`. `inconsistent-client-retry-coverage` was dispositioned `accepted` (a product call, not a code gap). This pass re-verified the two remaining open findings against current code and sampled `GlobalExceptionHandler.cs`, `Program.cs` middleware/health-check wiring, and `GlobalExceptionHandlerTests.cs` for regressions or new gaps — found none. No new findings this pass.

## Open

### `[Authorize]`-driven 401/403 responses skip the standard `ApiErrorResponse` envelope (`error-handling.authz-short-circuit-missing-standard-envelope`) — medium
- **Files:** `Program.cs`, `Middleware/AuthorizationAuditResultHandler.cs`, `Middleware/GlobalExceptionHandler.cs`, `client/src/app/core/services/api.service.ts`
- See the 2026-11-05 reconciliation note above and `AUDIT-TRACKING.json` for full detail, evidence, and suggested fix.

## Accepted

### Client-side retry on transient failures is applied ad hoc in only 2 of dozens of call sites (`error-handling.inconsistent-client-retry-coverage`)
- **Files:** `bid-sheet.component.ts`, `build-list.component.ts`, `api.service.ts`
- Dispositioned `accepted` in the prior reconciliation pass — not pursued as a fix.

## Resolved

- `error-handling.apicontroller-default-validation-bypasses-standard-error-envelope` (high)
- `error-handling.controllers-return-adhoc-error-bodies-bypassing-envelope` (medium)
- `error-handling.rate-limit-429-skips-exception-handler-and-retry-after` (medium)
- `error-handling.diagnostics-geocode-bypasses-nominatim-resilience-pipeline` (medium)
- `error-handling.traceid-never-surfaced-to-frontend` (medium)
- `error-handling.no-401-session-expiry-handling-client` (low)
- `error-handling.angular-silent-swallowing` (high) — resolved 2026-10-14, confirmed this pass
- `error-handling.catalog-endpoints-fail-open-to-200-on-dependency-failure` (medium) — resolved 2026-10-13, confirmed this pass

## Overall health

Both the .NET and Angular sides remain a well-built foundation, with one new open finding this
pass. `GlobalExceptionHandler` correctly maps all exception categories to status/log-level/structured
fields (`{TraceId}`, `{ErrorCode}`, `{ErrorCategory}`) per §4.1/§4.2, sets `Retry-After` on 429/503,
exposes exception `Debug` detail only in Development, and is covered by `GlobalExceptionHandlerTests.cs`.
`/health/live` and `/health/ready` are both wired in `Program.cs` per §8. The Angular client has a
typed `ApiError` contract (`category`/`code`/`details`/`traceId`) that `api.service.ts` is the sole
thrower of, and the catalog/lookup endpoints that intentionally fail open to 200 carry a `Degraded`
flag so the client can distinguish "nothing to show" from "the lookup failed." EF Core transient-fault
retry (`EnableRetryOnFailure`) is configured on every `DbContext`, correctly paired with an execution
strategy in the one place with an explicit transaction. The remaining gap: the app fixed the
framework-default-response-shape problem for model-validation 400s but never extended that fix to
the `[Authorize]` 401/403 short-circuit path (see Open, above). The `accepted` disposition on
inconsistent client-side retry coverage remains a deliberate product call rather than a gap.
