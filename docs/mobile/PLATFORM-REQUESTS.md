# Mobile Component — Platform and Team Requests

Requests the Origination app team makes to other teams, grouped by owner. Source: [MOBILE-ARCHITECTURE-PLAN.md](MOBILE-ARCHITECTURE-PLAN.md). Ready-to-send wording: [REQUEST-MESSAGES.md](REQUEST-MESSAGES.md).

> **Decided 2026-10-15: follow Grain Vision's external app** (replaces the 2026-10-14 Burdi hosting decision). Grain Vision implements Infrastructure's [EXTERNAL-SPA-GUIDE](reference/EXTERNAL-SPA-GUIDE.md): the field app is its own **Azure Static Web App** (Dev on its own `ext-` address; QA and Prod on the desktop's address through split-horizon DNS), it calls the API through **APIM** (`api{dev,qa,}.scoular.com/external/{app}/v1`, App Gateway + WAF in front), and the **App Service stays fully private**. Sign-in is the **desktop's** (same SPA registration and scope; no separate external registration). Origination does the same, with APIM forwarding to our dedicated `api/mobile/v1` surface. One difference Grain Vision does not have: **our originators use personal, unmanaged phones**, while the Guide restricts external access to company-managed devices, so that question goes to Infrastructure and Security first.

> **Personal phones (D1), heard 2026-10-15, not yet confirmed in writing:** Security's position is reported as MFA **and Microsoft Edge** on personal phones — most likely Intune app protection (MAM without enrollment) with Conditional Access requiring Edge. No code change: the mobile app is a website and runs in Edge. To test in Edge with app protection on, because MAM can block them: tap-to-call (tel:), email (mailto:), Maps links, "Use my location", Add to Home Screen, offline saving.

## Infrastructure

| # | Request | We provide | Status |
|---|---|---|---|
| E1 | Enable Origination's **external app** like Grain Vision's: Static Web Apps `swa-origination-dev-eus`, `swa-origination-qa-eus`, `swa-origination-eus`; Dev address `ext-origination-dev.scoular.com`; QA/Prod on `origination-qa.scoular.com` / `origination.scoular.com` via split-horizon DNS; App Gateway + WAF in front of APIM for our path | This list; `openapi/mobile/` || Sent to Karl Hague 2026-10-15 — Infrastructure IN PROGRESS |
| E3 | Add `https://ext-origination-dev.scoular.com` as a redirect URI (SPA platform) on the existing **Origination - Dev** registration `e0f25943-ae8b-4c2d-8060-c9ffbd448aff`. QA and Prod need nothing: split-horizon reuses the existing `https://origination-qa.scoular.com` / `https://origination.scoular.com` redirect URIs, as for Grain Vision | The URI || Sent to Karl Hague 2026-10-15 — Infrastructure IN PROGRESS |
| E5 | Let the GitHub Actions service principal deploy to the three Static Web Apps (our `deploy-mobile.yml`, the same shape as Grain Vision's `deploy-external.yml`) | Workflow || Sent to Karl Hague 2026-10-15 — Infrastructure IN PROGRESS |
| D1 | **Personal phones:** the Guide limits external access to company-managed devices through Conditional Access. Originators use their own unmanaged phones. Can Origination's external app allow them (e.g. MFA plus a sign-in frequency), and who decides — Infrastructure or Security? | Context below || Sent to Karl Hague 2026-10-15 — Infrastructure IN PROGRESS |
| E12 | Application Insights alerts: 401/403 spikes on `api/mobile/*`, sustained 429s | KQL based on `SecurityAuditMiddleware` fields | |
| E14 | Enable GitHub Advanced Security (code scanning) on `IT/origination` so CodeQL can run on pull requests. Interim control already in place: Roslyn security analyzers as build errors and NuGet/npm vulnerability scans in `ci.yml` | Repo name | |

## Data Integrations

| # | Request | We provide | Status |
|---|---|---|---|
| E7 | Import `openapi/mobile/specification.yaml` into APIM via APIOps in **Dev, QA and Prod** (Grain Vision's Dev external app uses `apidev.scoular.com` too). Proposed prefix `/external/origination/v1`, backend `https://app-origination{-dev,-qa,}-eus.azurewebsites.net/api/mobile/v1` (paths 1:1, no rewrite). Policies: `validate-jwt` (audience = the Origination API registration, scope `Origination.Application.{Env}`), CORS for the Static Web App origins, `rate-limit-by-key` on the user's `oid`, correlation-id pass-through | Spec + README || **Dev + QA DONE** (Titus, 2026-10-15; verified: all 17 operations at /external/origination/v1 on apidev/apiqa answer 401 without a token, non-contract calls 404). Prod: Titus ready "pending a PR" — hold until Dev/QA tested and Security signs off |
| E8 | Confirm the user's token is **passed through unchanged** (our API re-validates audience, scope, client id and trade-unit entitlement) | — || **Dev + QA DONE** (Titus, 2026-10-15; verified: all 17 operations at /external/origination/v1 on apidev/apiqa answer 401 without a token, non-contract calls 404). Prod: Titus ready "pending a PR" — hold until Dev/QA tested and Security signs off |

## Identity / Security

| # | Request | We provide | Status |
|---|---|---|---|
| E10 | A Conditional Access policy for Origination sign-ins **from iPhone and Android that fits personal, unmanaged phones** (MFA plus a sign-in frequency Identity chooses; ties to D1), Continuous Access Evaluation, and the token-lifetime position (the registration is shared with the desktop, so 15 minutes would apply to both; we propose a documented 60-minute exception with CAE). Pilot on iOS Safari and Android Chrome | Origination SPA app ids | |
| — | Security early read: the exceptions in ADR-001 (shared App Service host and managed identity behind APIM; no device binding; browser storage on personal phones; no compliant-device rule) and whether the phone may cache producer reads briefly (1 hour, notes 15 minutes) or none at all | ADR-001 | |

## No longer needed

- Burdi pattern (2026-10-14, replaced 2026-10-15): **H1** "hybrid internet-accessible" App Service paths — the App Service stays private; the `/mobile` redirect URIs — the app is its own site.
- Separate mobile sign-in: **E9** `Origination.Mobile.{Env}` scope and a separate registration — sign-in is shared with the desktop, as in Grain Vision.
- **E4** CORS on the App Service — the phone calls APIM, which handles CORS (E7).

## Deferred (only if Security requires a separate host)

| # | Request | We provide | Status |
|---|---|---|---|
| E11 | User-assigned managed identity `id-origination-mobile-{env}`; contained SQL user with `db_datareader` plus INSERT/UPDATE on the mobile-writable tables only. Also move connection strings into Key Vault, closing AR-06 | Table list from the Mobile assembly | |

## Sequence

1. Now: E1, E3, E5 and D1 to Infrastructure; E7 and E8 to Data Integrations; the Security early read in parallel.
2. Once Dev exists (Static Web App + APIM operations + redirect URI): deploy the API, then `deploy-mobile.yml` (dev), and sign in on a phone — from anywhere, since Dev goes through APIM.
3. With E10 and the D1 answer: the iPhone and Android pilot in QA.
