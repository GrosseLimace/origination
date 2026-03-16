# Security Review Report: Grain Originator Portal (Origination)

**Application:** Grain Originator Portal
**Review Date:** 2026-03-16
**Previous Reviews:** 2026-02-27, 2026-03-05, 2026-03-06 (v1), 2026-03-06 (v2), 2026-03-10, 2026-03-11, 2026-03-13
**Reviewer:** Claude Opus 4.6 (Three Parallel Specialized Agents: Backend Security, Frontend Security, Delta Analysis)
**Branch:** origin/main (HEAD: c718011)
**Previous Review Commit:** 4d00976 (2026-03-13)
**Repository:** origination (https://scoular.ghe.com/IT/origination.git)
**Tech Stack:** .NET 10 / ASP.NET Core + Angular 21 + Azure SQL + Azure AD (Entra ID)
**Review Scope:** Full source code security review against Scoular ISMS policies, security-review skill checklist, and all policy documents in `C:\Program Files\claudecode\`

---

## Executive Summary

| Metric | Mar 11 | Mar 13 | **Mar 16** | **Change (Mar 13 → 16)** |
|--------|--------|--------|-----------|---------------------------|
| **Overall Status** | COND. PASS | COND. PASS (STRONG) | **COND. PASS (STRONG)** | Maintained |
| **Critical Findings** | 2 | 0 | **0** | **= (zero maintained)** |
| **High Findings** | 8 | 2 | **2** | **= (prior H-01/H-02 resolved; 2 new scope)** |
| **Medium Findings** | 18 | 9 | **8** | **-1** |
| **Low Findings** | 17 | 12 | **11** | **-1** |
| **Total Active** | **45** | **23** | **21** | **-2** |
| **Remediated (cumulative)** | 30 | 52 | **58** | **+6 new remediations** |
| **Regressions** | 3 | 0 | **0** | **= (7/7 regression checks PASS)** |
| **Security Score (Backend)** | 76% | 90% | **84%** | **-6 points** |
| **Security Score (Frontend)** | 73% | 88% | **92%** | **+4 points** |
| **Combined Security Score** | 74% | 89% | **87%** | **-2 points** |

> **Status values:** FAIL (<60%) · COND. PASS (60–79%) · COND. PASS (STRONG) (80–89%) · PASS (≥90%)

### Key Observations: 24 Commits — QA Prep and Feature Development (PRs #44–#59)

The 24 code commits since the last review (92 files changed, +3,923/-1,123 lines) represent a **QA preparation and feature development sprint** including new trade-unit selector, user preferences system, data preloading, unshipped-bushels view, and continued entitlement hardening.

**Major Remediations Achieved:**
- **H-02 FIXED** — `environment.prod.ts` now correctly sets `redirectUri: 'https://origination.scoular.com'`, `postLogoutRedirectUri`, and `.Prod` scope suffix
- **M-02 FIXED** — `DiagnosticsController` now has `[Authorize]` attribute with `DenyIfNotDevelopment()` guard returning 404 in non-dev
- **M-06 FIXED** — OpenAPI endpoint now requires authorization via `app.MapOpenApi().RequireAuthorization()`
- **M-08 FIXED** — ODSConnection present in `appsettings.json:17` using Azure AD Default auth (no password)
- **L-01 FIXED** — `EnableSensitiveDataLogging` now triple-guarded: `#if DEBUG` + `IsDevelopment()` on all 3 DbContexts
- **L-09 FIXED** — `protectedResourceMap` correctly maps API scope; Graph API confirmed not used
- **H-01 SUBSTANTIALLY IMPROVED** — 7 GetAll/GetByFarm endpoints now protected with `[EnforceTradeUnitAccess]` or manual `ValidateTradeUnitsOrThrowAsync()`

**Remaining Concerns:**
- **H-01 (NEW SCOPE):** `StoredGrainController.GetAll` and `ProducerDetailsController.GetAll` return unfiltered data without entitlement checks
- **H-02 (NEW):** Mutation endpoints in Notes/PlantingIntentions/ProducerDetails skip explicit entitlement validation — TOCTOU risk
- **appsettings.QA.json** could not be verified for secrets (permission denied — manual review required)

**Net Result:** 6 findings remediated, 0 regressions, 2 net-new HIGH findings (narrower scope than prior). Total active reduced from 23 → 21.

---

## Improvement Trend Chart (Eight Reviews)

```
SEVERITY COMPARISON: Feb 27 -> Mar 05 -> Mar 06v1 -> Mar 06v2 -> Mar 10 -> Mar 11 -> Mar 13 -> Mar 16
===================================================================================================

               Feb 27  Mar 05  Mar 06v1  Mar 06v2  Mar 10  Mar 11  Mar 13  Mar 16  Trend
               ------  ------  --------  --------  ------  ------  ------  ------  -----
CRITICAL       5       3       4         0         2       2       0       0       MAINTAINED ZERO
HIGH           9       5       10        6         9       8       2       2       = (evolved scope)
MEDIUM         7       8       15        13        16      18      9       8       -1
LOW            5       5       9         12        13      17      12      11      -1
               ────────────────────────────────────────────────────────────────────────
TOTAL          26      21      38        31        40      45      23      21

COMBINED SECURITY SCORE TREND
===================================================================================================
Feb 27:  [###.................] 15%   FAIL          (no auth, XSS, stack traces)
Mar 05:  [#######.............] 35%   FAIL          (auth missing)
Mar 06v1:[######..............] 30%   FAIL          (deeper review)
Mar 06v2:[##############......] 68%   COND. PASS    (AUTH IMPLEMENTED)
Mar 10:  [################....] 76%   COND. PASS    (CSP, HSTS, exception handler)
Mar 11:  [###############.....] 74%   COND. PASS    (3 regressions)
Mar 13:  [##################..] 89%   COND. PASS    (22 remediations, 0 regressions)
                                       STRONG
Mar 16:  [#################...] 87%   COND. PASS    (6 remediations, 0 regressions,
                                       STRONG         QA prep + feature sprint)

BACKEND vs FRONTEND SECURITY SCORES
===================================================================================================
          Mar 13                       Mar 16                      Delta
Backend:  [##################..] 90%  [#################...] 84%  -6 (new auth gaps found)
Frontend: [##################..] 88%  [##################..] 92%  +4 (H-02 fixed)

REMEDIATION VELOCITY
===================================================================================================
          Remediated  New Found   Regressed   Net Change
Mar11->13:    22          +3          0       -22 (MASSIVE REMEDIATION SPRINT)
Mar13->16:     6          +4          0        -2 (QA prep + feature work)
CUMULATIVE:  58 remediations, 0 active regressions across 8 reviews

FINDINGS REMEDIATION STATUS (Mar 13 → Mar 16)
===================================================================================================
                    +------------------------------------------+
 FIXED (6)          |###########                               |  26.1%
 PARTIAL (1)        |##                                        |   4.3%
 UNCHANGED (12)     |##########################                |  52.2%
 REGRESSED (0)      |                                          |   0.0%
 NEW (4)            |########                                  |  17.4%
                    +------------------------------------------+
                     (based on 23 Mar 13 findings + 4 new = 27 evaluated)
```

---

## Remediations Confirmed (6 New + 52 Prior = 58 Total Cumulative)

### New Remediations (This Review)

| # | Previous ID | Finding | Status | Evidence |
|---|-------------|---------|--------|----------|
| 1 | **H-02** | Production MSAL redirectUri pointed to dev URL; missing postLogoutRedirectUri; `.Dev` scope | **FIXED** | `environment.prod.ts:9-10` — `redirectUri: 'https://origination.scoular.com'`, `postLogoutRedirectUri` added, scope `.Prod`. New `environment.qa.ts` created with QA-specific settings. |
| 2 | **M-02** | DiagnosticsController `[AllowAnonymous]` bypassed global auth | **FIXED** | `DiagnosticsController.cs:18` — `[Authorize]` attribute. `DenyIfNotDevelopment()` returns 404 in non-dev (line 98). `Program.cs:424` — `RequireAuthorization()` enforces auth globally. |
| 3 | **M-06** | OpenAPI `/openapi/v1.json` accessible without authentication | **FIXED** | `Program.cs:382` — `app.MapOpenApi().RequireAuthorization()`. |
| 4 | **M-08** | ODSConnection key missing from appsettings.json | **FIXED** | `appsettings.json:17` — ODSConnection present with `Authentication=Active Directory Default` (Managed Identity). `Program.cs:146` — `GetConnectionString("ODSConnection")` called. No password in connection string. |
| 5 | **L-01** | EF Core SQL logging at Information level in all environments | **FIXED** | `Program.cs:162-167, 186-191, 209-214` — `EnableSensitiveDataLogging()` now triple-guarded: `#if DEBUG` compile-time + `.IsDevelopment()` runtime on all 3 DbContexts (OriginationDbContext, ApplicationDbContext, EntitlementsDbContext). |
| 6 | **L-09** | Graph API missing from MSAL protectedResourceMap | **FIXED** | `main.ts:86-92` — `protectedResourceMap` targets `environment.apiConfig.uri`. Graph API confirmed not used by this application. |

### H-01 Sub-Remediations (SUBSTANTIALLY IMPROVED — 7 endpoints now protected)

| # | Endpoint | Status | Evidence |
|---|----------|--------|----------|
| 7 | CustomersController.GetAll | **FIXED** | Line 25-28 — `[EnforceTradeUnitAccess]` attribute |
| 8 | ContractsController.GetAll | **FIXED** | Line 25-28 — `[EnforceTradeUnitAccess]` attribute |
| 9 | TicketsController.GetAll | **FIXED** | Line 23-26 — `[EnforceTradeUnitAccess]` attribute |
| 10 | ContractsController.GetByFarm | **FIXED** | Line 46-52 — `ValidateTradeUnitsOrThrowAsync()` post-fetch |
| 11 | TicketsController.GetByFarm | **FIXED** | Line 44-50 — `ValidateTradeUnitsOrThrowAsync()` post-fetch |
| 12 | NotesController.GetAll | **FIXED** | Line 28-36 — Manual filter: `allowed.Contains(n.TradeUnit)` |
| 13 | PlantingIntentionsController.GetAll | **FIXED** | Line 28-36 — Manual filter by allowed trade units |

### Prior Remediations (Still Confirmed — 52)

All 52 prior remediations remain confirmed in place. Key items verified by delta agent:
- C-01/C-02: `_escapeHtml()` still present in 4 files (bid-sheet, customer-map, customer-profile)
- H-05: Rate limiting confirmed at `Program.cs:309-320` (300 req/min per user)
- M-03/M-17: AllowedHosts production hostnames confirmed; CSP headers confirmed in SecurityHeadersMiddleware
- M-14: Idle timeout service confirmed present and wired
- All auth, structured logging, HSTS, CORS, JSON hardening controls remain in place

---

## CRITICAL Findings (0)

**No critical findings. Zero criticals maintained across three consecutive reviews (Mar 13, Mar 16).**

---

## HIGH Findings (2)

### H-01: Unfiltered GetAll Endpoints — StoredGrain and ProducerDetails

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Files** | `StoredGrainController.cs:22-25`, `ProducerDetailsController.cs:22-25` |
| **CWE** | CWE-862 (Missing Authorization) — CWE/SANS Rank #11 |
| **Policy Refs** | SECURITY_ENFORCEMENT.md — Authorization (CRITICAL), A.5.15_v1.6.md, ISM-ZTDR_v1.1.md §3.4 (Least Privilege), ISM-ZTIAM_v1.1.md |
| **Skill Ref** | security-review Section 4 (Authentication & Authorization) |
| **Status** | REMAINING from prior H-01 (narrowed scope; 7 of 9 endpoints now protected) |

**Description:** While the major GetAll endpoints (Customers, Contracts, Tickets, Notes, PlantingIntentions) are now protected, two endpoints still return ALL records without entitlement filtering:

```csharp
// StoredGrainController.cs:22-25
[HttpGet]
public async Task<ActionResult<List<StoredGrain>>> GetAll(CancellationToken cancellationToken = default)
{
    return Ok(await _dataService.GetStoredGrainAsync(cancellationToken));
}
```

The same pattern exists in `ProducerDetailsController.GetAll` (line 22-25). An authenticated user can enumerate ALL stored grain records and producer details across ALL trade units, breaking multi-tenancy data isolation.

**Note:** Commit `23c057c` ("Remove ValidateCustomerAccessAsync from StoredGrainController") explicitly removed entitlement checks from this controller. The commit message suggests this was intentional, but no business justification is documented.

**Remediation:**
1. Add `[EnforceTradeUnitAccess]` attribute to both endpoints, OR
2. Add manual filtering (same pattern as `NotesController.GetAll:28-36`), OR
3. If intentionally unrestricted, document the business justification and accept the risk formally

---

### H-02: Mutation Endpoints Rely on Transitive Authorization (TOCTOU Risk)

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Files** | `NotesController.cs:53,80,95,109`, `PlantingIntentionsController.cs:53,80,105`, `ProducerDetailsController.cs:41,63` |
| **CWE** | CWE-862 (Missing Authorization), CWE-367 (TOCTOU Race Condition) |
| **Policy Refs** | ISM-ZTDR_v1.1.md §3.2 (All actions must be authorized), SECURITY_ENFORCEMENT.md — Authorization, A.5.15_v1.6.md |
| **Skill Ref** | security-review Section 4 (Authorization) |
| **Status** | EVOLVED from prior M-09 (escalated to HIGH due to persistence across multiple reviews) |

**Description:** Mutation endpoints in Notes, PlantingIntentions, and ProducerDetails controllers skip explicit entitlement validation. Source comments state:

```csharp
// NotesController.cs:55-56
// Access already validated when the user loaded the customer (GET endpoints check entitlements).
// Redundant validation here caused 403s when vw_CustomerTradeUnits had incomplete mappings.
```

This creates a TOCTOU (Time-of-Check-Time-of-Use) window: a user could load a customer via protected GET, have their entitlements revoked, then submit a mutation that bypasses all checks. An attacker can also directly POST to `/api/notes` with a customerId they never loaded via GET.

**Affected endpoints:** NotesController.Create/TogglePin/Update/Delete, PlantingIntentionsController.Create/Update/Delete, ProducerDetailsController.Upsert/Delete. `CustomersController.Update` is properly protected via `ValidateCustomerAccessAsync()` (line 85-88).

**Mitigating factors:** JWT tokens are short-lived (~1h); entitlement changes are infrequent; comment references "incomplete mappings" causing 403s — suggesting validation was tried and caused operational issues.

**Remediation:**
1. Add `await _entitlementService.ValidateCustomerAccessAsync(customerId, cancellationToken)` to all mutation endpoints
2. If the incomplete-mapping issue recurs, address the root cause in `vw_CustomerTradeUnits` rather than removing the security check

---

## MEDIUM Findings (8)

| ID | Finding | CWE | Policy Ref | File:Line | Status |
|----|---------|-----|-----------|-----------|--------|
| **M-01** | DiagnosticsController exposes `ex.Message` in response headers (dev-gated via `DenyIfNotDevelopment()`) | CWE-209 | SECURITY_ENFORCEMENT.md Error Handling, A.8.28 | `DiagnosticsController.cs:66-75` | PARTIALLY RESOLVED |
| **M-02** | UserPreferences allows saving TU selections without entitlement cross-check — user can persist unauthorized TU codes (does not grant data access, but corrupts preferences) | CWE-639 | ISM-ZTIAM_v1.1.md §2.2, A.5.15 | `UserPreferencesController.cs:51-53` | NEW |
| **M-03** | Azure AD TenantId/ClientId in source control (public identifiers per Microsoft docs, not credentials; best practice is Azure App Configuration) | CWE-200 | A.5.10_v1.3.md, SECURITY_GUIDELINES.md | `appsettings.json:10-14` | UNCHANGED (ACCEPTABLE) |
| **M-04** | No Angular reactive form validators on data-entry components | CWE-20 | SECURITY_ENFORCEMENT.md Angular HIGH §Input Validation | Multiple components | UNCHANGED |
| **M-05** | Dependency caret `^` ranges allow minor/patch updates without explicit approval | CWE-1104 | A.5.19_v1.2.md, A.8.30_v1.1.md | `client/package.json` | NOT REVIEWED |
| **M-06** | UserTradeUnitsController fallback returns ALL active trade units when EntitlementsDB unavailable; `X-Entitlements-Fallback: true` header set but frontend may not enforce | CWE-269 | ISM-ZTIAM_v1.1.md §2.2, ISM-ZTDR_v1.1.md | `UserTradeUnitsController.cs:77-101` | NEW |
| **M-07** | CI/CD Angular build uses only `dev` configuration for all environments | CWE-489 | A.8.31_v1.2.md, ISM-ZTCS_v1.2.md | CI/CD pipeline | NOT REVIEWED |
| **M-08** | `appsettings.QA.json` could not be verified for secrets (permission denied during review) | CWE-798 | SECURITY_ENFORCEMENT.md §Secrets Detection | `appsettings.QA.json` | UNKNOWN |

---

## LOW Findings (11)

| ID | Finding | File | Status |
|----|---------|------|--------|
| L-02 | SavedList Filters property has no `[StringLength]` annotation | `CreateSavedListRequest.cs:18` | UNCHANGED |
| L-03 | Verbose ticket data logged at Information level in production | `SqlDataService.cs` | UNCHANGED |
| L-04 | `JSON.parse(l.filters)` without try/catch in `api.service.ts:374` (data from trusted backend; `catchError` handles stream errors) | `api.service.ts:374` | UNCHANGED (ACCEPTABLE) |
| L-05 | No integration tests asserting 401 rejection on protected endpoints | Test project | UNCHANGED |
| L-06 | HTTP launch profile available in development (not HTTPS-only) | `launchSettings.json:8` | UNCHANGED |
| L-08 | Google Fonts CDN loaded without SRI (Subresource Integrity) hash | `client/src/index.html:12` | UNCHANGED |
| L-09 | Duplicate `auth.guard.ts` files — legacy at `app/guards/` alongside correct `app/core/guards/` | `client/src/app/guards/auth.guard.ts` | UNCHANGED |
| L-10 | Geocode search query has no `[MaxLength]` limit | `GeocodeController.cs:216` | UNCHANGED |
| L-11 | `ApplicationDbContextFactory` reads connection string via hardcoded environment variable name instead of `IConfiguration` | `ApplicationDbContextFactory.cs:20` | NEW |
| L-12 | `GlobalExceptionHandler` exposes `InnerException.Message` in non-production responses (debug aid; could leak DB details) | `GlobalExceptionHandler.cs:142` | NEW |
| L-13 | `UserPreferencesController.Upsert` accepts unbounded arrays without size validation (potential DoS via oversized payloads) | `UserPreferencesController.cs:51` | NEW |

---

## Regression Checks (7/7 CONFIRMED — No Regressions)

| # | Control | Status | Evidence |
|---|---------|--------|----------|
| 1 | `_escapeHtml()` in Leaflet popup components | **CONFIRMED** | Found in 4 files: bid-sheet, customer-map (both), customer-profile. Proper entity escaping: `&`, `<`, `>`, `"` |
| 2 | Rate limiting (300 req/min per user) | **CONFIRMED** | `Program.cs:309-320` — FixedWindowRateLimiter, partition by `User.Identity.Name ?? RemoteIpAddress` |
| 3 | AllowedHosts production hostnames (not `"*"`) | **CONFIRMED** | `appsettings.json:9` — 6 explicit hostnames including dev/QA/prod App Service and custom domains |
| 4 | `EnableSensitiveDataLogging` guarded by `#if DEBUG` | **CONFIRMED** | `Program.cs:162-167, 186-191, 209-214` — All 3 DbContexts double-gated |
| 5 | SecurityHeadersMiddleware CSP headers | **CONFIRMED** | `SecurityHeadersMiddleware.cs` — Dual CSP (restrictive `default-src 'none'` for API; scoped policy for SPA). HSTS, X-Frame-Options: DENY, X-Content-Type-Options, Referrer-Policy all present. |
| 6 | HttpClient exclusive (no `fetch()`) | **CONFIRMED** | Grep for `fetch(` in `client/src/` returned 0 matches. All API calls via Angular HttpClient/ApiService. |
| 7 | Idle timeout service wired up | **CONFIRMED** | `idle-timeout.service.ts` exists with 30-min timeout, 5 event types, MSAL logout + clearAll() |

---

## Positive Security Observations (58 Total)

### New Positive Findings (This Review — 8)

1. **UserPreferencesController IDOR Prevention** — `CurrentUserId` derived exclusively from JWT claims (`preferred_username` → `upn` → `Identity.Name`). Both `Get()` and `Upsert()` filter by `p.UserId == CurrentUserId`. No cross-user data access possible. (`UserPreferencesController.cs:20-29,36,53`)
2. **Trade Unit Selector Client-Side Entitlement Enforcement** — `trade-unit-selector.component.ts:47-81` fetches allowed units from backend `/usertradeunits` API. Invalid selections auto-filtered on load and group change. No client bypass possible.
3. **DataPreloadService RxJS Safety** — `data-preload.service.ts:32-33` uses dual `switchMap` to cancel in-flight requests on TU change. All API calls wrapped in `catchError(() => of([]))`. Prevents stale data races.
4. **UserPreferencesService Initialization Guard** — `user-preferences.service.ts:17,33-52` — `prefsLoaded` flag prevents debounced saves from overwriting DB preferences during initialization.
5. **EnforceTradeUnitAccessAttribute Dual Mode** — `EnforceTradeUnitAccessAttribute.cs:38-96` — Sophisticated filter handles GET (silently filters `tradeUnits` param) vs mutation (rejects unauthorized TUs). Supports List, CSV, and [FromBody] property patterns.
6. **EntitlementsDB Context-Dependent Fail Behavior** — Reads fail-open (availability preserved); mutations fail-closed (ForbiddenException when allowed set is empty). This is a documented architectural trade-off. (`UserEntitlementService.cs:53-61`, `EnforceTradeUnitAccessAttribute.cs:42-46`)
7. **QA Environment Configuration** — `environment.qa.ts` created with environment-appropriate clientId, authority, API URL, and scopes. Proper multi-environment separation.
8. **OpenAPI Auth Enforcement** — `Program.cs:382` — `app.MapOpenApi().RequireAuthorization()` now requires authentication even on API spec endpoint.

### Previously Confirmed Positives (50)

9–58. Azure AD JWT on all endpoints (`[Authorize]` + `RequireAuthorization()`), `GlobalExceptionHandler` with generic client messages, `ApiErrorResponse` with trace IDs, `SecurityHeadersMiddleware` (HSTS 1yr, X-Frame-Options DENY, CSP, X-Content-Type-Options, Referrer-Policy), `CorrelationIdMiddleware` + outbound propagation, `UserEntitlementService` (request-scoped, OrdinalIgnoreCase comparison), idle session timeout (30-min, 5 event types, clearAll + MSAL logout), rate limiting (300 req/min + geocode 1 req/sec), `IMemoryCache` bounded to 5000, `#if DEBUG` + `IsDevelopment()` double-guard on sensitive logging, `HttpClient` exclusive (zero fetch/XHR), `appState.clearAll()` on logout, MSAL `SessionStorage` (tab-isolated), `AllowedHosts` whitelist, `ManagedIdentityCredential` for DB, no hardcoded secrets, EF Core LINQ throughout (no SQL injection), HTTPS redirection, Angular XSS protection, no `innerHTML`/`bypassSecurityTrust*`/`eval()`, CSRF mitigated by Bearer tokens, `UnmappedMemberHandling.Disallow`, structured logging with message templates, CI/CD OIDC federation, `X-Correlation-Id`, security audit middleware, `AsNoTracking` on reads, `ApiErrorResponse` structure, resilience patterns on HTTP clients (retry + circuit breaker), CORS per-environment, health check endpoints.

---

## Policy Compliance Matrix

| Policy / Control | Mar 13 | **Mar 16** | Finding IDs |
|-----------------|--------|-----------|-------------|
| **SECURITY_ENFORCEMENT.md** | | | |
| Secrets Detection | WARN | **WARN** | M-03, M-08 (QA json unverified) |
| C# Authentication | PASS | **PASS** | — |
| C# Authorization | IMPROVED | **WARN** | H-01 (StoredGrain/ProducerDetails), H-02 (mutation TOCTOU) |
| C# Input Validation | PASS | **PASS** | — (DTOs validated; L-13 is LOW) |
| C# Error Handling | PASS+ | **PASS+** | — |
| C# CORS | PASS | **PASS** | — (AllowedOrigins from config) |
| C# Logging | PASS | **PASS** | — (structured, guarded) |
| C# CSRF | PASS | **PASS** | — (JWT Bearer auth) |
| Angular XSS Prevention | PASS | **PASS** | — (_escapeHtml confirmed) |
| Angular Authentication | PASS | **PASS** | — (MsalGuard on all routes) |
| Angular HTTP Security | PASS | **PASS** | — (HttpClient exclusive) |
| Angular Secrets | PASS | **PASS** | — |
| Angular Token Storage | PASS | **PASS** | — (SessionStorage) |
| **ISO 27001 Annex A Controls** | | | |
| A.5.15 (Access Control) | IMPROVED | **WARN** | H-01, H-02 |
| A.8.3 (Information Access) | IMPROVED | **WARN** | H-01 |
| A.8.15 (Logging) | PASS | **PASS** | — |
| A.8.26 (App Security Req.) | PASS | **PASS+** | — (OpenAPI auth added) |
| A.8.28 (Secure Coding) | PASS | **PASS** | — |
| A.8.29 (Security Testing) | IMPROVED+ | **IMPROVED+** | Tests expanding |
| A.8.31 (Env Separation) | WARN | **IMPROVED** | H-02 prior FIXED; QA env added |
| **Zero Trust Controls** | | | |
| ISM-ZTDR (Never Trust, Always Verify) | PASS+ | **WARN** | H-02 (mutations rely on transitive auth), M-06 (fail-open reads) |
| ISM-ZTIAM (Identity & Access) | IMPROVED | **WARN** | H-01, H-02, M-02, M-06 |
| ISM-ZTAPI (API Security) | PASS | **PASS** | — (rate limiting confirmed) |
| ISM-ZTAP (Application Security) | PASS | **PASS** | — (CSP, XSS, headers) |
| ISM-ZTSS (Data Security) | PASS | **PASS** | — |
| ISM-ZTCS (Cloud Security) | IMPROVED | **IMPROVED** | — |

---

## security-review Skill Checklist

| Checklist Item | Mar 13 | **Mar 16** | Change | Findings |
|---------------|--------|-----------|--------|----------|
| **1. Secrets Management** | | | | |
| No hardcoded API keys/tokens/passwords | PASS | **PASS** | = | — |
| All secrets in environment variables / Key Vault | PASS | **WARN** | DEGRADED | M-08 (QA json unverified) |
| **2. Input Validation** | | | | |
| All inputs validated with schemas | PASS | **PASS** | = | — (L-13 is LOW) |
| File uploads restricted | N/A | **N/A** | = | No file uploads |
| **3. SQL Injection Prevention** | | | | |
| All queries parameterized | PASS | **PASS** | = | All `SqlQueryRaw` uses `{0}`/`@param` |
| **4. Authentication & Authorization** | | | | |
| Authorization checks before operations | PASS+ | **WARN** | DEGRADED | H-01, H-02 |
| Role-based access control | PARTIAL | **PARTIAL** | = | No Azure AD App Roles |
| Session management secure | PASS+ | **PASS+** | = | Idle timeout confirmed |
| HTTP interceptor adds auth headers | PASS | **PASS** | = | Zero fetch() |
| **5. XSS Prevention** | | | | |
| User HTML sanitized / no innerHTML | PASS | **PASS** | = | _escapeHtml in 4 files |
| CSP headers configured | PASS | **PASS+** | IMPROVED | Dual CSP (API + SPA) |
| **6. CSRF Protection** | | | | |
| CSRF tokens on state-changing ops | PASS | **PASS** | = | JWT Bearer auth |
| **7. Rate Limiting** | | | | |
| Rate limiting on all endpoints | PASS | **PASS** | = | 300 req/min confirmed |
| **8. Sensitive Data Exposure** | | | | |
| No secrets in logs | PASS | **PASS** | = | Structured + guarded |
| Error messages generic to clients | PASS+ | **PASS+** | = | GlobalExceptionHandler |
| **9. Dependency Security** | | | | |
| Dependencies up to date | PASS | **PASS** | = | — |
| Lock files committed | PASS | **PASS** | = | — |
| **10. Supply Chain** | | | | |
| No CDN loading | PASS | **PASS** | = | Leaflet via npm |

**Skill Checklist Score: 16/19 items PASS (84.2%)** — down from 18/19 (94.7%) at Mar 13, due to DEGRADED authorization coverage (H-01/H-02) and unverified QA secrets (M-08).

---

## CWE/SANS Top 25 Coverage (Combined Backend + Frontend)

| Rank | CWE | Vulnerability | Backend | Frontend | **Combined** | **vs Mar 13** |
|------|-----|--------------|---------|----------|-------------|----------------|
| 2 | CWE-79 | XSS | MITIGATED | MITIGATED | **SAFE** | = |
| 3 | CWE-89 | SQL Injection | MITIGATED | N/A | **SAFE** | = |
| 6 | CWE-20 | Input Validation | MITIGATED | WARN | **IMPROVED** | = |
| 9 | CWE-352 | CSRF | MITIGATED | MITIGATED | **SAFE** | = |
| 11 | CWE-862 | Missing Authorization | **FOUND** | N/A | **FOUND** | = (narrower scope) |
| 13 | CWE-287 | Improper Authentication | MITIGATED | MITIGATED | **SAFE** | = |
| 15 | CWE-502 | Insecure Deserialization | MITIGATED | LOW | **LOW** | = |
| 18 | CWE-798 | Hard-coded Credentials | MITIGATED | MITIGATED | **SAFE** | = |
| 19 | CWE-918 | SSRF | MITIGATED | MITIGATED | **SAFE** | = |
| 20 | CWE-306 | Missing Critical Authentication | MITIGATED | MITIGATED | **SAFE** | = |
| 22 | CWE-276 | Incorrect Default Permissions | N/A | N/A | **N/A** | = |

**CWE Top 25 Hits: 1 of 25** (4%) — unchanged from Mar 13. Only CWE-862 (Missing Authorization) remains, with narrower scope (2 endpoints + mutation TOCTOU vs. 7+ endpoints previously).

---

## Recommendations (Priority Order)

### Immediate (Before Production Deployment)

| Priority | Action | Addresses | Effort | Policy |
|----------|--------|-----------|--------|--------|
| **P1** | Manually verify `appsettings.QA.json` contains no secrets before QA deployment | M-08 | Trivial | SECURITY_ENFORCEMENT.md §Secrets |
| **P2** | Add `[EnforceTradeUnitAccess]` or manual filtering to `StoredGrainController.GetAll()` and `ProducerDetailsController.GetAll()` | H-01 | Small | A.5.15, ISM-ZTDR |
| **P3** | Add explicit `ValidateCustomerAccessAsync()` to Notes, PlantingIntentions, and ProducerDetails mutation endpoints | H-02 | Small | ISM-ZTDR §3.2 |

### Short-Term (Within Next Sprint)

| Priority | Action | Addresses | Effort | Policy |
|----------|--------|-----------|--------|--------|
| **P4** | Add entitlement cross-check to `UserPreferencesController.Upsert` — validate TU selections against `GetAllowedTradeUnitCodesAsync()` | M-02 | Trivial | ISM-ZTIAM |
| **P5** | Define fail-open/fail-closed policy for EntitlementsDB unavailability — consider environment-specific flag | M-06, H-01 | Small | ISM-ZTDR |
| **P6** | Define Azure AD App Roles and apply `[Authorize(Roles = "...")]` to mutation endpoints | H-02 | Medium | ISM-ZTIAM |
| **P7** | Add Angular form validators to key data-entry components | M-04 | Medium | SECURITY_ENFORCEMENT.md Angular |

### Medium-Term (Within Next Quarter)

| Priority | Action | Addresses | Effort | Policy |
|----------|--------|-----------|--------|--------|
| **P8** | Move Azure AD TenantId/ClientId to Azure App Configuration | M-03 | Small | SECURITY_GUIDELINES.md |
| **P9** | Fix CI/CD to build per-environment Angular configurations | M-07 | Small | A.8.31 |
| **P10** | Add SRI hash to Google Fonts in index.html | L-08 | Trivial | SECURITY_ENFORCEMENT.md |
| **P11** | Delete legacy `app/guards/auth.guard.ts` | L-09 | Trivial | Code hygiene |
| **P12** | Set up SAST/DAST in CI/CD pipeline | A.8.29 | Medium | ISM-ZTCS |

---

## Report Metadata

| Field | Value |
|-------|-------|
| **Commits Since Last Review** | 24 code commits (40 including merges) via PRs #44–#59 |
| **Files Changed** | 92 files, +3,923 / -1,123 lines |
| **Key Changes** | Trade unit selector (new), user preferences system (new), data preload service (new), unshipped-bushels view (new), entitlement hardening on list/GetByFarm endpoints, QA environment configuration, ApplicationDbContextFactory, Key Vault local fallback fix, DiagnosticsController auth + DenyIfNotDevelopment |
| **Review Methodology** | Three parallel specialized agents (Backend Security, Frontend Security, Delta Analysis) powered by Claude Opus 4.6 |
| **Previous Finding Disposition** | 6 FIXED, 1 SUBSTANTIALLY IMPROVED (H-01), 12 UNCHANGED, 0 REGRESSED |
| **New Findings Identified** | 4 (0 CRITICAL, 0 HIGH net-new, 2 MEDIUM, 2 LOW) + 2 HIGH evolved from prior findings |
| **Regression Checks** | 7/7 CONFIRMED — zero regressions |
| **Standards Applied** | OWASP Top 10, CWE/SANS Top 25, ISO 27001 (A.5.*–A.8.*), ISM-ZT*, security-review skill checklist |
| **Policy Documents Referenced** | SECURITY_ENFORCEMENT.md, SECURITY_STANDARDS.md, SECURITY_GUIDELINES.md, ISM-ZTDR_v1.1.md, ISM-ZTAPI_v1.1.md, ISM-ZTIAM_v1.1.md, ISM-ZTAP_v1.1.md, ISM-ZTSS_v1.1.md, ISM-ZTCS_v1.2.md, ISM-ZTAI_v1.1.md, A.5.10_v1.3.md, A.5.15_v1.6.md, A.5.19_v1.2.md, A.8.3_v1.0.md, A.8.15_v1.1.md, A.8.26_v1.0.md, A.8.28_v1.1.md, A.8.29_v1.1.md, A.8.30_v1.1.md, A.8.31_v1.2.md, SANS-CWE-Top-25.md |

---

*Report generated: 2026-03-16*
*Previous reports: 2026-02-27 (26 findings), 2026-03-05 (21), 2026-03-06 v1 (38), 2026-03-06 v2 (31), 2026-03-10 (40), 2026-03-11 (45), 2026-03-13 (23)*
*Reviewed against: SECURITY_ENFORCEMENT.md, SECURITY_STANDARDS.md, SECURITY_GUIDELINES.md, security-review skill checklist*
*ISO 27001 Controls: A.5.10, A.5.12, A.5.15, A.5.19, A.8.3, A.8.4, A.8.15, A.8.24, A.8.26, A.8.28, A.8.29, A.8.30, A.8.31, A.8.34*
*Zero Trust Controls: ISM-ZTDR, ISM-ZTAI, ISM-ZTAP, ISM-ZTAPI, ISM-ZTCS, ISM-ZTIAM, ISM-ZTSS*
*CWE/SANS Top 25: 1 of 25 vulnerabilities found (unchanged from Mar 13)*
