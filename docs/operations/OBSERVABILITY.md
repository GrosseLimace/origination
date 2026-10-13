# Observability: what Origination emits, where it lands, what watches it

Written 2026-10-13 from the repository and a read-only check of the Dev and QA Azure resources.
Production values were not readable with a standard account and are marked **unconfirmed**;
check them with an admin account (see the last section) and update this file.

---

## How telemetry gets to Azure

**The API has no Application Insights SDK.** Nothing in `GrainOriginatorPortal.Api` references it.
Telemetry is collected by **App Service auto-instrumentation**: the web app carries the
`ApplicationInsightsAgent_EXTENSION_VERSION` setting, and the agent captures requests, dependencies,
exceptions and `ILogger` output without code changes. Its connection string is the app setting
`APPLICATIONINSIGHTS_CONNECTION_STRING`, set on the App Service, never in the repo.

**The Angular client sends nothing.** There is no browser telemetry; a client-side failure that the
server never sees leaves no trace in Azure. That is the open audit finding
`logging.client-side-telemetry-missing`. The canonical pattern for adding it already exists in
`developer-docs/CLAUDE.md` (Client-side App Insights: wrapper service, MSAL event forwarder, and
the CSP allow-list the SDK needs).

| | Dev | QA | Production |
|---|---|---|---|
| Application Insights resource | `appi-origination-dev-eus` | `appi-origination-qa-eus` | unconfirmed |
| Mode | workspace-based (Log Analytics) | workspace-based | unconfirmed |
| Retention | 90 days | 90 days | unconfirmed |
| Ingestion sampling | none set (100% ingested) | none set | unconfirmed |
| Auto-instrumentation agent | on | on | unconfirmed |

## Sampling

No sampling is configured anywhere we control. The Application Insights resources have no
ingestion sampling percentage, and neither the repo nor the web app's settings set an SDK or agent
sampling override, so whatever the auto-instrumentation agent does by default is what happens.
Do not assume every request is retained. Measure it instead:

```kql
// Effective retention of request telemetry over the last day. 100 = nothing sampled out.
requests
| where timestamp > ago(1d)
| summarize RetainedPercent = round(100.0 / avg(itemCount), 1), Rows = count(), Represented = sum(itemCount)
```

If that reads below 100, counts in every other query must use `sum(itemCount)` rather than `count()`.

## The operations workbook

One shared workbook, **Origination Workbench**, hosted in the Dev resource group and reading every
environment the viewer can see.

- Source: `infra/workbooks/origination-workbench/` — edit `build-workbook.mjs`, run
  `node infra/workbooks/origination-workbench/build-workbook.mjs`, commit the regenerated
  `origination-workbench.workbook.json`.
- Deploy: the `deploy-workbook.yml` workflow (one workflow, not one per environment).
- Tabs: **Overview** (requests and failures over time, top failing endpoints, slowest endpoints at
  p95, alerts in the last 30 days, web app and TLS status, latest deployment, latest CustomerSync
  run), **Deployments**, **Logic Apps** (Daily Digest and Instant Share run history),
  **Background jobs** (CustomerSync runs including the mass-deactivation guard, its schedule, usage
  rollups, usage tracking, retention, CTRM keep-warm), **Integrations** (outbound dependency calls,
  failure rate and latency), **Activity** (restarts, config changes, deployments, Logic App edits).

The workbook's queries are the team's saved KQL. Read them in `build-workbook.mjs` rather than
copying them here, so there is one copy.

## Alerts

| Alert | Fires when | Severity | Who hears | Defined in |
|---|---|---|---|---|
| Failure Anomalies (smart detection), one per environment | Application Insights sees an abnormal rise in failed requests | platform default | the resource's smart-detection action group | Azure, not the repo |
| `alert-<logic app>-runs-failed`, for the Daily Digest and the Instant Share Logic Apps in each environment | any failed run in a 5-minute window | 2 | email: CEgr@scoular.com, HCollins@scoular.com | `infra/logic-apps/*/azuredeploy.json` and its per-environment parameter files |

Verified present in Dev and QA on 2026-10-13. **There is no alert on the API itself beyond Failure
Anomalies**: no alert on CTRM read failures, CTRM latency, CustomerSync failure or deactivation
counts, or 5xx rate. Those are visible in the workbook but nobody is paged for them.

## Log lines worth knowing

- CTRM reads log one line per producer click, with the read time on the end:
  `CTRM contracts: N for producer X (live, all dates) in Nms.` and
  `CTRM tickets: N rows for producer X (…) in Nms.` A failed read logs
  `CTRM contracts unavailable [...]: <Status> - <Detail> (after Nms)`. These are the only record of
  CTRM latency in Production, where the `Server-Timing` and `X-Data-Source-*` headers are not sent.
- CTRM keep-warm cycles and the customer sync carry a per-run `TraceId` in their log scope, so one
  run's lines can be isolated in Log Analytics.
- Background failures on the producer page are reported to the user as a toast and logged to the
  browser console in dev builds only. With no client telemetry, they never reach Azure.

## Gaps, and what to confirm

1. **Production values.** With an admin account, confirm the production row of the table above:
   ```
   az resource show --subscription <prod> -g rg-origination-eus -n <appi name> \
     --resource-type microsoft.insights/components \
     --query "{sampling:properties.SamplingPercentage, retentionDays:properties.RetentionInDays}"
   ```
   and that the production web app has `ApplicationInsightsAgent_EXTENSION_VERSION`.
2. **Shared workspace.** Dev's Application Insights writes to the subscription's
   `DefaultWorkspace-…-EUS` in `DefaultResourceGroup-EUS`, not a workspace owned by this app.
   Retention and access are therefore governed by that shared workspace.
3. **Client telemetry** is missing entirely (open finding, critical).
4. **No API alerting** beyond Failure Anomalies; see the Alerts section.
