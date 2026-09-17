# Teams Channel Mentions

**What it is:** @-mention a Microsoft Teams channel in a producer note and the note is posted to that
channel instead of being emailed to people.

**Where:** the note composer on the customer page (`@` menu), plus Manage Groups (`/daily-digest`)
for the group-level version.

---

## Two ways a note reaches a channel

| | Set up by | Mentioned as | Who can mention it |
| --- | --- | --- | --- |
| **A group set to Teams delivery** | Manage Groups: pick Microsoft Teams, paste the channel address | `app-group` | people who can see that group |
| **A registered channel** | picked straight from the `@` menu; registers itself on first use | `teams-channel` | anyone |

Both end up in the same place: the Instant Share Note Logic App posts the note to the channel's
address. A group set to Teams delivery sends **everything** there — the nightly recap and any
@-mention — and its members are not emailed at all; they only grant visibility.

## How the `@` menu finds channels

The composer calls **our API** (`GET /api/teamschannels/mine`), which asks Microsoft Graph
**on-behalf-of the signed-in user**. The browser never talks to Graph and never holds a Graph token.
Graph still sees the user's identity, so it returns only the teams that person belongs to. That does
three jobs at once:

- **Scoping.** You only ever see channels you are actually in, so the list stays small. This is the
  answer to "there are too many channels to pick from" — a person's own teams are a fraction of the
  company's.
- **Authorization.** You cannot post into a channel you have no access to, without us writing a
  single permission check.
- **Least privilege.** The app-only alternative would read every channel in the tenant.

Channels **without an email address are not offered.** Teams does not create one until somebody opens
the channel and chooses "Get email address", and the app deliberately does not provision addresses
itself — that needs a broader, write-scoped permission. So a channel appears in the menu only once
someone has generated its address in Teams.

Picking a channel nobody has used before **registers** it (`POST /api/teamschannels`), which stores it
in `dbo.TeamsChannels` and makes it mentionable by everyone from then on. The first person to use a
channel sets it up for the whole team without meaning to.

## Why the note never stores an address

A note is written by a user, so anything stored on it is user-controlled. The mention records only
the registry id — `{"type":"teams-channel","id":"12"}` — and the workflow reads
`TeamsChannels.ChannelEmail` at send time. This is the same property established for person
recipients in **M-025 / M-025a**, reached the same way.

The Scoular-tenant check runs twice, in different code: `TeamsChannelAddress.IsScoularChannel` on
registration, and again inside the workflow on the value it just read, so a row edited directly in
SQL cannot become an exfiltration path. A channel whose address is missing or fails that check
**fails the workflow run** rather than silently notifying nobody.

## Feature flag

`environment.teamsChannelMentionsEnabled` — **true** locally and in Dev, **false** in QA and
production until the Graph consent below is granted. Without consent the channel lookup returns
nothing, so the flag exists to avoid showing an empty section that looks broken.

## The IT ask — DONE in Dev (2026-09-17), QA and PROD pending

**Two** delegated permissions, both with **admin consent**, on the **API app registration**
(`00078a10-3f3f-4d17-9350-fe90401125ae`) — *not* the SPA registrations:

| Permission | Why | Endpoint |
| --- | --- | --- |
| `Team.ReadBasic.All` | list the teams the user is in | `GET /me/joinedTeams` |
| `Channel.ReadBasic.All` | list those teams' channels, with `email` | `GET /teams/{id}/channels` |

Both are the least-privileged delegated permission for their endpoint. Requesting only the second is
an easy mistake and fails at the first call.

Consent applies to Dev, QA and PROD **together**, not one environment at a time (confirmed by IT
Security 2026-09-15). The per-environment flag is what keeps the feature dark until we choose to turn
it on. The Producer Reminders feature needs `Calendars.ReadWrite` on the same registration, so the
two go in one request.

### Why the API registration and not the SPA

IT Security's rule, 2026-09-15: delegated Graph permissions live on the API registration across the
fleet, and the API calls Graph on-behalf-of the user. Enterprise TMS already does this for
`Mail.Send`. The decisive reason is operational rather than security — **their app registrations are
rebuilt from a config template**, so a permission added by hand to a SPA registration works for
months and then silently disappears during an unrelated reconcile. The permission boundary is
identical either way, because the user's identity flows through the exchange.

### How the API authenticates for on-behalf-of

On-behalf-of makes this API a confidential client, so it must prove its own identity to Entra. That
is **configuration, not code** — `AzureAd:ClientCredentials` — so either answer below works without
touching `Program.cs`:

**Answered by IT Security on 2026-09-17 — the secretless route, and it is live in Dev.** A federated
identity credential on the `Origination API - Dev` registration is bound to the
`app-origination-dev-eus` **system-assigned** managed identity, with token-exchange audience
`api://AzureADTokenExchange`. The App Service signs an assertion with its own identity; there is no
client secret anywhere. In `appsettings.Dev.json` that is just:

```json
"AzureAd": { "ClientCredentials": [ { "SourceType": "SignedAssertionFromManagedIdentity" } ] }
```

`ManagedIdentityClientId` is deliberately omitted because the identity is system-assigned. QA and
Production have **no credential and no consent yet, by design** — a small config change on IT's side
once Dev is proven, not another build. The three SPA registrations were left untouched.

Two operational notes from IT worth keeping:

- **If Graph calls suddenly fail after an infrastructure change**, the likely cause is the managed
  identity having been recreated — the credential binds to its object id. Their tooling repairs it on
  the next deploy; tell them.
- **We are the first app in the tenant to do an on-behalf-of exchange.** IT wants to be told when
  either feature has been exercised in Dev so they can confirm the exchange appears in the sign-in
  logs. That log entry, not the configuration, is what proves the whole thing.

**Local development** has no managed identity, so a developer running the API locally gets no Graph
token and sees an empty channel list. To exercise it locally, put a client secret in **User Secrets**
(never `appsettings.json`), which is the approved place for development secrets.

`ChannelSettings.ReadWrite.All` would additionally let the app create a channel's email address when
one does not exist, removing the "someone must click Get email address first" step. Deliberately
**not** requested — it is a write permission, and the business chose the smaller ask.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| No channels in the `@` menu | Consent not granted, the flag is off, or the API has no client credential configured so the on-behalf-of exchange fails. All three fail quietly by design — check the API logs for "Teams channel lookup unavailable" or a Graph 403. |
| Works in Dev, empty when running locally | Expected. Local has no managed identity, so there is no credential for the on-behalf-of exchange. Add a client secret to User Secrets to test locally. |
| A channel you're in is missing | It has no email address yet. Open it in Teams → **Get email address**. |
| Note saved but nothing appeared in the channel | The channel's "who can send here" setting blocks the shared mailbox. It must allow `scoular.com` senders, not "team members only". |
| Workflow run Failed with `UnknownMentionType` | The mention references a channel that is no longer registered, or one whose stored address is not a Scoular channel. |
| "The Teams channel … is no longer registered" on save | The registry row was deleted after the composer loaded. Refresh. |

## Files

- API: `Controllers/TeamsChannelsController.cs`, `Services/TeamsChannelService.cs`,
  `Models/TeamsChannelAddress.cs`, `Services/NoteService.cs` (`ValidateTeamsChannelMentionsAsync`)
- Data: `Data/Entities/TeamsChannel.cs`, migration `AddTeamsChannelRegistry`
- Graph on-behalf-of: `Services/TeamsDirectoryService.cs`, enabled in `Program.cs`
  (`EnableTokenAcquisitionToCallDownstreamApi` + `AddInMemoryTokenCaches`)
- Client: `core/services/teams-directory.service.ts` (now just calls our API),
  `features/customers/components/customer-notes/`
- Workflow: `infra/logic-apps/instant-share-note/` (`Case_teams-channel`, `Case_app-group`)
- Risk record: `SECURITY-REVIEWS/ACCEPTED-RISKS.md` (**AR-07**, amended 2026-09-14)
