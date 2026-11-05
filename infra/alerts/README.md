# Data source alerts

Emails the dev team when Origination stops getting data. These are log search alerts on each environment's
App Insights (`appi-origination-<env>-eus`), so they need no app change: they read the failure lines the
API already writes.

| Alert | Fires when | Checked | Clears |
|---|---|---|---|
| **CTRM GraphQL is failing** | 5 or more `CTRM read failed` lines **and** 10% or more of CTRM GraphQL calls failed in the last 30 minutes. The email says whose side (below) | every 5 min | by itself, with an all-clear email |
| **Database is failing** | 3 or more requests or jobs hit a SQL failure in the last 15 minutes (ODS views or the Origination DB: connection, timeout, missing view/column, `*_DB_UNAVAILABLE`) | every 5 min | by itself, with an all-clear email |
| **CustomerSync did not run** | the customer sync logged an abort or a failed cycle (07:00 UTC daily, and 60 s after every app start) | every 15 min | close it by hand once a run succeeds; repeat emails muted for 1 hour |

Recipients (the dev team: Caden, Hope, Bailey) are the `alertEmailAddresses` list in each `azuredeploy.parameters.<env>.json`. To add someone,
add their address there and redeploy that environment.

### Why a ratio for CTRM

A count alone would email most days. Over 2026-10-06 → 11-05 QA logged CTRM read failures on 17 of 30
days, usually 2–6 scattered failures (single bad queries, HTTP 400) out of hundreds of calls, which is 0–2%.
Real outages are 10% or more: 2026-10-12 16:00Z was 16%, and 2026-11-05 (locked CTRM password) reached
100%. The threshold was back-tested against that month: it fires on 10-06/07/08 (go-live), 10-12 and
11-05 (first at 07:00Z during the nightly sync, hours before anyone signed in), and stays quiet on every
other day.

Over the same month the database rule would never have fired in QA and would have fired three times in
Dev, including the 10-06 dropped `dbo.CtrmSourceToggleUsers` table.

### Whose side: the `likelySide` value in the CTRM email

Each failure line already records what came back. The alert sorts them, and if 80% or more of the
failures in the window fall on one side it names that side:

| Label | What the app saw | What to do |
|---|---|---|
| **CTRM side (gateway or DB2)** | CTRM answered with "an internal error occurred", timed out on its end (`HC0045`), returned a server error, or throttled us | tell the CTRM API team (see below) |
| **Our side (sign-in, permissions or our query)** | we could not get a token, the gateway refused our identity (401/403), or CTRM rejected our query as invalid | ours to fix |
| **Cannot tell (gateway unreachable, or a mix)** | we could not reach the gateway at all (network, DNS, our timeout), or no side reached 80% | run the probe below |

Back-tested: 2026-11-05 (locked CTRM password), 2026-10-12, and the 10-06/07 go-live failures in QA all
read **CTRM side**; Dev on 2026-10-06, when the gateway could not be reached, reads **Cannot tell**.

### Where to see them in Azure

- **The rules:** portal → **Monitor** → **Alerts** → **Alert rules**, filter the resource group
  (`rg-origination-qa-eus`, `rg-origination-eus`, ...). Names start `alert-ctrm-failing-`,
  `alert-database-failing-`, `alert-customersync-failed-`.
- **What has fired:** **Monitor** → **Alerts** (the default view), or the Alerts panel on the Overview tab
  of the Origination Workbench workbook.
- **Who gets the email:** **Monitor** → **Alerts** → **Action groups** → `ag-devteam-<env>`.
- PROD needs the admin account (the regular account has no Reader on `rg-origination-eus`).

### Limits

- They see failures only when something calls the data source. Overnight in Dev and QA that is just the
  07:00 UTC CustomerSync (CTRM keep-warm is off), so an outage that starts at night is caught at 07:00 UTC
  or at the first sign-in.
- Data that stops refreshing without any error (for example an ODS table that is simply not updated)
  does not trip any of these.
- App Insights ingestion adds 2–5 minutes, so expect the email 5–10 minutes after failures start.

### When the CTRM alert fires

It is usually the CTRM gateway or DB2, not our code. Before suspecting a deploy, probe the gateway directly
with your own token (this is what proved the 2026-11-05 outage was CTRM-side):

```bash
TOKEN=$(az account get-access-token --resource "api://243ea5dc-2187-44aa-aa62-3d303608be53" --query accessToken -o tsv)
# POST a contracts query (skip 0, take 1, with a date range; see CtrmQueries.ContractsProbe) to
# https://apiqa.scoular.com/internal/graphql with "Authorization: Bearer $TOKEN".
```

If `{ __typename }` answers but `contracts` returns "An internal error occurred", the gateway owns it.
For the Test gateway (Dev and QA) ask Titus to check the CTRM Test GraphQL gateway.

### Deploy

Run **Data Source Alerts Deploy** from the Actions tab, pick the environment, `what-if` first, then
`create`. It uses that environment's OIDC identity (Monitoring Contributor on the resource group).

Local preview against Dev (read-only):

```bash
az deployment group what-if -g rg-origination-dev-eus --subscription scoular-apps-nonprod \
  --template-file infra/alerts/data-source-alerts/azuredeploy.json \
  --parameters @infra/alerts/data-source-alerts/azuredeploy.parameters.dev.json
```

After the first deploy, open the action group `ag-devteam-<env>` in the portal and use **Test action group**
to confirm the emails arrive. New recipients may get a one-time Azure Monitor email asking them to confirm
their address.
