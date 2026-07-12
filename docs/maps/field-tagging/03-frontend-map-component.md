# Field Tagging POC — FieldTagMapComponent (MapLibre)

## Table of Contents

- [Scope and placement](#scope-and-placement)
- [Dependencies](#dependencies)
- [Component contract (inputs/outputs)](#component-contract-inputsoutputs)
- [Map bootstrap (both modes)](#map-bootstrap-both-modes)
- [Sources and layers — complete inventory and add order](#sources-and-layers--complete-inventory-and-add-order)
- [Review mode](#review-mode)
- [Rendering by selection method (CLU / Parcel / Drawn)](#rendering-by-selection-method-clu--parcel--drawn)
- [Select mode](#select-mode)
- [The confirm flow (one AOI query per confirm)](#the-confirm-flow-one-aoi-query-per-confirm)
- [CLU tile-seam reconstruction algorithm (restated precisely)](#clu-tile-seam-reconstruction-algorithm-restated-precisely)
- [Gotcha ledger (every one verified in lcfs-poc source)](#gotcha-ledger-every-one-verified-in-lcfs-poc-source)
- [Vendor service layer files](#vendor-service-layer-files)
- [Angular integration notes](#angular-integration-notes)

## Scope and placement

New standalone component:
`client/src/app/features/customers/components/field-tag-map/field-tag-map.component.ts` (+ `.html`)
— **new files, do not yet exist**. It is composed by the parent `CustomerFieldsComponent`
described in `04-frontend-list-and-hover-sync.md`.

MapLibre GL is used **only** by this component. The two existing Leaflet components (verified,
untouched): `client/src/app/features/customers/components/map/customer-map.component.ts` and
`client/src/app/features/customers/components/customer-map/customer-map.component.ts`.

## Dependencies

Add to `client/package.json` `dependencies` (branch-only for the POC; SBOM deferred per
`00-overview.md`):

| Package | Version | Why this version |
|---|---|---|
| `maplibre-gl` | `^4.7.1` | Exactly what lcfs-poc validated every gotcha against (`lcfs-poc/package.json`). Do not jump to v5 during the port — re-validating the style-merge/glyph/promoteId behaviors on a new major is avoidable risk. |
| `@mapbox/mapbox-gl-draw` | `^1.5.1` | Tier 4 drawing; lcfs-poc-proven on MapLibre with the shims described below. |
| `@types/mapbox__mapbox-gl-draw` | `^1.4.9` | devDependencies. |

CSS: `maplibre-gl/dist/maplibre-gl.css` and `@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css` must
be included — via the component's styles/`angular.json` styles array (lcfs-poc imports them in
`main.ts`; in Angular the `angular.json` `styles` array is the equivalent).

## Component contract (inputs/outputs)

Design-level signatures (Angular 21 signal `input()`/`output()`, standalone, `OnPush` — matching
`customer-profile.component.ts` conventions):

**Inputs**

| Name | Type | Purpose |
|---|---|---|
| `customer` | `Customer` (required) | Address pin from `customer.coordinates` (`Coordinates { lat, lng }` — verified in `client/src/app/models/customer.model.ts` line 32) |
| `tags` | `CustomerFieldTag[]` | The saved tags to render (parent owns the collection) |
| `mode` | `'review' \| 'select'` | Mode toggle — parent-owned |
| `hoveredTagId` | `number \| null` | List→map hover highlight |
| `flyToTagId` | `number \| null` | Row-click → camera fit (parent bumps this; component reacts and fits that tag's geometry) |
| `mapConfig` | `FieldTagMapConfig` | Keys + CDL years from `GET /api/field-tag-config` |

**Outputs**

| Name | Payload | Purpose |
|---|---|---|
| `tagHover` | `number \| null` | Map→list hover (tagId under cursor, null on leave) |
| `fieldConfirmed` | `FieldTagDraft` | User confirmed a selection/drawing; parent POSTs it. Payload carries `selectionMethod`, `geometryJson`, `calcAcres`, `externalRef`, `cdlYear`, `cdlSnapshotJson` — i.e. exactly `CreateFieldTagRequest`. |
| `duplicateAttempted` | `string` (externalRef) | Client-side dup check tripped; parent/list shows the "already tagged" warning toast |
| `selectError` | `string` | Vendor call failed (styles/AOI) — parent surfaces a toast via the existing `ToastService` |

The component never calls `ApiService` itself; the parent owns persistence. The component *does*
call LandMapMagic + Azure Maps directly (settled client-direct decision).

## Map bootstrap (both modes)

Port of `lcfs-poc/src/map/map-init.ts`:

1. Construct `maplibregl.Map` with an inline style spec: version 8, one raster source
   `azure-imagery` with tile URL template
   `https://atlas.microsoft.com/map/tile?api-version=2.0&tilesetId=microsoft.imagery&zoom={z}&x={x}&y={y}&subscription-key={AZURE_MAPS_KEY}`,
   `tileSize: 256`, attribution `© Microsoft — Azure Maps`; one raster layer `azure-imagery`.
   The key is interpolated from `mapConfig.azureMapsKey` (fetched at runtime — never a build-time
   constant, unlike lcfs-poc's Vite env var).
2. Controls: `NavigationControl` (no compass) top-left, `ScaleControl` imperial bottom-left —
   same as lcfs-poc.
3. Initial camera: review-mode rules below (do NOT copy lcfs-poc's hardcoded Nebraska center —
   that was a demo default).
4. Instantiate inside `afterNextRender` (the pattern both existing Leaflet components use for
   DOM-dependent init in this zoneless app) and `map.remove()` on `DestroyRef.onDestroy`.
5. All post-load wiring goes in the `map.on('load', ...)` handler, as lcfs-poc `main.ts` does.

## Sources and layers — complete inventory and add order

Order matters (later layers paint on top). Full inventory:

| # | Id | Kind | Source | Mode | Notes |
|---|---|---|---|---|---|
| 1 | `azure-imagery` | raster layer | `azure-imagery` (raster) | both | Basemap, part of the initial style |
| 2 | `tagged-fields` | **app-owned GeoJSON source** | — | both | FeatureCollection built from `tags` input; `promoteId: 'tagId'`; each feature's properties carry both `tagId` and `sourceMethod` (= the tag's `SelectionMethod`) — see [Rendering by selection method](#rendering-by-selection-method-clu--parcel--drawn) |
| 3 | `tagged-fields-fill` | fill layer | `tagged-fields` | both | Fill color/opacity keyed on a `match` expression over `sourceMethod`, composed with the existing `feature-state.hover` boost |
| 4 | `tagged-fields-outline` | line layer | `tagged-fields` | both | Outline color keyed on the same `sourceMethod` `match`; heavier width when hovered |
| 5 | `customer-pin` | marker | — | both | `maplibregl.Marker` at `customer.coordinates` (a Marker, not a layer — simplest) |
| 6 | `clu` | vendor vector source | — | select | From `/v1/styles` merge; **strip its broken `promoteId`** (gotcha G1) |
| 7 | `parcels` | vendor vector source | — | select | promoteId `parcel_id` works — leave as-is |
| 8 | `clu-outline`, `clu-labels` | vendor layers | `clu` | select | As returned; run text-font simplification on symbol layers (G3) |
| 9 | `parcels-fill`, `parcels-outline`, `parcels-labels` | vendor layers | `parcels` | select | As returned |
| 10 | `clu-hit-fill` | synthetic fill, opacity 0 | `clu` / source-layer `clu` | select | Hit-test target — vendor ships no CLU fill layer, and line layers have a sliver hit area (`landmapmagic.ts` comment, lines 30–39). `minzoom: 12`. |
| 11 | `clu-selected-outline` | synthetic line | `clu` / `clu` | select | Paints only when `feature-state.selected` (vendor style never wires `selected` — G4). `minzoom: 12`. |
| 12 | `parcels-selected-outline` | synthetic line | `parcels` / `parcels` | select | Same, `minzoom: 14`. |
| 13 | `gl-draw-*` (6 layers) | draw plugin styles | plugin-managed | select (Tier 4) | Custom minimal style set — G6 |

Add order on entering select mode: vendor sources → vendor layers (in the style's own order) →
synthetic layers — exactly `mergeLandMapMagicLayers` in `lcfs-poc/src/map/landmapmagic.ts`
(lines 82–117). The `tagged-fields` source/layers were added earlier (at load) and simply remain;
vendor fills land above them visually, which is acceptable because tagged fields keep their
distinct color and the list still highlights them.

The layer-id constants in `landmapmagic.ts` are confirmed against a live `/v1/styles` response
(header comment, lines 16–28): CLU group ships `clu-outline` + `clu-labels` only; parcels group
ships `parcels-fill`, `parcels-outline`, `parcels-labels`. Source ids are `clu` and `parcels`
(plural). Hardcode them as lcfs-poc does; don't classify by name substring.

## Review mode

Default mode. **Zero LandMapMagic network calls** — assert this in a test by spying on
`fetch`/HttpClient if practical; it's a hard guarantee, not a hope.

1. Build a GeoJSON FeatureCollection from the `tags` input: one Feature per tag,
   `geometry = JSON.parse(tag.geometryJson)`,
   `properties: { tagId: tag.id, sourceMethod: tag.selectionMethod }`. Add as source
   `tagged-fields` with **`promoteId: 'tagId'`** so `feature.id === tag.id` and
   `setFeatureState({ source: 'tagged-fields', id }, { hover })` works deterministically. Unlike
   the vendor's broken CLU promoteId, this one is fully under app control — the property is
   always present. `sourceMethod` is what drives the per-method styling in
   [Rendering by selection method](#rendering-by-selection-method-clu--parcel--drawn) below.
2. Rebuild via `source.setData(...)` whenever the `tags` input changes (an `effect()` on the
   input signal), including after each confirmed POST in select mode.
3. Paint: outline/fill color keyed on a `match` expression over `properties.sourceMethod` (see
   next section), with opacity/width additionally boosted by
   `['boolean', ['feature-state', 'hover'], false]` (e.g. base fill-opacity 0.15 / hovered 0.35,
   base outline-width 2 / hovered 4) — the same `case`-expression pattern the lcfs-poc synthetic
   selected layers use (`landmapmagic.ts` lines 173–202), nested inside the `match` on method
   exactly as that file nests `case` inside per-layer paint properties.

## Rendering by selection method (CLU / Parcel / Drawn)

**Gap closed**: a customer can freely mix selection methods — e.g. 3 CLU-tagged fields, 1
parcel-tagged field (because the CLU boundary was bad there), 2 hand-drawn polygons — as
independent `CustomerFieldTag` rows (no schema change needed; each row already carries its own
`SelectionMethod` — see `01-data-model.md`). Rendering every tagged field identically regardless
of method would defeat the point of offering Parcel/Drawn as escape hatches: an originator
reviewing a producer's fields needs to tell at a glance which method produced which polygon,
especially to spot "this one was hand-drawn because the CLU boundary here was bad."

**Fix**: both `tagged-fields-fill` and `tagged-fields-outline` key their color off a `match`
expression on `properties.sourceMethod`, for example (exact hex values are a design-system
choice, not fixed here — pick from the app's existing Tailwind palette used elsewhere in the
Customer Profile, e.g. the amber/green/blue chip colors already in
`customer-profile.component.ts`'s `GRAIN_CHIP_BY_CROP`/`GRAIN_CHIP_PALETTE`):

| `sourceMethod` | Suggested treatment |
|---|---|
| `clu` | Solid outline, one distinct color (e.g. green) |
| `parcel` | Solid outline, a second distinct color (e.g. blue) |
| `drawn` | Dashed outline (`line-dasharray`) in a third distinct color (e.g. amber) — the dash pattern gives a second visual channel beyond color alone, which also helps colorblind users distinguish drawn fields without relying on hue |

Expression shape (paint property, described not coded): a `match` on `['get', 'sourceMethod']`
with three cases (`clu`, `parcel`, `drawn`) plus a fallback, and the hover boost applied as an
outer `case`/multiplication on top of whichever base value the `match` selects — i.e. the same
nested-expression composition pattern already used for hover+selected in
`lcfs-poc/src/map/landmapmagic.ts` (a `case` wrapping a value that itself varies), just with an
added `match` layer underneath.

**Legend**: add a small fixed-position legend overlay on the map (both modes; it's cheap and
always relevant in review mode too) listing the three method/color/pattern pairs above. A simple
absolutely-positioned panel in the component's template, matching the app's existing card styling
(`rounded-xl border ... bg-white dark:bg-gray-800 shadow-sm` — the classes used throughout
`customer-profile.component.html`), not a MapLibre-native control.

**Consistency with the list**: the list's source badge (`04-frontend-list-and-hover-sync.md`,
`FieldTagListComponent` row spec) must use the **same** color/pattern key as this legend — pass
the same three-method → color/pattern mapping to both (e.g. a small shared constant, colocated
with the map component or in a shared feature-level file, imported by both the map component and
the list component) so a user can correlate a list row to its map polygon by color without
re-learning the mapping per surface.
4. Address pin: `maplibregl.Marker` at `[customer.coordinates.lng, customer.coordinates.lat]`.
   If `coordinates` is absent (nullable on the model), skip the pin and fall back to fitting tags
   only; with neither tags nor coordinates, show a CONUS-level default.
5. **Camera**: with ≥1 tag — one `LngLatBounds` extended over **every coordinate of every tag
   geometry AND the address pin**, then `fitBounds` with ~40 px padding and `maxZoom` 16 (so a
   single small field doesn't slam to max zoom). With 0 tags — center on the address pin,
   zoom 13 (context without being useless).
6. Hover interactions on `tagged-fields-fill`: `mousemove` → first feature's id emitted via
   `tagHover` and local feature-state set; `mouseleave` → clear + emit null. This is the same
   wiring shape as lcfs-poc `wireLayerInteractions`/`setHover` (`main.ts` lines 70–100), pointed
   at the app's own layer.
7. React to `hoveredTagId` input changes: clear previous hover feature-state, set new. Feature-
   state writes are idempotent, so list-originated and map-originated updates can't feedback-loop
   (reasoning spelled out in `04-frontend-list-and-hover-sync.md`).
8. React to `flyToTagId`: compute that tag's geometry bounds, `fitBounds` with padding, maxZoom 16.

## Select mode

Entered when the parent flips `mode` to `'select'` ("Add fields" action).

1. **Camera on entry**: `flyTo` the customer's address point at **zoom 15** (settled). (CLU tiles
   only render at zoom ≥ 12 — lcfs-poc `config.ts` comment — so 15 lands comfortably inside the
   data range.)
2. **First entry only**: fetch the vendor style —
   `GET {LMM_BASE_URL}/styles?key={LANDMAPMAGIC_KEY}&target=maplibre&layers=clu,parcels` — and
   merge per the inventory above. **Never `map.setStyle()`** — that wipes the Azure imagery base
   AND the `tagged-fields` source. Merge = `addSource`/`addLayer` guarded by
   `getSource`/`getLayer` existence checks, exactly `mergeLandMapMagicLayers`. On re-entry the
   guards make the merge a no-op; just restore visibility.
3. Apply the glyphs fix (G2) and text-font simplification (G3) during the merge.
4. **Tier selector UI** (in-component overlay or parent toolbar): Tier 1 CLU (default), Tier 2
   Parcel, Tier 4 Draw. Tier 3 is omitted entirely (not even a disabled button — lcfs-poc kept a
   disabled placeholder; this port drops it). Tier switch behavior = lcfs-poc `onTierChange`
   (`main.ts` lines 53–66): CLU tier shows the CLU layer group and hides parcels; Parcel tier the
   inverse; Draw tier arms the draw controller without touching reference-layer visibility.
   Carry over the two hint strings from `lcfs-poc/src/ui/tier-selector.ts` (`TIER_HINTS`) — the
   parcel caveat ("may include non-farmable area…") and the draw instructions ("double-click to
   finish").
5. `tagged-fields` layers **stay visible** so the user sees what's already tagged; they are not
   click targets in select mode (skip/ignore their events while `mode === 'select'`, or rely on
   layer event ordering — explicit mode check is simpler and self-documenting).
6. Hover/click wiring on `clu-hit-fill` and `parcels-fill` per lcfs-poc `wireLayerInteractions`,
   gated on the current tier. Click →
   [point-lookup + preview popup](#the-confirm-flow-one-aoi-query-per-confirm).
7. **"Done" button** exits to review mode: hide vendor layer groups
   (`setLayoutProperty visibility none` — `setLayerGroupVisibility` in `landmapmagic.ts`),
   deactivate draw, clear hover/selected feature-states, close any popup, then re-run the review
   fitBounds. Because every confirm already persisted, Done/navigate-away/tab-close **cannot lose
   data** — state your test for this in `05-local-dev-setup.md`'s checklist.

## The confirm flow (one AOI query per confirm)

Port of `handleFieldClick` + `confirmSelection` (`lcfs-poc/src/main.ts` lines 112–231) and
`onPolygonDrawn` (lines 235–268):

**Click preview (CLU/parcel) — costs 1 token:**

1. On fill-layer click, call point-lookup:
   `GET {LMM_BASE_URL}/data/point?key=...&lat=&lng=&layers=clu,parcels`. Response envelope is
   `{ layers: { clu: { features: [...] } } }` — **not** a bare FeatureCollection (confirmed live,
   `point-lookup.ts` lines 32–41). CLU acreage = `properties.calcacres`; parcel id/acreage =
   `properties.parcel_id` / `properties.acreage_calc` (though live point-lookup never actually
   returns parcels — the tile feature's own properties are the parcel fallback, `main.ts`
   lines 133–145).
2. Set vendor `selected` feature-state on the clicked tile feature (renders via the synthetic
   selected-outline layers).
3. Show the preview popup (port of `ui/popup.ts`): acreage + Confirm button + "isn't right — try
   another tier" hint.

**Pre-POST duplicate check (CLU/parcel only):** before firing the AOI query, derive the candidate
`externalRef`. Both CLU and parcel can now be checked **immediately on click**, before the AOI
query fires — CLU identity is the clicked tile feature's native MVT id (`clu:` + `tileFeature.id`,
available the instant the feature is clicked, no vendor round-trip required — see
`01-data-model.md`), and parcel identity is `parcel:` + `parcel_id` (already immediate). This is
simpler than the original design, which had to defer the CLU dup check until after the AOI
response because identity depended on a reconstructed/hashed geometry. Compare the candidate
against the `externalRef`s of the currently loaded `tags` input. On match: emit
`duplicateAttempted`, skip the AOI query and the POST entirely (saves the 10-token AOI call too,
not just the write), keep the picker open. Drawn fields skip the client check entirely (hash of a
hand-drawn polygon is unique in practice).

**Confirm (CLU/parcel) — costs 10 tokens, exactly one AOI query:**

1. CLU only: run the reconstruction algorithm (next section). Source geometry preference:
   reconstructed hull → point-lookup feature geometry → clicked tile-fragment geometry
   (`main.ts` lines 175–183).
2. POST `{LMM_BASE_URL}/data/aoi?key=...` with body
   `{ aoi: <Feature with winding-normalized geometry>, layers, options: { includeGeometry: true } }`.
   - `layers`: CLU tier → `['clu', 'cdl:<year>']`; parcel and drawn tiers → `['cdl:<year>']`.
     **Never include `parcels`** — the live API rejects it as an invalid AOI layer (valid list:
     states, counties, plss, townships, sections, clu, cdl, ssurgo — `point-lookup.ts` lines 50–55).
   - **camelCase `includeGeometry`** — the vendor's own docs show `include_geometry`, which the
     live API silently accepts and returns `geometry: null` (confirmed bug note, `aoi-query.ts`
     lines 99–102). Snake_case here = a silent no-geometry failure that looks like it works.
   - CDL year fallback: try `cdl:{cdlYear}` (2024), on failure retry `cdl:{cdlFallbackYear}`
     (2023) — `aoiQuery` wrapper, `aoi-query.ts` lines 81–88.
3. Match the response's CLU feature back to the clicked field, **not `features[0]`** — the
   reconstructed AOI can clip neighboring fields at its edges and the response order is not
   guaranteed (real bug lcfs-poc hit: a 15 ac neighbor sliver reported on a 158 ac field —
   `main.ts` lines 193–204). The AOI response's CLU features don't carry the native MVT id (it's
   a vector-tile-only concept), so match by `calcacres` as lcfs-poc did — this remains a
   reasonable match key for this one step specifically, because at this point the pool of
   candidate features is already narrowed to whatever the just-submitted AOI intersects (a
   handful of features, not a whole tile), which is a much smaller collision surface than the
   tile-wide `calcacres` collisions the live-tile verification found (see
   `01-data-model.md` — those were same-tile collisions among many small slivers). Use the
   matched feature's geometry as the authoritative stored geometry when present; else keep the
   source geometry.
4. Acreage precedence: response feature `calcacres`/`acres` → popup (point-lookup) acreage →
   geodesic `geometryAcres` of the stored geometry, rounded to 1 decimal (`main.ts` line 215).
5. Compute `externalRef` (per `01-data-model.md`), build the draft
   (`selectionMethod`, `geometryJson`, `calcAcres`, `externalRef`, `cdlYear`,
   `cdlSnapshotJson` = serialized crop breakdown), emit `fieldConfirmed`.
6. Parent POSTs; on 201 it appends to `tags`, which re-`setData`s the tagged-fields source —
   **instant visual feedback**. Clear the vendor `selected` feature-state, close the popup,
   **stay in select mode**. On 409, treat as `duplicateAttempted`.

**Confirm (drawn) — costs 10 tokens:**

`draw.create` event yields the polygon. Acreage = geodesic `geometryAcres` (port `geo.ts`),
rounded to 1 decimal. AOI query with `['cdl:<year>']` only — for drawn fields the query is *CDL
enrichment only*; if it fails, still confirm the tag with empty breakdown and null `cdlYear`
(lcfs-poc `onPolygonDrawn` explicitly tolerates this, lines 244–253). Geometry stored is the
winding-normalized drawn polygon itself.

## CLU tile-seam reconstruction algorithm (restated precisely)

**Verification note (live-API, superseding the original `calcacres`-grouping design)**: a
throwaway Node script decoding live CLU tiles directly (`@mapbox/vector-tile` + `pbf`, already in
`lcfs-poc/node_modules`) confirmed that CLU tile features carry a real, stable **native MVT
feature id** that matches across adjacent tiles for the same physical field (27 confirmed cases
at z=14 in central Iowa), and that grouping fragments by rounded `calcacres` instead is unsafe —
two distinct fields in the same tile collided at `calcacres = 0.43`, and one rounded value
(`0.30`) covered 6 different native ids across two tiles. Full verification details and the
"why this is treated as durable, not just a snapshot" reasoning (LandMapMagic's CLU layer is
sourced from the FSA's 2008 public release, confirmed static by Karl) are in `01-data-model.md`
→ "CLU identity: native MVT feature id." **The reconstruction problem itself is unchanged** — a
field spanning a tile boundary still arrives as multiple disjoint fragments that must be pooled
and hulled to recover correct geometry/acreage — only the **grouping key** changes, from
`calcacres` to the native id. Port of `reconstructFullCluGeometry`
(`lcfs-poc/src/main.ts` lines 289–324) + `convexHull` (`lcfs-poc/src/geo.ts` lines 89–112), with
that one change. Implement exactly:

1. Read the clicked tile feature's **native id** (`tileFeature.id` in MapLibre — reliable once
   the broken `promoteId` is stripped from the `clu` source, gotcha G1). If null/undefined →
   return null (caller falls back to single fragment; this should be rare/never in practice once
   G1's fix is applied).
2. `map.querySourceFeatures('clu', { sourceLayer: 'clu', filter: ['==', ['id'], nativeId] })` —
   filtering on the feature id itself via MapLibre's `['id']` expression, not
   `['==', ['get', 'calcacres'], calcacres]`. This still sees only tiles already fetched for the
   current viewport — **zero extra vendor tokens**.
3. Pool every vertex of every returned Polygon/MultiPolygon ring (exterior and holes; holes'
   points can't hurt a convex hull). Fewer than 3 points → return null.
4. Convex hull via Andrew's monotone chain, treating `[lng, lat]` as planar — fine at field scale
   (geodesic distortion negligible over a few hundred meters). Dedupe identical points first
   (lcfs-poc uses a Map keyed on `"lng,lat"`), sort by x then y, build lower and upper hulls with
   a cross-product `<= 0` pop condition, concatenate dropping each half's last point.
5. Close the ring (`[...hull, hull[0]]`) into a GeoJSON Polygon.
6. **Sanity check**: compute geodesic acres of the hull (spherical-excess `geometryAcres`, port
   from `geo.ts`) against the feature's own `calcacres` property (still a useful cross-check
   value, just no longer the grouping key). If `hullAcres < calcacres * 0.95` → return null.
   Rationale (lcfs-poc comment, lines 313–317): a convex hull of a concave true boundary can only
   overshoot, never meaningfully undershoot — a hull *smaller* than `calcacres` suggests something
   went wrong (e.g. an unrelated fragment slipped into the id filter, which shouldn't happen given
   native-id precision, but the sanity check costs nothing to keep as a backstop); the
   single-fragment fallback is safer.
7. Return the hull Polygon; caller uses it as the AOI. **`ExternalRef` no longer falls back to a
   hash of this hull** — CLU identity is now the native id directly (`01-data-model.md`); the hull
   is used for the *stored geometry*/AOI request only, superseded by the AOI response's
   authoritative geometry when present (previous section, step 3).

Known accepted limitation: for strongly concave fields the hull overshoots the true boundary; the
AOI-response authoritative geometry corrects the *stored* geometry in those cases (matched by
`calcacres` at that later, already-narrowed step — see previous section). Grouping fragments by
native id, unlike the old `calcacres` grouping, is not subject to the same-tile acreage-collision
problem the live verification found — that was precisely the failure mode this change fixes.

### Multiselect: a simpler pattern the native id enables

Because the native id is a real, precise, stable per-feature key (not a today-only convenience),
a simpler client-side multiselect pattern than "reconstruct-and-confirm one field at a time" is
now natural: a `Map<nativeId, boolean>` (or `Set<nativeId>`) of "selected" CLU/parcel features,
toggled on each click, with the fill/outline restyled by set membership (a `case` expression
testing `['in', ['id'], ['literal', [...selectedIds]]]`, or per-feature `feature-state.selected`
toggling as lcfs-poc already does — either works now that the id is trustworthy). This is worth
considering as a UX refinement over strict one-at-a-time click→confirm→POST, but it does **not**
change the settled persistence behavior: **confirm still persists immediately per field, and the
picker still stays open for the next selection** (`00-overview.md` decision #10). Multiselect, if
implemented, would only change how the *selection* step feels (toggle several map features, then
a single "Confirm N fields" action fires one AOI query + one POST per field, or a batched AOI
query per field's own AOI — LandMapMagic's AOI endpoint takes one `aoi` geometry per call, so
"batched" here means firing them in sequence, not a real batch API) — it does not introduce a
staged/batch commit that could be lost on navigate-away. Treat this as an optional interaction
polish, not a required change to the confirm-flow contract described above; the one-at-a-time
description in [The confirm flow](#the-confirm-flow-one-aoi-query-per-confirm) remains the
baseline to implement first.

## Gotcha ledger (every one verified in lcfs-poc source)

| # | Gotcha | Fix | Source |
|---|---|---|---|
| G1 | Vendor `clu` source declares `promoteId: "id"` but CLU features have no `properties.id` → MapLibre sets `feature.id = undefined` for every CLU feature (it does NOT fall back to the native MVT id while `promoteId` is set) → hover/select silently dead on CLU only | Strip `promoteId` from the `clu` source before `addSource` (parcels' `promoteId: "parcel_id"` is real — leave it). Once stripped, MapLibre falls back to the tile's real native feature id — which live-tile verification confirmed is stable across adjacent tiles for the same field, making this fix also the basis for CLU identity/dedup, not just hover (see `01-data-model.md`) | `landmapmagic.ts` `fixSourcePromoteId`, lines 119–139 |
| G2 | Vendor style's `glyphs` host (`fonts.openmaptiles.org`) returns HTML with 200 OK → MapLibre feeds it to the PBF parser → "Unimplemented type: 4" AND, because glyph parse rejects the whole worker tile parse, **every layer** from that tile renders zero features (blank, unclickable CLU) | `map.setGlyphs('https://orangemug.github.io/font-glyphs/glyphs/{fontstack}/{range}.pbf')` before adding vendor layers | `landmapmagic.ts` lines 53–75 |
| G3 | The static glyph mirror can't serve comma-joined font fallback stacks → symbol layers 404 | Collapse each symbol layer's `text-font` array to its first entry during merge | `landmapmagic.ts` `simplifyTextFont`, lines 141–155 |
| G4 | Vendor style paints `feature-state.hover` but never references `selected` → `setFeatureState({selected:true})` is a visual no-op | Add synthetic `*-selected-outline` line layers whose width/opacity are `case` expressions on `feature-state.selected` | `landmapmagic.ts` lines 41–51, 173–202 |
| G5 | Vendor ships no CLU fill layer; line hit areas are ~1 px | Add transparent `clu-hit-fill` fill layer on the same source/source-layer as the hit/hover/click target | `landmapmagic.ts` lines 30–40, 158–171 |
| G6 | mapbox-gl-draw's default theme uses bare-array `line-dasharray` in `case` expressions → MapLibre's stricter validator rejects the style | Supply the minimal custom solid-line style set (6 layers, no dasharray) | `draw.ts` lines 24–69 |
| G7 | mapbox-gl-draw targets Mapbox CSS class prefixes | Patch `MapboxDraw.constants.classes.CONTROL_BASE/PREFIX/GROUP` to `maplibregl-ctrl*` before constructing | `draw.ts` lines 6–11 |
| G8 | AOI `include_geometry` (snake_case, per vendor docs) silently returns null geometry | Send camelCase `includeGeometry: true` | `aoi-query.ts` lines 99–102 |
| G9 | AOI rejects `parcels` as a layer | Parcel/drawn AOI queries send only the `cdl:<year>` layer | `point-lookup.ts` lines 50–55 |
| G10 | AOI response feature order not guaranteed; reconstructed AOI overlaps neighbors | Match response CLU feature by `calcacres` (safe at this narrowed step — see reconstruction section), never `features[0]` | `main.ts` lines 193–204 |
| G11 | Point-lookup CLU `id` is always the literal string `"unknown"` | Never use point-lookup's `id` as identity; use the vector-tile feature's **native MVT id** instead (`tileFeature.id`), confirmed stable across tiles — `01-data-model.md` | `point-lookup.ts` lines 42–47 |
| G12 | CLU tiles only exist at zoom ≥ 12 | Synthetic CLU layers get `minzoom: 12`; select mode enters at zoom 15 | `config.ts` comment; `landmapmagic.ts` |
| G13 | Rounded `calcacres` collides across genuinely distinct fields — confirmed via live tile decode (two fields in one tile both rounding to 0.43 ac; six distinct ids sharing 0.30 ac across two tiles) | Never use `calcacres` as a per-field identity/grouping key across a whole tile/viewport; use it only as a same-physical-field grouping hint *after* narrowing to a small AOI-response candidate set (step 3 of the confirm flow), or as a sanity cross-check, not identity | Live verification, see `01-data-model.md` "CLU identity: native MVT feature id" |

## Vendor service layer files

Port the lcfs-poc modules as plain TypeScript service files (suggested location
`client/src/app/features/customers/services/field-tagging/` — new directory):

| New file | Ports | Changes from lcfs-poc |
|---|---|---|
| `lmm-styles.service.ts` (or plain module) | `map/landmapmagic.ts` | Key from runtime `mapConfig`, not Vite env |
| `lmm-point-lookup.ts` | `api/point-lookup.ts` | Same; can stay `fetch`-based (vendor calls bypass the MSAL interceptor deliberately — do NOT let the app's auth interceptor attach a bearer token to vendor hosts; using plain `fetch` sidesteps the Angular `HttpClient` interceptor chain entirely, which is the simplest correct behavior) |
| `lmm-aoi-query.ts` | `api/aoi-query.ts` | Same |
| `geo.ts` | `geo.ts` | Verbatim port (pure functions) + add the canonical-serialize + SHA-256 helper (new — see `01-data-model.md`) |
| `draw-setup.ts` | `map/draw.ts` | Verbatim port |

## Angular integration notes

- Zoneless app: MapLibre event handlers run outside Angular's signal graph; when a handler
  updates component state, write to a `signal()` — that is the app's change-detection currency
  (see how the Leaflet components + `afterNextRender` are already used).
- `effect()`s bridge inputs → map calls: `tags` → `setData`, `mode` → enter/exit select,
  `hoveredTagId` → feature-state, `flyToTagId` → fitBounds. Guard all of them on "map loaded"
  (buffer the latest value until the `load` event, then flush).
- Container sizing: the split-pane can resize; call `map.resize()` when the tab becomes visible
  (the component is created on tab entry under the profile's `@switch`, so first render is fine,
  but a `ResizeObserver` on the container is cheap insurance).
- Popup content: lcfs-poc builds DOM nodes manually (`ui/popup.ts`); in Angular, either keep that
  (a `maplibregl.Popup` with `setDOMContent` on programmatically-built nodes is fine and avoids
  dynamic component hosting) or render an Angular template into the popup — the manual-DOM port
  is the lower-risk choice for a POC. Never `setHTML` with vendor-supplied strings (XSS posture).
