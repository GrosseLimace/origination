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

Every Graph `sendMail` call keeps **`retryPolicy: { "type": "none" }`**. Do **not** switch these to a
built-in retry policy — it retries up to four times and cannot inspect the status code, so it would
turn one ambiguous failure into as many as five copies. `none` on the send is what makes the
conditional retry below the only retry path, and keeps the worst case at exactly two copies.

**The trade-off, decided 2026-08-18: a rare duplicate beats a silently missing recap.** This reverses
the earlier policy. `sendMail` is not idempotent, and the failure we actually see is a **504
GatewayTimeout** — *ambiguous*, because Graph may have already accepted and delivered the message
before the gateway gave up. Retrying it can therefore send the recap twice. We now accept that: a
duplicate is visible, annoying and self-evidently a glitch, whereas a missing recap is invisible and
the recipients simply never learn what they didn't get. The groups affected are the largest ones
(biggest HTML bodies, slowest sends), so they are both the most likely to time out and the most
likely to notice a duplicate — that is understood and accepted.

**What we do — retry unless the rejection is permanent.** `If_Email_Send_Retryable` /
`If_Teams_Send_Retryable` fire on `Failed`/`TimedOut` and inspect
`outputs('HTTP_Send_...')?['statusCode']`:

| Status | Behaviour | Why |
|--------|-----------|-----|
| `400`, `403`, `404`, `413` | record failure, do **not** resend | Deterministic rejection — Graph refused the request outright, so a resend cannot succeed and cannot duplicate |
| everything else, including `504`, `429`, `503`, `401`, other 5xx, and Logic-App-level timeouts with no status code at all | wait 30s, send **once** more | Either provably not sent, or not provably sent. Both are retried now |

The single resend also carries `retryPolicy: none`, so there is exactly one extra attempt and no
compounding — **at most two copies, never five**. Failures recorded after a retry are tagged
`(email, retried)` / `(teams, retried)` in `failedGroups`, so `Terminate_Failed`'s message
distinguishes them from first-attempt failures.

**What this fixes.** On **2026-08-12** the 18:00 prod run lost *Western KS* and *MOKAN Daily Digest*
to a 504 (`UnknownError`, empty message) ~95s into the send, while every other group delivered
normally. The previous status-code allowlist (`429`/`503`/`401` only) would **not** have recovered
those — 504 was explicitly excluded. It is now covered.

**Better fixes, still not implemented.** These would remove the duplicate risk entirely rather than
accepting it, and remain the right long-term answer:
1. Verify **before** retrying: `saveToSentItems` is already `true` and the subject is deterministic
   (`... Daily Recap for <groupName>`), so query the shared mailbox's Sent Items after an ambiguous
   failure and resend only if the message is absent. Needs `Mail.Read` alongside `Mail.Send`.
2. Make the send idempotent: replace `sendMail` with `createMessage` → `send` by message id, so
   re-sending an already-sent draft errors instead of delivering twice.


Highest leverage regardless: the activities table is built from **every** note with no size cap,
which is likely why the two biggest groups are the ones that time out. Capping it reduces how often
the ambiguous failure happens at all.

**Diagnosing a failure.** A send failure is *handled* (`Record_Email_Send_Failure` runs on
`Failed`/`TimedOut` and appends to `failedGroups`), so the loop and every iteration still report
**Succeeded** — only `Terminate_Failed` at the end goes red, and its **inputs** name the affected
groups. Look there first, then at that group's iteration. Note also that a run where nobody wrote
notes reports **Succeeded** having sent nothing, because the `activityCount >= 1` `Condition` has an
empty `else` — "nothing to send" and "sent successfully" are currently indistinguishable.

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
