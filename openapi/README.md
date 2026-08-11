# Origination — Externally Consumed API

This directory is the contract for API surface called from **outside** the Origination application. The
Infrastructure and Data Integrations teams read it directly from this repo (see
`developer-docs/EXTERNAL-SPA-GUIDE.md`).

| File | Purpose |
|---|---|
| `specification.yaml` | OpenAPI 3.0 spec — external-facing endpoints only |
| `README.md` | This file: workflows, identities, and connectivity requirements |

Currently the only externally consumed surface is **BarChart bid-feed ingestion**. Everything else in
the application is called by its own Angular front end and is deliberately out of scope here.

## Workflow: BarChart bid feed

The integration pipeline (Azure Data Factory) fetches from BarChart and forwards each response to us.
It needs **no database access** — this API is the only integration point.

**Daily (prices):**

| Step | Call | Notes |
|---|---|---|
| 1 | `GET /api/barchart-ingest/quote-batches` | We return every symbol to quote, batched in 100s |
| 2 | vendor `getQuote` per batch | Pipeline side |
| 3 | `POST /api/barchart-ingest/quotes` | One call per batch, vendor response verbatim |
| 4 | `POST /api/barchart-ingest/apply-bids` | Once, after the batches are loaded |

**Periodically (catalog — weekly is ample):**

| Step | Call | Notes |
|---|---|---|
| 1 | vendor `getGrainInstruments`, paged | Pipeline side |
| 2 | `POST /api/barchart-ingest/instruments` | One call per page |
| 3 | `POST /api/barchart-ingest/deactivate-instruments?lastSeenBefore=<sweep start>` | **Only after a complete sweep**; optional |

Forward delivery months arrive as new symbols, so the catalog needs periodic refreshing even when no
new elevators appear — otherwise the Bid Sheet slowly empties as months roll off.

## Authentication

Microsoft Entra ID, application-only (client credentials). The caller's managed identity must hold the
**`Origination.Application`** app role on the Origination API app registration for the target
environment. Enterprise applications here require assignment, so an unassigned identity receives `401`
even with a structurally valid token.

| Our environment | API app registration (token audience) | Accepted hosts |
|---|---|---|
| Dev | `api://00078a10-3f3f-4d17-9350-fe90401125ae` | `app-origination-dev-eus.azurewebsites.net`, `origination-dev.scoular.com` |
| QA | `api://f3fcab2b-98c8-4622-86bd-c874d281b22a` | `app-origination-qa-eus.azurewebsites.net`, `origination-qa.scoular.com` |
| Prod | `api://e1458bcd-7212-4ea0-a836-7e08d03b5bbf` | `app-origination-eus.azurewebsites.net`, `origination.scoular.com` |

### Registered callers (integration pipeline)

Supplied by the integration team 2026-08-11. Their QA **and** UAT both target our QA, so two identities
need the role on the QA app registration.

| Their environment | Targets our | Managed identity | Object id |
|---|---|---|---|
| DEV | Dev | `scoiaanp-uami-integration-dev-ipaas` | `1b97e5c0-ae4c-49d8-8aed-4c7df5bb744c` |
| QA | QA | `scoiaanp-uami-integration-qa-ipaas` | `cfce5a3c-a43d-4d49-9dee-a3a9eab956e9` |
| UAT | QA | `scoiaanp-uami-integration-uat-ipaas` | `9376dcd5-d17c-4d8a-b2aa-3a96f160eb77` |
| PROD | Prod | `scoiaap-uami-integration-ipaas` | `7f374a39-cfb3-43a8-8c68-5c5f47cfedd5` |

### Granting the role

Confirmed with the integration team 2026-08-11: **the assignment is made on the Origination side**, not
theirs. It is a config change to Origination's `app-config.json` in the **`IT/infrastructure-as-code`**
repo (the same repo that syncs `developer-docs/` into this one — see its sync commits) — per
`developer-docs/APP-REGISTRATIONS.md`, the `Sync-AppRoles` function resolves role GUIDs and preserves
them across deployments. That file also holds the outbound network rules and external endpoint list, so
a connectivity change would go in the same request.

Note the UAT identity is assigned to the **qa** environment, because their UAT targets our QA.

```json
"appRoleAssignments": [
  {
    "principalDisplayName": "scoiaanp-uami-integration-dev-ipaas",
    "principalId": "1b97e5c0-ae4c-49d8-8aed-4c7df5bb744c",
    "appRoleValue": "Origination.Application",
    "environments": ["dev"]
  },
  {
    "principalDisplayName": "scoiaanp-uami-integration-qa-ipaas",
    "principalId": "cfce5a3c-a43d-4d49-9dee-a3a9eab956e9",
    "appRoleValue": "Origination.Application",
    "environments": ["qa"]
  },
  {
    "principalDisplayName": "scoiaanp-uami-integration-uat-ipaas",
    "principalId": "9376dcd5-d17c-4d8a-b2aa-3a96f160eb77",
    "appRoleValue": "Origination.Application",
    "environments": ["qa"]
  },
  {
    "principalDisplayName": "scoiaap-uami-integration-ipaas",
    "principalId": "7f374a39-cfb3-43a8-8c68-5c5f47cfedd5",
    "appRoleValue": "Origination.Application",
    "environments": ["prod"]
  }
]
```

No new app roles are needed — `Origination.Application` already exists in every environment as a
convention-based default. This is assignment only, which also avoids the trap where declaring a custom
`appRoles` array drops the roles that aren't re-listed.

**Assign through this config, not by hand in the portal.** A manual Enterprise Application assignment
works until the next app-registration sync reconciles it away, which would break the integration at an
unpredictable moment.

**To verify** after it deploys: the caller's token should carry `"roles": ["Origination.Application"]`,
and a call should return anything other than `401`. Every attempt — success or failure — lands a row in
`dbo.BarchartApiCallAudit`, so that table answers "did they reach us and what happened".

## Connectivity requirement

**The Origination App Service has no public inbound access** — traffic arrives via private endpoints
only, and the host allowlist above is enforced on every request. A caller therefore needs either:

- a **managed virtual network with a private endpoint** to the App Service, or
- to route through **APIM**, which already has private connectivity.

If the route is APIM, anything that rewrites the `Host` header must preserve one of the allowlisted
hostnames, or requests are rejected before reaching application code.

## Request rules

- **Body:** the vendor response verbatim. No reshaping, renaming, or filtering — we select the fields
  we need, so extra vendor fields are ignored rather than rejected.
- **No compression.** There is no request-decompression middleware; a gzipped body fails to parse.
- **10 MB maximum** per request. A 100-symbol quote batch is roughly 50 KB.
- **`X-Correlation-Id`** is echoed and stamped on our logs — send your run id and a single run becomes
  traceable across both systems.

## Retries and idempotency

Every endpoint is safe to retry. Loads upsert rather than duplicate, and the daily history row is
replaced per business date, so a failed step or an entire failed run can be repeated with no cleanup
and no idempotency key.

Retry on `429` (honour `Retry-After`), `500`, `502`, `503`, `504`. Do not retry `400`, `401`, or `403` —
they indicate a payload or authorization problem that a retry cannot fix.

## Offline / degraded behaviour

| Condition | Effect |
|---|---|
| Pipeline doesn't run | The Bid Sheet keeps the last loaded prices. Each cell shows the vendor's "as of" time, so staleness is visible rather than silently wrong. |
| Some quote batches fail | Successful batches still land. Re-running the run refreshes the rest. |
| Quote arrives for an unknown symbol | Skipped and counted in `unknownSymbolCount`; a catalog load resolves it. |
| Commodity not yet mapped on our side | Data is stored but not published to the Bid Sheet. Deliberate — an unmapped commodity is never guessed at. |
| Vendor sends a malformed value | That single field becomes empty; the rest of the payload loads normally. |

## Related documentation

- `docs/application-context/Barchart Ingestion API Contract.md` — narrative version of this contract
- `docs/application-context/Barchart Bid Feed - Database Plan.md` — what happens to the data after it
  arrives, and the feed-versus-manual bid ownership rules
