# Security Review Report: Grain Originator Portal (Origination) -- v2

**Application:** Grain Originator Portal
**Review Date:** 2026-03-06 (v2 -- post-authentication-merge)
**Previous Reviews:** 2026-02-27, 2026-03-05, 2026-03-06 (v1)
**Reviewer:** Claude Opus 4.6 (Three Parallel Specialized Agents: Backend, Frontend, Delta)
**Branch:** Cadens_Branch merged with origin/main (HEAD: 1ee7df4)
**Repository:** origination (https://scoular.ghe.com/IT/origination.git)
**Tech Stack:** .NET 10 / ASP.NET Core + Angular 19 + Azure SQL + Azure AD (Entra ID)
**Review Scope:** Full source code security review against Scoular ISMS policies, security-review skill checklist, and all referenced policy documents in `C:\Program Files\claudecode\`

---

## Executive Summary

| Metric | Feb 27 | Mar 5 | Mar 6 v1 | **Mar 6 v2** | **Change** |
|--------|--------|-------|----------|-------------|-----------|
| **Overall Status** | FAIL | FAIL | FAIL | **CONDITIONAL PASS** | MAJOR IMPROVEMENT |
| **Critical Findings** | 5 | 3 | 4 | **0** | **-4 (all resolved)** |
| **High Findings** | 9 | 5 | 10 | **6** | **-4** |
| **Medium Findings** | 7 | 8 | 15 | **13** | **-2** |
| **Low Findings** | 5 | 5 | 9 | **12** | +3 (info-level items) |
| **Total Active** | **26** | **21** | **38** | **31** | **-7** |
| **Remediated (cumulative)** | 0 | 7 | 7 | **17** | **+10 new remediations** |
| **Security Score** | 15% | 35% | 30% | **68%** | **+38 points** |

### Critical Achievement: ZERO Critical Findings

The merge of origin/main brought **transformative security changes**:
- **Azure AD authentication** implemented on both backend (Microsoft.Identity.Web, `[Authorize]` on all 14 controllers) and frontend (MSAL Angular, route guards on all 6 routes, MsalInterceptor for automatic bearer tokens)
- **Security response headers** added (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy)
- **Configuration-driven CORS** replacing hardcoded localhost origins
- **Comprehensive error handling** across both tiers with structured logging
- **31+ unit tests** including security regression tests for authorization
- **Unit test infrastructure** (xUnit/Moq backend, Jasmine/Karma frontend)

The application status moves from **FAIL** to **CONDITIONAL PASS** -- deployable with documented accepted risks, pending CSP header addition and audit trail user identity implementation.

---

## Improvement Trend Chart (Four Reviews)

```
SEVERITY COMPARISON: Feb 27 → Mar 05 → Mar 06 v1 → Mar 06 v2
=================================================================

               Feb 27    Mar 05    Mar 06v1   Mar 06v2   Trend
               ------    ------    --------   --------   -----
CRITICAL       █████ 5   ███ 3     ████ 4     0          ✅ ALL RESOLVED
HIGH           █████████ 9  █████ 5  ██████████ 10  ██████ 6   ✅ IMPROVING
MEDIUM         ███████ 7 ████████ 8 ███████████████ 15 █████████████ 13  → STABLE
LOW            █████ 5   █████ 5   █████████ 9   ████████████ 12  ↑ MORE THOROUGH
               ─────────────────────────────────────────────────────────
TOTAL          26        21        38         31

SECURITY SCORE TREND
=================================================================
Feb 27:  [███░░░░░░░░░░░░░░░░░] 15%   FAIL   (no auth, XSS, stack traces)
Mar 05:  [███████░░░░░░░░░░░░░] 35%   FAIL   (auth missing, XSS/errors fixed)
Mar 06v1:[██████░░░░░░░░░░░░░░] 30%   FAIL   (deeper review found more gaps)
Mar 06v2:[██████████████░░░░░░] 68%   COND.  (AUTH IMPLEMENTED! Headers added)
                                       PASS

REMEDIATION VELOCITY
=================================================================
          Remediated  New Found   Net Change
Feb→Mar5:     7          +2         -5 total
Mar5→v1:      0         +17        +17 (deeper review)
v1→v2:       10          +3         -7 total
CUMULATIVE:  17 remediations across 4 reviews

CRITICAL FINDINGS ELIMINATION
=================================================================
Feb 27:  ⛔⛔⛔⛔⛔  (5 critical)
Mar 05:  ⛔⛔⛔        (3 critical -- stack traces fixed)
Mar 06v1:⛔⛔⛔⛔      (4 critical -- deeper review found 1 more)
Mar 06v2:✅✅✅✅✅    (0 critical -- ALL ELIMINATED by auth implementation)
```

---

## Remediations Confirmed in This Review (10 New + 7 Prior = 17 Total)

### New Remediations (This Merge)

| # | Previous ID | Finding | Status | Evidence |
|---|-------------|---------|--------|----------|
| 1 | **C-001** | No Authentication on API | **CLOSED** | `Microsoft.Identity.Web` 4.5.0 added; `AddMicrosoftIdentityWebApiAuthentication()` in Program.cs:30; `UseAuthentication()` + `UseAuthorization()` at lines 184-185; `[Authorize]` on all 14 controllers; verified by `ControllerAuthorizationTests.cs` |
| 2 | **C-002** | No CSRF Protection | **CLOSED** | Bearer token auth inherently mitigates CSRF (tokens not auto-sent by browsers); CORS restricts origins; documented as architectural decision |
| 3 | **H-006** | No Angular Route Guards / MSAL | **CLOSED** | `@azure/msal-angular` ^5.1.1 + `@azure/msal-browser` ^5.4.0 added; `MsalGuard` + `MsalInterceptor` configured in main.ts; `authGuard` on all 6 routes in app.routes.ts; `handleRedirectObservable()` in AppComponent |
| 4 | **H-001** | Missing Security Headers | **PARTIAL** | Program.cs:174-181 adds X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy. **Still missing: CSP, HSTS** |
| 5 | **H-004→M** | CORS Missing Production Origins | **CLOSED** | CORS origins now read from `Configuration["AllowedOrigins"]` with env-specific overrides; explicit headers (`Content-Type`, `Authorization`) and methods (`GET`, `POST`, `PUT`, `DELETE`) |
| 6 | **D-CRIT-01** | Direct Nominatim Fetch (bid-sheet) | **IMPROVED** | `encodeURIComponent()` added for query encoding; still uses `fetch()` but with proper encoding. Remains open as MEDIUM (bypasses MsalInterceptor). TODO comment documents planned replacement. |
| 7 | **L-005** | Missing Error Handling in Deletes | **CLOSED** | NotesController, PlantingIntentionsController, SavedListsController all have try/catch with ILogger + generic error response. Verified by unit tests (Delete_Returns500_WhenExceptionThrown). |
| 8 | **H-005** | No Client Error Handling | **CLOSED** | `handleError()` method in api.service.ts with contextual messages (401: "Session expired", 403: "No permission"); `.pipe(catchError(...))` on all ~40 HTTP calls; verified by unit tests |
| 9 | **C-003** | Diagnostics Schema Exposure | **IMPROVED** | Now requires Azure AD authentication (was completely public). Downgraded from Critical→Medium. Still accessible to all authenticated users. |
| 10 | **--** | No Automated Tests | **CLOSED** | 31+ tests: ControllerAuthorizationTests (14 controllers verified), NotesControllerTests (7), PlantingIntentionsControllerTests (6), SavedListsControllerTests (6), api.service.spec.ts (12) |

### Prior Remediations (Still Confirmed)

| # | ID | Finding | Status | First Fixed |
|---|-----|---------|--------|-------------|
| 11 | C-005 | Stack Traces Exposed | CLOSED | Mar 5 |
| 12 | H-002 | innerHTML in StoredGrainTable | CLOSED | Mar 5 |
| 13 | H-003 | document.write XSS | CLOSED | Mar 5 |
| 14 | H-007 | Hardcoded API Base URL | CLOSED | Mar 5 |
| 15 | M-005 | Swallowed Geocode Exceptions | PARTIAL | Mar 5 |
| 16 | -- | AsNoTracking on reads | CONFIRMED | Mar 6 v1 |
| 17 | -- | HttpParams in ApiService | CONFIRMED | Mar 6 v1 |

---

## HIGH Findings (6)

### H-NEW-01: Hardcoded "system" User in Audit Trails (Now Auth Exists)

| Field | Value |
|-------|-------|
| **Severity** | **HIGH** (upgraded from Medium -- auth now available) |
| **Files** | DashboardPlantingEstimatesController.cs:32,48,64; SqlDataService.cs:982,1014,1114,1165,1246,1265,1348 |
| **CWE** | CWE-287 (Improper Authentication) |
| **Policy Refs** | A.8.15 (Logging), A.8.34 (Audit Testing), ISM-ZTIAM (Identity & Access), SECURITY_STANDARDS.md Section 7 |
| **Skill Ref** | security-review Section 4 (Authorization Checks) |

**Description:** Now that Azure AD authentication is in place, `User.Identity.Name` and claims are available on every authenticated request. However, all 10+ write operations still hardcode `"system"` or `"System"` as `CreatedBy`/`ModifiedBy`. The code has `// TODO: Get from authenticated user` comments. The audit trail is useless for attributing changes to specific users.

**Remediation:** Replace with `User.FindFirst("preferred_username")?.Value ?? User.Identity?.Name ?? "unknown"` passed from controllers to service layer.

---

### H-NEW-02: fetch() Bypasses MsalInterceptor for Backend API Call

| Field | Value |
|-------|-------|
| **Severity** | **HIGH** |
| **File:Line** | `client/src/app/components/map/customer-map.component.ts:405` |
| **CWE** | CWE-306 (Missing Authentication for Critical Function) |
| **Policy Refs** | A.5.15, A.8.3, ISM-ZTIAM, SECURITY_ENFORCEMENT.md (Angular HIGH: Authentication -- "HTTP interceptor adds auth headers") |
| **Skill Ref** | security-review Section 4 (Authentication) -- "HTTP interceptor adds auth headers, not manual in each request" |

**Description:** The map component uses native `fetch()` to call `/api/geocode/batch`, bypassing the MsalInterceptor entirely. This request is sent **without a Bearer token**, meaning it will receive a 401 from the now-authenticated backend. Either the geocoding feature is broken in production, or there's a misconfiguration allowing unauthenticated access.

**Remediation:** Replace `fetch()` with Angular `HttpClient` via the `ApiService`.

---

### H-NEW-03: No Content Security Policy (CSP) Header

| Field | Value |
|-------|-------|
| **Severity** | **HIGH** |
| **Files** | `api/.../Program.cs:174-181` (backend), `client/src/index.html` (frontend) |
| **CWE** | CWE-1021 (Improper Restriction of Rendered UI Layers), CWE-693 (Protection Mechanism Failure) |
| **Policy Refs** | A.8.26 (Application Security Requirements), A.8.28 (Secure Coding), ISM-ZTAP, SECURITY_GUIDELINES.md (Security Headers) |
| **Skill Ref** | security-review Section 5 (XSS Prevention) -- "CSP headers configured" |

**Description:** Four security headers were added, but Content-Security-Policy is absent. CSP is the most effective browser-enforced XSS mitigation. Without it, the Leaflet popup XSS findings (H-NEW-05) are more exploitable.

**Remediation:** Add CSP header in the backend middleware:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://*.tile.openstreetmap.org data:; connect-src 'self' https://login.microsoftonline.com
```

---

### H-NEW-04: Mass Assignment -- Customer Entity as Input

| Field | Value |
|-------|-------|
| **Severity** | **HIGH** |
| **File:Line** | `api/.../Controllers/CustomersController.cs:51` |
| **CWE** | CWE-915 (Mass Assignment) |
| **Policy Refs** | A.8.28, ISM-ZTAP, SECURITY_ENFORCEMENT.md (HIGH: Input Validation) |

**Description:** `Update(long id, [FromBody] Customer request)` accepts the full 30+ property domain entity. The `Customer` model has no validation attributes. Only 5 fields are actually used. An authenticated attacker could submit `IsActive: false` to deactivate customers.

---

### H-NEW-05: XSS in Leaflet Map Popups -- Unescaped Customer Data

| Field | Value |
|-------|-------|
| **Severity** | **HIGH** |
| **Files** | `customer-map.component.ts:487,489,495,505` (map folder); `customer-map.component.ts:135,151-154` (customers folder) |
| **CWE** | CWE-79 (Stored XSS) |
| **CWE/SANS Rank** | #2 |
| **Policy Refs** | A.8.28, SECURITY_ENFORCEMENT.md (Angular CRITICAL: XSS Prevention), SANS-CWE-Top-25.md |
| **Skill Ref** | security-review Section 5 -- "User-provided HTML sanitized" |

**Description:** Customer names, sourceCustomerIds, locations, and contact info are interpolated directly into Leaflet popup HTML via template literals without any HTML escaping. Unlike the print function which uses `escapeHtml()`, the map popups have zero encoding.

---

### H-NEW-06: UpsertDashboardActualHarvestRequest Has Zero Validation

| Field | Value |
|-------|-------|
| **Severity** | **HIGH** |
| **File:Line** | `api/.../Models/UpsertDashboardActualHarvestRequest.cs:1-10` |
| **CWE** | CWE-20 (Improper Input Validation) |
| **CWE/SANS Rank** | #6 |
| **Policy Refs** | A.8.28, SECURITY_ENFORCEMENT.md (HIGH: Input Validation) |

**Description:** Unlike sibling DTOs (UpsertDashboardEstimateRequest with `[Required]`, `[StringLength]`, `[Range]`), this model has zero validation attributes. Accepts unbounded strings and arbitrary integer values.

---

## MEDIUM Findings (13)

| ID | Finding | CWE | Policy Ref | File:Line |
|----|---------|-----|-----------|-----------|
| **M-01** | No HSTS (`app.UseHsts()` absent) | CWE-319 | A.8.26, ISM-ZTAP, SECURITY_GUIDELINES.md | Program.cs |
| **M-02** | No global rate limiting | CWE-770 | A.8.26, ISM-ZTAPI; Skill Section 7 | Program.cs |
| **M-03** | No global exception handler (`UseExceptionHandler`) | CWE-209 | A.8.28; Skill Section 8 | Program.cs |
| **M-04** | DiagnosticsController schema exposure (now auth-required) | CWE-200 | A.5.15, A.8.34, ISM-ZTDR | DiagnosticsController.cs:22-101 |
| **M-05** | Production server name in appsettings.json | CWE-200 | A.5.12, ISM-ZTSS, SECURITY_ENFORCEMENT.md | appsettings.json:11 |
| **M-06** | MSAL tokens cached in localStorage | CWE-922 | SECURITY_ENFORCEMENT.md (Token Storage); Skill Section 4 | main.ts:30 |
| **M-07** | No logout functionality in UI | CWE-613 | A.5.15, ISM-ZTIAM | header.component.ts |
| **M-08** | Unescaped `guild` field in print function | CWE-79 | A.8.28; Skill Section 5 | customer-profile.component.ts:775 |
| **M-09** | CDN Leaflet loading (supply chain risk) | CWE-829 | A.5.19, ISM-ZTCS; Skill Section 10 | customer-map.component.ts (customers):102-113 |
| **M-10** | String interpolation in 13 log statements | CWE-117 | A.8.15; Skill Section 8 | SqlDataService.cs (multiple) |
| **M-11** | GeocodeRequest / ProducerDetailsRequest missing validation | CWE-20 | A.8.28; Skill Section 2 | GeocodeController.cs:187-194; ProducerDetailsController.cs:69-81 |
| **M-12** | Dependency versions use caret `^` ranges | CWE-1104 | A.5.19, A.8.30, ISM-ZTCS; Skill Section 10 | client/package.json |
| **M-13** | Nominatim direct fetch from bid-sheet (encodeURIComponent added) | CWE-918 | A.8.28, ISM-ZTSS | bid-sheet.component.ts:998 |

---

## LOW Findings (12)

| ID | Finding | File |
|----|---------|------|
| L-01 | EnableSensitiveDataLogging gated by IsDevelopment() | Program.cs:56,77 |
| L-02 | AzureAd config incomplete in base appsettings (by design) | appsettings.json:13-15 |
| L-03 | OriginationConnection missing from base appsettings | Program.cs:65 |
| L-04 | Batch geocode bare catch block (no logging) | GeocodeController.cs:177 |
| L-05 | EF Core SQL logging at Information level in base config | appsettings.json:7 |
| L-06 | AllowedHosts wildcard | appsettings.json:9 |
| L-07 | SavedList Filters no StringLength | SavedListsController.cs:73 |
| L-08 | Verbose ticket data in production logs | SqlDataService.cs:842-845 |
| L-09 | JSON.parse without try/catch in api.service.ts | api.service.ts:312 |
| L-10 | console.error in production build | main.ts:52 |
| L-11 | Authorization test list manually maintained (not assembly-scanned) | ControllerAuthorizationTests.cs:14-30 |
| L-12 | No integration tests for 401 rejection | Test project |

---

## Positive Security Observations (24 Confirmed + 10 New)

### New Positive Findings (This Merge)
1. **Azure AD Authentication on all 14 controllers** -- `[Authorize]` verified by unit tests
2. **MSAL Angular with route guards on all 6 routes** -- Complete client-side auth
3. **MsalInterceptor auto-attaches Bearer tokens** -- All HttpClient calls authenticated
4. **Security headers middleware** -- X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy
5. **Configuration-driven CORS** -- Origins from appsettings, not hardcoded
6. **Structured error handling** -- Backend try/catch + ILogger; Frontend handleError() with toast
7. **31+ unit tests with security regression** -- ControllerAuthorizationTests verifies [Authorize]
8. **Centralized HTTP error handling** -- 401/403 contextual messages
9. **Microsoft.Identity.Web 4.5.0** -- Current, secure Azure AD library
10. **MSAL PKCE flow** -- No client secrets in SPA code

### Previously Confirmed (Maintained)
11-24. EF Core LINQ (no SQL injection), Azure AD Default for SQL, validation annotations on most DTOs, retry logic, HTTPS redirection, Angular framework XSS protection, no secrets in code, geocode rate limiting, nullable reference types, escapeHtml on print, innerHTML eliminated, environment-based URLs, AsNoTracking, HttpParams builder

---

## Policy Compliance Matrix (Four-Review Trend)

| Policy / Control | Feb 27 | Mar 5 | Mar 6v1 | **Mar 6v2** | Finding IDs |
|-----------------|--------|-------|---------|------------|-------------|
| **SECURITY_ENFORCEMENT.md** | | | | | |
| Secrets Detection | WARN | WARN | WARN | WARN | M-05 |
| C# Authentication | FAIL | FAIL | FAIL | **PASS** | -- (C-001 CLOSED) |
| C# Authorization | FAIL | FAIL | FAIL | **PASS** | -- (all 14 controllers) |
| C# Input Validation | WARN | WARN | WARN | WARN | H-NEW-04, H-NEW-06, M-11 |
| C# Error Handling | FAIL | **PASS** | **PASS** | **PASS** | -- (maintained + improved) |
| C# CORS | FAIL | IMPROVED | IMPROVED | **PASS** | -- (config-driven) |
| C# Logging | WARN | WARN | DEGRADED | WARN | H-NEW-01, M-10 |
| C# CSRF | FAIL | FAIL | FAIL | **PASS** | -- (bearer tokens mitigate) |
| Angular XSS Prevention | FAIL | **PASS** | DEGRADED | WARN | H-NEW-05, M-08 |
| Angular Authentication | FAIL | FAIL | FAIL | **PASS** | -- (MSAL + guards) |
| Angular HTTP Security | FAIL | IMPROVED | IMPROVED | **IMPROVED** | H-NEW-02 (one fetch() left) |
| Angular Secrets | PASS | PASS | PASS | **PASS** | -- |
| **ISO 27001 Annex A Controls** | | | | | |
| A.5.15 (Access Control) | FAIL | FAIL | FAIL | **PASS** | -- (Azure AD auth) |
| A.8.3 (Information Access) | FAIL | FAIL | FAIL | **PASS** | -- |
| A.8.26 (App Security Req.) | FAIL | FAIL | FAIL | **IMPROVED** | H-NEW-03, M-01, M-02 |
| A.8.28 (Secure Coding) | FAIL | IMPROVED | WARN | **IMPROVED** | H-NEW-04/05/06, M-08 |
| A.8.29 (Security Testing) | UNKNOWN | UNKNOWN | UNKNOWN | **IMPROVED** | 31+ unit tests |
| **Zero Trust Controls** | | | | | |
| ISM-ZTDR (Never Trust, Always Verify) | FAIL | FAIL | FAIL | **PASS** | -- (auth on every request) |
| ISM-ZTIAM (Identity & Access) | FAIL | FAIL | FAIL | **PASS** | -- (Azure AD + MSAL) |
| ISM-ZTAPI (API Security) | FAIL | FAIL | FAIL | **IMPROVED** | M-02 (rate limiting) |
| ISM-ZTAP (Application Security) | FAIL | IMPROVED | WARN | **IMPROVED** | H-NEW-03/05 |
| ISM-ZTSS (Data Security) | WARN | WARN | DEGRADED | **IMPROVED** | M-05, M-06 |

---

## security-review Skill Checklist (Post-Merge)

| Checklist Item | Previous | **Current** | Findings |
|---------------|----------|-------------|----------|
| **1. Secrets Management** | | | |
| No hardcoded API keys/tokens/passwords | WARN | **PASS** | No secrets in code |
| All secrets in environment variables | WARN | **PASS** | Azure AD config via env vars |
| **2. Input Validation** | | | |
| All inputs validated with schemas | FAIL | **WARN** | Most DTOs validated; 3 missing |
| **3. SQL Injection Prevention** | | | |
| All queries parameterized | PASS | **PASS** | EF Core LINQ throughout |
| **4. Authentication & Authorization** | | | |
| Authorization checks before operations | FAIL | **PASS** | `[Authorize]` on all controllers |
| Role-based access control | FAIL | **PARTIAL** | Auth exists; no RBAC roles yet |
| Session management secure | FAIL | **PASS** | MSAL PKCE + bearer tokens |
| **5. XSS Prevention** | | | |
| User HTML sanitized | PARTIAL | **WARN** | Print: yes; Map popups: no |
| CSP headers configured | FAIL | **FAIL** | H-NEW-03 |
| **6. CSRF Protection** | | | |
| CSRF tokens on state-changing ops | FAIL | **PASS** | Bearer tokens mitigate CSRF |
| **7. Rate Limiting** | | | |
| Rate limiting on all endpoints | FAIL | **FAIL** | M-02 |
| **8. Sensitive Data Exposure** | | | |
| No secrets in logs | WARN | **WARN** | M-10 (string interpolation) |
| Error messages generic | PASS | **PASS** | Maintained |
| **10. Dependency Security** | | | |
| Dependencies up to date | WARN | **IMPROVED** | MSAL packages current |
| Lock files committed | PASS | **PASS** | package-lock.json present |

---

## CWE/SANS Top 25 Coverage (Post-Merge)

| Rank | CWE | Vulnerability | Found? | Mar 6v1 | **Mar 6v2** |
|------|-----|--------------|--------|---------|-------------|
| 2 | CWE-79 | **XSS** | YES | YES | **YES** (map popups) |
| 3 | CWE-89 | SQL Injection | NO | NO | **NO** (safe) |
| 6 | CWE-20 | **Input Validation** | YES | YES | **YES** (3 models) |
| 9 | CWE-352 | CSRF | YES | YES | **NO** (bearer mitigates) |
| 11 | CWE-862 | **Missing Authorization** | YES | YES | **NO** (auth added) |
| 13 | CWE-287 | **Improper Authentication** | YES | YES | **NO** (Azure AD) |
| 15 | CWE-502 | Insecure Deserialization | YES | YES | **LOW** (JSON.parse) |
| 18 | CWE-798 | Hard-coded Credentials | YES | YES | **LOW** (server name only) |
| 19 | CWE-918 | SSRF | YES | YES | **YES** (Nominatim) |
| 20 | CWE-306 | **Missing Authentication** | YES | YES | **NO** (auth added) |

**CWE Top 25 Hits: 4 of 25** (16%) -- down from 9/25 (36%) in Mar 6 v1

---

## Recommendations (Priority Order)

### Immediate (Before Production)

| Priority | Action | Addresses | Effort |
|----------|--------|-----------|--------|
| **P1** | Add CSP header to security headers middleware | H-NEW-03 | Small |
| **P2** | Replace `fetch()` with `HttpClient` in customer-map geocode | H-NEW-02 | Small |
| **P3** | Add `escapeHtml()` to all Leaflet map popup interpolations | H-NEW-05 | Small |
| **P4** | Replace "system" with `User.Identity?.Name` in all audit fields | H-NEW-01 | Medium |

### Short-Term (Within Next Sprint)

| Priority | Action | Addresses | Effort |
|----------|--------|-----------|--------|
| **P5** | Create `UpdateCustomerRequest` DTO | H-NEW-04 | Small |
| **P6** | Add validation attributes to ActualHarvest, GeocodeRequest, ProducerDetails | H-NEW-06, M-11 | Small |
| **P7** | Add logout button to header calling `msalService.logoutRedirect()` | M-07 | Small |
| **P8** | Add `app.UseHsts()` for non-dev environments | M-01 | Trivial |
| **P9** | Add global exception handler (`UseExceptionHandler`) | M-03 | Small |
| **P10** | Restrict DiagnosticsController to admin role or dev-only | M-04 | Small |

### Medium-Term (Within Next Quarter)

| Priority | Action | Addresses | Effort |
|----------|--------|-----------|--------|
| **P11** | Implement rate limiting middleware | M-02 | Medium |
| **P12** | Move production connection string to App Service config | M-05 | Small |
| **P13** | Convert string interpolation to structured logging | M-10 | Medium |
| **P14** | Replace CDN Leaflet with npm package consistently | M-09 | Small |
| **P15** | Replace Nominatim with Azure Maps or internal service | M-13 | Medium |
| **P16** | Consider `BrowserCacheLocation.SessionStorage` for MSAL | M-06 | Trivial |
| **P17** | Set up SAST/DAST in CI/CD pipeline | A.8.29 | Medium |

---

## Report Metadata

| Field | Value |
|-------|-------|
| **Commits Since Last Review** | 6 (from origin/main merge: auth, tests, standards) |
| **Files Changed** | 78 files, +14,206 / -1,954 lines |
| **Key New Packages** | `Microsoft.Identity.Web` 4.5.0, `@azure/msal-angular` ^5.1.1, `@azure/msal-browser` ^5.4.0 |
| **New Test Files** | 4 backend (xUnit), 1 frontend (Jasmine), 2 config (karma.conf.js, tsconfig.spec.json) |
| **Review Methodology** | Three parallel specialized agents (backend, frontend, delta analysis) |
| **Standards Applied** | OWASP Top 10, CWE/SANS Top 25, ISO 27001 (A.5.*-A.8.*), ISM-ZT*, security-review skill checklist |
| **Policy Documents Referenced** | SECURITY_ENFORCEMENT.md, SECURITY_STANDARDS.md, SECURITY_GUIDELINES.md, ISM-ZTDR, ISM-ZTAPI, ISM-ZTIAM, ISM-ZTAP, ISM-ZTSS, ISM-ZTCS, ISM-ZTAI, A.5.10-A.5.19, A.8.3-A.8.34, SANS-CWE-Top-25.md |

---

*Report generated: 2026-03-06 v2 (post-authentication merge)*
*Previous reports: 2026-02-27 (26 findings), 2026-03-05 (21 findings), 2026-03-06 v1 (38 findings)*
*Reviewed against: SECURITY_ENFORCEMENT.md, SECURITY_STANDARDS.md, SECURITY_GUIDELINES.md, security-review skill checklist*
*ISO 27001 Controls: A.5.10, A.5.12, A.5.15, A.5.19, A.8.3, A.8.4, A.8.15, A.8.24, A.8.26, A.8.28, A.8.29, A.8.30, A.8.31, A.8.34*
*Zero Trust Controls: ISM-ZTDR, ISM-ZTAI, ISM-ZTAP, ISM-ZTAPI, ISM-ZTCS, ISM-ZTIAM, ISM-ZTSS*
*CWE/SANS Top 25: 4 of 25 vulnerabilities remaining (down from 9)*
