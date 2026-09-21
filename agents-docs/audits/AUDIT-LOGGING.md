# Audit: Logging & Observability (`logging`)

Style guide: `style-guides/logging.md`
Scope: structured logging/correlation across `api/GrainOriginatorPortal.Api`, App Insights/Log Analytics posture, and `client/` error/telemetry handling

**Findings:** 8 open — 1 critical, 2 high, 3 medium, 2 low
**Opened:** 2026-09-19 | **Last verified:** 2026-09-19

## Critical

### Angular client has no error/telemetry logging service at all, contradicting the team's own mandatory pattern (`logging.client-side-telemetry-missing`)
- **Files:** `client/src/main.ts`, `client/src/app/core/handlers/global-error.handler.ts`, `client/src/app/app.component.ts`, `client/package.json`, `developer-docs/CLAUDE.md`
- `developer-docs/CLAUDE.md` states client-side Application Insights is required for any Scoular Angular SPA using MSAL, and prescribes a full pattern (`AppInsightsService`, `AppInsightsErrorHandler`, MSAL event forwarding, CSP allow-list, per-environment connection string). None of it exists: the App Insights web/angular packages are absent from `client/package.json`, no `app-insights.service.ts` exists, and `ErrorHandler` is bound to `GlobalErrorHandler` which only `console.error`s in dev mode and shows a generic toast — reporting nothing in production. MSAL events are consumed only to drive an `isAuthenticated` signal and never forwarded to telemetry.
- **Related findings:** `angular.production-bootstrap-failures-swallowed`
- **Suggested fix:** Implement the `AppInsightsService`/`AppInsightsErrorHandler`/MSAL-telemetry-forwarder pattern already specified in `developer-docs/CLAUDE.md`, wire it into `main.ts`'s providers, and add the connection string plus CSP allow-list entries per environment.

## High

### Unvalidated inbound X-Correlation-Id is trusted as the structured-log TraceId for every log line (`logging.correlation-id-unvalidated`)
- **Files:** `Middleware/CorrelationIdMiddleware.cs`, `Middleware/RequestContextMiddleware.cs`, `Middleware/SecurityAuditMiddleware.cs`, `Middleware/GlobalExceptionHandler.cs`, `Middleware/CorrelationIdOutboundHandler.cs`, `Program.cs`
- `CorrelationIdMiddleware` takes the inbound header with no length cap, character filter, or format check, then `RequestContextMiddleware` puts it into an `ILogger.BeginScope` `TraceId` field inherited by every logger in the request, and it's forwarded outbound via `CorrelationIdOutboundHandler`. An attacker-supplied value becomes the primary correlation key across the whole telemetry pipeline — log-forging into KQL-queried fields, correlation-dashboard pollution, cross-request correlation spoofing, and ingestion-cost inflation via unbounded length.
- **Related findings:** `dotnet.correlation-id-header-unbounded`
- **Suggested fix:** Accept the inbound header only if it matches a safe format (e.g. GUID or bounded alphanumeric/hyphen, ≤64 chars); otherwise discard it and mint a fresh ID, same as the no-header path.

### Production Angular bootstrap failures produce zero diagnostic trail (`logging.bootstrap-failure-not-logged`)
- **Files:** `client/src/main.ts`
- `bootstrapApplication(...).catch` is a no-op in production. Combined with the missing client-side telemetry client, a prod bootstrap failure (bad provider factory, MSAL init throw, etc.) renders a blank page with no console entry, no App Insights exception, nothing.
- **Related findings:** `angular.production-bootstrap-failures-swallowed`, `logging.client-side-telemetry-missing`
- **Suggested fix:** Always log the bootstrap error (drop the non-production guard) and, once client-side telemetry exists, call `trackException` there unconditionally since DI-provided services aren't available yet.

## Medium

### API has no Application Insights/OpenTelemetry SDK reference; telemetry flow relies entirely on unverified platform auto-instrumentation (`logging.api-insights-instrumentation-unverified`)
- **Files:** `GrainOriginatorPortal.Api.csproj`, `Program.cs`, `developer-docs/CLAUDE.md`
- No Application Insights/OpenTelemetry/Serilog package reference; `developer-docs/CLAUDE.md` documents App Service codeless attach as intentional, but nothing in the repo confirms the structured `BeginScope` fields (`ServiceName`, `Operation`, `TraceId`, `UserId`) actually surface as queryable custom dimensions in Log Analytics — this needs direct Azure verification, not just code review.
- **Suggested fix:** Confirm via a Log Analytics query for `customDimensions.TraceId`/`ServiceName` that codeless attach is forwarding scope properties; if not, add the SDK/Distro package explicitly.

### Backend error traceId is never read or shown by the Angular client, breaking the support-reference workflow (`logging.frontend-correlation-id-not-surfaced`)
- **Files:** `client/src/app/core/services/api.service.ts`, `Middleware/GlobalExceptionHandler.cs`
- `GlobalExceptionHandler` builds a user-facing 500 message including a `(Ref: {traceId})` specifically so a user can hand that reference to support, but `ApiService.handleError` never reads `.traceId`, silently dropping it on every frontend error path.
- **Suggested fix:** Extract `error.error.error.traceId` in `ApiService.handleError`, attach it to the thrown Error object, and surface it in the toast/telemetry call.

### No documented sampling settings, KQL queries, dashboards, or alert rules for this app (`logging.sampling-and-dashboards-undocumented`)
- **Files:** `developer-docs/START-HERE.md`
- No file under `developer-docs/` documents an App Insights sampling percentage, saved KQL queries, an operational dashboard, or alert-to-on-call mapping specific to this app, though the style guide requires these to be explicit documented decisions rather than inherited platform defaults.
- **Suggested fix:** Add an Observability section to `developer-docs/CLAUDE.md` recording the sampling setting, a few saved KQL queries, and per-environment alert/action-group mapping.

## Low

### Scheduled background services don't mint a per-run correlation id (`logging.background-job-runs-lack-correlation-id`)
- **Files:** `Services/CustomerSyncBackgroundService.cs`, `Services/UsageAggregationBackgroundService.cs`, `Services/UsageTrackingBackgroundService.cs`
- Good level discipline but no per-execution id/scope, unlike HTTP requests which get `TraceId` via `RequestContextMiddleware`. A misbehaving nightly run has no single field to filter Log Analytics to just that run.
- **Suggested fix:** Wrap each `ExecuteAsync` run body in `ILogger.BeginScope(new { RunId = Guid.NewGuid() })`.

### User's UPN (email-shaped identifier) is written into every structured log line app-wide (`logging.user-upn-logged-on-every-request`)
- **Files:** `Middleware/RequestContextMiddleware.cs`
- `preferred_username` (UPN) is placed in the `UserId` scope field on every request's logs, becoming a queryable custom dimension on every trace. Plausibly an intentional accountability tradeoff for an internal B2B app, but undocumented as such.
- **Suggested fix:** Confirm and document as an accepted tradeoff, or switch to the Azure AD object id with UPN resolved only at query time.

## Overall health

Structured logging discipline within the .NET API itself is genuinely good: consistent `ILogger<T>` usage, message templates with named placeholders, sensible level selection, a real `TraceId`/`ServiceName`/`Operation`/`UserId` scope threaded through every request, and dedicated security-audit logging for 401/403. The weak point is the front half of the stack: the correlation ID that anchors all of this is accepted from the client unvalidated, the Angular SPA has no error/exception telemetry client at all despite the team's own documentation mandating one for any MSAL app, and nothing in the repo can confirm whether the backend's structured fields actually reach Log Analytics without direct Azure verification. Dashboards, alerts, and sampling are undocumented for this specific app.
