# Audit: Logging & Observability (`logging`)

Style guide: `style-guides/logging.md`
Scope: structured logging/correlation across `api/GrainOriginatorPortal.Api`, App Insights/Log Analytics posture, and `client/` error/telemetry handling. This pass also reviewed the new CTRM GraphQL integration (`Services/Ctrm`, `Infrastructure/Ctrm`) merged since the last pass.

**Findings:** 10 total — 7 resolved, 3 accepted, 0 open
**Opened:** 2026-09-19 | **Last verified:** 2026-10-20 (reconciliation pass)

## Reconciliation notes (2026-10-20)

Re-verified all 10 findings against current repo state. `AUDIT-TRACKING.json` already recorded
`logging.ctrm-dependency-latency-never-logged` and `logging.ctrm-keepwarm-cycles-lack-run-id` as
`resolved` (both found and fixed same-day on 2026-09-28), but this prose doc had drifted and still
listed them under "open" — corrected below. Confirmed directly in code:
`CtrmContractRepository.cs`/`CtrmTicketRepository.cs` now carry `{DurationMs}` on both the success
and failure log lines (`git show cc0e94dc`), and `CtrmKeepWarmService.WarmActiveSetsAsync` now opens
a `BeginScope` per cycle with `ServiceName`/`Operation`/a fresh `TraceId`/set count (`git show
772060c9`). No open findings remain; the three `accepted` findings are unchanged and still correctly
accepted (no code changes to `RequestContextMiddleware.cs`, the three background services, or
`GrainOriginatorPortal.Api.csproj`/`Program.cs`'s telemetry wiring since the last pass).

This pass covered the `release_BidSheetBarchart_2026-10-20` merge train (PR #726: Bid Sheet remodel,
BarChart bids feed turned on in PROD) plus two small client telemetry fixes shipped 2026-10-14/15.
Reviewed, no new findings:

- **`BidSheetService.cs`/`BarchartCatalogService.cs`/`BarchartIngestService.cs`** (BarChart feed
  turned on in PROD this release): structured message templates throughout, no secrets or raw
  payloads logged (zero-result catalog searches log the user-typed search term with an inline
  comment noting it's non-sensitive; bid-sheet access-resolution failures log the user id and fail
  closed to owner-only access, consistent with the dependency-call and access-decision rules in
  §7.2 and §7.4).
- **`fix(telemetry): stop the App Insights SDK fetching its CDN config, which the CSP blocks`**
  (`549336ee`) and **`fix(telemetry): stop the App Insights SDK subscribing to unload`**
  (`8554ae95`): both are CSP/browser-compatibility fixes to `app-insights.service.ts` (`blkCdnCfg`,
  `disablePageUnloadEvents`) that stop two recurring CSP-violation/console-noise sources from the
  client telemetry SDK added for `logging.client-side-telemetry-missing`. Neither changes what gets
  reported — exceptions still flush via `pagehide`/`visibilitychange` — so no regression of that
  finding's resolution.
- No stray `console.log`/`console.debug`/`console.info` found under `client/src` outside test files;
  no empty `catch` blocks found under `api/`.

## Reconciliation notes (2026-10-13)

Re-verified all 6 open/accepted findings against current repo state (the 4 resolved findings are frozen and not re-checked). All 6 are unchanged since 2026-09-28: `client/package.json` still has no `@microsoft/applicationinsights-*` dependency and no `app-insights.service.ts` exists; `main.ts`'s bootstrap `.catch` still gates `console.error` behind `if (!environment.production)`; `developer-docs/START-HERE.md` still documents only generic platform-level Smart Detection with no app-specific sampling/KQL/dashboard/alert content; the API still has no App Insights/OpenTelemetry/Serilog package reference; `UsageTrackingBackgroundService` is still the one accepted exception to per-run correlation scoping; and `RequestContextMiddleware` still logs the UPN as `UserId` under the existing accepted risk AR-09.

This pass covered the `release_2026-10-13` merge train: Bin Sites & Grain on Farm, Usage Dashboard manager-for-all, Build-a-List prompt-library fixes, and the CTRM trade-unit contract read being flipped to the default strategy (`feature_TradeUnitContractRead`, decided 2026-10-12). Notable new surface reviewed, with no new findings:

- **`BarchartIngestController`/`BarchartIngestService`/`BarchartIngestRepository`** (new vendor feed ingestion pipeline, migration `20260811142608_AddBarchartFeed` onward): well-instrumented per the guide — structured message templates with an elapsed-ms field (`{Ms}`), payload size logged instead of payload body (with an explicit code comment citing `style-guides/logging.md`'s no-body-logging rule), a dedicated `BarchartApiCallAudit` table for vendor-call accounting, and warnings (not silent drops) when quotes reference symbols missing from the catalog.
- **`LogSanitizer` middleware** (new): strips control characters (CR/LF/TAB/ESC) and caps length on request-supplied strings before they reach `RequestContextMiddleware` and `SecurityAuditMiddleware`. The code comment states this closes a QA-flagged CWE-117 log-forging finding (2026-09-30) where a URL-encoded CRLF in the request path could forge a second log line in the local console sink. Confirmed applied at the two call sites that take raw request/claim data (`Operation`, `UserId`, method, path). This is a genuine fix for a class of issue the style guide's §4 (structured fields) and §12 (data hygiene) care about; no corresponding finding existed in this audit previously, so nothing to close out, but it's worth noting since it directly improves the log-forging posture Section 12 implies.
- **CTRM trade-unit contract read** (`CtrmContractReader.cs`, now the default `TradeUnitContractStrategy`): the new code path logs elapsed time as a structured parameter (`{Seconds}`) alongside counts of contracts/units/producers/pages, consistent with the existing CTRM logging discipline already credited in the "Overall health" section below. `GlobalExceptionHandler`'s `{TraceId}` interpolation was re-checked given the new `CtrmSourceChoiceMiddleware`/toggle-user code referenced in commit history — that code path was a 2026-10-01 spike that was fully reverted by migration `20261005131626_DropCtrmSourceToggleUsers`; it is not present in the current tree and was not reviewed further.

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

## Medium — resolved

### No documented sampling settings, KQL queries, dashboards, or alert rules for this app (`logging.sampling-and-dashboards-undocumented`)
- **Files:** `developer-docs/START-HERE.md`, `docs/operations/OBSERVABILITY.md`
- Fixed 2026-10-13: added `docs/operations/OBSERVABILITY.md`, linked from `developer-docs/START-HERE.md`, documenting the actual sampling setting (none configured; 100% ingested per Dev/QA), the Origination Workbench as the home for saved KQL, and every alert that exists (Failure Anomalies, the two Logic App runs-failed alerts). Re-verified 2026-10-20: still present and accurate.

### CTRM dependency-call duration is computed but never reaches structured logs, only a non-prod response header (`logging.ctrm-dependency-latency-never-logged`)
- **Files:** `Infrastructure/Ctrm/CtrmProvenance.cs`, `Middleware/CtrmProvenanceMiddleware.cs`, `Infrastructure/Ctrm/CtrmContractRepository.cs`, `Infrastructure/Ctrm/CtrmTicketRepository.cs`
- Fixed same-day (`cc0e94dc`, 2026-09-28): the per-producer contract and ticket reads now carry `{DurationMs}` on both their success and failure log lines, taken from the `ContractsMs`/`TicketsMs` the provenance object already measured; on the failure path the `Record` call was moved above the log so the number is populated. Re-verified 2026-10-20 directly in `CtrmContractRepository.cs`.
- **Related findings:** `logging.api-insights-instrumentation-unverified`

## Medium — accepted

### API has no Application Insights/OpenTelemetry SDK reference; telemetry flow relies entirely on unverified platform auto-instrumentation (`logging.api-insights-instrumentation-unverified`)
- **Files:** `GrainOriginatorPortal.Api.csproj`, `Program.cs`, `developer-docs/CLAUDE.md`
- Re-verified: still no Application Insights/OpenTelemetry/Serilog package reference. Codeless attach via `APPLICATIONINSIGHTS_CONNECTION_STRING` remains the documented, deliberate choice. Whether the `BeginScope` fields (`ServiceName`, `Operation`, `TraceId`, `UserId`) actually surface as Log Analytics custom dimensions is still an unverified KQL check, not a code defect — recorded in `STYLE-DEVIATIONS.md`.
- **Suggested fix (if revisited):** Confirm via a Log Analytics query for `customDimensions.TraceId`/`ServiceName` that codeless attach is forwarding scope properties.

### Backend error traceId is never read or shown by the Angular client, breaking the support-reference workflow (`logging.frontend-correlation-id-not-surfaced`) — resolved
- **Files:** `client/src/app/core/services/api.service.ts`, `Middleware/GlobalExceptionHandler.cs`
- Fixed via PR #615: `ApiService.handleError` (`api.service.ts:117-118`) now reads `errObj.traceId` and attaches it to the thrown `Error`. Verified directly in the current file.

## Low — resolved

### CtrmKeepWarmService warm cycles do not scope their logs with a per-cycle correlation id (`logging.ctrm-keepwarm-cycles-lack-run-id`)
- **Files:** `Services/CtrmKeepWarmService.cs`
- Fixed same-day (`772060c9`, 2026-09-28): `WarmActiveSetsAsync` now opens an `ILogger` scope per cycle carrying `ServiceName`, `Operation` (`CtrmKeepWarm.Cycle`), a fresh `TraceId`, and the set count, matching `CustomerSyncBackgroundService`/`UsageAggregationBackgroundService`. Re-verified 2026-10-20 directly in the file.
- **Related findings:** `logging.background-job-runs-lack-correlation-id`

## Low — accepted

### Scheduled background services don't mint a per-run correlation id (`logging.background-job-runs-lack-correlation-id`)
- **Files:** `Services/CustomerSyncBackgroundService.cs`, `Services/UsageAggregationBackgroundService.cs`, `Services/UsageTrackingBackgroundService.cs`
- `CustomerSyncBackgroundService` and `UsageAggregationBackgroundService` wrap each run in `_logger.BeginScope(...RunId...)` (PR #615); `UsageTrackingBackgroundService` is deliberately excluded — a comment at the top of its `ExecuteAsync` explains it's a continuous 5-second flush loop (~17k iterations/day) that logs nothing but errors, so a per-flush id would add Log Analytics cardinality without answering a question anyone asks. Recorded as accepted rather than open.

### User's UPN (email-shaped identifier) is written into every structured log line app-wide (`logging.user-upn-logged-on-every-request`)
- **Files:** `Middleware/RequestContextMiddleware.cs`
- Re-verified: `RequestContextMiddleware` still resolves `preferred_username` (UPN) into the `UserId` scope field on every request. Formally accepted and recorded as **AR-09** in `SECURITY-REVIEWS/ACCEPTED-RISKS.md` (Low, CWE-532, accepted 2026-09-21, review due 2027-09-21) — the UPN is treated as the point, since an object-id GUID would make "who did this" unanswerable without a second Azure AD lookup, and the UPN/short name is already the identity key in the usage and entitlements tables.

## Overall health

Structured logging discipline within the .NET API remains genuinely good: consistent `ILogger<T>` usage, message templates with named placeholders, sensible level selection, a real `TraceId`/`ServiceName`/`Operation`/`UserId` scope threaded through every request (with input validation on the inbound correlation id), and dedicated security-audit logging for 401/403. The CTRM GraphQL integration and the newer BarChart feed subsystem both continue that discipline — structured error codes/categories, dependency-call durations now logged as `{DurationMs}`, CTRM's own correlation id captured and surfaced in failure details, careful separation of retryable server-side timeouts from real failures, and warnings (never silent empty results) on every read that doesn't complete. The front half of the stack, previously the weak point, has also closed out: the Angular SPA now reports unhandled exceptions, MSAL failures, and page views to Application Insights (`AppInsightsService`, resolved 2026-10-13, with two follow-up CSP/console-noise fixes on 2026-10-14/15), and a production bootstrap failure now always logs and shows a static fallback screen instead of a blank page. All 10 findings opened against this domain are now either resolved or formally accepted; the three accepted items (unverified codeless App Insights attach, two background services intentionally without per-run scope, and UPN logged as the user identifier — recorded as AR-09) are documented tradeoffs, not defects. The main residual gap is verification rather than code: whether the backend's `BeginScope` fields actually surface as Log Analytics custom dimensions, and production's own sampling/retention settings, still require direct Azure access this repo-only review cannot provide.
