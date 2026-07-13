# Grain Originator Portal — Performance Review Digest

## Overview
ASP.NET Core Web API + Angular 21 SPA managing grain originators' customers, contracts, deliveries, planting intentions, and analytics. Two databases: ODS (read-only views) for contracts/tickets/customers, Origination app-DB for user-created data (notes, planting intentions, dashboard metrics). Azure AD auth via MSAL/Microsoft.Identity.Web.

---

## Per-Screen Workflows

### 1. **Customer Home Page** (Route: `/`) — PRIMARY WORKFLOW
- **Usage**: Default landing, navigation hub. Most heavily used.
- **User actions**: Browse/search producers, drill into profile, create/edit notes, manage planting intentions, view contracts/tickets/storage.
- **Data displayed**: Customers (filtered to selected trade units), contracts (open only from ODS), tickets (applied & unapplied), notes, planting intentions, producer details, stored grain.
- **Entities shown**: Customers, Contracts, Tickets, Notes, PlantingIntentions, StoredGrain, ProducerDetails, CommodityConversions.
- **Key perf details**:
  - **TU change triggers bulk fetches** (parallel): getCustomers, getContracts, getTickets, getNotes, getStoredGrain, getPlantingIntentions, getAllProducerDetails, getCommodities, per-TU year-range getDashboardPlantingEstimates.
  - **Per-customer selection triggers secondary enrichment**: getContractsByCustomer, getTicketsByCustomer, getStoredGrainByCustomer, getPlantingIntentionsByCustomer, getProducerDetails, getPricingLinesByCustomer.
  - **Request deduplication** prevents duplicate in-flight requests (\_customerRequestId counter drops stale responses).
  - **StoredGrain merge race**: TU-level fetch and per-customer fetch both write to same signal; code preserves merge-by-id semantics or customer's storage tabs go blank.
  - **Delivery math** sourced from shared util `getContractDeliveryStats()` reading `contract.openBalanceQuantity` (not ticket sum). Sub-0.1%-of-contract residue treated as complete.
  - **Ticket-to-contract matching by ContractNumber only** (not CustomerCode + ContractNumber) to catch applied tickets with different customer codes.
  - **Contracts table delivery-period sort** drops commodity grouping when clicked, showing one flat delivery-date-ordered list across commodities.
  - **C-prefix (customer storage) tickets gated by active storage**: priced-out storage drops off (see `GateCustomerStorageTickets`).
  - **Planting crop dropdown curated** to ~20 approved commodities (Corn, Wheat, Soybeans, etc.) from `ShowInPlantingIntentions = 1` flag, not all 250 codes.

### 2. **Actionable Insights** (Route: `/insights`) — DAILY WORKFLOW
- **Usage**: "What do I need to do today?" Read-only, fast, no per-customer API calls.
- **User actions**: View 3 priority cards (Unconfirmed Contracts, Spot Loads, Unshipped Bushels), click through to customer profile.
- **Data displayed**: Customers, Contracts, Tickets (last 30 days), Commodities, CommodityConversions.
- **Key perf details**:
  - **No fresh data fetches**—entirely reads from `AppStateService` signals populated by DataPreloadService or other screens.
  - **Refresh button** calls `DataPreloadService.forceReload()` to bypass cache.
  - **Loading gate**: Both Insights and Dashboard render together behind single `dataLoading` flag (waits for core group: customers + contracts + today's tickets).
  - **Three categories computed from cached data**:
    - **Unconfirmed Contracts**: `status NOT IN (Fulfilled, Cancelled)` AND `customerConfirmStatus != Confirmed`.
    - **Spot Loads** (Delivered, No Contract, last 30 days): Unapplied tickets with no active same-commodity contract. U/L tickets always shown; C-prefix gated by active storage. Sourced from `todaysTickets`.
    - **Unshipped Bushels** (past delivery): `deliveryEnd < today`, `status IN (Active, Pending, Overdue)`, remaining > residue threshold. Uses shared `getContractDeliveryStats()` util.
  - **Amounts formatted** 2 decimals via `formatInsightQty()` (e.g., `1,234.56 bu`); tiny loads like `0.02 bu` stay visible.
  - **Known perf cost**: `getTodaysTickets` runs customer-storage gate (scan of `ctrm.vw_GNTA39D1`), not as fast as "core group" name suggests.

### 3. **Build a List** (Route: `/build-list`) — AD-HOC WORKFLOW
- **Usage**: Construct producer cohorts via NLQ + structured filters, save for reuse. Occasional.
- **User actions**: Enter NLQ query, click library prompts, apply refinement filters, search/add/exclude producers, save/load lists, manage members.
- **Data displayed**: Customers (cached), Contracts, Tickets, Notes, StoredGrain, PlantingIntentions, Commodities, ProducerDetails.
- **Key perf details**:
  - **No per-customer API calls**—entirely in-memory filtering over cached arrays from `AppStateService`.
  - **Library + saved-list endpoints only HTTP traffic** during normal use.
  - **NLQ pipeline**: `NlqFilterService.parseAndFilter()` returns matched customers; then `applyRefinementFilters()` adds structured filters. User references ("I", "me", "my") resolved to active username before parsing so saved lists work across users.
  - **Linked-producer entity view** (when note filter or "linked" query active): dedup pass hides linked producers under a parent row, "+N Linked Producers" chip expands.
  - **Inline notes display** (when note filter active): most recent matching note shown, "+N earlier notes" reveals 5 more per click. Notes pinned-first, newest-first.
  - **Click navigation** detects focus tab (storage/ticket/planting/contract filter keywords) and deep-links to home page with appropriate `tab` param.
  - **Saved list `customerIds` recomputed at load, not stored**—dynamic per-run result set.
  - **Trade-unit visibility**: `visibleSavedLists` shows only lists whose TU CSV exactly matches current selection.

### 4. **Actionable Insights → Unshipped Bushels** (Route: `/unshipped-bushels`) — OCCASIONAL
- **Usage**: Broader inventory view vs inline insights category (all open contracts, not just past-due).
- **Same data sources** as Insights (customers + contracts) but table layout with sort/search.
- **Filter**: All contracts where `getContractDeliveryStats.isEffectivelyComplete === false`, regardless of delivery date.

### 5. **Bid Sheet** (Route: `/bid-sheet`, env-gated) — MERCHANDISER WORKFLOW
- **Usage**: Track competitor bids on map, compare to reference location, edit bids per location/commodity/month. Occasional.
- **User actions**: Select TU, filter by crop/year/month/status, add/edit locations, save bids, reorder locations, set preferences.
- **Data displayed**: Elevators (ODS), BidSheetLocations, BidSheetLocationBids, BidSheetPreferences (app-DB).
- **Key perf details**:
  - **TU-scoped data**; TU change triggers re-fetch of locations.
  - **Leaflet lazy-loaded** (dynamic import) to avoid bundling for non-Bid-Sheet users.
  - **Drag-drop reorder** via CDK; persisted per (UserId, TradeUnitKey) as JSON.
  - **Address geocoding** via `apiService.geocodeSearch()`, results cached in `AppStateService.mapGeocodeCache` (cap 500 entries).
  - **One location create** via `createBidSheetLocation` (POST); batch upsert via `bulkUpsertBidSheetBids`.
  - **Add-location form**: Only one bid required per crop (not two); inline "+Add year" picker for prior/current/next years; only shown years with values persisted.
  - **Preferences persist** per user per TU: crop code, month, year, crop order, hidden crops.
  - **TU access enforced** server-side via `ValidateTradeUnitsOrThrowAsync` (only endpoint family that enforces TU boundary).

### 6. **Planting Intentions Dashboard** (Route: `/dashboard`) — PLANNING WORKFLOW
- **Usage**: Plan planting season—yield estimates, market share targets, actual harvest, per-producer roll-up. Regular.
- **User actions**: Switch year (prev/next), filter by crop, edit yield estimates, set season targets (market share), enter actual harvest, click producer to view profile.
- **Data displayed**: PlantingIntentions (app-DB), Contracts (ODS for crop year), DashboardPlantingEstimates, DashboardMarketShares, DashboardActualHarvests, Commodities.
- **Key perf details**:
  - **Bundled fetch on entry/TU change**: `getDashboardSummary(TU, year)` fetches estimates + market shares + actual harvest together.
  - **Cached summary** per TU in `AppStateService.dashboardCache` (instant re-entry).
  - **DataPreloadService preloads** summary on app boot/TU change via `preloadedDashboardSummary`.
  - **Crop title-casing**: Contract codes from ODS come all-caps (WHEAT); component normalizes via `_toTitleCase()` so dropdown doesn't show duplicate entries.
  - **Per-crop tab, producers+intentions tab, harvest+contracts tab** with their own data requirements.
  - **4 stat cards** render immediately from cached data.
  - **Clearing a target**: Input binds via `yieldInputValue()`/`marketShareInputValue()` distinguishing "no edit" from "explicitly cleared". Saving empty sends `null`, backend upsert removes that row.
  - **Recently completed normalization** pass cleaned up plural/singular inconsistencies in app tables (Soybeans, Brewers Grains, etc. are intentional plurals); Dev/QA migrated, Prod pending.

### 7. **Usage Dashboard** (Route: `/usage-dashboard`, admin + env-gated) — ADMIN WORKFLOW
- **Usage**: Monitor adoption, spot inactive originators, find feature gaps. Admin-only, rare.
- **User actions**: Select date range, trade unit, view Who's Using It / What They're Doing / Who Isn't Using It tabs, click user for detail drill-down.
- **Data displayed**: User sessions, click events, feature usage, activity, query library usage, search gaps.
- **Key perf details**:
  - **`adminGuard` + `AdminOnly` policy** (frontend + backend).
  - **Tracking sources**: `UsageTrackingService.postClickEvent()` called from ~20 sites; middleware captures `UserActivity`; background service aggregates nightly into `UserActivityDaily`, `FeatureUsageDaily`.
  - **Click-event POST not admin-gated**—all authenticated users post telemetry.
  - **Per-user drill-down** (`/usage-dashboard/users/:userId`) shows sessions, per-feature engagement, recent activity (top 50 click events).
  - **Inactive users query**: `max(Timestamp)` per user, filter `(now - lastActive) >= daysThreshold` or no activity.
  - **Query library usage**: Count `UserClickEvent` where `FeatureCode = 'build-a-list'` AND `SubFeatureCode = 'library-query-selected'`, grouped by target ID (library item). **Use search-gaps data to decide which prompts to add.**
  - **No long-lived cache**—refetches on date-range/TU change.

---

## Permission & Trade-Unit Model

**Critical Design: Trade units are a UX filter, not an access boundary.**

- Any authenticated Scoular user can read **any** customer's records via the API (no `ValidateCustomerAccessAsync` on most customer-bound GETs/writes).
- Trade-unit selection narrows the default result set in the UI but does **not** restrict what an authenticated user is permitted to access.
- **Rationale**: Originators routinely cross TUs (search by name, follow referral, edit notes on producer outside their region). Hard access boundary was creating false-positive blocks during legitimate workflows.
- **Implications for caching**: Query results are **not** user-scoped—any two users in the same TU set could theoretically share cached results (though the app doesn't yet implement cross-user caching).
- **Exception**: Bid Sheet endpoints **do** enforce TU access via `ValidateTradeUnitsOrThrowAsync`—only endpoint family that enforces TU boundary (customer data is different from bid data).
- **Fail-open on entitlement-DB outage**: `[EnforceTradeUnitAccess]` fails open for GET/HEAD requests so users get unfiltered reads during outages rather than blocked reads.
- **Accepted security findings** H-034, H-036, H-035 are accepted by design under this model and should not re-open without a change to access policy.

**Entitlement source**: `UserEntitlementService.GetAllowedTradeUnitCodesAsync()` loads from Entitlements database once per request. TU catalog no longer maintained locally; sourced from entitlements DB.

---

## Data Freshness & Refresh Behavior

### Real-Time Expectations
- **ODS views** (`vw_CurrentContracts`, `vw_CurrentTickets`, `vw_ContractPricing`, `vw_GNTA39D1`) reflect CTRM state near real-time (minutes-level latency typical for these periodic refreshes).
- **App-owned tables** (Notes, PlantingIntentions, ProducerDetails, Dashboard*, SavedLists) written via API, read immediately (no cache invalidation delay).

### Background Sync
- **`CustomerSyncBackgroundService`**: Runs daily 07:00 UTC + on startup. Syncs `dbo.Customer` + `dbo.CustomerTradeUnit` from ODS `vw_CustomerTradeUnits`, soft-deletes deactivated producers, respects `IsManual` flag (onboarded producers not deleted). Replaces the old `CustomerSnapshot` cache pattern.

### Preloading Strategy
- **On app boot**: `DataPreloadService` fires bulk fetches (customers + contracts + today's tickets in "core group"; background group includes notes, planting intentions, stored grain, saved lists, commodities, producer details, dashboard summary).
- **TU change**: Clears `AppStateService` signals, re-runs core group (gate on `dataLoading` flag), streams background group via `merge` (non-blocking).
- **Screen-level refresh**: Insights has "Refresh" button calling `DataPreloadService.forceReload()` to bypass cache; Dashboard re-fetches on year change; Bid Sheet re-fetches on TU change.

### Data Staleness Risks
- **Known perf cost**: `getTodaysTickets` (core group, blocking Insights + Dashboard) runs customer-storage gate (scan of `ctrm.vw_GNTA39D1`), slower than other core fetches. In-flight change pending to drop storage scan from this path and let each screen load its own data.
- **Contract delivery progress** reads `openBalanceQuantity` from `vw_CurrentContracts` (not summed from tickets). If CTRM aggregate is stale, unshipped-bushels count will be too.
- **Storage tickets gated by active storage**: C-prefix tickets only count as unapplied while commodity is in `vw_GNTA39D1`. Priced-out storage drops off. Gate applies every unapplied path including `getTodaysTickets`.

### Preloading for Feature Entry
- **Dashboard**: `DataPreloadService` sets `preloadedDashboardSummary` so dashboard doesn't wait on its own fetch on cold load; cached summary per TU renders instantly on re-entry.
- **Insights + Dashboard**: Both gate spinners on single `dataLoading` flag. Both render together when core group completes (customers + contracts + today's tickets).

---

## Performance Bottlenecks & Observability

| Bottleneck | Impact | Cause | Mitigation |
|---|---|---|---|
| **Core data preload slow** | Insights + Dashboard spinners both blocked | `getTodaysTickets` includes customer-storage gate (scan `vw_GNTA39D1`), or ODS contract/ticket scans slow | In-flight: per-dataset loading flags. Short-term: monitor ODS query plans, add indexes to `vw_CurrentTickets` and storage view if not present. |
| **Contract delivery math stale** | Unshipped-bushels count wrong, delivery progress bars incorrect | `vw_CurrentContracts.openBalanceQuantity` not current in ODS | Refresh button; verify CTRM aggregate refresh schedule. |
| **Home page storage-merge race** | Customer's storage tab goes blank | TU-level fetch overwrites per-customer fetch (wrong order) | Code merge-by-id (see `home.component.ts:335-352`); same pattern for tickets. |
| **C-prefix ticket gating slow** | Spot Loads category slow to compute, core preload stalls | Active-storage scan on every unapplied path | In-flight: move storage gate to per-screen load. Measure impact on `getTodaysTickets` after change. |
| **Leaflet bundle bloat** (Bid Sheet) | Initial load > expected | Leaflet not lazy-loaded in other screens | Leaflet lazy-loaded for Bid Sheet only (dynamic import). Other screens use Leaflet if ever added; worth audit. |
| **Built-in caching insufficient** | Repeated TU changes or app reload reloads all data | No inter-screen or inter-user cache persistence | Request deduplication in ApiService for in-flight calls; AppStateService signals cached per session. Saved-list results recomputed on load (not stored). |

---

## Key Files for Performance Review

**Frontend state & services**:
- `client/src/app/core/services/app-state.service.ts` — global signal store
- `client/src/app/core/services/data-preload.service.ts` — bulk fetch coordination
- `client/src/app/core/services/api.service.ts` — request deduplication, base for all HTTP traffic

**Backend data access**:
- `api/GrainOriginatorPortal.Api/Services/SqlDataService.cs` — all ODS/app-DB queries (grouped by domain)
- `api/GrainOriginatorPortal.Api/Services/UserEntitlementService.cs` — TU entitlement + access checks
- `api/GrainOriginatorPortal.Api/Filters/EnforceTradeUnitAccessAttribute.cs` — TU filter, fail-open on outage

**Notable utilities**:
- `client/src/app/shared/utils/contract-delivery.ts` — shared delivery-stats math (used by Contracts table, Insights, unshipped-bushels, dashboard, print reports)
- `client/src/app/core/services/nlq-filter.service.ts` — NLQ + refinement-filter logic
- `api/GrainOriginatorPortal.Api/Services/UsageTrackingBackgroundService.cs` — nightly aggregation of telemetry

**ODS views (read-only)**:
- `vw_CurrentContracts` (base schema) — open contracts, pricing, delivery windows
- `vw_CurrentTickets` (base schema) — applied & unapplied tickets, quality data
- `vw_TicketQuality` (base schema) — per-ticket test weight, moisture, protein
- `vw_ContractPricing` (base schema) — pricing breakdowns
- `vw_GNTA39D1` (ctrm schema) — stored grain (active commodities); gates C-prefix tickets
- `vw_GNP024` (ctrm schema) — commodity conversions (lb per bushel)
- `vw_GNP026` (ctrm schema) — elevators with lat/lon
- `vw_CustomerTradeUnits` (originations schema) — for entitlement checks + onboarding

**App-DB tables (read/write)**:
- `Customer`, `CustomerTradeUnit` — synced daily from ODS; replace old snapshot pattern
- `Notes`, `ProducerDetails`, `ProducerPlantingIntentions`, `SavedLists`
- `DashboardPlantingEstimates`, `DashboardMarketShares`, `DashboardActualHarvests`
- `BidSheetLocations`, `BidSheetLocationBids`, `BidSheetLocationOrders`, `BidSheetPreferences`
- `UserActivity`, `UserClickEvent`, `UserSession` (usage tracking)
- `QueryLibrary`, `QuerySearchLog` (Build-a-List prompts & gaps)

---

## Mapping Features (POC)

**Status**: Proof of concept, local-development only. Not in prod flow yet. See `docs/maps/PATH-TO-PRODUCTION.md`.

- **Field tagging** (Customer Profile "Fields" tab): Tag producer field boundaries (CLU / parcel / drawn). Reads from MapLibre GL + LandMapMagic vendor (free-tier, vendor key exposed to browser—accepted POC risk). Persists to `FieldTagDbContext` (local SQLite; to be removed on promotion).
- **Bid Sheet map**: Optional CDL crop overlay on bid-location markers (read-only context, no new persistence).
- **Both gated by config**: `FieldTags:*` settings enable field tagging; per-key independent gating for map-config keys.

---

## Summary

The app prioritizes fast reads from cached ODS views and app-DB tables, with a critical preload phase (customers + contracts + today's tickets) that blocks Insights and Dashboard entry. Trade-unit entitlements are UX filters, not access boundaries—any authenticated user can access any customer's data. Data freshness depends on ODS refresh schedules (near real-time) and app-DB writes (immediate). Known perf bottleneck is the customer-storage gate (`vw_GNTA39D1` scan) in the critical path; in-flight changes proposed to move it out of the core preload.
