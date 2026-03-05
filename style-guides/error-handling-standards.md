# Error Handling & Exception Management Standards

> **Purpose:** This document defines the error handling and exception management standards for all development work. Follow these patterns consistently across all backend services, frontend applications, APIs, and background jobs.

---

## 1. Error Classification

Every error MUST be classified into one of these categories. Classification determines logging level, HTTP status, user messaging, retry behavior, and alerting.

| Category | Description | HTTP Status | Log Level | Retry |
|---|---|---|---|---|
| **Validation** | Input fails schema or business rule checks | 400 | Warning | No |
| **Business Logic** | Valid input violates a domain rule | 409 / 422 | Warning | No |
| **Authentication** | Identity cannot be established or session expired | 401 | Warning | No (re-auth) |
| **Authorization** | Identity established but lacks permissions | 403 | Warning | No |
| **Not Found** | Requested resource does not exist | 404 | Information | No |
| **Infrastructure** | External dependency or system component failure | 502 / 503 / 504 | Error | Yes |
| **Unexpected** | Unhandled or unanticipated condition | 500 | Critical | Conditional |

---

## 2. Standard Error Response Format

All API error responses MUST use this JSON structure. No exceptions.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields failed validation.",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address.",
        "code": "INVALID_FORMAT"
      }
    ],
    "traceId": "abc-123-def-456",
    "timestamp": "2025-02-10T14:30:00Z",
    "instance": "/api/v1/users"
  }
}
```

### Field Requirements

| Field | Required | Description |
|---|---|---|
| `error.code` | Yes | Machine-readable UPPER_SNAKE_CASE code mapped to the error classification |
| `error.message` | Yes | Human-readable summary for developers. Never expose directly in production UI |
| `error.details` | Conditional | Array of field-level sub-errors. Required for validation errors |
| `error.traceId` | Yes | Correlation ID that flows through all services for this request |
| `error.timestamp` | Yes | ISO 8601 UTC timestamp |
| `error.instance` | No | The API path that generated the error |

### Error Code Convention

Use UPPER_SNAKE_CASE codes that combine category and specificity:

```
VALIDATION_ERROR
VALIDATION_REQUIRED_FIELD
VALIDATION_INVALID_FORMAT
BUSINESS_DUPLICATE_ENTRY
BUSINESS_INSUFFICIENT_FUNDS
AUTH_TOKEN_EXPIRED
AUTH_INVALID_CREDENTIALS
AUTHZ_PERMISSION_DENIED
RESOURCE_NOT_FOUND
INFRASTRUCTURE_DATABASE_UNAVAILABLE
INFRASTRUCTURE_TIMEOUT
INTERNAL_ERROR
```

All error codes MUST be registered in the team's error codes registry before use.

---

## 3. Exception Handling Rules

### 3.1 Catch at the Right Level

```
┌─────────────────────────────────────────────────────────┐
│ Global Exception Handler (safety net)                   │
│   → Catches everything unhandled                        │
│   → Logs full context, returns generic 500              │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Controller / Handler Layer                        │  │
│  │   → Catches known exceptions                      │  │
│  │   → Maps to HTTP status + standard error format   │  │
│  │                                                   │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │ Service Layer                               │  │  │
│  │  │   → Catches to add business context         │  │  │
│  │  │   → Wraps and rethrows if not resolvable    │  │  │
│  │  │                                             │  │  │
│  │  │  ┌───────────────────────────────────────┐  │  │  │
│  │  │  │ Infrastructure / Data Layer           │  │  │  │
│  │  │  │   → Catches transient faults → retry  │  │  │  │
│  │  │  │   → Lets persistent failures bubble   │  │  │  │
│  │  │  └───────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Core Rules

**NEVER swallow exceptions:**
```
❌ BAD:
catch (Exception ex) { }

❌ BAD:
catch (Exception ex) { return null; }

✅ GOOD:
catch (SpecificException ex)
{
    logger.LogWarning(ex, "Expected condition: {Reason}", context);
    return Result.Failure(errorCode);
}
```

**ALWAYS preserve stack traces:**
```
❌ BAD:  throw ex;           // Resets the stack trace
✅ GOOD: throw;              // Preserves original stack trace
✅ GOOD: throw new ServiceException("Context", ex);  // Wraps with inner exception
```

**ALWAYS use specific exception types:**
```
❌ BAD:  catch (Exception ex) { ... }         // Too broad
✅ GOOD: catch (SqlTimeoutException ex) { ... } // Specific and intentional
```

**ALWAYS clean up resources:**
```
✅ Use using/try-with-resources/defer for:
   - Database connections
   - File handles
   - HTTP clients
   - Transactions
   - Locks
```

### 3.3 Fail Fast at Boundaries

Validate ALL inputs at system boundaries before processing begins:
- API controller entry points
- Message/event consumers
- File import processors
- Scheduled job inputs

Return specific validation errors immediately. Do not let invalid data propagate deeper into the system.

### 3.4 Exceptions vs. Return Types

| Scenario | Approach |
|---|---|
| Truly unexpected failure (null ref, config error) | Throw exception |
| Expected "not found" during a lookup | Return `null`, `Option<T>`, or `Result<T>` |
| Business rule violation (expected outcome) | Return `Result<T>` with error info |
| Transient infrastructure failure (retryable) | Throw exception (let retry policy handle) |
| Input validation failure | Return validation result object |

Do NOT use exceptions for normal control flow.

---

## 4. Logging Standards

### 4.1 Required Structured Fields

Every error log entry MUST include:

```json
{
  "timestamp": "2025-02-10T14:30:00.123Z",
  "traceId": "abc-123-def-456",
  "errorCode": "INFRASTRUCTURE_TIMEOUT",
  "errorCategory": "Infrastructure",
  "serviceName": "order-service",
  "operation": "POST /api/v1/orders",
  "userId": "user-789",
  "duration": 30042,
  "message": "Database connection timed out after 30s",
  "stackTrace": "..."
}
```

### 4.2 Log Level by Category

| Category | Level | Include Stack Trace | Alert |
|---|---|---|---|
| Validation | Warning | No | Only on volume spike |
| Business Logic | Warning | No | Only on volume spike |
| Authentication | Warning | No | On repeated failures from same source |
| Authorization | Warning | No | On pattern detection |
| Not Found | Information | No | No |
| Infrastructure | Error | Yes | Immediate |
| Unexpected | Critical | Yes (full) | Immediate |

### 4.3 NEVER Log These

- Passwords, tokens, API keys, or credentials
- Full credit card numbers, SSNs, or unnecessary PII
- Request/response bodies containing sensitive customer data
- Connection strings with embedded credentials
- Session tokens or auth headers

Use redaction utilities to scrub sensitive fields before logging.

---

## 5. HTTP Status Code Usage

### Rules

- **NEVER return 200 with an error payload.** If the operation failed, the status code MUST reflect it.
- **NEVER return 500 for known/expected error conditions.** Use the appropriate 4xx code.
- **ALWAYS include `Retry-After` header** with 429 and 503 responses.
- **ALWAYS use 404 consistently.** Do not return 200 with empty body for missing resources.

### Quick Reference

| Code | Use For | Key Rule |
|---|---|---|
| 400 | Input validation failures | Include field-level `details` array |
| 401 | Missing/invalid/expired authentication | Never reveal if user exists |
| 403 | Insufficient permissions | Don't reveal what permission is needed |
| 404 | Resource does not exist | Use consistently, never 200 + empty body |
| 409 | State conflict (duplicates, concurrency) | Include context for client resolution |
| 422 | Business rule violations | Prefer over 400 for domain-level validation |
| 429 | Rate limit exceeded | MUST include `Retry-After` header |
| 500 | Unexpected errors only | Never expose internal details |
| 503 | Temporary outage | Include `Retry-After` when possible |

---

## 6. Retry & Resilience

### 6.1 Retry Decision

| Error | Retry? | Strategy |
|---|---|---|
| 400, 401, 403, 404 | **No** | Fix the root cause |
| 409 Conflict | **Conditional** | Re-fetch state, then retry (2–3 attempts) |
| 429 Rate Limited | **Yes** | Respect `Retry-After` header (3–5 attempts) |
| 500 Server Error | **Conditional** | Only if operation is idempotent (2–3 attempts) |
| 503, 504 | **Yes** | Exponential backoff with jitter (3–5 attempts) |

### 6.2 Exponential Backoff with Jitter

```
delay = min(baseDelay × 2^attempt + random(0, jitterMax), maxDelay)

Defaults:
  baseDelay  = 500ms
  jitterMax  = 200ms
  maxDelay   = 30s
  maxRetries = 3
```

### 6.3 Circuit Breaker

Implement for ALL external dependencies:

```
CLOSED (normal) ──[failure threshold exceeded]──► OPEN (fail fast)
                                                    │
                                              [cooldown elapsed]
                                                    │
                                                    ▼
                                              HALF-OPEN (probe)
                                               ┌────┴────┐
                                          [success]   [failure]
                                               │         │
                                               ▼         ▼
                                            CLOSED     OPEN
```

- **Closed:** Normal operation. Track failure rate.
- **Open:** Fail immediately. Return cached/degraded response.
- **Half-Open:** Allow one probe request after cooldown.

### 6.4 Idempotency

- Only retry operations that are **idempotent** (safe to execute multiple times).
- For non-idempotent operations (payments, emails), require an **idempotency key** from the client.
- Server deduplicates based on the key.

---

## 7. User-Facing Error Messages

### Rules

1. **Be specific** about what went wrong without revealing technical details
2. **Provide a next step** (retry, correct input, contact support)
3. **Use plain language** — no jargon, no error codes, no exception types
4. **Don't blame the user** for system errors
5. **Include a reference ID** (traceId) for Unexpected/Infrastructure errors so users can share it with support

### Templates

| Category | Message Pattern |
|---|---|
| Validation | "Please enter a valid email address." (inline, field-specific) |
| Business Logic | "This coupon has already been used." (explain the reason) |
| Authentication | "Your session has expired. Please sign in again." |
| Authorization | "You don't have permission to perform this action." |
| Not Found | "We couldn't find what you're looking for." |
| Infrastructure | "We're experiencing technical difficulties. Please try again shortly." |
| Unexpected | "Something went wrong on our end. If this persists, contact support. (Ref: {traceId})" |

### NEVER Show to Users

- Stack traces
- Exception type names
- Database error messages
- Internal file paths or server names
- SQL queries
- Framework version information

---

## 8. Correlation & Observability

### Trace ID Requirements

- Generate a unique `traceId` at the system entry point (API gateway or first service)
- Propagate via headers (`X-Correlation-Id` or `traceparent`) through ALL downstream calls, queues, and jobs
- Include in every log entry, every error response, every monitoring event
- If a `traceId` is received from upstream, use it — don't generate a new one

### Health Check Endpoints

Every service MUST expose:

| Endpoint | Purpose | Returns |
|---|---|---|
| `/health/live` | Process is running (liveness probe) | 200 if alive |
| `/health/ready` | Service + dependencies ready (readiness probe) | 200 if ready |

### Alerting Thresholds

| Condition | Alert |
|---|---|
| 500 errors > 1% of requests in 5 min | Immediate |
| Circuit breaker opens | Immediate |
| Auth failures > 10 from single IP in 1 min | Immediate |
| Validation error rate > 3× 24hr rolling average | Warning |

---

## 9. Security

- **Never expose** stack traces, internal paths, server names, or framework versions in production responses
- **Authentication errors** must not reveal whether a username/email exists. Use consistent messages ("Invalid credentials") for all failure modes
- **Return identical response times** for valid and invalid usernames to prevent timing-based enumeration
- **Disable verbose error pages** (Developer Exception Page, etc.) in all non-development environments
- **Custom error pages** must not include debugging tools or version information
- **Rate limit** all endpoints, especially authentication

---

## 10. Testing Requirements

### Mandatory Coverage

- **Unit tests:** Every error classification returns correct code, status, and message structure
- **Integration tests:** Simulate dependency failures and verify graceful degradation
- **Contract tests:** Error response schemas match the standard format (Section 2)
- **Security tests:** No sensitive information leaks in any error path
- **Load tests:** Error handling performs correctly under high concurrency

### Chaos Engineering

Periodically inject failures in staging/production to validate retry logic, circuit breakers, and alerting. Document scenarios and outcomes.

---

## 11. Implementation Checklist

- [ ] Global exception handler configured, returns standard error format
- [ ] All error responses conform to the JSON schema (Section 2)
- [ ] HTTP status codes used correctly (Section 5)
- [ ] Correlation ID generated, propagated, included in all logs and responses
- [ ] Structured logging with all required fields (Section 4.1)
- [ ] Sensitive data never logged or exposed in responses
- [ ] Retry policies use exponential backoff with jitter
- [ ] Circuit breakers configured for all external dependencies
- [ ] Health check endpoints implemented (`/health/live`, `/health/ready`)
- [ ] Alerting thresholds configured (Section 8)
- [ ] User-facing messages are non-technical and actionable
- [ ] Error paths have unit, integration, and contract test coverage
- [ ] Auth errors don't reveal account existence
- [ ] Validation errors include field-level detail
- [ ] No empty catch blocks in codebase
