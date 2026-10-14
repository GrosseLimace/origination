# Mobile Component — Platform and Team Requests

Requests the Origination app team makes to other teams, grouped by owner. Source: [MOBILE-ARCHITECTURE-PLAN.md](MOBILE-ARCHITECTURE-PLAN.md).

> **Decided 2026-10-14: follow Burdi's hosting pattern.** The mobile app is served by the existing Origination App Service at `/mobile`, like Burdi's `/driver` app, and Origination becomes "hybrid internet-accessible" like Burdi. From the internet, FortiGate and the Application Gateway WAF let through only `/mobile/*` and `/api/mobile/v1/*`; everything else stays internal. There is **no Static Web App and no APIM**, so Data Integrations is not involved. **Sign-in stays separate from the desktop** (its own app registration and scope), so the server refuses a phone sign-in anywhere outside the mobile API even if the WAF list ever changes. Phones are personal and unmanaged; there is no app-store app.

## Infrastructure

| # | Request | We provide | Status |
|---|---|---|---|
| H1 | Make Origination **hybrid internet-accessible like Burdi** in QA and Prod, with `externalAllowedPaths` = `/mobile/*` and `/api/mobile/v1/*`. Confirm how Dev can be tested from a phone (Burdi's pattern opens QA and Prod only) | The two paths | |
| E3 | A **separate SPA app registration** for the mobile app per environment (name at Infrastructure's choice, e.g. `Origination Mobile - {Env}`): SPA platform, redirect URIs `https://origination{-dev,-qa,}.scoular.com/mobile` (subpath, as Burdi does for `/driver`) plus `http://localhost:4300` in Dev, pre-authorised for the scope in E9 | Redirect URI list | |
| E9 | Delegated scope `Origination.Mobile.{Env}` on the existing Origination API app registrations (Dev `00078a10-3f3f-4d17-9350-fe90401125ae`, QA `f3fcab2b-98c8-4622-86bd-c874d281b22a`, Prod `e1458bcd-7212-4ea0-a836-7e08d03b5bbf`), granted **only** to the E3 registration, never to the desktop SPA. If another team owns the API registrations, route it to them | Scope names | |
| E12 | Application Insights alerts: 401/403 spikes on `api/mobile/*`, sustained 429s, WAF blocks on the mobile paths | KQL based on `SecurityAuditMiddleware` fields | |
| E14 | Enable GitHub Advanced Security (code scanning) on `IT/origination` so CodeQL can run on pull requests. Interim control already in place: Roslyn security analyzers as build errors and NuGet/npm vulnerability scans in `ci.yml` | Repo name | |

## Identity / Security

| # | Request | We provide | Status |
|---|---|---|---|
| E10 | For the mobile registration: 15-minute access token (or a documented 60-minute exception), Continuous Access Evaluation, and a sign-in policy that fits **personal, unmanaged phones** (MFA plus a sign-in frequency Identity chooses). Pilot on iOS Safari and Android Chrome | Mobile client app ids | |
| — | Security early read: is the Burdi-style internet access acceptable for Origination's mobile paths, and may the phone cache producer reads briefly (1 hour, notes 15 minutes) or none at all? | ADR-001 | |

## No longer needed (Burdi hosting pattern, 2026-10-14)

E1 Static Web Apps · E2 WAF policy for an APIM prefix (replaced by H1) · E4 CORS for a separate site (the app is now same-origin) · E5 deploy permission on Static Web Apps (the existing App Service deploy ships the mobile app) · E6 APIM to App Service path · E7 and E8 APIM import and token pass-through (Data Integrations) · E13 APIM diagnostics.

## Deferred (only if Security requires a separate host)

| # | Request | We provide | Status |
|---|---|---|---|
| E11 | User-assigned managed identity `id-origination-mobile-{env}`; contained SQL user with `db_datareader` plus INSERT/UPDATE on the mobile-writable tables only. Also move connection strings into Key Vault, closing AR-06 | Table list from the Mobile assembly | |

## Sequence

1. Now: H1, E3, E9 to Infrastructure in one message; the Security early read in parallel.
2. Once E3 and E9 exist: set the client ids in the mobile environment files and `Mobile:AllowedClientAppIds`, then test sign-in.
3. With E10: the iPhone and Android pilot in QA.
