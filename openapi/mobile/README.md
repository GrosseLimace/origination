# Origination External API — Workflow and Offline Summary

This directory is the contract for the Origination Workbench **mobile** surface, produced per [developer-docs/EXTERNAL-SPA-GUIDE.md](../../docs/mobile/reference/EXTERNAL-SPA-GUIDE.md). It is consumed by three teams:

| Team | Uses |
|---|---|
| Infrastructure | Populates `externalApp.externalApiEndpoints` in app-config.json; creates the Static Web Apps and WAF policy |
| Data Integrations | Imports `specification.yaml` into APIM via APIOps; configures policies (JWT validation, rate limiting, quotas, header handling) |
| Origination app team | Builds the mobile Angular app against these endpoints; generates the TypeScript client from the spec; a CI drift test keeps the spec equal to the `api/mobile/v1/*` controllers |

**Status: Phase 1 contract, draft for review.** Scope comes from GitHub cards #641–#648 (Phase 1) created 2026-09-23, plus the group → trade units → producers flow agreed in the 2026-09-23 preview. Saved lists were removed from mobile on 2026-10-14 (originators search instead). 17 operations. Two open decisions still affect the *Offline behaviour* column and are marked below.


> **Decided 2026-10-15: follow Grain Vision's external app — supersedes the Burdi notes above.** Grain Vision (IT/grain-vision) implements the EXTERNAL-SPA-GUIDE: the field app is its own Azure Static Web App (Dev `ext-origination-dev.scoular.com`; QA/Prod on the desktop's address via split-horizon DNS), it calls the API through APIM at `api{dev,qa,}.scoular.com/external/origination/v1` (App Gateway + WAF in front; Dev too, as Grain Vision's does), and the App Service stays fully private — no "hybrid" paths, no `/mobile` on the App Service. Sign-in stays shared with the desktop (Grain Vision does the same). Open: the Guide restricts external access to company-managed devices; our originators use personal, unmanaged phones (PLATFORM-REQUESTS.md D1).
>
> ~~**Decided 2026-10-14: Burdi's hosting pattern.**~~ The mobile app is served by the existing Origination App Service at `/mobile` (like Burdi's `/driver`), and Origination becomes "hybrid internet-accessible" like Burdi: from the internet, FortiGate and the Application Gateway WAF let through only `/mobile/*` and `/api/mobile/v1/*`. **No Static Web App, no APIM, no Data Integrations work.** Sign-in stays separate from the desktop (own app registration and `Origination.Mobile.{Env}` scope), so the server refuses phone sign-ins outside the mobile API even if the WAF list changes; sharing the desktop sign-in like Burdi was considered and deferred until Security confirms it. Sections below that describe a Static Web App or APIM are superseded by this note.

## Routing

| Environment | Base URL | Route |
|---|---|---|
| Local | `http://localhost:5000/api/mobile/v1` | Direct to the .NET API |
| Dev | `https://apidev.scoular.com/external/origination/v1` | Through APIM (as Grain Vision's Dev external app) |
| QA | `https://apiqa.scoular.com/external/origination/v1` | Through APIM |
| Prod | `https://api.scoular.com/external/origination/v1` | Through APIM |

The prefix `/external/origination/v1` is our proposal (Grain Vision uses `/external/grainvision/v1`); Data Integrations confirms it.

Paths in `specification.yaml` are relative to the APIM path prefix (for example `/customers/{id}`, not `/api/mobile/v1/customers/{id}`). The backend web-service URL configured in APIM must include `/api/mobile/v1` so operation templates map 1:1 with no rewrite policy.

## Authentication

Entra ID, same tenant as the desktop app (`1521f999-f722-4a4f-9747-166f93e9b0d1`). Sign-in is **shared with the desktop, as in Grain Vision** (decided 2026-10-15): tokens come from the Origination SPA registration with audience = the Origination API app registration and scope `Origination.Application.{Env}`. APIM validates the token and passes it through unchanged; the backend re-validates scope, client id (only the Origination SPA registration) and trade-unit entitlement on every request. Customers outside the caller's entitlement return 404, not 403.

## Workflows and offline behaviour

| Card | Workflow | Operations | Source | Offline behaviour |
|---|---|---|---|---|
| — | Sign in; pick a group, then trade units (flow agreed 2026-09-23) | `getSession` (trade units + groups) | Origination DB + entitlements | Served from cache after first load (1 day). Drives Storage tab visibility and the first screen |
| #641 | Browse producers in the selected trade units, search to narrow, open detail | `searchCustomers` (q optional), `getCustomer` | Origination DB | Search requires connectivity. Recently opened producers are served from cache (1 hour) **excluding contact phone/email, which are never cached** |
| #642 | Call or email a contact | `getCustomer` (contacts) | Origination DB | Native `tel:` / `mailto:` links; work offline if the detail is already on screen |
| #643 | Edit on-farm details | `getProducerDetails`, `updateProducerDetails` | Origination DB | **Scope:** total acres, bin sites (name, capacity) and grain on farm per site are editable (decided 2026-10-14). Lists sent replace the stored set; lists omitted are kept. Every field read (site key, coordinates, last bid) is sent back, so a phone save never erases desktop data; `expectedModifiedAt` turns a concurrent desktop edit into a 409. **Offline: queued** (built 2026-10-15, Burdi's pattern): without signal the save is kept in IndexedDB with its `clientRequestId`, shown straight away as "waiting to sync", and replayed in order when signal returns. Two offline edits merge; a later edit is re-based on the version the earlier one produced. A refused replay (409 changed on the desktop, 400, 403, 404) stops as "couldn't be saved" with Retry / Discard instead of retrying forever |
| #644 | Add a note; see pinned + recent | `getRecentNotes`, `createNote` | Origination DB | Read served from cache (15 min). **Create is queued** in IndexedDB with `clientRequestId`; replay returns the same note. Capped to 10 notes so the payload stays small on poor signal |
| #645 | Contract cards, expand for detail | `getContractCards`, `getContractDetail` | ODS view (read-only) | Served from cache (1 hour, 3 s network timeout). Cold ODS may take up to 60 s; client shows "refreshing" rather than blocking |
| #646 | Ticket roll-up | `getTicketSummary` | ODS view (read-only) | Served from cache (1 hour). No line items |
| #647 | Planting intentions: view, add, update | `getPlantingIntentions`, `createPlantingIntention`, `updatePlantingIntention`, `getPlantingCommodities` | Origination DB | Read from cache (1 hour). **Add and update are queued** like on-farm details (built 2026-10-15): queued adds show as "waiting to sync" cards without Edit until they have a server id |
| #648 | Storage and DP cards | `getStorageCards`, `getDpContractCards` | ODS views (read-only) | Served from cache (1 hour). Storage & DP tab hidden entirely unless the producer's trade unit offers storage (`getTradeUnitStorage`: derived from DP and storage rows, decided 2026-10-14). Summary of count + bushels, cards expand for detail, no ticket-level detail. DP data exists only in Prod; Dev/QA return empty by design |

Anything not listed here is **not** reachable from the mobile client: APIM only exposes the operations in `specification.yaml`, and the backend `MobileAccess` policy rejects mobile tokens on every other route.

## Phase 2 cards (no new endpoints in this revision)

| Card | Workflow | Endpoint impact |
|---|---|---|
| #649 | Lightweight prospect capture | New `prospects` resource in a later revision; overlaps issue #518. Not in this file yet |
| #650 | Tap address for directions | None. Client builds a native maps link from `CustomerDetail` address fields (desktop already does this on `feature_AddressMapLink`) |
| #651 | Dictated notes | None. Device speech-to-text feeds `createNote` |

## Open items that block finalising this file

1. ~~**Offline depth (meeting Q3)**~~ **Writes decided 2026-10-14 / built 2026-10-15:** every write queues (notes, on-farm details and contacts, planting add/update), following Burdi; all four already de-duplicate by `clientRequestId` server-side. Still open with Hope/Travis + Security: how much producer data may be *read* offline (cache depth on personal phones).
2. ~~**`offersStorage` per trade unit**~~ **Decided 2026-10-14:** derived from the data. A trade unit offers storage when any of its producers has a DP contract or a storage receipt; `Mobile:StorageTradeUnits` can force one on. Cached server-side (yes 12 h, no 1 h).
3. **APIM token pass-through (meeting Q6):** the security scheme assumes the user's token reaches the backend unchanged.

## Change process

1. Edit `specification.yaml` and this README in the same pull request as the controller change.
2. CI runs `@redocly/cli lint`, regenerates the mobile TypeScript client, and runs the drift test that compares the spec to the live `api/mobile/v1` routes in both directions.
3. After merge, notify Data Integrations so APIM operations are re-imported.
