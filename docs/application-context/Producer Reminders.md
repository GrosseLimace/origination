# Producer Follow-Up Reminders

Written for: developers working on the Origination Workbench.

## What it is

An originator can schedule a follow-up against a producer ("call Smith Farms on the 20th") from the
producer pane. The reminder appears in a **My Follow-Ups** card on that producer, as a colour-coded
badge on the producer's row in the list, and as an event on the originator's own Outlook calendar
with a 15-minute reminder.

## The two rules that shape everything else

**1. Reminders are strictly personal.** A reminder is visible only to the user who created it —
producer pane, list badge and calendar event alike. This is stricter than Notes, which the whole
team reads and edits (see `SECURITY-REVIEWS/ACCEPTED-RISKS.md` AR-01/AR-02). Scoping lives in the
repository, not in a check each caller makes: every query in `ReminderRepository` takes the owner
UPN and filters `CreatedBy` on it, and the service passes the current user from
`IRequestContextService` so no route can act as somebody else. There is **no Admin override**.

A reminder belonging to another user is reported as **404, not 403**, so the API never confirms that
another originator's follow-up exists.

**2. The database is the source of truth; Outlook is a best-effort mirror.** A calendar failure
never blocks or rolls back a saved reminder. It leaves `OutlookEventId` null, which the UI renders
as an "Add to Outlook" retry on the row.

## Data

`dbo.ProducerReminders`, migration `AddProducerReminders`, entity
`GrainOriginatorPortal.Infrastructure/Data/Entities/ProducerReminder.cs`.

`CustomerName` / `CustomerCode` are **not columns** — they come from the `dbo.Customer` FK join on
read, the same decision Notes made in Phase 3b, so a producer rename cannot leave a stale copy.

Two indexes, one per read: `IX_ProducerReminders_CustomerId_CreatedBy_IsCompleted` for the producer
pane, and `IX_ProducerReminders_CreatedBy_DueAt` (filtered `IsCompleted = 0`) for the badge feed.

## API

`api/reminders`, all routes `[Authorize]` and scoped to the caller.

| Route | Purpose |
|---|---|
| `GET /customer/{customerId}?includeCompleted=false` | the caller's reminders for one producer |
| `GET /mine` | every open reminder the caller owns — the badge feed, analogous to `GET /notes/last-contact` |
| `POST /` | create; subject defaults to "Follow up with {producer}" |
| `PUT /{id}` | edit due date / subject / notes |
| `PUT /{id}/complete` | complete or reopen |
| `POST /{id}/outlook` | write the event to the caller's own calendar and record its id |
| `DELETE /{id}` | delete, removing the calendar event alongside the row |

Due dates are stored and transported as **UTC**. A due date more than a day in the past is rejected;
the one-day window is deliberate, so picking "today 9:00" in the afternoon still works.

`POST /{id}/outlook` is its own endpoint rather than a flag on the edit: putting a reminder on a
calendar is a distinct action with its own retry, and the event id is bookkeeping the API owns —
never a field a user can set through a general edit. It is idempotent, because the row's "Add to
Outlook" button can be pressed twice and two blocks in a calendar is worse than a no-op.

`PUT /{id}` carries an optional `timeZone`, because a due-date change moves the calendar event in the
same call and Graph needs a local time plus a zone name.

## Outlook: why the API writes the event, on-behalf-of the user

The event belongs to the user, so the permission is **delegated** `Calendars.ReadWrite` — but it is
held on the **API app registration**, not the SPA, and the API calls `POST /me/events` **on-behalf-of**
the caller (`Api/Services/OutlookCalendarService.cs`). The browser never holds a Graph token.

That split came from IT Security on 2026-09-15. Delegated Graph permissions live on the API
registration across the Scoular fleet, and Enterprise TMS already does this for `Mail.Send`. The
decisive reason is operational rather than security: **their app registrations are rebuilt from a
config template**, so a permission added by hand to a SPA registration works for months and then
silently disappears during an unrelated reconcile. The boundary is identical either way, because the
user's identity flows through the exchange — still `/me/events`, still that person's own calendar,
never `/users/{id}/events`.

The alternative — the API's managed identity holding **application** `Calendars.ReadWrite` — would
grant the service write access to every mailbox in the tenant to accomplish the same thing. The SIMS
repo (`IT/sims`, `Sims.Api/Services/ChangeCalendarService.cs`) implements that app-only pattern
against a service mailbox; it additionally needs a dedicated mailbox per environment and an Exchange
application-access policy, and it has shipped disabled in every environment with its permission
never granted. We took its lessons, not its mechanism:

- Graph wants an **unzoned local literal** plus a separate `timeZone` name, not an ISO offset string.
  The zone comes from the **browser**, because the server cannot know where the user is sitting — it
  rides on the save request and on the "Add to Outlook" call. An unrecognised zone falls back to UTC
  rather than throwing: a reminder an hour out beats no reminder.
- Rescheduling **PATCHes start and end only**. Deleting and recreating makes Outlook render the
  original slot as "Canceled".
- **Completing a reminder keeps the event** — deleting it on completion reads as "this never
  happened". The event is removed only when the reminder itself is deleted.

Every failure path returns `null`/`false` and is swallowed, so a calendar problem never fails or
rolls back the reminder. The database is the source of truth; the event is a best-effort mirror.

### What moving server-side changed

- **No consent popup.** The browser used to escalate to an MSAL popup on first use, which could
  interrupt a half-filled form. That is gone.
- **Fewer round trips.** Rescheduling and deleting now happen inside the ordinary save and delete
  calls, so the browser makes one request where it used to make two.
- **No window where the event exists but the row does not know about it.** `POST
  /api/reminders/{id}/outlook` writes the event *and* records the id in one call. The old `PUT
  /api/reminders/{id}/outlook-event`, which existed so the browser could report the id back, is gone
  — nothing calls it, and an endpoint letting a client set an arbitrary event id is not worth keeping.

## Feature flag

`remindersEnabled` in `client/src/environments/environment*.ts`. True locally and in Dev; **false in
QA and Production until the API app registration has admin consent for delegated
`Calendars.ReadWrite`** (see `developer-docs/APP-REGISTRATIONS.md`). With the flag off there is no
card, no badge, and no `/api/reminders/mine` call.

Consent applies to Dev, QA and Production **together**, not one at a time; the flag is what keeps the
feature dark until we choose to turn it on.

### How the API authenticates for on-behalf-of

On-behalf-of makes the API a confidential client, so it must prove its own identity to Entra. That is
**configuration, not code** — `AzureAd:ClientCredentials`:

- **Preferred, secretless:** a federated identity credential on the API registration backed by the
  App Service managed identity (`"SourceType": "SignedAssertionFromManagedIdentity"`), keeping the
  app's existing no-secrets posture.
- **Otherwise:** a client secret or certificate in the same section, from Key Vault.

**Local development** has no managed identity, so a developer running the API locally gets no Graph
token and the calendar write quietly does nothing — the reminder still saves, and the row shows its
"Add to Outlook" retry. To exercise it locally, put a client secret in **User Secrets**, never in
`appsettings.json`.

## Deliberate non-goals

- **No background job, no email, no Logic App.** Outlook does the reminding.
- **Not walked across the linked-producer group.** Notes are; a reminder is a to-do about the one
  producer it was set on, and showing it on a linked producer's row would send the user to the wrong
  page when they clicked it.
