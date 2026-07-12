# Bid Sheet Map Migration — Sequencing & Rollout

## Table of Contents

- [Recommended build order](#recommended-build-order)
- [Rollout approach](#rollout-approach)
- [Definition of done](#definition-of-done)
- [Files touched — summary](#files-touched--summary)

## Recommended build order

Each step leaves the app runnable and independently verifiable.

1. **Backend: `MapConfigController`** (`02-backend-api.md`)
   - New controller + `MapConfigResponse` DTO, reading the existing `FieldTags:*` config keys with
     independent per-key gating.
   - Verify: `GET /api/map-config` returns `azureMapsKey`/`landMapMagicKey` independently — test
     with one key present and the other absent, confirm neither nulls the other out.
2. **Relocate the LandMapMagic service layer** (`03-frontend-components.md`)
   - Move `lmm-point-lookup.ts`, `lmm-aoi-query.ts`, `lmm-styles.service.ts`, `geo.ts` from
     `features/customers/services/field-tagging/` to `shared/services/land-map-magic/`; update the
     two import sites in `field-tag-map.component.ts`.
   - Verify: field-tagging's existing manual test checklist
     (`docs/maps/field-tagging/05-local-dev-setup.md`) still passes unchanged — this step must be a
     pure relocation with zero behavior change.
3. **`BidSheetMapComponent`, basemap + marker rendering only** (`03-frontend-components.md`)
   - New component, three-basemap MapLibre style (street-first default), DOM-marker port of
     `_refreshMapMarkers`/`_buildStackedLabel`/`_buildHoverIcon`/`_bindHoverExpand`/
     `_spreadOverlappingPins`, camera port (`flyTo`/`fitBounds`/`jumpTo`, lng-first coordinate
     order), `ApiService.getMapConfig()` wiring.
   - `BidSheetComponent`: extract the `mapRenderModel` computed(), wire `mapEngine` signal +
     `@if` dual-mount (MapLibre default per `bidSheetMapLibreDefault: true` in all env files),
     add the dev-visible engine-toggle button.
   - Verify: MapLibre path renders all locations with correct status colors/pin kinds at every
     zoom level, matching the still-present Leaflet path pin-for-pin when the toggle is flipped;
     click-to-select opens the panel and flies the camera correctly with the panel-width offset;
     add-location click-to-place-pin still saves via the unchanged `createBidSheetLocation` payload.
4. **CLU/Parcel optional view + JIT field-context lookup** (`03-frontend-components.md`)
   - Toggle UI (hidden when `landMapMagicKey` is null), lazy vendor-layer merge, click-to-inspect
     popup (read-only, no confirm button), pin-drop/pin-select JIT lookup wired to
     `fieldContextResolved`, Add Location form's new "Field context" section, `usageTracking`
     event on every AOI call.
   - This is the highest-risk step, mirroring field-tagging's own build order — the vendor
     integration is proven code being reused, but the "explicit action only, never bulk" constraint
     is new wiring, not a straight port. Manually verify: dropping a pin over known CLU/parcel
     coverage fires exactly one point-lookup + one AOI call (check network tab); panning over a
     screen full of pins with the toggle on fires zero calls until a pin is actually selected;
     toggling CLU/Parcel off and back on does not re-merge the vendor style or re-fetch anything
     already merged.
5. **Fullscreen/maximize + geocoded address search** (`03-frontend-components.md`)
   - Port `isMaximized`/`rootClass`/Escape-handler and `onAddressSearch()`/`flyToLocation` pattern
     into `BidSheetComponent` and the new map component respectively.
   - Verify: maximize covers the sticky header but not toasts/modals; address search flies the
     camera without disturbing the existing pin-name filter box.
6. **Full manual pass, both engines**
   - Run the full existing Bid Sheet manual workflow (TU/crop/year/month filters, search, Edit
     Bids, Add Location, refresh) against **both** `mapEngine` settings, confirming parity.

Dependency note: steps 3-5 all depend on step 1's contract (`MapConfigResponse` shape) being
frozen first if backend and frontend are built by different people/agents. Step 2 (the service-layer
relocation) can happen at any point before step 4 needs the relocated imports, and is otherwise
fully independent.

## Rollout approach

- **MapLibre is the default in every environment, including prod, from day one** — this is not a
  gradual environment-by-environment rollout. `bidSheetMapLibreDefault: true` everywhere.
- **Leaflet stays fully available, permanently, behind a runtime toggle** — not a temporary
  comparison window with a deletion deadline. The Leaflet-vs-MapLibre decision will be settled
  through direct use before any further Bid Sheet map work ships; whichever path is not chosen may
  be retired in a **separate, later** piece of work, not as part of this migration.
- No feature-flag-gated environment rollout is needed beyond the engine toggle itself, since
  `bid-sheet` is already gated end-to-end by the existing `environment.bidSheetEnabled` flag
  (`client/src/app/app.routes.ts`) — this migration doesn't add or change that gate.
- No data migration, no backfill, no schema change — nothing about this rollout is stateful or
  irreversible. Flipping `mapEngine` at runtime is the entire "rollback" story if MapLibre ever
  needs to be backed out mid-comparison.

## Definition of done

- Full manual pass (build-order step 6) passes for both `mapEngine` settings.
- `BidSheetLocation`/`BidSheetLocationBid`/`BidSheetEntry`/`Elevator` models are byte-identical to
  `main` — confirmed by diff, not just "no intentional edits."
- Every existing `ApiService` bid-sheet method signature and call site is unchanged.
- `FieldTagConfigController` and the field-tagging feature's own manual checklist are unaffected by
  the service-layer relocation (step 2).
- The Leaflet code path in `bid-sheet.component.ts` still compiles and renders correctly when
  `mapEngine` is flipped to `'leaflet'` — it must remain a fully working alternate path, not a
  frozen/rotting one.
- No AOI/point-lookup call fires for any pin the user hasn't explicitly clicked/selected — verified
  in the network tab per build-order step 4's manual check, not just by code review.
- No new secret lands in a committed `environment*.ts` file — vendor keys flow only through
  `GET /api/map-config`.

## Files touched — summary

| Path | Change |
|---|---|
| `api/GrainOriginatorPortal.Api/Controllers/MapConfigController.cs` | New |
| `api/GrainOriginatorPortal.Api/Models/Responses/MapConfigResponse.cs` | New |
| `client/src/app/shared/services/land-map-magic/{lmm-point-lookup,lmm-aoi-query,lmm-styles.service,geo}.ts` | New (relocated from `features/customers/services/field-tagging/`) |
| `client/src/app/features/customers/components/field-tag-map/field-tag-map.component.ts` | Modified — import paths only |
| `client/src/app/features/bid-sheet/components/bid-sheet-map/bid-sheet-map.component.{ts,html}` | New |
| `client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts` | Modified — `mapEngine` signal, `mapRenderModel` computed(), fullscreen/maximize, address search, engine-toggle button; **existing Leaflet code left in place, unmodified in behavior** |
| `client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.html` | Modified — dual `@if` mount for the two map engines, new Field-context section in the Add Location form |
| `client/src/app/core/services/api.service.ts` | Modified — add `getMapConfig()` |
| `client/src/app/models/bid-sheet.model.ts` | **Unchanged** |
| `client/src/environments/environment*.ts` (all four) | Modified — add `bidSheetMapLibreDefault: true` |
| `client/package.json` / `client/angular.json` | **Unchanged** — no dependency added (maplibre-gl already present from field-tagging) or removed (leaflet/markercluster stay) |
