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
   - `person` → **always `<local part of id>@scoular.com`** — the id's domain, if any, is discarded;
   - `trade-unit` → members of `[dbo].[UserTradeUnitAssignments]` (Entitlements), each `<UserId>@scoular.com`;
   - `trade-unit-group` → members of `[dbo].[UserGroupAssignments]` (Entitlements), each `<UserId>@scoular.com`;
   - `teams-channel` → a **registered Teams channel** (`[dbo].[TeamsChannels]`), picked straight from
     the composer's "@" menu. `Get_Teams_Channel` reads the row by its integer id and appends its
     `ChannelEmail` to `channelRecipient`. Same address handling as below: the note carries only the
     id, the workflow re-checks the Scoular-tenant shape of what it read, and a missing or foreign
     address collects into `unresolvedTypes` and fails the run.
   - `app-group` → **two outcomes, decided by the group's delivery method.** `Get_App_Group` reads
     `[dbo].[DailyRecapGroups]` for the mention's id (a numeric key the API pins, so it is safe to
     interpolate into the `$filter`). Delivery method is the group's whole routing decision — there
     is no separate per-group mention switch.
     - **`DeliveryMethod = 'email'` (the common case): resolves to nothing here.** The API already
       flattened the group into member rows of the three types above before the note was stored, so
       the recipients are present as siblings. The branch is explicit rather than an accident of
       `default`.
     - **`DeliveryMethod = 'teams'`: the group's `TeamsChannelEmail` becomes the recipient** and its
       members are *not* expanded — the note is posted to the channel **instead of** being emailed to
       them. The address is appended to a separate `channelRecipient` variable and sent by
       `HTTP_Send_Channel_Post`, so a note mentioning both a person and a channel produces one
       ordinary email and one channel post.
   Addresses are de-duplicated with `union()`.

   > **Security — the channel address is read here, never taken from the note.** The stored mention
   > row carries only `{type:"app-group", id:"7"}`; `NoteService.NormalizeMention` drops `email` on
   > every non-person row. So the destination cannot be client-authored, which is the same property
   > M-025 / M-025a established for person recipients. The workflow **re-checks the shape** it reads
   > (`*.teams.ms` host, local part ending `.scoular.com`) even though `RecapGroupRequest.Validate`
   > already enforced it on save — a row edited directly in SQL must not become an exfiltration path.
   > A Teams group whose address is missing or fails that check appends to `unresolvedTypes` and
   > **fails the run** rather than silently notifying nobody.

   > **Unknown types fail the run.** The `default` branch collects the type into `unresolvedTypes`
   > and `Condition_Unresolved_Mention_Types` then terminates the run as **Failed**. Previously
   > `default` was `{}`, so a type this workflow didn't know about produced a run that reported
   > **Succeeded while emailing nobody** — the worst possible outcome, since the author believes the
   > note was shared. If you add a mention type to the API, add its case here *first*.
   >
   > **`For_each_Mention` is pinned to `concurrency.repetitions: 1`.** Every branch appends to the
   > shared `recipient` variable, and parallel iterations can lose an append — which drops a
   > recipient silently, again inside a Succeeded run. `union()` de-duplicates; it cannot recover a
   > lost entry. The daily-recap workflow pins its group loop for the same reason.

   > **Security (2026-08-10) — do not "simplify" the person branch.** Both the stored `email` **and
   > `id`** are client-authored, so neither may reach `sendMail` unmodified: trusting `email` (M-025),
   > then trusting any `id` that merely *contained* an `@` (M-025a), each let a chosen external
   > address receive customer data from the privileged shared mailbox. The recipient is therefore
   > **constructed** — `concat(split(id,'@')[0], '@scoular.com')` — so the domain holds by
   > construction and a forged `id` like `attacker@evil.com` degrades to the harmless internal
   > `attacker@scoular.com`. The API independently **rejects** person ids carrying a foreign domain on
   > write (`NoteService.NormalizeMention`); the two layers use different mechanisms on purpose, so
   > one bad assumption can't defeat both. See `SECURITY-REVIEWS/ACCEPTED-RISKS.md` (**M-025**, **M-025a**).
   >
   > **The API also requires a person mention to name an *active* user** (2026-09-01, **H-056**) —
   > `NoteService.ValidatePersonMentionsAsync` checks the same `dbo.Users` roster `Get_Active_Users`
   > reads here, so a forged id is refused at save instead of skipped at send. Mentions are
   > deliberately *not* limited to the author's own trade units (**AR-08**).
6. **`Compose_Safe_Note` / `_Author` / `_Customer`** — HTML-escape (`&` → `&amp;`, then `<`, `>`) the
   three attacker-authorable values before they reach the email body.

   > **Security (2026-09-01, M-036) — interpolate only these outputs, never the raw values.** The note
   > body is written by any authenticated user and lands in an HTML mail from the privileged shared
   > mailbox; unescaped, `<a href="...">Click here</a>` became a real link and `<img src=...>` a
   > tracking pixel in trusted internal mail. **Escape `&` first** — reordering double-encodes the
   > entities the later `replace()`s emit. Only `&`, `<`, `>` are escaped because every interpolation
   > sits in a text node; none is inside an attribute value. The **`subject` is deliberately raw** —
   > it is a plain-text field in the Graph payload, and escaping it would show literal `&amp;` to
   > recipients. See `SECURITY-REVIEWS/ACCEPTED-RISKS.md` (**M-036**).
   > The three `Compose_Safe_*` actions sit at the `Condition_Has_Mentions` level (not inside
   > `Condition_Has_Recipients`) so both the email and the channel post interpolate the same escaped
   > values. Both sends `runAfter` all three.
7. **`HTTP_Send_Share_Email`** — sends the note (Regarding / Note / From / Created) via **Microsoft Graph
   `sendMail`** as the shared mailbox, to the resolved recipients. No AI summary — the raw note is shared.
   Runs with **`retryPolicy: none`** and **no chunked transfer**: Graph `sendMail` is a non-idempotent
   POST with no idempotency key, so when Graph accepts the message but the 202 is lost (client timeout,
   reset, or a gateway 504 raised after the backend already delivered), the default policy re-POSTs and
   the user receives up to five copies — while the run still reports Succeeded. Diagnosed and fixed in
   the daily-recap workflow (commits `999f0d59`, `97b8ea08`); this is the same fix ported here.
8. **`HTTP_Send_Channel_Post`** — the same Graph `sendMail` call, addressed to the Teams channel
   address(es) collected in step 5, but with a deliberately **lean body**: one sentence naming who
   shared a note about which producer, the note text with line breaks preserved, and a one-line
   footer. No banner image, no layout tables, no stylesheet. Teams' email-to-channel rendering
   flattens the Outlook-styled template and buries the note under the 580px header — the first live
   test (2026-09-17) came out as "a big logo and a hard-to-find note". The subject line already becomes
   the post's title in Teams, so the body only needs the content. Guarded by
   `Condition_Has_Channel_Recipients`, so it is skipped entirely unless a channel-routed group or a
   registered channel was mentioned. Same managed identity, same shared mailbox, same `retryPolicy: none`.

   > **M-036 still holds here.** The body interpolates only the three `Compose_Safe_*` outputs plus a
   > formatted date. The `<br>` tags come from a `replace()` on the ALREADY-ESCAPED note (newline →
   > `<br>`), so they are ours, never user-authored; user text cannot smuggle markup in.

   > Posting to a channel is **email to the channel's "send to channel" address** — Microsoft retired
   > Office 365 connectors/incoming webhooks in May 2026, Graph cannot post a channel message with an
   > app-only identity (`ChannelMessage.Send` is delegated-only; the app-only permission is
   > migration-only), and the Logic Apps Teams connector has no managed-identity support. Channel
   > email is the only path that needs **no new Graph grant and no stored secret**. The daily-recap
   > workflow has used it since 2026-06.
   >
   > **Channel prerequisite the team owner controls:** the channel must have email enabled, and its
   > "who can send to this address" setting must allow senders from `scoular.com` (or anyone).
   > "Team members only" bounces mail from the shared mailbox.

### Dedup / one-send guarantee

The SQL connector's `onnewitems` trigger tracks the `Notes.Id` high-water mark, so each new note is
delivered **exactly once** with **no state column and no write access** — the managed identity stays
strictly read-only (`db_datareader`).

> **v1 limitation:** only note **creation** is watched. Mentions added by **editing** an existing note are
> not delivered. Adding that would require the SQL "when an item is modified" trigger plus a
> `MentionsNotifiedAt` column and write-back (the identity would then need write access). Tracked as a
> future enhancement. This applies to channel posts exactly as it does to emails: mentioning a Teams
> group while **editing** an existing note posts nothing.

## Mentions JSON contract

The Logic App reads `dbo.Notes.Mentions` (`nvarchar(max)`), which the API writes on note create/update
(`NoteService.SerializeMentions`). The JSON array has the following shape (modeled on the daily-recap
`RecapMember` / `DailyRecapGroupMembers` model):

```json
[
  { "id": "CEgr",  "name": "Caden Egr",   "type": "person", "email": "CEgr@scoular.com" },
  { "id": "OMAHA", "name": "Omaha TU",    "type": "trade-unit" },
  { "id": "123",   "name": "West Group",  "type": "trade-unit-group" },

  { "id": "7",     "name": "Corn Belt",   "type": "app-group" },
  { "id": "SFletcher", "name": "Sam Fletcher", "type": "person", "email": "SFletcher@scoular.com", "via": "app-group:7" },
  { "id": "1084",  "name": "1084",        "type": "trade-unit", "via": "app-group:7" },

  { "id": "9",     "name": "Grain Desk",  "type": "app-group" },

  { "id": "12",    "name": "Grain Desk",  "type": "teams-channel" }
]
```

The **last row on its own** is a Teams-delivery group: no `via` siblings follow it, because the API
deliberately does **not** expand a group that delivers to a channel. One bare `app-group` row with no
expansions therefore means "post this to that group's channel" — the workflow reads the address from
`DailyRecapGroups` and emails nobody. Note it carries **no `email` field**; the destination lives
only in the database.

The **final row** is a registered Teams channel: `id` is the `dbo.TeamsChannels` key, and again there
is no `email` field — the address lives only in the database.

> ⚠ **Deploy order for `teams-channel`: THIS WORKFLOW FIRST, then the API.** Unlike `app-group`,
> which an older workflow skipped harmlessly, an unrecognised type hits the `default` branch and
> **Terminate-Fails the run**. So a note carrying a `teams-channel` mention fails outright until the
> workflow knows the type. Ship the workflow to an environment before enabling
> `teamsChannelMentionsEnabled` there. (The flag is off in QA and prod, which is the safety net.)
>
> The `app-group` half is the other way round: `Get_App_Group` reads columns that already exist
> (`DeliveryMethod`, `TeamsChannelEmail`), so it is safe on its own, and shipping the API first
> merely avoids a Teams group briefly producing both member emails and a channel post.

The last three rows show a group mention: the API writes the `app-group` row **plus** one row per
member. Note the member rows are ordinary mentions — a `trade-unit` member stays a single row that
this workflow expands live at send time, so entitlements resolution is never duplicated in the API
and a 40-person trade unit doesn't become 40 rows in the note.

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Entitlements identifier: UPN prefix (`person`), `TradeUnitCode` (`trade-unit`), `GroupId` (`trade-unit-group`), or the app's own group id (`app-group`). **Client-authored — treat as untrusted.** For `person` the API accepts only a bare short name or a `@scoular.com` UPN (rejects anything else); the Logic App additionally keeps only the local part. |
| `type` | yes | `person` \| `trade-unit` \| `trade-unit-group` \| `app-group`. The API constrains this with `[AllowedValues]`, and this workflow **fails the run** on anything else. |
| `email` | no | **Not used for routing** (since 2026-08-10, M-025). Person recipients are derived from `id`; the API writes this field as `id@scoular.com` for `person` and null for every other type. Retained for display/back-compat only. |
| `name` | no | Display only; not used for routing. For `app-group` the API overwrites whatever the client sent with the authoritative group name. |
| `via` | no | Server-set provenance (`app-group:7`) marking a row the API expanded out of a group. Not used for routing — the client uses it to avoid highlighting names the note's author never typed. |

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
