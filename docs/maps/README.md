# Maps in the Grain Originator Portal — Architecture (As Built)

This describes the mapping features **as they actually exist in the code today**, after all the
build → independent-review → remediation rounds — for a developer picking this up cold. It is the
counterpart to the original design docs in [`field-tagging/`](field-tagging/) and
[`bid-sheet/`](bid-sheet/), which capture the decisions made *before/during* the build. Where the
two differ, the code (and this doc) win; the design docs are preserved for rationale and context.

> **Status:** proof of concept, local-development only. See
> [`PATH-TO-PRODUCTION.md`](PATH-TO-PRODUCTION.md) for what remains. For a non-technical summary
> see [`OVERVIEW-for-leadership.md`](OVERVIEW-for-leadership.md).

## Table of Contents

- [The two features at a glance](#the-two-features-at-a-glance)
- [External systems](#external-systems)
- [Backend components (.NET 10 API)](#backend-components-net-10-api)
- [Frontend components (Angular 21)](#frontend-components-angular-21)
- [Shared LandMapMagic service layer](#shared-landmapmagic-service-layer)
- [Data flow: Customer Profile field tagging (read/write)](#data-flow-customer-profile-field-tagging-readwrite)
- [Data flow: Bid Sheet map (read-only)](#data-flow-bid-sheet-map-read-only)
- [Configuration and gating](#configuration-and-gating)
- [Key design decisions worth knowing up front](#key-design-decisions-worth-knowing-up-front)
- [External documentation links](#external-documentation-links)

## The two features at a glance

| | Customer Profile — "Fields" tab | Bid Sheet map |
|---|---|---|
| Purpose | Tag a producer's real field boundaries to their record | Plot delivery/elevator bid locations; optional field-context reference |
| Persistence | **Writes** `CustomerFieldTag` rows | **Read-only** — nothing new is persisted |
| Map engine | MapLibre GL (only) | MapLibre GL **and** Leaflet, side-by-side behind a runtime toggle |
| Field data use | Tier 1 CLU / Tier 2 parcel / Tier 4 draw — a *selection* workflow | CLU/parcel *view* + just-in-time look-only context lookup |
| Vendor cost per action | 1 token per preview click, 10 per confirmed field (AOI query) | 1 + 10 tokens per explicit pin-drop / pin-select only, never bulk |

Both features share the same map plumbing (Azure Maps basemap, LandMapMagic integration, CDL crop
overlay, fullscreen, address search) via a shared service layer described below.

## External systems

Three external services are involved. All three are reached with keys handed to the SPA at runtime
by the backend (never committed to Angular env files):

- **Azure Maps** — raster basemap tiles (satellite imagery + road) and, server-side, address
  geocoding. Uses a key already owned by Scoular.
- **LandMapMagic** — the third-party rural-land data vendor. Provides USDA **CLU** (Common Land
  Unit / farm-field) boundaries, cadastral **parcel** boundaries, and USDA **CDL** (Cropland Data
  Layer) crop classification, as MapLibre-compatible vector/raster tiles plus a REST data API
  (fuzzy search, point lookup, AOI query). Currently a free-tier personal account.
- The app's own **backend API**, which serves config/keys and (for field-tagging) persists tags.

**Important:** the LandMapMagic vendor calls are made **directly from the browser** (plain
`fetch`, deliberately bypassing the Angular `HttpClient`/MSAL interceptor so no Scoular bearer
token is ever attached to a vendor host). The vendor key therefore reaches the browser. This is an
accepted POC risk and a named production-hardening item — see
[`PATH-TO-PRODUCTION.md`](PATH-TO-PRODUCTION.md#vendor-key-exposure-server-side-proxy).

## Backend components (.NET 10 API)

| Path | Role |
|---|---|
| `api/GrainOriginatorPortal.Api/Controllers/FieldTagsController.cs` | CRUD + apply-calculated-acres for field tags. Route `api/customers/{customerId:long}/field-tags`. |
| `api/GrainOriginatorPortal.Api/Controllers/FieldTagConfigController.cs` | `GET /api/field-tag-config` — hands the SPA its keys for the Fields tab. **All-or-nothing** gating: `enabled` only when the SQLite store path *and* both keys are present. |
| `api/GrainOriginatorPortal.Api/Controllers/MapConfigController.cs` | `GET /api/map-config` — same keys for the Bid Sheet map, but **per-key independent** gating (basemap works even if the vendor key is absent). |
| `api/GrainOriginatorPortal.Api/Controllers/GeocodeController.cs` | `api/geocode` (`/single`, `/batch`, free-text search) — Azure Maps geocoding, proxied server-side. Backs both maps' address search and the older Build List map. |
| `api/GrainOriginatorPortal.Api/Services/FieldTagService.cs` (+ `IFieldTagService`, `Mappings/FieldTagMappings.cs`) | Validation, audit identity, entity↔DTO mapping, apply-calculated-acres semantics. |
| `api/GrainOriginatorPortal.Infrastructure/Repositories/FieldTagRepository.cs` (+ `Interfaces/IFieldTagRepository.cs`) | Data access over the field-tag context; soft-delete + audit conventions mirroring `NoteRepository`. |
| `api/GrainOriginatorPortal.Infrastructure/Data/Entities/CustomerFieldTag.cs` | The entity (audit quartet + soft-delete trio, `SelectionMethod`, `GeometryJson`, `CalcAcres`, `ExternalRef`, CDL snapshot). |
| `api/GrainOriginatorPortal.Infrastructure/Data/FieldTagDbContext.cs` | A **separate** EF Core context over a **local SQLite file**, created via `EnsureCreated()` — deliberately isolated from the shared `ApplicationDbContext`/Azure SQL. |
| `api/GrainOriginatorPortal.Infrastructure/FieldTagsPocDependencyInjection.cs` | `AddFieldTagsPoc(...)` — self-contained DI + startup wiring, dormant unless `FieldTags:LocalStorePath` is configured. Designed to unplug by deleting one file + one call site. |

Tests: `api/GrainOriginatorPortal.Api.Tests/.../Services/FieldTagServiceTests.cs` covers the
service layer (validation, dedup, apply-acres). No controller-level or `MapConfigController` tests
yet — see [`PATH-TO-PRODUCTION.md`](PATH-TO-PRODUCTION.md#testing).

## Frontend components (Angular 21)

**Customer Profile — Fields tab** (`client/src/app/features/customers/`):

| Path | Role |
|---|---|
| `components/customer-fields/` | Parent. Owns tag collection + persistence, hover-sync state, review/select mode, "Use calculated acres", fullscreen. Composes the list + map. |
| `components/field-tag-list/` | Left pane. Per-field rows: auto-label, source badge, acres, CDL year + top crop, expandable crop breakdown, delete. Two-way hover sync + click-to-fly with the map. |
| `components/field-tag-map/` | Right pane. The MapLibre map with **review** and **select** modes, Tier 1/2/4 selector, point-lookup preview, CLU tile-seam reconstruction, AOI confirm, per-method rendering. |
| `field-tag-style.ts` | Shared `SelectionMethod` → color/pattern constant, so map legend and list badge read consistently. |
| `services/field-tagging/draw-setup.ts` | Tier 4 hand-draw controller (`@mapbox/mapbox-gl-draw` on MapLibre). **Stays here** — field-tagging-only, not shared. |
| `models/field-tag.model.ts` | Client `CustomerFieldTag` interface + `parseGeometry`/`parseCdlSnapshot`/`topCrop` helpers. |

**Bid Sheet** (`client/src/app/features/bid-sheet/`):

| Path | Role |
|---|---|
| `components/bid-sheet-map/bid-sheet-map.component.{ts,html}` | The new MapLibre map component: DOM-marker rendering, camera/add-location, CLU/parcel view toggle, JIT field-context popup (read-only), fullscreen, address search. |
| `components/bid-sheet-map/bid-sheet-map.model.ts` | View-model types (`BidSheetMapRenderModel`, `FieldContextInfo`) — display-only, not persisted. |
| `pages/bid-sheet/bid-sheet.component.{ts,html}` | Parent page. Owns the `mapEngine` A/B signal, the `mapRenderModel` computed (bid-status/color logic, consumed identically by both engines), fullscreen, address search, and the still-present Leaflet path. |

**Shared** (`client/src/app/core/services/api.service.ts`): `getFieldTags`, `createFieldTag`,
`deleteFieldTag`, `applyCalculatedAcres`, `getFieldTagConfig`, `getMapConfig`, plus the geocode
methods. Environment files carry `bidSheetMapLibreDefault: true` (MapLibre is the default engine
everywhere).

## Shared LandMapMagic service layer

`client/src/app/shared/services/land-map-magic/` — extracted from the two map components once they
had both been built, keeping only the genuinely-shared pieces (things that only *looked* similar,
like tier-gating and tile-seam reconstruction, were deliberately left in the feature that owns
them):

| File | Responsibility |
|---|---|
| `maplibre-basemap.ts` | Azure Maps basemap plumbing: three raster tilesets added up-front at the bottom of the stack, switched by `setLayoutProperty` visibility (**never** `map.setStyle()`, which would wipe later-added sources). Backs the Map/Satellite toggle. |
| `lmm-styles.service.ts` | Merges the vendor CLU/parcel vector-tile style into the live map (`addSource`/`addLayer`, guarded), applying the documented gotcha fixes (broken `promoteId`, glyphs host, text-font stacks, synthetic hit/selected layers). |
| `lmm-point-lookup.ts` | 1-token point lookup (plain `fetch`). |
| `lmm-aoi-query.ts` | 10-token AOI query (crop stats + geometry); camelCase `includeGeometry`, CDL-year fallback. |
| `lmm-parcel-lookup.ts` | Client-side parcel-owner lookup — a spatial query against already-fetched parcel tiles (the vendor API returns no parcel data via point/AOI). |
| `lmm-popup.ts` | Shared read-only popup primitives + formatters (dark-mode-safe against MapLibre's always-white popup box). |
| `geo.ts` | Geodesic acreage, RFC 7946 winding normalization, convex hull, **polygon union** (`polygon-clipping`) for tile-seam reconstruction, and the SHA-256 canonical-serialize helper for the `drawn` dedup key. |
| `cdl-overlay.ts` | The translucent USDA CDL crop-type raster overlay (adjustable opacity, purely visual — no hit-testing, no popups), wired identically into both maps. |

## Data flow: Customer Profile field tagging (read/write)

```
Profile opens
  → ApiService.getFieldTagConfig()  → FieldTagConfigController  (keys + enabled?)
  → ApiService.getFieldTags(id)     → FieldTagsController → FieldTagService → FieldTagRepository → FieldTagDbContext (SQLite)
  → field-tag-map renders saved tags over Azure Maps imagery  (zero vendor calls in review mode)

User clicks "Add fields" (select mode)
  → browser fetches LandMapMagic vector-tile style + CLU/parcel tiles directly
  → click a field → point-lookup (1 token) → preview popup
  → Confirm → CLU tile-seam reconstruction → one AOI query (10 tokens, includeGeometry)
  → field-tag-map emits fieldConfirmed
  → customer-fields → ApiService.createFieldTag() → FieldTagsController (201)
  → tag appended, map re-renders instantly; picker stays open (no staged/batch commit to lose)

"Use calculated acres"
  → ApiService.applyCalculatedAcres() → sums active tags' CalcAcres, writes ProducerDetails.TotalAcres
    (never Customer.TotalAcres (ODS-synced) or PlantingIntention.Acres)
```

Dedup is by `ExternalRef` (`clu:` + native MVT feature id / `parcel:` + parcel_id / `drawn:` +
SHA-256 of normalized geometry), enforced by a unique filtered index on `(CustomerId, ExternalRef)
WHERE IsDeleted = 0` and a client-side pre-check.

## Data flow: Bid Sheet map (read-only)

```
Bid Sheet opens
  → ApiService.getMapConfig()        → MapConfigController  (per-key gating)
  → bid locations from the existing, unchanged bid-sheet API (lat/lng from dbo.ElevatorCoordinates)
  → mapRenderModel computed() derives status/bid colors (identical for both engines)
  → BidSheetMapComponent draws DOM markers over Azure Maps

Optional CLU/Parcel view toggle (hidden if no vendor key)
  → lazy vendor-style merge on first toggle-on (zero cost until then)

Field-context lookup — ONLY on an explicit pin-drop or pin-select
  → exactly one point-lookup (1) + one AOI query (10) at that single point
  → shown read-only in the Add Location form / popup; NEVER persisted, never bulk, never on hover
  → usageTracking.postClickEvent('interaction','bidsheet','field-context-lookup', …)
```

`BidSheetLocation` and every existing bid-sheet API call are byte-for-byte unchanged; this was a
rendering-layer swap plus additive read-only context.

## Configuration and gating

All keys live under a single `FieldTags:*` config section (dotnet user-secrets locally). Two
endpoints expose them with deliberately different gating:

- **`/api/field-tag-config`** — `enabled` requires `FieldTags:LocalStorePath` **and**
  `FieldTags:AzureMapsKey` **and** `FieldTags:LandMapMagicKey`. If any is missing the whole Fields
  tab disappears. (Field tagging is all-or-nothing.)
- **`/api/map-config`** — each key gated independently. The Bid Sheet basemap must render even
  when LandMapMagic isn't configured; only the CLU/Parcel toggle hides itself on a missing vendor
  key. `FieldTags:LocalStorePath` is irrelevant here and not read.

On a machine without the config, the whole thing is dormant — no tab, no errors, Bid Sheet still
works on Azure Maps.

## Key design decisions worth knowing up front

- **Never call `map.setStyle()`.** The Azure basemap, the app's tagged-fields source, the merged
  vendor layers, and the CDL overlay are all added incrementally; `setStyle()` would wipe them.
  Basemap switching is visibility-only.
- **CLU identity is the vector tile's native MVT feature id** (`clu:` + id), verified stable
  across adjacent tiles. Only hand-drawn fields are hashed. `calcacres` is a sanity cross-check,
  never an identity key (it collides across small slivers).
- **Tile-seam reconstruction** pools a CLU field's tile-clipped fragments (grouped by native id)
  and unions/hulls them into one true polygon, so a field spanning tiles is saved whole.
- **Leaflet is retained on Bid Sheet on purpose** — a permanent A/B comparison toggle, not a
  temporary migration window. The engine decision is deferred (see PATH-TO-PRODUCTION).
- **The Bid Sheet's field context is strictly per-explicit-action.** With dozens of pins on
  screen, there is deliberately no fetch-on-hover, fetch-on-viewport, or prefetch — one vendor
  round-trip per one click.

## External documentation links

Current, verified links for the external systems this integrates with:

- **LandMapMagic API docs** — <https://landmapmagic.com/docs> (Map Tiles: States/Counties/
  Townships/Sections/CLU/Parcels/CDL; Data API: fuzzy search, point lookup, AOI query; Map Styles:
  the `/v1/styles` per-target endpoint).
- **MapLibre GL JS docs** — <https://maplibre.org/maplibre-gl-js/docs/> (API reference, the
  [Style Specification](https://maplibre.org/maplibre-style-spec/), examples, guides).
- **`@mapbox/mapbox-gl-draw`** (Tier 4 drawing, runs on MapLibre with the documented shims) —
  <https://www.npmjs.com/package/@mapbox/mapbox-gl-draw>.
- **Azure Maps REST API reference** — <https://learn.microsoft.com/en-us/rest/api/maps/>. Relevant
  service groups: **Render** (map/satellite tiles) and **Search** (geocoding).
