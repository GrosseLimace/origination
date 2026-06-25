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

## Parameters

| Parameter | Dev value | QA value | Notes |
|-----------|-----------|----------|-------|
| `logicAppName` | `logic-origination-notes-daily-recap-dev-eus` | `logic-origination-notes-daily-recap-qa-eus` | Resource name; follows `logic-origination-…-<env>-eus`. |
| `location` | `eastus` | `eastus` | |
| `environmentTag` | `Dev` | `QA` | `Environment` resource tag (`Dev`/`QA`/`Prod`). |
| `sqlServerName` | `azrscosqld01.database.windows.net` | `azrscosqlq01.database.windows.net` | QA Origination SQL server (same FQDN the app's QA deploy uses). |
| `sharedMailbox` | `dev-OriginationsApp@scoular.com` | `qa-OriginationsApp@scoular.com` | Graph `sendMail` sender UPN. |
| `sqlConnectionName` | `sql` | `sql` | Existing `Microsoft.Web/connections` (MSI) in the target RG. |
| `aiFoundryEndpoint` | Azure OpenAI chat-completions URL | _same as Dev_ | Shared data-cloud Azure OpenAI. Correct for now; expected to move to a dedicated AI resource later — update the URL when it does. |

> **Teams channel routing:** there is **no** `teamsChannelEmail` parameter. A `teams`-delivery group
> routes to its **own** `TeamsChannelEmail` — entered in the app, stored on the recap group, and
> validated as a `*.teams.ms` address on save. The workflow **fails closed**: a group with no channel
> address sends nothing rather than falling back to a shared channel.

> **QA resource group:** `rg-origination-qa-eus` (mirrors `app-origination-qa-eus`). The QA workflow
> deploys there on the **non-prod** subscription, same OIDC identity as the app's QA deploy.

## Prerequisites (provisioned outside this template)

1. **SQL API connection** named per `sqlConnectionName` must already exist in the target resource
   group, configured for **managed identity** auth. (This template *references* it rather than
   creating it; the connection's MI must have read access to the Origination + Entitlements DBs.)
2. **Managed identity role grants** for the Logic App's system-assigned identity:
   - Azure OpenAI: `Cognitive Services OpenAI User` on the AI resource.
   - Microsoft Graph: `Mail.Send` application permission for the shared mailbox.
   - SQL: db reader on Origination + Entitlements (via the SQL connection's identity).
3. The deploying CI identity needs deploy rights on the target resource group (see repo CI/CD docs).

These are coordinated with IT Infrastructure; this template does not provision them.

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
