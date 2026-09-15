# Mobile Component — Platform and Team Requests

Requests the Origination app team must make to other teams, grouped by owner, with the artifact each team needs from us. Start the Data Integrations and Identity items first; they are the longest lead times. Source: [MOBILE-ARCHITECTURE-PLAN.md](MOBILE-ARCHITECTURE-PLAN.md) §5–§6 and [developer-docs/EXTERNAL-SPA-GUIDE.md](../../developer-docs/EXTERNAL-SPA-GUIDE.md) "Request Process".

Already provisionable per [START-HERE.md](../../developer-docs/START-HERE.md): `swa-origination-dev-eus`, `swa-origination-qa-eus`, `swa-origination-eus` and the `ext-origination-*` domains exist "if enabled". The ask is to enable them, not design new resources.

## Infrastructure

| # | Request | We provide | Status |
|---|---|---|---|
| E1 | Set `externalApp.enabled` for Origination in app-config.json; create the three Static Web Apps with custom domains: dev `ext-origination-dev.scoular.com`; QA and Prod split-horizon on `origination-qa.scoular.com` / `origination.scoular.com` | `openapi/specification.yaml`, `openapi/README.md`, link to ADR-001 | |
| E2 | WAF policy on Application Gateway for the APIM path prefix | The spec (for the prefix) | |
| E3 | **Dedicated** SPA app registration `Origination External - {Env}` per environment: SPA platform, redirect URIs = SWA custom domain plus `http://localhost:4200`, pre-authorised for scope `Origination.Mobile.{Env}`. Resolve the conflict between EXTERNAL-SPA-GUIDE.md (dedicated) and APP-REGISTRATIONS.md "External SPA" section (reuse) and correct the losing document | Redirect URI list | |
| E4 | Dev App Service `app-origination-dev-eus`: add `https://ext-origination-dev.scoular.com` to the `AllowedOrigins` app setting (dev only; QA/Prod go through APIM) | Setting name `AllowedOrigins` | |
| E5 | Grant the GitHub Actions service principal Contributor on the three SWAs for OIDC `swa deploy` | Workflow file reference | |
| E6 | Confirm the inbound path APIM → App Service private endpoint is allowed in QA and Prod | — | |
| E12 | Application Insights: agree `cloud_RoleName = origination-mobile-spa`; alert rules for 401/403 spikes on `api/mobile/*`, sustained 429s, APIM 5xx spikes, SWA certificate expiry | KQL based on `SecurityAuditMiddleware` fields | |
| E13 | APIM diagnostic logs into the same Log Analytics workspace with correlation id; confirm Azure SQL audit retention meets the spec | — | |

## Data Integrations (APIM)

| # | Request | We provide | Status |
|---|---|---|---|
| E7 | Import `openapi/specification.yaml` via APIOps. Backend web-service URL `https://app-origination-{env}-eus.azurewebsites.net/api/mobile/v1` so operation templates map 1:1 with no rewrite policy. Policies: `validate-jwt` (audience = Origination API app registration, required scope `Origination.Mobile.{Env}`), `rate-limit-by-key` keyed on the `oid` claim, `quota-by-key`, `set-header X-Correlation-Id` (pass through the client's value if present), strip server and `X-Forwarded-*` headers outbound, CORS for the SWA origin, no response caching on operations returning producer data | Spec + README | |
| E8 | Confirm **token pass-through**: the user's token (audience = Origination API app registration) is forwarded unchanged. No token exchange. | — | |

## Identity / Security

| # | Request | We provide | Status |
|---|---|---|---|
| E9 | Create delegated scope `Origination.Mobile.{Env}` on the existing Origination API app registrations (dev `00078a10-3f3f-4d17-9350-fe90401125ae`, QA `f3fcab2b-98c8-4622-86bd-c874d281b22a`, prod `e1458bcd-7212-4ea0-a836-7e08d03b5bbf`). Do **not** grant it to the desktop SPA registrations | Scope names | |
| E10 | `tokenLifetimePolicy` with a 15-minute access token for the mobile client (or a documented 60-minute exception); Continuous Access Evaluation enabled; Conditional Access "require compliant device" targeting the mobile client; pilot on iOS Safari (Authenticator SSO extension) and Android Chrome | Mobile client app ids | |
| — | Security pre-review package (Phase 1): ADR-001, the four exceptions (shared host, shared identity, no device binding in PWA, browser storage), and the pending countersigns for AR-01, AR-02 and AR-08 — sent together to asksecurity@scoular.com | Package | |

## Infrastructure / DBA (deferred — only for the later host split)

| # | Request | We provide | Status |
|---|---|---|---|
| E11 | User-assigned managed identity `id-origination-mobile-{env}`; contained SQL user with `db_datareader` plus INSERT/UPDATE on the mobile-writable tables only, no `db_ddladmin`. Also move connection strings into Key Vault, closing AR-06 | Table list from the Mobile assembly | |

## Sequence

1. Phase 1: E1, E2, E3, E7, E8, E9, E10 and the security pre-review package, all in the same week.
2. Phase 3: E4, E5 (needed before the first dev SWA deploy).
3. Phase 4: E6, E12, E13.
4. Only if Security requires the host split: E11.
