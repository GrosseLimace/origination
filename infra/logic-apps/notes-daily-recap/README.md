# Logic App — Notes Daily Recap

Infrastructure-as-code for the **`logic-origination-notes-daily-recap`** Azure Logic App
(Consumption). This is the repo's first Logic App brought under source control; the layout here is
intended to be reusable for future Logic Apps (e.g. the sibling `instant-share-note`).

## What it does

Once a day it builds and sends a "daily recap" of CRM notes to each configured recap group:

1. **`Recurrence`** trigger — daily at **18:00 Central Standard Time**.
2. **`Get_Recap_Groups`** — reads enabled rows from `[dbo].[DailyRecapGroups]` (Origination DB).
3. **`For_each_Recap_Group`** — for each group:
   - resolves group members and CC emails (`DailyRecapGroupMembers`, `DailyRecapGroupCcEmails`,
     plus `UserTradeUnitAssignments` / `UserGroupAssignments` in the Entitlements DB);
   - pulls each member's notes from the last 24h (`[dbo].[Notes]` joined to `Customer`);
   - summarizes the notes with **Azure OpenAI** (`HTTP_AI_Foundry`) into a 5-point HTML summary;
   - sends the recap via **Microsoft Graph `sendMail`** as the shared mailbox, by **email** or to a
     **Teams** channel address depending on the group's `DeliveryMethod`.

### Send failures and retries

Both Graph `sendMail` calls (`HTTP_Send_Recap_Email`, `HTTP_Send_to_Teams`) use an **exponential
retry policy** (4 attempts, 5s–1m backoff). They previously used `retryPolicy: none`, which meant a
single transient Graph failure silently cost that group its recap for the day.

That is not hypothetical: on **2026-08-12** the 18:00 prod run lost *Western KS* and *MOKAN Daily
Digest* to a Graph **504 GatewayTimeout** (`UnknownError`, empty message) ~95s into the send, while
every other group delivered normally. The next night ran clean. Because a send failure is *handled*
(`Record_Email_Send_Failure` runs on `Failed`/`TimedOut` and appends to `failedGroups`), the loop and
its iterations still report **Succeeded** — only `Terminate_Failed` at the end goes red, and its
inputs carry the group names. Look there first, then at the named group's iteration, when diagnosing.

**Known trade-off:** a 504 is ambiguous — Graph may have sent the message before timing out — so a
retry can deliver a **duplicate** recap. That is accepted deliberately: a missed digest is invisible
to recipients, whereas a duplicate is obvious and harmless. If duplicates become the bigger
complaint, revisit this rather than assuming it was an oversight.

Groups are processed **sequentially** (`concurrency.repetitions: 1`), so a failure part-way through
means earlier groups already sent — partial delivery, which reads to users as "the recap didn't run."

## Security model — no secrets

Every external call authenticates with the workflow's **system-assigned managed identity**
(`identity.type = SystemAssigned`):

| Call | Auth |
|------|------|
| SQL (`sql` API connection) | `ManagedServiceIdentity` |
| Azure OpenAI summarization (`HTTP_AI_Foundry`) | `ManagedServiceIdentity` (audience `cognitiveservices.azure.com`) |
| Microsoft Graph `sendMail` (email + Teams) | `ManagedServiceIdentity` (audience `graph.microsoft.com`) |

There are **no API keys, passwords, connection strings, or SAS tokens** in the definition, so no
Key Vault integration is required. Do not introduce any — keep all auth on managed identity.

## Files

| File | Purpose |
|------|---------|
| `azuredeploy.json` | Parameterized ARM template: the `Microsoft.Logic/workflows` resource + system-assigned identity + workflow definition. |
| `azuredeploy.parameters.dev.json` | Dev parameter values. Config only — **no secrets**. |
| `azuredeploy.parameters.qa.json` | QA parameter values. Config only — **no secrets**. |
| `azuredeploy.parameters.prod.json` | Prod parameter values. Config only — **no secrets**. |

## Parameters

| Parameter | Dev value | QA value | Prod value | Notes |
|-----------|-----------|----------|------------|-------|
| `logicAppName` | `logic-origination-notes-daily-recap-dev-eus` | `logic-origination-notes-daily-recap-qa-eus` | `logic-origination-notes-daily-recap-eus` | Resource name; non-prod carries the env token, prod has none (mirrors `app-origination-…`). |
| `location` | `eastus` | `eastus` | `eastus` | |
| `environmentTag` | `Dev` | `QA` | `Prod` | `Environment` resource tag. |
| `sqlServerName` | `azrscosqld01.database.windows.net` | `azrscosqlq01.database.windows.net` | `azrscosqlp01.database.windows.net` | Origination SQL server per env (same FQDNs the app deploys use). |
| `sharedMailbox` | `dev-OriginationsApp@scoular.com` | `qa-OriginationsApp@scoular.com` | `OriginationsApp@scoular.com` | Graph `sendMail` sender UPN. ⚠️ Confirm the prod mailbox UPN. |
| `sqlConnectionName` | `sql` | `sqlrecap` | `sql` | `Microsoft.Web/connections` (MSI) name, created by the template. QA uses `sqlrecap` to avoid an orphaned V2 `sql` connection left by a failed deploy (no delete rights); revert to `sql` once that orphan is cleaned up. |
| `aiFoundryEndpoint` | `sco-aif-origination-dev-eus` / `gpt-5.1` | `sco-aif-origination-qa-eus` / `gpt-5.1` | `sco-aif-origination-eus` / `gpt-5.1` | Per-env Azure AI Foundry resource (`sco-aif-origination-<env>-eus`, prod drops the env token), `gpt-5.1` chat-completions deployment, `api-version=2025-01-01-preview`. Body uses `max_completion_tokens` (required by gpt-5.1). ⚠️ Confirm the QA/Prod resources + deployments exist before those deploys. |

> **Teams channel routing:** there is **no** `teamsChannelEmail` parameter. A `teams`-delivery group
> routes to its **own** `TeamsChannelEmail` — entered in the app, stored on the recap group, and
> validated as a `*.teams.ms` address on save. The workflow **fails closed**: a group with no channel
> address sends nothing rather than falling back to a shared channel.

> **Resource groups:** Dev → `rg-origination-dev-eus`, QA → `rg-origination-qa-eus`, Prod →
> `rg-origination-eus` (each mirrors its `app-origination-…` web app). Dev/QA deploy on the **non-prod**
> subscription; Prod deploys on the **prod** subscription (`AZURE_SUBSCRIPTION_ID_PROD`), same OIDC
> identity as the app's prod deploy. ⚠️ Confirm the prod resource group name before the first prod run.

## Prerequisites (provisioned outside this template)

The **SQL API connection** (`sqlConnectionName`, managed-identity auth) is now created by the template
itself (`Microsoft.Web/connections`, kind `V1`, `parameterValueSet: oauthMI` — managed identity, no stored
secret), so it no longer needs to be made by hand. What still must be granted **outside** the template:

1. **Managed identity DB grants** — the Logic App's system-assigned identity must be a database user
   in **both** `Origination` and `Entitlements` with:
   - `db_datareader` (the table reads: recap groups/members/CC, Users, trade-unit/group assignments, Notes, Customer), and
   - `EXECUTE` on `dbo.GetRecapNotes` (the notes lookup is a stored proc — `db_datareader` does **not** include execute).

   e.g. `CREATE USER [<logicAppName>] FROM EXTERNAL PROVIDER;` + `ALTER ROLE db_datareader ADD MEMBER [...]` + `GRANT EXECUTE ON dbo.GetRecapNotes TO [...]`. The identity exists only **after** the Logic App's first deploy.
2. **Managed identity role grants** for the same identity:
   - Azure OpenAI: `Cognitive Services OpenAI User` on the AI resource.
   - Microsoft Graph: `Mail.Send` application permission for the shared mailbox.
3. The deploying CI identity needs deploy rights on the target resource group (see repo CI/CD docs).

These DB/role grants are coordinated with IT Infrastructure; the template does not provision them.

## Deploy

Validate first (read-only), then deploy:

```bash
# what-if against dev (proves the template matches what is deployed)
az deployment group what-if \
  --subscription 9ae7649f-19b3-4bf0-b593-b51ce94b5ee5 \
  -g rg-origination-dev-eus \
  --template-file azuredeploy.json \
  --parameters @azuredeploy.parameters.dev.json

# deploy
az deployment group create \
  --subscription 9ae7649f-19b3-4bf0-b593-b51ce94b5ee5 \
  -g rg-origination-dev-eus \
  --template-file azuredeploy.json \
  --parameters @azuredeploy.parameters.dev.json
```

In CI this runs from
[`.github/workflows/deploy-logic-app-notes-daily-recap-dev.yml`](../../../.github/workflows/deploy-logic-app-notes-daily-recap-dev.yml)
(manual `workflow_dispatch`, OIDC login, non-prod subscription).

### Promoting to QA / Prod

Two options for the environment-specific values:

- **Per-env parameters file** (simplest for a single app): add `azuredeploy.parameters.qa.json`.
- **Shared GitHub *environment* variables** (scales when more Logic Apps share values): define
  `SQL_SERVER_NAME` / `RECAP_MAILBOX` etc. once per GitHub environment and override at deploy:
  ```bash
  az deployment group create ... \
    --parameters @azuredeploy.parameters.qa.json \
    --parameters sqlServerName=$SQL_SERVER_NAME sharedMailbox=$RECAP_MAILBOX
  ```
  Command-line `--parameters` override values from the parameters file.

Each environment needs its **own** SQL connection and managed-identity role grants.

## Re-exporting after a portal edit (round-trip)

If the Logic App is edited in the portal, re-sync this template:

```bash
az resource show \
  --subscription 9ae7649f-19b3-4bf0-b593-b51ce94b5ee5 \
  -g rg-origination-dev-eus \
  --resource-type "Microsoft.Logic/workflows" \
  -n logic-origination-notes-daily-recap-dev-eus \
  --api-version 2016-06-01
```

Take `properties.definition`, drop read-only fields (`evaluatedRecurrence`, `accessEndpoint`,
`endpointsConfiguration`, `provisioningState`, `version`, timestamps), and re-apply the
parameterizations (`aiFoundryEndpoint`, `$connections`). Keep the per-group `item()?['TeamsChannelEmail']`
routing (do **not** reintroduce a `teamsChannelEmail` parameter). Confirm with
`what-if` that there is no unexpected drift, then open a PR.
