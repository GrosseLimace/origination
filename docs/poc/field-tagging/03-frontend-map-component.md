# Field Tagging POC — FieldTagMapComponent (MapLibre)

## Table of Contents

- [Scope and placement](#scope-and-placement)
- [Dependencies](#dependencies)
- [Component contract (inputs/outputs)](#component-contract-inputsoutputs)
- [Map bootstrap (both modes)](#map-bootstrap-both-modes)
- [Sources and layers — complete inventory and add order](#sources-and-layers--complete-inventory-and-add-order)
- [Review mode](#review-mode)
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
| 2 | `tagged-fields` | **app-owned GeoJSON source** | — | both | FeatureCollection built from `tags` input; `promoteId: 'tagId'` |
| 3 | `tagged-fields-fill` | fill layer | `tagged-fields` | both | Semi-transparent fill; hover paint expression on `feature-state.hover` |
| 4 | `tagged-fields-outline` | line layer | `tagged-fields` | both | Solid outline; heavier width when hovered |
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
   `geometry = JSON.parse(tag.geometryJson)`, `properties: { tagId: tag.id }`. Add as source
   `tagged-fields` with **`promoteId: 'tagId'`** so `feature.id === tag.id` and
   `setFeatureState({ source: 'tagged-fields', id }, { hover })` works deterministically. Unlike
   the vendor's broken CLU promoteId, this one is fully under app control — the property is
   always present.
2. Rebuild via `source.setData(...)` whenever the `tags` input changes (an `effect()` on the
   input signal), including after each confirmed POST in select mode.
3. Paint: fill layer opacity keyed on `['boolean', ['feature-state', 'hover'], false]` (e.g. 0.15
   base / 0.35 hovered) and outline width similarly (2 / 4) — the same `case`-expression pattern
   the lcfs-poc synthetic selected layers use (`landmapmagic.ts` lines 173–202).
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
`externalRef` (parcel: immediately from `parcel_id`; CLU: requires the reconstructed/authoritative
geometry, so run the dup check *after* the AOI response for CLU — or pre-check the hull hash and
re-check the final hash post-AOI; the simple correct order is: parcel pre-check before AOI, CLU
check after AOI before POST). Compare against the `externalRef`s of the currently loaded `tags`
input. On match: emit `duplicateAttempted`, skip the POST, keep the picker open. Drawn fields
skip the client check entirely (hash of a hand-drawn polygon is unique in practice).

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
3. Match the response's CLU feature back to the clicked field **by `calcacres`, not index 0** —
   the reconstructed AOI can clip neighboring fields at its edges and the response order is not
   guaranteed (real bug lcfs-poc hit: a 15 ac neighbor sliver reported on a 158 ac field —
   `main.ts` lines 193–204). Use the matched feature's geometry as the authoritative stored
   geometry when present; else keep the source geometry.
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

Port of `reconstructFullCluGeometry` (`lcfs-poc/src/main.ts` lines 289–324) + `convexHull`
(`lcfs-poc/src/geo.ts` lines 89–112). Implement exactly:

1. Read `calcacres` (number) from the clicked tile feature's properties. If absent/non-number →
   return null (caller falls back to single fragment).
2. `map.querySourceFeatures('clu', { sourceLayer: 'clu', filter: ['==', ['get', 'calcacres'], calcacres] })`.
   This sees only tiles already fetched for the current viewport — **zero extra vendor tokens**.
3. Pool every vertex of every returned Polygon/MultiPolygon ring (exterior and holes; holes'
   points can't hurt a convex hull). Fewer than 3 points → return null.
4. Convex hull via Andrew's monotone chain, treating `[lng, lat]` as planar — fine at field scale
   (geodesic distortion negligible over a few hundred meters). Dedupe identical points first
   (lcfs-poc uses a Map keyed on `"lng,lat"`), sort by x then y, build lower and upper hulls with
   a cross-product `<= 0` pop condition, concatenate dropping each half's last point.
5. Close the ring (`[...hull, hull[0]]`) into a GeoJSON Polygon.
6. **Sanity check**: compute geodesic acres of the hull (spherical-excess `geometryAcres`, port
   from `geo.ts`). If `hullAcres < calcacres * 0.95` → return null. Rationale (lcfs-poc comment,
   lines 313–317): a convex hull of a concave true boundary can only overshoot, never
   meaningfully undershoot — a hull *smaller* than `calcacres` means the field never actually
   crossed a seam here (one fragment found) or something went wrong; the single-fragment fallback
   is safer.
7. Return the hull Polygon; caller uses it as the AOI (and hash fallback per `01-data-model.md`).

Known accepted limitation: for strongly concave fields the hull overshoots the true boundary; the
AOI-response authoritative geometry (matched by `calcacres`) corrects the *stored* geometry in
those cases. Fields whose `calcacres` collides with a different nearby field's identical
`calcacres` are theoretically mis-merged — astronomically unlikely at float precision and
viewport scale; accepted for the POC (same acceptance lcfs-poc made).

## Gotcha ledger (every one verified in lcfs-poc source)

| # | Gotcha | Fix | Source |
|---|---|---|---|
| G1 | Vendor `clu` source declares `promoteId: "id"` but CLU features have no `id` property → MapLibre sets every feature's id to `undefined` (it does NOT fall back to the native MVT id) → hover/select silently dead on CLU only | Strip `promoteId` from the `clu` source before `addSource` (parcels' `promoteId: "parcel_id"` is real — leave it) | `landmapmagic.ts` `fixSourcePromoteId`, lines 119–139 |
| G2 | Vendor style's `glyphs` host (`fonts.openmaptiles.org`) returns HTML with 200 OK → MapLibre feeds it to the PBF parser → "Unimplemented type: 4" AND, because glyph parse rejects the whole worker tile parse, **every layer** from that tile renders zero features (blank, unclickable CLU) | `map.setGlyphs('https://orangemug.github.io/font-glyphs/glyphs/{fontstack}/{range}.pbf')` before adding vendor layers | `landmapmagic.ts` lines 53–75 |
| G3 | The static glyph mirror can't serve comma-joined font fallback stacks → symbol layers 404 | Collapse each symbol layer's `text-font` array to its first entry during merge | `landmapmagic.ts` `simplifyTextFont`, lines 141–155 |
| G4 | Vendor style paints `feature-state.hover` but never references `selected` → `setFeatureState({selected:true})` is a visual no-op | Add synthetic `*-selected-outline` line layers whose width/opacity are `case` expressions on `feature-state.selected` | `landmapmagic.ts` lines 41–51, 173–202 |
| G5 | Vendor ships no CLU fill layer; line hit areas are ~1 px | Add transparent `clu-hit-fill` fill layer on the same source/source-layer as the hit/hover/click target | `landmapmagic.ts` lines 30–40, 158–171 |
| G6 | mapbox-gl-draw's default theme uses bare-array `line-dasharray` in `case` expressions → MapLibre's stricter validator rejects the style | Supply the minimal custom solid-line style set (6 layers, no dasharray) | `draw.ts` lines 24–69 |
| G7 | mapbox-gl-draw targets Mapbox CSS class prefixes | Patch `MapboxDraw.constants.classes.CONTROL_BASE/PREFIX/GROUP` to `maplibregl-ctrl*` before constructing | `draw.ts` lines 6–11 |
| G8 | AOI `include_geometry` (snake_case, per vendor docs) silently returns null geometry | Send camelCase `includeGeometry: true` | `aoi-query.ts` lines 99–102 |
| G9 | AOI rejects `parcels` as a layer | Parcel/drawn AOI queries send only the `cdl:<year>` layer | `point-lookup.ts` lines 50–55 |
| G10 | AOI response feature order not guaranteed; reconstructed AOI overlaps neighbors | Match response CLU feature by `calcacres`, never `features[0]` | `main.ts` lines 193–204 |
| G11 | Point-lookup CLU `id` is always the literal string `"unknown"` | Never use it as identity; identity = geometry hash (`01-data-model.md`) | `point-lookup.ts` lines 42–47 |
| G12 | CLU tiles only exist at zoom ≥ 12 | Synthetic CLU layers get `minzoom: 12`; select mode enters at zoom 15 | `config.ts` comment; `landmapmagic.ts` |

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
