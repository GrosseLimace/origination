# Planting Intentions Dashboard

## At a Glance

- **Route**: `/dashboard`
- **Component**: [`client/src/app/features/dashboard/pages/dashboard/dashboard.component.ts`](../../client/src/app/features/dashboard/pages/dashboard/dashboard.component.ts)
- **Template**: [`dashboard.component.html`](../../client/src/app/features/dashboard/pages/dashboard/dashboard.component.html)
- **Access**: any authenticated Scoular user (`authGuard`).
- **Primary user goal**: plan and track planting for the upcoming season — yield estimates, market share targets, actual harvest results, and the per-producer roll-up of intentions and contracts for that crop year.

This is the merchandiser's planning view. It reads producer planting intentions and contracts, then layers in app-owned tables for territory-level estimates, market share, and historical harvest.

## How users reach it

- "Dashboard" link in the sidebar.
- Producer rows on this screen deep-link to the Customer Home Page producer profile (with `tab=planting`).

## What it shows

| Section | Description |
| --- | --- |
| **Header row** | "Planting Intentions Dashboard" title, Trade Unit Selector, **"Set Season Targets"** button (opens the targets dialog). |
| **Year + crop filter bar** | Previous / next year buttons (`selectedPlantingYear`), "Growing Season" label, **crop filter dropdown** (`selectedCropFilter`). |
| **4 Stat cards** | "Total Acres", "Projected Production", "Average Yield", "Active Growers". |
| **3 Tabs** | `By Crop`, `Producers & Planting Intentions`, `Harvest & Contracts`. |
| **By Crop tab** | "Acres by Crop" bar chart, "Production by Crop" chart, crop breakdown grid. |
| **Producers & Planting Intentions tab** | Producer list (search + sort) with expandable per-producer planting intention rows. |
| **Harvest & Contracts tab** | Harvest entry table with edit mode + a contract list for the selected crop year. |

### Crop title-casing

Contract values come from ODS in **all caps** (`WHEAT`, `HARD RED WINTER WHEAT`). The component runs `_toTitleCase(s)` on category strings before merging them with the (already title-cased) planting-intention categories so the dropdown shows `Wheat` instead of duplicate `WHEAT` and `Wheat` entries:

```ts
private _toTitleCase(s: string): string {
  if (!s) return s;
  return s.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
}
```

A recent normalization pass also cleaned up plural/singular inconsistencies in the app-owned tables (`Commodities`, `ProducerPlantingIntentions`, `DashboardActualHarvests`, `DashboardMarketShares`, `DashboardPlantingEstimates`). Singular is the canonical form, except for these intentional plurals: `Soybeans`, `Brewers Grains`, `Pulses`, `Rice Hulls`, `Finished Goods`, `Miscellaneous`, `Feed & Fert Ingredients`. Dev and QA have been migrated; Prod still pending. The cleanup script lives outside this repo (SSMS scripts, autocommit) — search this folder's git history for "plural" if you need the SQL.

## Data flow

```mermaid
flowchart LR
    UI[Dashboard component]
    Cached[(AppStateService<br/>customers, contracts,<br/>plantingIntentions)]
    Fresh[apiService.getDashboardSummary / Estimates / MarketShares / ActualHarvest /<br/>getContractsByCropYear / getCommodities]
    CTL[DashboardPlantingEstimatesController]
    SVC[SqlDataService]
    APP[(dbo.DashboardPlantingEstimates,<br/>dbo.DashboardMarketShares,<br/>dbo.DashboardActualHarvests,<br/>dbo.Commodities,<br/>dbo.ProducerPlantingIntentions)]
    ODS[(base.vw_CurrentContracts<br/>via getContractsByCropYear)]

    UI -- "init / TU change / year change" --> Fresh
    UI --> Cached
    Fresh --> CTL --> SVC --> APP
    SVC --> ODS
```

## Files

| Layer | Path |
| --- | --- |
| Component | `client/src/app/features/dashboard/pages/dashboard/dashboard.component.ts` |
| Template | `client/src/app/features/dashboard/pages/dashboard/dashboard.component.html` |
| Controller | `api/GrainOriginatorPortal.Api/Controllers/DashboardPlantingEstimatesController.cs` |
| Service methods (group: Dashboard) | `GetDashboardSummaryAsync`, `GetDashboardPlantingEstimatesAsync`, `UpsertDashboardPlantingEstimatesAsync`, `GetDashboardMarketSharesAsync`, `UpsertDashboardMarketSharesAsync`, `GetDashboardActualHarvestAsync`, `UpsertDashboardActualHarvestAsync`, `DeleteDashboardActualHarvestAsync` |
| App tables | `dbo.DashboardPlantingEstimates`, `dbo.DashboardMarketShares`, `dbo.DashboardActualHarvests`, `dbo.ProducerPlantingIntentions`, `dbo.Commodities` |
| ODS views (via `getContractsByCropYear`) | `base.vw_CurrentContracts` |

### API service methods called

- `getDashboardSummary(tradeUnitKey, plantingYear)` — bundled fetch of estimates + market shares + actual harvest, used to render the dashboard quickly on entry.
- `getDashboardPlantingEstimates(tradeUnitKey, plantingYear)` — refresh after edits.
- `upsertDashboardPlantingEstimates(estimates)` — save yield estimates.
- `getDashboardMarketShares` / `upsertDashboardMarketShares`.
- `getDashboardActualHarvest` / `upsertDashboardActualHarvest` / `deleteDashboardActualHarvest`.
- `getContractsByCropYear(cropYear, tradeUnits?)` — historical contracts for the selected planting year.
- `getCommodities()` — crop catalog.
- Plus the cached signals from `AppStateService` for `customers`, `contracts`, `plantingIntentions`.

### Controller endpoints

`DashboardPlantingEstimatesController.cs`. All gated by `[Authorize]` + `[EnforceTradeUnitAccess]`.

| Verb / route | Purpose |
| --- | --- |
| `GET /api/dashboardplantingestimates/summary` | Combined `DashboardSummaryResponse` (estimates + market shares + actual harvest). |
| `GET /api/dashboardplantingestimates` | List of `DashboardPlantingEstimate`. |
| `POST /api/dashboardplantingestimates/upsert` | Bulk upsert of estimates. |
| `GET /api/dashboardplantingestimates/marketshares` | List of `DashboardMarketShare`. |
| `POST /api/dashboardplantingestimates/marketshares/upsert` | Bulk upsert. |
| `GET /api/dashboardplantingestimates/actualharvest` | List of `DashboardActualHarvest`. |
| `POST /api/dashboardplantingestimates/actualharvest/upsert` | Bulk upsert. |
| `DELETE /api/dashboardplantingestimates/actualharvest/{id}` | Single-row delete. |

### App-DB tables

| Table | Key columns |
| --- | --- |
| `DashboardPlantingEstimates` | `Id`, `TradeUnitKey`, `Crop`, `PlantingYear`, `YieldEstimate?`, `Created/ModifiedBy/At` |
| `DashboardMarketShares` | `Id`, `TradeUnitKey`, `CropCategory`, `PlantingYear`, `MarketSharePct?`, `Created/ModifiedBy/At` |
| `DashboardActualHarvests` | `Id`, `TradeUnitKey`, `CropCategory`, `PlantingYear`, `Bushels`, `Created/ModifiedBy/At` |

Unique-ish constraints exist on `(TradeUnitKey, PlantingYear, Crop|CropCategory)` for the upsert paths — collisions surfaced during the recent normalization pass and were resolved manually before the rename UPDATEs.

## State and caching

- `appState.dashboardCache` (`DashboardCacheEntry`) caches the last summary keyed by trade unit so re-entering the screen renders instantly.
- `appState.preloadedDashboardSummary` is set by `DataPreloadService` so the dashboard doesn't have to wait on its own fetch on cold load.
- `clearDashboardCache()` fires when trade units change.

## User actions

| Action | Trigger | Payload | Method |
| --- | --- | --- | --- |
| Save yield estimates | Edit mode in By Crop tab → "Save" | `Array<{ tradeUnitKey, crop, plantingYear, yieldEstimate? }>` | `apiService.upsertDashboardPlantingEstimates` |
| Save market share | "Set Season Targets" dialog → save | `Array<{ tradeUnitKey, cropCategory, plantingYear, marketSharePct? }>` | `apiService.upsertDashboardMarketShares` |
| Save actual harvest row | Harvest tab edit → save | `Array<{ tradeUnitKey, cropCategory, plantingYear, bushels }>` | `apiService.upsertDashboardActualHarvest` |
| Delete actual harvest row | Trash icon | `id` | `apiService.deleteDashboardActualHarvest` |
| Switch year | Prev / Next buttons | n/a | re-fetches contracts + summary for new year |
| Switch tab | tab pill | n/a | `usageTracking.trackDashboardTabClick(tabKey)` |
| Open producer profile | producer row | n/a | navigate to `/?customerId=...&tab=planting&year=...` |

The "system" username has historically been used for `Created/ModifiedBy` on dashboard upserts (see project memory note about M1). Wire this through `IHttpContextAccessor` if/when actual user attribution becomes a requirement.

## Auth and feature flags

- `authGuard` — required.
- `[EnforceTradeUnitAccess]` on all backend endpoints (UX filter only — see [`SECURITY-MODEL.md`](../SECURITY-MODEL.md)).
- No feature flag.

## External integrations

- `UsageTrackingService` — tab clicks, "Set Season Targets" usage.
- No charting library; charts are simple SVG / canvas in template.

## Troubleshooting

| Symptom | Likely cause | First place to look |
| --- | --- | --- |
| Stat cards say 0 acres / 0 producers | `selectedTradeUnits()` empty or `plantingIntentions` not yet loaded | TU selector + `dataLoading()` |
| Filter by Crop dropdown shows duplicate `WHEAT` and `Wheat` | A contract row in ODS still uses ALL CAPS that the title-case helper isn't catching, or a stale entry in the App DB. Remember Prod hasn't run the cleanup yet. | `availableCrops` computed; the SQL audit query under "Crop title-casing" |
| Saved estimate disappears after refresh | Upsert hit a unique constraint and one row was overwritten. | Check `Created/ModifiedAt` columns; verify only one `(TradeUnitKey, Crop, PlantingYear)` row per crop |
| "By Crop" tab shows different totals than "Producers" tab | Categorization mismatch (planting intentions use `category`, contracts use `commodityGroup` / `commodityDescription`). The `_toTitleCase` helper merges them, but only if both side's strings normalize to the same thing. | `availableCrops` computed; check both signal sources |
| Dashboard slow on first open | `preloadedDashboardSummary` not populated yet (TU just changed) | `DataPreloadService` flow; the bundled `getDashboardSummary` fetch |

## References

- Project memory note: dashboard normalization pass in `dbo.Commodities`, `dbo.ProducerPlantingIntentions`, `dbo.DashboardActualHarvests`, `dbo.DashboardMarketShares`, `dbo.DashboardPlantingEstimates`. Dev and QA migrated; Prod pending.
- PR with the title-case helper change in `dashboard.component.ts`.
- [`Shared Infrastructure.md`](./Shared%20Infrastructure.md) — `AppStateService`, `IDataService` Dashboard methods, `EnforceTradeUnitAccess` filter.
- [`Customer Home Page.md`](./Customer%20Home%20Page.md) — destination of producer-row clicks; documents the `tab=planting&year=...` deep-link contract.
