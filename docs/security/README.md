# Security Review Checklist

Reference: `style-guides/security-guide.md` for full policy details.

---

## Pre-Commit Checks

### Secrets & Configuration
- [ ] No credentials, API keys, or connection strings in source code
- [ ] No secrets in `appsettings.json`, `environment.ts`, or `environment.prod.ts`
- [ ] Azure Key Vault used for all production secrets
- [ ] `appsettings.Development.json` uses User Secrets only

### Authentication & Authorization
- [ ] Every API controller has `[Authorize]`
- [ ] Angular routes are protected with `authGuard`
- [ ] MSAL scopes are minimal (no over-permissioned scopes)
- [ ] No `bypassSecurityTrust*` calls in Angular templates

### Input Validation
- [ ] All API endpoints validate input server-side
- [ ] EF Core / LINQ used for all DB queries (no raw SQL string interpolation)
- [ ] Angular templates use `{{ }}` / `[textContent]` — no `innerHTML` with user data

### Data
- [ ] No production data in dev or QA environments
- [ ] PII / sensitive fields not logged
- [ ] Audit logging present for create/update/delete operations on sensitive entities

---

## API Security Baseline

| Control | Implementation |
|---------|---------------|
| Authentication | Azure AD via `Microsoft.Identity.Web` |
| Authorization | `[Authorize]` on all controllers |
| HTTPS | Enforced via HSTS + HTTPS redirection middleware |
| Error responses | `GlobalExceptionHandler` — no stack traces in production |
| CORS | Configured in `Program.cs` — origin-restricted |
| Input binding | Model validation attributes + FluentValidation where applicable |

---

## Angular Security Baseline

| Control | Implementation |
|---------|---------------|
| Auth tokens | MSAL Angular — tokens managed in memory, not localStorage |
| Route protection | `authGuard` on all feature routes |
| HTTP interceptor | Auth token attached via MSAL HTTP interceptor |
| XSS | Angular default escaping — no `bypassSecurityTrust*` |
| Graph API | Photo endpoint — `catchError(() => EMPTY)` handles 401 gracefully |

---

## Known Risks / Open Items

| Risk | Status | Owner |
|------|--------|-------|
| Graph API photo scope not granted | Low — fails silently, initials shown instead | Deferred |
| `StoredGrainController` returns stub data | No real data exposed | M1 backlog |
| Hardcoded `"system"` username in dashboard upserts | Deferred until IHttpContextAccessor wired | M1 backlog |
| No integration tests against real DB | SQL-level bugs not caught by unit tests | Future milestone |

---

## Dependency Vulnerability Checks

```bash
# .NET
cd api && dotnet list package --vulnerable

# npm
cd client && npm audit
```

Run before each release.
