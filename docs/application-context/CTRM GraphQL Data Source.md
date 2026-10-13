# CTRM GraphQL Data Source

**Status:** Live in Dev/Development and QA. Production ships **wired but off** (`Ctrm:Source = "ods"`, identity values empty) and still reads the ODS views; turning it on is App Service settings plus the restart they trigger — see *Turning CTRM on in Production* below.

**QA testing caveat.** QA's `GraphQlUri` is the same QA gateway Dev uses, which reads the **nonprod Db2 library, not production CTRM**. A tester comparing a producer against QA ODS is therefore comparing two different vintages of data, so a difference is not automatically a defect. What QA can validate: the right producers appear, contract and ticket counts agree between the two sources for a producer, pricing badges / quantities / elevator names / storage gating are right, and the failure states behave. What QA cannot validate: that CTRM is fresher than ODS - that only shows in production. Flip `Ctrm__Source` between `ctrm` and `ods` as an App Service setting to compare the same producer both ways without a redeploy.

## What this is

Every contract and ticket read — the producer screen, and everything behind Build-a-List, Actionable Insights and the crop-year dashboard — comes from CTRM directly through the **Scoular.GraphQL** API (formerly DB2Connector.GraphQL, AB#33220), not from the ODS views. The ODS was measurably drifting weeks behind CTRM (a hedge roll five weeks late, ticket tails eleven weeks late, one row mixing two points in time), and CTRM is the system of record. The switch happened in August 2026.

Endpoint: `https://apiqa.scoular.com/internal/graphql` (APIM behind an Application Gateway WAF; the old `/internal/db2/graphql` path answers identically for now and is retired). Auth is Entra client-credentials; the secret is `Ctrm--ClientSecret` in Key Vault and is never in `appsettings`.

## How reads are routed

```
Controller → Service → IContractRepository / ITicketRepository
                          │
             ContractRepositorySwitch / TicketRepositorySwitch   (reads Ctrm:Source per call)
                ├─ "ctrm"  → CtrmContractRepository / CtrmTicketRepository
                └─ else    → ContractRepository / TicketRepository   (ODS views, unchanged)
```

`Ctrm:Source` is read on every call, so an App Service setting override flips an environment without a redeploy. Anything other than the literal `ctrm` means ODS.

**Go-live (2026-10-06): every environment runs `Ctrm:Source = ctrm`, for everyone.** The tester toggle that preceded it is retired in the browser: the control under Trade Unit Preferences, `DataSourceService` and the `X-Data-Source-Preference` interceptor are removed, and the compiled read-ahead flags are on again. The server half was removed in the same release: `CtrmSourceChoice`, its middleware, the tester provider, the `/api/me` flags, the CORS header and the keep-warm tester gate are gone, the provenance headers are non-production only again, and migration `20261005131626_DropCtrmSourceToggleUsers` drops `dbo.CtrmSourceToggleUsers` in every environment on its next deploy. Rollback for the whole environment is still the App Service setting `Ctrm__Source = ods`, no redeploy.

**Per-user choice (2026-10-01).** *(Superseded by the go-live above; kept for the history.)* `Ctrm:Source` is the *default*, and it is `ods` in every environment, Production included. A tester on the list - an active row in **`dbo.CtrmSourceToggleUsers`** (UPN, display name, notes, IsActive; add rows with `Documents\ctrm-measure-2026-09-17\add-ctrm-toggle-tester.sql`, no UI by design, read through `CtrmSourceToggleUserProvider` cached 60 s, fails closed to nobody) or the `Ctrm:SourceToggleUsers` setting (comma-separated UPNs; App Service setting `Ctrm__SourceToggleUsers`) - can send `X-Data-Source-Preference: ctrm` or `ods` and have their own requests routed that way; the SPA sends the header from a toggle under Trade Unit Preferences in the profile menu, shown only when `GET /api/me` reports `canChooseDataSource`. The server decides (`CtrmSourceChoice`, populated per request by `CtrmSourceChoiceMiddleware` after authentication, which also settles list membership once per request): anyone not on the list is routed by `Source` whatever header they send, and both sources apply the same trade-unit entitlements, so the toggle changes where the same rows are read from and nothing else. The table is temporary: once every user is on CTRM, it and the toggle go. Why it exists: validating CTRM against ODS on production data before everyone is switched; doing that from QA would have required opening the shared nonprod App Service plan to the production gateway, which the infrastructure team ruled out (2026-10-01). While the list is non-empty, keep-warm runs even with `Source = ods`, confined to the producer sets testers have opened through the CTRM path, and the `X-Data-Source*` provenance headers are emitted in Production for those users only, plus `X-Data-Source-Choice: user|default` saying whether their preference or the default decided the source. The browser stores the preference in `localStorage` (`origination.dataSourcePreference`) and reloads the page on a change so no screen mixes the two sources.

Files: `api/GrainOriginatorPortal.Infrastructure/Ctrm/` (repositories, readers, mappings, `CtrmQueries.cs`), `api/GrainOriginatorPortal.Api/Services/Ctrm/CtrmGraphQlClient.cs` (HTTP, token, error taxonomy).

## What comes from where (Ctrm:Source = ctrm)

| Read | Source | Shape |
|---|---|---|
| Producer contracts, pricing lines, Harvest Pace | CTRM live | `contracts(customerId:)` — no date range, full history, one cached read serves all three |
| Producer applied tickets | CTRM live | `tickets(contractNumbers:)` over the producer's OPEN purchase contracts |
| Producer unapplied + storage tickets | CTRM live | `tickets(customerId:)` |
| Per-contract applied tickets | CTRM live | `tickets(contractNumbers:)` (no UI caller today) |
| Crop-year contracts (Build-a-List, Dashboard) | CTRM | The same cached producer-set read as the trade-unit list, filtered by crop year in memory. `cropYear` is deliberately NOT sent — on 2026-08-26 the server's response cache keyed it out and returned the wrong year. |
| Spot Loads (recent unapplied, all producers) | CTRM live | `tickets(customerIds:)` over the last 30 days + 7 ahead |
| Open-activity trade-unit lock (edit dialog, nightly sync) | via the switch | reuses the producer contract + unapplied ticket reads |
| Trade-unit contracts (Build-a-List, Insights, Unshipped Bushels) | CTRM | The ODS flow: selected trade units → their producers in Origination → one indexed `contracts(customerId:)` lookup per producer, full history, no date window — batched since 2026-09-24 as GraphQL aliases, 5 aliases × 2-code lists = 10 producers per HTTP request, 16 requests in flight on a pool of their own (`Ctrm:TradeUnitContractStrategy` = `aliased`, `TradeUnitContractBatchConcurrency` 16; ~59 requests and 4.7–8.3 s for a 587-producer unit against 587 requests and 36–73 s one-per-call, identical contract set, slowest request 7–9 s). A failed batch retries on singular aliases, then fails the whole read. Cached per producer set, served stale-while-refreshing. Warmed by the home-page contract load. **Superseded 2026-10-12:** the default is now `Ctrm:TradeUnitContractStrategy` = `tradeUnit`, which reads the unit's own book in 6–21 pages instead — see "Reading by trade unit" below. `aliased` stays available as the fallback. |
| Trade-unit-wide tickets (every prompt mentioning tickets, deliveries, unapplied, unsettled) | CTRM | Same flow: trade units → producers → `tickets(customerIds:)` over the 3-year lookback in 366-day windows. Both applied and unapplied branches, same rule as the producer screen. Kicked off in the background by the home-page contract load. |
| Farm lookups, contract by source id, per-contract pricing lines | **ODS** | no UI caller; CTRM has no farm concept / no contract-number argument |

**ODS by design, on both sources.** These annotate or subtract from CTRM rows and never add one: customer master (`dbo.Customer`, filled nightly by the customer sync from ODS or CTRM per `CustomerSync:Source` — see *Customers from CTRM* below), the storage gate (`ctrm.vw_GNTA39D1` — CTRM has no storage entity), lb→bushel factors (`vw_GNP024`), elevator names (`MbpLocationSynonym`), producer↔trade-unit maps, DP contracts, stored grain.

## Rules preserved from ODS

Every rule the ODS queries applied is applied to CTRM rows, in the same shared code where one exists:

- Contracts: purchase prefix `P` only; a producer's list is open **or** `cropYear ≥ last year`; status from `ContractStatusCalculator`; the Db2 `0001-01-01` sentinel on `closedDate` is null; `Signed = true`.
- Tickets: types `U`/`P` only; consolidated excluded; cancelled excluded (server-side and again per row); unapplied = contract number starting `U`/`L`/`C`; applied = on one of the producer's open purchase contracts **regardless of the row's customer code** (so a split load shows under both producers); three-year lookback; storage tickets kept only while the producer still holds that commodity.
- Quantities: `AppliedNetQuantity` is pounds on both sources; bushel conversion is unchanged and downstream.

CTRM has no surrogate ids, so `Contract.Id` / `Ticket.Id` are deterministic FNV-1a hashes in a reserved band below 2^53 (`CtrmSyntheticId`). Nothing app-owned persists them; the client uses them only as dedup and expansion keys. All joins use the string codes (`ctrmCustomerId`, `customerCode`, `sourceContractId`).

## Why the shapes are what they are (measured, not assumed)

- **`customerId` (singular) is indexed** and waives the date range: a producer's full history in ~1–2s. **`customerIds` (list) on `contracts` is not**: ~20–27s cold per chunk in every shape (fixed on `tickets`, reported for `contracts`). This is why the trade-unit reads are cached and warmed in the background rather than run on a click.
- **Ticket queries always need a date range, capped at 366 days**, because the customer lives on the detail row and the range bounds the header scan. Longer lookbacks are sliced into windows fetched in parallel. The cost is the scan, not the rows: 30 days ≈ 1 day ≈ 6s for 88 producers; three years for all producers ≈ 1,000 pages — which is why the unapplied-tickets prompt stays on ODS.
- **Pricing lines double a contract page** (~8s vs ~4s per 500 rows). Only the per-producer read projects them; the producer-set read takes the core fields.
- **A customer code of 8+ characters makes `customerIds` return an internal error that fails the whole request.** `CtrmCustomerCodes` drops such codes (real ScoularIds are 5–7) and logs them. Reported to the API team.
- **The API caches list-query results, and the key omits `cropYear` and `tradeUnit`** (measured 2026-08-26: `cropYear: 2026` returned the 2024 set issued moments earlier; `tradeUnit: 9999` returned dozens of trade units; changing `take` to 499 exposed the true answer). It is INTERMITTENT: the identical `cropYear: 2026, take: 500` request returned the correct 96 rows once and the 2024 set on a rerun minutes later, so a single passing probe proves nothing - run the pair twice. The pattern (and the same query alternating between two totals earlier that day) is consistent with a per-instance cache behind a load balancer. The key DOES include `customerId`, `customerIds`, `contractNumbers`, `contractPrefixType`, the date range, `skip`/`take` and the exclude flags — verified by pairwise probes — so every read still live is safe. Do not build on `cropYear` or `tradeUnit` until the API team confirms the fix.
- **`excludeCancelled: true` drops cancelled ticket headers, not cancelled detail rows** (8 of 219 detail rows still carried `cancelFlag = Y`). The per-row `CancelFlag` check in `CtrmMappings` is therefore load-bearing, not redundant.
- **No `#` comments in any query document.** The WAF reads `#` as a SQL comment and answers with an HTML 403 the API never sees. `CtrmQueryDocumentTests` enforces this and other structural properties on every document.

## Trade-unit scope (measured 2026-08-27, dev)

Prompts and saved lists are scoped to the user's selected trade units, so the trade-unit reads carry a trade unit's producers, not the company's: 16,763 active producers in total, but the largest trade unit (1340) has 1,271, the next tier 700–860, a typical one 150–400, and ~40 have under 50. One–three `customerIds` chunks of 500. Cold cost for a mid-size unit: contracts ~25s per chunk (server-side, see gaps); tickets ~15–40 pages of 500 at 3–5s each across the three windows. Warm: instant. With no trade unit selected the scope is every active producer (the ODS rule — "a narrowing convenience, not an entitlement boundary"), which is 34 chunks and minutes cold; the client never makes that call today.

## Caching

| Layer | TTL | Purpose |
|---|---|---|
| Per-producer contract read — CORE (no pricing lines) | `Ctrm:LiveCacheSeconds` (60) | Coalesces the contract list, the pacing card and the ticket read's open-contract set into ONE call; the in-flight task is shared |
| Per-producer contract read — FULL (with pricing lines) | `Ctrm:LiveCacheSeconds` (60) | Its own entry. Prices roughly double a page (8.1s vs 4.0s per 500 rows), so only the pricing-line read pays. A completed FULL satisfies a CORE request; CORE never satisfies FULL, and an in-flight FULL is not awaited by a CORE caller |
| Per-producer ticket read | `Ctrm:LiveCacheSeconds` (60) | One read serves both applied and unapplied — the classification is ours, not a query each |
| Ticket window containing today | `LiveCacheSeconds` | New tickets land here |
| Ticket windows entirely in the past | `Ctrm:HistoricalTicketCacheMinutes` (30) | Older tickets rarely change and cost the most; bounds how stale an old ticket's status can be |
| Trade-unit contract read (per producer set) | `Ctrm:TradeUnitCacheMinutes` (15) | Stale-while-revalidate: an expired copy is served instantly while the refresh runs behind it. Nobody waits unless nothing is cached yet |
| Trade-unit ticket read (per producer set × window) | same per-window TTLs as above | Stale-while-revalidate too. A prompt run a minute after the last is instant; the run after sees the update |
| Client hover prefetch | 60s, side map | Resting on a producer row fires the reads so the click renders from memory |

Failures are never cached at any layer.

## Failure behaviour

There is **no ODS fallback** on the CTRM path. A failed CTRM read returns an empty list and logs `INFRASTRUCTURE_CTRM_UNAVAILABLE` with a categorised status (`NotConfigured`, `TokenFailure`, `EgressBlocked`, `Unauthorized`, `Throttled`, `QueryError`, `PartialSuccess`) and operator-oriented detail. Silently serving ODS would hide the outage and invalidate any conclusion about CTRM's data. In non-production, response headers carry the provenance of each read (`CtrmProvenanceMiddleware`).

The API's own status taxonomy is handled explicitly: business validation → HTTP 200 with a `VALIDATION`-coded error; malformed query → 400; bad auth → 401; both mapped to `QueryError`/`Unauthorized` rather than surfacing as 500s. A per-attempt 30s timeout with two retries sits under a 110s overall budget.

**Reporting a CTRM fault: the captured `x-correlation-id` does not resolve on the API side yet.** Confirmed by the API owner 2026-09-09 and filed high-severity on their side. Two structural reasons: GraphQL answers an internal fault with HTTP 200 plus an `errors` array, so every such call is recorded as a *success* in their telemetry, and their logging never forwards the error detail to App Insights at all. They went looking for the fault we reported on 2026-09-08 and could not find it. Keep capturing the header - it becomes correct the moment that is fixed - but until then the three things they can actually correlate against the Db2 dependency telemetry are the **UTC timestamp, the producer-set size, and the window**. Our ticket failure detail already carries the last two (`Live ticket read failed for 271 producer(s) (2024-09-06..2025-09-07)`); contract failures carry the producer or count and no window, which is right because those reads carry no date range. `appsettings.Development.json` now stamps console lines dated and in UTC so a local line can be handed over as-is - it previously logged local time with no date, and the fault we reported read `07:59:19` when it actually happened at 12:59 UTC.

**CTRM's own 30-second server timeout (`HC0045`, returned as HTTP 400): background reads retry it ONCE after 90 s; interactive reads do not retry it** (as of 2026-09-29; both were 0 from 2026-09-03 to then). The history matters because the two decisions rest on the same fact. The CTRM server answers HC0045 at 30 s but does not cancel the Db2 query, which runs on to completion (70 s and more); a re-send that lands while the first copy is still running competes with it on the same partition and slows both. With the old budget (background 4 x 8 s, interactive 1 x 3 s) there were five copies of one 70 s query in flight by ~32 s, and our own probe of a count issued right after a timed-out page timed out too (76 s). The API team has also established that nobody can bound such a query: the driver ignores the connection-level timeout, a client timeout does not stop it (a 10-second client limit was observed letting an 86-second query run to completion), and the server-side control requires an authority they do not hold. So quick re-sends stay off, permanently. What changed on 2026-09-28/29 is the API team's diagnosis of *why* a query overruns: a fresh Db2 connection pays a one-time plan compile of ~25-31 s, right at the 30 s limit, after which the query finishes and its result is cached, and the identical request is then served from cache. Measured on the PROD gateway 2026-09-29: the app's 10-producer batch cold = HC0045 at 31.5 s, the same batch re-sent later = 2.6 s. That is exactly the "one retry after 90 s or none" shape the API owner suggested on 2026-09-03, which was not representable while `CtrmServerTimeoutRetry` capped the delay at 60 s; the cap is now 120 s and the configuration is `ServerTimeoutRetries` 1, `ServerTimeoutRetryDelaySeconds` 90. Only the paired batch attempt carries the delayed retry; the singular re-shape that follows a paired failure is sent once, so a doomed batch fails in 30 + 90 + 30 + 2 + 30 s and the load-shedding then stops the walk. `InteractiveServerTimeoutRetries` stays 0: per-producer reads measured 0 HC0045 in 791 calls on 2026-09-02, and a click that does hit one should show the retry message at 30 s rather than wait another minute and a half. Two other things moved with this: the client's per-attempt timeout went from 35 s to 45 s, because the HC0045 answer was measured arriving at 31.5 s (PROD) and 36 s (nonprod), so at 35 s the client was cutting it off first and turning a server-side timeout the circuit breaker ignores (a 400) into a `TimeoutRejectedException` it counts - one cold sixteen-batch walk then opened the breaker and blocked every producer click for 30 s; and `TradeUnitContractBatchConcurrency` went from 16 to 8 in the base file with the nonprod environments at 4 (burst measurements in the `appsettings.json` comment).

## Configuration

Base `appsettings.json` documents every key with a `// Key` sibling. Per environment: `Source`, `GraphQlUri`, `TenantId`, `ClientId`, `Audience`, `PageSize`, `PageConcurrency`, `TradeUnitCacheMinutes` (15), `TradeUnitContractStrategy` (`tradeUnit`; `aliased` and `perProducer` remain), `TradeUnitReadWindowYears` (3), `TradeUnitReadPageConcurrency` (4), `TradeUnitPerProducerConcurrency` (8), `TradeUnitContractConcurrency` (2), `TradeUnitContractMaxPagesPerChunk` (100), `TradeUnitTicketMaxPagesPerWindow` (200), `TradeUnitMaxConcurrentRequests` (6), `BackgroundMaxDeferSeconds` (20), `ServerTimeoutRetries` (0) / `ServerTimeoutRetryDelaySeconds` (8), `InteractiveServerTimeoutRetries` (0) / `InteractiveServerTimeoutRetryDelaySeconds` (3), `InteractivePageConcurrency` (4), `InteractiveWindowSplit` (1 = off), `CrossBookedAppliedTickets` (false), `LiveCacheSeconds`, `TicketLookbackDays` (1095), `HistoricalTicketCacheMinutes`, `RecentTicketDays` (30; Spot Loads).

To enable an environment: copy Dev's `Ctrm` block, add `Ctrm--ClientSecret` to that environment's Key Vault, confirm APIM egress (no custom NSG rule needed), restart.

## Turning CTRM on in Production (runbook)

**Status 2026-09-29: the 2026-09-29 release ships with CTRM OFF; go-live is Thursday 2026-10-01.** `appsettings.Production.json` carries `Source: "ods"` with the PROD gateway values already in place, so PROD reads ODS exactly as before and nothing talks to CTRM. Branch `release_CtrmGoLive_2026-10-01` flips it: `Source: "ctrm"`, the client's `ctrmReadAheadEnabled` back to true, and a What's New entry for CTRM. Merging and deploying that branch on Thursday is the go-live; the pre-flight is `prod-batch-probe.ps1` (the app's 16-batch burst passed against PROD on 09-29: 15 of 16 ok, single reads 0.2–0.8 s right after). Rollback stays a setting (below). History: written 2026-09-23 as a "wired but off" flip, switched to "ships ON" on 09-28 when the API team delivered the PROD environment, and moved back to off on 09-29 when the go-live date moved.

### What had to exist first — all done 2026-09-28

| Item | Value / status | Where it lives |
|---|---|---|
| PROD GraphQL endpoint — reads **production** Db2 (not `apiqa.scoular.com`) | `https://api.scoular.com/internal/graphql`; a single POST to that path | `Ctrm:GraphQlUri` |
| API audience | `api://243ea5dc-2187-44aa-aa62-3d303608be53/.default` — the API team confirmed it is the same in every environment | `Ctrm:Audience` |
| Client app registration | `scoular-graphql-client-prod`, appid `25ce2e75-76b6-4fb9-a6bf-ed76ef11adae` (service principal object id `06642509-1de5-4ebc-8e7f-a0342383f0d6`), holding **Db2.Read.All** on `scoular-graphql-api` | `Ctrm:ClientId` |
| That registration's secret | In **`kv-orig-eus`** as `Ctrm--ClientSecret`, added and enabled 2026-09-28. The registration's only secret expires **2028-07-15** — rotate before then. Never paste it into chat, tickets or email. | Key Vault, read at startup by the app's managed identity |
| Subscription key | None expected (API team, 2026-09-28). We send a bearer token only. | — |
| Rate limit | **3,000 calls per 60 s for `scoular-graphql-client-prod`**, keyed per identity. Raised from the default 1,000 by the API team on 2026-09-28 at our request, sized at about 3× our worst case: a cold trade-unit load is ~60–130 contract calls plus ~70 for ticket history, and keep-warm repeats them every 5 min per trade unit in use. A 429 now carries `Retry-After` and `X-RateLimit-Remaining`. **Our client does not act on `Retry-After` yet:** a 429 surfaces as `Throttled` in the provenance headers and a load error with Retry on screen. Honouring `Retry-After` in the CTRM HTTP pipeline is a follow-up if the limit is ever reached. | API team policy |
| End-to-end check | A laptop smoke test with this identity and secret passed 2026-09-28: token issued with Db2.Read.All, `query { __typename }` 200, a production `contracts` read 200. | `Documents\ctrm-measure-2026-09-17\prod-smoke-test.ps1` (not in the repo) |
| PROD App Service instance count | Still to confirm with Infra: `CtrmKeepWarmService` has no single-instance guard, so N instances = N× keep-warm calls against the rate limit. | — |

### Deploying it

1. The PROD `vw_CustomerTradeUnits` view change (`Scripts/AddIndustryCode2AndNopIdToCustomerTradeUnitsView.sql`) runs first; it is manual in every environment.
2. Run **Originations Deploy to PROD** on `main`. It applies the EF migrations, deploys, and the restart that follows builds the CTRM credential with the vault secret.
3. Do **not** set `Ctrm__*` App Service settings — they would override the committed values. The concurrency and cache settings in base `appsettings.json` are the measured values.

### Verifying it worked

The CTRM diagnostics endpoints are deliberately unavailable in Production (`DenyIfProduction`), so use what every request already carries:

- Open a producer; in the browser network tab the contracts and tickets responses carry `X-Data-Source-Contracts: ctrm…` and `X-Data-Source-Tickets: ctrm…`, and `Server-Timing` shows the CTRM portion. A value of `ods` means the switch did not flip; `NotConfigured` means an identity value is empty; `Unauthorized` means the secret or the role is wrong; `Throttled` means 429.
- The App Service log stream (PROD inherits `Default: Information`) prints `CTRM contracts: N for producer X` and `CTRM tickets: N rows for producer X` per click, and `CTRM live contracts: … via N per-producer call(s) in Ns` for the first trade-unit load.
- Spot-check 5–10 known producers against what ODS showed before the flip (contract count, open contracts, ticket count). Expect small differences to be **ODS drift**, not defects — PROD CTRM against PROD ODS is the first like-for-like comparison; in QA the gateway's snapshot made counts differ by whole contracts. Decide beforehand who adjudicates.
- Two Actionable Insights cards (Unconfirmed Contracts, Unshipped Bushels) and the contract-filtered Build-a-List prompts wait for the first trade-unit contract load of a session — expect 30–60 s once per two hours per trade unit, then cached. That is the known cost the API team's warming and two-step paging work addresses; it is not a flip failure.

### Rolling back

Set `Ctrm__Source = ods`. Both repository switches and keep-warm re-read that key on every call, so after the settings restart PROD is on ODS again. Nothing else needs to change; the identity settings can stay.

### What a failure looks like to users, and what it is not

A CTRM read that fails shows an amber **"Contracts could not be loaded"** (or tickets) with a Retry button — never an empty list. There is **no automatic ODS fallback**, by design: silently mixing sources would be worse than an honest failure. If one producer's call fails twice inside a trade-unit walk, the whole walk fails, so a short 429 burst is visible as this message for its duration. There is no alerting on it — the API has no Application Insights SDK; the log stream is the only signal.

**Load-shedding when the gateway is slow (added 2026-09-28).** A slow phase on the nonprod gateway that evening showed the app making a bad phase worse: a walk that was going to fail still sent all 59 batched requests plus a retry for each, every timed-out query kept running on the database to completion (70 s and more, per the API team), and keep-warm re-sent the whole walk plus the ticket walk five minutes later — from four copies of the app at once. Two things now stop that: once a batch has failed on both attempts, the walk sends no further batches and in-flight batches skip their retry (`CtrmContractReader.FetchAliasedAsync`); and keep-warm leaves a set alone for `Ctrm:KeepWarmFailureBackoffMinutes` (15) after any of its reads fails, skipping the rest of that set's cycle (`CtrmKeepWarmBackoff`). Neither changes what a user sees — the caches keep their last good copy and a user's own request is never gated — they only stop the app queuing work the gateway cannot do.

### Known caveat carried from QA

QA's `ctrm.vw_GNTA39D1` storage view is empty, so C-prefix (customer-storage) unapplied tickets never appear in QA; PROD's view is populated, so they will. Testers comparing QA to PROD will see that difference — it is the QA view, not the code.

## Deliberate divergences from ODS (decided, not defects)

| Behaviour | Why |
|---|---|
| A failed read answers **503**, never 200 with an empty list | The repositories return `[]` and never fall back to ODS, so an outage and "this producer has no contracts" are the same shape in the data. A gateway timeout rendered as "no producers found" twice during development. `SurfaceCtrmFailuresAttribute` converts a recorded failure at the edge; internal callers that legitimately tolerate an empty result (the open-activity trade-unit lock) are unaffected. Truncated reads stay 200 with `X-Data-Partial`. |
| No trade unit selected returns **empty**, where ODS returned every producer | ODS answered that in one indexed query; against CTRM it is 16,763 producers in 34 chunks of a ~25s call. The client never asks unscoped — an empty list only arrives when the entitlement filter has stripped the selection, and the honest answer to that is nothing. |
| Trade-unit ticket pool bounded to `Ctrm:TicketLookbackDays` (1095) | ODS had no lower bound. CTRM requires a bill-of-lading range on every ticket query, capped at 366 days, so a bound is structural rather than chosen. |
| Spot Loads reaches **+7 days** forward | The ODS query bounded only the near end. CTRM needs both, and the cost of a ticket query is the scan rather than the span, so the far end is cheap headroom for forward-dated bills of lading. A ticket dated further out shows on ODS and not here. |
| One row per ticket DETAIL row | A header's quantities describe the whole load; collapsing a split ticket to its header would attribute another producer's bushels to whoever was asked about. |
| `UnloadQuantity`/`LoadoutQuantity` are header values repeated on every detail row | Not a per-producer figure. `insights.component.ts:299` falls back to them and can therefore over-count a split load — flagged to the Insights owner rather than changed here. |
| Applied ticket rows carry a synthetic `ContractId` | Restores the client's fallback contract-to-ticket join, which had no value to match on. The ODS FK is documented as "not reliably populated", so this adds a link rather than changing one. |
| `GetAppliedByContractAsync` bounded to 1095 days | No UI caller. ODS was unbounded; same 366-day-range constraint as every other ticket read. |
| Per-producer applied tickets come from the `customerId` read, not a second contract-scoped read | Applied vs unapplied is our own rule, so it does not need a query each, and a ticket read is charged by the date scan — a second read doubled the scans. Sampled 90 producers over a year: zero rows only the contract-scoped read could find. `Ctrm:CrossBookedAppliedTickets` restores it. |

## Keeping the trade-unit caches warm

`CtrmKeepWarmService` (hosted, no-op unless `Ctrm:Source` is `ctrm`) re-runs the trade-unit contract and ticket reads for producer sets used within `Ctrm:KeepWarmForHours` (2), every `Ctrm:KeepWarmMinutes` (5). `CtrmWarmRegistry` records which sets those are - both trade-unit-wide reads touch it - capped at 32 sets, evicting the least recently used.

It cannot change what any screen shows: it calls the same reads with the same documents, filters and caches, and a fresh cache short-circuits without a request, so CTRM volume is still governed by the TTLs. What it changes is *who waits* - the stale-while-revalidate refreshes happen on the clock instead of landing on whichever user prompts first after a quiet spell. A failed cycle leaves the last good copy in place and the next cycle retries. After a restart the registry is empty by design: producer sets are resolved from the Origination DB per trade unit, and replaying a persisted set could warm the wrong producers.

## Spot Loads (2026-08-31)

`GET /tickets/today` → `CtrmTicketRepository.GetTodaysAsync`, one CTRM read over a `-Ctrm:RecentTicketDays / +7` window, chunked 500 producers at a time. Testers reported it slow; the queries were not (CTRM 0.5–2.2 s, the ODS lookups 0.1–0.6 s) — the scheduling and caching around them were. Four things changed:

- **It is interactive work.** Page routing keys off an explicit `Scope.Interactive`, not "does this scope have a cache key". The chunked read has no per-scope key (its caller caches the whole window), so it had been classified as background and paid up to `Ctrm:BackgroundMaxDeferSeconds` of deferral *per page* behind any interactive read, a slot in the shared background budget alongside the trade-unit walk, and the patient HC0045 budget. The trade-unit walk stays background — nobody watches it.
- **Stale-while-revalidate on `Ctrm:TradeUnitCurrentWindowCacheMinutes`**, not a bare 60 s. The card paints from cache immediately and updates in place when the refresh lands; nobody waits on an expiry.
- **`CtrmKeepWarmService` warms this window explicitly.** Its dates come from `CtrmTicketRepository.SpotLoadWindow`, shared with the request, because the cache key embeds them — warming a key nobody reads is exactly how this window came to be missed (the service warmed the three 366-day history slices, whose dates can never coincide with −30/+7).
- **Producer scope is the app snapshot only.** It used to union `dbo.CustomerTradeUnit` with codes from ODS `base.vw_CurrentContracts`, on the assumption that dropping the union would lose producers. Measured on QA: the union adds 29–30 codes per trade unit and every one (ADMMLI, BUNGCO, KANSGL…) is absent from `dbo.Customer` — commercial counterparties, not producers, which Actionable Insights can never render because it iterates the customers it knows. Removing it takes the last ODS *contract* read off this path, saves ~640 ms, stabilises the cache key (a contract retag no longer changes the producer hash), and fixes a real bug: the mapping set was built from untrimmed codes while the mapper trims, so a CHAR-padded code silently lost its tickets.

Also measured and rejected: `contracts(tradeUnit:)` can answer the producer-scope question on CTRM, but it *requires* a date range, so for TU 1340 over one year it is 6 pages / 21.2 s and finds 884 producers against the ODS query's 1,040 — slower and less complete. Deleting the query beat porting it.

## Reading by trade unit instead of by producer (default since 2026-10-12)

Greg's question: Build-a-List is "trade unit, then contracts", so list a producer only when they are **in** the selected unit **and** the contract is **tagged** to that unit. That is a different question from the walk above, which returns every contract a roster producer holds whichever unit it is booked under. Decided 2026-10-12 with Greg: `Ctrm:TradeUnitContractStrategy` = `tradeUnit` is the default (`aliased` remains the fallback, one setting away): one `contracts(tradeUnit:, contractDateFrom/To:)` read per selected unit (`CtrmQueries.ContractsByTradeUnit`, `CtrmContractReader.FetchByTradeUnitsAsync`), 500 rows a page, `Ctrm:TradeUnitReadPageConcurrency` (4) pages in flight on the batched-contract pool, rows kept only for producers on the resolved roster, de-duplicated by contract id, any failed page failing the whole read. The window is `Ctrm:TradeUnitReadWindowYears` (3) back and a year forward; the server requires one on this filter.

**Why it is fast.** The cost is per page, not per producer. Measured 2026-10-12 against the nonprod gateway in a slow phase, three interleaved rounds each, every run validated by contract id with zero failures: TU 2190 (587 producers) 7–10 s over 6 pages against 52–70 s over 59 batched requests; TU 1340 (1,271 producers) 14–20 s over 21 pages against 60–78 s over 128. The slowest single request also drops to a third (3–7 s against 11–19 s), which is headroom against the server's 30 s cutoff. A 5- or 10-year window gains nothing the app keeps and costs 2190 up to 25 s.

**What changes on screen.** Nothing on the producer page: it still reads by producer, and a click is never served from a set built this way (`TryServeFromProducerSet` returns null under this strategy), so a producer's whole book is shown. On Build-a-List contract prompts, the crop-year list and both Insights cards, a roster producer's contracts booked under another unit disappear. On 1340 that is 10 of 2,784 kept contracts and 2 of 345 producers with an open contract (CBAGMA, ROANENE — booked under 2080). On 2190, one of a cluster of sibling units, it is 164 of 1,181 contracts (21 open, 17 of them unconfirmed), 6 of 61 producers with an open contract, the Unconfirmed Contracts card going from 89 to 72 and Unshipped Bushels down 5%. Rows for producers the unit's contracts name but our roster does not (46 producers on 2190, 39 on 1340) are dropped. Live in the app the same day, with a 72,542-ticket history downloading alongside: 1340 in 33 s, 2130 (761 producers) in 29 s, 2190 in 16 s, a 131-producer unit in 3 s. The full tables are in `Documents/ctrm-measure-2026-09-17/MEASUREMENTS-2026-09-17.md`, Phase O. One more consequence: because a click is no longer answered from the trade-unit set, producer clicks are live per-producer reads again (0.5–2 s, hidden by the hover prefetch) rather than instant. Tickets, storage and DP contracts are unchanged: the `tickets` field has no trade-unit argument and the `Ticket` type no trade-unit field (probed 2026-10-12), so the same shape is not available there, and the ticket cost is per 500-row page with the same rows either way, so it would gain little.

**Plumbing.** The repositories pass the selected units to `GetForProducersAsync(codes, tradeUnits, …)`; the reader remembers them against the producer set's cache key (the key stays the hash of the codes), so keep-warm and the trade-unit ticket read, which ask by codes alone, share the one entry and a refresh they trigger still reads by unit. A codes-only caller for a set with no units known reads by the aliased walk and logs that it did.

## Serving a producer click from the warm trade-unit cache

A click used to re-read a producer live even though the home-page load had already fetched that producer's rows for Build-a-List. It now serves those rows immediately (`Ctrm:ServeClickFromTradeUnitCache`, default on) and **always** starts the live read behind the answer, so the per-producer cache converges; the client also re-reads once a few seconds after the first paint, which is how something added in CTRM between the warm-up and the click appears without the user leaving the page.

Qualification is strict, because serving the wrong thing here shows a producer someone else's idea of their book. The set entry must be completed (never an in-flight refresh, whose age is unknowable), successful, fully `Ok` (a TRUNCATED set cannot say which producer lost rows), and within `Ctrm:ServeClickFromTradeUnitCacheMaxMinutes` (15) for contracts or still unexpired for tickets - where the current ticket window's own TTL applies, so a click's tickets are never staler than a Build-a-List prompt's. Tickets are all-or-nothing across the lookback's windows: mixing a cached window with a live one would produce a list whose halves describe different moments. A fresh per-producer entry always wins over a set. The row filters are the same predicates the server applies (`customerId` on contracts, a `details.customerCode` semi-join on tickets), so the rows equal what a live read of that moment returned. Provenance reports `ctrm:OkFromTradeUnitCache`.

## Projection scope (2026-08-28)

Both projections carry only fields something actually reads, verified by a cross-layer trace (mapping, response serialization, client templates and logic, server-side rules). Ten ticket fields, `customerName`, and twelve of the twenty price fields were removed. Measured on QA, same window, alternating runs: a 194-row ticket window went from 3.83s to 1.59s for one producer and 3.16s to 2.07s for another, with identical row counts - this API resolves fields per row, so dead fields on a ticket DETAIL row cost real time. `unloadQuantity` stays because Actionable Insights uses it as a fallback quantity; `LastActivityTimestamp` stays on the DTO (not the projection) as the regression vehicle for `CtrmDateTimeConverterTests`. Re-adding a field means projecting it, mapping it, and naming a consumer.

## The last ODS contract and ticket reads (closed 2026-09-08)

Three reads outside the repository switches still touched ODS contract or ticket rows. None displayed contract
or ticket data, which is why they outlived the migration, and all three are now resolved.

**Planting Intentions producer scoping** was the only one that ran on every trade-unit load, and it was the
last ODS contract read on the CTRM path. It resolved the in-scope producers by unioning `dbo.CustomerTradeUnit`
membership with producer codes taken from `base.vw_CurrentContracts`. It now uses membership alone. Measured
before removing it, on trade units 1340, 2057, 2115 and 2190: the contract scan contributed 29-30 codes apiece
that membership missed, **every one of them absent from `dbo.Customer`** - commercial counterparties (ADM,
Bunge, grain companies) Scoular buys from, not producers. Because codes are resolved to `CustomerId` through
`dbo.Customer`, a code with no customer row cannot produce a planting record, so none of them could ever
render. The case that *would* have lost data - a producer present in `dbo.Customer` but missing an active
membership row - measured **zero on all four units**. `PlantingIntentionRepository` no longer takes
`OriginationDbContext` at all; `PlantingIntentionScopingTests` pins that membership is what decides scope.

**The commodity sync** (`CommodityRepository.SyncAsync`) read distinct commodity codes from ODS contracts and
product codes from ODS tickets to discover new commodities. It had no caller anywhere - no controller, service,
background job or test - so it was 87 lines of dead code holding the only ODS contract and ticket reads in that
repository, and it was deleted. The crop dropdown was never affected: `GetActiveAsync` and `GetPlantingAsync`
read the app's own `dbo.Commodities` table. `GetConversionsAsync` still reads ODS `ctrm.vw_GNP024`, which is
commodity reference data rather than contract or ticket data and stays there. The Dev-only
`POST /api/diagnostics/commodities/seed` endpoint also still seeds from ODS contracts; it is a manual
developer tool, explicitly gated to Development, and is left alone deliberately.

**Usage-dashboard contract labels** turned a clicked contract into "number - commodity" by looking the id up in
ODS. The client already records the *source* contract id (e.g. `PCW227498`) rather than the row id, precisely
because the row id is an ODS surrogate on one source and a manufactured hash on the other. The server had not
caught up: it parsed the target id as a `long` and queried ODS by surrogate, which resolved nothing on CTRM. It
now falls back to showing the source contract id itself, which is readable and identical on both sources. The
ODS lookup is kept only for legacy rows recorded before the client change, whose surrogate ids are meaningless
on screen without it.

## Known gaps (waiting on the API team)

1. `contracts(customerIds:)` page cost — still the biggest item. Status from the API owner (2026-09-03, confirmed on a follow-up): two fixes are needed **together**, not either alone. A two-step page (find the page's keys, then fetch those rows) takes a cold trade-unit page from ~70 s to ~26 s, which is under the 30 s cutoff with about 4 s of margin — not enough to ship by itself. Connection warming (~2 s once warm) is the other half; both are designed and measured, neither shipped. Updated 2026-09-09: the warming half needs nobody else's permission - the connection-idle setting is gateway-side rather than an iSeries partition setting - so it is being done FIRST, as the precondition for the page-cost change rather than a parallel task. He will give notice before asking us to re-run the trade-unit page probe. Their own telemetry now agrees this is the whole remaining story: `Contract.List`'s slowest call dominates the worst end-to-end request. Until it lands, the trade-unit contract read stays on the indexed singular path (587 calls in 73-211 s for a 587-producer unit; seventeen walks measured 2026-09-02/03, median 115 s, no failures or retries in any of them — the spread is entirely the shared gateway, not our code, since the count held with zero HC0045 retries in effect for the last eleven). **Updated 2026-09-24:** those 587 calls are now carried as GraphQL aliases, 10 producers per HTTP request, 16 in flight on their own pool (`aliased` strategy) — ~59 requests and 4.7–8.3 s for the same unit on a quiet gateway, 34 s live in the app on a slower one (against 65 s one-per-call that morning), with the identical contracts: on the 1,271-producer unit a full-field comparison of 10,382 contracts × 26 fields found no difference. The server still resolves each producer separately, so this collapses round trips rather than server work; the list-query fix on the API side remains the path to a cold load under 10 s. The same afternoon also showed the APIM quota is a *volume* budget — ~1,600 requests in nine minutes drained it and the plain walk lost 299 contracts to 429s — so fewer requests per load is worth having on its own. Separately measured: the trade-unit *ticket* history read (69 pages over three years) is 33–57 s and is its own floor for cold ticket prompts. **Running it alongside the contract read is not a win with the batched walk.** It measured 62–68 s against 73–116 s sequential in the morning, when contracts were still one-per-producer; re-measured that afternoon with the batched walk, the pair finished no sooner (84 s vs 85 s, 78 s vs 104 s), the contract walk slowed from ~40 s to 65–82 s, and 2 of its 59 batches failed each round with HC0045 timeouts or dropped connections. The gateway has a fixed throughput and both reads saturate it, so contracts keep the gateway to themselves first. Faster cold ticket prompts need cheaper ticket pages on the API side (p50 ~3.8–8 s per 500-ticket page), or fewer years fetched up front.
2. ~~A contract-number-prefix or `unappliedOnly` filter on `tickets`~~ — delivered as `unappliedOnly` (2026-08-27) but not used: the trade-unit read must carry applied tickets too (delivered/unsettled prompts), and for real trade units the unfiltered walk is cheap enough in the background.
3. The over-length `customerIds` error (7 chars works, 8 fails).
4. ~~Response caching that ignores `cropYear`~~ — fixed by the API owner 2026-08-27; moot for us anyway since `cropYear` is no longer sent.
5. A `modifiedSince` argument on `tickets` and `contracts` — the API owner is building it on the change journals, which give second precision on both roots (our 5-minute cadence is served). **Do not build freshness on `tickets.details.ticketLastChangeDate`.** It is populated on every row we sampled (849 of 849) but is restamped only ~70% of the time a row changes: programs GNR515 and GNR725 update ticket status and final settled date, both fields we read, without touching it. Presence is not freshness. One open design problem on their side: contract headers and child records are journaled separately, so a header-only filter could report "nothing changed" for a contract whose price moved.
6. ~~The ticket lookup scanning instead of using the customer-code index~~ — **FIXED by the API team, live in nonprod 2026-09-07; measured here 2026-09-08.** Two separate changes were involved. First, a trim in the API's SQL made the existing indexes (GNL014$26/$21/19, all leading with the customer code) ineligible; removing it was necessary but on its own produced no measurable gain. Second, and this is the one that mattered, the query was rebuilt so cost no longer scales with how old the requested window is. That second change was originally closed as not worth doing, because it had been measured only on the current-year window — the one window where it makes no difference. Our incidental observation that a zero-ticket producer paid 0.3-0.5 s on the current-year window but 1.0-1.2 s on each prior-year window is what reopened it.

   Measured on apiqa with the app's exact per-producer read (three 366-day windows, `take: 500`, `TicketProjection`), against our own 2026-09-03 numbers on the same gateway. Isolated per window, warm, for a producer with **zero** tickets: 130-179 ms on all three windows, flat, against 0.3-0.5 s current-year and 1.0-1.2 s prior-year before. Full three-window parallel read, the shape the app issues, warm wall time: zero-ticket producer 1.1-1.2 s → **0.21-0.43 s**; 44 tickets 1.1-1.8 s → **0.29-0.45 s**; 536 tickets 1.6-2.2 s → **0.95-1.35 s**; 821 tickets 1.8-3.3 s → **1.5-2.7 s**. Heavy producers improve least because they are bound by row volume, not window age — which is the expected shape if the fix removed a per-window scan.

   The API team's own telemetry, measured across the deploy boundary rather than from either side's ad-hoc runs: `Ticket.Count` p50 786 ms to 30 ms, `Ticket.List` p50 660 ms to 45 ms, and the tail collapsing from 112 s to 4.2 s. Their pre-fix figure for the oldest window (6,557 ms) and ours (1.0-1.2 s) were never in conflict - pre-fix `Ticket.List` was p50 660 ms, p95 5,891 ms, max 112 s, so we were sampling near the median and they were quoting the tail. Same distribution, different part of it.

   **The floor this removes is the one we had reported since the first note:** a producer with no tickets used to cost seconds per window, and the app reads three windows per producer. Cold first touch still costs ~5.6 s on the first call after an idle period (connection establishment, unrelated to this fix).

   Correctness was verified independently here, not taken on trust, because this changed how the query is built: ticket totals across ten producers (0 to 821 tickets, 3,513 detail rows) are byte-for-byte identical to what we recorded 2026-09-02/03, with zero duplicated detail keys — including a ticket spanning two producer codes, the case the CTRM data owner had flagged as the likely breakage. The mandatory date range on `tickets(customerId:)` is still required; its waiver was sequenced behind this fix and is now unblocked on the API side.

7. **Customer fields and filters (requested 2026-10-05).** The customer sync reads only what the API has today (see *Customers from CTRM*). Requested and not yet available: the fields `merchandisingEmail`, `extendedPrimaryPhone`, `supplementalEmail`, `extendedAddressLine1`-`4`, `extendedCity`, `extendedStateProvince`, `extendedPostalCode`, `extendedCountry`, `nopidNo`, `paymentMethod`, `duplicateYN`; an `industryCode1` filter; a last-changed-since filter; a customer-to-trade-unit pairs query (it restores exact link parity, see deviation D-1); and confirmation that `sourceCodes: [String!]` exists as a root argument. Until they ship, those columns stay as last synced from ODS.

## Customers from CTRM (sync, 2026-10)

The nightly customer sync (`CustomerSyncBackgroundService`, 07:00 UTC plus 60 s after every app start) can now fill `dbo.Customer` and `dbo.CustomerTradeUnit` from this API instead of the ODS views. Those two tables stay the app's customer source of truth and keep their ids; only *who fills them* changes. **Nothing changes until someone sets the switch: the default everywhere is ODS.**

### The switch

`CustomerSync:Source`: empty or anything else = ODS; only the literal `ctrm` opts in. It is read on every run, so flipping needs no redeploy. **Rollback = App Service setting `CustomerSync__Source=ods`.** A dry run can pick a source for one call (`source=` on the run route) without changing the setting.

Both sources share one set of passes (customer upsert and soft-delete, trade-unit upsert and soft-delete, manual-producer refresh, bring-back). Each source is a feeder that produces rows shaped like `originations.vw_CustomerTradeUnits` (customer id, trade unit, attributes).

### How the CTRM feeder builds its rows

- **Master lookup.** For every producer the app already holds (and every code it discovers), the reader looks the customers up in bulk with the `customers(sourceCodes: [...])` list filter (`CustomerSync:CustomerLookupStrategy` = `sourceCodes`, the default), paged 500 rows at a time, `CustomerSync:CtrmConcurrency` (2) requests in flight, under the same throttle and HC0045 retry as the contract reads. The API caps the rendered filter at 7,000 URL-encoded characters (500 seven-character codes measured 7,987), so chunks are sized by encoded length: at most `CustomerSync:SourceCodesMaxFilterChars` (6000) and `CustomerSync:SourceCodesMaxPerRequest` (400) codes, about 375 typical codes per request. Measured 2026-10-07 on nonprod: 16,793 producers in 45 requests, 84–314 s. A chunk whose pages return fewer rows than the API's `totalCount` fails the whole read. The old one-code-per-alias lookup (`aliased`, `CustomerAliasCount` 20) measured ~27 s per 20 codes with timeouts and is kept only as a fallback until it is deleted (plan E7b). If the API returns more than one customer for a code, the canonical row is: active (`activeYN` = Y) first, then `mdmMasterRecord` truthy, then lowest id text (logged as `CUSTOMER_SYNC_DUPLICATE_SOURCE_CODE`, codes only). A row whose `sourceCode` is not the one asked for fails the whole read (`CUSTOMER_SYNC_FILTER_MISMATCH`). The view's scope rules are applied to the master row: active, `industryCode1` = `PR`, name not containing `DUP` or `DO NOT USE`, not starting with `*` or `$`.
- **Trade-unit links are append-only.** A customer's existing sync links are re-asserted **in their stored spelling**. New links are discovered from two unfiltered reads over a trailing window, `contracts(contractDateFrom/To)` and `tickets(blDateFrom/To)`, of `CustomerSync:DiscoveryWindowDays` days (default 7, max 3660; a window over 366 days logs a Warning). The window overlaps from night to night, so a missed night is harmless. Discovery also surfaces new producers (codes not yet in `dbo.Customer`). A link is deactivated only when its customer drops out of scope. A customer that re-enters scope gets back every sync link it held, except user-removed ones. Discovery trouble never aborts the run (`CUSTOMER_SYNC_DISCOVERY_FAILED`, a Warning), because discovery only adds.
- **Manual producers** (onboarded by hand) are refreshed from the lookup regardless of scope, and deactivated only when their code is absent from the CTRM master.
- **Field mapping.** By default 9 customer fields come from GraphQL: Name, ScoularId (`sourceCode`), Phone, Location, StateProvince, AddressLine1, PostalCode, IndustryCode1, IndustryCode2. With `CustomerSync:CtrmExtendedFields = true` (default false; turn on per environment after `ctrm-capabilities` shows the fields there) the sync also fills Email, SupplementalEmail, ExtendedPrimaryPhone, ExtendedAddressLine1–4, ExtendedCity, ExtendedStateProvince, ExtendedPostalCode, ExtendedCountry, NopIdNumber and `dbo.Customer.PaymentMethod`. With the flag off those columns keep their last values. All 14 fields were present on nonprod on 2026-10-06.
- **ACH badge.** On `ctrm` it reads `dbo.Customer.PaymentMethod` (`H` = ACH, the ODS code — confirm GraphQL uses the same before relying on it), filled only by an extended run; on `ods` it still reads `base.Customer` live.
- **Add-a-customer search stays on the ODS.** GraphQL `nameContains` works (about 4 s), but there is no `industryCode1` filter (a search for "FARM" matched 35,272 customers of every kind) and no partial producer-code search. Plan E3/E4 move it once the API team adds those.

### Ids and the one-way door

- Customers keep their existing ids, matched by `ScoularId` = GraphQL `sourceCode`.
- **New producers get ids from `dbo.CustomerIdSequence`, in the band [5e15, 6e15)** (above any ODS surrogate, below the contract/ticket synthetic ids at 7e15, below 2^53). Dry runs use negative placeholders and never reserve an id. The App Service identity needs `UPDATE` on that sequence (`db_datawriter` does not cover sequences) before the first non-dry `ctrm` run in each environment.
- **The ODS sync adopts a minted row by `ScoularId`** (active first, then lowest id) instead of inserting a second row with the ODS id. That adoption is what makes flipping back to `ods` safe.
- **This is a one-way door.** Once a minted id carries notes, contacts or saved lists in PROD, flipping back is safe *only because of* that adoption, so the band and the `ScoularId` adoption become permanent conventions. Open question Q7 (is that wanted?) must be answered in writing **before the first PROD `ctrm` run**. Decision recorded here: _pending_.
- `customers.id` is a **String** (a GUID string, matching the API team's examples) — recorded 2026-10-06 from the first Dev probe (local API on the nonprod client: `permission: granted`, `totalCount: 302596`, `projectionAccepted: true`, `sampleFound: true` for `SMITFAR`). `PickCanonical`'s ordinal `IdText` tie-break is therefore a stable order. Still to do: confirm it is stable across two probes a day apart. Never "simplify" matching to this id: the minted-id band exists because customer ids must never collide with ODS ids (D5).
- **Onboarding (add-a-customer) never makes a second row.** The search hides producers already held under another id by `ScoularId`. Assigning trade units to an ODS candidate whose `ScoularId` the app already holds **adopts** that row (add-only: it never removes the row's existing manual trade units), and the client follows the returned id for its follow-up writes.
- The per-request customer access check now reads `dbo.CustomerTradeUnit` (active rows, manual included), not the live ODS view.

### The mass-deactivation guard (both sources)

Before anything is written, the run aborts (writes nothing) if it would deactivate more than `CustomerSync:MaxDeactivationPercent` (5) % **or** `CustomerSync:MaxDeactivationCount` (500) of the active customers or of the active trade-unit links, or if the source returned no rows while the app holds active customers or links. Codes: `CUSTOMER_SYNC_GUARD_TRIPPED`, `CUSTOMER_SYNC_SOURCE_EMPTY`. Recovery: confirm the change is legitimate, then `POST /api/diagnostics/customer-sync/run?force=true`, or raise the two limits through App Service settings. An abort logs at Error twice (the service and the background service); alert on one: the background service's line (`CustomerSync startup|scheduled aborted`), which fires only for unattended runs; the service's own line also fires for manual and dry runs. A legitimate mass change on the ODS source now aborts nightly until an admin forces it.

### Failure codes on the CTRM source

The sync aborts before any write on: `CUSTOMER_SYNC_NO_PERMISSION` (`Customers.Read.All` not granted), `CUSTOMER_SYNC_SCHEMA_MISMATCH` (a field in the projection does not exist, HTTP 400), `CUSTOMER_SYNC_FILTER_MISMATCH` (the API returned a row for a different `sourceCode`, so the filter is no longer exact), `CUSTOMER_SYNC_SOURCE_UNAVAILABLE` (gateway down or slow, including HC0045 timeouts after the retries). Warnings that never abort: `CUSTOMER_SYNC_DISCOVERY_FAILED`, `CUSTOMER_SYNC_UNKNOWN_CODES`, `CUSTOMER_SYNC_DUPLICATE_SOURCE_CODE`. Logs carry codes and counts only, never names, phones or addresses.

### Diagnostics routes

All `AdminOnly`, JSON camelCase, under `api/diagnostics/customer-sync/`.

| Route | Environments | What it does |
|---|---|---|
| `POST run?dryRun=&force=&source=&discoveryFrom=` | all, including PROD | Runs the sync (trigger `manual`). `source` is honoured only with `dryRun=true` (otherwise 400). 200 returns the result (counters plus `source`, `dryRun`, `aborted`, `abortCode`, `abortReason`, `guard`, `customersMinted`, `lookup`, `discovery`); **409 with the same body when aborted** (nothing written). |
| `GET last-run` | all, including PROD | `{ processStartedUtc, nowUtc, lastSuccessfulRunUtc, stale, lastRun }`; `lastRun` is null or `{ startedUtc, finishedUtc, trigger, source, outcome (ok / aborted / failed), abortCode, abortReason, exceptionType, result }`. `stale` = no successful run finished in the last 26 h. **In memory only**, lost on restart, so `lastRun: null` after a deploy is normal. The first check in any incident. |
| `GET compare?discoveryFrom=` | Dev and QA only (404 elsewhere) | Dry-runs both sources, one after the other, and diffs them: `{ generatedAtUtc, ods, ctrm, customers, links, fields, appCustomers, appActiveCustomers, appLinks, appActiveLinks }`. Each side is `{ ok, failureCode, failureDetail, rows, customers, links, minted, customerPermission, lookup, discovery }`; `customers` and `links` are `{ inBoth, onlyInOds, onlyInCtrm, sampleOnlyInOds[], sampleOnlyInCtrm[] }` (codes, or CODE\|TU, at most 25); `fields` is `[{ field, compared, differs }]`. Producers are matched by `ScoularId` (`sourceCode`), never by id. While `Customers.Read.All` is missing the CTRM side reads `ok: false, customerPermission: "missing"` and the diffs are empty: that means "no permission", not "no customers". No names, phones or addresses. |
| `GET ctrm-probe?sourceCode=` | Dev and QA only | `{ configured, source, status, httpStatus, errorCode, detail, permission (granted / missing / unknown), totalCount, projectionAccepted, sampleFound, idKind, note }`. `idKind` is the JSON type of `customers.id` on the sample row (never the value). |
| `GET ctrm-capabilities?nameTerm=` | Dev and QA only | What the customers API offers, measured: `customersArguments`, `wantedArguments` (sourceCodes, codes, industryCode1, nameContains, sourceCodeContains), `changedSinceLikeArguments`, `wantedFields` (the 14 Stage 2 fields), and timings for a `sourceCodes` lookup at 20/100/500 real codes, an `industryCode1 = PR` page and a `nameContains` search when those exist. Names, counts and timings only; the search term is not echoed. Run it before turning on `CtrmExtendedFields` in an environment. |

**Long-running calls.** `compare` and `run?dryRun=true&source=ctrm` do the whole nightly CTRM workload inside one HTTP request (about 45 bulk customer requests at `CustomerSync:CtrmConcurrency` 2, plus two discovery walks; `compare` also reads the heavy ODS view). Expect 2–6 minutes. App Service cuts the client off at about 230 seconds while the server keeps working, so a browser timeout is not a failure: the outcome still lands in the log lines `CustomerSync compare: …` and `CustomerSync dry run — nothing persisted`, and a non-dry `run` in `last-run`. For a Dev/QA comparison window, `CustomerSync__CtrmConcurrency` can be raised as an App Service setting.

### First comparison (local API on the nonprod client, 2026-10-07)

| | ODS | GraphQL | Result |
|---|---|---|---|
| Producers | 16,762 | 16,755 | 16,755 in both, 7 only in ODS, 0 only in GraphQL |
| Producer ↔ trade-unit links | 19,083 | 19,074 | 19,073 in both, 10 only in ODS, 1 only in GraphQL |

The 7 only in ODS (`ADVA620`, `COOPST`, `LUCKYME`, `LYMADE`, `MILLECM`, `NFOMAM`, `THUMT-W`) were all found in GraphQL but fail the producer filters there (across the run: 8 "DO NOT USE", 1 "DUP", 8 not industry code PR) — the master data is likely more current than the ODS copy; spot-check before the flip. Field differences out of 16,755: Name 53, Phone 28, AddressLine1 57, Location 20, StateProvince 8, PostalCode 61, IndustryCode1 0, IndustryCode2 9. A dry run on `ctrm` the same day: 0 inserted, 7 deactivated, guard passed, 108 s. Dev ODS and nonprod GraphQL are refreshed at different times, so small differences are expected; repeat in Dev and QA once deployed.

### Before the first `ctrm` run in each environment

1. `Customers.Read.All` is granted to that environment's GraphQL client (`ctrm-probe` says `permission: "granted"`, `projectionAccepted: true`, `sampleFound: true` for a code taken from `dbo.Customer.ScoularId`; this also confirms `ScoularId` = `sourceCode`).
2. The App Service identity has `UPDATE` on `dbo.CustomerIdSequence`.
3. Padded trade units and duplicate spellings: `SELECT COUNT(*) FROM dbo.CustomerTradeUnit WHERE DATALENGTH(TradeUnit) <> DATALENGTH(LTRIM(RTRIM(TradeUnit)));` (record the count) and `SELECT CustomerId, LTRIM(RTRIM(TradeUnit)) AS Unit, COUNT(*) FROM dbo.CustomerTradeUnit GROUP BY CustomerId, LTRIM(RTRIM(TradeUnit)) HAVING COUNT(*) > 1;` (must return 0 rows).
4. A dry run, `POST …/run?dryRun=true&source=ctrm`, shows `ManualCustomersDeactivated = 0` (and `ManualCustomersRefreshed + ManualCustomersReactivated` equal to the manual-customer count). Any deactivation means a manual producer's code is absent from the CTRM master: list those codes before flipping.
5. Active sync customers with no producer code get no rows on the CTRM path and would be deactivated (guarded): `SELECT COUNT(*) FROM dbo.Customer WHERE IsActive = 1 AND IsManual = 0 AND NULLIF(LTRIM(RTRIM(ScoularId)), '') IS NULL;` — know the number before the flip.
6. Also open (Q10): whether `base.vw_CurrentCustomers` ever holds `IsActive = 0` rows decides whether a found-but-inactive manual producer should be kept on the CTRM path.
7. **Extended fields (E1/E2, added 2026-10-07).** Run `GET ctrm-capabilities` in that environment and confirm every field under `wantedFields` is `true` before setting `CustomerSync__CtrmExtendedFields=true`; an unknown field is an HTTP 400 that fails the whole read closed. Turn `CtrmExtendedFields` on **together with or before** `CustomerSync__Source=ctrm`: on `ctrm` the ACH badge reads `dbo.Customer.PaymentMethod`, which only an extended run fills, so `ctrm` with the flag off shows no ACH badge for anyone.
8. **ACH code.** The badge treats `paymentMethod = H` as ACH (the ODS code). Before relying on it on `ctrm`, confirm a few known ACH producers carry `H` in GraphQL (`ctrm-probe?sourceCode=<an ACH producer>` with the flag on, then compare their `dbo.Customer.PaymentMethod` after a Dev run).
9. **Coverage of the extended values.** With the flag on, a blank GraphQL email / phone / address / NOP id replaces the ODS-era value. Before the flip, compare non-null counts in SSMS after a Dev extended run against the same counts beforehand, e.g. `SELECT COUNT(Email), COUNT(NopIdNumber), COUNT(ExtendedAddressLine1) FROM dbo.Customer WHERE IsActive = 1;`.
10. **Migrations before code.** This branch adds `dbo.CustomerIdSequence` and `dbo.Customer.PaymentMethod`; every `dbo.Customer` read selects `PaymentMethod`, so code without the migration fails on any customer screen. The deploy workflows apply migrations first; a laptop running this branch against the shared Dev database needs Dev migrated first.

Before the first **PROD** `ctrm` run, additionally: Q7 answered in writing (above); `compare` run weekly in Dev/QA for at least four weeks with `links.onlyInCtrm` recorded each time (a growing count is the empirical answer to deviation D-1 and the trigger to ask for the pairs query); the `ScoularId` = `sourceCode` assumption confirmed; the producer count re-counted per environment; `last-run` checked in QA after at least one scheduled `ctrm` night.

### Intentional differences from the ODS view

Target = `originations.vw_CustomerTradeUnits`.

| View semantics | CTRM implementation | Deviation? |
|---|---|---|
| `c.IsActive = 1` | `activeYN == "Y"` | none |
| `c.IndustryCode1 = 'PR'` | `industryCode1 == "PR"` (trimmed, case-insensitive) | none |
| `CustomerName NOT LIKE '%DUP%'`, `NOT LIKE '%DO NOT USE%'`, `LEFT(name,1) NOT IN ('*','$')`; NULL name excluded | Same rules on `name`, ordinal ignore-case | none |
| no `IsDuplicate` filter | none | none (`duplicateYN` is Stage 2, for the search only) |
| contract branch: `con.IsActive = 1 AND TradeUnit IS NOT NULL`, all prefixes, no date/closed filter | existing links re-asserted + contract discovery in the trailing window, all prefixes, blank `tradeUnit` skipped | **D-1**: a link is never dropped when a contract's ODS `IsActive` later flips to 0 (customer-level drops still apply); and on a customer's re-entry every sync link it ever held (except user-removed ones) is restored, a superset of ODS, which restores only links still backed by an active contract or non-deleted ticket |
| ticket branch: header `t.CustomerId = c.CustomerId`, `ETL_Delete_Datetime IS NULL`, `OrganizationCode IS NOT NULL` | ticket discovery in the trailing window, every **detail** row's `customerCode` to `organizationCode` | **D-2**: split loads link every detail customer, not only the header customer (a superset, consistent with the unapplied-ticket read) |
| no cancel / consolidated / type filter on tickets | none | none |
| trade-unit value verbatim | `Trim()` on CTRM-sourced values only (codes, discovered units); a unit the table already holds is re-emitted in its stored spelling | **D-3**: trade-unit keys stay byte-identical to what the ODS sync wrote (a trimmed re-emission of a padded row would collide with `UQ_CustomerTradeUnit_CustomerId_TradeUnit`, which ignores trailing spaces) |
| manual producers outside the view: refreshed from `base.vw_CurrentCustomers` by id, no scope filter; deactivated only when absent | refreshed from the `sourceCode` lookup, no scope filter; deactivated only when the code is absent from the master | none |
| attributes: 23 columns | 9 columns; the rest untouched | **D-4** until Stage 2 |
| `EffectiveStartDate/EndDate` | no GraphQL equivalent; untouched | **D-5** (permanent unless the API adds them) |
| new customer id = ODS `CustomerId` | minted from `dbo.CustomerIdSequence` | **D-6** by decision |

Files: `api/GrainOriginatorPortal.Infrastructure/Sync/*`, `api/GrainOriginatorPortal.Infrastructure/Ctrm/CtrmCustomerReader.cs`, `CtrmCustomerActivityReader.cs`, `CtrmCustomerQueries.cs`, `api/GrainOriginatorPortal.Api/Controllers/CustomerSyncDiagnosticsController.cs`, `DiagnosticsEnvironmentGate.cs`.

## Testing notes

Dev CTRM has no ticket activity in the last 30 days for the real producer population, so Spot Loads reads empty on either source; set `Ctrm:RecentTicketDays` to 365 locally to exercise the path, then put it back. Most dev producers have zero open purchase contracts, so empty applied-ticket panes are correct. Producers with open contracts for a visual check: ROHLMKL, 3BFALLC, BERGPRJ, DRYCGO.
