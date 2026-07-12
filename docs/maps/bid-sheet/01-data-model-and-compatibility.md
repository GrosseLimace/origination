# Bid Sheet Map Migration — Data Model & Compatibility

## Table of Contents

- [Current-state findings](#current-state-findings)
- [Data model — unchanged](#data-model--unchanged)
- [API surface — unchanged](#api-surface--unchanged)
- [What actually changes](#what-actually-changes)
- [Compatibility guarantees](#compatibility-guarantees)

## Current-state findings

Verified by reading the actual code on `poc/field-tagging`, not assumed:

- **File**: `client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts` (2,900
  lines) + `bid-sheet.component.html` (1,122 lines). The map is inlined in the page component —
  there is no separate map component today.
- **Library**: Leaflet `1.9.4` + `leaflet.markercluster` `^1.5.3`, dynamically imported in
  `_initializeMapWhenReady()` (`await import('leaflet')`, `await import('leaflet.markercluster')`),
  **and** also globally loaded via `client/angular.json` scripts/styles
  (`leaflet.js`/`leaflet.markercluster.js`, `leaflet/dist/leaflet.css`,
  `MarkerCluster(.Default).css`).
- **Street basemap ("the openstreetmaps of the Bid Sheets screen")**: default view,
  `L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')` (`_initializeMap`, line
  ~2498).
- **Satellite basemap**: a 3-layer Esri stack, all unkeyed legacy endpoints —
  `server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (imagery)
  stacked with `.../Reference/World_Boundaries_and_Places/...` and
  `.../Reference/World_Transportation/...` (label/road overlays), combined into one
  `L.layerGroup` (`_satelliteLayer`).
- **Marker rendering**: `_refreshMapMarkers()` groups `allMapLocations()` by rounded lat/lng,
  renders zoom-dependent HTML `L.divIcon` pins (14px status-colored dots below zoom 6; stacked
  bid-value pills or stacked name labels at zoom ≥ 6), with a custom pixel-space
  `_spreadOverlappingPins()` declustering pass and a `leaflet.markercluster` `markerClusterGroup`
  (`maxClusterRadius: 12`, `disableClusteringAtZoom: 5` — effectively only active at national-
  overview zooms).
- **Hover**: `_bindHoverExpand()` swaps a marker's icon for an expanded name+bid card on
  `mouseover`/`mouseout`, tracking the last-hovered marker so a stuck hover state can be
  force-reset.
- **Click → select**: `_selectMapLocation()` toggles `selectedLocationName`, opens the 420px side
  panel, and flies the camera via `_flyToLocation()` / `_offsetCenter()` — a manual
  project/unproject calculation that shifts the visual center left by half the panel width so the
  selected pin isn't hidden behind the panel.
- **Add-location flow**: `enterAddLocationMode()` → `_onMapClick()` drops a red "+" pin at the
  clicked lat/lng, opens a form (name, trade unit, Scoular-facility star) → `confirmAddLocation()`
  calls `apiService.createBidSheetLocation(...)`, optimistically inserts into `bidLocations()` /
  `allMapLocations()`, then opens the Edit Bids grid.
- **No client-side geocoding on this screen.** A code comment at the top of the map section
  (`bid-sheet.component.ts`, near `_L`/`_map` field declarations) explicitly states the geocode
  cache was already removed — "coordinates now come from API (`dbo.ElevatorCoordinates`)".
- **No deep-linking.** Zero `ActivatedRoute`/query-param/`localStorage`/`sessionStorage` usage
  anywhere in the component tied to map camera/view state.
- **Other Leaflet consumers** (scope boundary for this migration):
  `client/src/app/features/customers/components/map/customer-map.component.ts` and
  `client/src/app/features/customers/components/customer-map/customer-map.component.ts` (the Build
  List map) both use Leaflet + the same OSM street tile URL. `leaflet.markercluster` is **Bid
  Sheet-only** — confirmed no other component imports it.

## Data model — unchanged

`client/src/app/models/bid-sheet.model.ts`:

```ts
export interface BidSheetLocationBid {
  id: number;
  locationId: number;
  commodityCode: string;
  commodityName?: string;
  commodityCategory?: string;
  cropYear: number;
  month: number;
  bid: string;
  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;
}

export interface BidSheetLocation {
  id: number;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  elevatorCode?: string;
  tradeUnitCode: string;
  groupName?: string;
  isScoularFacility?: boolean;
  createdBy: string;
  createdAt: string;
  modifiedBy?: string;
  modifiedAt?: string;
  bids: BidSheetLocationBid[];
}

export interface BidSheetEntry { /* flattened location + one bid, unchanged */ }
export interface Elevator { /* unchanged */ }
```

None of these interfaces gain, lose, or rename a field as part of this migration.
`latitude`/`longitude` remain the only positional data `BidSheetLocation` carries — no geometry, no
`ExternalRef`, no `SelectionMethod`. (See `00-overview.md` → Future enhancements for why that's
deliberate.)

## API surface — unchanged

Every existing `ApiService` bid-sheet method keeps its exact signature and call sites:

| Method | Used for |
|---|---|
| `getElevators(tradeUnitCode?)` | Elevator lookup (non-map) |
| `getBidSheetLocations(tradeUnitCode)` | Per-TU location + bid load |
| `getAllBidSheetLocations()` | All-locations map load (`allMapLocations`) |
| `createBidSheetLocation(...)` | Add Location save — payload unchanged: `{ name, latitude, longitude, tradeUnitCode, groupName, isScoularFacility, bids: [] }` |
| `getBidSheetLocationOrder(tradeUnitKey)` | Saved location display order (non-map) |
| `getBidSheetPreference(tradeUnitKey)` | Saved crop/month/print-layout prefs (non-map) |

New surface added by this migration (additive, not a change to the above):

- `ApiService.getMapConfig()` → `GET /api/map-config` (see `02-backend-api.md`).

## What actually changes

Only the rendering layer and its immediately-surrounding UI:

1. Map library: Leaflet → MapLibre GL, in a **new** `BidSheetMapComponent` (details in
   `03-frontend-components.md`), mounted alongside (not replacing) the existing Leaflet code, gated
   by a runtime `mapEngine` signal.
2. Basemap tile source: OSM street tiles / unkeyed Esri satellite stack → Azure Maps raster
   tilesets (`microsoft.base.road` / `microsoft.imagery` / `microsoft.base.hybrid.road`).
3. New optional UI: CLU/Parcel view toggle, field-context (JIT AOI) lookup surfaced in the Add
   Location form and via click-to-inspect on existing pins, fullscreen/maximize toggle, geocoded
   address-search box, Leaflet/MapLibre A/B toggle button.
4. New backend surface: `MapConfigController` (additive; does not modify
   `FieldTagConfigController`).

Everything else — bid/status computation, panel behavior, filters, search-by-name, TU/crop/year/
month selection, Edit Bids grid, location ordering/preferences — is untouched.

## Compatibility guarantees

- **Model fields consumed as-is.** The new `BidSheetMapComponent` reads `BidSheetLocation.latitude`
  /`.longitude`/`.name`/`.tradeUnitCode`/`.isScoularFacility` and `BidSheetLocationBid` fields
  exactly as `_refreshMapMarkers()` does today — no new required fields, no optional-to-required
  tightening.
- **No URL/saved-view/Leaflet-specific state to migrate.** Confirmed absent above; there is nothing
  for a MapLibre swap to break on this axis.
- **Add Location save payload is unchanged.** The new field-context lookup is display-only and is
  never included in the `createBidSheetLocation` request body.
- **Status/bid-color computation moves, but does not change.** Today `_refreshMapMarkers()` mixes
  bid-status computation (`_getLatestBid`, `_computeItemStatus`, `_parseBid`, panel-name filtering)
  with drawing. This migration extracts the computation into a parent-owned `computed()` signal
  (a render-model), consumed identically by both the Leaflet and MapLibre rendering paths — the
  status-color rules themselves (`reference` blue, `beating` red, `matching` yellow, `none` gray,
  active-TU green) do not change.
- **Coordinate order is a porting hazard, not a compatibility change**: Leaflet is lat-first
  (`[lat, lng]`), MapLibre is lng-first (`[lng, lat]`). This affects only the new component's
  internal camera/marker code, never the stored data or the API contract.
