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
| `PUT /{id}/outlook-event` | record the Graph event id the browser reported back |
| `DELETE /{id}` | delete |

Due dates are stored and transported as **UTC**. A due date more than a day in the past is rejected;
the one-day window is deliberate, so picking "today 9:00" in the afternoon still works.

`outlook-event` is its own endpoint with its own request type on purpose: the event id is
bookkeeping the client reports back, never a field a user can set through a general edit.

## Outlook: why the browser writes the event

The event belongs to the user, so the SPA acquires a **delegated** `Calendars.ReadWrite` token via
MSAL and calls `POST /me/events` itself (`core/services/outlook-calendar.service.ts`). The app
already calls Graph this way for the profile photo in the header, and the CSP `connect-src` already
allows `graph.microsoft.com`.

The alternative — the API's managed identity holding **application** `Calendars.ReadWrite` — would
grant the service write access to every mailbox in the tenant to accomplish the same thing. The SIMS
repo (`IT/sims`, `Sims.Api/Services/ChangeCalendarService.cs`) implements that app-only pattern
against a service mailbox; it additionally needs a dedicated mailbox per environment and an Exchange
application-access policy, and it has shipped disabled in every environment with its permission
never granted. We took its lessons, not its mechanism:

- Graph wants an **unzoned local literal** plus a separate `timeZone` name, not an ISO offset string.
- Rescheduling **PATCHes start and end only**. Deleting and recreating makes Outlook render the
  original slot as "Canceled".
- **Completing a reminder keeps the event** — deleting it on completion reads as "this never
  happened". The event is removed only when the reminder itself is deleted.

Token acquisition is silent first, then escalates to a **popup** (not a redirect) if interaction is
required, so a half-filled form is never lost. Every failure path resolves `null`/`false`.

## Feature flag

`remindersEnabled` in `client/src/environments/environment*.ts`. True locally and in Dev; **false in
QA and Production until that environment's SPA app registration has admin consent for delegated
`Calendars.ReadWrite`** (see `developer-docs/APP-REGISTRATIONS.md`). With the flag off there is no
card, no badge, and no `/api/reminders/mine` call.

## Deliberate non-goals

- **No background job, no email, no Logic App.** Outlook does the reminding.
- **Not walked across the linked-producer group.** Notes are; a reminder is a to-do about the one
  producer it was set on, and showing it on a linked producer's row would send the user to the wrong
  page when they clicked it.
