# CTRM GraphQL Data Source

**Status:** Live in Dev/Development. QA and Production still read the ODS views until their `Ctrm` config block and Key Vault secret are added.

## What this is

Contracts and tickets on the producer screen — and most of the contract/ticket reads behind Build-a-List and Actionable Insights — come from CTRM directly through the **Scoular.GraphQL** API (formerly DB2Connector.GraphQL, AB#33220), not from the ODS views. The ODS was measurably drifting weeks behind CTRM (a hedge roll five weeks late, ticket tails eleven weeks late, one row mixing two points in time), and CTRM is the system of record. The switch happened in August 2026.

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

Files: `api/GrainOriginatorPortal.Infrastructure/Ctrm/` (repositories, readers, snapshot, mappings, `CtrmQueries.cs`), `api/GrainOriginatorPortal.Api/Services/Ctrm/CtrmGraphQlClient.cs` (HTTP, token, error taxonomy), `CtrmSnapshotWarmupService.cs` (startup warm-up).

## What comes from where (Ctrm:Source = ctrm)

| Read | Source | Shape |
|---|---|---|
| Producer contracts, pricing lines, Harvest Pace | CTRM live | `contracts(customerId:)` — no date range, full history, one cached read serves all three |
| Producer applied tickets | CTRM live | `tickets(contractNumbers:)` over the producer's OPEN purchase contracts |
| Producer unapplied + storage tickets | CTRM live | `tickets(customerId:)` |
| Per-contract applied tickets | CTRM live | `tickets(contractNumbers:)` (no UI caller today) |
| Crop-year contracts (Build-a-List, Dashboard) | **ODS** (live CTRM read built but disabled) | `contracts(customerIds: cropYear:)` returned the previous query's rows for a different crop year in QA on 2026-08-26 — a server-side cache keyed without `cropYear`. Re-enable via `UseLiveCropYearRead` once a probe shows 2025 and 2026 differ. |
| Spot Loads (recent unapplied, all producers) | CTRM live | `tickets(customerIds:)` over the last 30 days + 7 ahead |
| Open-activity trade-unit lock (edit dialog, nightly sync) | via the switch | reuses the producer contract + unapplied ticket reads |
| Trade-unit contract pool (Build-a-List, Insights, Unshipped Bushels) | CTRM **snapshot** | `contracts(contractDateFrom/To:)` — a configured date window, walked at startup and cached |
| "Producers with unapplied tickets" prompt | **ODS** | needs a contract-number-prefix filter CTRM does not have |
| Farm lookups, contract by source id, per-contract pricing lines | **ODS** | no UI caller; CTRM has no farm concept / no contract-number argument |

**ODS by design, on both sources.** These annotate or subtract from CTRM rows and never add one: customer master (`dbo.Customer`), the storage gate (`ctrm.vw_GNTA39D1` — CTRM has no storage entity), lb→bushel factors (`vw_GNP024`), elevator names (`MbpLocationSynonym`), producer↔trade-unit maps, DP contracts, stored grain.

## Rules preserved from ODS

Every rule the ODS queries applied is applied to CTRM rows, in the same shared code where one exists:

- Contracts: purchase prefix `P` only; a producer's list is open **or** `cropYear ≥ last year`; status from `ContractStatusCalculator`; the Db2 `0001-01-01` sentinel on `closedDate` is null; `Signed = true`.
- Tickets: types `U`/`P` only; consolidated excluded; cancelled excluded (server-side and again per row); unapplied = contract number starting `U`/`L`/`C`; applied = on one of the producer's open purchase contracts **regardless of the row's customer code** (so a split load shows under both producers); three-year lookback; storage tickets kept only while the producer still holds that commodity.
- Quantities: `AppliedNetQuantity` is pounds on both sources; bushel conversion is unchanged and downstream.

CTRM has no surrogate ids, so `Contract.Id` / `Ticket.Id` are deterministic FNV-1a hashes in a reserved band below 2^53 (`CtrmSyntheticId`). Nothing app-owned persists them; the client uses them only as dedup and expansion keys. All joins use the string codes (`ctrmCustomerId`, `customerCode`, `sourceContractId`).

## Why the shapes are what they are (measured, not assumed)

- **`customerId` (singular) is indexed** and waives the date range: a producer's full history in ~1–2s. **`customerIds` (list) is not**: every shape, including with `tradeUnit`/`cropYear`, times out at 30s cold and returns in ~1s warm. This is why the pool still uses a date window instead of "all producers, all history".
- **Ticket queries always need a date range, capped at 366 days**, because the customer lives on the detail row and the range bounds the header scan. Longer lookbacks are sliced into windows fetched in parallel. The cost is the scan, not the rows: 30 days ≈ 1 day ≈ 6s for 88 producers; three years for all producers ≈ 1,000 pages — which is why the unapplied-tickets prompt stays on ODS.
- **Pricing lines double a contract page** (~8s vs ~4s per 500 rows). Only the per-producer read projects them; the pool and crop-year reads take the core fields.
- **A customer code of 8+ characters makes `customerIds` return an internal error that fails the whole request.** `CtrmCustomerCodes` drops such codes (real ScoularIds are 5–7) and logs them. Reported to the API team.
- **The API caches list-query results, and the key omits `cropYear` and `tradeUnit`** (measured 2026-08-26: `cropYear: 2026` returned the 2024 set issued moments earlier; `tradeUnit: 9999` returned dozens of trade units; changing `take` to 499 exposed the true answer). It is INTERMITTENT: the identical `cropYear: 2026, take: 500` request returned the correct 96 rows once and the 2024 set on a rerun minutes later, so a single passing probe proves nothing - run the pair twice. The pattern (and the same query alternating between two totals earlier that day) is consistent with a per-instance cache behind a load balancer. The key DOES include `customerId`, `customerIds`, `contractNumbers`, `contractPrefixType`, the date range, `skip`/`take` and the exclude flags — verified by pairwise probes — so every read still live is safe. Do not build on `cropYear` or `tradeUnit` until the API team confirms the fix.
- **`excludeCancelled: true` drops cancelled ticket headers, not cancelled detail rows** (8 of 219 detail rows still carried `cancelFlag = Y`). The per-row `CancelFlag` check in `CtrmMappings` is therefore load-bearing, not redundant.
- **No `#` comments in any query document.** The WAF reads `#` as a SQL comment and answers with an HTML 403 the API never sees. `CtrmQueryDocumentTests` enforces this and other structural properties on every document.

## Caching

| Layer | TTL | Purpose |
|---|---|---|
| Per-producer contract/ticket read | `Ctrm:LiveCacheSeconds` (60) | Coalesces the contract list, pricing lines and pacing card into one CTRM call; the in-flight task is shared |
| Ticket window containing today | `LiveCacheSeconds` | New tickets land here |
| Ticket windows entirely in the past | `Ctrm:HistoricalTicketCacheMinutes` (30) | Older tickets rarely change and cost the most; bounds how stale an old ticket's status can be |
| Contract pool snapshot | `Ctrm:SnapshotMinutes` | Rebuilt in the background; serves the previous copy during a rebuild |
| Client hover prefetch | 60s, side map | Resting on a producer row fires the reads so the click renders from memory |

Failures are never cached at any layer.

## Failure behaviour

There is **no ODS fallback** on the CTRM path. A failed CTRM read returns an empty list and logs `INFRASTRUCTURE_CTRM_UNAVAILABLE` with a categorised status (`NotConfigured`, `TokenFailure`, `EgressBlocked`, `Unauthorized`, `Throttled`, `QueryError`, `PartialSuccess`) and operator-oriented detail. Silently serving ODS would hide the outage and invalidate any conclusion about CTRM's data. In non-production, response headers carry the provenance of each read (`CtrmProvenanceMiddleware`).

The API's own status taxonomy is handled explicitly: business validation → HTTP 200 with a `VALIDATION`-coded error; malformed query → 400; bad auth → 401; both mapped to `QueryError`/`Unauthorized` rather than surfacing as 500s. A per-attempt 30s timeout with two retries sits under a 110s overall budget.

## Configuration

Base `appsettings.json` documents every key with a `// Key` sibling. Per environment: `Source`, `GraphQlUri`, `TenantId`, `ClientId`, `Audience`, `ContractDateFrom/To` (pool window), `MaxPages` (≥ 18 for the current window), `PageConcurrency`, `SnapshotMinutes`, `LiveCacheSeconds`, `TicketLookbackDays` (1095), `HistoricalTicketCacheMinutes`, `RecentTicketDays` (30; Spot Loads).

To enable an environment: copy Dev's `Ctrm` block, add `Ctrm--ClientSecret` to that environment's Key Vault, confirm APIM egress (no custom NSG rule needed), restart.

## Known gaps (waiting on the API team)

1. `customerIds` cold performance — closes the pool's date window.
2. A contract-number-prefix or `unappliedOnly` filter on `tickets` — moves the last prompt off ODS.
3. The over-length `customerIds` error (7 chars works, 8 fails).
4. Response caching that ignores `cropYear` (and possibly `tradeUnit`) — the reason the crop-year read is on ODS.

## Testing notes

Dev CTRM has no ticket activity in the last 30 days for the real producer population, so Spot Loads reads empty on either source; set `Ctrm:RecentTicketDays` to 365 locally to exercise the path, then put it back. Most dev producers have zero open purchase contracts, so empty applied-ticket panes are correct. Producers with open contracts for a visual check: ROHLMKL, 3BFALLC, BERGPRJ, DRYCGO.
