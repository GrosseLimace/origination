# Logic App — Instant Share Note

Infrastructure-as-code for the **`logic-origination-instant-share-note`** Azure Logic App
(Consumption). It is the **instant** sibling of the [Notes Daily Recap](../notes-daily-recap/README.md)
Logic App: instead of batching a day's notes, it fires as soon as a note is **created** and emails that
one note to whoever was **@mentioned** in it. The layout mirrors the daily-recap app.

## What it does

1. **`When_a_note_is_created`** trigger — the SQL connector polls `[dbo].[Notes]` (Origination DB) for
   newly-created rows (`onnewitems`, ~every 3 min). `splitOn` fans each new note into its own run.
2. **`Condition_Has_Mentions`** — the run continues only if the note's `Mentions` column is non-empty and
   the note is not soft-deleted. Notes without mentions are ignored (no-op).
3. **`Parse_Mentions`** — parses the `Mentions` JSON array (contract below).
4. **`Get_Customer`** / **`Get_Author`** — look up the customer name ("Regarding") from
   `[dbo].[Customer]` and the author's display name from `[dbo].[Users]` (Entitlements DB).
5. **`For_each_Mention` → `Switch_Member_Type`** — resolves each mention to email address(es):
   - `person` → the mention's `email`, or `<id>@scoular.com`;
   - `trade-unit` → members of `[dbo].[UserTradeUnitAssignments]` (Entitlements), each `<UserId>@scoular.com`;
   - `trade-unit-group` → members of `[dbo].[UserGroupAssignments]` (Entitlements), each `<UserId>@scoular.com`.
   Addresses are de-duplicated with `union()`.
6. **`HTTP_Send_Share_Email`** — sends the note (Regarding / Note / From / Created) via **Microsoft Graph
   `sendMail`** as the shared mailbox, to the resolved recipients. No AI summary — the raw note is shared.

### Dedup / one-send guarantee

The SQL connector's `onnewitems` trigger tracks the `Notes.Id` high-water mark, so each new note is
delivered **exactly once** with **no state column and no write access** — the managed identity stays
strictly read-only (`db_datareader`).

> **v1 limitation:** only note **creation** is watched. Mentions added by **editing** an existing note are
> not delivered. Adding that would require the SQL "when an item is modified" trigger plus a
> `MentionsNotifiedAt` column and write-back (the identity would then need write access). Tracked as a
> future enhancement.

## Mentions JSON contract

The Logic App reads `dbo.Notes.Mentions` (`nvarchar(max)`). The column exists today but is **not yet
written by the application** — capturing @mentions in the UI and persisting this JSON is separate,
API/frontend work. That write path **must** produce a JSON array of the following shape (modeled on the
daily-recap `RecapMember` / `DailyRecapGroupMembers` model):

```json
[
  { "id": "CEgr",  "name": "Caden Egr",  "type": "person", "email": "CEgr@scoular.com" },
  { "id": "OMAHA", "name": "Omaha TU",   "type": "trade-unit" },
  { "id": "123",   "name": "West Group", "type": "trade-unit-group" }
]
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Entitlements identifier: UPN prefix (`person`), `TradeUnitCode` (`trade-unit`), or `GroupId` (`trade-unit-group`). |
| `type` | yes | `person` \| `trade-unit` \| `trade-unit-group`. |
| `email` | no | Used directly for `person`; falls back to `<id>@scoular.com`. |
| `name` | no | Display only; not used for routing. |

## Security model — no secrets

Every external call authenticates with the workflow's **system-assigned managed identity**
(`identity.type = SystemAssigned`):

| Call | Auth |
|------|------|
| SQL (`sqlshare` API connection) | `ManagedServiceIdentity` |
| Microsoft Graph `sendMail` | `ManagedServiceIdentity` (audience `graph.microsoft.com`) |

There are **no API keys, passwords, connection strings, or SAS tokens** in the definition, so no Key Vault
integration is required. Do not introduce any — keep all auth on managed identity. (This app has **no**
Azure OpenAI dependency; unlike the recap app it does not summarize.)

## Files

| File | Purpose |
|------|---------|
| `azuredeploy.json` | Parameterized ARM template: the `Microsoft.Logic/workflows` resource + system-assigned identity + the `sqlshare` SQL connection + workflow definition. |
| `azuredeploy.parameters.dev.json` | Dev parameter values. Config only — **no secrets**. |
| `azuredeploy.parameters.qa.json` | QA parameter values. Config only — **no secrets**. |
| `azuredeploy.parameters.prod.json` | Prod parameter values. Config only — **no secrets**. |

## Parameters

| Parameter | Dev value | QA value | Prod value | Notes |
|-----------|-----------|----------|------------|-------|
| `logicAppName` | `logic-origination-instant-share-note-dev-eus` | `logic-origination-instant-share-note-qa-eus` | `logic-origination-instant-share-note-eus` | Resource name; non-prod carries the env token, prod has none. |
| `location` | `eastus` | `eastus` | `eastus` | |
| `environmentTag` | `Dev` | `QA` | `Prod` | `Environment` resource tag. |
| `sqlServerName` | `azrscosqld01.database.windows.net` | `azrscosqlq01.database.windows.net` | `azrscosqlp01.database.windows.net` | Origination SQL server per env. |
| `sharedMailbox` | `dev-OriginationsApp@scoular.com` | `qa-OriginationsApp@scoular.com` | `OriginationsApp@scoular.com` | Graph `sendMail` sender UPN. ⚠️ Confirm the prod mailbox UPN. |
| `sqlConnectionName` | `sqlshare` | `sqlshare` | `sqlshare` | `Microsoft.Web/connections` (MSI) name, created by the template. Deliberately **not** `sql` (the recap app's connection) so the two templates don't fight over one connection resource. ⚠️ Confirm no name collision with an existing connection in each RG before first deploy. |

> **Resource groups:** Dev → `rg-origination-dev-eus`, QA → `rg-origination-qa-eus`, Prod →
> `rg-origination-eus`. Dev/QA deploy on the **non-prod** subscription; Prod deploys on the **prod**
> subscription (`AZURE_SUBSCRIPTION_ID_PROD`).

## Prerequisites (provisioned outside this template)

The **SQL API connection** (`sqlConnectionName`, MSI auth, kind `V1`, `parameterValueSet: oauthMI`) is
created by the template. What still must be granted **outside** the template:

1. **Managed identity DB grants** — the Logic App's system-assigned identity must be a database user in
   **both** `Origination` and `Entitlements` with **`db_datareader`** (the table reads: Notes, Customer,
   Users, trade-unit/group assignments). **No `EXECUTE` grant is needed** — this app calls no stored
   procedures. e.g.:
   ```sql
   CREATE USER [logic-origination-instant-share-note-dev-eus] FROM EXTERNAL PROVIDER;
   ALTER ROLE db_datareader ADD MEMBER [logic-origination-instant-share-note-dev-eus];
   ```
   Run in both databases. The identity exists only **after** the Logic App's first deploy.
2. **Microsoft Graph** `Mail.Send` application permission for the shared mailbox (same as the recap app).
   No Cognitive Services / OpenAI role is required.
3. The deploying CI identity needs deploy rights on the target resource group.

These DB/role grants are coordinated with IT Infrastructure; the template does not provision them.

## Deploy

Validate first (read-only), then deploy:

```bash
# validate (well-formedness) + preview
az deployment group validate \
  -g rg-origination-dev-eus \
  --template-file azuredeploy.json \
  --parameters @azuredeploy.parameters.dev.json

az deployment group what-if \
  -g rg-origination-dev-eus \
  --template-file azuredeploy.json \
  --parameters @azuredeploy.parameters.dev.json

# deploy
az deployment group create \
  -g rg-origination-dev-eus \
  --template-file azuredeploy.json \
  --parameters @azuredeploy.parameters.dev.json
```

In CI this runs from
[`.github/workflows/deploy-logic-app-instant-share-note-dev.yml`](../../../.github/workflows/deploy-logic-app-instant-share-note-dev.yml)
(manual `workflow_dispatch`, OIDC login, non-prod subscription). QA and Prod have sibling workflows.

Each environment needs its **own** SQL connection and managed-identity DB/Graph grants.
