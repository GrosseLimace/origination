# API Data Loading & Client-Side Performance — Findings

**Status:** Living document — investigation in progress
**Started:** 2026-07-12
**Trigger:** Initial login / producers list pulling a large unfiltered dataset to the client instead of server-side search + pagination

---

## Table of Contents

- [Strategic context: the ODS-displacement POC](#strategic-context-the-ods-displacement-poc)
- [How this investigation was run](#how-this-investigation-was-run)
- [Section 1 — Completed work](#section-1--completed-work)
- [Section 2 — Unfiltered / unpaginated API endpoints (client over-fetching)](#section-2--unfiltered--unpaginated-api-endpoints-client-over-fetching)
- [Section 3 — Client-side heavy data work that should move server-side](#section-3--client-side-heavy-data-work-that-should-move-server-side)
- [Section 4 — SQL / ODS issues not yet fully tuned](#section-4--sql--ods-issues-not-yet-fully-tuned)
- [Section 5 — Observability gap](#section-5--observability-gap)
- [Open questions for the NLQ-vs-server-search research pass](#open-questions-for-the-nlq-vs-server-search-research-pass)
- [Related docs](#related-docs)

---

## Strategic context: the ODS-displacement POC

**This changes the priority calculus for several recommendations below — read before acting on Section 4 in particular.**

Origination's Customers/Contracts/Tickets/storage data (`base.Customer`, `base.Contract`, `base.Ticket`, `ctrm.GNTA39D1`) all originate from the company's in-house CTRM system, which runs on **DB2 for i on an on-prem Power 10 IBM i**. The ODS (Operational Data Store) exists purely as an intermediary, built on two assumptions:

1. Direct queries from Azure to the on-prem IBM i would be too slow.
2. There was no efficient way to query DB2 for i from Azure at all.

**There is active POC work building a custom GraphQL layer that runs on-prem, near the IBM i**, specifically to enable fast queries directly against DB2 — the true source of this data — from Azure. If that POC succeeds, it removes the original rationale for ODS's existence for these tables.

### Why this matters for the findings in this doc

- **Section 4.2's "local synced ticket table" durable fix** (and the parallel, possibly-stale `customer-trade-unit-map.md` proposal) is an investment in making the **ODS pathway** faster/more durable. If the GraphQL-over-DB2 POC pans out, that effort could become throwaway work — the app would eventually query DB2 directly instead of syncing from an ODS that itself gets displaced.
- **The index work in Section 1** is comparatively low-risk regardless — it's cheap, dev-only so far, easily reverted, and buys real relief on the current (ODS-based) architecture in the meantime. Worth keeping.
- **Anything requiring new app-owned infrastructure against ODS specifically** (new sync tables, new background jobs replicating ODS data) should be evaluated against the GraphQL POC's timeline and confidence level before committing real engineering time. Worth checking in with whoever owns that POC before scoping Section 4.2 further.
- **The Notes/Contracts/Customers over-fetching fixes in Section 2 are unaffected** — those are client-and-API-layer problems (missing pagination, dropped parameters, bulk-loading patterns) that exist independent of which system sits behind the API. They're worth fixing regardless of what happens to ODS.

**Open question to resolve before investing further in Section 4.2**: what's the GraphQL POC's expected timeline and confidence level? That determines whether the "local synced table" direction is worth designing now, or whether it's better to wait and query DB2 directly once the POC lands.

---

## How this investigation was run

Started from one observed symptom (producers list downloading everything on login) and expanded via:
- A whole-repo code review pass (Sonnet) for endpoints returning large, unfiltered datasets.
- A second, narrower sweep for two specific bug classes: call sites that drop an available scoping parameter, and client-side logic that should be a server-side query.
- Live measurement against the **dev** ODS/Origination SQL databases (`azrscosqld01`) — baseline query plans, `sys.dm_db_missing_index_details`, Azure SQL Advisor recommendations, and before/after timing on the app's actual query shapes. **Nothing has been applied to prod.**
- An independent Opus vetting pass that re-measured every proposed index change from first principles and corrected several assumptions along the way (see inline notes below).

### Lessons on review methodology (why one scan wasn't enough)

The first code-review pass was scoped to a single heuristic: "find controllers/queries returning large, unfiltered datasets." That caught Contracts/Customers/Tickets, but **missed two other bug classes entirely**:
- **Call-site parameter drops** — a method already accepts a scoping parameter (e.g. `tradeUnits`), and the server-side filter is fully implemented, but a specific call site just doesn't pass it. This doesn't show up in a signature-level scan; it only surfaces by reading the actual call site. Found this way: the Notes bug (3 separate call sites) and the StoredGrain bug.
- **Misplaced client-side logic** — a component/service doing real query/matching/aggregation work over a fully-downloaded dataset, which is an architecture-placement problem, not a "missing pagination" problem. The first pass noted `build-list.component.ts` as *a consumer* of bulk data but didn't flag that its search engine (`nlq-filter.service.ts`) was itself the deeper issue.

A second, differently-scoped sweep (looking specifically for these two patterns) found the rest. **Any future review of this kind should run both scan types from the start**, not just the dataset-size heuristic.

### Measurement-methodology notes (for anyone re-running these tests)

- **Prefer `SELECT COUNT(*)` over returning full result sets** when timing a query via `sqlcmd`/`SET STATISTICS TIME`. Returning real rows means `sqlcmd` prints them to the terminal, and that client-side rendering time gets folded into the reported "elapsed" time — it can inflate elapsed time by 10x+ while CPU time and logical reads stay accurate. This produced a misleading 52.9s "outlier" during this investigation that was actually a 173ms query.
- **Each Azure SQL Database on a logical server has isolated compute** — `ODS` (Hyperscale) and `Origination` (GeneralPurpose) are separate databases on the same server (`azrscosqld01`) but do not share CPU/IO/log resources. A slow query against one cannot skew a concurrent measurement against the other. Confirmed this directly via `sys.dm_db_resource_stats` when checking whether a slow `/api/notes` call (hitting `Origination`) could have affected a SQL timing test running against `ODS` — it could not.
- `sys.dm_db_resource_stats` (recent utilization history) and Query Store (`sys.query_store_runtime_stats` + `sys.query_store_query_text`) are useful for retroactively confirming *what* actually ran and *when*, rather than guessing at contention after the fact.

Companion files with full detail:
- [`~/ghe/ods-dev-indexes-baseline.txt`](file:///home/khague/ghe/ods-dev-indexes-baseline.txt) — full index inventory of dev `ODS` before any changes.
- [`~/ghe/ods-dev-indexes-created.md`](file:///home/khague/ghe/ods-dev-indexes-created.md) — every index created in dev, with DDL, rationale, and measured before/after numbers.

---

## Section 1 — Completed work

Everything below has been **created in dev only** (`azrscosqld01.database.windows.net`, databases `ODS` and `Origination`). **Nothing has been applied to QA or prod.** Full DDL and measured before/after numbers are in `~/ghe/ods-dev-indexes-created.md`.

| # | Index | DB | Table | Why |
|---|---|---|---|---|
| 1 | `IX_Ticket_CustomerCode_Covering` (rebuilt once to add `CancelFlag`) | ODS | `base.Ticket` | Eliminated a per-row key lookup on the CustomerCode-scoped ticket query. Reads: 12.65M → 75,520 on the same top-500 test (~167x). |
| 2 | `IX_Ticket_ContractNumber` (widened into a covering index) | ODS | `base.Ticket` | Same fix for the other half of the same UNION ALL query (the applied/P-contract branch). Reads: 963,545 → 9,408 (~102x). |
| 3 | `IX_Contract_PrefixActiveCurrent_TU_Ctrm` | ODS | `base.Contract` | Matches Azure Advisor + DMV evidence. Fixes the TU-scoped "today's contracts" lookup: 135,183 → 478 reads (~283x). Does **not** fix the unfiltered bulk load — see Section 4. |
| 4 | `IX_GNTA39D1_EtlDel_RunStamp_Status` | ODS | `ctrm.GNTA39D1` | Table had zero secondary indexes. Built and measured head-to-head against Azure Advisor's own recommendation; this design wins by ~60x (289 vs 17,299 reads) because it keys on `REPORT_RUN_STAMP`, not just `INCLUDE`s it. |
| 5 | `IX_Customer_IsActive_ScoularId` | Origination | `dbo.Customer` | Matches Azure Advisor. Real-world benefit is minor — table is 16.7K rows, fully cached — and it does **not** speed up the producers-grid query as originally assumed (see Section 2, item 2). |

All five are additive or exact-definition rebuilds; none replaced a pre-existing index in a way that loses the original shape (the original `IX_Ticket_CustomerCode`, key-only, predates this work and was untouched). Rollback for any of them is a single `DROP INDEX`.

**Independent vetting corrected two of the original rationales** (Contract and Customer) — the index doc has the full corrected reasoning; summarized in Section 2/4 below.

---

## Section 2 — Unfiltered / unpaginated API endpoints (client over-fetching)

Ranked roughly by user-facing impact.

### 2.1 — Contracts: `GET /api/Contracts` (HIGH)
- `ContractsController` / `ContractRepository.GetAsync` — the unfiltered path (no trade units selected) pulls contracts for **every active producer**, `SELECT c.*` (~75 columns), joined via STRING_SPLIT on `CtrmCustomerId`.
- Measured: **585,482 logical reads / 6.3s** for this path. The new index (#3 above) does **not** fix this — it can't cover 75 columns, and can't seek on the trailing `CtrmCustomerId` key.
- Client side: `api.service.ts` `getContracts()`, preloaded once per trade-unit change into `appState.contracts()`, then filtered client-side by several components (`unshipped-bushels`, `build-list`, `home.component.ts:246,1153` for the single-producer profile view).
- **Two separate problems bundled together**: (a) the unfiltered bulk load itself is slow and needs either column projection (stop selecting 75 columns) or the "local synced table" fix already flagged in code comments; (b) the single-producer Customer Home Page rides on the bulk TU-wide array and filters client-side (`home.component.ts:246,1153`) even though `getContractsByCustomer(customerId)` already exists — this part mirrors the fix already applied to tickets and is a much smaller, low-risk change.

### 2.2 — Producers/Customers list: `GET /api/Customers` (HIGH — original trigger for this investigation)
- `CustomersController.GetAll(tradeUnits)` — no pagination; when no TU filter applies, returns the full active producer roster.
- `CustomerRepository.GetAsync` — `SELECT c.*`, can't be covered by any index (confirmed independently — the new Customer index does **not** speed this query up; it stays a clustered scan regardless).
- Client: preloaded once at bootstrap into `appState.customers` signal, rendered via a non-virtualized `@for` loop. Server-side search (`/customers/search`, 15-result cap) only engages once a search term is typed — the initial/no-term state is always the full bulk payload.
- **Fix**: default the list view to paginated/searched server calls instead of full preload; keep the bulk array (if kept at all) only for small internal lookup maps, not as the rendered row source.

### 2.3 — Tickets: `GET /api/Tickets` (MEDIUM — largely mitigated by indexing, still worth a UX pass)
- Both UNION ALL branches (CustomerCode-scoped and ContractNumber-scoped) are now well-indexed (Section 1, #1–2). Remaining concern is architectural, not query-speed: this still round-trips a 3.8M-row ODS view on demand. Code comments already flag **"a local synced ticket table is the durable fix"** — see Section 4.
- Scoped alternatives (`/tickets/today`, `/tickets/customer/{id}`) exist and should be preferred over `GetAll` wherever a screen doesn't need the full cross-customer set.

### 2.4 — Notes: `GET /api/notes` (HIGH — found via live symptom, not the original code scan)
- **Root cause is a code defect, not a missing index**: `getNotes()` accepts an optional `tradeUnits` parameter, and the server-side filter is fully implemented — but **three separate call sites never pass it**:
  - `data-preload.service.ts:108` (original find)
  - `build-list.component.ts:1745` and `:2070` (found in the follow-up sweep — inside `forkJoin` blocks where every sibling call passes the TU param except this one)
- Effect: every page load / NLQ search downloads the **entire company's note history** (28,837 rows in dev, ~11.3MB observed, ~1 minute) instead of the current trade unit's notes.
- Query itself is fast (172ms CPU, ~4,800 logical reads) — this is a pure serialization/network-transfer cost, confirmed live: the ~1 minute is spent building and shipping the JSON, not running SQL.
- **Fix**: pass `tradeUnits` at all three call sites (S effort). Better still, per-customer detail views (`customer-notes`, `activity-summary`, `producer-insights`, `customer-print-report`) should use the already-existing `getNotesByCustomer(customerId)` and fetch JIT when a profile opens, rather than filtering a bulk array — mirrors the fix already applied to tickets.

### 2.5 — Stored Grain: `getStoredGrain()` unscoped at `home.component.ts:259` (LOW — found in the follow-up sweep)
- Same class of bug as Notes: `tradeUnits` is in scope in the method and used correctly elsewhere in the same file (line 393), but this one call site (a stale-cache refetch) omits it. Smaller blast radius — the storage view is smaller than Notes/Contracts — but same fix pattern (S effort).

### 2.6 — Lower priority / verify-only
- `FarmsController.GetAll` — unpaginated, but no Angular caller was found using the bare endpoint. Likely dead code; confirm and remove rather than optimize.
- `ProducerDetailsController.GetAll` — no TU scope, no pagination, but backed by a small app-owned table (hundreds–low thousands of rows). Low risk.
- `PlantingIntentionsController` — already scoped by trade unit **and** year. No action needed; cited earlier as the example of "doing it right."

---

## Section 3 — Client-side heavy data work that should move server-side

This is the category most relevant to the planned research pass on NLQ architecture.

### 3.1 — `nlq-filter.service.ts` (the NLQ / natural-language search engine) — LARGE, needs dedicated design work
- **3,120 lines**, ~30 distinct filter/detection methods, 207 regex/pattern-match calls. Implements phrase parsing ("notes mentioning drought," "contracts added in the last 7 days," pacing direction, crop/commodity matching, region/state matching, quarter-date matching, acreage, ranking, "linked producer" phrases, synonym normalization) entirely in TypeScript.
- Operates on **fully bulk-downloaded** arrays: contracts (~115K rows), notes (~28.8K rows), customers (~16.7K rows), tickets (subset), planting intentions, stored grain, commodities — all scanned per keystroke-driven query.
- **Shared by three separate UI entry points**, not just one screen: `build-list.component.ts` (the dedicated NLQ page), `customer-list.component.ts` (list search), and `home.component.ts` (producer search). Any redesign has to serve all three.
- This is the item to research: **which parts of this genuinely need to stay client-side for per-keystroke responsiveness** (the phrase-parsing/intent-detection layer is probably fine in the browser) **vs. which parts should become a server-side search query** that can still be called per-keystroke if it's fast enough (indexed SQL search instead of scanning a fully-downloaded array). This is explicitly flagged as a research question, not yet scoped as an implementation plan.

### 3.2 — Blocking single-spinner preload — MEDIUM
- `data-preload.service.ts`: `dataLoading` only clears once customers + contracts + today's-tickets **all** return. The slowest of the three ODS calls dictates time-to-interactive for the whole dashboard, even though the three datasets feed different, independent UI tiles.
- Fix direction: per-dataset loading flags instead of one shared gate (mentioned as already in-flight per other project docs — verify current status before duplicating effort).

### 3.3 — No list virtualization anywhere in the client — SMALL/MEDIUM
- `customer-list.component.html` (and likely other large `@for` lists) renders the entire filtered array as DOM rows — no `cdk-virtual-scroll`/`ScrollingModule` usage found anywhere in the client.
- Independent of any server-side fix: even a perfectly paginated/searched API response of, say, 500 rows still renders 500 DOM nodes at once today. Virtual scroll is a stopgap that helps regardless of how the over-fetching items above get resolved.

### 3.4 — `insights.component.ts` client-side aggregation — LOW, low urgency
- Computes "Unconfirmed Contracts"/"Spot Loads" dashboard cards by looping over already-loaded `contracts()`/`todaysTickets()`, pre-indexed into `Map`s (O(n), not O(n×m) — not sloppy, just architecturally client-side). Operates only on data already required for other tiles, so it isn't causing an extra download. Revisit only if this component's scope grows.

---

## Section 4 — SQL / ODS issues not yet fully tuned

Distinct from Section 1 (done) — these are known, measured, but **not yet fixed**.

### 4.1 — `base.Contract` unfiltered bulk load ("Pattern A") — not fixed by the new index
- `ContractRepository.GetAsync`, no-TU-filter path: `SELECT c.*` across ~75 columns, joined to every active producer via STRING_SPLIT. Measured: 585,482 reads / 6.3s.
- The index created in Section 1 (#3) only helps a *different* query shape (TU-scoped, narrow projection). This one needs either (a) projecting fewer columns, or (b) the same "local synced table" direction already used as the durable fix for Tickets.

### 4.2 — Tickets/Contracts fundamentally re-query multi-million-row ODS views on demand

> **Before scoping this further, read [Strategic context: the ODS-displacement POC](#strategic-context-the-ods-displacement-poc).** This item is an investment in the ODS pathway specifically, which may be a moving target.

- Even fully indexed, this is a live round-trip to `base.vw_CurrentTickets` (3.8M rows) and `base.vw_CurrentContracts` on every trade-unit change. Code comments already state the durable fix is **a local synced ticket table** (a background job populating an app-owned table, refreshed on a schedule) — this was discussed at length earlier in this investigation (historical days precomputed/immutable, "today" refreshed on a short interval) but not yet designed or built. This is the largest architectural item in this whole document.
- A precedent for this exact pattern already exists as a **separate, older, pending doc** in this repo: [`docs/performance/customer-trade-unit-map.md`](customer-trade-unit-map.md) — proposes a precomputed `CustomerTradeUnitMap` table for a related (but distinct) 12–14s query. Worth reconciling/coordinating rather than designing the Tickets/Contracts sync table in isolation — same durable-fix pattern, different table. **Verify this doc's current status before assuming it's still accurate** — it references table/column names (`base.Customer`, `SourceCustomerId`) that don't match the current `dbo.Customer` schema found live in dev, so it may predate a schema migration.

### 4.3 — `ctrm.GNTA39D1` is a shared table Origination doesn't own
- The index created in Section 1 (#4) is Origination-specific and measured against Origination's real queries — but this table is also queried by at least one other consumer (a missing-index DMV entry keyed on `WHR_RECEIPT_NUMBER` doesn't correspond to any Origination code path). Any prod change here needs ODS team review, not just app-team sign-off.

### 4.4 — Azure SQL Advisor cross-check methodology (for future reference)
- Advisor's recommendations matched our own analysis for Contract and partially for GNTA39D1, but in both cases needed correction once checked against the app's *actual* compiled query (including predicates injected by views, e.g. `ctrm.vw_GNTA39D1`'s hidden `WHERE ETL_DELETE_DATETIME IS NULL`). **Don't apply Advisor recommendations verbatim without checking them against the real query shape and a live plan** — this was true in both directions (Advisor sometimes under-weights a good index, sometimes recommends one shaped for a different consumer's workload).

---

## Section 5 — Observability gap

Separate from the query-performance work above, but blocking future data-driven prioritization:

- **Backend**: prod `App Service` already has the codeless Application Insights agent enabled (`ApplicationInsightsAgent_EXTENSION_VERSION=~3`) — confirmed live. This is the **classic** agent, not OpenTelemetry. Per direction already given: standardize on OpenTelemetry in .NET 10 as code promotes through dev/QA/prod, rather than investing in classic-agent sampling workarounds (ASP.NET Core on App Service has no codeless sampling-rate knob anyway — Microsoft's own docs say code-based instrumentation is required to change it).
- **Frontend**: client-side Application Insights (JS SDK) is documented as required in `developer-docs/CLAUDE.md` but was **never implemented** — no `@microsoft/applicationinsights-web` in `package.json`, no `app-insights.service.ts`. This means there's currently zero visibility into real user-perceived latency, SPA errors, or MSAL failures in prod. Also confirmed: App Service's codeless *client-side* JS injection feature is Windows-only and doesn't apply to this Linux App Service — this gap can only be closed with the code-based SDK integration already spec'd in the docs.
- **Prod telemetry sample was too thin to draw conclusions from** — 7-day window showed only ~12 requests total, all static `index.html`, no `/api/*` requests captured (later explained as low real traffic, not misconfiguration). Closing the frontend gap above is the prerequisite for getting a trustworthy read on real user impact for anything in this document.

---

## Open questions for the NLQ-vs-server-search research pass

Captured here so the research work has a fixed starting point:

1. Which of the ~30 filter/detection methods in `nlq-filter.service.ts` are pure phrase-parsing/intent-detection (arguably fine to keep client-side) vs. actual data matching against contracts/notes/tickets/customers (candidates to move server-side)?
2. Can a server-side search be made fast enough to call **per keystroke** (debounced), the way `/customers/search` already does at a 15-result cap — or does the NLQ engine's cross-entity nature (matching across customers + contracts + notes + tickets simultaneously) require a different UX (submit-to-search instead of live-filter)?
3. What's the real row-count ceiling for each entity per trade unit (vs. company-wide) — this determines whether a TU-scoped bulk load is "good enough" without a full server-side redesign, or whether even TU-scoped data is too large for client-side scanning.
4. How do `build-list`, `customer-list`, and `home`'s three separate consumers of `nlq-filter.service.ts` differ in their actual needs — do all three need the full engine, or could some be served by a narrower, faster server-side endpoint while only one keeps full client-side NLQ?

---

## Related docs

- [`~/ghe/ods-dev-indexes-baseline.txt`](file:///home/khague/ghe/ods-dev-indexes-baseline.txt) — pre-change index inventory, dev `ODS`.
- [`~/ghe/ods-dev-indexes-created.md`](file:///home/khague/ghe/ods-dev-indexes-created.md) — every index created, DDL + measured impact + corrected rationale.
- [`docs/performance/customer-trade-unit-map.md`](customer-trade-unit-map.md) — older, possibly-stale precomputed-table proposal for a related ODS query; verify before reuse (see Section 4.2).
- [`developer-docs/CLAUDE.md`](../../developer-docs/CLAUDE.md) — Application Insights / OpenTelemetry setup reference (Section 5).
