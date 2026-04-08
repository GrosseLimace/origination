# Logging Guide — Azure App Service, Azure Monitor, and Azure SQL

**Version:** 0.1
**Date:** 2026-03-30
**Applies to:** Azure App Service, .NET / ASP.NET Core backends, Angular frontends, Azure SQL Database, Azure Monitor, Application Insights, Log Analytics workspaces
**Purpose:** Establish a single logging and observability standard for application teams so logs are structured, correlated, searchable, cost-conscious, and actionable across application, platform, and database layers.

> **Related guides:**
>
> - Use `error-handling-guide.md` for exception semantics, HTTP error contracts, and retry rules.
> - Use `security-guide.md` for security logging and alerting minimums.
> - Use `permissions-model-guide.md` for permission-specific audit logging requirements.

---

## 1. Scope and goals

### 1.1 In scope

- Application logs for backend APIs, background jobs, message processors, and frontend clients
- Distributed tracing and correlation across services and downstream dependencies
- Azure Monitor / Application Insights telemetry configuration
- Log Analytics workspace usage
- Azure SQL Database audit and performance observability
- Per-application logging configuration and runbook documentation in `developer-docs/`

### 1.2 Out of scope

- Product analytics and BI event design beyond operational observability
- SIEM architecture and enterprise-wide SOC processes
- Deep retention/legal hold policy design owned by platform or compliance teams

### 1.3 Goals

- Make failures diagnosable without attaching a debugger
- Correlate app, platform, and database signals with a shared trace context
- Keep logs structured and searchable
- Control cost and noise through event selection, log levels, and sampling
- Separate standard guidance from app-specific operational settings

---

## 2. Azure-first logging architecture

### 2.1 Required platform model

Every production application SHOULD use this default shape unless the team documents an approved exception:

```text
Application / App Service
  -> Application Insights
  -> Log Analytics workspace
  -> Azure Monitor alerts / workbooks / KQL

Azure SQL Database
  -> Auditing to Log Analytics
  -> Query Store
  -> Azure Monitor metrics / alerts
  -> Optional Intelligent Insights
```

### 2.2 Standard resource choices

- Use a **workspace-based Application Insights resource** tied to a **Log Analytics workspace**
- Prefer the **Azure Monitor OpenTelemetry Distro** for supported application stacks
- Route Azure SQL audit events to **Log Analytics** for searchable central analysis
- Keep environment separation explicit: dev, test, staging, and prod MUST be distinguishable in telemetry

### 2.3 What belongs in `developer-docs/`

The style guide defines the standard. App-specific operational settings belong in each repo's `developer-docs/` directory. At minimum, each application repo should document:

- telemetry resource names and Azure subscription/resource group locations
- Application Insights connection and environment mapping
- sampling settings and any overrides
- alert rules and escalation expectations
- KQL queries/workbooks the team relies on
- Azure SQL auditing destination and retention choices
- dashboard links, runbooks, and known noisy log categories

Do not hardcode these app-specific settings into shared style guides.

---

## 3. Logging principles

1. **Structured first.** Logs MUST be machine-queryable. Do not rely on free-form text alone.
2. **Correlate everything.** Every log event should be traceable to a request, job, message, or user journey.
3. **Log for action.** If nobody would use the event to diagnose, alert, audit, or explain behavior, don't log it.
4. **Prefer one high-value event to ten vague ones.**
5. **Protect privacy.** Never log secrets, tokens, or unnecessary sensitive data.
6. **Control cost deliberately.** Telemetry volume is a real production concern, not an afterthought.

---

## 4. Required structured log schema

Every application log entry MUST use structured fields. The exact sink may vary, but these concepts must be preserved.

### 4.1 Core fields

| Field | Required | Purpose |
|---|---|---|
| `timestamp` | Yes | UTC event time |
| `level` | Yes | Trace, Debug, Information, Warning, Error, Critical |
| `message` | Yes | Human-readable summary |
| `serviceName` | Yes | Stable service/application identifier |
| `environment` | Yes | dev/test/staging/prod |
| `operation` | Yes | Logical action such as `POST /orders` or `invoice-import` |
| `traceId` | Yes | End-to-end correlation identifier |
| `spanId` | Conditional | Current span when tracing is enabled |
| `userId` | Conditional | Stable user identifier when available and safe |
| `tenantId` | Conditional | Tenant/customer boundary where relevant |
| `outcome` | Yes | Success / Failure / Retry / Denied / Timeout |
| `durationMs` | Conditional | Elapsed time for requests, dependency calls, and jobs |
| `errorCode` | Conditional | Machine-readable failure code |
| `dependencyName` | Conditional | External system, queue, or database dependency |
| `dbSystem` | Conditional | For database events, e.g. `AzureSql` |

### 4.2 Message template rules

- Use stable message templates with structured properties
- Do not encode business identifiers only inside the message text
- Prefer semantic names like `{OrderId}`, `{TenantId}`, `{DependencyName}`
- Keep messages short; put detail in structured fields

---

## 5. Log level rules

### 5.1 Allowed meanings

| Level | Use for |
|---|---|
| `Trace` | Rare, short-lived deep diagnostics only |
| `Debug` | Local troubleshooting and temporary lower-environment diagnostics |
| `Information` | Meaningful lifecycle or business-flow events |
| `Warning` | Unexpected but recoverable conditions, validation failures, denied actions |
| `Error` | Failed operations requiring attention or causing degraded behavior |
| `Critical` | Service-threatening failures, data corruption risk, or severe outages |

### 5.2 Rules

- Production defaults SHOULD bias toward `Information`, `Warning`, `Error`, and `Critical`
- `Debug` and `Trace` MUST NOT be left broadly enabled in production without time-boxed justification
- The same condition should not be logged at multiple layers unless each layer adds materially different context
- Do not catch, log, and rethrow at every layer; log where the event becomes actionable

---

## 6. Correlation and distributed tracing

### 6.1 Required behavior

- Use W3C trace context (`traceparent`) across inbound and outbound calls
- Propagate correlation through HTTP, queue, background job, and scheduled-task boundaries
- Include the current `traceId` in application logs and user-visible error references where appropriate

### 6.2 Common boundaries

- Browser to API
- API to downstream API
- API to Azure SQL
- API/job to queue consumer
- Scheduled job to its dependency calls

If a boundary cannot preserve correlation automatically, add explicit propagation code and document it in `developer-docs/`.

---

## 7. .NET / ASP.NET Core logging rules

### 7.1 Default stack

- Use `ILogger<T>` or equivalent framework abstractions
- Prefer structured message templates over string concatenation
- For hot paths or frequently emitted events, prefer high-performance logging patterns such as `LoggerMessage`

### 7.2 Where to log

Log at these points:

- request start/end when needed for observability
- important business operations
- dependency calls that fail, retry, or materially degrade latency
- auth/authz decisions that matter operationally
- background job start/end/failure
- circuit breaker open/close transitions

### 7.3 What not to do

- No blanket request/response body logging in production
- No duplicate logging of the same exception at multiple layers unless each layer adds distinct context
- No secrets in configuration or exception dumps

### 7.4 Backend event examples

- order placed
- payment authorization failed
- downstream timeout with retry
- cache fallback activated
- import batch completed with partial failures

---

## 8. Angular and browser logging rules

### 8.1 What to capture

- unhandled client exceptions
- failed API calls when the frontend is the best diagnostic source
- route/navigation failures
- major UX degradations that impact user task completion

### 8.2 What to avoid

- console spam mirrored into production telemetry
- high-volume clickstream logging unless explicitly designed as product analytics
- PII, tokens, auth headers, or sensitive payloads

### 8.3 Correlation

- Preserve correlation IDs from API responses where needed for support workflows
- Ensure browser telemetry can be tied back to backend traces for the same user action

---

## 9. Application Insights and Azure Monitor standards

### 9.1 Instrumentation standard

- For supported runtimes, prefer the Azure Monitor OpenTelemetry Distro
- Use Application Insights as the application-facing telemetry experience within Azure Monitor
- Standardize service identity, environment, and cloud metadata across services

### 9.2 Sampling and cost control

- Sampling MUST be an explicit design decision, not an accident
- Document production sampling settings in `developer-docs/`
- Never sample away critical security, audit, or severe failure signals without a documented exception

### 9.3 Telemetry enrichment

Enrich telemetry with:

- service name
- deployment environment
- version/build identifier
- region or hosting stamp when relevant
- tenant or business partition where safe

### 9.4 Dashboards and queries

Each application team SHOULD maintain:

- saved KQL queries for common incidents
- at least one operational workbook or dashboard
- alert definitions that map to on-call expectations

These app-specific assets belong in `developer-docs/`, not in shared standards.

---

## 10. Azure SQL Database logging and observability

### 10.1 Required Azure SQL signals

Every production Azure SQL-backed application SHOULD have:

- Azure SQL auditing enabled
- audit events routed to Log Analytics where feasible
- Query Store enabled
- Azure Monitor metrics and alerts configured

### 10.2 Auditing rules

- Use server-level auditing by default unless a database-level override is specifically needed
- Do not enable overlapping audit configurations without a clear reason
- Treat SQL auditing as an important signal, but not the only forensic source

### 10.3 What to monitor for SQL

- failed logins and permission denials
- schema changes
- suspicious or high-risk access patterns
- CPU, storage, and connection pressure
- long-running or regressed queries
- retry spikes and timeout patterns from the application layer

### 10.4 Query performance observability

- Use Query Store as the default source for query history and regressions
- Use Query Performance Insight and Intelligent Insights where they improve triage speed
- Keep query tuning notes and known regressions in `developer-docs/` when they are app-specific

---

## 11. Alerts and operational signals

At minimum, teams should define alerts for:

- sustained 5xx spikes
- elevated dependency failure rates
- repeated auth failures or access denials
- background job failure streaks
- SQL connectivity failures or timeout spikes
- severe telemetry ingestion anomalies or missing-heartbeat situations

Alert thresholds are app-specific and should be documented in `developer-docs/`.

---

## 12. Privacy, retention, and data hygiene

- Never log secrets, access tokens, raw credentials, or connection strings
- Minimize personal data; if user identifiers are needed, prefer stable non-sensitive identifiers
- Redact or hash sensitive fields before logs leave the process
- Define retention and cost expectations per environment in `developer-docs/`

---

## 13. Implementation checklist

- [ ] Workspace-based Application Insights resource configured
- [ ] Log Analytics workspace identified and documented
- [ ] Correlation and trace propagation implemented end to end
- [ ] Structured logging schema adopted by backend services
- [ ] Frontend telemetry scoped to actionable operational events
- [ ] Sampling settings documented and justified
- [ ] Azure SQL auditing enabled and destination documented
- [ ] Query Store enabled
- [ ] Core KQL queries and dashboards documented in `developer-docs/`
- [ ] Critical alerts mapped to operational ownership
- [ ] Sensitive data redaction verified

---

## 14. References

- [Enable OpenTelemetry in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable)
- [Application Insights observability overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
- [Configuring OpenTelemetry in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-configuration)
- [Sampling in Azure Monitor Application Insights with OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-sampling)
- [Create and configure Application Insights resources](https://learn.microsoft.com/en-us/azure/azure-monitor/app/create-workspace-resource)
- [Azure Well-Architected guidance for Application Insights](https://learn.microsoft.com/en-us/azure/well-architected/service-guides/application-insights)
- [Auditing overview for Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/auditing-overview?view=azuresql)
- [Set up Auditing for Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/auditing-setup?view=azuresql)
- [Azure SQL audit log format](https://learn.microsoft.com/en-us/azure/azure-sql/database/audit-log-format?view=azuresql)
- [Monitor Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/monitoring-sql-database-azure-monitor?view=azuresql)
- [Query Performance Insight](https://learn.microsoft.com/en-us/azure/azure-sql/database/query-performance-insight-use?view=azuresql)
- [Intelligent Insights overview](https://learn.microsoft.com/en-us/azure/azure-sql/database/intelligent-insights-overview?view=azuresql)
