# Field Tagging POC — List, Parent Composition & Hover Sync

## Table of Contents

- [Component tree](#component-tree)
- [Client model + ApiService additions](#client-model--apiservice-additions)
- [The "Fields (N)" tab wiring](#the-fields-n-tab-wiring)
- [Parent: CustomerFieldsComponent](#parent-customerfieldscomponent)
- [FieldTagListComponent](#fieldtaglistcomponent)
- [Hover-sync event contract (exact)](#hover-sync-event-contract-exact)
- [Why there is no feedback loop (provably fine, not mysteriously fine)](#why-there-is-no-feedback-loop-provably-fine-not-mysteriously-fine)
- [Click-to-fly](#click-to-fly)
- [Deferred: user-editable Label nickname](#deferred-user-editable-label-nickname)

## Component tree

All new standalone components (none exist yet), under
`client/src/app/features/customers/components/`:

```
customer-profile (existing — gains one tab case)
└── customer-fields/customer-fields.component.ts        ← parent, owns state + persistence
    ├── field-tag-list/field-tag-list.component.ts      ← ~1/3 width
    └── field-tag-map/field-tag-map.component.ts        ← ~2/3 width (03-frontend-map-component.md)
```

Split-pane: CSS grid/flex, list ~1/3 / map ~2/3, both visible simultaneously; stack vertically
(list **above** map) below a Tailwind `lg` breakpoint. Match the Tailwind + dark-mode class
conventions used throughout `customer-profile.component.html` (e.g. `rounded-xl border
border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800`).

## Client model + ApiService additions

- New interface `CustomerFieldTag` in `client/src/app/models/customer-field-tag.model.ts`
  (**new file**), exported from `client/src/app/models/index.ts` (the `@models` barrel — path
  aliases verified in `client/tsconfig.json`). Fields mirror `FieldTagResponse` in
  `02-backend-api.md` (camelCase JSON). Include a couple of client-side derived helpers as plain
  functions (not on the interface): `parseGeometry(tag)`, `parseCdlSnapshot(tag)`,
  `topCrop(tag)`.
- New interface `FieldTagMapConfig` mirroring `FieldTagConfigResponse`.
- `ApiService` (`client/src/app/core/services/api.service.ts`) gains five methods, following the
  file's existing style (typed `Observable<T>`, `this.baseUrl` prefix, `catchError` via its
  `handleError` helper — see the Notes section of that file at lines ~498–540 for the template):
  - `getFieldTags(customerId: number): Observable<CustomerFieldTag[]>` → GET `/customers/{id}/field-tags`
  - `createFieldTag(customerId, draft): Observable<CustomerFieldTag>` → POST
  - `deleteFieldTag(customerId, tagId): Observable<void>` → DELETE
  - `applyCalculatedAcres(customerId): Observable<{ customerId; totalAcres; tagCount }>` → POST `.../apply-calculated-acres`
  - `getFieldTagConfig(): Observable<FieldTagMapConfig>` → GET `/field-tag-config`

## The "Fields (N)" tab wiring

The existing tab pattern, verified in `customer-profile.component.ts` /
`customer-profile.component.html`:

- Tabs are a private `_tabs` array of `{ id, label, shortLabel, count }`, rebuilt inside an
  `effect()` (component ~lines 347–361), exposed via a `get tabs()` getter; the template iterates
  `@for (tab of tabs; track tab.id)` rendering pill buttons with `{{ tab.label }} ({{ tab.count }})`
  and a `sm:hidden` short label (`.html` lines 388–402); content switches on `@switch (activeTab())`
  with one `@case` per tab id (lines 406–487); `selectTab()` also does usage-tracking + scroll.

Changes:

1. `customer-profile.component.ts`: add a `fieldTags` signal, loaded once per customer inside the
   same effect pattern used for `historicalContracts` (effect on `customer().id` →
   `apiService.getFieldTags(...)`), but **only when the feature is enabled** — gate on a
   `fieldTagConfig` signal populated from `getFieldTagConfig()` (fetch once; the service can
   cache/shareReplay like the ApiService's existing dedupe map). When disabled, the tab entry is
   simply not appended to `_tabs` — the whole feature disappears.
2. Append to `_tabs`: `{ id: 'fields', label: 'Fields', shortLabel: 'Flds', count: fieldTags().length }`.
   The template's existing `{{ tab.label }} ({{ tab.count }})` renders "Fields (N)" with no
   template change to the pill markup.
3. Template: new `@case ('fields')` in the `@switch`, rendering `<app-customer-fields>` with
   inputs `customer`, `tags` (= `fieldTags()`), `mapConfig`, and an output `tagsChange` that the
   profile writes back to its `fieldTags` signal — this keeps the pill count live as tags are
   added/deleted inside the tab.

Why the profile (not `CustomerFieldsComponent`) owns the fetch: the pill count must be correct
*before* the tab is ever opened, and the profile already owns per-customer data loading of this
kind (`historicalContracts`).

## Parent: CustomerFieldsComponent

`client/src/app/features/customers/components/customer-fields/customer-fields.component.ts`
(**new**). Standalone, OnPush, signals.

**Inputs**: `customer: Customer` (required), `tags: CustomerFieldTag[]`,
`mapConfig: FieldTagMapConfig`.
**Outputs**: `tagsChange: CustomerFieldTag[]` (emitted after any successful create/delete so the
profile's signal — and the pill count — stay authoritative).

**Owned state (single source of truth for hover sync):**

| Signal | Type | Written by | Read by |
|---|---|---|---|
| `hoveredTagId` | `number \| null` | list `rowHover` output AND map `tagHover` output | passed down to both children as input |
| `mode` | `'review' \| 'select'` | "Add fields" / "Done" buttons | map input |
| `flyToTagId` | `number \| null` | list `rowClick` output | map input (see click-to-fly) |

**Responsibilities:**

- Persistence: handles the map's `fieldConfirmed` output → `apiService.createFieldTag` → on 201
  append to the collection and emit `tagsChange` (picker stays open; map re-renders the new tag
  immediately via its `tags` input effect). On 409 → duplicate toast (below).
- Delete: handles the list's `delete` output → confirm dialog (reuse the shared dialog component
  under `client/src/app/shared/components/`) → `apiService.deleteFieldTag` → remove from
  collection, emit `tagsChange`.
- "Use calculated acres" button (in this component's header, next to a computed
  "Total: {sum} ac" readout): calls `applyCalculatedAcres`, then success toast
  ("Producer total acres set to N from M tagged fields") via the existing
  `ToastService` (`client/src/app/core/services/toast.service.ts`). Disabled when zero tags.
  Note: the profile header's "acres" line renders `customer().totalAcres` (ODS value) — the value
  written here lands on **ProducerDetails**.TotalAcres and shows wherever producer details are
  displayed/edited; do not expect the ODS header line to change. State this in the UI copy or
  tooltip to avoid confusion during testing.
- Duplicate warning: map's `duplicateAttempted` output (or a 409 from POST) → warning toast
  "This field is already tagged for this producer."
- Vendor errors: map's `selectError` → error toast.
- Empty state (zero tags, review mode): friendly panel in the list pane — "No fields tagged yet"
  + an "Add fields" button that flips to select mode.

## FieldTagListComponent

`client/src/app/features/customers/components/field-tag-list/field-tag-list.component.ts`
(**new**). Standalone, OnPush.

**Inputs**: `tags: CustomerFieldTag[]`, `hoveredTagId: number | null`.
**Outputs**: `rowHover: number | null`, `rowClick: number`, `delete: number` (all payloads are
tag ids).

Each row renders:

| Element | Source | Notes |
|---|---|---|
| Auto-generated label | derived | `"{source} field · {acres} ac · captured {date}"`, e.g. "CLU field · 132.4 ac · captured 2026-07-11". Source word: CLU / Parcel / Drawn. Acres to 1 decimal; omit segment when `calcAcres` null. Date = `createdAt` rendered in the user's local timezone (stored UTC). **Not** user-editable — see Deferred below. |
| Source badge | `selectionMethod` | Reuse the shared `BadgeComponent` (`client/src/app/shared/components/badge/`) with per-method color |
| Acres | `calcAcres` | |
| CDL year + top crop | `cdlYear`, `cdlSnapshotJson` | Top crop = max `intersectionAcres` entry, e.g. "2024 · Corn". Hide when snapshot null (drawn fields whose CDL enrichment failed) |
| Expand affordance | `cdlSnapshotJson` | Chevron toggling the full breakdown table: Crop (code) / acres / % of AOI — same columns lcfs-poc's sidebar table renders (`ui/sidebar.ts` lines 37–56). Follow the profile's existing expand pattern (grain-on-farm chevron toggle in `customer-profile.component.html` lines 263–300) |
| Delete action | — | Trash icon → emits `delete` (parent confirms + soft-deletes) |

Row behaviors:

- `mouseenter` → `rowHover.emit(tag.id)`; `mouseleave` → `rowHover.emit(null)`.
- Highlight CSS class applied when `hoveredTagId() === tag.id` (both hover origins funnel through
  the same input, so map-hover highlights the row identically to list-hover).
- When `hoveredTagId` changes to a row not in view, `scrollIntoView({ block: 'nearest' })` on
  that row — guard it to run only when the hover **originated from the map** (parent can pass an
  origin flag, or simpler: only scroll if the row element is outside the list's visible scroll
  area, which is inherently a no-op for list-originated hovers since the cursor is on the row).
- Click anywhere on the row (except delete/expand controls) → `rowClick.emit(tag.id)`.

## Hover-sync event contract (exact)

Design-level contract; all state flows through the parent's single `hoveredTagId` signal:

| Step | Direction | Event | Payload |
|---|---|---|---|
| 1a | list → parent | `rowHover` | `number \| null` |
| 1b | map → parent | `tagHover` | `number \| null` |
| 2 | parent | writes `hoveredTagId` signal | — |
| 3a | parent → map | `hoveredTagId` input | map clears previous feature-state, sets `{hover:true}` on the new id via `setFeatureState({ source: 'tagged-fields', id }, ...)` (works because the source was added with `promoteId: 'tagId'`) |
| 3b | parent → list | `hoveredTagId` input | list applies the highlight class to the matching row (+ conditional scroll-into-view) |

Map paint reacts through expressions keyed on `['feature-state', 'hover']` on the
`tagged-fields-fill`/`-outline` layers — the same expression pattern lcfs-poc's synthetic
selected layers use (`lcfs-poc/src/map/landmapmagic.ts` lines 173–202).

## Why there is no feedback loop (provably fine, not mysteriously fine)

The wiring *looks* circular (map hover → parent → map input reacts; list hover → parent → list
input reacts) but cannot oscillate, for three stacking reasons:

1. **Signals dedupe**: writing the same value to `hoveredTagId` (map emits 42, parent sets 42,
   map's input effect fires with 42) does not re-trigger downstream effects once the value is
   unchanged — Angular signal graph only propagates on value change (reference/primitive
   equality; tag ids are primitives).
2. **The sinks are idempotent**: `setFeatureState(id, {hover:true})` on an already-hovered
   feature and re-applying an already-present CSS class are both no-ops with no emitted events.
   Neither sink *generates* a new hover event — MapLibre `mousemove`/`mouseleave` fire only from
   real pointer movement, and the list's `mouseenter`/`mouseleave` likewise. State application
   never synthesizes pointer events.
3. **One owner**: neither child holds its own copy of hover state that could disagree with the
   parent; both render purely from the parent's value. There is no second source to reconcile.

So a strict origin-tracking loop-guard is unnecessary. Document this reasoning in a comment on
the parent's signal so the next maintainer doesn't add one defensively.

## Click-to-fly

Confirmed requirement, distinct from hover: clicking a list row fits the camera to that field.

- List `rowClick` → parent sets `flyToTagId`. Because clicking the *same* row twice should
  re-fly (signal equality would swallow it), model the input as
  `{ tagId: number, nonce: number } | null` (parent increments the nonce per click) — the
  standard signal-input pattern for imperative "commands". Keep this detail; it is the one place
  naive signal wiring genuinely breaks.
- Map reacts: parse that tag's geometry, build bounds over its coordinates, `fitBounds` with
  ~40 px padding and `maxZoom` 16 (matching review-mode camera constants).
- Click-to-fly works in both modes (in select mode it's a convenience to jump back to an
  existing field; it does not exit select mode).

## Deferred: user-editable Label nickname

**Out of scope for this POC — deliberately.** The list shows only the auto-generated label. If
the POC moves forward, the enhancement is: nullable `Label` string column (e.g. max 100) on
`CustomerFieldTag`, inline rename affordance on the row, `PATCH`/`PUT` endpoint setting
`ModifiedBy`/`ModifiedAt`, auto-label as fallback when `Label` is null. Recorded here so it is
findable; do not build any of it now.
