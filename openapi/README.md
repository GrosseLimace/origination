# Origination External API — Workflow and Offline Summary

This directory is the contract for the Origination Workbench **mobile** surface, produced per [developer-docs/EXTERNAL-SPA-GUIDE.md](../developer-docs/EXTERNAL-SPA-GUIDE.md). It is consumed by three teams:

| Team | Uses |
|---|---|
| Infrastructure | Populates `externalApp.externalApiEndpoints` in app-config.json; creates the Static Web Apps and WAF policy |
| Data Integrations | Imports `specification.yaml` into APIM via APIOps; configures policies (JWT validation, rate limiting, quotas, header handling) |
| Origination app team | Builds the mobile Angular app against these endpoints; generates the TypeScript client from the spec; a CI drift test keeps the spec equal to the `api/mobile/v1/*` controllers |

**Status: skeleton.** `paths` is intentionally empty until the Phase 0 stakeholder meeting fixes the v1 operation list (see [docs/mobile/MEETING-QUESTIONS.md](../docs/mobile/MEETING-QUESTIONS.md), question 4). Do not submit to Infrastructure or Data Integrations until the workflow table below and `specification.yaml` are filled in.

## Routing

| Environment | Base URL | Route |
|---|---|---|
| Local | `http://localhost:5000/api/mobile/v1` | Direct to the .NET API |
| Dev | `https://origination-dev.scoular.com/api/mobile/v1` | Direct to App Service (no APIM in dev) |
| QA | `https://apiqa.scoular.com/{apimPathPrefix}` | Through APIM |
| Prod | `https://api.scoular.com/{apimPathPrefix}` | Through APIM |

Paths in `specification.yaml` are relative to the APIM path prefix (for example `/customers/{id}`, not `/api/mobile/v1/customers/{id}`). The backend web-service URL configured in APIM must include `/api/mobile/v1` so operation templates map 1:1 with no rewrite policy.

## Authentication

Entra ID, same tenant as the desktop app (`1521f999-f722-4a4f-9747-166f93e9b0d1`). Tokens carry audience = the Origination API app registration and scope `Origination.Mobile.{Env}`. APIM validates and **passes the token through unchanged**; the backend re-validates scope, client id, and trade-unit entitlement on every request.

## Workflows and offline behaviour

Fill one row per user workflow once scope is decided. Candidate rows from the architecture plan are pre-listed; delete what the meeting rejects.

| Workflow | Description | Endpoints | Offline behaviour |
|---|---|---|---|
| My customers | List producers in the caller's entitled trade units | TODO | Serve from cache (1 h) |
| Customer detail | Read one producer's summary | TODO | Serve from cache (1 h); never caches contact PII |
| Recent notes | Read latest notes for a producer | TODO | Serve from cache (short TTL) |
| Create note | Add a note to a producer | TODO | Queue in IndexedDB with a client request id; sync when online; duplicate submission returns the existing note |
| Reminders | Read/complete the caller's own follow-ups | TODO | Serve from cache; completes fail gracefully offline |
| Bid view | Read today's bids for entitled locations | TODO | Serve from cache; shows "as of" time |
| Reference data | Commodities and trade units | TODO | Serve from cache (1 d) |

Anything not listed here is **not** reachable from the mobile client: APIM only exposes the operations in `specification.yaml`, and the backend `MobileAccess` policy rejects mobile tokens on every other route.

## Change process

1. Edit `specification.yaml` and this README in the same pull request as the controller change.
2. CI runs `@redocly/cli lint`, regenerates the mobile TypeScript client, and runs the drift test that compares the spec to the live `api/mobile/v1` routes in both directions.
3. After merge, notify Data Integrations so APIM operations are re-imported.
