# Origination — Outage Recovery Playbook

**Use this when** the network between the data center and Azure (ExpressRoute / SD-WAN / Prisma) has been down or unstable and Infrastructure says it's coming back. Work through it **before telling the business Origination is good to use.**

**How to use it:**
1. Start with the [one-page checklist](#one-page-checklist). Each line links to its details.
2. Every check in the details says **Check → How → Pass → If it fails**.
3. When you're done, add a row to the [incident log](#incident-log). If something was missing or wrong, fix this doc while it's fresh.

> Names below are **PROD**. For Dev/QA swap the suffix `-eus` → `-dev-eus` / `-qa-eus`, and the SQL server `azrscosqlp01` → `azrscosqld01` / `azrscosqlq01`.

---

## One-page checklist

Tick in order. **Don't skip ahead:** step C must pass before anyone restarts the app or runs the sync.

| ✅ | Step | Check | Details |
|---|---|---|---|
| ☐ | **A. During the outage** | Nobody restarts / redeploys the app. Outage start time written down. Nightly sync disabled if the outage runs toward 2 AM. | [§2](#2-during-the-outage--do-not) |
| ☐ | **B. Reachability** | DNS resolves privately. `/health/live` and `/health/ready` are Healthy **from office, VPN and a remote site**. | [Step B](#step-b--can-people-reach-it) |
| ☐ | **C. ODS data** | ODS team confirms the overnight load finished. Row counts and the stored-grain run date look normal. | [C1](#c1-ods-data-is-complete-and-current) |
| ☐ | **C. Producers** | No mass deactivation by the customer sync (or reversed). | [C2](#c2-the-customer-sync-didnt-deactivate-producers) |
| ☐ | **D. Smoke test** | 12 screens/actions pass as a normal originator. | [Step D](#step-d--does-the-app-work-smoke-test) |
| ☐ | **E. Jobs** | Customer sync's latest run succeeded. Usage rollups backfilled if the outage crossed midnight. | [E1](#e1-customer-sync-in-app-daily), [E2](#e2-usage-aggregation-in-app-hourly) |
| ☐ | **E. Logic Apps** | Instant Share and Daily Recap runs are succeeding. Failed outage-window runs listed. | [E3](#e3-instant-share-note-logic-app), [E4](#e4-notes-daily-recap--daily-digest-logic-app) |
| ☐ | **E. Other** | Outlook reminders gap counted. CI runner picks up a job. eSign feed updating. | [E5](#e5-outlook-reminders), [E6](#e6-cicd-runners), [E7](#e7-esign-enrollment-feed-dataverse--power-automate) |
| ☐ | **F. Hand back** | Nightly sync re-enabled if disabled. Business message sent. Incident log filled in. | [Step F](#step-f--sign-off-and-hand-back) |

---

## Before you start: access, tools, contacts

**Sort this out on a normal day, not mid-outage.** Most of the checks are impossible without it.

### Access you need

| Access | Used for | How to confirm you have it |
|---|---|---|
| Corporate network or VPN | Everything. The app is private-endpoint only. | You can open `https://origination.scoular.com` |
| **Admin** app role on the PROD Origination API | Running the customer sync / usage backfill ([Appendix A1](#a1-call-an-admin-endpoint-in-prod)) | Usage Dashboard shows the whole-org view for you |
| Read access to PROD SQL `azrscosqlp01`, databases **ODS** and **Origination** | Data checks in Step C and E | You can connect in SSMS / Azure Data Studio ([A2](#a2-run-the-sql-checks)) |
| Azure portal **Reader** on `rg-origination-eus` | Logic App run history, App Service log stream, App Insights | You can open `logic-origination-instant-share-note-eus` → Runs history. ⚠ On 2026-09-25 the main developer account got `AuthorizationFailed` reading this resource group, so request it before the next outage. |
| Logic App **Contributor** (or someone who has it) | Resubmitting failed Logic App runs | Resubmit button is enabled |
| App Service config write (or someone who has it) | Disabling/re-enabling the nightly sync ([§2](#2-during-the-outage--do-not)) | Can edit App Settings on `app-origination-eus` |

### Tools

- A browser with dev tools (Edge/Chrome).
- SSMS or Azure Data Studio.
- PowerShell 7+ (for [A1](#a1-call-an-admin-endpoint-in-prod)).

### Contacts

Fill these in. Names in brackets come from past work, so confirm them.

| Who | For | Name / channel |
|---|---|---|
| Infrastructure / network | "Is the network actually back, on all paths?" | _(on the outage email distribution)_ |
| ODS / data team | "Did the CTRM → ODS overnight load finish?" | _fill in_ |
| Azure platform (App Service config, Key Vault, grants) | Disabling the sync, startup failures | _(Charles)_ |
| eSign Power Automate flow owner | Dataverse → `ESignEnrollment` feed ([E7](#e7-esign-enrollment-feed-dataverse--power-automate)) | _fill in_ |
| Integration team | BarChart / Logic App feeds they own (once merged, see [§G](#g-coming-soon--update-this-playbook-when-these-merge)) | _fill in_ |
| CTRM | CTRM-side questions (once GraphQL is live) | _(Lyle)_ |
| Business contact for the "all clear" | Who receives the hand-back message | _fill in_ |

---

## 1. What an outage like this actually breaks

Origination runs **entirely in Azure**: App Service, Azure SQL (ODS, Origination and TradeUnitPreferences are all on `azrscosqlp01`), Key Vault, Entra, Graph, Logic Apps, Azure OpenAI. It has **no direct connection to the data center**. The outage breaks what's *around* it:

| Path | Why it matters | What users see |
|---|---|---|
| **Users → app** | Private endpoint only. Office / VPN traffic reaches it over ExpressRoute. | Site won't load, or works for some people and not others depending on their route |
| **Data center → ODS load** | ODS lives in Azure but is *fed* overnight from CTRM on the AS/400. That load isn't ours. | Contracts, tickets, stored grain, DP contracts go **stale** (no error). A half-finished load can leave views **partial or empty**. |
| **ODS → our customer sync** | Copies `originations.vw_CustomerTradeUnits` into the app DB. | ⚠ Producers disappear from lists ([§2](#2-during-the-outage--do-not)) |
| **CI/CD runners** | Self-hosted on the corporate network | Deploys fail or hang |
| **DNS** | Names resolve via the Private DNS Resolver `10.102.1.10` | Names don't resolve, or resolve to public IPs the firewall blocks |

**Not affected by the data-center link** (unless Azure itself is down): Entra sign-in, Microsoft Graph, Logic App triggers, Azure OpenAI, App Insights.

---

## 2. During the outage — DO NOT

Tell anyone who might touch the app.

- ☐ **Don't restart, scale or redeploy the App Service** until [C1](#c1-ods-data-is-complete-and-current) passes.
  - **Why:** every app start runs a full customer sync **60 seconds later**. The sync soft-deactivates every producer and trade-unit link missing from `vw_CustomerTradeUnits`, and it has **no guard against an empty or partial view**. Producers vanish from originators' lists until a good sync brings them back.
  - Azure can also restart the app on its own during recovery. That's why [C2](#c2-the-customer-sync-didnt-deactivate-producers) is **always** run.
- ☐ **Don't run the customer sync by hand** until C1 passes. Same reason.
- ☐ **Don't dispatch deploy workflows.** The runners may not reach Azure. A half-finished run can apply DB migrations without deploying the matching code.
- ☐ **Write down the outage start time** (Central). You need it for the notes and recap catch-up.
- ☐ **The nightly sync runs at 07:00 UTC** (2:00 AM CDT / 1:00 AM CST). If the outage is still going heading into that time, or ODS reloads are in progress, disable it:
  - **How:** Portal → `app-origination-eus` → Settings → Environment variables → set `CustomerSync__RunAtTimeUtc` = `0` → Apply.
  - This restarts the app **with the sync off**, so the startup run is skipped too.
  - Re-enable it in [Step F](#step-f--sign-off-and-hand-back).

---

## Step B — Can people reach it?

Run B1–B3 from **each network path**: office LAN, Prisma VPN, and a remote site if you can reach someone there. On 2026-09-25, routing was fixed piecemeal, so one path working proves nothing about the others.

### B1. DNS resolves to the private endpoint
- **How:** PowerShell: `Resolve-DnsName origination.scoular.com`
- **Pass:** a private `10.x` address (PROD inbound subnet `10.102.25.48/28`).
- **If it fails:** a public IP or no answer means a DNS or routing problem. Send it back to Infrastructure with the path you tested from.

### B2. The app process is up
- **How:** browse `https://origination.scoular.com/health/live`. No sign-in needed.
- **Pass:** `Healthy`.
- **If it fails:** if the network is confirmed up but this fails, the app may have failed to start. On App Service a **Key Vault failure at startup is fatal**. Check the log stream for a startup exception ([A4](#a4-read-app-logs)) and contact Azure platform.

### B3. The databases are reachable
- **How:** browse `https://origination.scoular.com/health/ready`.
- **Pass:** `Healthy`.
- **If it fails:** 503 means a database is down. In the output, **`origination_db` is actually ODS** and **`application_db` is the Origination DB**. This check does **not** cover the TradeUnitPreferences DB, so D2 catches that one.

**Slow first load?** Azure SQL is serverless with a 60-minute auto-pause. After a long outage the first query has to wake the database up. One slow load followed by normal ones is fine.

---

## Step C — Is the data right?

### C1. ODS data is complete and current
- **Check:** the overnight CTRM → ODS load finished after the outage.
- **How:**
  1. **Ask the ODS/data team** to confirm the load finished. Get a yes/no, not "should be fine".
  2. Run these against **ODS** ([A2](#a2-run-the-sql-checks)):
     ```sql
     -- a) Customer sync source: compare with the baseline (Appendix C)
     SELECT COUNT(*) AS Rows, COUNT(DISTINCT CustomerId) AS Customers
     FROM originations.vw_CustomerTradeUnits;

     -- b) Stored grain load date: should be the latest business day
     SELECT MAX(REPORT_RUN_STAMP) AS LatestStoredGrainRun FROM ctrm.vw_GNTA39D1;
     ```
  3. In the app, open a producer you know had a ticket or contract **yesterday** and confirm it's there.
- **Pass:** the ODS team confirms; counts are within a few % of the baseline (not 0, not half); the run date is current; the spot-check producer shows the recent activity.
- **If it fails:** **stop.** Don't restart the app or run the sync. The app will show stale data until the ODS team re-runs their load. Tell the business "contract/ticket data is as of <date>" if they need the app anyway.

### C2. The customer sync didn't deactivate producers
Run this **every time**, even if nobody restarted anything. The 07:00 UTC run or an Azure-initiated restart may have happened mid-outage.

- **How:** run against the **Origination** DB:
  ```sql
  -- Trade-unit links the sync deactivated recently (widen the window to cover the outage)
  SELECT CAST(ModifiedAt AS date) AS Day, COUNT(*) AS Deactivated
  FROM dbo.CustomerTradeUnit
  WHERE IsActive = 0 AND ModifiedBy = 'system'
    AND ModifiedAt >= DATEADD(DAY, -3, SYSUTCDATETIME())
  GROUP BY CAST(ModifiedAt AS date)
  ORDER BY Day;

  -- Active counts: compare with the baseline (Appendix C)
  SELECT COUNT(*) AS ActiveCustomers      FROM dbo.Customer          WHERE IsActive = 1;
  SELECT COUNT(*) AS ActiveTradeUnitLinks FROM dbo.CustomerTradeUnit WHERE IsActive = 1;
  ```
- **Pass:** no spike in deactivations on outage days (compare with the "typical" baseline); active counts match the baseline.
- **If it fails:** make sure C1 passes, then run the sync again ([A1](#a1-call-an-admin-endpoint-in-prod), `customer-sync/run`). It reactivates everything that's back in the view. Re-run these queries to confirm.

### C3. Schema is intact (only if a deploy was running when it hit)
- **How:** run `scripts/_VerifySchema.sql` against the Origination DB.
- **Pass:** one row: "Database is current".
- **If it fails:** don't re-run the deploy blindly. Talk to the team first. Migrations run *before* the app deploy, so the DB may be ahead of the code.

---

## Step D — Does the app work? (smoke test)

Sign in as a **normal originator**, not an admin, if you can. Screenshot any error toast.

| # | Do this | Pass | If it fails, it's probably… |
|---|---|---|---|
| D1 | Sign in | Lands on Home, no login loop | Entra. Or the user's browser: close all Origination tabs and reopen. |
| D2 | Home: producer list loads for your trade units | List populates | **TradeUnitPreferences DB** if you see `ENTITLEMENTS_DB_UNAVAILABLE` (503). Origination DB otherwise. |
| D3 | Open a producer: Contracts, Tickets, Stored Grain, DP Contracts, Planting Intentions tabs | All load with recent data | ODS (see C1) |
| D4 | eSign badge shows on a producer you know is enrolled | Badge present | The Dataverse → Power Automate feed into `dbo.ESignEnrollment`, see [E7](#e7-esign-enrollment-feed-dataverse--power-automate) |
| D5 | Producer map: pins appear for producers with addresses | Pins drawn, map tiles load | Pins: geocoding calls the public OpenStreetMap service from the server (Nominatim). Tiles: the browser can't reach openstreetmap.org / Esri. |
| D6 | Add a note and @-mention yourself | Saves. Email arrives in ~3–5 min. | Origination DB (save) or Instant Share Logic App (email), see [E3](#e3-instant-share-note-logic-app) |
| D7 | @-mention a Teams channel on a note | Channel post arrives | Graph or Instant Share Logic App |
| D8 | Create a reminder with **Add to Outlook** | Event appears in your Outlook | Graph (the reminder still saves without it) |
| D9 | Bid Sheet opens and a test edit saves | Loads and saves | ODS / Origination DB |
| D10 | Usage Dashboard (admin/manager) | Loads | See [E2](#e2-usage-aggregation-in-app-hourly) for expected gaps |
| D11 | Trade Unit Preferences link opens | TUP app loads | The TUP app itself, which has its own owner |
| D12 | What's New (header) shows the expected release | Matches the last PROD deploy | Something got rolled back or redeployed |

**Error codes you might see** (toasts, dev tools, App Insights). Each means a dependency is down, not an app bug:

| Code | Dependency |
|---|---|
| `ENTITLEMENTS_DB_UNAVAILABLE` | TradeUnitPreferences DB |
| `INFRASTRUCTURE_DATABASE_UNAVAILABLE`, `CUSTOMERS_DB_UNAVAILABLE`, `CONTRACTS_DB_UNAVAILABLE`, `TICKETS_DB_UNAVAILABLE`, `PRODUCER_DETAILS_DB_UNAVAILABLE` | ODS / Origination DB |
| `INFRASTRUCTURE_GRAPH_UNAVAILABLE` | Microsoft Graph |
| `INFRASTRUCTURE_GEOCODE_UNAVAILABLE` | OpenStreetMap geocoding |

**One toast can hide several failures.** Home toasts are throttled to one per minute overall and one per source every 5 minutes, so users aren't flooded during an outage. If a screen looks thin, open dev tools → Network and look for red `/api/…` rows.

---

## Step E — Jobs and feeds

### E1. Customer sync (in-app, daily)
- **Runs:** 07:00 UTC daily **and** 60 s after every app start. Config `CustomerSync:RunAtTimeUtc`.
- **Check:** the most recent run completed.
- **How:** search the logs for `CustomerSync` ([A4](#a4-read-app-logs), or the first KQL query in [Appendix B](#appendix-b--app-insights-queries)).
- **Pass:** `CustomerSync completed in {ms} ms. Customers: … inserted, … deactivated …`, with a small deactivated count.
- **If it fails:** a failed run logs `CustomerSync {Reason} cycle failed — will retry at next scheduled run`. **There's no retry until tomorrow.** Once C1 passes, run it manually ([A1](#a1-call-an-admin-endpoint-in-prod)). No last-run table exists, so logs and `CustomerTradeUnit.ModifiedAt` are the only evidence.

### E2. Usage aggregation (in-app, hourly)
- **Check:** the Usage Dashboard has no missing days.
- **Why:** the job only aggregates **yesterday**, and it tracks its progress in memory. **If the outage crossed midnight, the missed days never get filled in on their own.**
- **How to fix:** run `usage-rollups/backfill?days=N` ([A1](#a1-call-an-admin-endpoint-in-prod)), with N = days back to cover the outage (max 90). Safe to re-run; it's a full recompute.
- **Expected:** a dip in usage for the outage window. Raw usage tracking that failed during the outage is dropped, not queued. That's not a bug.

### E3. Instant Share Note (Logic App)
- **What it does:** `logic-origination-instant-share-note-eus` polls `dbo.Notes` for new rows every 3 min and sends @-mention emails and Teams channel posts.
- **How:** Portal → the Logic App → **Runs history** ([A3](#a3-check-a-logic-app)).
- **Pass:** recent runs are **Succeeded**. If anyone created notes during the outage, those went out as a backlog once the trigger recovered, because it tracks the last `Notes.Id` it saw.
- **If it fails:** sends have **no retry**, so a Failed run means that notification was never sent. Resubmit it ([A3](#a3-check-a-logic-app)) or list the note authors so the business can tell them. Only **new** notes are watched; mentions added by editing a note never send, outage or not.

### E4. Notes Daily Recap / Daily Digest (Logic App)
- **What it does:** `logic-origination-notes-daily-recap-eus` runs daily at **18:00 Central**. It summarizes notes with Azure OpenAI and emails the summary from `OriginationsApp@scoular.com`.
- **How:** Runs history ([A3](#a3-check-a-logic-app)). Did the 18:00 run on each outage day succeed?
- **If it failed:** there's **no automatic catch-up**. The recap covers "the 24 h before *the run time*", so a re-run at 10:00 the next morning covers 10:00→10:00, not the missed window. Some notes would be skipped or sent twice.
  - **Usually better:** let tonight's 18:00 run happen and tell recap recipients which day was missed.
  - A run with no notes still shows Succeeded. That's normal.

### E5. Outlook reminders
- **What happens:** there's no background job. The Outlook event is created when the user saves. If Graph was unreachable, the reminder **still saved**, just without an Outlook event.
- **How:** count the affected reminders against the Origination DB:
  ```sql
  SELECT COUNT(*) AS RemindersWithoutOutlookEvent
  FROM dbo.ProducerReminders
  WHERE OutlookEventId IS NULL AND CreatedAt >= '<outage start, UTC>';
  ```
- **Fix:** users click **Add to Outlook** on their reminder. Mention it in the business message if the count isn't zero.

### E6. CI/CD runners
- **How:** manually run **PR Validation** (`ci.yml`) from GitHub Actions, or wait for the scheduled `e2e.yml` (07:00 UTC weekdays).
- **Pass:** a self-hosted runner picks the job up and it goes green.
- **Don't** deploy just to prove the runners work.

### E7. eSign enrollment feed (Dataverse → Power Automate)
- **What it does:** eSign status comes from **Dataverse**. A **Power Automate flow** copies it into the Origination DB table `dbo.ESignEnrollment`, and the app reads that table for the eSign badge. The flow isn't in this repo.
- **How:**
  1. Check the table is still being updated (Origination DB):
     ```sql
     SELECT MAX(UpdatedOn) AS LastESignUpdate, COUNT(*) AS Rows,
            SUM(CASE WHEN ESignEnabled = 1 THEN 1 ELSE 0 END) AS Enabled
     FROM dbo.ESignEnrollment;
     ```
  2. Ask the flow owner to check the flow's **run history** in Power Automate for failures during the outage.
- **Pass:** `LastESignUpdate` is recent for how often the flow runs, row counts match the baseline, and the flow's runs after the outage succeeded.
- **If it fails:** the badge just shows stale status. Nothing in Origination breaks. The flow owner re-runs the flow. If the flow reaches Azure SQL through an **on-premises data gateway**, that gateway sits on the data-center side and will fail during an ExpressRoute outage. Confirm how it connects (see [Open questions](#open-questions)).

---

## Step F — Sign-off and hand back

Tick **all** before telling the business:

- ☐ Step B passes from **every** network path
- ☐ C1: the ODS team confirmed the load, and the numbers check out
- ☐ C2: no mass deactivation, or it's been reversed
- ☐ D1–D9 pass as a normal originator
- ☐ E1: the latest customer sync completed
- ☐ E2: rollups backfilled if the outage crossed midnight
- ☐ E3/E4: Logic Apps succeeding; failed outage-window runs listed
- ☐ E7: eSign feed updating again (or its owner is on it)
- ☐ `CustomerSync__RunAtTimeUtc` set back to **`07:00`** if you disabled it
- ☐ Incident log row filled in

**Business message.** Say what's back, then list what users should know. Pick the lines that apply:

> Origination is available again as of **<time>**.
> - Contract, ticket and stored-grain data is current as of **<ODS load date>**.
> - If you saved notes, reminders, bid sheet edits or planting intentions between **<start>** and **<end>**, check they're there. Some saves may have failed during the outage.
> - @-mention emails / Teams posts between **<start>** and **<end>** may not have been delivered. Please re-send important ones.
> - The Daily Recap for **<day>** wasn't sent.
> - If reminders you created during the outage aren't in Outlook, open the reminder and click **Add to Outlook**.
> - If the site won't sign you in, close all Origination tabs and open it again.

---

## Appendix A — How-to

### A1. Call an admin endpoint in PROD
There's **no button** for these, and Swagger is Dev-only. You need the **Admin** app role and the corporate network or VPN.

1. Open `https://origination.scoular.com` and sign in.
2. Open dev tools (F12) → **Network**. Click any request to `/api/…` → **Headers** → copy the **`Authorization`** value **after** `Bearer `.
3. In PowerShell:
   ```powershell
   $token = Read-Host 'Paste token' -MaskInput
   $h = @{ Authorization = "Bearer $token" }

   # Customer sync. ONLY after C1 passes.
   Invoke-RestMethod -Method Post -Headers $h -Uri 'https://origination.scoular.com/api/diagnostics/customer-sync/run'

   # Usage rollup backfill. Set days to cover the outage.
   Invoke-RestMethod -Method Post -Headers $h -Uri 'https://origination.scoular.com/api/diagnostics/usage-rollups/backfill?days=3'
   ```
4. The sync returns inserted / updated / reactivated / deactivated counts. Sanity-check them.

**Notes:**
- The token is a credential. **Never paste it into Teams, email or tickets.** It expires in about an hour.
- A **403** means you don't have the Admin role.
- If the sync takes longer than ~4 minutes, App Service gives up on the request and returns a **502**. The sync may or may not have finished. Don't re-run it immediately. Check the logs for `CustomerSync completed` first ([A4](#a4-read-app-logs)), then re-run the C2 queries.

### A2. Run the SQL checks
- SSMS or Azure Data Studio → server `azrscosqlp01.database.windows.net` → Authentication **Microsoft Entra MFA** → pick database **ODS** or **Origination** as each query says.
- All queries in this doc are **read-only**.

### A3. Check a Logic App
1. Portal → search the Logic App name → **Overview** → **Runs history**.
2. Filter by status **Failed** and by the outage time range.
3. Click a run to see which step failed.
4. **Resubmit** re-runs it with the same input. It's safe for Instant Share (it re-sends that one notification). **Don't** resubmit the Daily Recap without reading [E4](#e4-notes-daily-recap--daily-digest-logic-app).

### A4. Read app logs
- **Live:** Portal → `app-origination-eus` → **Log stream**. You can also use Kudu, or the `/azure-log` skill.
- **History:** Portal → App Insights `appi-origination-eus` (name unverified) → **Logs**, then use [Appendix B](#appendix-b--app-insights-queries).
- Two caveats:
  - The `/azure-insights` CLI has been blocked by the corporate proxy from laptops, so use the portal.
  - App Insights here comes from App Service auto-instrumentation, so **Information-level** lines like `CustomerSync completed` may not be captured. If a query comes back empty, use the log stream.

---

## Appendix B — App Insights queries

```kusto
// Customer sync runs, last 3 days
traces
| where timestamp > ago(3d)
| where message startswith "CustomerSync"
| project timestamp, severityLevel, message
| order by timestamp desc

// Which dependency is failing?
dependencies
| where timestamp > ago(6h) and success == false
| summarize failures = count() by target, type, resultCode
| order by failures desc

// 5xx rate over time: watch it fall back to normal as routing recovers
requests
| where timestamp > ago(12h)
| summarize total = count(), failed = countif(toint(resultCode) >= 500) by bin(timestamp, 10m)
| extend failRate = round(100.0 * failed / total, 1)
| order by timestamp asc
```

---

## Appendix C — Baseline numbers

Fill this in on a **normal** day so recovery checks have something to compare against. Refresh it quarterly.

| Metric | Query | PROD value | Date captured |
|---|---|---|---|
| `vw_CustomerTradeUnits` rows | C1 (a) | | |
| `vw_CustomerTradeUnits` distinct customers | C1 (a) | | |
| Active `dbo.Customer` | C2 | | |
| Active `dbo.CustomerTradeUnit` | C2 | | |
| Typical daily sync deactivations | C2 | | |
| `ESignEnrollment` rows / enabled | E7 | | |
| Customer sync duration | `CustomerSync completed in …` log | | |

---

## G. Coming soon — update this playbook when these merge

These are on unmerged branches today. Each one adds a data-center dependency, so add checks for them when they ship.

| Change | What to add |
|---|---|
| **CTRM GraphQL** (`Ctrm:Source=ctrm`; PROD move planned 2026-09-29) | Contract and ticket reads go **live** to CTRM (Db2 on-prem) through APIM `api.scoular.com`, so an ExpressRoute outage breaks those screens outright instead of just making them stale. Add: an APIM reachability check, a `CTRM keep-warm` log check, and the fallback "set `Ctrm:Source` back to `ods`". |
| **BarChart cash-bid feed** | The integration team's Logic Apps (`logic-barchart-quotes`, `logic-origination-apply-bids`, …) POST to `/api/barchart-ingest/*`. Add: confirm the daily quote run succeeded and re-run it if not (safe to re-run). Check `BarchartApiCallAudit` for gaps. |
| **Mobile PWA** | The service worker caches API data (up to a day for some groups), so phones may show stale data after recovery. Add "close and reopen the app" guidance for field users. |

---

## Known gaps (fix these to make the next outage easier)

- **The customer sync has no empty-source guard.** This is the biggest outage risk ([§2](#2-during-the-outage--do-not)). A "refuse to deactivate more than X%" check would remove it.
- **`/health/ready` doesn't check TradeUnitPreferences, Graph or Key Vault.** The app can say Healthy while every user gets a 503 on Home.
- **No admin button** for the sync or backfill. The token copy/paste in A1 is clumsy under pressure.
- **No app-specific alerts**, only Smart Detection. Nobody is paged when the sync fails or 5xx spikes.
- **No persisted last-run record** for the customer sync.
- **The Daily Recap has no catch-up** for a missed day.
- **Deploy workflows have no post-deploy smoke check.**

## Open questions

Answer these and fold them into the doc:

- eSign feed ([E7](#e7-esign-enrollment-feed-dataverse--power-automate)): who owns the Dataverse → `ESignEnrollment` Power Automate flow, how often does it run, and does it connect through an on-premises data gateway?
- Is the server allowed to reach `nominatim.openstreetmap.org` in PROD at all? If D5's pins never work, even on a normal day, note that in Appendix C.
- Who owns the TradeUnitPreferences app/DB, and what's their recovery check?
- Confirm the App Insights resource name (`appi-origination-eus`).

---

## Incident log

| Date | Window (CT) | Cause | Origination impact | What we had to fix | Playbook changes |
|---|---|---|---|---|---|
| 2026-09-25 | _start → end_ | ExpressRoute East ↔ Lenexa down. Lumen 10Gb circuit error-disabled. Failover routing didn't take over. Partial recovery via SD-WAN/Prisma routing changes. | _fill in_ | _fill in_ | Playbook created |
