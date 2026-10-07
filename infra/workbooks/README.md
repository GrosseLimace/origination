# Azure Monitor Workbooks

## Origination Workbench — Operations (`origination-workbench/`)

One shared workbook, hosted in `rg-origination-dev-eus`, that reads **every environment the viewer has
Reader on** through an Environment picker (Production is the default when visible). It exists for the
things App Insights and the app do not show on their own:

| Tab | Panel | Source | Why it is here |
|---|---|---|---|
| Overview | At a glance (6 tiles) · requests/failures chart · top failing endpoints · slowest endpoints | App Insights `requests`, `exceptions`, `dependencies` | The quick read for the selected time range |
| Overview | Web app (state, runtime, config changed) | ARM `GET sites/{app}` | One-glance "is it up, what stack" |
| Overview | TLS certificate (hosts, issuer, days left) | Resource Graph `microsoft.web/certificates` | The Let's Encrypt renewal is automated; nobody watches it |
| Overview | Alerts, last 30 days | Resource Graph `alertsmanagementresources` | Fired / resolved alerts for this RG in one list |
| Overview | Latest deployment · latest CustomerSync run · last 3 Logic App runs | as below, row-limited | The "is everything normal" strip |
| Deployments | App deployments, newest first | ARM `GET sites/{app}/deployments` | When it was deployed and whether it is the live slot |
| Logic Apps | Daily Digest / Instant Share runs | ARM `GET workflows/{name}/runs` | Run history without opening each one |
| Background jobs | CustomerSync runs, parsed | App Insights `traces` + `exceptions` | The mass-deactivation guard from the outage playbook, as numbers |
| Background jobs | CustomerSync schedule | App Insights `traces` | The next scheduled run, from the service's own log line |
| Background jobs | Other background jobs | App Insights `traces` + `exceptions` | Usage rollups, retention, CTRM keep-warm outcomes |
| Integrations | Integrations, grouped by target | App Insights `dependencies` | ODS / Origination DB / CTRM / Graph failure rate and p95 per integration |
| Activity | Azure activity in this resource group | ARM activity log `eventtypes/management/values` | Who restarted, reconfigured, deployed or edited what |
| (always) | Go deeper | Link lists | Failures, Performance, Live Metrics, Logs, Log stream, Usage Dashboard, Actions |

The Overview summarises request health in a few numbers; the full App Insights blades and the in-app Usage Dashboard (adoption) are **linked, not re-implemented**.

### Files

| File | Role |
|---|---|
| `origination-workbench.workbook.json` | The workbook body (Notebook/1.0). **This is what gets deployed.** |
| `build-workbook.mjs` | Generator for the JSON above. Keeps the nested ARM query strings escaped correctly. |
| `build-parameters.mjs` | Wraps the workbook JSON into the `serializedData` parameter for ARM. Run by the workflow. |
| `azuredeploy.json` | ARM template for the `Microsoft.Insights/workbooks` resource. Takes the body as the `serializedData` parameter. |
| `azuredeploy.parameters.json` | Static parameters (display name, Environment tag). |
| `azuredeploy.parameters.generated.json` | Built by the workflow from the workbook JSON. Git-ignored. |

### Deploy

Run **Operations Workbook Deploy** from the Actions tab: `what-if` to preview, `create` to deploy. It
targets the Dev resource group with the non-prod OIDC identity; there is no QA or PROD variant because
the one workbook already spans all three.

Local preview (read-only) works too, with the same steps the workflow runs:

```bash
node infra/workbooks/origination-workbench/build-parameters.mjs
az deployment group what-if -g rg-origination-dev-eus --subscription scoular-apps-nonprod \
  --template-file infra/workbooks/origination-workbench/azuredeploy.json \
  --parameters @infra/workbooks/origination-workbench/azuredeploy.parameters.json \
  --parameters @infra/workbooks/origination-workbench/azuredeploy.parameters.generated.json
```

### Editing

- **Small change:** edit `build-workbook.mjs`, run `node infra/workbooks/origination-workbench/build-workbook.mjs`, commit both files.
- **Iterating in the portal:** open the workbook → Edit → Advanced Editor, change it there, then paste the
  JSON back over `origination-workbench.workbook.json`. Update `build-workbook.mjs` to match before the
  next generator run, or the portal edits get overwritten.
- Portal links use the Scoular tenant id so they open in the right directory. Parameter tokens such as
  `{AppInsights}` are filled in by the workbook at view time.

### Known limits

- A reader sees only the environments they hold **Reader** on. Without Reader on `rg-origination-eus`
  the Environment picker offers Dev and QA only.
- The CustomerSync and job panels read Information-level traces. App Service auto-instrumentation has
  not been proven to forward those in every environment (open audit item
  `logging.api-insights-instrumentation-unverified`). If a panel stays empty after a known run, that is the
  cause — the panel's empty-state message says so.
- The running commit is not in the deployment record (`azure/webapps-deploy` writes only "OneDeploy").
  The app shows it under the profile menu via `/api/version`, which is authenticated and therefore not
  queryable from the workbook.
