# Origination External API — Workflow and Offline Summary

This directory is the contract for the Origination Workbench **mobile** surface, produced per [developer-docs/EXTERNAL-SPA-GUIDE.md](../../docs/mobile/reference/EXTERNAL-SPA-GUIDE.md). It is consumed by three teams:

| Team | Uses |
|---|---|
| Infrastructure | Populates `externalApp.externalApiEndpoints` in app-config.json; creates the Static Web Apps and WAF policy |
| Data Integrations | Imports `specification.yaml` into APIM via APIOps; configures policies (JWT validation, rate limiting, quotas, header handling) |
| Origination app team | Builds the mobile Angular app against these endpoints; generates the TypeScript client from the spec; a CI drift test keeps the spec equal to the `api/mobile/v1/*` controllers |

**Status: Phase 1 contract, draft for review.** Scope comes from GitHub cards #641–#648 (Phase 1) created 2026-09-23, plus the group → trade units → producers flow and saved-list read-back agreed in the 2026-09-23 preview. 18 operations. Two open decisions still affect the *Offline behaviour* column and are marked below.

## Routing

| Environment | Base URL | Route |
|---|---|---|
| Local | `http://localhost:5000/api/mobile/v1` | Direct to the .NET API |
| Dev | `https://origination-dev.scoular.com/api/mobile/v1` | Direct to App Service (no APIM in dev) |
| QA | `https://apiqa.scoular.com/{apimPathPrefix}` | Through APIM |
| Prod | `https://api.scoular.com/{apimPathPrefix}` | Through APIM |

Paths in `specification.yaml` are relative to the APIM path prefix (for example `/customers/{id}`, not `/api/mobile/v1/customers/{id}`). The backend web-service URL configured in APIM must include `/api/mobile/v1` so operation templates map 1:1 with no rewrite policy.

## Authentication

Entra ID, same tenant as the desktop app (`1521f999-f722-4a4f-9747-166f93e9b0d1`). Tokens carry audience = the Origination API app registration and scope `Origination.Mobile.{Env}`. APIM validates and **passes the token through unchanged**; the backend re-validates scope, client id, and trade-unit entitlement on every request. Customers outside the caller's entitlement return 404, not 403.

## Workflows and offline behaviour

| Card | Workflow | Operations | Source | Offline behaviour |
|---|---|---|---|---|
| — | Sign in; pick a group, then trade units (flow agreed 2026-09-23) | `getSession` (trade units + groups) | Origination DB + entitlements | Served from cache after first load (1 day). Drives Storage tab visibility and the first screen |
| #641 | Browse producers in the selected trade units, search to narrow, open detail | `searchCustomers` (q optional), `getCustomer` | Origination DB | Search requires connectivity. Recently opened producers are served from cache (1 hour) **excluding contact phone/email, which are never cached** |
| — | Open a saved list for the selected trade units | `getSavedLists`, `getSavedListMembers` | Origination DB | **Limitation:** a saved list's query criteria are evaluated in the desktop browser; the phone shows only its manually added members. Running a list server-side is a scoped follow-up (see plan) |
| #642 | Call or email a contact | `getCustomer` (contacts) | Origination DB | Native `tel:` / `mailto:` links; work offline if the detail is already on screen |
| #643 | Edit on-farm details | `getProducerDetails`, `updateProducerDetails` | Origination DB | **Scope:** total acres is editable; bin sites (name, capacity) and grain on farm (per site) are read-only, because since the 2026-10-13 release grain is tied to a site and the phone cannot carry site links, bushels sold or last bid. The update preserves everything it does not carry. **Offline: DECISION PENDING (meeting Q3).** Default: save fails gracefully with a retry prompt. If "hours offline" is required: queue in IndexedDB with `clientRequestId`, last-write-wins with `expectedModifiedAt` conflict surfaced to the user |
| #644 | Add a note; see pinned + recent | `getRecentNotes`, `createNote` | Origination DB | Read served from cache (15 min). **Create is queued** in IndexedDB with `clientRequestId`; replay returns the same note. Capped to 10 notes so the payload stays small on poor signal |
| #645 | Contract cards, expand for detail | `getContractCards`, `getContractDetail` | ODS view (read-only) | Served from cache (1 hour, 3 s network timeout). Cold ODS may take up to 60 s; client shows "refreshing" rather than blocking |
| #646 | Ticket roll-up | `getTicketSummary` | ODS view (read-only) | Served from cache (1 hour). No line items |
| #647 | Planting intentions: view, add, update | `getPlantingIntentions`, `createPlantingIntention`, `updatePlantingIntention`, `getPlantingCommodities` | Origination DB | Read from cache (1 hour). **DECISION PENDING (Q3)** for add/update; default is graceful failure, alternative is the same queue as notes |
| #648 | Storage and DP cards | `getStorageCards`, `getDpContractCards` | ODS views (read-only) | Served from cache (1 hour). Storage tab hidden when the trade unit's `offersStorage` is false. DP data exists only in Prod; Dev/QA return empty by design |

Anything not listed here is **not** reachable from the mobile client: APIM only exposes the operations in `specification.yaml`, and the backend `MobileAccess` policy rejects mobile tokens on every other route.

## Phase 2 cards (no new endpoints in this revision)

| Card | Workflow | Endpoint impact |
|---|---|---|
| #649 | Lightweight prospect capture | New `prospects` resource in a later revision; overlaps issue #518. Not in this file yet |
| #650 | Tap address for directions | None. Client builds a native maps link from `CustomerDetail` address fields (desktop already does this on `feature_AddressMapLink`) |
| #651 | Dictated notes | None. Device speech-to-text feeds `createNote` |

## Open items that block finalising this file

1. **Offline depth (meeting Q3):** decides whether producer-detail and planting-intention writes queue or fail gracefully. Affects two rows above and the server-side idempotency work.
2. **`offersStorage` per trade unit:** no such fact exists in the system today (storage is looked up per customer from an ODS view). Needs a data owner and a source (trade-unit table column or configuration).
3. **APIM token pass-through (meeting Q6):** the security scheme assumes the user's token reaches the backend unchanged.

## Change process

1. Edit `specification.yaml` and this README in the same pull request as the controller change.
2. CI runs `@redocly/cli lint`, regenerates the mobile TypeScript client, and runs the drift test that compares the spec to the live `api/mobile/v1` routes in both directions.
3. After merge, notify Data Integrations so APIM operations are re-imported.
