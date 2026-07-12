# Bid Sheet Map Migration — Frontend Components

## Table of Contents

- [Component split](#component-split)
- [Relocated LandMapMagic service layer](#relocated-landmapmagic-service-layer)
- [`BidSheetMapComponent` — inputs and outputs](#bidsheetmapcomponent--inputs-and-outputs)
- [Basemap](#basemap)
- [Marker rendering port](#marker-rendering-port)
- [Camera and add-location port](#camera-and-add-location-port)
- [CLU/Parcel optional view + click-to-inspect](#cluparcel-optional-view--click-to-inspect)
- [JIT field-context lookup on pin-drop/pin-select](#jit-field-context-lookup-on-pin-droppin-select)
- [Fullscreen/maximize](#fullscreenmaximize)
- [Geocoded address search](#geocoded-address-search)
- [Leaflet/MapLibre A/B toggle](#leafletmaplibre-ab-toggle)
- [Container/CSS gotcha](#containercss-gotcha)

## Component split

New: `client/src/app/features/bid-sheet/components/bid-sheet-map/bid-sheet-map.component.{ts,html}`,
standalone, `OnPush`, modeled on `FieldTagMapComponent`'s skeleton:
`afterNextRender(() => this.initMap())` in the constructor, `DestroyRef.onDestroy(() => {
resizeObserver?.disconnect(); map?.remove(); })`, and a private `loaded` signal that buffers
`effect()`s until `map.on('load')` fires — the exact pattern already proven at
`field-tag-map.component.ts` lines 189-261.

This pulls the ~450 lines of map code (`_initializeMap`, `_refreshMapMarkers`,
`_spreadOverlappingPins`, `_buildStackedLabel`, `_buildHoverIcon`, `_bindHoverExpand`, `_esc`,
`_destroyMap`, `toggleMapView`, camera helpers) out of the 2,900-line
`bid-sheet.component.ts` into its own file, rather than swapping the tile library in place. The
parent (`BidSheetComponent`) keeps every non-map signal, filter, panel, and Edit Bids concern
exactly as today.

**Key design move**: today `_refreshMapMarkers()` mixes *bid-status computation*
(`_getLatestBid`, `_computeItemStatus`, `_parseBid`, panel-name filtering — tied to 20+ parent
signals) with *drawing*. This split moves the computation into a parent-owned `computed()`
(`mapRenderModel`), and the child (in either engine) only draws from it. This is the mechanism
behind the compatibility guarantee in `01-data-model-and-compatibility.md`: neither map engine can
drift from how bids/statuses are derived, because both consume the identical render model.

## Relocated LandMapMagic service layer

Move (not duplicate — a straight relocation with import-path updates):

| From | To |
|---|---|
| `client/src/app/features/customers/services/field-tagging/lmm-point-lookup.ts` | `client/src/app/shared/services/land-map-magic/lmm-point-lookup.ts` |
| `client/src/app/features/customers/services/field-tagging/lmm-aoi-query.ts` | `client/src/app/shared/services/land-map-magic/lmm-aoi-query.ts` |
| `client/src/app/features/customers/services/field-tagging/lmm-styles.service.ts` | `client/src/app/shared/services/land-map-magic/lmm-styles.service.ts` |
| `client/src/app/features/customers/services/field-tagging/geo.ts` | `client/src/app/shared/services/land-map-magic/geo.ts` |

Confirmed reuse-safe by inspection: all four files use plain `fetch` against
`api.landmapmagic.com` (deliberately not `HttpClient`, so the app's auth interceptor never attaches
a Scoular bearer token to the vendor host), keyed only by lat/lng/geometry and a vendor key string —
zero `Customer`/field-tagging-specific types or imports. `draw-setup.ts` (the Tier 4 draw
controller, `@mapbox/mapbox-gl-draw` wiring) is **not** part of this move — it stays in
`features/customers/services/field-tagging/`, since Bid Sheet does not draw polygons in this pass.

After the move, update the two import sites in
`client/src/app/features/customers/components/field-tag-map/field-tag-map.component.ts` to the new
paths. No behavior change to field-tagging.

`BidSheetMapComponent` imports directly from `client/src/app/shared/services/land-map-magic/`.

## `BidSheetMapComponent` — inputs and outputs

```ts
@Component({
  selector: 'app-bid-sheet-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './bid-sheet-map.component.html',
})
export class BidSheetMapComponent {
  // Data — parent-owned, unchanged models
  readonly locations = input.required<BidSheetLocation[]>();          // parent's allMapLocations()
  readonly renderModel = input.required<BidSheetMapRenderModel>();    // see below
  readonly addLocationMode = input<boolean>(false);
  readonly panelWidthPx = input<number>(0);                          // replaces _offsetCenter()

  // Camera commands — nonce'd, mirrors flyToTagId/flyToLocation in field-tag-map.component.ts
  readonly flyTo = input<{ lat: number; lng: number; zoom?: number; nonce: number } | null>(null);
  readonly fitAll = input<{ nonce: number } | null>(null);

  // Vendor config — from ApiService.getMapConfig()
  readonly azureMapsKey = input.required<string>();
  readonly landMapMagicKey = input<string | null>(null);   // null hides CLU/Parcel toggle
  readonly cdlYear = input<string | null>(null);
  readonly cdlFallbackYear = input<string | null>(null);

  // Outputs
  readonly locationSelected = output<BidSheetLocation>();             // replaces _selectMapLocation wiring
  readonly mapClicked = output<{ lat: number; lng: number }>();       // add-location pin placement
  readonly zoomChanged = output<number>();                            // parent recomputes renderModel (pin kind is zoom-dependent)
  readonly fieldContextResolved = output<FieldContextInfo | null>();  // JIT lookup result, see below
  readonly addressSearch = output<string>();                          // geocoded search box
}
```

`BidSheetMapRenderModel` (new interface, view-model only — not a persisted entity, defined in the
component file or a small colocated `bid-sheet-map.model.ts`):

```ts
interface BidSheetMapRenderModel {
  groups: {
    lat: number; lng: number; names: string[];
    pinKind: 'dot' | 'bidPills' | 'nameLabels' | 'expanded';
    items: { label: string; bg: string; border: string }[];
    hover: { name: string; bid: string; bg: string; border: string };
    isPanelOpen: boolean;
  }[];
}
```

Built by a new `mapRenderModel = computed(...)` in `BidSheetComponent`, containing exactly the
status/bid-color logic `_refreshMapMarkers()` has today (the `statusColors` table — reference blue
`#2563eb`, beating red `#dc2626`, matching yellow `#eab308`, none gray, active-TU green
`#00875F` — and the zoom/search/TU/crop filtering rules), unchanged in behavior, just relocated out
of the drawing loop.

## Basemap

Port `initMap()`'s style block from `field-tag-map.component.ts` (lines 324-356) unchanged:
three raster sources via an `azureTileUrl(tilesetId)` helper
(`atlas.microsoft.com/map/tile?api-version=2.0&tilesetId=...&subscription-key=...`), three layers
added up-front in the initial style, switched only via `setLayoutProperty('visibility', ...)` —
never `map.setStyle()`, which would wipe any merged LandMapMagic layers.

| Today (Leaflet) | New (MapLibre, Azure Maps) |
|---|---|
| Street = OSM raster (`{s}.tile.openstreetmap.org`) — **default** | `microsoft.base.road` — **new default**, parity with today's street-first default |
| Satellite = Esri `World_Imagery` + `World_Boundaries_and_Places` + `World_Transportation` (3 unkeyed legacy layers) | `microsoft.imagery` + `microsoft.base.hybrid.road` = the "Hybrid" toggle option — 1:1 functional replacement (imagery + roads + labels) |
| — | Plain `microsoft.imagery` ("Satellite") comes free with the shared 3-way toggle |

This retires both licensing-risk tile sources (unauthenticated OSM at production volume, unlicensed
Esri legacy endpoint) in one move, using the Azure Maps key infrastructure already paid for via
field-tagging. Toggle UI reused from `field-tag-map.component.html` lines 42-77 (basemap button
row), trimmed of nothing — Bid Sheet uses the identical three-way toggle.

`mapSwitching` loading-overlay signal is kept (same UX as today), but simplified: since all three
layers coexist in one MapLibre style, there's no old-layer-removal choreography — listen for
`map.once('idle')` after the visibility flip, with the same ~2.5s fallback timeout Leaflet's
version used, in case `idle` doesn't fire (fully cached tiles).

## Marker rendering port

Every current pin is a rich HTML div-icon (stacked pills, hover icon-swap, dynamic width from
label length) — this ports to MapLibre **DOM markers** (`new maplibregl.Marker({ element })`), not
symbol layers:

- `_buildStackedLabel`, `_buildHoverIcon`, `_esc`, the `statusColors` table, and the dot-HTML
  builder move into the render-model computed() (status/color/HTML-string generation) or stay as
  small pure functions the map component calls per render-model group — either placement is fine,
  the only requirement is they no longer read parent signals directly. Each becomes
  `document.createElement('div'); el.innerHTML = ...` (content is self-generated + `_esc`-escaped
  location names — identical XSS posture to today, since nothing here renders unescaped
  user-controlled HTML).
- Hover-expand: swap `el.innerHTML` on `mouseenter`/`mouseleave` (DOM markers support native DOM
  events directly on their element) instead of Leaflet's `setIcon`; keep the `_hoveredMarker`
  force-reset bookkeeping — the same stuck-hover hazard exists with DOM markers when two markers
  sit close together and a `mouseout` gets eaten. Raise z-order via `el.style.zIndex` instead of
  `setZIndexOffset`.
- `_spreadOverlappingPins`: ports as-is. Replace `map.project`/`unproject`/`L.point` calls with
  MapLibre's identically-shaped `map.project()`/`map.unproject()` — the union-find pixel-space
  declustering algorithm itself is library-agnostic.
- **`leaflet.markercluster` is dropped for the MapLibre path, replaced with nothing** (not with
  MapLibre's native `cluster: true` GeoJSON option). Justification from the actual existing config:
  `disableClusteringAtZoom: 5` + `maxClusterRadius: 12` means clustering only ever acts at zooms
  0-4 on near-coincident pins — and at those zooms the map already renders 14px dots that
  `_spreadOverlappingPins` de-overlaps. Marker count is bounded by total Bid Sheet locations (one
  DOM marker per coordinate group), comfortably within DOM-marker rendering limits. If national-
  overview dot density ever proves noisy in practice, MapLibre's native clustering is the documented
  fallback — not built speculatively here.
- Anchor semantics: Leaflet `iconAnchor: [w/2, h]` (bottom-center) → MapLibre `anchor: 'bottom'`;
  dots → `anchor: 'center'`.

## Camera and add-location port

- `setView([38.5, -98.0], 5|6)` → `map.jumpTo({ center: [-98.0, 38.5], zoom })`. **Note the
  lng-first coordinate order** — Leaflet is `[lat, lng]`, MapLibre is `[lng, lat]`; this is the
  single most likely porting bug across every camera call.
- `_flyToLocation` + `_offsetCenter` (manual pixel-space project/unproject to shift center left of
  the open panel) → `map.flyTo({ center, zoom, padding: { right: panelOpen ? 420 : 0 } })` —
  MapLibre's native `padding` option on `flyTo`/`fitBounds` replaces the manual math entirely.
  `fitBounds(bounds, { paddingTopLeft, paddingBottomRight })` → `fitBounds(bounds, { padding: { top:
  50, left: 50, right: rightPad, bottom: 80 }, maxZoom: 12 })`.
- Add-location: `map.on('click', e => ...)` gives `e.lngLat` directly. The red "+" pin becomes one
  DOM marker. Everything else — the form overlay, `confirmAddLocation()`, the optimistic
  `bidLocations`/`allMapLocations` update, the Edit Bids handoff — is parent template/logic and
  **does not change**; the overlay markup in `bid-sheet.component.html` (lines ~500-620) stays
  exactly where it is, just now listening to the new component's `mapClicked` output instead of a
  direct Leaflet click handler.
- `ResizeObserver` → `map.resize()` (identical pattern already used in `field-tag-map.component.ts`
  line 361).
- Add `NavigationControl({ showCompass: false })` top-left for zoom-control parity with Leaflet's
  default control (the floating filter bar sits at `left-14`, already clear of it). A
  `ScaleControl` is optional — skip for parity, add later if wanted.
- No `bindPopup`-style popup exists on the Bid Sheet map today (hover cards are icon swaps, not
  popups), so the dark-mode popup-contrast gotcha documented for field-tagging does not apply to
  the ported marker/hover code. It **does** apply to the CLU/Parcel field-context popup added below,
  which reuses field-tagging's popup helpers directly.

## CLU/Parcel optional view + click-to-inspect

Available at all times (not gated to add-location mode) — pure visual + informational context, no
persistence path:

- `showFieldContext = signal<'off' | 'clu' | 'parcel'>('off')`, UI ported from
  `field-tag-map.component.html`'s tier selector (lines 79-121) but trimmed: two buttons only, no
  "draw" tier, no `tierHint` copy (that text was specific to the CLU/parcel/draw *selection*
  workflow, which Bid Sheet doesn't have).
- Toggle hidden entirely when `landMapMagicKey()` is `null` (see `02-backend-api.md`).
- Lazy vendor-layer merge: reuse `mergeLandMapMagicLayers(map, key)` from the relocated
  `lmm-styles.service.ts` unchanged, called once on first toggle-to-on (the same
  `vendorLayersMerged` guard-flag pattern as `field-tag-map.component.ts`'s `enterSelectMode()`) —
  a Bid Sheet session that never touches the toggle costs zero vendor tokens and merges no extra
  map style.
- Click-to-inspect while a CLU/Parcel layer is visible: reuse `wireVendorLayerInteractions` +
  `resolveAndShowFieldDetails` from `field-tag-map.component.ts` for the hover/click/popup mechanics
  verbatim, **minus the "Confirm this field" button and `fieldConfirmed` emit** — the popup becomes
  read-only info (acreage, county/state, top crop, owner), with no persistence path at all. This
  works in both normal browsing and add-location mode whenever the toggle is on.
- Popup styling reuses the existing dark-mode-safe fix already in `client/src/styles.css` (lines
  48-60): MapLibre's `.maplibregl-popup-content` box is always plain white regardless of app theme,
  so popup text/close-button colors are fixed, non-`dark:`-conditional — already handled globally,
  nothing new to fix here.

## JIT field-context lookup on pin-drop/pin-select

This is the mechanism satisfying "validate the point being selected is what's wanted," and it is
subject to a hard constraint (see `00-overview.md` settled decision 5): **exactly one vendor
round-trip per one explicit user action, targeting exactly one point — never bulk, never
prefetched, never hover-triggered.**

Two, and only two, triggers:

1. **Add-location pin-drop.** The existing `_onMapClick`-equivalent handler (active only in
   add-location mode) both captures `{ lat, lng }` for the new pin (unchanged — this is what gets
   saved) **and** fires one `pointLookup(lat, lng, key)` + one `aoiQuery(...)` call (reusing
   `resolveAndShowFieldDetails`'s logic minus the confirm-popup UI), emitting the result via
   `fieldContextResolved`. The parent renders it as a new read-only "Field context" section in the
   Add Location form (below the existing Lat/Lng readout): a loading spinner while in flight, then
   either a one-line summary (`"CLU field — 42.3 ac, Story County, IA — top crop: corn"` or the
   parcel equivalent) or `"No CLU/parcel data found at this point."` The result is **never** added
   to the `createBidSheetLocation` payload — discarded when the form closes or is cancelled.
2. **Selecting an existing bid-location pin**, while the CLU/Parcel toggle is on. This reuses the
   existing single-selection semantics of `_selectMapLocation`/`selectedLocationName` (only one
   location can be "selected" at a time today) — gating the AOI call on "a pin becomes selected" is
   a natural fit, not a new selection model. Hovering a pin, or a pin merely being rendered/visible,
   never triggers a lookup — only the click that flips selection state.

The CLU/Parcel **vendor vector tile layers** themselves (the boundary polygons drawn when the
toggle is on) are a separate, much cheaper tile fetch already gated lazily on first toggle-on —
that's normal MapLibre vector-tile streaming per viewport, not the token-metered point-lookup/AOI
calls the constraint above is about.

**Usage monitoring**: every time an AOI call actually fires (either trigger), emit
`usageTracking.postClickEvent('interaction', 'bidsheet', 'field-context-lookup', <coord-or-ref>)`,
matching the existing tracking calls throughout `bid-sheet.component.ts` (e.g.
`'locations-added'`, `'location-selected'`). This gives a per-feature usage count in the existing
usage dashboard, separable from field-tagging's own AOI volume.

`FieldContextInfo` (new local type, display-only, not a persisted entity):

```ts
interface FieldContextInfo {
  method: 'clu' | 'parcel' | null;   // null = neither found at this point
  acreage: number | null;
  county: string | null;
  state: string | null;
  topCrop: string | null;
  parcels: ParcelOwnerMatch[];        // reuse the exact shape from field-tag-map.component.ts
}
```

## Fullscreen/maximize

Port `isMaximized` signal, `rootClass` computed (the `fixed inset-0 z-[55]` overlay pattern,
carefully layered below the toast container's `z-[60]` and above the sticky `<app-header>`'s
`z-50`), and the `@HostListener('document:keydown.escape')` handler verbatim from
`customer-fields.component.ts` (lines 159-185) into `BidSheetComponent`.

## Geocoded address search

Additive to, not a replacement for, the existing pin-name-filter search box (`searchQuery`, which
keeps filtering visible bid-location pins by name exactly as today). New box reuses
`ApiService.geocodeSearch()` + a nonce'd `flyToLocation` command signal, ported from
`customer-fields.component.ts`'s `onAddressSearch()` (lines 248-266) and
`field-tag-map.component.ts`'s `flyToLocation` input/effect (lines 152, 256-260). Most useful while
in Add Location mode — jump the map to a customer/producer's address before dropping a pin, without
needing to already know its lat/lng.

## Leaflet/MapLibre A/B toggle

Leaflet is **not deleted or scheduled for deletion** as part of this migration — both rendering
paths stay mounted permanently, gated by a runtime signal:

```ts
readonly mapEngine = signal<'leaflet' | 'maplibre'>(
  environment.bidSheetMapLibreDefault ? 'maplibre' : 'leaflet'
);
```

`bidSheetMapLibreDefault: true` in **every** `client/src/environments/environment*.ts` file,
including `.prod` — MapLibre is the default everywhere from day one. The toggle exists purely so
the Leaflet-vs-MapLibre decision (which will be settled before any further Bid Sheet map work ships)
can be made by direct side-by-side comparison, not as a permanent user-facing feature.

Template:

```html
@if (mapEngine() === 'maplibre') {
  <app-bid-sheet-map [locations]="allMapLocations()" [renderModel]="mapRenderModel()" ... />
} @else {
  <div #mapEl id="bid-locations-map" style="height: 100%; width: 100%;"></div>
  <!-- existing Leaflet init/_refreshMapMarkers code, unchanged -->
}
```

A small toggle button (bottom-left action row, next to `toggleMapView`/`refreshBids`), visible when
`!environment.production` (or a dedicated `showMapEngineToggle` flag, so it can also be flipped on
in prod for a supervised comparison session without a rebuild), flips `mapEngine.set(...)` at
runtime with no data reload — both paths already consume the same `allMapLocations`/`mapRenderModel`
signals per the component split above, so switching is instant.

Because nothing is deleted, `leaflet` + `leaflet.markercluster` stay in `package.json`/
`angular.json` indefinitely for as long as both paths coexist; this is an accepted bundle-size
tradeoff for a deliberate long-term A/B capability, not a regression to fix.

## Container/CSS gotcha

Copy the container pattern from `field-tag-map.component.html` line 10 exactly:

```html
<div #mapContainer class="absolute! inset-0"></div>
```

The `absolute!` (`position: absolute !important`) is load-bearing: MapLibre adds the
`.maplibregl-map` class to this container at runtime, and maplibre-gl's own stylesheet rule
(`.maplibregl-map { position: relative }`) has equal specificity to Tailwind's `absolute` utility
and wins on cascade order — silently demoting the container to `position: relative`, which defeats
`inset-0` and collapses the container to height 0 (clipping the correctly-rendered canvas via
maplibre's own `overflow: hidden`), leaving a blank map. This bit field-tagging once; the fix is
already known, just needs to be ported, not rediscovered.
