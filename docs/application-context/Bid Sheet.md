# Bid Sheet

## At a Glance

- **Route**: `/bid-sheet` (env-gated by `environment.bidSheetEnabled`)
- **Component**: [`client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts`](../../client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts)
- **Template**: [`bid-sheet.component.html`](../../client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.html)
- **Access**: any authenticated Scoular user, **and** the env flag is enabled.
- **Primary user goal**: track competitor bids on a map, compare them against Scoular's reference location, and edit bids per location/commodity/month.

This is the merchandiser's competitive-pricing view. It overlays bid locations on a Leaflet map, color-coded by whether each location is matching, beating, or under reference.

## How users reach it

- "Bid Sheet" link in the sidebar (only present when `environment.bidSheetEnabled === true`).

## What it shows

| Section | Description |
| --- | --- |
| **Full-screen map** | Leaflet map with location markers. |
| **Floating filter bar** (top-left) | Trade Unit Selector, crop dropdown, year dropdown, month dropdown, status filter (Matching / Beating / All), text search, "Clear" button. |
| **Floating action buttons** (bottom-left) | "Add Location", "Refresh" (with time-since-refresh), "Bids" toggle to show/hide the side panel. |
| **Map legend** (bottom-right, collapsible) | "KEY" legend: blue = Reference, red = Beating, yellow = Matching. |
| **Slide-in bids panel** (right edge, ~420px) | Either a list of locations (drag-drop reorderable) or a detail view of a single location with editable name, action buttons ("Set as Reference", "Copy"…), and a bid grid (commodity × month). |

## Data flow

```mermaid
flowchart LR
    UI[Bid Sheet component]
    Elev[apiService.getElevators]
    Locs[apiService.getBidSheetLocations / getAllBidSheetLocations]
    SaveLoc[apiService.createBidSheetLocation / update / delete]
    Bids[apiService.bulkUpsertBidSheetBids / deleteBidSheetBids]
    Order[apiService.getBidSheetLocationOrder / setBidSheetLocationOrder]
    Pref[apiService.getBidSheetPreference / setBidSheetPreference]
    Geo[apiService.geocodeSearch]
    CTL[BidSheetController]
    SVC[SqlDataService]
    ODS[(ctrm.vw_GNP026 — Elevators)]
    APP[(dbo.BidSheetLocations<br/>dbo.BidSheetLocationBids<br/>dbo.BidSheetLocationOrders<br/>dbo.BidSheetPreferences<br/>dbo.ElevatorCache)]

    UI -- "init / TU change" --> Elev & Locs & Order & Pref
    UI -- "user edits a bid" --> SaveLoc & Bids
    UI -- "drag-drop reorder" --> Order
    UI -- "address search" --> Geo
    Elev --> CTL --> SVC --> ODS
    Locs & SaveLoc & Bids & Order & Pref --> CTL --> SVC --> APP
```

## Files

| Layer | Path |
| --- | --- |
| Component | `client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts` |
| Template | `client/src/app/features/bid-sheet/pages/bid-sheet/bid-sheet.component.html` |
| Print layout util (+ spec) | `client/src/app/features/bid-sheet/utils/print-layout.ts` — builds the `PrintLayoutModel` both the preview and the printed sheet render |
| Controller | `api/GrainOriginatorPortal.Api/Controllers/BidSheetController.cs` |
| Service methods (group: BidSheet) | `GetElevatorsAsync`, `GetBidSheetLocationsAsync`, `GetAllBidSheetLocationsAsync`, `CreateBidSheetLocationAsync`, `UpdateBidSheetLocationAsync`, `DeleteBidSheetLocationAsync`, `BulkUpsertBidSheetBidsAsync`, `DeleteBidSheetBidsAsync`, `GetBidCropYearsAsync`, `GetBidCommoditiesAsync`, `GetBidMonthsAsync`, `GetBidSheetLocationOrderAsync`, `SetBidSheetLocationOrderAsync`, `GetBidSheetPreferenceAsync`, `SetBidSheetPreferenceAsync` |
| ODS view | `ctrm.vw_GNP026` (elevators with lat/lon, address, TU code, group name, IsScoularFacility flag) |
| App tables | `dbo.BidSheetLocations`, `dbo.BidSheetLocationBids`, `dbo.BidSheetLocationOrders`, `dbo.BidSheetPreferences`, `dbo.ElevatorCache` |
| Geocode endpoint | `GET /api/geocode/search` (free-text search, returns lat/lon) |

### App-DB tables

**`BidSheetLocations`** — `Id`, `Name`, `Address`, `City`, `State`, `Latitude`, `Longitude`, `ElevatorCode`, `TradeUnitCode`, `GroupName`, `IsScoularFacility`, audit columns.

**`BidSheetLocationBids`** — `Id`, `LocationId`, `CommodityCode`, `CommodityName`, `CommodityCategory`, `CropYear`, `Month` (0 = yearly, 1–12 = monthly), `Bid` (string-formatted price), audit columns.

**`BidSheetLocationOrders`** — Per-user persisted drag-drop order, keyed by `(UserId, TradeUnitKey)`, stored as JSON.

**`BidSheetPreferences`** — Per-user, per-trade-unit:
`CropCode?`, `Month?` (`null` = no preference, `0` = yearly, `1–12` = monthly), `CropYear?`, `CropOrder` (JSON array), `HiddenCrops` (JSON array), `SelectedMonths` (JSON array), `PrintLayout` (JSON — see [Print / export](#print--export)).

## State and caching

- `allElevators` — fetched once per session via `getElevators` (deduped via `ApiService._dedupe`).
- Locations are scoped to the selected trade unit; switching TU triggers a re-fetch.
- `mapGeocodeCache` (a `Map` on `AppStateService`) caches geocoded address → lat/lon results, capped at 500 entries.

## Drag-drop reordering

CDK drag-drop (`@angular/cdk/drag-drop`). User reorders locations in the bids panel; the new order is persisted via `setBidSheetLocationOrder` (JSON-encoded array of location ids), and re-applied on next load via `getBidSheetLocationOrder`. State stored per trade unit.

## Map view

Leaflet is **type-only imported** (`import type * as Leaflet from 'leaflet'`) and the runtime module is dynamically imported to avoid pulling Leaflet into the initial bundle for users who never visit Bid Sheet.

- Map container: `#mapEl` viewchild.
- Markers colored by bid status (blue / red / yellow per the legend).
- Address-only locations get geocoded via `apiService.geocodeSearch` on first save; the result populates `Latitude` / `Longitude` and is cached.

## Bid entry workflow

- Single location create: `apiService.createBidSheetLocation(payload)` (POST). Payload accepts inline `bids` to seed the row.
- Batch upsert: `apiService.bulkUpsertBidSheetBids(requests, tradeUnitCode)` (POST `/api/bidsheet/bids/bulk`). Used by the per-location bid grid editor.

### Add-location form (map-pin flow)

Clicking the map drops a pin and opens the Add Location form. Per crop you add:

- **Only ONE bid is required** (not two). The form defaults to a single **Current Year** bid input. `canSaveLocation` enables Save once a crop has a commodity + at least one bid in any shown year; an empty crop (commodity, no bid) shows "Add at least one crop with a bid".
- A **"+ Add year"** inline picker optionally reveals **Prior Year** (current−1) and/or **Next Year** (current+1) bid inputs, each removable with ✕ (max 3 years: prior/current/next). It's inline (not a floating dropdown) so it never gets clipped by the form's scroll area.
- On save, **only the shown years that actually have a value** are persisted (no blank-bid rows). Each bid becomes a `BidSheetLocationBid` row keyed by `CropYear` + `Month`.

This replaced an earlier rule that forced both a prior-year and current-year bid before a location could be saved.

The upsert request shape:

```ts
Array<{
  name?: string;
  elevatorCode?: string;
  tradeUnitCode?: string;
  groupName?: string;
  latitude?: number;
  longitude?: number;
  commodityCode: string;
  commodityName?: string;
  commodityCategory?: string;
  cropYear: number;
  month: number;          // 0 yearly, 1–12 monthly
  bid: string;            // formatted price, e.g. "4.25"
}>
```

Server-side validation lives in `BidSheetController` (TU validation via `IUserEntitlementService.ValidateTradeUnitsOrThrowAsync`).

## Crop year + month preferences

`BidSheetPreferences` persists per-user, per-trade-unit selections so the screen opens with the user's last-used filters. Fields:

- `CropCode` — selected commodity (e.g., `CORN`).
- `Month` — `null` = no month preference, `0` = yearly view, `1–12` = a specific month.
- `CropYear`.
- `CropOrder` — JSON array of commodity codes for display ordering.
- `HiddenCrops` — JSON array of dehidden commodities.
- `SelectedMonths` — JSON array (e.g., `[3, 6, 9, 12]`).
- `PrintLayout` — JSON blob of the print dialog's options (below). Saved per trade unit AND under the `__global__` key, so a new TU inherits the user's last layout.

Persisted via `setBidSheetPreference`.

## Print / export

Edit Bids → **Print** opens a dialog with a live preview (left) and options (right). Printing writes a
self-contained HTML document into `window.open('', '_blank')` and calls `print()`; the popup is
`about:blank`, so the logo must be an absolute `window.location.origin` URL (`printLogoUrl`).

**One model, two renderers.** `utils/print-layout.ts` turns the selected crops / periods / locations
into a `PrintLayoutModel` — tables of styled cells with column widths in inches. The dialog preview
renders that model with a generic `@for` table (`[style]="printCellStyle(cell, isHeader)"`), and
`renderPrintDocument` serialises the same model and the same `cellStyleMap` into the popup HTML. Every
geometry, colour and highlight decision lives once in the util, so the preview cannot drift from the
printed sheet (the earlier dual-implementation approach is what produced squeezed, ellipsised columns).
The util is pure and covered by `print-layout.spec.ts`.

**Layouts** (`layoutStyle`, default `locationsDown`) — same data, different arrangement. Modelled on
the daily bid sheets originators already send (card #559):

| Style | Rows | Columns | Splitting |
| --- | --- | --- | --- |
| `locationsDown` | One row per location (listed ONCE, edit-grid order) | A coloured band per crop, its period columns (`O/C 26`, `N/C 27`, `May 26`) beneath; heavy rule between crops | Name column sized to the longest name (1.4–3.0in); bid columns 0.55–1.0in. If crops × periods overflow the page, CROPS split into balanced bands stacked down the page (5 crops → 3 + 2, never 4 + 1), every band at the same widths |
| `locationsAcross` | A tinted band row per crop, then one row per period (label carries the crop colour as a left rule) | Locations (names wrap to ≤ 2 lines) | LOCATIONS split into balanced blocks of 4–8 columns (from the longest name), each block repeating the crop bands |

Rules shared by both: only locations with at least one bid in a selected column print; empty cells
are blank (never a dash); Scoular facilities are `#FFD400` with a bold name (row in *down*, column in
*across*) when the **Highlight** toggle is on; a partial last band/block is drawn narrower, not
stretched; each table is `page-break-inside: avoid`, and tables flow rather than one-per-page.
Landscape letter, `@page` margin = `PRINT_GEOMETRY.PAGE_MARGIN_IN` (one constant drives both the
CSS and the width maths).

**Persisted options** (`PrintLayout` JSON): `{ yearlyRows: [{ enabled, offset, oldNew }], address,
phone, highlightScoular, layoutStyle }`. `parsePrintLayoutStyle` maps the retired `sideBySide` /
`stacked` values (and anything malformed) to the default; the next save rewrites the blob.

## Auth and feature flags

- `authGuard` — required.
- **`environment.bidSheetEnabled`** — checked in [`client/src/app/app.routes.ts`](../../client/src/app/app.routes.ts) (around line 30). When false, the route isn't registered (deep links 404 / redirect home) and the sidebar doesn't show the link.
- `[Authorize]` on `BidSheetController`. TU validation per call via `IUserEntitlementService.ValidateTradeUnitsOrThrowAsync` (the only endpoint family in the app where TU access is enforced — bids are TU-scoped business data).

## External integrations

- **Leaflet** — map rendering and clustering.
- `@angular/cdk/drag-drop` — location reorder.
- Geocode endpoint at `/api/geocode/search` (free-text → lat/lon, used when adding a location by address).

## User actions

| Action | Trigger | Method |
| --- | --- | --- |
| Add a location | "Add Location" button | `apiService.createBidSheetLocation` |
| Edit a location's metadata | inline edit in detail view | `apiService.updateBidSheetLocation(id, payload)` |
| Delete a location | trash icon | `apiService.deleteBidSheetLocation(id)` |
| Save bids | bid grid → "Save" | `apiService.bulkUpsertBidSheetBids` |
| Delete a commodity's bids on a location | "Clear" in bid grid | `apiService.deleteBidSheetBids(locationId, commodityCode, month?)` |
| Reorder | drag-drop in panel | `apiService.setBidSheetLocationOrder` |
| Update filter prefs | filter bar interactions | `apiService.setBidSheetPreference` |
| Print bids | Edit Bids → Print → Print | `confirmPrint` → `renderPrintDocument(printLayoutModel())` → `window.open` + `print()` |

## Troubleshooting

| Symptom | Likely cause | First place to look |
| --- | --- | --- |
| Map blank, no markers | Locations didn't load (TU not selected, or `getBidSheetLocations` returned empty) | TU selector + Network tab |
| Markers all in the wrong location | Geocode result mis-cached. Each location's lat/lon is stored on the row; re-geocode by editing the address. | `BidSheetLocations.Latitude/Longitude` |
| Bid edits don't appear after save | `bulkUpsertBidSheetBids` succeeded but UI cache didn't refresh | Verify the post-save `getBidSheetLocations` re-fetch fires |
| Drag-drop order doesn't stick across sessions | `setBidSheetLocationOrder` failed silently | Network tab; check `BidSheetLocationOrders` row exists for `(UserId, TradeUnitKey)` |
| Sidebar link missing | `environment.bidSheetEnabled === false` for this build | `client/src/environments/environment.ts` |
| 403 on a `/api/bidsheet/...` call | User isn't entitled to the requested TU | `UserEntitlementService.ValidateTradeUnitsOrThrowAsync` — check the user's entitlement set |
| Printed sheet has no logo | Relative asset path inside the `about:blank` popup | `printLogoUrl` must be `window.location.origin` + path |
| Print columns squeezed / headers ellipsised, or preview ≠ print | Widths and band split no longer come from the same builder | `utils/print-layout.ts` — `buildLocationsDown` / `buildLocationsAcross` are the only source; run `print-layout.spec.ts` |
| Print dialog opens on "Locations down" though the user picked something else before | Persisted `layoutStyle` was a retired value (`sideBySide` / `stacked`) | `parsePrintLayoutStyle` — expected migration; the next save rewrites it |
| Leaflet warnings about non-ESM module | Pre-existing build warning; safe to ignore unless build actually fails | Build output: `Module 'leaflet' ... is not ESM` |

## References

- [`Shared Infrastructure.md`](./Shared%20Infrastructure.md) — `IUserEntitlementService`, `ApiService` deduplication.
- [`SECURITY-MODEL.md`](./SECURITY-MODEL.md) — note that bid endpoints are the exception that **does** enforce TU access via `ValidateTradeUnitsOrThrowAsync`.
- `client/src/environments/environment.ts` — feature flag.
