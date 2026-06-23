# Meeting Brief — Azure Bot + Teams Calling Permissions for Originations Inbound Call Screen-Pop

## Context

**Why we're meeting:** The Originations team built an inbound-call screen-pop feature — when a producer dials a Scoular Teams number, the originator's browser pops a banner with that producer's profile and an Answer button that takes them straight to the customer page. The app-side code is complete and tested via a simulator (Phase 1, on `feature_PhoneUpdate`). To make it work for *real* Teams calls, we need an Azure Bot resource + tenant admin consent on a Microsoft Graph calling permission. That's what this meeting decides.

**Decision sought:** go / no-go on provisioning the bot and granting consent.

**Audience:** Azure AD / Identity, IT Security / GRC, Teams admin.

---

## Plain-English walkthrough

If anyone in the room is fuzzy on what we're actually building, this is the version to lead with.

### The pitch in one sentence

We're adding **smart caller-ID** to the Origination app: when a producer dials a Scoular phone number, the rep's browser instantly shows that producer's profile — name, contracts, recent activity — before the rep even picks up.

### What a rep sees today vs. with this feature

**Today:**
1. Phone rings. Caller ID shows a phone number, maybe a name.
2. Rep answers. "Hi, this is Sarah."
3. "Hey Sarah, it's John from Smith Farms."
4. Rep types "Smith" into Origination, scrolls a list, clicks the right John.
5. Page loads. ~10 seconds of "uh huh, sure" while they catch up.

**With this feature:**
1. Phone rings. **Browser pops a banner**: "Smith Farms — John Smith — last contract was Corn 2024." Rep sees this *before* picking up.
2. Rep clicks Answer. Producer's profile is already on screen.
3. "Hey John, how's harvest going?"

That's the entire user-visible feature. Five seconds saved per call, dozens of calls a day, hundreds of reps. Adds up.

### What's happening behind the scenes

```
Producer dials a Scoular number
      ↓
Microsoft Teams Phone routes the call (it's a Teams Phone number)
      ↓
Teams sees: "this number is registered to a calling bot — notify the bot"
      ↓
Microsoft sends a webhook (an HTTP message) to our app:
   POST https://app-origination-dev-eus.azurewebsites.net/api/calls/incoming
   { caller: "+13085551234", calledTo: "John.Rep@scoular.com" }
      ↓
Our API receives it, looks up "+13085551234" in the producer database,
finds Smith Farms, then sends a real-time message ("SignalR push") to
John's already-open browser tab
      ↓
John's browser pops the banner. Phone hasn't even rung 3 times yet.
```

The whole round trip happens in **under 2 seconds** in our prototype.

### Why each piece exists

| Piece | What it is in plain English |
|---|---|
| **Azure Bot resource** | A registration record at Microsoft saying "this Origination app is allowed to receive Teams call notifications." Without it, Teams has no idea our app exists and won't notify us about anything. Think of it like getting a vendor badge for an office building. |
| **App registration** | An *identity* for that bot — username + password — that Microsoft can verify. Same concept as a user account, but for the app instead of a person. |
| **Tenant admin consent** | A senior IT person at Scoular saying "yes, this app is allowed to receive call data inside our company." Required because call info is sensitive — Microsoft doesn't let just any app see it. |
| **Microsoft Graph permissions** | The specific things the app is allowed to do — receive incoming notifications (`Calls.AccessIncoming.All`), put a call on hold, transfer, add another person. Each "thing the app can do" is a separate permission. |
| **Teams calling channel on the bot** | The wire that connects "the bot exists" to "Teams actually delivers calls to it." Without flipping this on, the bot is just sitting there registered but not wired up. |
| **Teams app manifest** | A file that tells the Scoular Teams app catalog "this bot is approved to participate in calls." Like an "approved vendor" list. |
| **Test phone number / resource account** | A real phone number we can dial to test the whole flow without bugging a real producer. The "resource account" is the Teams term for a phone-number-shaped Teams user that's not a person, just a calling endpoint. |
| **Client secret in Key Vault** | The bot's password, stored in our locked password vault (not in code). The app fetches it when it needs to talk to Microsoft. |
| **Outbound firewall change** | Our app currently can't talk to the public internet (security policy). Hold / Transfer / Add-People all need to *call back* to Microsoft to actually do those things. So we need a small firewall hole opened to Microsoft Graph specifically. |

### Why "a bot"? We're not building a chatbot.

The word *bot* is misleading. In Microsoft-land, "bot" is just the name they gave to "an app that can receive Teams events programmatically." There's no AI, no chat window, no user-facing interaction with the bot itself.

Think of it as a **listener** — it sits in the background, waits for Teams to say "a call just came in," and reacts. The reps never see it; it never talks to anyone. It's basically a webhook subscriber with a dressed-up name.

### What this is NOT

To preempt the obvious worries:

- **Not recording calls.** We are explicitly *not* asking for the permission that would let the app access call audio. Even if we wanted to, the API would reject the call.
- **Not transcribing calls.** Same reason — no media access.
- **Not eavesdropping on other people's calls.** The bot only gets notified about calls placed *to a phone number we register it to*. A call between two reps, or a call to a different department's number, doesn't reach our app.
- **Not autonomous.** Every action (Answer, Hold, Transfer, Add People) is triggered by a rep clicking a button. The bot doesn't decide to do things on its own.
- **Not new technology.** This is a standard Microsoft Teams pattern — Salesforce, ServiceNow, Genesys, and most CRM/contact-center products have used it for years. We're following the same playbook.

### What we already built

The application side — what the rep clicks and sees — is **done and tested**. We mock the call event with a simulator and the screen-pop, multi-call queue, in-call timer, and call-control buttons all work. What's missing is the real-call trigger from Teams, which is what this whole conversation enables.

---

## Talking points (open the meeting with this)

1. **Business case.** Reps handle dozens of inbound producer calls a day. Today they pick up cold and manually search Origination by name. The screen-pop closes that gap — ~5–10 seconds saved per call, fewer "let me look you up" moments, better producer experience.

2. **What's already done.** The app code is built and works end-to-end against a developer simulator (`/api/calls/test`). Phone-number → producer matching uses the existing CustomerSnapshot data (no new PII handling). Toast UI, multi-call queue, draggable panel, in-call timer — all functional. The only thing missing is the real-call trigger from Microsoft Teams.

3. **The ask.** One Azure Bot resource, one app registration, and tenant admin consent on a set of Microsoft Graph calling permissions (detailed below). The minimum permission unlocks the screen-pop alone; the full set unlocks Hold / Transfer / Add-People that we already built UI for. We can phase the asks (incoming-only first, the rest later) or take the whole ask in one review — your call.

4. **Why a bot at all.** This is *the only path Microsoft offers* for getting Teams Phone call-event notifications and programmatic call control (hold, transfer, add). Microsoft Graph requires a registered Bot Framework app for both. We're not building a chatbot — we're using Bot Framework as a calling-API client.

5. **What we're explicitly NOT asking for.** No `Calls.AccessMedia.All` (raw audio/video streams), no call recording, no transcription. Hold is implemented as mute-direction, not music-on-hold (no audio file playback needed). We don't store call content — only metadata (caller phone, matched producer, call duration).

---

## TL;DR — what we need and what for

A scannable summary; details broken down by stakeholder below.

| # | What we need | What it's for |
|---|---|---|
| 1 | **Azure Bot resource** (`bot-origination-dev`, F0 tier, Single Tenant) | The registration record that lets Microsoft Teams deliver call events to our app. Without this, no inbound notifications work. |
| 2 | **AAD app registration** (auto-created with the bot, Single Tenant) | The bot's identity. Holds the calling permissions. Tenant-locked to Scoular. |
| 3 | **Tenant admin consent on `Calls.AccessIncoming.All`** | Lets Teams notify our app when a call rings to a Scoular phone number we own. The minimum required permission — without it, nothing else works. |
| 4 | **Tenant admin consent on `Calls.Initiate.All`** | Lets the rep click "Transfer" to send the call to a colleague. |
| 5 | **Tenant admin consent on `Calls.InitiateGroupCall.All`** | Lets the rep click "Add People" to bring another person into the call. |
| 6 | **Tenant admin consent on `Calls.JoinGroupCall.All` + `Calls.JoinGroupCallAsGuest.All`** | Lets the bot stay in the call as a participant so Hold / End-Call / Transfer operations target the right call object. |
| 7 | **Client secret** stored in `kv-origination-dev-eus` Key Vault, secret name `BotFramework--ClientSecret` | The bot uses this to authenticate to Microsoft Graph. Stored in Key Vault, accessed by managed identity, never in source code. |
| 8 | **Microsoft Teams calling channel** enabled on the bot | The piece that actually wires Teams Phone → our webhook. Without this, the resource exists but no calls ever reach it. |
| 9 | **Teams app manifest** with `bots[].supportsCalling: true`, submitted to the Scoular Teams app catalog | Required by Teams for any bot that participates in calls. Catalog approval gate. |
| 10 | **Test Teams Phone resource account + non-prod phone number** | Something we can dial during Dev validation without disturbing a real producer-facing line. |
| 11 | **App Service outbound allow-list update** for `*.botframework.com` and `graph.microsoft.com` (or service tags `MicrosoftGraph` / `AzureBotService`) | The Origination App Service has no outbound internet today. Hold / Transfer / Add-People all need to call Microsoft Graph; without this, they fail silently. |
| 12 | **IT Security sign-off** on the permissions list + data-handling commitments | Required for the consent grants in items 3–6 to be approved. |
| 13 | **Repeat for QA + Prod** after Dev validation | Each environment has its own bot, app reg, secret, Teams channel, resource account. Promoted in sequence. |

**Items 1–2 + 7** are infrastructure (one-time provisioning, fast).
**Items 3–6** are the security review (consent grants — typically the slowest moving piece).
**Items 8–10** are Teams admin workflow (calling channel + manifest catalog).
**Item 11** is a separate networking ticket — easy to overlook, and the feature partially fails without it.
**Item 12** gates everything; if Security says no, none of the above gets approved.

---

## What we need (the concrete asks)

### From Identity / Azure AD admin

**Resources / app reg:**

| Item | Why |
|---|---|
| **Azure Bot resource** in `rg-origination-dev-eus` (Dev first), F0 free tier | The registration record Teams uses to identify our app for call notifications |
| **AAD app registration** for the bot (auto-created with the resource), Single Tenant | The bot's identity for receiving Teams webhooks. Tenant-locked to Scoular only. |
| **Client secret** stored in `kv-origination-dev-eus` Key Vault | App authenticates to Microsoft Graph using this secret. Standard pattern. |

**Microsoft Graph permissions (Application scope) + tenant admin consent on each:**

| Permission | What it grants | Required for | Phase |
|---|---|---|---|
| `Calls.AccessIncoming.All` | Receive notifications when calls arrive at resource accounts the bot is registered against | Screen-pop on inbound call | **Phase 1 (minimum)** |
| `Calls.Initiate.All` | Place outbound calls to one user | "Transfer call to colleague" | Phase 1 (full) |
| `Calls.InitiateGroupCall.All` | Add additional participants to an existing call, place outbound group calls | **"Add people to call"** button | Phase 1 (full) |
| `Calls.JoinGroupCall.All` | Bot can join existing group calls / meetings as itself | Bot acts as call participant for hold/redirect operations on multi-party calls | Phase 1 (full) |
| `Calls.JoinGroupCallAsGuest.All` | Bot can join group calls anonymously (guest) | Same as above, fallback | Phase 1 (full) |
| `CallRecords.Read.All` | Read post-call records (after-the-fact analytics) | Optional — call duration / disposition reporting | **Deferred (Phase 2)** |
| `Calls.AccessMedia.All` | **Read/write raw audio/video streams** | Not requesting — would unlock recording / transcription / music-on-hold | **Not requesting (ever, in this scope)** |

**Mapping to UI buttons we already built:**

| UI capability | Permission(s) needed |
|---|---|
| Inbound call screen-pop / Answer | `Calls.AccessIncoming.All` |
| Live call timer | (none — local browser) |
| Add Note | (none — local API only) |
| Hold / Resume | `Calls.AccessIncoming.All` *(mute-direction on the existing call object — same call the bot already received)* |
| End Call | `Calls.AccessIncoming.All` *(hangup is on the same call object)* |
| Add People | `Calls.InitiateGroupCall.All` |
| Transfer | `Calls.Initiate.All` |
| Multi-call queue (second-line ringing) | `Calls.AccessIncoming.All` |

### From Teams admin

| Item | Why |
|---|---|
| **Microsoft Teams calling channel** enabled on the bot | Routes calls from Teams Phone → our webhook |
| **Teams app manifest** with `bots[].supportsCalling: true` submitted to the Scoular Teams app catalog | Required for the bot to be permitted in our tenant's calling flow |
| **Test Teams Phone resource account** with a non-prod phone number assigned | Something we can dial during Dev validation. Doesn't need to be a real producer-facing number. |

### From IT Security / GRC

| Item | Why |
|---|---|
| **Sign-off on the calling permissions list** above | Each permission is application-scoped and tenant-wide. Security needs to acknowledge what each one grants. |
| **Confirmation on data-handling expectations** | We log caller phone + matched producer name + call duration. No call content stored, no audio. Logged via existing Application Insights with PII guidelines already in place. |
| **Acceptance of the "no media access" boundary** | We are committing not to request `Calls.AccessMedia.All`. If a future use case ever needs recording/transcription, it goes through a separate review — it's not in this scope. |

---

## Critical infrastructure question to raise

**Our App Service has no outbound internet.** Per `AZURE-INFRASTRUCTURE.md`, `app-origination-dev-eus` is firewalled to Azure service tags + private networks only. This matters:

- **Inbound webhooks from Teams:** ✅ fine — Teams calls our public-facing App Service URL, no outbound traffic needed.
- **Outbound Graph calls** (e.g., the bot acknowledging a webhook back to Microsoft, or *any* future call-control like Hold/Transfer): ❌ blocked unless we add `MicrosoftGraph` or `*.botframework.com` to the App Service outbound allow-list.

**Action item to confirm in the meeting:** does the existing `AzureActiveDirectory` service tag cover Bot Framework / Microsoft Graph endpoints, or do we need a separate firewall change request?

---

## Risk framing — be ready for these questions

| Likely question | Honest answer |
|---|---|
| "Does this permission let the app listen to all Teams calls in the tenant?" | No. `Calls.AccessIncoming.All` only delivers events for calls placed *to resource accounts the bot is registered against*. We won't be added to other resource accounts. We'd need separate Teams admin action to extend coverage. |
| "Does the bot record calls?" | No. We're explicitly NOT asking for `Calls.AccessMedia.All`. Without it, recording / transcription / audio replay are technically impossible — even if someone tried, the API rejects the call. |
| "Why so many calling permissions?" | Each one maps to a single UI capability (see permission table). They're broken out granularly by Microsoft so we can ask for *only* what we need. We're skipping the two heavyweight ones (`AccessMedia.All`, `Calls.JoinGroupCall.AsGuest` for tenant-wide calls). Everything we're asking for is scoped to calls that *come to us*. |
| "Can the bot place calls to anyone in the tenant?" | `Calls.Initiate.All` lets it call a single user (used during Transfer to ring the colleague the rep is transferring to). It's a discrete API action triggered by a user click in our UI — not autonomous. |
| "Add People — how many can be added?" | `Calls.InitiateGroupCall.All` allows adding participants to an existing call. Bounded by Teams Phone's normal participant limits. Same UX as a rep using Teams' "Add people" button manually. |
| "What data does the app log?" | The caller's phone number (E.164 form) and the producer match result (name + Scoular ID). No call content, no audio. Logs follow existing PII guidelines (Application Insights, no passwords/tokens). |
| "What if the secret leaks?" | Bot's secret is in Key Vault, accessed via managed identity, never in source. Rotation procedure exists for other Origination secrets and applies here. The bot's permissions are tenant-scoped (Single Tenant app reg) — even with the secret, an attacker can only impersonate *our* bot within *our* tenant. |
| "Is this reversible?" | Yes. Disabling the bot resource stops all webhooks. Revoking the app registration's consent stops it permanently. The app falls back gracefully — the rest of Origination is unaffected. |
| "Why not Twilio?" | Twilio works but requires producers to call a *separate* phone number, not Scoular's existing Teams numbers. The whole point is to use the numbers reps already publish. |
| "What's the rollout plan?" | Dev first → validate end-to-end on a test resource account → QA → Prod. Each environment has its own bot. No big-bang flip. |

---

## Decision matrix

Each stakeholder owns a yes/no:

| Stakeholder | Decision needed |
|---|---|
| **Azure AD admin** | Will you create the app registration and grant tenant admin consent on `Calls.AccessIncoming.All`? (This is the big one.) |
| **IT Security / GRC** | Do the data-handling commitments above satisfy your review? Anything else you need? |
| **Teams admin** | Are you good to enable the calling channel on the bot, sponsor the Teams app manifest, and provision a test resource account? |

**If all three say yes:** we file the tickets and start in Dev within ~1 week.
**If any one says no:** the feature can't ship as-is. We'd either revisit Twilio (separate phone numbers) or shelve.

---

## End-to-end process — bot built → feature live in Prod

### Phase A: Provisioning (Dev)

Tickets filed in parallel where possible. Critical path is item 2 (consent).

| # | Step | Owner | Depends on | Rough time |
|---|---|---|---|---|
| 1 | Provision Azure Bot resource (`bot-origination-dev`) | Cloud Ops (ServiceNow ticket) | Approval | ~1 day |
| 2 | **Tenant admin consent on Microsoft Graph calling permissions** | Azure AD admin (separate workflow) | Security GRC sign-off | **1–5 days (gating step)** |
| 3 | Generate client secret, store in `kv-origination-dev-eus` Key Vault as `BotFramework--ClientSecret` | Identity team / Origination team | #1 done | ~30 min |
| 4 | Enable Microsoft Teams calling channel on the bot | Teams admin | #1 done | ~1 day |
| 5 | Submit Teams app manifest with `bots[].supportsCalling: true` to Scoular Teams app catalog | Teams admin | #4 done | 1–10 days (catalog review) |
| 6 | Provision test Teams Phone resource account + non-prod phone number | Teams admin | Teams Phone licensing already in place | ~1 day |
| 7 | Outbound firewall change: allow `MicrosoftGraph` / `AzureBotService` / `*.botframework.com` from `app-origination-dev-eus` | Network team (separate ticket) | — | 2–5 days |

### Phase B: Code wiring (Dev)

These don't need approval — Origination team owns them, runs in parallel with Phase A.

| # | Step | Owner | Depends on | Rough time |
|---|---|---|---|---|
| 8 | Add the bot's App ID + Tenant ID to `appsettings.Development.json` (or app settings in Azure) under `Calls:BotAppId` / `Calls:BotTenantId` | Origination team | Phase A #1 done (App ID exists) | ~10 min |
| 9 | Flip `"Calls:BotEnabled": true` | Origination team | #8 | trivial |
| 10 | Add Bot Framework SDK NuGet packages, finish wiring `Services/Bot/CallingBotAdapter.cs` (the scaffold is already in `feature_PhoneUpdate`) | Origination team | #8 | 1–2 days |
| 11 | Add bot-side JWT validation as a separate auth scheme on `/api/calls/bot/incoming` route | Origination team | — | ~1 day |
| 12 | Deploy the API to Dev | CI/CD (auto on merge to `feature_PhoneUpdate` / a Phase 2 branch) | #10–11 | ~10 min |

### Phase C: Validation in Dev

Once Phase A + B converge:

| # | Step | Owner | Pass criteria |
|---|---|---|---|
| 13 | Place a test call from a personal cell to the test Teams resource account | Origination team | Toast appears in browser within ~2 sec |
| 14 | Click Answer → URL becomes `/?customerId=X` and producer profile renders | Origination team | Producer info loads |
| 15 | Test "unknown caller" path with a number not in any producer record | Origination team | Toast shows "Unknown caller" |
| 16 | Test "multiple matches" path (two producers sharing a phone) | Origination team | First match shown, count badge present |
| 17 | Test Hold / End Call buttons | Origination team | Real call state changes in Teams |
| 18 | Test Transfer button | Origination team | Receiving colleague's Teams rings |
| 19 | Test Add People button | Origination team | Additional party joins the call |
| 20 | Capture wall-clock timing for each step | Origination team | Documented in this repo |

If validation passes → move to Phase D. If something fails → loop back to Phase B (code fix) or Phase A (config fix).

### Phase D: QA → Prod rollout

Each environment is a fresh repeat of Phases A–C. Naming changes per env:

| Step | Dev | QA | Prod |
|---|---|---|---|
| Bot resource | `bot-origination-dev` | `bot-origination-qa-eus` | `bot-origination-eus` |
| Resource group | `rg-origination-dev-eus` | `rg-origination-qa-eus` | `rg-origination-eus` |
| Key Vault | `kv-origination-dev-eus` | `kv-origination-qa-eus` | `kv-origination-eus` |
| Bot tier | F0 (free) | F0 | **S1** (paid SLA) |
| Test number | dev resource acct | dev resource acct + ~5 willing reps | gradual: 1 trade unit → 1 region → all reps |

**Rollout to reps in Prod is gradual, not big-bang.**

1. Pick 1 willing trade unit (e.g., the team you're testing with) → enable for them only.
2. Soak for 1–2 weeks. Watch Application Insights for errors, call-handling failures, screen-pop latency. Survey the reps.
3. If healthy → expand to 1 region (handful of TUs).
4. If healthy → all reps. Announcement + 1-page user guide.

**Backout plan at any phase:**
- Flip `Calls:BotEnabled` to `false` → app stops processing bot webhooks immediately. Toast UI also stops appearing for the simulator. Existing app functionality unaffected.
- Disable the Teams calling channel on the bot resource → calls stop arriving from Teams. Bot still exists for diagnostics.
- Revoke admin consent on the app reg → permissions pulled. Final step if abandoning the feature entirely.

### Estimated total timeline (best case)

- **Phase A (Dev provisioning):** 1–2 weeks calendar time, mostly waiting on Security review + Teams catalog.
- **Phase B (Dev code):** 2–3 days of dev work, can run in parallel with Phase A.
- **Phase C (Dev validation):** 1–2 days assuming no regressions.
- **Phase D (QA + Prod):** 2–4 weeks for soak time + gradual rollout.
- **Total: 5–9 weeks from this meeting to "all reps in Prod"**, mostly dominated by Security review and the gradual Prod rollout.

---

## Things we own (don't need to discuss)

- The app-side code is done. Tested. Reviewed.
- Phone matching, screen-pop UI, multi-call queue, in-call timer — all working against a simulator.
- The Bot Framework adapter (`CallingBotAdapter.cs`) is scaffolded and gated by a config flag.
- We are not asking for new infrastructure beyond the bot itself.

---

## Reference — full provisioning spec (paste into ServiceNow if approved)

**Resource: Azure Bot**

| Field | Value |
|---|---|
| Resource type | `Microsoft.BotService/botServices` |
| Subscription | (same as `app-origination-dev-eus`) |
| Resource group | `rg-origination-dev-eus` |
| Resource name | `bot-origination-dev` |
| Display name | `Origination Inbound Call Bot (Dev)` |
| Location | Global |
| Pricing tier | Free F0 |
| Microsoft App type | Single Tenant |
| Tenant ID | `1521f999-f722-4a4f-9747-166f93e9b0d1` |
| Tags | `Environment=Dev`, `Application=Origination`, `Owner=CEgr@scoular.com`, `DataClassification=Confidential` |

**Channel: Microsoft Teams**

| Setting | Value |
|---|---|
| Messaging endpoint | `https://app-origination-dev-eus.azurewebsites.net/api/calls/incoming` |
| Calling endpoint | (same) |
| Enable calling | Yes |
| Enable video / media | No |

**App registration permissions (Application, Microsoft Graph)**

Phase 1 — full feature set:
- `Calls.AccessIncoming.All` — receive call events (Answer, Hold, End)
- `Calls.Initiate.All` — outbound call for Transfer
- `Calls.InitiateGroupCall.All` — Add People button
- `Calls.JoinGroupCall.All` — bot acts as participant for group-call control
- `Calls.JoinGroupCallAsGuest.All` — fallback for the above

Phase 2 (later, if useful):
- `CallRecords.Read.All` — post-call analytics

Not requesting in any phase:
- `Calls.AccessMedia.All` — raw audio/video; would unlock recording/transcription. Out of scope.

**Secrets**

- Client secret stored in `kv-origination-dev-eus` Key Vault, secret name `BotFramework--ClientSecret`, 24-month expiry, calendar reminder for renewal at month 22.

**Repeat for QA + Prod** after Dev validation:
- QA: `bot-origination-qa-eus` in `rg-origination-qa-eus`, key vault `kv-origination-qa-eus`, F0 tier
- Prod: `bot-origination-eus` in `rg-origination-eus`, key vault `kv-origination-eus`, **S1 tier** (paid SLA)

---

## Questions to bring into the meeting

1. Who in IT typically grants tenant admin consent on Microsoft Graph permissions, and what's the workflow (ticket, approval form, ServiceNow record)?
2. Does the Origination App Service's outbound allow-list cover `*.botframework.com` and `graph.microsoft.com`, or do we need a firewall change?
3. Is there an existing Teams Phone resource account we can borrow for Dev testing, or does Teams admin need to provision a new one?
4. Does the Scoular Teams app catalog process require a security review for bots that only listen for call notifications (no message reading, no media)? If yes, who runs that review and what's the SLA?
5. Are there any existing Azure Bot resources in the Scoular tenant we should look at for pattern reuse (naming, tagging, secret rotation)?

---

## Verification (post-deployment, in Dev)

1. Place a test call from a personal cell to the assigned resource account. Originator's browser pops the toast within ~2s.
2. Click Answer → URL becomes `/?customerId=X` and producer profile renders.
3. Call from a number not in any producer record → toast shows "Unknown caller."
4. Promote to QA, place another test call, repeat.
5. Promote to Prod after QA validation.
