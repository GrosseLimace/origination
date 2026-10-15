# Mobile Component — Platform and Team Requests

Requests the Origination app team makes to other teams, grouped by owner. Source: [MOBILE-ARCHITECTURE-PLAN.md](MOBILE-ARCHITECTURE-PLAN.md).

> **Decided 2026-10-14: follow Burdi's hosting pattern.** The mobile app is served by the existing Origination App Service at `/mobile`, like Burdi's `/driver` app, and Origination becomes "hybrid internet-accessible" like Burdi. From the internet, FortiGate and the Application Gateway WAF let through only `/mobile/*` and `/api/mobile/v1/*`; everything else stays internal. There is **no Static Web App and no APIM**, so Data Integrations is not involved. Phones are personal and unmanaged; there is no app-store app.

> **Decided 2026-10-15: sign-in shared with the desktop, as in Burdi.** The phone signs in with the existing Origination SPA registration and the `Origination.Application.{Env}` scope, with `/mobile` added as a redirect URI — exactly as Burdi's PWA registration lists `/driver`. The mobile API still accepts only tokens issued to that registration (`Mobile:AllowedClientAppIds`), and the WAF allow-list is what keeps the rest of the API off the internet. `Mobile:SharedSignIn` switches back to a separate registration if Security ever requires it.

## Infrastructure

| # | Request | We provide | Status |
|---|---|---|---|
| H1 | Make Origination **hybrid internet-accessible like Burdi** in QA and Prod, with `externalAllowedPaths` = `/mobile/*` and `/api/mobile/v1/*`. Confirm how Dev can be tested from a phone (Burdi's pattern opens QA and Prod only) | The two paths | |
| E3 | Add the `/mobile` redirect URI (SPA platform) to the **existing** Origination SPA registrations, as Burdi's PWA registration lists `/driver`: `https://origination-dev.scoular.com/mobile` on Dev `e0f25943-ae8b-4c2d-8060-c9ffbd448aff`, `https://origination-qa.scoular.com/mobile` on QA `c2bb1208-063d-43aa-bad0-6b51d21437b4`, `https://origination.scoular.com/mobile` on Prod `958fd665-daa3-42c5-9903-3c9c00638bf1`. No new registration or scope (`http://localhost:4201` is already on the Dev one) | The three URIs | |
| E12 | Application Insights alerts: 401/403 spikes on `api/mobile/*`, sustained 429s, WAF blocks on the mobile paths | KQL based on `SecurityAuditMiddleware` fields | |
| E14 | Enable GitHub Advanced Security (code scanning) on `IT/origination` so CodeQL can run on pull requests. Interim control already in place: Roslyn security analyzers as build errors and NuGet/npm vulnerability scans in `ci.yml` | Repo name | |

## Identity / Security

| # | Request | We provide | Status |
|---|---|---|---|
| E10 | For Origination sign-ins **from iPhone and Android** (Conditional Access by device platform, since the registration is shared with the desktop): a policy that fits **personal, unmanaged phones** (MFA plus a sign-in frequency Identity chooses) and Continuous Access Evaluation. Token lifetime stays the default unless Identity prefers 15 minutes for desktop too (documented 60-minute exception with CAE). Pilot on iOS Safari and Android Chrome | Origination SPA app ids | |
| — | Security early read: is the Burdi-style internet access acceptable for Origination's mobile paths, and may the phone cache producer reads briefly (1 hour, notes 15 minutes) or none at all? | ADR-001 | |

## No longer needed (Burdi hosting pattern, 2026-10-14)

E9 a separate `Origination.Mobile.{Env}` scope (sign-in shared with the desktop, 2026-10-15) · E1 Static Web Apps · E2 WAF policy for an APIM prefix (replaced by H1) · E4 CORS for a separate site (the app is now same-origin) · E5 deploy permission on Static Web Apps (the existing App Service deploy ships the mobile app) · E6 APIM to App Service path · E7 and E8 APIM import and token pass-through (Data Integrations) · E13 APIM diagnostics.

## Deferred (only if Security requires a separate host)

| # | Request | We provide | Status |
|---|---|---|---|
| E11 | User-assigned managed identity `id-origination-mobile-{env}`; contained SQL user with `db_datareader` plus INSERT/UPDATE on the mobile-writable tables only. Also move connection strings into Key Vault, closing AR-06 | Table list from the Mobile assembly | |

## Sequence

1. Now: H1 and E3 to Infrastructure in one message; the Security early read in parallel.
2. Once E3 exists: deploy to Dev and sign in on a phone on the Scoular network (client ids and scopes are already configured).
3. With E10: the iPhone and Android pilot in QA.
