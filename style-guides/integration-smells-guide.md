# External Integration Smell Detection Guide

## Service Inventory

Read `.claude/rules/project-config.md` "External Integrations" for this project's service inventory and reference implementation.

## Integration Smell Checklist (I1-I7)

| ID | Smell | What to look for | Severity |
|----|-------|-----------------|----------|
| I1 | Inconsistent error shape | Service returns `bool` or empty list while others return typed response objects with `Success`/`ErrorMessage` | Medium |
| I2 | Missing retry | External HTTP call with no retry for transient failures. Acceptable for idempotent reads; not for writes to external systems. | Medium |
| I3 | Sync-over-async | `.Wait()`, `.Result`, `.GetAwaiter().GetResult()` on HTTP calls — thread pool starvation risk | High |
| I4 | Missing timeout | External HTTP call with no explicit timeout — can block thread indefinitely if remote service hangs | Medium |
| I5 | Hardcoded config | Base URLs, API keys, subscription keys as string literals instead of `IOptions<T>` or `IConfiguration` | Medium |
| I6 | Missing logging | External call with no request/response logging — impossible to debug failures in production | Medium |
| I7 | Token per service | Each service manages its own OAuth token acquisition instead of sharing a token service. Leads to duplicated auth code. | Low |

## Accepted Conventions (do NOT flag)

- Repository calling service classes for external APIs — established pattern if documented in `.claude/rules/project-config.md`
- `new RestClient()` per request — RestSharp manages its own handler pool
- Services returning different response types is acceptable IF they all follow the typed response object pattern
- `IHttpClientFactory.CreateClient()` for HttpClient-based services — correct pattern
- Different SDK patterns (Graph SDK, ACS SDK) — each SDK has its own conventions
- Services without retry for read-only/idempotent operations
- See `.claude/rules/project-config.md` "Accepted Conventions" for project-specific patterns

## Service Pattern Matrix Template

When auditing integrations, build this matrix:

| Aspect | Expected | What to Check |
|--------|----------|---------------|
| **Auth** | OAuth token or SDK | How is auth acquired? Retry on 401? |
| **Retry** | 1-3 retries for transient failures | Is there retry logic? What triggers it? |
| **Timeout** | Explicit timeout configured | Is there a timeout? What happens on timeout? |
| **Error shape** | Typed response object | Does the service return `Success`/`ErrorMessage`? |
| **Logging** | ILogger with context | Are requests, responses, and exceptions logged? |
| **Async** | `async`/`await` throughout | Any `.Wait()`, `.Result`, sync-over-async? |
| **Config** | `IOptions<T>` | Are URLs/keys from configuration or hardcoded? |
