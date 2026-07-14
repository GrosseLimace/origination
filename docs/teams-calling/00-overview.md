# Teams Calling Screen-Pop — Overview

Caller-ID screen-pop for grain originators: when a producer calls an originator's Teams Phone
number, the portal detects the incoming call in the browser, matches the caller's phone number
against producer records, and opens that producer's Customer Profile automatically.

## Table of Contents

- [Problem statement](#problem-statement)
- [How detection works (settled mechanism)](#how-detection-works-settled-mechanism)
- [The two options](#the-two-options)
- [Comparison](#comparison)
- [Recommendation](#recommendation)
- [Prerequisites and open validations](#prerequisites-and-open-validations)
- [Document map](#document-map)

## Problem statement

Originators take producer calls on their personal Teams Phone lines all day. Today they answer
first, then manually search the producer in this portal (name search in the customer list on
`client/src/app/features/customers/pages/home/home.component.ts`). By the time the profile is
open, the producer has already been talking for 30+ seconds. A screen-pop that surfaces the
matching producer record the moment the phone rings removes that lag entirely.

## How detection works (settled mechanism)

Research on this is complete — do not re-derive it:

- Microsoft Graph's Calls/Communications API is a **dead end** for this use case: it only works
  for bot-owned resource-account numbers, not a user's own personal Teams Phone line.
- The working mechanism is **Azure Communication Services (ACS) "Teams user" identity interop**
  (a.k.a. "Custom Teams Client"). A browser-based ACS Calling SDK client authenticates **as the
  signed-in user's own real Teams identity** — not a bot, not a separate number:
  1. User signs in via the existing MSAL Angular flow (`client/src/main.ts`).
  2. The SPA acquires an Entra access token for the ACS resource (delegated scopes
     `Teams.ManageCalls` + `Teams.ManageChats` on the "Azure Communication Services" API).
  3. The backend exchanges that token for an ACS access token via
     `CommunicationIdentityClient.GetTokenForTeamsUser(aadToken, clientId, userObjectId)`
     (`Azure.Communication.Identity` NuGet), using the ACS resource connection string from
     Key Vault.
  4. The Angular client creates a `TeamsCallAgent`
     (`@azure/communication-calling` + `@azure/communication-common`) and subscribes to its
     `incomingCall` event. `incomingCall.callerInfo.identifier` yields a `PhoneNumberIdentifier`
     (E.164, for PSTN calls) or `MicrosoftTeamsUserIdentifier` (internal VoIP), plus
     `callerInfo.displayName`. That is real caller ID.
- Teams rings **all** registered endpoints simultaneously (desktop, mobile, this web client).
  Nothing is intercepted or replaced — the user's normal Teams clients keep working exactly as
  today regardless of what the web client does.
- Microphone/speaker permission is only requested when the SDK actually calls `.accept()` and
  starts media. Subscribing to `incomingCall` and reading `callerInfo` without ever accepting
  triggers **no permission prompt** and **no ACS billing** (billing is $0.004 per participant per
  connected minute; ringing/never-accepted calls are free).
- No SignalR is needed: the ACS Calling SDK receives the event directly in the browser. A push
  channel would only matter if the match had to reach a *different* tab/device than the one
  holding the ACS session — out of scope here.

## The two options

**Option A — Full embedded web dialer** (`01-option-a-embedded-dialer.md`). A visible feature: a
persistent call drawer in the app shell that auto-opens on an incoming call. It DOES call
`.accept()` — the user can answer and talk through the browser as an alternative to desktop
Teams, with answer / decline / mute / hang-up controls.

**Option B — Hidden listener only** (`02-option-b-hidden-listener.md`). No calling UI at all. The
ACS client runs invisibly (a core singleton service) purely to catch `incomingCall`, read
`callerInfo`, and trigger the screen-pop. It never calls `.accept()`: no mic prompts, no billing,
and the user always answers on their normal Teams client.

Both options share identical producer-matching and unsaved-changes behavior — specified once in
`03-shared-behavior.md` and consumed by both designs.

## Comparison

| Dimension | Option A — embedded dialer | Option B — hidden listener |
|---|---|---|
| Visible UI | Call drawer + controls in app shell | None (screen-pop dialogs only, shared with A) |
| Client complexity | High: media, devices, call lifecycle, drawer UX | Low: one event subscription + token refresh loop |
| Mic/browser permission prompts | Yes — on first `.accept()` per origin, and again whenever the user/IT resets site permissions | Never |
| Support burden | Audio quality, headset/device selection, permission-denied tickets, "no sound" triage | Near zero — nothing user-facing can fail audibly |
| Entra permissions | Delegated `Teams.ManageCalls` + `Teams.ManageChats`, tenant admin consent — **identical for both** (the SDK requires both to create the agent, accept or not) | Same |
| Backend surface | Same token-exchange endpoint for both | Same |
| ACS billing | $0.004/participant-minute while connected via browser | $0 (never connects) |
| CSP / network | Same signaling allow-list; A additionally uses WebRTC media (UDP/TURN, outside CSP) | Signaling only |
| Behavioral risk | Decline-on-one-endpoint interaction with other Teams endpoints is **not explicitly confirmed** in official docs | Avoided entirely by never calling `.accept()` or `.reject()` — unused endpoint's ring times out silently |
| Incremental cost over the other | Superset: drawer UI, media flow, device handling, billing monitoring | Strict subset of A's plumbing |

The permission model is a deliberate strength of both: the ACS token is **delegated and scoped to
the signed-in user's own identity and calls** — a much narrower blast radius than an app-only
bot, and consent is granted once by a tenant admin, not per call or per user session.

## Recommendation

**Build Option B.** It delivers the entire business value (the screen-pop) with a fraction of the
support surface, zero audio/permission burden, and zero per-minute cost — and it matches the
stated preference for supportability. Option B's plumbing (token exchange, `TeamsCallAgent`,
`incomingCall` subscription, matching, guards) is a strict subset of Option A, so nothing is
thrown away if a real demand for browser answering emerges later: Option A becomes an additive
milestone on top of a shipped Option B (see the phased plans in both docs — A's plan literally
starts where B's ends).

## Prerequisites and open validations

Confirm these before implementation starts (they are also called out in `04-iac-handoff.md`):

1. **Not supported in Teams GCC** (government cloud). Confirm with whoever owns Teams
   administration at Scoular that the tenant is commercial cloud. (It is scoular.com, tenant
   `1521f999-f722-4a4f-9747-166f93e9b0d1`, believed commercial — confirm anyway.)
2. **Admin consent** for delegated `Teams.ManageCalls` + `Teams.ManageChats` on the SPA app
   registrations, preceded by a security review (asksecurity@scoular.com) per org policy.
3. **Users need Teams Phone**: the signed-in user must have a Teams Phone-enabled account with a
   PSTN number for PSTN caller-ID pops to be meaningful (internal VoIP calls also raise events).
4. **Unconfirmed behavior to validate in the first POC milestone**: that an ACS web endpoint
   which never accepts (and never rejects) an incoming call does not disturb ringing/answer on
   the user's other Teams endpoints. Standard multi-device simultaneous-ring behavior says it
   won't, but this specific interaction was not found explicitly confirmed in official docs.
   Design consequence: **never call `.reject()`** — just let the unused endpoint's ring time out.
5. **Exact CSP `connect-src` host list** for the ACS signaling channel must be captured
   empirically during the first spike (DevTools console; CSP violations do not appear in HAR or
   App Insights — see `developer-docs/CLAUDE.md`, "CSP Allow-List" section).

## Document map

| Doc | Contents |
|---|---|
| [`01-option-a-embedded-dialer.md`](01-option-a-embedded-dialer.md) | Full design + phased plan for the visible in-browser dialer |
| [`02-option-b-hidden-listener.md`](02-option-b-hidden-listener.md) | Full design + phased plan for the invisible listener (recommended) |
| [`03-shared-behavior.md`](03-shared-behavior.md) | Producer matching, screen-pop navigation, multi-match picker, unsaved-changes guard — shared by both options |
| [`04-iac-handoff.md`](04-iac-handoff.md) | Self-contained Azure provisioning handoff for an IaC agent (ACS resource, Entra consent, Key Vault, NSG, tagging, SBOM) |
