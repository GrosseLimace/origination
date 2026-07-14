# Option A — Full Embedded Web Dialer

A visible calling surface inside the portal: a persistent drawer in the app shell that shows
incoming-call state, lets the user answer/decline/mute/hang up in the browser, and auto-opens on
an incoming call. This is the richer, heavier alternative — read
[`00-overview.md`](00-overview.md) for why Option B is recommended first, and note that
**everything in this design is additive on top of Option B's core** (same backend, same
`TeamsCallingService`, same shared screen-pop behavior). Nothing here replaces anything in
[`02-option-b-hidden-listener.md`](02-option-b-hidden-listener.md); this doc only specifies what
Option A adds.

## Table of Contents

- [What the user sees](#what-the-user-sees)
- [Component structure](#component-structure)
- [Where the drawer lives](#where-the-drawer-lives)
- [Call lifecycle state](#call-lifecycle-state)
- [Accept / media flow](#accept--media-flow)
- [Call controls UI](#call-controls-ui)
- [Backend endpoints](#backend-endpoints)
- [Error handling](#error-handling)
- [Costs and support burden](#costs-and-support-burden)
- [Phased implementation plan](#phased-implementation-plan)

## What the user sees

- A small phone-icon button in the header (right-hand cluster of
  `client/src/app/shared/components/header/header.component.html`) with a status dot
  (grey = listener off/starting, green = ready, red = error). Clicking it toggles the drawer.
- A **call drawer** anchored bottom-right (same fixed-overlay layering approach as
  `client/src/app/shared/components/toast-container/`), closed by default.
- On an incoming call the drawer auto-opens showing caller ID (number + `displayName` when
  present), the matched producer name (from the shared matching in
  [`03-shared-behavior.md`](03-shared-behavior.md)), and **Answer** / **Dismiss** buttons.
- While connected: producer/caller name, call timer, **Mute/Unmute**, **Hang up**.
- The screen-pop (navigate to the producer profile) happens on ring exactly as in Option B — the
  drawer is additional, not a replacement for the pop.

## Component structure

New standalone components (Angular 21, signals, zoneless — follow
`style-guides/angular.md` component conventions):

| File | Responsibility |
|---|---|
| `client/src/app/shared/components/call-drawer/call-drawer.component.ts` | The drawer: renders call state from `TeamsCallingService` signals, hosts the control buttons. Dumb view over service state. |
| `client/src/app/shared/components/call-drawer/call-drawer.component.html` | Template (Tailwind, existing design-system button/badge classes from `style-guides/angular.md` §Design System Classes). |
| Header button | Added to `client/src/app/shared/components/header/header.component.html` / `.ts`, toggling a `drawerOpen` signal on the service. |

Placement judgment call: this repo's `client/src/app/features/` folders are one-per-routed-screen
(see `client/src/app/app.routes.ts`); the drawer is app-shell chrome available on every route, so
it belongs under `client/src/app/shared/components/` alongside `header/` and `toast-container/`,
not under `features/`.

The drawer is rendered once in the app shell template, `client/src/app/app.component.html`,
next to `<app-toast-container/>` (the `AppComponent` at `client/src/app/app.component.ts`
already hosts cross-route singletons — `IdleTimeoutService`, `DataPreloadService`, etc. — this
follows that pattern).

## Where the drawer lives

- **Closed drawer**: nothing rendered except the header phone button. No layout shift.
- **Open drawer**: `fixed bottom-4 right-4 z-[55]` card (below the dialog z-band `z-[60]` used by
  `client/src/app/shared/components/dialog/dialog.component.ts`, so modals — including the shared
  multi-match and unsaved-changes dialogs — stack above the drawer).
- **Auto-open**: an `effect()` in the drawer component opens it when
  `TeamsCallingService.incomingCall()` becomes non-null; the user can close it during ring
  (ring continues on their other Teams endpoints regardless).

## Call lifecycle state

Option B's `TeamsCallingService` (`client/src/app/core/services/teams-calling.service.ts`,
specified in `02-option-b-hidden-listener.md`) gains call-lifecycle state. All state is signals
(repo convention — cf. `client/src/app/core/services/app-state.service.ts`):

```
agentState: signal<'off' | 'starting' | 'ready' | 'error'>    // exists in Option B
incomingCall: signal<IncomingCallInfo | null>                 // exists in Option B
callState: signal<'idle' | 'ringing' | 'connecting' | 'connected' | 'ended' | 'failed'>
activeCall: signal<TeamsCall | null>       // SDK call object, non-null connecting→ended
isMuted: signal<boolean>
callStartedAt: signal<Date | null>         // drives the timer
drawerOpen: signal<boolean>
```

Transitions:

- `idle → ringing`: `teamsCallAgent.on('incomingCall')`.
- `ringing → connecting`: user clicks Answer → `.accept()`.
- `ringing → idle`: caller hangs up / answered elsewhere / ring timeout — the SDK raises
  `callEnded` on the incoming call with a reason code; surface "Answered on another device"
  vs "Missed" from that code, best-effort.
- `connecting → connected`: `call.on('stateChanged')` reaching `Connected`.
- `connected → ended`: local hang-up (`call.hangUp()`) or remote end.
- Any → `failed`: SDK/media errors; drawer shows the failure and a retry-listener affordance.

The SDK types are only imported dynamically (see Option B's lazy-load requirement) — the service
holds them as `unknown`-narrowed internal fields and exposes plain view-model signals so the
drawer component never imports `@azure/communication-calling` types directly.

## Accept / media flow

This is the part that exists **only** in Option A, and it is where all the support burden lives:

1. On Answer: call `deviceManager.askDevicePermission({ audio: true, video: false })` first.
   This triggers the browser mic prompt on first use per origin. If denied → toast error
   (`client/src/app/core/services/toast.service.ts`) with guidance, stay in `ringing`
   (user answers on desktop Teams as usual). Never loop the prompt.
2. `incomingCall.accept({ audioOptions: { muted: false } })` → `connecting`.
3. Billing starts when the call connects ($0.004/participant-minute) and stops at hang-up.
4. Speaker/microphone selection: v1 uses browser defaults. Device pickers
   (`deviceManager.getMicrophones()/getSpeakers()`) are a deferred enhancement — every device
   feature added here is a future support ticket category.
5. **Decline semantics**: the drawer's ring-state secondary button is **Dismiss** (closes the
   drawer, does nothing to the call) — NOT `.reject()`. Whether rejecting on one endpoint stops
   ring on the user's other Teams endpoints is not explicitly confirmed in official docs
   (see `00-overview.md` §Prerequisites). If a true Decline is ever wanted, validate that
   behavior in a controlled test first, then add it as a separate labeled action.

## Call controls UI

Ring state: **Answer** (primary, green) · **Dismiss** (secondary). Connected state: **Mute** /
**Unmute** (`call.mute()` / `call.unmute()`, reflect `isMuted`) · **Hang up** (danger-variant
button per the design-system classes in `style-guides/angular.md`). Show caller display name,
matched producer (click → navigate to profile via the shared pop logic), and elapsed time.
No dial-pad, no outbound calling, no transfer, no hold in this design — each is a deliberate
omission (outbound dialing is the most plausible future addition; it changes nothing structural).

## Backend endpoints

Identical to Option B — no additional backend surface for media/accept (media flows
browser↔Teams/ACS directly via WebRTC). See `02-option-b-hidden-listener.md` §Backend for
`GET /api/teams-calling/config` and `POST /api/teams-calling/token`
(`api/GrainOriginatorPortal.Api/Controllers/TeamsCallingController.cs`).

## Error handling

Follow `style-guides/error-handling.md`:

- Every SDK promise (`accept`, `mute`, `hangUp`) wrapped; failures → `callState('failed')` or a
  toast, never an unhandled rejection (the `GlobalErrorHandler` at
  `client/src/app/core/handlers/global-error.handler.ts` is the backstop, not the plan).
- Mic permission denied is a **normal path**, not an error: informational toast, no retry loop,
  telemetry event so support can see how often it happens.
- Mid-call token expiry: the proactive refresh loop (Option B) keeps the credential fresh;
  if refresh fails mid-call the call continues on the already-issued token — surface a warning
  only if the SDK raises it.
- Never log raw phone numbers client- or server-side — mirror the redaction posture of
  `api/GrainOriginatorPortal.Api/Services/TelemetrySanitizer.cs`.

## Costs and support burden

- ACS: $0.004 per participant per connected minute, browser leg only. A 10-minute answered call
  ≈ $0.04. Ringing costs nothing.
- Expected ticket categories unique to Option A: mic permission denied/reset, wrong
  input/output device, echo/quality complaints, "answered in browser but no audio" (usually a
  device or VPN/UDP issue). This burden is the reason Option B is the recommended default.

## Phased implementation plan

Milestones A1+ assume **Option B is fully shipped** (its plan covers infra, token exchange,
listener, screen-pop, guards). Do not start Option A from scratch.

| Milestone | Scope | Exit criteria |
|---|---|---|
| **A0** | Option B live in Dev (B1–B4 complete) | Screen-pop works with hidden listener |
| **A1 — drawer shell** | `call-drawer` component + header toggle + ring-state rendering from existing signals. No accept yet. | Drawer auto-opens on ring, shows caller + matched producer, Dismiss works, zero SDK calls added |
| **A2 — accept/media** | `askDevicePermission`, `.accept()`, connected state, mute, hang-up, timer. | Answer→talk→hang up works in Chrome + Edge on corporate laptops; permission-denied path verified; billing observed on the ACS resource matches connected minutes |
| **A3 — hardening** | Failure-path UX (`failed` state + retry), answered-elsewhere/missed distinction, telemetry events, multi-tab behavior re-verified with media (only the accepting tab gets media), style-guide + `npx vitest run` coverage for the service state machine | Support runbook written; QA sign-off |
| **A4 — rollout** | Enable in QA → Prod via the same config gates as Option B; monitor ACS spend and permission-denied telemetry for 2 weeks | Go/no-go review with actual usage + cost data |

Deferred (revisit only on demand): outbound dialing, device pickers, true Decline (after the
cross-endpoint behavior is validated), hold/transfer, call history.
