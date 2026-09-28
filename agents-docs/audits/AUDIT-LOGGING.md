# Audit: Logging & Observability (`logging`)

Style guide: `style-guides/logging.md`
Scope: structured logging/correlation across `api/GrainOriginatorPortal.Api`, App Insights/Log Analytics posture, and `client/` error/telemetry handling. This pass also reviewed the new CTRM GraphQL integration (`Services/Ctrm`, `Infrastructure/Ctrm`) merged since the last pass.

**Findings:** 10 total — 2 resolved, 3 accepted, 5 open (1 critical, 1 high, 2 medium, 1 low)
**Opened:** 2026-09-19 | **Last verified:** 2026-09-28 (reconciliation pass)

## Reconciliation notes (2026-09-28)

Re-verified all 8 prior findings against current repo state; every one is unchanged since the 2026-09-21 pass (grep/read confirmed each file is in the same state described previously — see `last_verified` bumps in `AUDIT-TRACKING.json`). No status changes this pass.

New this pass: the branch history since 2026-09-21 (`650fae20` and earlier merges) added a substantial new CTRM GraphQL dependency integration — `CtrmGraphQlClient`, `CtrmContractReader`/`Repository`, `CtrmTicketReader`/`Repository`, `CtrmServerTimeoutRetry`, `CtrmKeepWarmService`, `CtrmProvenanceMiddleware`, `SurfaceCtrmFailuresAttribute`. Reviewed it against the guide's dependency-call logging rules (7.2, 7.4) and correlation rules (§6). Overall it is unusually well-instrumented for a first pass — structured `{ErrorCode}`/`{ErrorCategory}` fields, CTRM's own correlation id captured and threaded through failure details, careful distinction between retryable server-side timeouts (`HC0045`) and real failures, and deliberate warnings (not silent empty results) on every read that doesn't complete. Two gaps found:

- CTRM dependency-call duration is captured (`CtrmProvenance.ContractsMs`/`TicketsMs`) but only ever reaches a dev-only response header and a manual diagnostics endpoint — never a structured log field (medium, new).
- The new `CtrmKeepWarmService` background loop does substantive multi-step I/O per cycle but, unlike the two background services fixed in PR #615, has no per-cycle `BeginScope` (low, new).

## Reconciliation notes (2026-09-21)

Re-verified all 8 prior findings against current repo state rather than re-auditing from scratch. Three were confirmed fixed by `fix_AuditPhase1Findings` (PR #615, merged 2026-09-21): the correlation-id validation, the frontend traceId surfacing, and (partially) the background-job run scopes. One status changed from the bulk `chore(audit)` pass: `logging.background-job-runs-lack-correlation-id` was marked `resolved` there, but the fix only touched 2 of the 3 named files — `UsageTrackingBackgroundService.cs` still has no per-run scope — so it's reopened here at `low`. Everything else (the critical client-telemetry gap, the bootstrap-logging gap, the unverified App Insights wiring, the undocumented sampling/dashboards, and the accepted UPN logging) is unchanged since 2026-09-19.

## Critical — open

### Angular client has no error/telemetry logging service at all, contradicting the team's own mandatory pattern (`logging.client-side-telemetry-missing`)
- **Files:** `client/src/main.ts`, `client/src/app/core/handlers/global-error.handler.ts`, `client/src/app/app.component.ts`, `client/package.json`, `developer-docs/CLAUDE.md`
- Re-verified: `client/package.json` still has no `@microsoft/applicationinsights-*` dependency, no `app-insights.service.ts` exists anywhere under `client/src`, and `ErrorHandler` is still bound to `GlobalErrorHandler` (console-only in dev, silent in prod). `developer-docs/CLAUDE.md` still documents client-side Application Insights as required for any MSAL Angular SPA — this repo doesn't have it.
- **Related findings:** `angular.production-bootstrap-failures-swallowed`
- **Suggested fix:** Implement the `AppInsightsService`/`AppInsightsErrorHandler`/MSAL-telemetry-forwarder pattern already specified in `developer-docs/CLAUDE.md`, wire it into `main.ts`'s providers, and add the connection string plus CSP allow-list entries per environment — or, if the team has decided this isn't worth building, amend `developer-docs/CLAUDE.md` so it stops mandating a pattern that doesn't exist.

## High — open

### Production Angular bootstrap failures produce zero diagnostic trail (`logging.bootstrap-failure-not-logged`)
- **Files:** `client/src/main.ts`
- Re-verified: `main.ts:117-121`'s `bootstrapApplication(...).catch` handler still gates `console.error` behind `if (!environment.production)`. Combined with the missing client-side telemetry client, a prod bootstrap failure (bad provider factory, MSAL init throw, etc.) still renders a blank page with no console entry, no App Insights exception, nothing.
- **Related findings:** `angular.production-bootstrap-failures-swallowed`, `logging.client-side-telemetry-missing`
- **Suggested fix:** Always log the bootstrap error (drop the non-production guard) and, once client-side telemetry exists, call `trackException` there unconditionally since DI-provided services aren't available yet.

## High — resolved

### Unvalidated inbound X-Correlation-Id is trusted as the structured-log TraceId for every log line (`logging.correlation-id-unvalidated`)
- **Files:** `Middleware/CorrelationIdMiddleware.cs`, `Middleware/RequestContextMiddleware.cs`, `Middleware/SecurityAuditMiddleware.cs`, `Middleware/GlobalExceptionHandler.cs`, `Middleware/CorrelationIdOutboundHandler.cs`, `Program.cs`
- Fixed via PR #615: `CorrelationIdMiddleware` now has an internal `IsWellFormed()` check — rejects anything over `MaxLength = 64` chars or outside `[A-Za-z0-9-_.:]`, falling back to `Activity.Current?.TraceId` or a fresh GUID instead of trusting the header. Verified directly in the current file.

## Medium — open

### No documented sampling settings, KQL queries, dashboards, or alert rules for this app (`logging.sampling-and-dashboards-undocumented`)
- **Files:** `developer-docs/START-HERE.md`
- Re-verified: `developer-docs/START-HERE.md` still only references generic platform-level Smart Detection; no file under `developer-docs/` documents an app-specific sampling percentage, saved KQL queries, an operational dashboard/workbook, or alert-to-on-call mapping.
- **Suggested fix:** Add an Observability section to `developer-docs/CLAUDE.md` recording the sampling setting, a few saved KQL queries, and per-environment alert/action-group mapping.

### CTRM dependency-call duration is computed but never reaches structured logs, only a non-prod response header (`logging.ctrm-dependency-latency-never-logged`) — new
- **Files:** `Infrastructure/Ctrm/CtrmProvenance.cs`, `Middleware/CtrmProvenanceMiddleware.cs`, `Infrastructure/Ctrm/CtrmContractRepository.cs`, `Infrastructure/Ctrm/CtrmTicketRepository.cs`
- `CtrmProvenance.RecordContracts`/`RecordTickets` stamp `ContractsMs`/`TicketsMs` via a `Stopwatch`, but the only consumers are `CtrmProvenanceMiddleware` (a `Server-Timing` header, gated to non-production) and `DiagnosticsController` (a manual, on-demand endpoint). No repository or client code passes these values into any `ILogger` call, so `durationMs` never appears on the many structured log lines already emitted for CTRM reads. The guide lists `durationMs` as required-when-applicable for dependency calls (§4.1) and calls out latency-degrading dependency calls as a required log point (§7.2). This integration has explicitly documented severe latency (a cold `contracts(customerIds:)` page for 500 producers runs 22-25s, per `CtrmServerTimeoutRetry.cs`'s own comments — right at the 30s server timeout), so a call that is slow-but-succeeds in production is invisible to Log Analytics/App Insights; only an outright failure is diagnosable from logs today.
- **Related findings:** `logging.api-insights-instrumentation-unverified`
- **Suggested fix:** Thread `provenance.ContractsMs`/`TicketsMs` (or a locally-scoped `Stopwatch`) into the existing success/failure log lines in `CtrmContractRepository`/`CtrmTicketRepository` as a structured `{DurationMs}` property.

## Medium — accepted

### API has no Application Insights/OpenTelemetry SDK reference; telemetry flow relies entirely on unverified platform auto-instrumentation (`logging.api-insights-instrumentation-unverified`)
- **Files:** `GrainOriginatorPortal.Api.csproj`, `Program.cs`, `developer-docs/CLAUDE.md`
- Re-verified: still no Application Insights/OpenTelemetry/Serilog package reference. Codeless attach via `APPLICATIONINSIGHTS_CONNECTION_STRING` remains the documented, deliberate choice. Whether the `BeginScope` fields (`ServiceName`, `Operation`, `TraceId`, `UserId`) actually surface as Log Analytics custom dimensions is still an unverified KQL check, not a code defect — recorded in `STYLE-DEVIATIONS.md`.
- **Suggested fix (if revisited):** Confirm via a Log Analytics query for `customDimensions.TraceId`/`ServiceName` that codeless attach is forwarding scope properties.

### Backend error traceId is never read or shown by the Angular client, breaking the support-reference workflow (`logging.frontend-correlation-id-not-surfaced`) — resolved
- **Files:** `client/src/app/core/services/api.service.ts`, `Middleware/GlobalExceptionHandler.cs`
- Fixed via PR #615: `ApiService.handleError` (`api.service.ts:117-118`) now reads `errObj.traceId` and attaches it to the thrown `Error`. Verified directly in the current file.

## Low — open

### CtrmKeepWarmService warm cycles do not scope their logs with a per-cycle correlation id (`logging.ctrm-keepwarm-cycles-lack-run-id`) — new
- **Files:** `Services/CtrmKeepWarmService.cs`
- `WarmActiveSetsAsync` runs every `Ctrm:KeepWarmMinutes` (default 5) and, per active producer set, issues a contracts read, a ticket-history read, and a Spot Loads read, logging a warning per read that doesn't complete plus a final summary line — none of it scoped with a per-cycle or per-set id the way HTTP requests get `TraceId` via `RequestContextMiddleware`, or the way `CustomerSyncBackgroundService`/`UsageAggregationBackgroundService` already got a `RunId` scope via PR #615. If two producer sets are warmed in the same cycle and one logs failures, there's no field to filter Log Analytics down to just that set/cycle's lines.
- **Related findings:** `logging.background-job-runs-lack-correlation-id`
- **Suggested fix:** Wrap each cycle or per-set iteration in `_logger.BeginScope(new { CycleId = Guid.NewGuid(), Producers = codes.Count })`, matching the pattern already used in the two fixed background services.

## Low — accepted

### Scheduled background services don't mint a per-run correlation id (`logging.background-job-runs-lack-correlation-id`)
- **Files:** `Services/CustomerSyncBackgroundService.cs`, `Services/UsageAggregationBackgroundService.cs`, `Services/UsageTrackingBackgroundService.cs`
- `CustomerSyncBackgroundService` and `UsageAggregationBackgroundService` wrap each run in `_logger.BeginScope(...RunId...)` (PR #615); `UsageTrackingBackgroundService` is deliberately excluded — a comment at the top of its `ExecuteAsync` explains it's a continuous 5-second flush loop (~17k iterations/day) that logs nothing but errors, so a per-flush id would add Log Analytics cardinality without answering a question anyone asks. Recorded as accepted rather than open.

### User's UPN (email-shaped identifier) is written into every structured log line app-wide (`logging.user-upn-logged-on-every-request`)
- **Files:** `Middleware/RequestContextMiddleware.cs`
- Re-verified: `RequestContextMiddleware` still resolves `preferred_username` (UPN) into the `UserId` scope field on every request. Formally accepted and recorded as **AR-09** in `SECURITY-REVIEWS/ACCEPTED-RISKS.md` (Low, CWE-532, accepted 2026-09-21, review due 2027-09-21) — the UPN is treated as the point, since an object-id GUID would make "who did this" unanswerable without a second Azure AD lookup, and the UPN/short name is already the identity key in the usage and entitlements tables.

## Overall health

Structured logging discipline within the .NET API itself remains genuinely good: consistent `ILogger<T>` usage, message templates with named placeholders, sensible level selection, a real `TraceId`/`ServiceName`/`Operation`/`UserId` scope threaded through every request (now with input validation on the inbound correlation id), and dedicated security-audit logging for 401/403. The new CTRM GraphQL integration continues that discipline — structured error codes/categories, CTRM's own correlation id captured and surfaced in failure details, careful separation of retryable server-side timeouts from real failures, and warnings (never silent empty results) on every read that doesn't complete — with two gaps: dependency-call latency is captured but never logged, and one new background loop lacks a per-cycle scope. The weak point is still the front half of the stack: the Angular SPA has no error/exception telemetry client at all despite the team's own documentation mandating one for any MSAL app, a prod bootstrap failure is still invisible, and nothing in the repo can confirm whether the backend's structured fields actually reach Log Analytics without direct Azure verification. Dashboards, alerts, and sampling remain undocumented for this specific app.
