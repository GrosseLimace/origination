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

The composer asks Microsoft Graph for the channels the **signed-in user** belongs to, using that
person's own delegated token rather than the app's identity. That choice does three jobs at once:

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

## The IT ask (only open item)

**Two** delegated permissions, both with **admin consent**, on the three SPA app registrations:

| Permission | Why | Endpoint |
| --- | --- | --- |
| `Team.ReadBasic.All` | list the teams the user is in | `GET /me/joinedTeams` |
| `Channel.ReadBasic.All` | list those teams' channels, with `email` | `GET /teams/{id}/channels` |

Both are the least-privileged delegated permission for their endpoint. Requesting only the second is
an easy mistake and fails at the first call.

| Env | SPA app registration |
| --- | --- |
| Dev | `e0f25943-ae8b-4c2d-8060-c9ffbd448aff` |
| QA | `c2bb1208-063d-43aa-bad0-6b51d21437b4` |
| PROD | `958fd665-daa3-42c5-9903-3c9c00638bf1` |

The API app registrations and the managed identity are **not** involved. This is the same set of
registrations the Producer Reminders feature needs `Calendars.ReadWrite` on, so the two can go in one
request. Pitch it as the least-privileged option: delegated read of the teams and channels a user is
already in, versus the app-only alternative that reads every channel in the tenant.

`ChannelSettings.ReadWrite.All` would additionally let the app create a channel's email address when
one does not exist, removing the "someone must click Get email address first" step. Deliberately
**not** requested — it is a write permission, and the business chose the smaller ask.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| No channels in the `@` menu | Consent not granted for this environment, or the flag is off. Both fail quietly by design. |
| A channel you're in is missing | It has no email address yet. Open it in Teams → **Get email address**. |
| Note saved but nothing appeared in the channel | The channel's "who can send here" setting blocks the shared mailbox. It must allow `scoular.com` senders, not "team members only". |
| Workflow run Failed with `UnknownMentionType` | The mention references a channel that is no longer registered, or one whose stored address is not a Scoular channel. |
| "The Teams channel … is no longer registered" on save | The registry row was deleted after the composer loaded. Refresh. |

## Files

- API: `Controllers/TeamsChannelsController.cs`, `Services/TeamsChannelService.cs`,
  `Models/TeamsChannelAddress.cs`, `Services/NoteService.cs` (`ValidateTeamsChannelMentionsAsync`)
- Data: `Data/Entities/TeamsChannel.cs`, migration `AddTeamsChannelRegistry`
- Client: `core/services/teams-directory.service.ts`, `features/customers/components/customer-notes/`
- Workflow: `infra/logic-apps/instant-share-note/` (`Case_teams-channel`, `Case_app-group`)
- Risk record: `SECURITY-REVIEWS/ACCEPTED-RISKS.md` (**AR-07**, amended 2026-09-14)
