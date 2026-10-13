# Origination — Externally Consumed API

This directory is the contract for API surface called from **outside** the Origination application. The
Infrastructure and Data Integrations teams read it directly from this repo (see
`developer-docs/EXTERNAL-SPA-GUIDE.md`).

| File | Purpose |
|---|---|
| `specification.yaml` | OpenAPI 3.0 spec — external-facing endpoints only |
| `README.md` | This file: workflows, identities, and connectivity requirements |
| `mobile/` | The mobile app surface (`api/mobile/v1`) — a separate APIM API with its own spec and workflow table. See `mobile/README.md` |

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

**The pipeline moved from the iPaaS framework to Logic Apps (integration team, 2026-09-16).** The
integration itself is unchanged — same endpoints, payloads, spec and schedule shape — but the
identities are not. Each Logic App workflow runs under its **own system-assigned managed identity**,
so access is auditable and revocable per workflow rather than pooled behind one shared principal. Every
workflow that calls this API therefore needs its own grant; the earlier iPaaS UAMI grants (listed at
the end of this section for the record) stop mattering once the cutover completes.

Their QA **and** UAT both target our QA (we have no UAT), so four identities land on the QA
registration. They have confirmed QA and UAT are never enabled at the same time, so we never see two
writers.

Two of their five workflows deliberately hold **no** role — the sweep planner only calls BarChart, and
the audit rollup only reads their own storage and sends alerts. Five workflow names in their resource
group, nine grants: that is why.

**This is the complete set — nine identities, nothing further coming (integration team, 2026-09-17).**
All five workflows are deployed to their DEV, QA and UAT and are **disabled** until the grants land; they
will enable QA first and tell us before anything posts. Prod identities will be supplied when prod is
scheduled.

| Workflow | Their env | Targets our | Object id | Status |
|---|---|---|---|---|
| `logic-barchart-instr-page` | DEV | Dev | `0d6d88e9-ff6c-4107-b313-7160d706faca` | requested 2026-09-17 |
| `logic-barchart-quotes` | DEV | Dev | `0ad0da55-c8e6-40dd-91d1-1e7c2082636c` | requested 2026-09-17 |
| `logic-barchart-instr-page` | QA | QA | `79633ced-c6e4-4fea-b08b-c1fbe0c82981` | requested 2026-09-17 |
| `logic-barchart-quotes` | QA | QA | `9535f17c-c04d-4015-9ab6-ff34e083b7c7` | requested 2026-09-17 |
| `logic-barchart-instr-page` | UAT | QA | `2e3d3429-862a-44fb-9866-8434fe1c17f0` | requested 2026-09-17 |
| `logic-barchart-quotes` | UAT | QA | `bbf66830-aea2-44aa-8ed6-923d4c4ac799` | requested 2026-09-17 |
| `logic-origination-apply-bids` | DEV | Dev | `eb563a48-0f79-45c1-bdbc-5d4dbcfadcae` | requested 2026-09-17 |
| `logic-origination-apply-bids` | QA | QA | `a54f2187-9dd0-40fc-b8c3-9e1d64f3b219` | requested 2026-09-17 |
| `logic-origination-apply-bids` | UAT | QA | `c9f3891e-5af3-4783-8972-e8ff10eafd8f` | requested 2026-09-17 |
| `logic-barchart-instruments` | DEV | Dev | `65624fec-b61e-4650-826f-09538f8e10da` | added after the list above; granted (verified 2026-10-08) |
| `logic-barchart-instruments` | QA | QA | `02fe35bf-fa2d-4822-bcd5-0fb87ca2fc2c` | added after the list above; granted (verified 2026-10-08) |
| `logic-barchart-instruments` | UAT | QA | `2e7e75de-90f1-48f3-9392-c8ad385fd8b6` | added after the list above; granted (verified 2026-10-08) |

Despite "nothing further coming", a fourth calling workflow, `logic-barchart-instruments`, appeared
later and holds the role in all three non-prod environments (checked against the API registrations'
`appRoleAssignedTo`, 2026-10-08). So it is **twelve** non-prod grants, and **four per environment**.

**DEV still runs on iPaaS today** and keeps working until the integration team enables the DEV Logic
Apps, which they will not do before the grants are in. The three DEV grants go in the same pass so that
cutover is a switch, not an outage.

<details>
<summary>Superseded: the iPaaS UAMI grants (2026-08-11), still assigned but no longer used after cutover</summary>

| Their environment | Targets our | Managed identity | Object id |
|---|---|---|---|
| DEV | Dev | `scoiaanp-uami-integration-dev-ipaas` | `1b97e5c0-ae4c-49d8-8aed-4c7df5bb744c` |
| QA | QA | `scoiaanp-uami-integration-qa-ipaas` | `cfce5a3c-a43d-4d49-9dee-a3a9eab956e9` |
| UAT | QA | `scoiaanp-uami-integration-uat-ipaas` | `9376dcd5-d17c-4d8a-b2aa-3a96f160eb77` |
| PROD | Prod | `scoiaap-uami-integration-ipaas` | `7f374a39-cfb3-43a8-8c68-5c5f47cfedd5` |

Safe to remove from `appRoleAssignments` once the integration team confirms the iPaaS pipeline is retired
in every environment. Left in place until then so nothing breaks mid-cutover.
</details>

### Granting the role

Confirmed with the integration team 2026-08-11: **the assignment is made on the Origination side**, not
theirs. It is a config change to Origination's `app-config.json` in the **`IT/infrastructure-as-code`**
repo (the same repo that syncs `developer-docs/` into this one — see its sync commits) — per
`developer-docs/APP-REGISTRATIONS.md`, the `Sync-AppRoles` function resolves role GUIDs and preserves
them across deployments. That file also holds the outbound network rules and external endpoint list, so
a connectivity change would go in the same request.

Note the UAT identities are assigned to the **qa** environment, because their UAT targets our QA.

The nine Logic App identities to ADD, matching the file's exact shape (the existing iPaaS entries stay until
cutover is confirmed):

```json
"appRoleAssignments": [
  {
    "principalId": "0d6d88e9-ff6c-4107-b313-7160d706faca",
    "principalDisplayName": "logic-barchart-instr-page (DEV)",
    "principalType": "ServicePrincipal",
    "appRoleValue": "Origination.Application",
    "environments": [
      "dev"
    ]
  },
  {
    "principalId": "0ad0da55-c8e6-40dd-91d1-1e7c2082636c",
    "principalDisplayName": "logic-barchart-quotes (DEV)",
    "principalType": "ServicePrincipal",
    "appRoleValue": "Origination.Application",
    "environments": [
      "dev"
    ]
  },
  {
    "principalId": "eb563a48-0f79-45c1-bdbc-5d4dbcfadcae",
    "principalDisplayName": "logic-origination-apply-bids (DEV)",
    "principalType": "ServicePrincipal",
    "appRoleValue": "Origination.Application",
    "environments": [
      "dev"
    ]
  },
  {
    "principalId": "79633ced-c6e4-4fea-b08b-c1fbe0c82981",
    "principalDisplayName": "logic-barchart-instr-page (QA)",
    "principalType": "ServicePrincipal",
    "appRoleValue": "Origination.Application",
    "environments": [
      "qa"
    ]
  },
  {
    "principalId": "9535f17c-c04d-4015-9ab6-ff34e083b7c7",
    "principalDisplayName": "logic-barchart-quotes (QA)",
    "principalType": "ServicePrincipal",
    "appRoleValue": "Origination.Application",
    "environments": [
      "qa"
    ]
  },
  {
    "principalId": "a54f2187-9dd0-40fc-b8c3-9e1d64f3b219",
    "principalDisplayName": "logic-origination-apply-bids (QA)",
    "principalType": "ServicePrincipal",
    "appRoleValue": "Origination.Application",
    "environments": [
      "qa"
    ]
  },
  {
    "principalId": "2e3d3429-862a-44fb-9866-8434fe1c17f0",
    "principalDisplayName": "logic-barchart-instr-page (UAT)",
    "principalType": "ServicePrincipal",
    "appRoleValue": "Origination.Application",
    "environments": [
      "qa"
    ]
  },
  {
    "principalId": "bbf66830-aea2-44aa-8ed6-923d4c4ac799",
    "principalDisplayName": "logic-barchart-quotes (UAT)",
    "principalType": "ServicePrincipal",
    "appRoleValue": "Origination.Application",
    "environments": [
      "qa"
    ]
  },
  {
    "principalId": "c9f3891e-5af3-4783-8972-e8ff10eafd8f",
    "principalDisplayName": "logic-origination-apply-bids (UAT)",
    "principalType": "ServicePrincipal",
    "appRoleValue": "Origination.Application",
    "environments": [
      "qa"
    ]
  }
]
```

**PROD — three grants, identities not yet supplied (AB#34913, 2026-10-09).** The integration team
needs the role on three PROD workflows only: `logic-barchart-instruments` (POST /instruments),
`logic-barchart-quotes` (GET /quote-batches, POST /quotes) and `logic-origination-apply-bids`
(POST /apply-bids). `logic-barchart-instr-page` and `logic-barchart-audit-rollup` do not call us in PROD,
although instr-page holds the role in the non-prod environments. The identities are created when the
apps deploy to PROD (subscription `scoular-iaa-prod`, resource group
`scoiaap-rg-use-integration-logicapps`); the apps deploy disabled, and the integration team's admin
applies the three assignments under their CR and pastes the object ids in the thread. Add one entry per
id here with `"environments": ["prod"]` so the grant is on record (see the next paragraph for why that
still matters). The PROD API registration (`e1458bcd-7212-4ea0-a836-7e08d03b5bbf`) holds only the iPaaS
identity until then. Agreed start for the PROD load: Tuesday 2026-10-13, after our PROD deploy of the
ingest endpoints is confirmed in the thread.

PROD can load before it publishes: `apply-bids` answers 200 and writes nothing while
`Barchart:ApplyBidsEnabled` is off, so all three workflows can run on schedule from the start.

No new app roles are needed — `Origination.Application` already exists in every environment as a
convention-based default. This is assignment only, which also avoids the trap where declaring a custom
`appRoles` array drops the roles that aren't re-listed.

**Record every assignment in this config, even one applied by hand in the portal.** The sync is add-only
for service principals (`Deploy-AppService.psm1`, checked 2026-10-09: it creates missing assignments and
skips existing ones; its only removal re-homes a *group* that sits on the wrong role), so a manual
Enterprise Application assignment is not undone by the next deployment. The integration team's admin
has applied grants that way for QA/UAT and will for PROD. The config entry is what keeps the grant
visible and reproducible; without it, a rebuilt registration would silently lose the integration —
which is already the case for `logic-barchart-instruments` in Dev, QA and UAT (granted by hand, not in
`app-config.json` as of 2026-10-09).

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

**State per environment (2026-09-17):**

| Our env | Reachable from the integration gateway? | Notes |
|---|---|---|
| Dev | **Yes** — proven | 37,180 / 37,180 loadInstruments calls succeeded on 2026-09-16 |
| QA | **Not yet** | The integration team has built the API config in their QA and UAT gateways pointing at `app-origination-qa-eus.azurewebsites.net`. What is missing is on OUR side: the private endpoint route and Private DNS resolution that let their QA/UAT gateway networks reach our QA App Service, the way DEV's already does. Raised with infra 2026-09-17. |
| Prod | Not started | |

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
