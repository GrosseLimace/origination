# Client Performance Sweep — Grain Originator Portal (Angular 21, zoneless)

Scope: `client/src/app/**`. Excludes deep re-derivation of the four already-documented issues
(bulk appState preload, `nlq-filter.service.ts` client-side scan engine, no list virtualization,
single blocking preload spinner) — those are noted only where a *new* angle applies.

## Per-screen data-flow table

| Screen (route) | Data source | Fires on route entry | Re-fires on TU change | Bulk arrays it depends on |
|---|---|---|---|---|
| `/` Home (`home.component.ts`, 1760 lines) | Mixed: seeds from `appState` if populated, else runs its **own parallel** `_loadAllData()` (customers, contracts, plantingIntentions, notes, storedGrain, savedLists, dashboard yield estimates) | Always — `_restoreStateFromService()` + conditional `_loadAllData()` | Yes — `_onTradeUnitsChanged()` re-runs the *same* `_loadAllData()` independently of `DataPreloadService`'s own TU-change subscription | customers, contracts, plantingIntentions, notes, storedGrain, savedLists, producerDetails |
| `/insights` (`insights.component.ts`) | Pure `appState` reads (no own HTTP for the 3 core arrays) | No new calls — reads `customers`, `contracts`, `tickets`, `todaysTickets`, `commodities` signals directly | Indirectly, via `DataPreloadService` | customers, contracts, todaysTickets, commodities, commodityConversions |
| `/build-list` (`build-list.component.ts`, 3065 lines) | `appState` + lazy TU-wide `tickets`/`storedGrain`/`plantingIntentions` fetch gated on `ticketsLoaded()` | Reads appState; lazily fetches missing bulk arrays before running NLQ | Yes, 4 separate `effect()`s (`_dataReadyEffect`, `_appStateTicketsEffect`, `_tuEffect`, `_teamListsEffect`) | customers, contracts, tickets (lazy), storedGrain (lazy), plantingIntentions (lazy), savedLists, teamSavedLists |
| `/dashboard` (`dashboard.component.ts`, 1641 lines) | Preloaded `dashboardCache` / `preloadedDashboardSummary` from `DataPreloadService`, else own fetch | Instant if cache hit; else `getDashboardSummary` + related upsserts | Yes — cache is cleared and summary re-preloaded on every TU change | customers, contracts, storedGrain, commodities, dashboard-specific tables |
| `/bid-sheet` (`bid-sheet.component.ts`, 3194 lines) | Independent of `appState`/`DataPreloadService` — own ODS calls (`getElevators`, `getBidSheetLocations`, `getBidCropYears`, `getBidCommodities`, `getBidMonths`, `getMapConfig`) | Sequential-looking but several calls deduped via `ApiService._dedupe` | Re-fetches locations per TU on selector change | Independent dataset (`BidSheetLocation[]`), not the customers/contracts/tickets bulk arrays |
| `/unshipped-bushels` | `appState.contracts` + own filtering | Reads appState | Indirect | contracts |
| `/daily-digest` | Own CRUD to `dailyrecapgroups` + `entitlements/catalog` | Independent, small payloads | No | none of the bulk arrays |
| `/usage-dashboard` (+ `/usage-dashboard/users/:id`) | Own `usage-dashboard/*` endpoints, date-ranged | Independent per filter change | No | none |
| Customer Profile (child of Home) | `customer-profile.component.ts` — 9 `effect()`s each firing its own HTTP call keyed on `customer()` | `getHistoricalContractsForPacing`, `getFieldTagConfig`, `getFieldTags` per customer select | N/A (per-customer, not per-TU) | historicalContracts, fieldTags |

## 1. Data-flow: duplicate/redundant fetches, missing caching, waterfalls

- **HIGH — Two parallel "preload" pipelines run concurrently for the same trade-unit change.**
  `core/services/data-preload.service.ts:52-167` subscribes to `selectedTradeUnits` changes and
  fetches customers/contracts/todaysTickets/notes/plantingIntentions/storedGrain/savedLists/
  commodities/harvestWindows/producerDetails/dashboardSummary. Independently,
  `features/customers/pages/home/home.component.ts:207-215` has its own `effect()` on the same
  `appState.selectedTradeUnits` signal that calls `_onTradeUnitsChanged()` →
  `_loadAllData()` (home.component.ts:320-431), which re-fetches customers, contracts,
  plantingIntentions, notes, storedGrain, savedLists — almost the same set, with separate
  subscription/merge logic and separate `appState.set*()` writes. Only mitigated by
  `ApiService._dedupe`/`shareReplay` (api.service.ts:66-77) catching same-key concurrent calls;
  this is a race, not a guarantee (order of subscription matters, and `getContracts`/`getCustomers`
  each carry different request-cancellation/merge logic in the two call sites, so results can
  diverge — e.g. `_loadAllData`'s contracts callback re-merges with locally-added FK extras,
  `DataPreloadService`'s does not). Redesign: Home should consume `DataPreloadService`/`appState`
  exclusively and drop its private `_loadAllData`, or `DataPreloadService` should be the single
  owner and Home should only read signals (as Insights already correctly does).

- **MED — Per-customer effects in `customer-profile.component.ts` re-fetch on every customer
  click without a request-cancellation guard tied to rapid re-selection.**
  `customer-profile.component.ts:327-333` (`historicalContracts`), `:352-359` (`fieldTags`) each
  fire a fresh HTTP call keyed only on `customer()?.id` via `effect()` + `takeUntilDestroyed`.
  Unlike `home.component.ts`'s `_cancelSelection$` pattern (which explicitly cancels in-flight
  per-customer requests on rapid clicking), these effects have no `takeUntil` on a
  selection-change subject — only component destruction cancels them. Rapid customer-to-customer
  clicking can leave a stale response landing after a newer selection (effect guards on
  `id == null` only, not on "is this still the active id"). Quick fix: gate the `.subscribe()`
  callback with a captured `id` comparison against `this.customer()?.id`, mirroring the
  `piRequestId`/`_customerRequestId` guard pattern already used in `home.component.ts`.

- **MED — `getCommodities()` and `getPlantingCommodities()` are not deduped** (`api.service.ts:617-626`),
  unlike almost every other lookup endpoint in the file. `getCommodities()` is called from both
  `DataPreloadService` (data-preload.service.ts:136) and `home.component.ts._loadYieldData()`
  (home.component.ts:540) — with the duplicate-pipeline issue above, this is one of the concrete
  cases where the lack of `_dedupe` means two real HTTP round-trips instead of one shared one.
  Quick fix: wrap in `this._dedupe('commodities', ...)` like `getHarvestWindows`/
  `getCommodityConversions` already do.

- **LOW/MED — Bid Sheet is architecturally isolated from the shared preload/appState system**,
  meaning none of its 6+ own endpoint calls benefit from the TU-scoped bulk preload, but also
  means it never contends with the bulk arrays — a reasonable trade for a POC map feature, but
  worth flagging since `bid-sheet.component.ts` (3194 lines) duplicates a lot of the
  loading-state/localStorage-preference bookkeeping patterns already solved elsewhere
  (`user-preferences.service.ts`) rather than reusing them.

- **Positive finding (not a bug):** `ApiService._dedupe` (api.service.ts:62-77) is a well-built
  in-flight de-dup layer (shareReplay + finalize) applied to ~15 read endpoints. This is good
  practice already in place — the gap is that it's applied inconsistently (see `getCommodities`
  above) and doesn't fix the deeper problem of two independent components each deciding
  *when* to fetch.

## 2. State architecture

- **HIGH (new angle) — 25 of 44 standalone components do NOT use `ChangeDetectionStrategy.OnPush`**,
  including several that render or derive from the large bulk arrays:
  `features/customers/pages/home/home.component.ts` (the page holding all customer/contract/
  ticket/note signals), `features/customers/components/contracts-table/contracts-table.component.ts`,
  `features/customers/components/tickets-table/tickets-table.component.ts`,
  `features/customers/components/planting-intentions-table/planting-intentions-table.component.ts`,
  `features/customers/components/contract-pacing-card/contract-pacing-card.component.ts`,
  `features/customers/components/activity-summary/activity-summary.component.ts`,
  `features/customers/components/year-over-year-chart/year-over-year-chart.component.ts`,
  `features/customers/components/edit-customer-dialog/edit-customer-dialog.component.ts`,
  `features/customers/components/map/customer-map.component.ts`,
  `features/customers/components/producer-insights/producer-insights.component.ts`,
  `features/customers/components/ai-growth-forecast/ai-growth-forecast.component.ts`.
  **This is specifically a zoneless hazard, not just a generic Angular nit**: in a zoneless app,
  CD ticks are scheduled by signal writes / `markForCheck()` / async-pipe emissions anywhere in
  the tree, and a default-strategy component is *always* re-checked in full (all template
  bindings, all method/getter calls) on every such tick, regardless of whether its own inputs
  changed. Since `appState` signals (customers/contracts/tickets, all app-wide) are written
  frequently (TU changes, per-customer selects, note edits), every tick walks these Default-
  strategy table/chart components in full even when their own bound data hasn't changed. The
  well-optimized page shells (`bid-sheet`, `build-list`, `dashboard`, `insights`,
  `customer-profile`, `field-tag-map`, `customer-list` — all confirmed OnPush) are undermined by
  their own child components lacking OnPush. Quick fix: add
  `changeDetection: ChangeDetectionStrategy.OnPush` to the listed table/card/chart components —
  they already consume `input()` signals so the change should be close to free.

- **MED — `home.component.ts` holds ~20 signals mirroring subsets of `appState`** (`customers`,
  `contracts`, `tickets`, `plantingIntentions`, `notes`, `storedGrain`, `savedLists`,
  `teamSavedLists`, `producerDetailsMap`, plus ~10 more per-customer signals). Every
  `appState.set*()` write from `DataPreloadService` and every local `_loadAllData()` write
  double-writes largely the same data into two signal graphs, doubling downstream `computed()`
  / effect re-evaluation for anything depending on either copy (e.g. `savedListsForSelectedCustomer`,
  `_enrichLists`).

- **MED — `customer-profile.component.ts` has 13 `effect()`s** (lines 266-407+), several with
  non-trivial bodies (tab-count rebuilding, commodity aggregation, HTTP calls). Each is fired
  independently by its own signal reads, so a single customer-select can cascade through most of
  these in the same tick. Not wrong, but a candidate for consolidation into fewer computed-driven
  updates (only 2 of the 13 need to be effects because they perform HTTP side effects; several —
  e.g. the "reset UI state on customer change" effects at :278-322 — could merge into one).

- **LOW — `AppStateService.mapGeocodeCache`** (app-state.service.ts:250-266) is a plain `Map`
  (not a signal) with a manual 500-entry LRU eviction — reasonable, but note it's never cleared
  in `clearAll()` (app-state.service.ts:285-311), so stale geocode results from a previous user
  session persist across `logout` → `login` as a different user in the same tab (SessionStorage-
  scoped token aside, this cache is a plain module-level singleton). Low impact (geocode results
  aren't user-specific/sensitive) but inconsistent with the rest of `clearAll()`'s intent.

- **Positive finding:** `insights.component.ts`'s `allInsights` computed (insights.component.ts:198-260+)
  is a genuinely well-built large-array transform: early-outs on empty inputs, pre-indexes
  contracts/tickets by customer into `Map`s for O(1) lookup instead of repeated `.filter()`,
  and debounces search input (250ms) into a separate signal specifically to avoid recomputing the
  expensive pass on every keystroke. This is a good pattern to point other screens at rather than
  a finding to fix.

## 3. Rendering

- **Confirmed: no missing `track` on any `@for`** — every `@for` in the codebase already tracks
  by `.id` (grep across all `.html` templates found zero untracked loops). Not an issue here.

- **Confirmed: no `cdk-virtual-scroll-viewport` / `ScrollingModule` usage anywhere**, despite
  `@angular/cdk` being a direct dependency — confirms the known "no virtualization" gap extends
  to `build-list.component.html` (21 `@for` blocks) and `bid-sheet.component.ts` (19 `@for`
  blocks) in addition to the customer list already tracked elsewhere.

- **MED — Per-row template method/getter calls in `customer-list.component.html`**: each customer
  card calls `getCustomerItemClass(customer)`, `getFormattedLocation(customer)`,
  `getFormattedPhone(customer.phone)` (customer-list.component.ts:652-688) directly in the
  template rather than via a memoized pipe or pre-computed field. Because the component is
  OnPush and these are pure string builds, the actual cost is small per row, but they still
  re-run for every visible row on every CD pass that touches this component (e.g. any keystroke
  in the search box, since `filteredCustomers` changes) — with no virtualization (see above),
  "every visible row" can be the full customer roster for a large trade unit. Quick fix: fold
  these into a pure pipe (`| customerItemClass`) so Angular's pipe memoization skips
  re-computation when the customer reference is unchanged, or precompute alongside
  `lastContactCache`.

- **LOW — `year-over-year-chart.component.ts` and other custom bar-chart components (no
  charting library in `package.json` — all charts are hand-rolled CSS/SVG bars) recompute their
  entire dataset in an `effect()` keyed only on the `contracts` input** (year-over-year-chart.component.ts:34-70),
  including `Math.max(...array.map(...))` spreads that are O(n) allocations per re-run. Fine at
  current data volumes; would degrade if `contracts` grows materially. No charting-library bundle
  cost exists here (no Chart.js/D3/etc. in `package.json`), so this is a maintenance/CPU note,
  not a bundle-size one.

- **LOW — `field-tag-map.component.ts` / `bid-sheet-map.component.ts` use raw `el.innerHTML =`
  for MapLibre marker DOM** (bid-sheet-map.component.ts:1060, 1166, 1212, 1217). Content is
  built from static template strings + numeric coordinates, not user input, so this is not an XSS
  finding — flagging only because `innerHTML` writes on hover (bid-sheet-map.component.ts:1209-1217)
  fire on every marker hover event; if hover is mouse-move-driven rather than debounced this could
  thrash layout on dense bid-sheet maps. Worth confirming the hover handler is pointer-enter/leave
  scoped, not a raw `mousemove` (didn't fully trace the event wiring — flagging for a closer look
  if bid-sheet map hover feels janky).

## 4. Zoneless-specific hazards

- **LOW/MED — Two `setInterval` polling loops**:
  `features/customers/pages/home/home.component.ts:309` polls every 100ms (max 5s) waiting for a
  deep-linked customer to appear in the just-loaded list — bounded and cleared, acceptable.
  `features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts:2707` runs a 10s tick purely to
  update a "time since refresh" label — in zoneless, each tick calls a signal write
  (`_updateTimeSinceRefresh()`), which schedules a CD pass across the tree; confirm it's cheap
  (it should just update one signal) but it is a permanent background tick for as long as the Bid
  Sheet route is active. Not fixed by `takeUntilDestroyed` alone unless the interval itself is
  torn down on destroy — worth a quick check that `_refreshTimer` is cleared in `ngOnDestroy`/
  `DestroyRef` (didn't confirm the teardown call site in this pass).

- **No manual `ApplicationRef.tick()` / `NgZone` shims found** — the app is consistently
  signal/effect-driven, which is the correct zoneless pattern. No `detectChanges()` calls found
  outside `customer-list.component.ts`'s deliberate, narrow `markForCheck()` use
  (customer-list.component.ts:324, gated to only fire on empty↔non-empty search transitions —
  a genuinely good zoneless-aware optimization, not a hazard).

- **Confirmed no RxJS subscription leaks**: every `.subscribe()` site checked uses
  `takeUntilDestroyed(this.destroyRef)` (often combined with a local `takeUntil(cancelSubject$)`
  for request-cancellation on rapid re-selection). No bare subscriptions found missing a teardown
  operator in the files sampled (`home.component.ts`, `customer-list.component.ts`,
  `data-preload.service.ts`, `app.component.ts`).

## 5. Bundle & startup

- **All feature routes are lazy (`loadComponent`)** in `app.routes.ts` — no eager
  feature modules. Good.

- **HIGH — `maplibre-gl` (~800KB+ typical minified), `@mapbox/mapbox-gl-draw`, `leaflet`,
  `leaflet.markercluster`, and `polygon-clipping` are all real `dependencies` (not devDependencies)
  but are only imported from lazy-loaded feature code**: `maplibre-gl` importers are all under
  `features/bid-sheet/**`, `features/customers/components/field-tag-map/**`, and
  `shared/services/land-map-magic/**` (client/src/app/shared/services/land-map-magic/*.ts);
  `leaflet` importers are `features/customers/components/customer-map/**` and
  `features/customers/components/map/**` and `features/bid-sheet/pages/bid-sheet/bid-sheet.component.ts`.
  Since none of these are imported from `app.routes.ts`, `main.ts`, or any eagerly-loaded
  shared/core module, Angular's build should already split them into separate lazy chunks —
  **but this needs a `stats.json`/`ng build --stats-json` bundle-analyzer confirmation**, not just
  a static-import trace, because a single shared barrel file (e.g. a `@models`/`@shared` index
  re-export) accidentally pulling one of these in would silently inline it into the initial
  chunk. Given the customers feature (Home) is the default `''` route and both `customer-map`
  (leaflet) and `field-tag-map` (maplibre) live inside it as child components of
  `CustomerProfileComponent`, verify these are still behind `@defer` or a nested lazy boundary —
  **`customer-profile.component.ts`'s imports weren't fully traced in this pass**; if
  `CustomerMapComponent`/`FieldTagMapComponent` are statically imported in
  `CustomerProfileComponent`'s `imports: []` array (not `@defer`-loaded), leaflet + maplibre-gl
  both ship in the same chunk as the Home route, which is the app's default landing page —
  this alone could blow the 500kB initial-chunk warning budget in `angular.json:73`. **Action:
  run `npx ng build --configuration development --stats-json` and inspect chunk composition for
  `main.js`/the home-route chunk before assuming this is fine.**

- **`angular.json` initial budget is 500kB warning / 1MB error** (angular.json:70-81) — tight for
  an app with this much mapping tooling if any of it leaks into an eager chunk. Worth re-running
  `npm run build` and reading the actual budget-check output (not done in this pass — recommend
  as a fast, concrete follow-up).

- **`main.ts` bootstrap work is minimal and appropriate** — one `APP_INITIALIZER` doing MSAL
  redirect-handling + deep-link restore, no heavy synchronous work at bootstrap.

## 6. HTTP layer

- **MSAL token acquisition is interceptor-based and scoped to one protected resource**
  (`main.ts:93-100`, `protectedResourceMap` with a single API URI/scopes entry) — standard,
  no per-request overhead beyond what MSAL always does (silent token refresh, cached).

- **Only one `retry()` in the entire client** (`bid-sheet.component.ts:717`,
  `retry({ count: 2, delay: () => timer(400) })`) — reasonable and scoped; no runaway retry
  storms found elsewhere. Most calls instead swallow errors via `catchError(() => of([]))`,
  which is a deliberate resilience pattern (matches `error-handling.md` conventions) rather than
  a perf issue.

- **Type-ahead search debounce is present and consistent**: `customer-list.component.ts:98`
  (150ms + `switchMap` — correctly cancels stale searches), `insights.component.ts:186,190`
  (250ms via `toObservable().pipe(debounceTime(250))` + `toSignal`), `user-preferences.service.ts:45,57`
  (800ms before persisting TU/group prefs). All three correctly use cancellation-safe operators
  (`switchMap` or signal-replace) — no missing-debounce or `mergeMap`-on-search issues found.

## 7. Storage & JSON hot paths

- **`localStorage` usage is narrow and non-hot-path**: `AppStateService` prefs (groups/units,
  tiny), `theme.service.ts` (theme flag), `auth.guard.ts`, `dashboard.component.ts`. No large
  blobs found in `localStorage`/`sessionStorage` outside MSAL's own token cache
  (`BrowserCacheLocation.SessionStorage`, `main.ts:44-46` — a deliberate, documented choice, not
  an oversight).

- **`JSON.parse`/`JSON.stringify` calls are all on small, per-item payloads** (saved-list
  filter objects, field-tag geometry, bid-sheet preference blobs) — none found operating on the
  full bulk arrays (customers/contracts/tickets) on a hot path. Not a finding.

## Summary of highest-leverage fixes (ranked)

1. **Collapse the two parallel preload pipelines** (`DataPreloadService` vs.
   `home.component.ts._loadAllData`) into one owner — biggest redesign, removes an entire class
   of duplicate-fetch/race-condition risk (HIGH).
2. **Add `OnPush` to the ~11 data-table/card/chart child components** that currently default —
   cheap, mechanical, directly addresses a zoneless-specific full-tree-recheck cost (HIGH, quick
   fix).
3. **Confirm via `ng build --stats-json`** whether `maplibre-gl`/`leaflet` leak into the Home
   route's chunk through `CustomerProfileComponent`'s static imports — could be the single
   biggest bundle-size lever in the app if they do (HIGH, needs verification not yet run).
4. **Dedupe `getCommodities()`** and audit the profile component's per-customer effects for a
   selection-cancellation guard, matching the pattern already used one level up in
   `home.component.ts` (MED, quick fixes).
5. Everything else in this report (chart recompute cost, per-row template calls, geocode cache
   not cleared on logout, bid-sheet refresh tick) is LOW/MED and can be batched into routine
   cleanup rather than urgent work.
