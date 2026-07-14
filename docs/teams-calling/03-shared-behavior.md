# Shared Behavior — Producer Matching & Unsaved-Changes Guard

Both options ([`01`](01-option-a-embedded-dialer.md) hands off here after ring; [`02`](02-option-b-hidden-listener.md)
is nothing *but* this hand-off) call one shared pipeline when an incoming call is detected. This
doc specifies that pipeline: number normalization, the match index, single/multi/zero-match
outcomes, screen-pop navigation, and the three-choice unsaved-changes guard. All of it is
Option-agnostic — nothing here touches the ACS SDK.

## Table of Contents

- [Entry point](#entry-point)
- [Phone number sources and normalization](#phone-number-sources-and-normalization)
- [Match index](#match-index)
- [Match outcomes](#match-outcomes)
- [Screen-pop navigation](#screen-pop-navigation)
- [Unsaved-changes guard](#unsaved-changes-guard)
- [New files summary](#new-files-summary)
- [Known limitations](#known-limitations)

## Entry point

**File**: `client/src/app/core/services/call-screen-pop.service.ts` (root-injected).

```ts
handleIncomingCall(info: IncomingCallInfo): Promise<void>
// info = { kind: 'pstn', e164: '+14025551234', displayName?: string }
//      | { kind: 'teamsUser', displayName?: string }   // internal VoIP — no phone to match; toast only
```

`TeamsCallingService` calls this from its `incomingCall` handler and nothing else — matching,
dialogs, and navigation are fully owned here so Option A's drawer and Option B's listener share
identical behavior.

## Phone number sources and normalization

Producer phone numbers exist in three places, in **inconsistent formats**:

| Field | Model (client) | Entity (API) | Format observed |
|---|---|---|---|
| ODS merchandising phone | `phone` in `client/src/app/models/customer.model.ts` | `Customer.Phone` (maps to `MerchandisingPhone`) in `api/GrainOriginatorPortal.Infrastructure/Data/Entities/Customer.cs` | ODS-sourced, format varies |
| ODS fallback phone | `extendedPrimaryPhone` (same model) | `Customer.ExtendedPrimaryPhone` (same entity) | ODS-sourced, format varies |
| User-entered override | `primaryPhone` in `client/src/app/models/producer-details.model.ts` | `ProducerDetails.PrimaryPhone` in `api/GrainOriginatorPortal.Infrastructure/Data/Entities/ProducerDetails.cs` | Stored **formatted** — `formatPhoneNumber` in `client/src/app/features/customers/components/edit-customer-dialog/edit-customer-dialog.component.ts` strips non-digits, caps at 10, stores `(402) 555-1234` |

Caller ID arrives as E.164 (`+14025551234`). Therefore:

**New util** `client/src/app/shared/utils/phone-match.ts` (pure functions, plain `.ts` module —
matching the existing util style of `client/src/app/shared/utils/contract-status.ts` etc.; unit
tests via `npx vitest run`):

```ts
/** '+14025551234' | '(402) 555-1234' | '402-555-1234' | '4025551234' → '4025551234'.
 *  Strips non-digits; drops a leading '1' from 11-digit NANP numbers; returns null for
 *  anything that doesn't normalize to exactly 10 digits (non-NANP → no match, by design). */
export function normalizePhone(raw: string | null | undefined): string | null;

/** Builds Map<normalizedPhone, CustomerPhoneMatch[]> from customers + producer details. */
export function buildPhoneIndex(customers: Customer[], details: ProducerDetails[]): PhoneIndex;
```

## Match index

The app already preloads everything needed — no new API call on ring:

- `appState.customers()` — `client/src/app/core/services/app-state.service.ts` (populated by
  `client/src/app/core/services/data-preload.service.ts`, trade-unit-scoped).
- `appState.producerDetails()` — same service, holds the `primaryPhone` overrides.

`CallScreenPopService` keeps a `computed()` index over those two signals, so the index rebuilds
automatically whenever the preload or a producer edit updates them (signals convention per
`style-guides/angular.md`). All three phone fields per customer are indexed; a number matching
any field counts, and one customer is reported once even if two of their fields match.

## Match outcomes

| Matches | Behavior |
|---|---|
| 0 | Toast (info) via `client/src/app/core/services/toast.service.ts`: `Incoming call: (402) 555-1234 — no producer match`. `displayName` appended when present. Duration ≥ 8 s (default 3 s is too short to act on). No navigation. |
| 1 | Run the [unsaved-changes guard](#unsaved-changes-guard); on pass, [navigate](#screen-pop-navigation) to the producer. Toast (success, short): `Incoming call: opening <name>`. |
| >1 | Open the **multi-match picker** dialog listing candidates (name, city/state, which phone field matched). User picks one → guard → navigate. Dismissible (Esc/backdrop/Cancel = do nothing) — an incoming call must never trap the user. |

**Multi-match picker**: new
`client/src/app/shared/components/incoming-call-picker/incoming-call-picker.component.ts`, built
on the shared `DialogComponent`
(`client/src/app/shared/components/dialog/dialog.component.ts` — `isOpen` input, `align="top"`,
z-`[60]` so it stacks over Option A's drawer). State + promise plumbing follows the existing
`ConfirmDialogService` pattern (`client/src/app/core/services/confirm-dialog.service.ts`:
signal-backed `isOpen`/`options`, `confirm(): Promise<...>` resolved by the component). Rendered
**once** in `client/src/app/app.component.html` next to `<app-toast-container/>` so it is
available on every route — note this is a deliberate extension of the current pattern, where
`ConfirmDialogComponent` (`client/src/app/components/ui/confirm-dialog/confirm-dialog.component.ts`)
is embedded per-host (e.g. by `customer-fields.component.ts`); a call can arrive on any screen,
so per-host embedding doesn't work here.

Multiple matches are a real case, not an edge case: linked/related producers (see
`client/src/app/shared/utils/linked-producers.ts`) and spouses commonly share a farm line.

## Screen-pop navigation

The producer profile is **not a route** — it renders when `HomeComponent` selects a customer.
The supported deep-link already exists: `client/src/app/features/customers/pages/home/home.component.ts`
subscribes to `queryParams` and calls `_selectCustomerById(customerId)` (lines ~225–237), which
also tolerates the preload still being in flight (it polls `customers()` for up to 5 s, lines
~303–318). The screen-pop reuses it:

```ts
this.router.navigate(['/'], { queryParams: { customerId: match.customerId } });
```

- Works from any route (`/dashboard`, `/bid-sheet`, …) and from within home itself (the
  `queryParams` subscription re-fires on param change).
- Also honors the existing optional params (`tab`, etc.) — not used by the pop.
- If the customer isn't in the trade-unit-scoped preload, the existing 5 s poll simply expires
  and nothing happens; the 0-match toast path usually catches this first (same scoping — see
  [Known limitations](#known-limitations)).

## Unsaved-changes guard

### What exists today (and why a new mechanism is needed)

There are **no `CanDeactivate` guards** in this app — `client/src/app/guards/` contains only
`auth.guard.ts` and `admin.guard.ts`, and no dirty-state confirmation exists on navigation
anywhere. Dirty state is tracked per-component with local signals/maps:

- Dashboard buffered yield/market-share edits — `client/src/app/features/dashboard/pages/dashboard/dashboard.component.ts`
  (~line 180: "Entries here = unsaved changes. Cleared on Save success or Cancel.").
- Bid sheet dirty bids — `_buildDirtyBids()` in
  `client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts`.
- Note editing — `editingNoteId` + draft text in
  `client/src/app/features/customers/components/customer-notes/customer-notes.component.ts`
  (`cancelEdit()` at ~198).
- Customer edit dialog (producer details / primary phone etc.) —
  `client/src/app/features/customers/components/edit-customer-dialog/edit-customer-dialog.component.ts`.
- Staged group-membership menu edits —
  `client/src/app/features/customers/components/customer-profile/customer-profile.component.ts` (~line 184).

Crucially, even if router `CanDeactivate` guards existed, they would not help: switching
producers is an **in-page signal change** (`selectedCustomer.set(...)` inside `HomeComponent`),
not a route deactivation. The guard therefore has to be an app-level registry that the pop flow
consults explicitly — and a future router guard could consult the same registry, so this doesn't
paint us into a corner.

### New: `UnsavedChangesService`

**File**: `client/src/app/core/services/unsaved-changes.service.ts` (root-injected, signal-based
— same service shape as `ConfirmDialogService`).

```ts
export interface UnsavedChangesHandle {
  /** e.g. 'note edit', 'producer details' — used in the dialog message */
  label: string;
  isDirty(): boolean;
  /** Persist the pending edit. Resolve true on success. */
  save(): Promise<boolean>;
}

register(handle: UnsavedChangesHandle): () => void;   // returns unregister fn
hasDirty(): boolean;                                   // any registered handle dirty?
```

Edit components register in their constructor with `DestroyRef`-driven cleanup:

```ts
const unregister = inject(UnsavedChangesService).register({
  label: 'note',
  isDirty: () => this.editingNoteId() !== null && this.draftChanged(),
  save: () => this.saveNote(),
});
inject(DestroyRef).onDestroy(unregister);
```

Rollout is incremental: wire the components above one at a time (notes and edit-customer-dialog
first — they're the ones a producer call most plausibly interrupts). Unwired components simply
keep today's behavior (silent loss on in-page switch), which is no worse than the status quo.

### The three-choice dialog

When the pop wants to navigate and `hasDirty()` is true, `CallScreenPopService` opens the
**unsaved-changes dialog** — new
`client/src/app/shared/components/unsaved-changes-dialog/unsaved-changes-dialog.component.ts`,
same `DialogComponent` + promise-service construction as the picker, rendered once in
`client/src/app/app.component.html`. Exactly three choices:

| Button | Semantics |
|---|---|
| **Leave & lose changes** (danger variant) | Resolve `'leave'` → navigate immediately; dirty components' edits are abandoned (their own state resets when the selected customer changes, as today). |
| **Save** (primary) | Resolve `'save'` → `await Promise.all(dirtyHandles.map(h => h.save()))`; on all-success → navigate. On any failure → error toast, **do not navigate** (degenerates to Stay so nothing is lost). |
| **Stay** (secondary / Esc / backdrop) | Resolve `'stay'` → no navigation. Toast (info, long): `Producer <name> is calling — click to open` so the pop isn't lost entirely. |

Ordering: guard first, then navigate; for multi-match, picker first, then guard (the user should
know *where* they'd be going before deciding to abandon edits).

## New files summary

| File | Kind |
|---|---|
| `client/src/app/core/services/call-screen-pop.service.ts` | Orchestrator (match → picker → guard → navigate) |
| `client/src/app/core/services/unsaved-changes.service.ts` | Dirty-handle registry |
| `client/src/app/shared/utils/phone-match.ts` (+ `.spec.ts`) | Normalization + index (pure, vitest-covered) |
| `client/src/app/shared/components/incoming-call-picker/…` | Multi-match dialog |
| `client/src/app/shared/components/unsaved-changes-dialog/…` | Three-choice dialog |
| Edits to `client/src/app/app.component.html` | Render both dialogs once, app-wide |
| Edits to the edit components listed above | `UnsavedChangesService.register(...)` wiring |

## Known limitations

1. **Trade-unit scoping.** The match index covers only the preloaded, TU-scoped customer set
   (`getCustomers(tradeUnits)` in `DataPreloadService`). A caller who is a Scoular producer
   outside the user's selected trade units yields "no producer match". Acceptable v1: the
   person answering typically serves the caller. If this bites, add
   `GET /api/customers/by-phone?number=` to
   `api/GrainOriginatorPortal.Api/Controllers/CustomersController.cs` (normalized comparison in
   `CustomerService`, read-only against the ODS context) as a fallback lookup — deferred until
   demonstrated need.
2. **Internal Teams VoIP calls** carry a `MicrosoftTeamsUserIdentifier`, not a phone number:
   toast-only (`displayName` shown). Matching Scoular colleagues to producer records is a
   non-goal.
3. **Shared numbers**: the multi-match picker handles them; there is no "primary vs family
   member" ranking beyond listing which field matched.
4. **Number hygiene**: ODS phone fields can be stale/blank; match quality is bounded by data
   quality. The `primaryPhone` override (already user-editable in the edit-customer dialog) is
   the correction mechanism, which conveniently doubles as the fix workflow when a pop misses.
