# Bid Sheet Map Migration — Overview

Migration of the Bid Sheet screen's map from **Leaflet + OpenStreetMap/Esri raster tiles** to
**MapLibre GL + Azure Maps raster tiles**, reusing the map UI stack already built and validated for
the field-tagging feature (`docs/poc/field-tagging/`). This is a rendering-layer swap, not a data
migration — `BidSheetLocation` and every existing Bid Sheet API call are unchanged. It additionally
brings optional, read-only **LandMapMagic CLU/Parcel** context onto the Bid Sheet map, retrieved
just-in-time per explicit user click — never persisted, never bulk-fetched.

## Table of Contents

- [What this is](#what-this-is)
- [Why](#why)
- [Reference implementation](#reference-implementation)
- [Settled decisions (do not re-litigate)](#settled-decisions-do-not-re-litigate)
- [Document map](#document-map)
- [Intentionally deferred / out of scope](#intentionally-deferred--out-of-scope)
- [Future enhancements](#future-enhancements)

## What this is

The Bid Sheet screen (`client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts`)
shows a full-screen map of elevator/delivery-location bid pricing. Today it's built on Leaflet with
two basemap choices (OpenStreetMap street tiles, a 3-layer Esri World Imagery/Boundaries/
Transportation stack for "satellite"), custom HTML div-icon pins showing bid values or status
colors, a marker-cluster group, and an "Add Location" click-to-place-pin flow.

This migration:

1. Replaces the Leaflet map with a new `BidSheetMapComponent` built on MapLibre GL, reusing the
   Azure Maps three-basemap pattern (`microsoft.imagery` / `microsoft.base.road` /
   `microsoft.base.hybrid.road`) already proven in `field-tag-map.component.ts`.
2. Adds an **optional CLU/Parcel view toggle** on the Bid Sheet map, and a **just-in-time field
   context lookup** fired only on explicit pin interaction (dropping a new location pin, or
   selecting an existing one) — read-only, informational, never persisted to `BidSheetLocation`.
3. Adds a fullscreen/maximize toggle and a geocoded address-search box, both ported from the
   field-tagging Fields tab.
4. Keeps the existing Leaflet implementation fully intact and available side-by-side behind a
   runtime engine toggle, so Leaflet vs. MapLibre can be A/B-compared before the Leaflet path is
   ever retired. MapLibre is the default in every environment, including prod, from day one.

## Why

Two independent problems converge on one fix:

- **Licensing/sustainability risk in the current tile sources.** The default street basemap pulls
  unauthenticated public OpenStreetMap tiles (`tile.openstreetmap.org`) — OSM's tile-usage policy
  discourages sustained commercial/internal production use at this volume. The satellite toggle
  pulls three **unkeyed legacy Esri endpoints**
  (`server.arcgisonline.com/ArcGIS/rest/services/World_Imagery|Reference/World_Boundaries_and_Places|Reference/World_Transportation`)
  that are not licensed for this kind of sustained internal use. Both are confirmed by reading
  `bid-sheet.component.ts` (`_initializeMap`, lines ~2490-2517) — not assumed.
- **A second, independently-built map stack already exists and is better.** The field-tagging POC
  (`poc/field-tagging` branch) already solved raster-basemap-under-MapLibre, Azure Maps tile URLs,
  fullscreen overlay, address search, and (for the LandMapMagic pieces) point-lookup/AOI-query
  vendor integration. Reusing it retires the licensing risk for free, using Azure Maps
  infrastructure the org already pays for.

## Reference implementation

Everything ported here comes from the same repo, same branch (`poc/field-tagging`, already
checked out), not an external POC:

| Source file | What it proves out, reused here |
|---|---|
| `client/src/app/features/customers/components/field-tag-map/field-tag-map.component.ts` | MapLibre init, 3-basemap raster style (never `map.setStyle()`), fullscreen z-index pattern's map half, popup dark-mode-safe styling, point-lookup + AOI query call sites, vendor style merge (`mergeLandMapMagicLayers`), CLU/parcel click-to-inspect wiring |
| `client/src/app/features/customers/components/field-tag-map/field-tag-map.component.html` | Address-search box markup, basemap-toggle markup, tier-selector markup (trimmed for Bid Sheet — no draw tier) |
| `client/src/app/features/customers/components/customer-fields/customer-fields.component.ts` | Parent composition: on-demand geocode-on-address ladder, fullscreen `isMaximized`/`rootClass` overlay pattern, `flyToLocation` nonce-command signal, `onAddressSearch()` |
| `client/src/app/shared/utils/geocode-address.ts` | Address resolution + cache-key helpers (not used for Bid Sheet's own location coordinates, which already come from the API — only relevant if a future geocode-driven camera default is added) |
| `client/src/app/core/services/app-state.service.ts` (`mapGeocodeCache`) | Shared geocode cache, referenced for parity — not written to by this feature, since Bid Sheet locations already carry lat/lng |
| `client/src/app/features/customers/services/field-tagging/lmm-point-lookup.ts`, `lmm-aoi-query.ts`, `lmm-styles.service.ts`, `geo.ts` | LandMapMagic point-lookup (1 token), AOI query (10 tokens), vendor style merge, geometry helpers — all plain-`fetch`-based with zero Customer/field-tagging coupling; relocated to a shared location for this feature (see `03-frontend-components.md`) |
| `api/GrainOriginatorPortal.Api/Controllers/FieldTagConfigController.cs` | Pattern for a runtime map-config endpoint that hands the SPA vendor keys without committing them to `environment*.ts` — Bid Sheet gets its own, decoupled endpoint (see `02-backend-api.md`) |

## Settled decisions (do not re-litigate)

All items below are final. The remaining docs turn them into buildable specs.

1. **This is a rendering-layer swap, not a data migration.** `BidSheetLocation`,
   `BidSheetLocationBid`, `BidSheetEntry`, `Elevator` (`client/src/app/models/bid-sheet.model.ts`)
   are unchanged. Every existing `ApiService` bid-sheet method (`getElevators`,
   `getBidSheetLocations`, `getAllBidSheetLocations`, `createBidSheetLocation`,
   `getBidSheetLocationOrder`, `getBidSheetPreference`) is unchanged and keeps being called exactly
   as today. Bid location coordinates are already server-provided (`dbo.ElevatorCoordinates`) — no
   client-side geocoding is added to this screen's core data flow.
2. **Basemap: three Azure Maps raster tilesets, street-first by default.** Reuse
   `microsoft.imagery` (satellite), `microsoft.base.road` (street + political boundaries, **the
   default view**, matching today's OSM-street default), `microsoft.base.hybrid.road` (transparent
   hybrid overlay — the functional replacement for today's 3-layer Esri satellite stack). Switching
   is visibility-only (`setLayoutProperty`), never `map.setStyle()`.
3. **No deep-linking or Leaflet-specific serialized state exists to break.** Confirmed by reading
   the full component: zero `ActivatedRoute`/query-param/`localStorage`/`sessionStorage` usage tied
   to map view state. The only persisted view-adjacent state (`getBidSheetLocationOrder`,
   `getBidSheetPreference`) is about location/crop ordering and print layout, not camera position,
   and is untouched by this migration.
4. **LandMapMagic (CLU/Parcel) is in scope, as optional read-only context — no geometry persisted
   this pass.** `BidSheetLocation.latitude/longitude` remains the single stored artifact. Two
   distinct, both-optional uses:
   - An always-available **CLU/Parcel view toggle** (off by default) that overlays vendor vector
     tiles for visual context, exactly like field-tagging's Tier 1/Tier 2 layers, but with no draw
     tool and no persistence path.
   - A **point-in-time field-context lookup**: dropping a new location pin, or selecting an
     existing bid-location pin (while the toggle is on), fires exactly one point-lookup + one AOI
     query at that coordinate and displays the result (CLU/parcel boundary info, county/state, top
     crop, acreage, owner) as read-only reference data. This validates "is this pin on the field I
     meant" without changing what gets saved.
   - This positions today's bare point as **explicitly legacy**: a future pass (see
     [Future enhancements](#future-enhancements)) could let a Bid Sheet location carry a real
     tagged boundary the same way `CustomerFieldTag` already does for producers' fields.
5. **AOI/point-lookup retrieval is strictly per-explicit-action, never bulk, never prefetched.**
   With potentially dozens of bid-location pins rendered at once, there is no batch call, no
   fetch-on-viewport, no fetch-on-hover, and no background warm-up. Exactly one vendor round-trip
   per one explicit user action (pin-drop, or a pin transitioning to "selected"), targeting exactly
   one point. See `02-backend-api.md` and `03-frontend-components.md` for the mechanism; see
   [Future enhancements](#future-enhancements) for the deferred caching idea this constraint
   intentionally does not build yet.
6. **Vendor-call monitoring.** Every field-context lookup fires a
   `usageTracking.postClickEvent('interaction', 'bidsheet', 'field-context-lookup', ...)` event
   (matching the existing tracking calls throughout `bid-sheet.component.ts`), giving a per-feature
   usage count independent of field-tagging's own AOI volume — answers "does Bid Sheet need its own
   vendor rate budget" empirically rather than needing an upfront capacity decision.
7. **Vendor key delivery is decoupled from field-tagging's gate.** A new `MapConfigController`
   (`/api/map-config`) returns `azureMapsKey`, `landMapMagicKey`, `cdlYear`, `cdlFallbackYear`
   independently per key — unlike `FieldTagConfigController`, which nulls everything unless *all
   three* of its config keys are present. Bid Sheet's basemap must work even if LandMapMagic isn't
   configured; the CLU/Parcel toggle independently hides itself if only the vendor key is missing.
8. **Shared LandMapMagic service layer, relocated out of the `customers` feature.**
   `lmm-point-lookup.ts`, `lmm-aoi-query.ts`, `lmm-styles.service.ts`, `geo.ts` move from
   `client/src/app/features/customers/services/field-tagging/` to
   `client/src/app/shared/services/land-map-magic/` — confirmed to have zero Customer/field-tagging
   coupling (plain `fetch` calls keyed only on lat/lng/geometry + a vendor key string). `draw-setup.ts`
   (Tier 4 polygon drawing) stays in the `customers` feature folder — Bid Sheet does not draw
   polygons in this pass.
9. **Fullscreen/maximize and geocoded address search are both in scope**, ported from
   `customer-fields.component.ts`'s `isMaximized`/`rootClass`/Escape-handler pattern and
   `onAddressSearch()`/`flyToLocation` nonce pattern respectively. Additive to, not a replacement
   for, the existing pin-name-filter search box.
10. **Leaflet is not deleted.** The existing Leaflet implementation
    (`_initializeMap`/`_refreshMapMarkers`/etc. in `bid-sheet.component.ts`, plus
    `leaflet`/`leaflet.markercluster` in `package.json`/`angular.json`) stays permanently available,
    mounted side-by-side with the new `BidSheetMapComponent` behind a runtime `mapEngine` signal
    (`'leaflet' | 'maplibre'`). **MapLibre is the default in every environment, including prod,**
    from day one. A small dev-visible toggle button flips `mapEngine` at runtime with no reload, so
    the two can be A/B-compared directly; the Leaflet-vs-MapLibre decision will be settled before
    any further Bid Sheet map work ships, at which point the losing path may be retired in a
    separate follow-up (not part of this plan).
11. **markercluster stays wired for the Leaflet path only.** `leaflet.markercluster` is
    Bid-Sheet-only (verified: no other component imports it) and is not touched — it remains fully
    functional for whichever side of the A/B toggle is Leaflet. The new MapLibre path uses DOM
    markers with the existing pixel-space "spread overlapping pins" declustering logic, ported
    as-is; no MapLibre clustering is added in this pass (see `03-frontend-components.md` for the
    reasoning).

## Document map

| Doc | Contents |
|---|---|
| [`01-data-model-and-compatibility.md`](01-data-model-and-compatibility.md) | Current-state findings (Leaflet/OSM/Esri usage, data model, API surface), compatibility guarantees, what does/doesn't change |
| [`02-backend-api.md`](02-backend-api.md) | New `MapConfigController` design, config keys, decoupled-gating rationale, request/response shapes |
| [`03-frontend-components.md`](03-frontend-components.md) | `BidSheetMapComponent` design (inputs/outputs, marker rendering port, camera/add-location port), relocated LandMapMagic service layer, CLU/Parcel toggle + JIT field-context lookup, fullscreen + address search, Leaflet/MapLibre A/B toggle |
| [`04-sequencing-and-rollout.md`](04-sequencing-and-rollout.md) | Recommended build order, rollout approach, definition of done |

## Intentionally deferred / out of scope

Deliberate omissions for this pass, not oversights:

- **No CLU/parcel/drawn geometry persisted anywhere.** `BidSheetLocation` gains no new columns;
  the field-context lookup result lives only in component state, discarded when the Add Location
  form closes or a different pin is selected.
- **No Tier 4 (draw-your-own) tool on Bid Sheet.** Only the CLU/Parcel *view* toggle and
  click-to-inspect; no polygon drawing, no `draw-setup.ts` port.
- **No AOI-result caching or bulk display.** Strictly one-at-a-time, on explicit action — see
  settled decision 5 above and [Future enhancements](#future-enhancements) below.
- **No retirement of Leaflet or `leaflet.markercluster`** in this pass — see settled decisions 10-11.
- **No SBOM/package-baseline updates beyond what's already tracked** — `maplibre-gl` is already a
  committed dependency (added for field-tagging); no new package is introduced for Bid Sheet beyond
  what field-tagging already added.

## Future enhancements

Recorded here for visibility; **not being built now** — two forward-looking ideas from Karl to keep
on record for whoever picks up the next iteration of this feature:

1. **AOI data caching per pinpoint, shown in bulk.** This pass deliberately fetches field-context
   data (point-lookup + AOI query) strictly per explicit user action — one pin, one click, one
   cold vendor round-trip every time, never cached, never shown for more than the single
   selected/dropped pin at once (settled decision 5). A future enhancement would cache each
   pinpoint's AOI result once fetched, keyed by coordinate (or by `BidSheetLocation.id`), so that:
   - Previously-looked-up pins could have their field-context badge/summary shown in bulk across
     all visible pins simultaneously, instead of requiring a fresh click each time.
   - Clicking an already-cached pin would refresh/re-fetch that pin's entry (in case the underlying
     CLU/parcel/CDL data changed) rather than always doing a cold lookup — a re-fetch-on-demand
     model layered on top of the cache, not a cache that goes stale silently.
   - This would need its own vendor-token budget conversation (bulk-visible pins multiply the
     effective query volume even if each individual fetch is still user-triggered at least once)
     and a cache-invalidation policy (per-session only vs. persisted; CDL data is annual so a
     time-based staleness window may suffice).
2. **Eventually replace bare lat/lng pinpoints with saved field/parcel geometries.** The Customer
   Profile's Fields tab already made this exact transition for producers: ad-hoc coordinates were
   replaced by persisted `CustomerFieldTag` records carrying real CLU/parcel/drawn boundary
   geometry (`docs/poc/field-tagging/01-data-model.md`). This pass keeps
   `BidSheetLocation.latitude/longitude` as a bare point *deliberately* — explicitly framed as
   "legacy" once this future enhancement lands. A later pass could let an originator tag a bid-sheet
   delivery location with an actual field/parcel boundary the same way producers' fields are tagged
   today, which would:
   - Unify the two features' underlying data model (a shared "tagged geometry" concept usable by
     both Customer Profile and Bid Sheet).
   - Make today's Tier-4-less CLU/Parcel *view-only* toggle on Bid Sheet a natural stepping stone
     toward a real Tier 1/2/4 *select* mode there too.
   - Require schema work (`BidSheetLocation` gaining a geometry column or a new linked table),
     migration planning for existing point-only rows, and a decision on whether old point-only
     locations stay valid indefinitely (most likely: yes, coexisting with newer boundary-tagged
     ones, exactly as CLU/Parcel/Drawn already coexist as different `SelectionMethod` values within
     `CustomerFieldTag`).
