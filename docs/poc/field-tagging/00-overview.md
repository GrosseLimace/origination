# Field Tagging POC — Overview

Local-only proof of concept: optional tagging of USDA CLU / parcel / hand-drawn field boundaries
onto Customer (producer) records, rendered on MapLibre GL over an Azure Maps imagery basemap,
with vendor data from the third-party **LandMapMagic** API.

## Table of Contents

- [What this is](#what-this-is)
- [Reference implementation](#reference-implementation)
- [Settled decisions (do not re-litigate)](#settled-decisions-do-not-re-litigate)
- [Document map](#document-map)
- [Intentionally deferred / out of scope](#intentionally-deferred--out-of-scope)
- [Known deviations discovered during grounding](#known-deviations-discovered-during-grounding)

## What this is

A grain originator opens a producer's Customer Profile and sees a new **"Fields (N)"** pill tab.
Inside it: a field list (left, ~1/3 width) and a map (right, ~2/3 width). The map has two modes:

- **Review mode** (default): shows the producer's already-saved field boundaries plus the
  producer's address pin. Zero vendor network calls.
- **Select mode** ("Add fields"): overlays LandMapMagic CLU and parcel vector tiles and lets the
  user click-to-select a CLU field (Tier 1), click-to-select a tax parcel (Tier 2), or draw their
  own polygon (Tier 4). Each confirmed field persists immediately via POST; a "Done" button
  returns to review mode.

Saved tags carry calculated acreage and a CDL (Cropland Data Layer) crop breakdown snapshot. A
"Use calculated acres" action sums acreage across all active tags and writes it to the
user-editable `ProducerDetails.TotalAcres`.

Everything persists to a **local SQLite file** through a new, separate `FieldTagDbContext` —
deliberately isolated from the shared dev Azure SQL database. The whole feature is config-gated
and dormant unless local POC configuration is present.

## Reference implementation

The vendor integration was proven out in a sibling throwaway repo, **`/home/khague/ghe/lcfs-poc`**
(MapLibre GL + vanilla TypeScript, Vite, no backend). Porting instructions in these docs cite its
actual source files:

| lcfs-poc file | What it proves out |
|---|---|
| `src/map/map-init.ts` | Azure Maps imagery raster basemap under MapLibre |
| `src/map/landmapmagic.ts` | Style-merge of vendor CLU/parcel layers + promoteId/glyphs fixes + feature-state highlight layers |
| `src/map/draw.ts` | Tier 4 polygon drawing via `@mapbox/mapbox-gl-draw` on MapLibre |
| `src/api/point-lookup.ts` | 1-token point lookup; real response envelope + property names |
| `src/api/aoi-query.ts` | 10-token AOI query; camelCase `includeGeometry` gotcha; CDL year fallback |
| `src/geo.ts` | Geodesic acreage, RFC 7946 winding normalization, convex hull |
| `src/main.ts` | Tile-seam CLU reconstruction (`reconstructFullCluGeometry`), hover/selected feature-state wiring, confirm flow |
| `src/config.ts` / `.env.example` | Key handling, CDL year constants, tile URL template |
| `src/attestation.ts`, `src/ui/*.ts` | Record shape, tier selector, confirm popup, selection panel |

## Settled decisions (do not re-litigate)

All design decisions below are final for this POC. The remaining docs turn them into buildable
specs; they do not reopen them.

1. **Data model**: new `CustomerFieldTag` entity (see `01-data-model.md`), soft-deleted, audited
   to the same column conventions as `Note` / `PlantingIntention`, with a unique filtered index on
   `(CustomerId, ExternalRef) WHERE IsDeleted = 0`.
2. **ExternalRef dedup key**: CLU = SHA-256 of the *reconstructed, winding-normalized,
   coordinate-rounded* full-field geometry (never a raw tile-clipped fragment); Parcel = the
   vendor's stable `parcel_id`; Drawn = SHA-256 of the normalized drawn geometry.
3. **Persistence**: separate `FieldTagDbContext` on **local SQLite** with `EnsureCreated()`,
   config-gated on `FieldTags:LocalStorePath`. No EF migration ever runs against the shared dev
   Azure SQL DB for this feature.
4. **Visibility**: no new ACL. Anyone who can view the Customer Profile can see/edit field tags —
   the same posture as Notes/ProducerDetails (see `SECURITY-REVIEWS/ACCEPTED-RISKS.md` AR-01/AR-02
   comments cited in the existing controllers).
5. **Vendor call pattern**: Angular calls LandMapMagic **directly from the browser** (client-direct,
   matching lcfs-poc). The only new backend surface is CRUD on `CustomerFieldTag` plus a small
   authenticated map-config endpoint that hands the SPA its keys (keys live in dotnet
   user-secrets, never in committed files). Browser-visible keys are an accepted POC risk (free
   personal LandMapMagic account).
6. **Key storage phases**: local user-secrets now → dev Key Vault when a dev LandMapMagic license
   is purchased → prod Key Vault + revisit a server-side proxy if this ships beyond dev.
7. **Basemap**: Azure Maps imagery raster tiles (`atlas.microsoft.com/map/tile?tilesetId=microsoft.imagery`),
   reusing Karl's existing lcfs-poc Azure Maps key. No new Azure resource for the POC.
8. **MapLibre GL replaces Leaflet for this ONE feature only.** The existing Leaflet components
   (`client/src/app/features/customers/components/map/customer-map.component.ts` and
   `client/src/app/features/customers/components/customer-map/customer-map.component.ts` — both
   verified to exist and both Leaflet-based) stay completely untouched.
9. **One map component, two modes** (`review` / `select`), one MapLibre instance. Select mode
   merges the vendor style (never `setStyle()`), defaults to zoom 15 on the customer address
   point, and keeps the already-tagged-fields layer visible. Review mode fits bounds around all
   tag geometries **and** the address pin together (address pin at default zoom when zero tags).
10. **Confirm = immediate POST**, picker stays open, vendor `selected` feature-state clears, user
    can keep tagging. Client-side duplicate check on `ExternalRef` before POST (CLU/parcel only);
    backend unique index returns 409 as the fallback. "Done"/navigation/tab-close can never lose a
    confirmed tag — there is no staged/batch commit.
11. **Token budget per confirm**: exactly one AOI query (10 tokens, `includeGeometry: true` in
    camelCase). Hover/click previews cost one point-lookup (1 token). `parcels` is never sent as
    an AOI `layers` entry (the live API rejects it — confirmed in lcfs-poc `point-lookup.ts`
    comments and error text).
12. **"Use calculated acres"** is a user-triggered button that overwrites
    `ProducerDetails.TotalAcres` with the SUM of `CalcAcres` across the customer's active tags. It
    must NOT touch `Customer.TotalAcres` (ODS-synced; nightly sync would clobber it and vice
    versa) or `PlantingIntention.Acres` (per-crop-year; no 1:1 mapping to a field).
13. **UI**: "Fields (N)" pill tab on the Customer Profile (existing tab pattern in
    `customer-profile.component.html` / `.ts`), split-pane list+map, stacking vertically on narrow
    viewports. List rows show an auto-generated label, source badge, acres, CDL year + top crop,
    delete (soft), and an expandable full CDL breakdown.
14. **Two-way hover-highlight** between list and map keyed on `CustomerFieldTag.Id` (injected as
    `properties.tagId`, source added with `promoteId: 'tagId'`), state owned by a single parent
    component. Row **click** (not hover) flies/fits the camera to that field.

## Document map

| Doc | Contents |
|---|---|
| [`01-data-model.md`](01-data-model.md) | `CustomerFieldTag` schema, ExternalRef derivation, `FieldTagDbContext` + SQLite setup, config keys, NuGet package, DI wiring |
| [`02-backend-api.md`](02-backend-api.md) | Controllers/endpoints, request/response shapes, apply-calculated-acres semantics, validation, error contract, patterns to mirror |
| [`03-frontend-map-component.md`](03-frontend-map-component.md) | `FieldTagMapComponent` design, review/select modes, full MapLibre wiring ported from lcfs-poc, every gotcha, dependencies |
| [`04-frontend-list-and-hover-sync.md`](04-frontend-list-and-hover-sync.md) | Field list component, parent composition, hover-sync event contract, click-to-fly, "Fields (N)" tab wiring |
| [`05-local-dev-setup.md`](05-local-dev-setup.md) | Branch/keys/gitignore/run steps for Karl + manual test checklist |
| [`06-sequencing-and-open-items.md`](06-sequencing-and-open-items.md) | Recommended build order + deferred enhancements |

## Intentionally deferred / out of scope

These are **deliberate omissions**, not oversights. Revisit only if the POC proves out:

- **Server-side key proxy** for LandMapMagic/Azure Maps calls (style, tiles, point-lookup, AOI).
  POC is client-direct by decision; a proxy is the prod-hardening path.
- **User-editable field "Label" nickname column.** List rows use an auto-generated label only
  (e.g. "CLU field · 132.4 ac · captured 2026-07-11"). A nickname column is a documented future
  enhancement — see `04-frontend-list-and-hover-sync.md`.
- **Tier 3 / ML-derived boundaries.** Never built in lcfs-poc either (its tier selector renders
  Tier 3 as a disabled "coming soon" button). Omitted entirely here.
- **CDL year-refresh action** (re-running the AOI query on an existing tag to refresh
  `CdlYear`/`CdlSnapshotJson` to a newer CDL vintage).
- **SBOM updates / permanent dependency registration.** `maplibre-gl`, `@mapbox/mapbox-gl-draw`,
  and `Microsoft.EntityFrameworkCore.Sqlite` are branch-only for the POC. If the feature is ever
  promoted toward `main`, the README SBOM tables and package baselines must be updated per org
  policy at that point.
- **Real migrations / Azure SQL schema.** SQLite + `EnsureCreated()` only. Promotion would mean a
  proper EF migration on `ApplicationDbContext`, which is explicitly out of POC scope.

## Known deviations discovered during grounding

Two places where the repo's actual code refines the original design sketch (both incorporated
into the specs, flagged here so nobody trips on them):

1. **`CustomerId` is `long`, not `int`.** `Customer.Id` is `long` (bigint in ODS), and every
   application entity that references it (`Note`, `PlantingIntention`, `ProducerDetails`) uses
   `long CustomerId`. `CustomerFieldTag.CustomerId` follows suit. Route constraints use
   `{customerId:long}` like the existing controllers.
2. **Route shape.** Existing controllers use `[Route("api/[controller]")]` with
   `customer/{customerId:long}` sub-routes (there is no `/api/v1` prefix in the actual code,
   despite the README's "Base path: /api/v1" note — verified against `NotesController.cs` and
   `ProducerDetailsController.cs`). The settled customer-scoped route
   `/api/customers/{customerId}/field-tags` is kept, implemented as an explicit route attribute on
   a new dedicated controller — see `02-backend-api.md` for the reasoning.
