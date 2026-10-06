# Customers from GraphQL — implementation plan (2026-10-06)

Slug `customers-from-graphql` · worktree `C:\Users\CEgr\Projects\Origination-customers` · branch `feature_CustomersFromGraphQL` (forked from main `d5f16f04`) · Angular 21 + .NET 10.

Path shorthand: `INF` = `api/GrainOriginatorPortal.Infrastructure`, `API` = `api/GrainOriginatorPortal.Api`, `TEST` = `api/GrainOriginatorPortal.Api.Tests/GrainOriginatorPortal.Api.Tests`.

Recon dossier (facts cited below as "dossier §n"): `agents-docs/plans/customers-from-graphql-dossier_2026-10-06.md` in this repo (copied there 2026-10-06 after the Mentor review — the original lived in a session cache that will not survive; every load-bearing fact is also inlined where it is used below).

Revision history: v1 2026-10-06 (planner); v2 2026-10-06 after the Mentor review — see `## Mentor review (2026-10-06)` at the end for exactly what changed. Every v2 change in the body carries a `(v2: …)` rationale note.

---

## 1. Design (the settled answers)

**Goal restated.** `dbo.Customer` / `dbo.CustomerTradeUnit` stay the app's customer source of truth and keep their ids. What changes is *who fills them*: a nightly sync that reads either the ODS views (today) or the Scoular GraphQL gateway, chosen per run by `CustomerSync:Source` (`ctrm` opts in, anything else = `ods`). The per-request access check stops reading the ODS live. Every ODS→CTRM deviation is listed in §2.

**D1 — Source abstraction, shared passes.** `CustomerSyncService` keeps its five passes (customer upsert, customer soft-delete, TU upsert, TU soft-delete, manual-producer refresh, bring-back) but consumes an `ICustomerSyncSource` that returns `(CustomerId, TradeUnit, Attributes)` rows — exactly the shape of `originations.vw_CustomerTradeUnits`. `OdsCustomerSyncSource` wraps today's two ODS reads unchanged; `CtrmCustomerSyncSource` builds the same rows from GraphQL. One rule set, two feeders; the diff report compares the two feeders' rows directly.

**D2 — Trade-unit derivation: append-only links + incremental discovery (not a nightly full re-derivation).** The ODS view's link rule is `any active contract with a TradeUnit` UNION `any non-deleted ticket with an OrganizationCode`, over *all time*, with no closed-date, prefix, cancel or consolidated filter. Verbatim from `API/Scripts/AddIndustryCode2AndNopIdToCustomerTradeUnitsView.sql` (dossier §6): contract branch `FROM base.Customer c INNER JOIN base.Contract con ON con.CtrmCustomerId = c.SourceCustomerId WHERE c.IsActive = 1 AND c.IndustryCode1 = 'PR' AND c.CustomerName NOT LIKE '%DUP%' AND c.CustomerName NOT LIKE '%DO NOT USE%' AND LEFT(c.CustomerName, 1) NOT IN ('*', '$') AND con.IsActive = 1 AND con.TradeUnit IS NOT NULL`; ticket branch `INNER JOIN base.Ticket t ON t.CustomerId = c.CustomerId WHERE <same five customer filters> AND t.ETL_Delete_Datetime IS NULL AND t.OrganizationCode IS NOT NULL`, projecting `t.OrganizationCode AS TradeUnit`. Contracts and tickets are never removed from CTRM in the normal course of business, so under the ODS rule a (customer, TU) pair, once earned, is effectively **permanent**; what removes a customer from the view is the *customer-level* filters (inactive, not `PR`, name exclusions). Therefore:
- `dbo.CustomerTradeUnit` as of the switch **is** the backfill — it was filled from the view nightly until the switch.
- Each `ctrm` run re-asserts a customer's existing sync-sourced links (`!IsManual && IsActive`, plus `UserDeactivated` rows as customer-presence evidence only) and adds links **discovered** in a trailing date window by two *unfiltered* reads: `contracts(contractDateFrom/To)` → `customerId, tradeUnit` and `tickets(blDateFrom/To)` → `details { customerCode organizationCode }`. Window = `CustomerSync:DiscoveryWindowDays` (default 7, overlapping so a missed night is harmless), sliced at 366 days, page-capped. Discovery also surfaces **new producers** (codes not in `dbo.Customer`), which breaks the circularity without the not-yet-delivered pairs query.
- Link **deactivation** on `ctrm` follows only customer-level deactivation (the customer drops out → all its rows drop out, exactly as on ODS). This is the one place parity is approximate (a contract whose ODS `IsActive` flips to 0 would have dropped its link on ODS; on CTRM it stays) — recorded in §2 and the first question for the user. The pairs query (Stage 2, E6) restores exact parity when it lands. (v2: the one-shot acceptance check cannot detect D-1 — on day one the CTRM side re-asserts exactly the links ODS produced, so `compare` shows zero link drift by construction; the empirical answer is weekly `compare` runs in Dev/QA watching `Links.OnlyInCtrm` grow — see §10.)
- Why not a nightly full re-derivation over all producers: ~16.7k producers (planning-session figure for Dev `dbo.Customer`; re-count with `SELECT COUNT(*) FROM dbo.Customer` per environment before sizing) × full contract history + 3 years of tickets is 1,000+ pages a night for a result that, by the rule above, cannot change except by discovery. Why not defer discovery to the API team's pairs query: that leaves new producers invisible until it ships; the two window reads are cheap (one page per ~500 rows) and already-proven root fields.

**D3 — Customer master lookup by `sourceCode`, aliased.** `customers(sourceCode:)` is confirmed; `sourceCodes:` is "probably exists" and is NOT used (Stage 2 E7 adopts it after a Dev probe). The reader issues `c{i}: customers(skip: 0, take: 5, sourceCode: "X")` aliases, `CustomerSync:CustomerAliasCount` (default 20) per request, under `CtrmTradeUnitThrottle.RunAsync` + the HC0045 retry, `CustomerSync:CtrmConcurrency` (default 2) requests in flight. ~16.7k codes → ~840 requests nightly. The projection names ONLY today's fields. The Customer fields confirmed by the API team on 2026-10-05 (dossier §5, inlined here because the projection tripwire test in A2 is pinned to them): `id, code, name, sourceCode, sourceSystem, activeYN ('Y'/'N'), merchandisingName, merchandisingAddressLine1, merchandisingAddressLine2, merchandisingCity, merchandisingStateProvince, merchandisingPostalCode, merchandisingCountry, merchandisingPhone, industryCode1, industryCode2, industryCode3, mdmMatchStatus, mdmMasterRecord, workflowStatus, lastChangedUtc, intercompany, contracts (child)`; root arguments `skip, take (≤500), sourceCode, sourceSystem, code, codes:[String!], nameContains`, `sourceCodes:[String!]` unverified; requested but not yet available: `merchandisingEmail, extendedPrimaryPhone, supplementalEmail, extendedAddressLine1-4, extendedCity, extendedStateProvince, extendedPostalCode, extendedCountry, nopidNo, paymentMethod, duplicateYN`, filter `industryCode1`, a last-changed-since filter, and a customer↔tradeUnit pairs query. The projection deliberately omits `mdmMatchStatus`, `workflowStatus`, `intercompany` and `contracts` (not needed). A wrong name is HTTP 400 for the whole query → the reader fails closed with `CUSTOMER_SYNC_SCHEMA_MISMATCH` naming the projection constant; nothing is written.

**D4 — Permission fails closed and is reported as such.** `Customers.Read.All` is not granted. `CtrmReadStatus.Unauthorized`, or `QueryError` with an `AUTH_*` code, → lookup `Permission = "missing"`, sync result `Aborted = true, AbortCode = CUSTOMER_SYNC_NO_PERMISSION`, diff report `Ctrm.CustomerPermission = "missing"` (never "0 customers"). The link-discovery half of the diff still runs (contracts/tickets are granted), so the report is useful before the grant lands.

**D5 — Id minting: a SQL SEQUENCE in a reserved band, start chosen at migration time.** New customers (codes found only in CTRM) get ids from `dbo.CustomerIdSequence`. The migration computes the start from the live table: `@start = CASE WHEN MAX(CustomerId) >= 5e15 THEN MAX(CustomerId)+1 ELSE 5e15 END`, and THROWs if the table already holds ids ≥ 6e15. Band `[5e15, 6e15)`: (a) above any plausible ODS surrogate in every environment including PROD, whose max is unknown; (b) below `CtrmSyntheticId.ReservedBase` (7e15) so no overlap with contract/ticket synthetic ids; (c) below 2^53 (JS `number`); (d) recognisable (`CustomerIdMinting.IsMinted`). `Customer.Id` is `ValueGeneratedNever` (`INF/Data/ApplicationDbContext.cs:463-464`), so an id source for CTRM-only producers is genuinely required. Reversibility: the ODS source learns to **adopt** a minted row by `ScoularId` instead of inserting a second row with the ODS id, so flipping back to `ods` cannot orphan notes hung off a minted id. Ids are reserved in one round trip (`sp_sequence_get_range`). (v2: this is a one-way door disguised as reversible — once a minted id carries notes in PROD, flipping back to `ods` is safe *only because of* C3 and the onboarding adoption in A9, and the band `[5e15, 6e15)` plus `ScoularId` adoption become permanent conventions. §11 question 7 must therefore be answered **before the first PROD `ctrm` run**, and the first Dev probe after the permission lands records what `customers.id` is (type, stability) so nobody later "simplifies" to it without knowing the ODS-collision reason the band exists — see §10.)

**D6 — Duplicates.** GraphQL may return >1 customer per `sourceCode`: `PickCanonical` prefers `activeYN == 'Y'`, then `mdmMasterRecord` truthy, then lowest `id` text; counted and logged (`CUSTOMER_SYNC_DUPLICATE_SOURCE_CODE`, codes only). `dbo.Customer` may hold >1 row per `ScoularId` (non-unique index): rows are generated **per dbo row**, each re-asserting its own links, so both survive exactly as they did on ODS (which keyed by id).

**D7 — Mass-deactivation guard, both sources.** Before `SaveChanges`, `CustomerSyncGuard.Evaluate` trips when the source returned zero rows while the app has active rows, or when customers-to-deactivate or links-to-deactivate exceed `CustomerSync:MaxDeactivationCount` (default 500) **or** `CustomerSync:MaxDeactivationPercent` (default 5) of the active count. Tripped → `Aborted = true`, `AbortCode = CUSTOMER_SYNC_GUARD_TRIPPED`, logged at Error with the code, no writes. `POST …/run?force=true` bypasses it (admin, for a legitimate mass change). Any `ctrm` lookup failure aborts *before* the passes. Discovery failure never aborts (it is additive-only); it is reported. Note the behaviour change on the existing ODS sync: a legitimate mass change now aborts nightly until an admin runs `?force=true` — the playbook (D4) covers it and D14 makes it visible.

**D8 — Dry run and source override.** `SyncAsync(CustomerSyncOptions)` with `DryRun` computes everything and skips `SaveChanges`; `SourceOverride` is honoured only with `DryRun` so Dev can exercise `ctrm` while the environment setting is still `ods`.

**D9 — Access check.** `EntitlementsRepository.GetCustomerTradeUnitCodesAsync` reads `dbo.CustomerTradeUnit WHERE CustomerId = @id AND IsActive = 1` (manual rows included — the app treats them as memberships everywhere else; `UserDeactivated` rows are `IsActive = 0` already). Still uncached, still not called on any request path (`ValidateCustomerAccessAsync` is "deliberately never wired", `API/Services/ProducerDetailsService.cs:97`; AR-02 unchanged).

**D10 — Stage 1 field mapping from GraphQL.** `name → Name`, `sourceCode → ScoularId`, `merchandisingPhone → Phone`, `merchandisingAddressLine1 → AddressLine1`, `merchandisingCity → Location`, `merchandisingStateProvince → StateProvince`, `merchandisingPostalCode → PostalCode`, `industryCode1`, `industryCode2`. Untouched (keep last ODS value): `Email, SupplementalEmail, ExtendedPrimaryPhone, ExtendedAddressLine1..4, ExtendedCity, ExtendedPostalCode, ExtendedStateProvince, ExtendedCountry, NopIdNumber, EffectiveStartDate, EffectiveEndDate`. Pinned by a contract test.

**D11 — Diagnostics live in a new `CustomerSyncDiagnosticsController`** (`api/diagnostics/customer-sync/*`, `AdminOnly`), taking over `POST run` from the 1105-line `DiagnosticsController`; `compare` and `ctrm-probe` are Dev/QA only (same gate as `DenyIfProduction`); `run` and `last-run` (D14) have no environment gate. No PII: counts, codes (≤25 samples), field names with difference counts. (v2: there is exactly ONE definition of "production-like" — the new `DiagnosticsEnvironmentGate.IsProductionLike`; D1 makes the old controller's private `DenyIfProduction()` delegate to it instead of keeping a second copy that would drift. `DenyIfNotDevelopment()` is a different, stricter gate and stays as it is.)

**D12 — No migration besides the sequence in Stage 1.** No new tables; no *persisted* last-run record (that remains the playbook gap; E8 would introduce the table). No What's New entry for Stage 1 (nothing user-visible). Env files keep `Source` empty; the user flips Dev when the permission lands. (v2: an *in-memory* last-run record now exists — D14.)

**D13 — Onboarding never creates a second row for a producer the sync already holds (added v2, Mentor change 1).** Today `CustomerRepository.SearchOdsAsync` drops candidates already in `dbo.Customer` **by ODS id only** (`INF/Repositories/CustomerRepository.cs:231-240`) and `AssignTradeUnitsAsync` inserts a new row from `base.vw_CurrentCustomers` when that id is absent (`:602-622`). With `Source=ctrm`, a producer the sync minted at 5e15+N (ScoularId X) still appears in the ODS onboarding search under its ODS id and can be onboarded as a second row — notes, contacts and saved lists then split across two ids, which the goal forbids. C3 protects only the ODS *sync* path; E3 fixes the search key but is `blocked-on-api`. Stage 1 therefore adds, independent of the API: (A8) the onboarding search also excludes candidates whose `ScoularId` already exists in `dbo.Customer`; (A9) `AssignTradeUnitsAsync` **adopts** an existing row by `ScoularId` (minted or not; prefer active, then lowest id — the same tie-break C3 uses) before inserting, and reports the id it wrote to through a new `AssignTradeUnitsOutcome` record so the controller returns the adopted customer; (A10) the client uses the returned customer's id for its follow-up writes (producer details, links, planting-intention moves) and re-selects the returned record. The client half is required, not optional: `home.component.ts:1942-1952` writes details and moves intentions under the *requested* id after the PUT returns, so server-side adoption alone would move the split from `dbo.Customer` to the details tables. Key assumption (shared with C3 and the D2 comparer): ODS `base.vw_CurrentCustomers.ScoularId` ≡ `vw_CustomerTradeUnits.SourceCustomerId` (mapped to `Customer.ScoularId` in `OriginationDbContext.cs:65`) ≡ GraphQL `sourceCode` — §11 question 8 confirms it on the first Dev probe.

**D14 — A tripped guard is observable from the app, in memory (added v2, Mentor change 2).** As planned in v1, a tripped guard produced one `LogError` and a KQL query in the playbook; with no alert rule and no last-run record the practical PROD outcome was a silently stale customer list for days. Cheapest fix without a table or an alert rule: `CustomerSyncService` is already a singleton (`API/Program.cs:147`), so it keeps `LastRun` (the last **non-dry** run: ok / aborted / failed-with-exception, with trigger `startup|scheduled|manual`, source, abort code, counters) and `LastSuccessfulRunUtc`; `GET api/diagnostics/customer-sync/last-run` (AdminOnly, **no environment gate**, same as `run`) returns them plus `ProcessStartedUtc` (so "null" after a restart is explainable) and `Stale` (no successful run in the last 26 h). Recording lives in the service rather than the background service so manual `run` calls count too. The App Insights alert alternative is not taken (orchestrator decision); the playbook's first check becomes this route.

**D15 — Stage 2 strategy knobs are replacements, not permanent toggles (added v2, Mentor change 3).** The eight Stage 1 keys plus `CtrmExtendedFields` (E1), `LinkStrategy` (E6) and `CustomerLookupStrategy` (E7) would give one sync eleven knobs and three behavioural axes × two sources. `CtrmExtendedFields` is justified (field names cannot be probed — introspection is HC0046). For E6 and E7 the sunset is written into the plan now: the old strategy survives **one release** after the new one is verified in PROD, then the old code path **and its knob** are deleted in the same PR, and the knob's `"// …"` prose in `appsettings.json` must say so from the day it is added.

## 2. Parity target and intentional deviations

Target = `originations.vw_CustomerTradeUnits` as in `API/Scripts/AddIndustryCode2AndNopIdToCustomerTradeUnitsView.sql` (verbatim filters inlined in D2; full text in dossier §6).

| View semantics | CTRM implementation | Deviation? |
|---|---|---|
| `c.IsActive = 1` | `activeYN == "Y"` | none |
| `c.IndustryCode1 = 'PR'` | `industryCode1 == "PR"` (trimmed, case-insensitive) | none |
| `CustomerName NOT LIKE '%DUP%'`, `NOT LIKE '%DO NOT USE%'`, `LEFT(name,1) NOT IN ('*','$')`; NULL name excluded | `CtrmCustomerFilters.IsInScope` on `name`, OrdinalIgnoreCase | none (SQL CI collation ≈ OrdinalIgnoreCase) |
| no `IsDuplicate` filter | none | none (`duplicateYN` is Stage 2, for the search only) |
| contract branch: `con.IsActive = 1 AND TradeUnit IS NOT NULL`, all prefixes, no date/closed filter | existing links re-asserted + `contracts(contractDateFrom/To)` discovery, all prefixes, blank `tradeUnit` skipped | **D-1**: a link is never dropped when a contract's ODS `IsActive` later flips to 0 (customer-level drops still apply); and on a customer's re-entry every sync link it ever held (except user-removed ones) is restored — a superset of ODS, which restores only links still backed by an active contract / non-deleted ticket (decided 2026-10-06, hand-off 3) |
| ticket branch: header `t.CustomerId = c.CustomerId`, `ETL_Delete_Datetime IS NULL`, `OrganizationCode IS NOT NULL` | `tickets(blDateFrom/To)` discovery, every **detail** row's `customerCode → organizationCode` | **D-2**: split loads link every detail customer, not only the header customer (a superset, consistent with `ToUnappliedForProducers`) |
| no cancel / consolidated / type filter on tickets | none (no `excludeCancelled`/`excludeConsolidated` on the discovery document) | none |
| trade-unit value verbatim | `Trim()` on CTRM-sourced values (codes, discovered units) only; a unit the table already holds is re-emitted in its stored spelling | **D-3**: trade-unit keys stay byte-identical to what the ODS sync wrote (decided 2026-10-06, hand-off 3 — a trimmed re-emission of a padded row would collide with `UQ_CustomerTradeUnit_CustomerId_TradeUnit`, which ignores trailing spaces) |
| manual producers outside the view: refreshed from `base.vw_CurrentCustomers` by id, no scope filter; deactivated only when absent | refreshed from the `sourceCode` lookup, no scope filter; deactivated only when the code is absent from the master | none (decided 2026-10-06, hand-off 3) |
| attributes: 23 columns | 9 columns (D10); rest untouched | **D-4** until Stage 2 E1 |
| `EffectiveStartDate/EndDate` | no GraphQL equivalent; untouched | **D-5** (permanent unless the API adds them) |
| new customer id = ODS `CustomerId` | minted from `dbo.CustomerIdSequence` | **D-6** by decision |

## 3. Frozen interface contracts (shared by every task)

### 3.1 Configuration keys (all under `CustomerSync`, read per run through `CtrmConfig.ReadInt/ReadBool` or the indexer; base `appsettings.json` only, env files untouched)

| Key | Default | Clamp | Used by |
|---|---|---|---|
| `CustomerSync:Source` | `""` (= ods) | literal `ctrm` opts in | `CustomerSyncSources.Resolve` |
| `CustomerSync:MaxDeactivationPercent` | 5 | 0–100 | `CustomerSyncGuardLimits` |
| `CustomerSync:MaxDeactivationCount` | 500 | ≥0 | `CustomerSyncGuardLimits` |
| `CustomerSync:DiscoveryWindowDays` | 7 | 1–3660 | `CtrmCustomerSyncSource` |
| `CustomerSync:DiscoveryMaxPagesPerWindow` | 200 | ≥1 | `CtrmCustomerActivityReader` |
| `CustomerSync:CustomerAliasCount` | 20 | 1–50 | `CtrmCustomerReader` |
| `CustomerSync:CtrmConcurrency` | 2 | 1–8 | both readers |
| `CustomerSync:CtrmSourceSystem` | `""` (no filter) | — | `CtrmCustomerQueries.CustomersBySourceCodesAliased` |

### 3.2 Error / log codes
`CUSTOMER_SYNC_SOURCE_UNAVAILABLE`, `CUSTOMER_SYNC_NO_PERMISSION`, `CUSTOMER_SYNC_SCHEMA_MISMATCH`, `CUSTOMER_SYNC_SOURCE_EMPTY`, `CUSTOMER_SYNC_GUARD_TRIPPED` (Error); `CUSTOMER_SYNC_DISCOVERY_FAILED`, `CUSTOMER_SYNC_DUPLICATE_SOURCE_CODE`, `CUSTOMER_SYNC_UNKNOWN_CODES` (Warning). Log shape `[{ErrorCode}] [{ErrorCategory}]` with category `Integration`. Never log names, phones, addresses; codes and counts only.

### 3.3 Types — namespace `GrainOriginatorPortal.Infrastructure.Sync` (new folder `INF/Sync/`)

```csharp
public static class CustomerSyncSources
{
    public const string Ods = "ods";
    public const string Ctrm = "ctrm";
    public const string ConfigKey = "CustomerSync:Source";
    public static string Resolve(IConfiguration configuration) =>
        string.Equals(configuration[ConfigKey]?.Trim(), Ctrm, StringComparison.OrdinalIgnoreCase) ? Ctrm : Ods;
}

public abstract class CustomerSyncAttributes
{
    public abstract void ApplyTo(Customer target);
    public Customer CreateNew(long id) { var c = new Customer { Id = id, IsActive = true, IsManual = false }; ApplyTo(c); return c; }
}
public sealed class OdsCustomerSyncAttributes : CustomerSyncAttributes   // ctor(ICustomerOdsAttributes source); ApplyTo = today's CustomerSyncService.ApplyAttributes body, verbatim
public sealed class CtrmCustomerSyncAttributes : CustomerSyncAttributes  // ctor(CtrmCustomerDto source); ApplyTo = D10 only
{
    public static readonly string[] UntouchedColumns = ["Email","SupplementalEmail","ExtendedPrimaryPhone","ExtendedAddressLine1","ExtendedAddressLine2","ExtendedAddressLine3","ExtendedAddressLine4","ExtendedCity","ExtendedPostalCode","ExtendedStateProvince","ExtendedCountry","NopIdNumber","EffectiveStartDate","EffectiveEndDate"];
}

public sealed class CustomerSyncSourceRow
{
    public required long CustomerId { get; init; }
    public required string? TradeUnit { get; init; }          // trimmed; null = customer-presence-only row
    public required CustomerSyncAttributes Attributes { get; init; }
}

public interface ICustomerSyncSource
{
    string Name { get; }
    Task<CustomerSyncSourceResult> LoadAsync(CustomerSyncAppState appState, CustomerSyncLoadOptions options, CancellationToken cancellationToken);
}
public interface ICustomerSyncSourceFactory { ICustomerSyncSource Create(string sourceName); }   // "ctrm" → CtrmCustomerSyncSource, else OdsCustomerSyncSource

public sealed class CustomerSyncAppState
{
    public required IReadOnlyList<Customer> Customers { get; init; }
    public required IReadOnlyList<CustomerTradeUnit> TradeUnits { get; init; }
}
public sealed class CustomerSyncLoadOptions
{
    public bool DryRun { get; init; }
    public DateTime? DiscoveryFrom { get; init; }
    public static readonly CustomerSyncLoadOptions Default = new();
}
public sealed class CustomerSyncSourceResult
{
    public required string Source { get; init; }
    public bool Ok { get; init; } = true;
    public string? FailureCode { get; init; }
    public string? FailureDetail { get; init; }
    public List<CustomerSyncSourceRow> Rows { get; init; } = [];
    public Dictionary<long, CustomerSyncAttributes> ManualMaster { get; init; } = new();   // IsManual customers outside Rows that the master still knows
    public bool ManualMasterComplete { get; init; } = true;                                // false ⇒ never deactivate a manual customer this run
    public HashSet<long> ManualUnverifiable { get; init; } = [];                           // manual customers the source cannot look up (never refreshed, never deactivated)
    public int CustomersMinted { get; init; }
    public CustomerSyncLookupInfo? Lookup { get; init; }
    public CustomerSyncDiscoveryInfo? Discovery { get; init; }
    public static CustomerSyncSourceResult Failed(string source, string code, string detail) =>
        new() { Source = source, Ok = false, FailureCode = code, FailureDetail = detail };
}
public sealed class CustomerSyncLookupInfo
{
    public string Status { get; init; } = "";          // CtrmReadStatus.ToString()
    public string Permission { get; init; } = "unknown"; // granted | missing | unknown
    public int? HttpStatus { get; init; } public string? ErrorCode { get; init; } public string? Detail { get; init; }
    public int Requested { get; init; } public int Found { get; init; } public int Missing { get; init; } public int Duplicates { get; init; } public int Requests { get; init; }
}
public sealed class CustomerSyncDiscoveryInfo
{
    public DateTime From { get; init; } public DateTime To { get; init; }
    public string ContractsStatus { get; init; } = ""; public string TicketsStatus { get; init; } = "";
    public int ContractRows { get; init; } public int ContractPages { get; init; } public bool ContractsTruncated { get; init; }
    public int TicketRows { get; init; } public int TicketPages { get; init; } public bool TicketsTruncated { get; init; }
    public int ContractLinks { get; init; } public int TicketLinks { get; init; } public int NewCodes { get; init; } public int UnknownCodes { get; init; }
}

public sealed record CustomerSyncGuardLimits(int MaxDeactivationPercent, int MaxDeactivationCount)
{
    public const string PercentKey = "CustomerSync:MaxDeactivationPercent";
    public const string CountKey = "CustomerSync:MaxDeactivationCount";
    public static CustomerSyncGuardLimits FromConfiguration(IConfiguration c) =>
        new(Math.Clamp(CtrmConfig.ReadInt(c, PercentKey, 5), 0, 100), Math.Max(0, CtrmConfig.ReadInt(c, CountKey, 500)));
}
public sealed record CustomerSyncGuardVerdict(bool Tripped, string? Reason, int SourceRows, int ActiveCustomersBefore, int CustomersToDeactivate, int ActiveLinksBefore, int LinksToDeactivate);
public static class CustomerSyncGuard
{
    public static CustomerSyncGuardVerdict Evaluate(int sourceRows, int activeCustomersBefore, int customersToDeactivate, int activeLinksBefore, int linksToDeactivate, CustomerSyncGuardLimits limits);
}

public static class CustomerIdMinting
{
    public const long ReservedBase = 5_000_000_000_000_000;
    public const long Span = 1_000_000_000_000_000;
    public const string SequenceSchema = "dbo";
    public const string SequenceName = "CustomerIdSequence";
    public static bool IsMinted(long id) => id >= ReservedBase && id < ReservedBase + Span;
}

public static class CtrmCustomerFilters
{
    public const string ProducerIndustryCode = "PR";
    public static bool IsInScope(CtrmCustomerDto dto, out string reason);  // reason ∈ "ok","no-source-code","inactive","not-producer","no-name","name-dup","name-do-not-use","name-placeholder"
}
```

### 3.4 Types — namespace `GrainOriginatorPortal.Infrastructure.Ctrm` (readers, queries, DTOs)

```csharp
// INF/Ctrm/Dtos/CtrmCustomerDtos.cs
public sealed class CtrmCustomerDto
{
    public JsonElement Id { get; set; }                 // type unknown (number or string) — never assumed
    public string? Code { get; set; } public string? Name { get; set; } public string? SourceCode { get; set; } public string? SourceSystem { get; set; }
    public string? ActiveYN { get; set; } public string? MerchandisingName { get; set; }
    public string? MerchandisingAddressLine1 { get; set; } public string? MerchandisingAddressLine2 { get; set; } public string? MerchandisingCity { get; set; }
    public string? MerchandisingStateProvince { get; set; } public string? MerchandisingPostalCode { get; set; } public string? MerchandisingCountry { get; set; } public string? MerchandisingPhone { get; set; }
    public string? IndustryCode1 { get; set; } public string? IndustryCode2 { get; set; } public string? IndustryCode3 { get; set; }
    public JsonElement MdmMasterRecord { get; set; }    // bool or "Y"/"N" — read through CtrmYesNo.IsYes
    public string? LastChangedUtc { get; set; }         // kept as text on purpose (format unverified)
    public string IdText => Id.ValueKind switch { JsonValueKind.String => Id.GetString() ?? "", JsonValueKind.Number => Id.GetRawText(), _ => "" };
}
public static class CtrmYesNo { public static bool IsYes(JsonElement e) => e.ValueKind == JsonValueKind.True || (e.ValueKind == JsonValueKind.String && e.GetString() is { } s && (s.Trim().Equals("Y", OrdinalIgnoreCase) || s.Trim().Equals("YES", OrdinalIgnoreCase) || s.Trim() == "1")) || (e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var n) && n == 1); }
public sealed class CtrmContractLinkDto { public string? CustomerId { get; set; } public string? TradeUnit { get; set; } }
public sealed class CtrmContractLinksResponse { public CtrmPage<CtrmContractLinkDto>? Contracts { get; set; } }
public sealed class CtrmTicketLinkDetailDto { public string? CustomerCode { get; set; } public string? OrganizationCode { get; set; } }
public sealed class CtrmTicketLinkDto { public List<CtrmTicketLinkDetailDto> Details { get; set; } = []; }
public sealed class CtrmTicketLinksResponse { public CtrmPage<CtrmTicketLinkDto>? Tickets { get; set; } }

// INF/Ctrm/CtrmCustomerQueries.cs  (NO '#' anywhere in any document)
public static class CtrmCustomerQueries
{
    public const string CustomerProjection = "id code name sourceCode sourceSystem activeYN merchandisingName merchandisingAddressLine1 merchandisingAddressLine2 merchandisingCity merchandisingStateProvince merchandisingPostalCode merchandisingCountry merchandisingPhone industryCode1 industryCode2 industryCode3 mdmMasterRecord lastChangedUtc";
    public const int TakePerCode = 5;
    public const string CustomersProbe = "query { customers(skip: 0, take: 1) { totalCount items { sourceCode activeYN } } }";
    public static string CustomersBySourceCodesAliased(IReadOnlyList<string> codes, string? sourceSystem);
    //   → "query {\n  c0: customers(skip: 0, take: 5, sourceCode: \"X\"[, sourceSystem: \"S\"]) { totalCount items { <CustomerProjection> } }\n  c1: …}" ; codes JSON-serialised, never interpolated raw
    public const string ContractLinksInWindow = """
        query ($from: Date!, $to: Date!, $skip: Int, $take: Int) {
          contracts(skip: $skip, take: $take, contractDateFrom: $from, contractDateTo: $to) {
            totalCount
            pageInfo { hasNextPage }
            items { customerId tradeUnit }
          }
        }
        """;
    public const string TicketLinksInWindow = """
        query ($from: Date!, $to: Date!, $skip: Int, $take: Int) {
          tickets(skip: $skip, take: $take, blDateFrom: $from, blDateTo: $to) {
            totalCount
            pageInfo { hasNextPage }
            items { details { customerCode organizationCode } }
          }
        }
        """;
}

// INF/Ctrm/CtrmCustomerReader.cs — singleton
public sealed class CtrmCustomerReader
{
    public const string AliasCountKey = "CustomerSync:CustomerAliasCount";
    public const string ConcurrencyKey = "CustomerSync:CtrmConcurrency";
    public const string SourceSystemKey = "CustomerSync:CtrmSourceSystem";
    public CtrmCustomerReader(ICtrmGraphQlClient client, IConfiguration configuration, ILogger<CtrmCustomerReader> logger);
    public Task<CtrmReadResult<CtrmCustomerLookup>> GetBySourceCodesAsync(IReadOnlyCollection<string> sourceCodes, CancellationToken cancellationToken);
    public Task<CtrmReadResult<CtrmCustomerProbe>> ProbeAsync(string? sampleSourceCode, CancellationToken cancellationToken);
    public static CtrmCustomerDto? PickCanonical(IReadOnlyList<CtrmCustomerDto> candidates);
    public static string DescribePermission<T>(CtrmReadResult<T> result);   // "granted" | "missing" | "unknown"
}
public sealed class CtrmCustomerLookup
{
    public Dictionary<string, CtrmCustomerDto> ByCode { get; } = new(StringComparer.OrdinalIgnoreCase);
    public int Requested { get; set; } public int Found { get; set; } public int Missing { get; set; } public int Duplicates { get; set; } public int Requests { get; set; }
}
public sealed class CtrmCustomerProbe
{
    public string Permission { get; set; } = "unknown"; public int? TotalCount { get; set; } public bool ProjectionAccepted { get; set; } public bool SampleFound { get; set; }
    public string? IdKind { get; set; }   // v2: JsonValueKind of the sample row's `id` ("Number" | "String" | null when no sample) — the first Dev probe records what customers.id IS, per D5 / §10; never the value itself
}

// INF/Ctrm/CtrmCustomerActivityReader.cs — singleton
public readonly record struct CtrmCustomerLink(string Code, string TradeUnit);   // Code upper-invariant trimmed, TradeUnit trimmed
public sealed class CtrmLinkDiscovery
{
    public HashSet<CtrmCustomerLink> ContractLinks { get; } = []; public HashSet<CtrmCustomerLink> TicketLinks { get; } = [];
    public CtrmReadStatus ContractsStatus { get; set; } public CtrmReadStatus TicketsStatus { get; set; }
    public int ContractRows { get; set; } public int ContractPages { get; set; } public bool ContractsTruncated { get; set; }
    public int TicketRows { get; set; } public int TicketPages { get; set; } public bool TicketsTruncated { get; set; }
    public IEnumerable<CtrmCustomerLink> All => ContractLinks.Concat(TicketLinks);
}
public sealed class CtrmCustomerActivityReader
{
    public const string MaxPagesKey = "CustomerSync:DiscoveryMaxPagesPerWindow";
    public const int PageSize = 500;
    public CtrmCustomerActivityReader(ICtrmGraphQlClient client, IConfiguration configuration, ILogger<CtrmCustomerActivityReader> logger);
    public Task<CtrmReadResult<CtrmLinkDiscovery>> DiscoverAsync(DateTime from, DateTime to, CancellationToken cancellationToken);
    public static List<(DateTime From, DateTime To)> Slice(DateTime from, DateTime to, int maxDays);   // inclusive windows, newest last, each ≤ maxDays
}
```

### 3.5 Service / repository / controller contracts

```csharp
// INF/Interfaces/ICustomerSyncRepository.cs — added member
Task<List<long>> ReserveCustomerIdsAsync(int count, CancellationToken cancellationToken);   // sp_sequence_get_range on dbo.CustomerIdSequence; count<=0 → []

// API/Services/CustomerSyncService.cs  (registered AddSingleton in API/Program.cs:147 — LastRun/StartedUtc rely on that)
public CustomerSyncService(IServiceScopeFactory scopeFactory, IConfiguration configuration, ILogger<CustomerSyncService> logger)
public Task<CustomerSyncResult> SyncAsync(CancellationToken cancellationToken = default) => SyncAsync(CustomerSyncOptions.Default, cancellationToken);
public Task<CustomerSyncResult> SyncAsync(CustomerSyncOptions options, CancellationToken cancellationToken);
public DateTime StartedUtc { get; }                          // v2 (D14): process-lifetime marker, set in the ctor
public CustomerSyncLastRun? LastRun { get; }                 // v2 (D14): last NON-dry run; null until one completes (or throws)
public DateTime? LastSuccessfulRunUtc { get; }               // v2 (D14): FinishedUtc of the last non-dry run with Outcome "ok"
public sealed class CustomerSyncOptions
{
    public bool DryRun { get; init; } public bool Force { get; init; } public string? SourceOverride { get; init; } public DateTime? DiscoveryFrom { get; init; }
    public string Trigger { get; init; } = "manual";         // v2 (D14): "manual" | "startup" | "scheduled" — recorded on LastRun; the background service sets it
    public static readonly CustomerSyncOptions Default = new();
}
// CustomerSyncResult — added properties (existing counters unchanged)
public string Source { get; set; } = "ods"; public bool DryRun { get; set; } public bool Aborted { get; set; } public string? AbortCode { get; set; } public string? AbortReason { get; set; }
public CustomerSyncGuardVerdict? Guard { get; set; } public int CustomersMinted { get; set; } public CustomerSyncLookupInfo? Lookup { get; set; } public CustomerSyncDiscoveryInfo? Discovery { get; set; }
// v2 (D14) — same file, next to CustomerSyncResult
public sealed class CustomerSyncLastRun
{
    public required DateTime StartedUtc { get; init; } public required DateTime FinishedUtc { get; init; }
    public required string Trigger { get; init; } public required string Source { get; init; }
    public required string Outcome { get; init; }            // "ok" | "aborted" | "failed"
    public string? AbortCode { get; init; } public string? AbortReason { get; init; } public string? ExceptionType { get; init; }   // ExceptionType = ex.GetType().Name only; never the message (may carry connection strings / PII)
    public CustomerSyncResult? Result { get; init; }         // null when Outcome == "failed"
}

// API/Controllers/CustomerSyncDiagnosticsController.cs  [ApiController][Route("api/diagnostics/customer-sync")][Authorize(Policy = "AdminOnly")][Produces("application/json")]
POST run?dryRun=&force=&source=&discoveryFrom=      // no env gate (as today). source only with dryRun=true, else 400. Aborted ⇒ 409 with the result body. Trigger = "manual".
GET  last-run                                        // v2 (D14): no env gate. 200 { ProcessStartedUtc, NowUtc, LastSuccessfulRunUtc, Stale, LastRun } — LastRun null until a non-dry run completes
GET  compare?discoveryFrom=                          // Dev/QA only → CustomerSyncComparison
GET  ctrm-probe?sourceCode=                          // Dev/QA only
// API/Controllers/DiagnosticsEnvironmentGate.cs — the ONE definition of "production-like"; DiagnosticsController.DenyIfProduction() delegates to it (v2, D11)
public static class DiagnosticsEnvironmentGate { public static bool IsProductionLike(IWebHostEnvironment env) => !(env.IsDevelopment() || env.IsEnvironment("Dev") || env.IsEnvironment("QA")); }

// INF/Sync/CustomerSyncComparer.cs (pure)
public static CustomerSyncComparison Compare(CustomerSyncSourceResult ods, CustomerSyncSourceResult ctrm, CustomerSyncAppState appState, DateTime nowUtc);
public sealed class CustomerSyncComparison { DateTime GeneratedAtUtc; CustomerSyncComparisonSide Ods, Ctrm; CustomerSyncSetDiff Customers, Links; List<CustomerSyncFieldDiff> Fields; int AppCustomers, AppActiveCustomers, AppLinks, AppActiveLinks; }
public sealed class CustomerSyncComparisonSide { bool Ok; string? FailureCode; string? FailureDetail; int Rows, Customers, Links, Minted; string? CustomerPermission; CustomerSyncLookupInfo? Lookup; CustomerSyncDiscoveryInfo? Discovery; }
public sealed class CustomerSyncSetDiff { int InBoth, OnlyInOds, OnlyInCtrm; List<string> SampleOnlyInOds, SampleOnlyInCtrm; }   // ≤25 samples; customers = ScoularId codes, links = "CODE|TU"
public sealed class CustomerSyncFieldDiff { string Field; int Compared; int Differs; }   // Fields: Name, Phone, AddressLine1, Location, StateProvince, PostalCode, IndustryCode1, IndustryCode2

// v2 (D13) — INF/Abstractions/CustomerResults.cs: the enum stays; a record carries the id the trade units were written to
public sealed record AssignTradeUnitsOutcome(AssignTradeUnitsResult Result, long CustomerId, bool Adopted)
{
    public static AssignTradeUnitsOutcome Ok(long customerId, bool adopted = false) => new(AssignTradeUnitsResult.Ok, customerId, adopted);
    public static AssignTradeUnitsOutcome NoCodes(long requested) => new(AssignTradeUnitsResult.NoCodes, requested, false);
    public static AssignTradeUnitsOutcome CustomerNotFound(long requested) => new(AssignTradeUnitsResult.CustomerNotFound, requested, false);
}
// INF/Interfaces/ICustomerRepository.cs and API/Services/ICustomerService.cs — return type changes, parameters unchanged
Task<AssignTradeUnitsOutcome> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, string currentUser, CancellationToken cancellationToken);   // repository
Task<AssignTradeUnitsOutcome> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, CancellationToken cancellationToken);                       // service
// INF/Repositories/CustomerRepository.cs — two protected virtual seams (the ODS SQL cannot run on the InMemory provider; tests subclass and override; E3/E4 re-route the same two seams to CTRM later)
protected virtual Task<List<Customer>> QueryOnboardingCandidatesAsync(string searchTerm, CancellationToken cancellationToken);   // today's SQL + MapOdsRowToCustomer, no dedupe
protected virtual Task<Customer?> LoadOnboardingCandidateAsync(long customerId, CancellationToken cancellationToken);           // today's GetOdsCustomerRowAsync + MapOdsRowToCustomer
```

```ts
// v2 (D13) — client/src/app/features/customers/pages/home/adopt-assigned-customer.ts (pure; precedent: merge-producer-rows.ts next to it)
export function applyAdoptedCustomerId<T extends { customerId: number }>(data: T, returned: { id: number } | null | undefined): T;
// returns `data` itself when returned is null/undefined or returned.id === data.customerId; otherwise `{ ...data, customerId: returned.id }`
```

## 4. Conventions every task follows

- Branch `feature_CustomersFromGraphQL`; verify with `git -C C:/Users/CEgr/Projects/Origination-customers branch --show-current` before the first edit.
- TDD: write the named failing test, run it and see it fail for the expected reason, implement, run green, commit. One behaviour per task.
- Targeted test run: `dotnet test api/GrainOriginatorPortal.Api.Tests/GrainOriginatorPortal.Api.Tests --filter "FullyQualifiedName~<TestClass>" --artifacts-path api/.test-artifacts` then `rm -rf api/.test-artifacts`. Client specs: `cd client && npx vitest run <spec path>`. Before the commit of the LAST task in each batch also run the full gate: `dotnet test GrainOriginatorPortal.sln --filter "Category!=Integration" --artifacts-path api/.test-artifacts; rm -rf api/.test-artifacts` (and `cd client && npx vitest run` when the batch touched `client/`).
- Test style: xUnit, `Method_Condition_Expected` names, `// Microsoft namespaces / // Third-party namespaces / // Project namespaces` using groups, Moq for `ICtrmGraphQlClient` and repositories (existing precedent in `TEST/Repositories/Ctrm*Tests.cs`), InMemory `ApplicationDbContext` only where a repository is the unit (precedent: `CustomerRepositoryTradeUnitsTests`). Call `CtrmTradeUnitThrottle.ResetForTests()` in the constructor of any test class that drives a reader.
- Commit: `git -C C:/Users/CEgr/Projects/Origination-customers commit --only -m "<type>(<scope>): <subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <every path in the write-set>`. The `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer is required on every commit (v2: trailer updated per the orchestrator; the earlier Fable trailer is retired). Nobody opens a PR; nobody deploys.
- Any model change: `has-pending-model-changes` must report none (command in B3). Any migration: add its id and any new objects to `scripts/_VerifySchema.sql` in the same commit.
- Docs: `docs/application-context/*` updated in D5 in this plan; no What's New entry in Stage 1.

---

## 5. Batch A — independent building blocks (dispatch all in parallel)

### A1 — Access check reads `dbo.CustomerTradeUnit`
`safe-parallel` · write-set: `INF/Repositories/EntitlementsRepository.cs`, `INF/Interfaces/IEntitlementsRepository.cs`, `TEST/Repositories/EntitlementsRepositoryCustomerTradeUnitTests.cs`

Test (new file, InMemory `ApplicationDbContext` + InMemory `TradeUnitPreferencesDbContext`, unique db names per test):
```csharp
[Fact] public async Task GetCustomerTradeUnitCodesAsync_ReturnsDistinctTrimmedActiveCodes_IncludingManual_ExcludingInactive()
// seed CustomerTradeUnit rows for CustomerId 7: ("1085 ", IsActive true), ("1085", IsActive true, IsManual true), ("2200", IsActive true, IsManual true), ("3300", IsActive false, UserDeactivated true); plus CustomerId 8 ("4400", active)
// expect: ["1085","2200"] in any order
[Fact] public async Task GetCustomerTradeUnitCodesAsync_UnknownCustomer_ReturnsEmpty()
```
Implementation: constructor becomes `EntitlementsRepository(TradeUnitPreferencesDbContext entitlementsContext, ApplicationDbContext appContext)`; field `_appContext`; method:
```csharp
public async Task<List<string>> GetCustomerTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken)
{
    var codes = await _appContext.CustomerTradeUnits.AsNoTracking()
        .Where(t => t.CustomerId == customerId && t.IsActive)
        .Select(t => t.TradeUnit).ToListAsync(cancellationToken);
    return codes.Select(c => c.Trim()).Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
}
```
Update the interface XML doc: "from dbo.CustomerTradeUnit (active rows, manual included) — no longer the live ODS view". Remove the `OriginationDbContext` using if unused. DI needs no change (scoped, constructor-injected). Verify `UserEntitlementServiceTests` still green (they mock the interface).
Commit: `feat(entitlements): read a customer's trade units from dbo.CustomerTradeUnit, not the live ODS view`

### A2 — Customer DTOs + GraphQL documents
`safe-parallel` · write-set: `INF/Ctrm/Dtos/CtrmCustomerDtos.cs`, `INF/Ctrm/CtrmCustomerQueries.cs`, `TEST/Repositories/CtrmCustomerQueriesTests.cs`

Tests:
```csharp
[Fact] public void CustomersBySourceCodesAliased_BuildsOneAliasPerCode_WithJsonSerialisedCodes()
// codes ["TATOBIN", "O'HARA1"] → document contains "c0: customers(skip: 0, take: 5, sourceCode: \"TATOBIN\")" and "c1: customers(skip: 0, take: 5, sourceCode: \"O'HARA1\")", contains CtrmCustomerQueries.CustomerProjection, starts with "query {"
[Fact] public void CustomersBySourceCodesAliased_WithSourceSystem_AddsTheArgument()   // contains ", sourceSystem: \"CTRM\")"
[Theory] [InlineData(nameof(CtrmCustomerQueries.ContractLinksInWindow))] [InlineData(nameof(CtrmCustomerQueries.TicketLinksInWindow))] [InlineData(nameof(CtrmCustomerQueries.CustomersProbe))]
public void Documents_ContainNoHashCommentLines(string constName)   // reflection over the const; Assert.DoesNotContain('#', value)
[Fact] public void CustomersBySourceCodesAliased_ContainsNoHash()   // same guard for the builder output
[Fact] public void CustomerProjection_NamesOnlyFieldsConfirmedOn2026_10_05()
// exact string equality against the literal in §3.4 — a deliberate tripwire so adding a field is a conscious act; the confirmed list is inlined in D3
[Fact] public void CtrmYesNo_IsYes_AcceptsBoolTrueAndYStrings()   // JsonDocument.Parse("true"), "\"Y\"", "\"n\"", "false", "1"
```
Implementation per §3.4. `CustomersBySourceCodesAliased` throws `ArgumentOutOfRangeException` on zero codes; `TakePerCode = 5` because a code with more than five MDM rows is a data problem the duplicate counter should surface, not something to page. Add XML remarks: why no `#`, why `id` and `mdmMasterRecord` are `JsonElement`.
Commit: `feat(ctrm): customer DTOs and the customers / link-discovery GraphQL documents`

### A3 — `CustomerIdMinting` constants
`safe-parallel` · write-set: `INF/Sync/CustomerIdMinting.cs`, `TEST/Repositories/CustomerIdMintingTests.cs`

Tests:
```csharp
[Fact] public void Band_SitsBelowTheSyntheticContractBand() => Assert.True(CustomerIdMinting.ReservedBase + CustomerIdMinting.Span <= CtrmSyntheticId.ReservedBase);
[Fact] public void Band_RoundTripsThroughAJavaScriptNumber() => Assert.True(CustomerIdMinting.ReservedBase + CustomerIdMinting.Span - 1 < 9_007_199_254_740_991L);
[Theory] [InlineData(4_999_999_999_999_999L, false)] [InlineData(5_000_000_000_000_000L, true)] [InlineData(5_999_999_999_999_999L, true)] [InlineData(6_000_000_000_000_000L, false)] [InlineData(123456L, false)]
public void IsMinted_RecognisesOnlyTheBand(long id, bool expected)
```
Implementation per §3.3 with XML remarks restating D5 (why a band, why below 7e15, why the migration still reads the live max, and — v2 — that the band is a permanent convention once a minted id carries notes in PROD).
Commit: `feat(customer-sync): reserved id band for customers minted from CTRM`

### A4 — `CustomerSyncGuard` (pure)
`safe-parallel` · write-set: `INF/Sync/CustomerSyncGuard.cs`, `TEST/Services/CustomerSyncGuardTests.cs`

Tests:
```csharp
[Fact] public void Evaluate_EmptySourceWithActiveRows_Trips()           // sourceRows 0, active 100/300 → Tripped, Reason starts "source returned no rows"
[Fact] public void Evaluate_EmptySourceOnEmptyApp_DoesNotTrip()         // 0 rows, 0 active → not tripped (first run on an empty DB)
[Fact] public void Evaluate_CustomerCountAboveAbsoluteLimit_Trips()     // limits (100, 500): active 100000, deactivate 501 → tripped (0.5% but > 500)
[Fact] public void Evaluate_CustomerPercentAboveLimit_Trips()           // limits (5, 500): active 1000, deactivate 51 → tripped (5.1%)
[Fact] public void Evaluate_LinkPercentAboveLimit_Trips()               // customers fine, links active 2000 deactivate 101 → tripped, Reason contains "links"
[Fact] public void Evaluate_WithinBothLimits_DoesNotTrip()              // active 1000 deactivate 50 (5.0% exactly) → not tripped
[Fact] public void FromConfiguration_ClampsAndDefaults()                // {} → (5,500); {"CustomerSync:MaxDeactivationPercent":"250","CustomerSync:MaxDeactivationCount":"-3"} → (100, 0)
```
Implementation: rules in D7; percent rule is `toDeactivate * 100 > activeBefore * MaxDeactivationPercent` (integer math, no floats); reason strings: `"source returned no rows while the app holds {active} active customers / {links} active links"`, `"customers: {n} of {before} active would be deactivated, limit {count} rows / {pct}%"`, `"links: …"`. Both rules evaluated; first tripped reason wins.
Commit: `feat(customer-sync): mass-deactivation guard (pure rule)`

### A5 — `CtrmCustomerFilters` (view parity filters)
`safe-parallel` · write-set: `INF/Sync/CtrmCustomerFilters.cs`, `TEST/Services/CtrmCustomerFiltersTests.cs` (depends on A2's DTO type — A2 and A5 may run in parallel only if A5's implementer creates the DTO file identically; to avoid that, **dispatch A5 after A2 commits** or in the same implementer as A2)

Tests (Theory over `(activeYN, industryCode1, name, sourceCode, expectedInScope, expectedReason)`):
`("Y","PR","Smith Farms","SMITFAR",true,"ok")`, `("N","PR",…,false,"inactive")`, `("Y","CM",…,false,"not-producer")`, `("Y"," pr ",…,true,"ok")`, `("Y","PR","SMITH DUP","X",false,"name-dup")`, `("Y","PR","do not use - smith","X",false,"name-do-not-use")`, `("Y","PR","*Smith","X",false,"name-placeholder")`, `("Y","PR","$Smith","X",false,"name-placeholder")`, `("Y","PR",null,"X",false,"no-name")`, `("Y","PR","Smith","",false,"no-source-code")`, `("y","PR","Smith","X",true,"ok")`.
Implementation: evaluate in the order the reasons are listed in §3.3; `name` checked raw (no trim before the first-character test, matching SQL `LEFT`), `Contains(…, StringComparison.OrdinalIgnoreCase)`.
Commit: `feat(customer-sync): CTRM customer filters mirroring vw_CustomerTradeUnits`

### A6 — Base `appsettings.json` keys
`safe-parallel` · write-set: `API/appsettings.json`

Add to the existing `"CustomerSync"` object, after `RunAtTimeUtc`, the eight keys of §3.1 each preceded by its `"// Key"` prose sibling (the file's convention: every key in the `Ctrm` section has a `"// KeyName"` sibling holding prose — dossier §4.14; the base `CustomerSync` object today holds only `RunAtTimeUtc`). `Source` prose must say: EMPTY ON PURPOSE, same convention as `Ctrm:Source` (whose base doc reads "EMPTY here ON PURPOSE so no environment can accidentally leave ODS"); rollback = App Service setting `CustomerSync__Source=ods`, no redeploy. Guard prose must say the guard applies to both sources and that `POST /api/diagnostics/customer-sync/run?force=true` bypasses it, and (v2) that `GET /api/diagnostics/customer-sync/last-run` shows whether the last run was aborted. No env file changes. Verify: `dotnet build api/GrainOriginatorPortal.Api` and `python -c "import json;json.load(open('api/GrainOriginatorPortal.Api/appsettings.json'))"` (or `node -e`).
Commit: `config(customer-sync): CustomerSync source, guard and discovery knobs (empty source = ODS)`

### A7 — Sync attribute appliers (ODS verbatim, CTRM partial)
`safe-parallel` · write-set: `INF/Sync/CustomerSyncAttributes.cs`, `TEST/Services/CustomerSyncAttributesTests.cs` (needs A2's DTO; dispatch after A2 or in the same implementer)

Tests:
```csharp
[Fact] public void Ods_ApplyTo_CopiesEveryViewColumn_AndNormalisesNopId()
// CustomerTradeUnitView with every property set, NopIdNumber "0" → target has all 23 values, NopIdNumber null; equals view.ToCustomer() field-by-field except IsActive
[Fact] public void Ctrm_ApplyTo_SetsTheNineStage1Columns_Trimmed()
// dto Name " Smith Farms ", SourceCode "SMITFAR ", MerchandisingPhone " 402 ", … → Name "Smith Farms", ScoularId "SMITFAR", Phone "402", Location/StateProvince/AddressLine1/PostalCode/IndustryCode1/IndustryCode2 set
[Fact] public void Ctrm_ApplyTo_LeavesColumnsWithoutAGraphQlFieldUntouched()
// start Customer with every string property = "keep", EffectiveStartDate = 2020-01-01; apply dto; for each name in CtrmCustomerSyncAttributes.UntouchedColumns assert (via reflection) value unchanged
[Fact] public void Ctrm_UntouchedColumns_CoverEveryCustomerColumnTheOdsApplierSets_MinusTheNineMapped()
// reflection: properties OdsCustomerSyncAttributes changes on a blank Customer (set from a fully-populated view) minus {Name,ScoularId,Phone,Location,StateProvince,AddressLine1,PostalCode,IndustryCode1,IndustryCode2} == UntouchedColumns as a set
[Fact] public void CreateNew_SetsIdActiveAndNotManual()
```
Implementation per §3.3; `OdsCustomerSyncAttributes.ApplyTo` is the verbatim body of today's `CustomerSyncService.ApplyAttributes` (do NOT delete the original yet — C1 does). `Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim()`; `Name = Clean(source.Name) ?? string.Empty`.
Commit: `feat(customer-sync): attribute appliers — ODS copies everything, CTRM only the fields that exist today`

### A8 — Onboarding search excludes candidates already held by `ScoularId` (v2, Mentor change 1)
`needs-serial` (chain A8→A9, same file) · write-set: `INF/Repositories/CustomerRepository.cs`, `TEST/Repositories/CustomerRepositoryOnboardingTests.cs`

Why (D13): the dedupe at `CustomerRepository.cs:231-240` is by ODS id only, so a producer the CTRM sync minted (id 5e15+N, `ScoularId` X) still appears in the ODS onboarding search under its ODS id. Nothing else in Stage 1 touches `CustomerRepository.cs`, so this chain is placed in Batch A without a write-set overlap.

Test harness (new file; the SQL in `SearchOdsAsync` cannot run on the InMemory provider, so the test subclasses the repository and overrides the seam — the same reason §3.5 makes it `protected virtual`):
```csharp
private sealed class TestableCustomerRepository : CustomerRepository
{
    public List<Customer> Candidates { get; } = [];                        // what the "ODS" would return for any term
    public Customer? Candidate { get; set; }                               // what the "ODS" would return for LoadOnboardingCandidateAsync (A9)
    public int CandidateLoads { get; private set; }
    protected override Task<List<Customer>> QueryOnboardingCandidatesAsync(string searchTerm, CancellationToken ct) => Task.FromResult(Candidates.ToList());
    protected override Task<Customer?> LoadOnboardingCandidateAsync(long customerId, CancellationToken ct) { CandidateLoads++; return Task.FromResult(Candidate); }
}
// Build(): InMemory OriginationDbContext (unused) + InMemory ApplicationDbContext, strict ITicketRepository/IContractRepository mocks, Mock<ILogger> — copy CustomerRepositoryTradeUnitsTests.Build
[Fact] public async Task SearchOdsAsync_DropsCandidatesWhoseIdIsAlreadyOnboarded()
// app: Customer 777 "SMITFAR"; candidates [(777,"SMITFAR"), (778,"JONES")] → result ids [778]
[Fact] public async Task SearchOdsAsync_DropsCandidatesWhoseScoularIdIsAlreadyOnboarded_UnderADifferentId()
// app: Customer 5_000_000_000_000_042 ScoularId "SMITFAR" (minted); candidates [(777,"smitfar "), (778,"JONES")] → result ids [778]  (trim + OrdinalIgnoreCase)
[Fact] public async Task SearchOdsAsync_CandidateWithBlankScoularId_IsKeptUnlessItsIdIsOnboarded()   // (779, null) survives; blank codes never match anything
```
Implementation: split today's `SearchOdsAsync` body — the word split, the `whereClauses`, the SQL, `SqlQueryRaw<OdsCustomerRow>` and `MapOdsRowToCustomer` move verbatim into `protected virtual async Task<List<Customer>> QueryOnboardingCandidatesAsync(string searchTerm, CancellationToken)` (returns `[]` for an empty term exactly as today); `SearchOdsAsync` becomes: candidates → `candidateIds`, `candidateCodes` (trimmed, non-blank) → ONE `_appContext.Customers.AsNoTracking().Where(c => candidateIds.Contains(c.Id) || (c.ScoularId != null && candidateCodes.Contains(c.ScoularId))).Select(c => new { c.Id, c.ScoularId })` → drop a candidate when its id is in `existingIds` OR its trimmed code is in `existingCodes` (`HashSet<string>(StringComparer.OrdinalIgnoreCase)` of trimmed existing codes). InMemory note: `Contains` on a `List<string>` translates on both providers; do the trim comparison in memory after the query (the InMemory provider does not ignore trailing spaces — same caveat `CustomerRepositoryTradeUnitsTests` records), so seed the test's app rows with trimmed codes and put the padding on the candidate side. Keep the existing Information log line (count only, no term). Update the method's XML doc: "already onboarded = same id OR same ScoularId (a CTRM-minted row carries an id the ODS has never seen)".
(fix-1: the query trims the column too, symmetric with A9 — a stored leading space would otherwise escape the dedupe.)
Commit: `fix(customers): onboarding search also drops producers the sync already holds under another id (by ScoularId)`

### A9 — `AssignTradeUnitsAsync` adopts an existing row by `ScoularId` instead of inserting a second one (v2, Mentor change 1)
`needs-serial` (chain A8→A9) · `hard` · write-set: `INF/Repositories/CustomerRepository.cs`, `INF/Abstractions/CustomerResults.cs`, `INF/Interfaces/ICustomerRepository.cs`, `API/Services/ICustomerService.cs`, `API/Services/CustomerService.cs`, `API/Controllers/CustomersController.cs`, `TEST/Repositories/CustomerRepositoryOnboardingTests.cs`, `TEST/Services/CustomerServiceTests.cs`, `TEST/Controllers/CustomersControllerTests.cs`

Why the write-set is wider than the Mentor's "~30 lines" (v2 rationale): adoption writes the trade units to a *different* id than the one in the URL, and `CustomersController.AssignTradeUnits` (`:165-174`) then does `GetByIdAsync(id)` with the requested id — it would 404 on the very request that succeeded. The id therefore has to travel back, which the bare enum cannot do; hence `AssignTradeUnitsOutcome` (§3.5). `CustomersControllerTests` has no AssignTradeUnits test today (grep), so the controller test is new.

Tests:
```csharp
// repository (same TestableCustomerRepository as A8)
[Fact] public async Task AssignTradeUnitsAsync_UnknownId_WithAnExistingRowOfTheSameScoularId_AdoptsIt_AndInsertsNoCustomer()
// app: Customer 5_000_000_000_000_042 ScoularId "SMITFAR" active; Candidate = Customer{Id 777, ScoularId "smitfar"}; call (777, ["1085"]) → Outcome Ok, CustomerId 5e15+42, Adopted true; app.Customers.Count() == 1; CustomerTradeUnit (5e15+42,"1085") IsManual true active; no row for 777
[Fact] public async Task AssignTradeUnitsAsync_Adoption_PrefersTheActiveRow_ThenTheLowestId()
// app: 5e15+50 "SMITFAR" inactive, 5e15+42 "SMITFAR" active, 900 "SMITFAR" active → adopted 900 (active, lowest id)
[Fact] public async Task AssignTradeUnitsAsync_Adoption_ReactivatesAnInactiveRow_AsManual()      // only inactive rows with that code → adopted row IsActive true, IsManual true (today's reactivation rule)
[Fact] public async Task AssignTradeUnitsAsync_UnknownId_NoRowWithThatScoularId_StillInsertsFromTheCandidate()   // Outcome Ok, CustomerId 777, Adopted false, inserted IsManual true (today's path, unchanged)
[Fact] public async Task AssignTradeUnitsAsync_UnknownId_EmptyCodes_ReturnsNoCodes_WithoutLoadingTheCandidate()  // CandidateLoads == 0 (today's ordering kept — no ODS read for a request that cannot onboard)
[Fact] public async Task AssignTradeUnitsAsync_UnknownId_CandidateMissing_ReturnsCustomerNotFound()
[Fact] public async Task AssignTradeUnitsAsync_KnownId_ReturnsOkWithTheSameId_NotAdopted()
// service: CustomerServiceTests — the existing assign test at :194-207 changes its Setup/Assert to AssignTradeUnitsOutcome.Ok(7L) (pass-through unchanged)
// controller: CustomersControllerTests
[Fact] public async Task AssignTradeUnits_AdoptedOutcome_ReturnsTheAdoptedCustomer()   // service mock: Outcome Ok(5e15+42, adopted true); GetByIdAsync(5e15+42) → response; assert the Ok body is that response and GetByIdAsync(777) was never called
[Fact] public async Task AssignTradeUnits_NoCodes_Returns400_And_CustomerNotFound_Throws()   // behaviour unchanged, now via Outcome.Result
```
Implementation: `AssignTradeUnitsAsync` — after the `NoCodes` early return and when `!customerExists`: `var candidate = await LoadOnboardingCandidateAsync(customerId, ct)` (new seam = today's `GetOdsCustomerRowAsync` + `MapOdsRowToCustomer`, verbatim); null → `CustomerNotFound(customerId)`; `var code = candidate.ScoularId?.Trim(); var existingByCode = string.IsNullOrEmpty(code) ? null : await _appContext.Customers.Where(c => c.ScoularId != null && c.ScoularId.Trim() == code).OrderByDescending(c => c.IsActive).ThenBy(c => c.Id).FirstOrDefaultAsync(ct)` (`Trim()` on the column: SQL Server ignores trailing spaces in `=` anyway; the InMemory provider needs the explicit trim — same caveat as A8); found → `adopted = true; customerId = existingByCode.Id;` reactivate if `!IsActive` (`IsActive = true; IsManual = true`, today's rule) and `_logger.LogInformation("AssignTradeUnits: requested id {RequestedId} adopted existing customer {CustomerId} by ScoularId (no second row inserted)", requested, customerId)` — ids only, never the code or name; not found → today's insert (`candidate.IsManual = true; IsActive = true; Add`). Everything below runs against the possibly-adopted `customerId`, except the soft-deactivate loop, which is skipped when `adopted` is true — an onboarding call posts only the new codes, not the adopted row's full manual list, so reconciling would deactivate manual trade units the client never saw (decided 2026-10-06 at triage, hand-off 3). The audit line records `Adopted=` and, on adoption, the union as `After`. Return `AssignTradeUnitsOutcome.Ok(customerId, adopted)`; the other two returns become `NoCodes(customerId)` / `CustomerNotFound(customerId)`. `CustomerService.AssignTradeUnitsAsync` is a pass-through (return type only). Controller: `switch (outcome.Result)` keeps the three cases; default → `GetByIdAsync(outcome.CustomerId)`; `[ProducesResponseType]` unchanged. XML doc on the repository method: the adoption rule, the tie-break, and that E4 later adds `ScoularId` to the request so the client never has to send an ODS id at all.
Commit: `fix(customers): assigning trade units adopts the row the sync already holds for that ScoularId instead of inserting a second producer`

### A10 — Client uses the returned customer's id after an adopted onboarding (v2, Mentor change 1)
`safe-parallel` (client only; no server overlap) · write-set: `client/src/app/features/customers/pages/home/adopt-assigned-customer.ts`, `client/src/app/features/customers/pages/home/adopt-assigned-customer.spec.ts`, `client/src/app/features/customers/pages/home/home.component.ts`

Why (D13): `home.component.ts:1942-1952` calls `_saveProducerDetailsAndLinks(data)` and `_movePlantingIntentions(data.customerId, …)` with the *requested* id after the PUT resolves, and `_saveProducerDetailsAndLinks` (`:2005-2010`) finds the customer by `data.customerId` (list or `selectedCustomer`) and returns silently when it cannot — so after an A9 adoption the details would be written under the stale ODS id (the split again) or dropped. `home.component.ts` has no spec (1,900+ lines), so the logic is a pure helper with its own spec, the precedent being `merge-producer-rows.ts` / `.spec.ts` in the same folder.

Spec (`adopt-assigned-customer.spec.ts`, vitest):
```ts
it('returns the same object when the server kept the requested id')        // applyAdoptedCustomerId(data{customerId 777}, {id 777}) toBe(data)
it('returns the same object when the response is null or undefined')
it('rewrites customerId when the server adopted another row')              // (data{customerId 777}, {id 5000000000000042}) → customerId 5000000000000042, every other field equal, original untouched
```
Implementation: helper per §3.5. In `home.component.ts` the `next: () =>` at `:1943` becomes `next: (customer) => { const effective = applyAdoptedCustomerId(data, customer); const adopted = effective.customerId !== data.customerId; const sel = this.selectedCustomer(); if (adopted) { this.toastService.success('That producer was already in the Workbench — trade units were added to the existing record.'); this.selectedCustomer.set({ ...customer, isManual: true, isOnboardCandidate: false }); } else if (sel?.id === data.customerId && sel.isOnboardCandidate) { /* today's branch verbatim */ } this._saveProducerDetailsAndLinks(effective); this._movePlantingIntentions(effective.customerId, effective.intentionMoves ?? []); }`. Setting `selectedCustomer` to the returned record BEFORE `_saveProducerDetailsAndLinks` is what lets its `sel?.id === data.customerId` fallback find the adopted row (the list may not contain it). Run `cd client && npx vitest run src/app/features/customers/pages/home/adopt-assigned-customer.spec.ts` and the client build (`npx ng build` or the repo's build-check) — the component has no spec, the build is the regression check.
Commit: `fix(client): after onboarding, follow the producer id the server actually assigned trade units to`

---

## 6. Batch B — readers, sequence, source plumbing (after Batch A)

Chains: B1a→B1b→B1c (same file), B2a→B2b→B2c (same file), B3a→B3b, B4 standalone. Chains run in parallel with each other.

### B1a — `CtrmCustomerReader.GetBySourceCodesAsync` happy path
`needs-serial` (chain B1) · `hard` · write-set: `INF/Ctrm/CtrmCustomerReader.cs`, `TEST/Repositories/CtrmCustomerReaderTests.cs`

Test (fake `ICtrmGraphQlClient` modelled on `CtrmContractReaderAliasedTests.AliasClient`: parses `c(\d+): customers\(skip: 0, take: 5, sourceCode: ("[^"]*")` out of the document, answers `Dictionary<string, CtrmPage<CtrmCustomerDto>>` with one dto per alias whose `SourceCode` = the code, `Name = code + " Farms"`, `ActiveYN = "Y"`, `IndustryCode1 = "PR"`; records documents):
```csharp
[Fact] public async Task GetBySourceCodesAsync_FortyFiveCodesAtAliasCountTwenty_MakesThreeRequests_AndKeysEveryCodeCaseInsensitively()
// config {"CustomerSync:CustomerAliasCount":"20"}; 45 distinct codes (some lower-case, some with trailing spaces) → Ok, Requests 3, Found 45, Missing 0, ByCode["tatobin"] resolves, ByCode["TATOBIN"].SourceCode == "TATOBIN"
[Fact] public async Task GetBySourceCodesAsync_EmptyInput_MakesNoRequest()   // Ok, Requested 0, client never called
```
Implementation: `codes = CtrmCustomerCodes.NormalizeKeepingAll(sourceCodes)` (trim/distinct/sort; the 7-char limit is a `customerIds` defect, not a `sourceCode` one); chunk by `Math.Clamp(ReadInt(AliasCountKey, 20), 1, 50)`; per chunk `CtrmTradeUnitThrottle.RunAsync(_configuration, () => CtrmServerTimeoutRetry.RunAsync(() => _client.QueryAsync<Dictionary<string, CtrmPage<CtrmCustomerDto>>>(doc, null, ct), _configuration, _logger, $"customers chunk {i}"))`; chunks run through a `SemaphoreSlim(Math.Clamp(ReadInt(ConcurrencyKey, 2), 1, 8))`; `sourceSystem = _configuration[SourceSystemKey]?.Trim()` → null when empty. Each alias `c{i}` maps to `chunk[i]`; `items.Count == 0` → Missing++; one item → ByCode[code] = item; several → B1c. Logging: one Information line per read with counts and elapsed ms, no names.
Commit: `feat(ctrm): aliased customer lookup by sourceCode`

### B1b — Fail closed on any batch failure, with permission and schema detail
`needs-serial` (chain B1) · `hard` · write-set: `INF/Ctrm/CtrmCustomerReader.cs`, `TEST/Repositories/CtrmCustomerReaderTests.cs`

Tests (fake client gains `FailWith: CtrmReadResult<…>` for a given chunk index):
```csharp
[Fact] public async Task GetBySourceCodesAsync_OneChunkUnauthorized_FailsTheWholeRead_WithPermissionMissing()
// chunk 1 of 3 answers Status Unauthorized, HttpStatus 403 → result.Status Unauthorized, Value null, DescribePermission(result) == "missing", Detail contains "Customers.Read.All"
[Fact] public async Task GetBySourceCodesAsync_HotChocolateAuthError_IsReportedAsPermissionMissing()
// QueryError, HttpStatus 200, ErrorCode "AUTH_NOT_AUTHORIZED" → DescribePermission == "missing"
[Fact] public async Task GetBySourceCodesAsync_Http400QueryError_IsReportedAsSchemaMismatch()
// QueryError, HttpStatus 400 → Status QueryError, Detail contains "CtrmCustomerQueries.CustomerProjection", DescribePermission == "unknown"
[Fact] public async Task GetBySourceCodesAsync_PartialSuccess_IsAFailure()   // data+errors on one chunk → whole read fails (a short dictionary would deactivate the missing codes)
[Fact] public void DescribePermission_Ok_IsGranted()
```
Implementation: on the first non-`Ok` chunk (PartialSuccess counts as failure here), cancel remaining chunks (linked CTS) and return `new CtrmReadResult<CtrmCustomerLookup> { Status = chunk.Status, HttpStatus, ErrorCode, Detail = Describe(chunk) }` where `Describe` prefixes: Unauthorized or `ErrorCode` starting with `AUTH_` → `"customers permission missing — Customers.Read.All (or ReadCustomersBasic) is not granted to this client: "`; QueryError + HttpStatus 400 → `"schema mismatch — a field or argument in CtrmCustomerQueries.CustomerProjection / CustomersBySourceCodesAliased does not exist on the API (HTTP 400): "`; else the chunk's own Detail. `DescribePermission`: Unauthorized or `AUTH_*` → "missing"; Ok/PartialSuccess → "granted"; else "unknown". Log at Warning with `[{ErrorCode}] [{ErrorCategory}]` = `CUSTOMER_SYNC_NO_PERMISSION` / `CUSTOMER_SYNC_SCHEMA_MISMATCH` / `CUSTOMER_SYNC_SOURCE_UNAVAILABLE`.
Commit: `feat(ctrm): customer lookup fails closed and names the missing permission or the bad field`

### B1c — Duplicate resolution + probe
`needs-serial` (chain B1) · write-set: `INF/Ctrm/CtrmCustomerReader.cs`, `TEST/Repositories/CtrmCustomerReaderTests.cs`

Tests:
```csharp
[Fact] public void PickCanonical_PrefersActive_ThenMasterRecord_ThenLowestId()
// [ {Active N, Master true, id 1}, {Active Y, Master false, id 9}, {Active Y, Master true, id 5}, {Active Y, Master true, id 3} ] → id 3
[Fact] public async Task GetBySourceCodesAsync_CodeWithThreeRows_CountsOneDuplicate_AndKeepsTheCanonical()   // Duplicates == 1, Found == codes.Count
[Fact] public async Task ProbeAsync_Unauthorized_ReportsPermissionMissing_WithoutSecondRequest()
[Fact] public async Task ProbeAsync_OkWithSample_RunsTheFullProjection_AndReportsProjectionAccepted_AndIdKind()  // 2 requests: CustomersProbe then one aliased lookup for the sample code; sample id JSON number → IdKind "Number"
```
Implementation: `PickCanonical` = `candidates.OrderByDescending(c => c.ActiveYN?.Trim().Equals("Y", OrdinalIgnoreCase) == true).ThenByDescending(c => CtrmYesNo.IsYes(c.MdmMasterRecord)).ThenBy(c => c.IdText, StringComparer.Ordinal).FirstOrDefault()`; duplicates logged once per read as `CUSTOMER_SYNC_DUPLICATE_SOURCE_CODE` with count and up to 10 codes. `ProbeAsync`: `QueryAsync<JsonElement>(CustomersProbe)`, map permission; if granted and `sampleSourceCode` non-blank, run `GetBySourceCodesAsync([sample])` → `ProjectionAccepted = result.Ok`, `SampleFound = ByCode.ContainsKey(sample)`, `IdKind = ByCode[sample].Id.ValueKind.ToString()` when found (v2: records the `customers.id` type for D5/§10 without ever exposing the value); if the second call is a 400 QueryError → `ProjectionAccepted = false` with the schema detail.
Commit: `feat(ctrm): canonical row per sourceCode and a customers permission/schema probe`

### B2a — `CtrmCustomerActivityReader.Slice` + contract-link discovery
`needs-serial` (chain B2) · `hard` · write-set: `INF/Ctrm/CtrmCustomerActivityReader.cs`, `TEST/Repositories/CtrmCustomerActivityReaderTests.cs`

Tests:
```csharp
[Fact] public void Slice_SevenDays_IsOneWindow()                       // (2026-09-29, 2026-10-07) → [(09-29, 10-07)]
[Fact] public void Slice_EightHundredDays_IsThreeWindowsOfAtMost366_Contiguous()   // last.To == to, first.From == from, each span ≤ 366, next.From == prev.To.AddDays(1)
[Fact] public async Task DiscoverAsync_PagesContractsUntilHasNextPageIsFalse_AndCollectsTrimmedUpperLinks()
// fake client: document == ContractLinksInWindow → pages of 500 then 20 rows (variables skip 0/500), items {customerId " tatobin ", tradeUnit "1085 "}, one row with blank tradeUnit, one with null customerId → ContractLinks == {("TATOBIN","1085")}, ContractPages 2, ContractRows 520, ContractsStatus Ok; tickets fake returns empty
[Fact] public async Task DiscoverAsync_PageCapHit_MarksContractsTruncated_AndStillReturnsCollectedLinks()   // config MaxPagesPerWindow 1, hasNextPage always true → ContractsTruncated, Status PartialSuccess
```
Implementation: `Slice` steps forward from `from` in `maxDays`-wide inclusive windows (`to = min(from + (maxDays-1), end)`). `DiscoverAsync` runs contracts then tickets (B2b) sequentially per window; per page `QueryAsync<CtrmContractLinksResponse>(ContractLinksInWindow, new { from = w.From.ToString("yyyy-MM-dd"), to = w.To.ToString("yyyy-MM-dd"), skip, take = PageSize }, ct)` wrapped in `CtrmTradeUnitThrottle.RunAsync` + `CtrmServerTimeoutRetry.RunAsync`; stop on `!HasNextPage` or `Items.Count < PageSize`; page cap `Math.Max(1, ReadInt(MaxPagesKey, 200))` → `Truncated = true`, log `INFRASTRUCTURE_CTRM_TRUNCATED`. Any page failure → `ContractsStatus = that status`, keep links collected so far (B2b decides the combined status).
Commit: `feat(ctrm): discover customer↔trade-unit links from contracts in a date window`

### B2b — Ticket-link discovery + combined status
`needs-serial` (chain B2) · write-set: `INF/Ctrm/CtrmCustomerActivityReader.cs`, `TEST/Repositories/CtrmCustomerActivityReaderTests.cs`

Tests:
```csharp
[Fact] public async Task DiscoverAsync_TicketDetails_LinkEveryDetailCustomer_ToItsOrganizationCode()
// one ticket with details [("SMITH1","2200"),("JONES2","2200"),("SMITH1",null)] → TicketLinks {("SMITH1","2200"),("JONES2","2200")}
[Fact] public async Task DiscoverAsync_TicketsFail_ContractsOk_IsPartialSuccess_WithContractLinksKept()   // result.Status PartialSuccess, TicketsStatus EgressBlocked
[Fact] public async Task DiscoverAsync_BothFail_ReturnsTheContractFailureStatus_WithNullValue()
[Fact] public async Task DiscoverAsync_WindowOver366Days_SlicesTicketsButSendsEachWindowSeparately()   // 400-day span → ticket documents sent with 2 distinct (from,to) pairs
```
Implementation: tickets use `TicketLinksInWindow` with the same paging; combined status: both Ok and nothing truncated → Ok; one failed or anything truncated → PartialSuccess; both failed → `Status = ContractsStatus`, `Value = null`. Log one Information summary line (rows/pages/links per source, elapsed).
Commit: `feat(ctrm): discover links from ticket details; combined discovery status`

### B2c — Discovery never sends an unbounded window
`needs-serial` (chain B2) · write-set: `INF/Ctrm/CtrmCustomerActivityReader.cs`, `TEST/Repositories/CtrmCustomerActivityReaderTests.cs`

Tests: `DiscoverAsync_FromAfterTo_ReturnsOkWithNoLinks_AndNoRequest`; `DiscoverAsync_SpanOverTenYears_IsRejectedAsError` (Status Error, Detail "discovery window exceeds 3660 days — set discoveryFrom deliberately"). Implementation: guard clauses at the top of `DiscoverAsync`.
Commit: `fix(ctrm): bound the discovery window`

### B3a — `dbo.CustomerIdSequence` migration (start computed from the live table)
`needs-serial` (chain B3) · `hard` · write-set: `INF/Data/ApplicationDbContext.cs`, `INF/Data/Migrations/<timestamp>_AddCustomerIdSequence.cs`, `INF/Data/Migrations/<timestamp>_AddCustomerIdSequence.Designer.cs`, `INF/Data/Migrations/ApplicationDbContextModelSnapshot.cs`, `scripts/_VerifySchema.sql`

Steps:
1. In `ApplicationDbContext.OnModelCreating`, right after `base.OnModelCreating(modelBuilder);`: `modelBuilder.HasSequence<long>(CustomerIdMinting.SequenceName, CustomerIdMinting.SequenceSchema).StartsAt(CustomerIdMinting.ReservedBase).IncrementsBy(1);` with a comment pointing at D5 of this plan.
2. Generate: `ConnectionStrings__DefaultConnection="Server=tcp:azrscosqld01.database.windows.net,1433;Initial Catalog=Origination;Authentication=Active Directory Default;Encrypt=true;" dotnet ef migrations add AddCustomerIdSequence --project api/GrainOriginatorPortal.Infrastructure --startup-project api/GrainOriginatorPortal.Api --context ApplicationDbContext --output-dir Data/Migrations` (the design-time factory `INF/Data/ApplicationDbContextFactory.cs` acquires a token through `az login`; if that is unavailable, hand-write the migration + Designer by copying `20261005131626_DropCtrmSourceToggleUsers.Designer.cs`'s shape and add the `modelBuilder.HasSequence<long>("CustomerIdSequence", "dbo").StartsAt(5000000000000000L);` block to both the snapshot and the Designer's `BuildTargetModel` — exactly what the generator emits).
3. Replace the generated `Up` body (`migrationBuilder.CreateSequence<long>(...)`) with:
```csharp
migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.sequences s JOIN sys.schemas sc ON sc.schema_id = s.schema_id WHERE sc.name = N'dbo' AND s.name = N'CustomerIdSequence')
BEGIN
    DECLARE @band bigint = 5000000000000000;
    DECLARE @liveMax bigint = (SELECT ISNULL(MAX(CustomerId), 0) FROM dbo.Customer);
    IF @liveMax >= 6000000000000000
        THROW 51000, N'dbo.Customer already holds ids at or above the minted band [5e15,6e15); choose a new band in CustomerIdMinting before creating dbo.CustomerIdSequence.', 1;
    DECLARE @start bigint = CASE WHEN @liveMax >= @band THEN @liveMax + 1 ELSE @band END;
    DECLARE @sql nvarchar(500) = N'CREATE SEQUENCE dbo.CustomerIdSequence AS bigint START WITH ' + CAST(@start AS nvarchar(20))
        + N' INCREMENT BY 1 MINVALUE ' + CAST(@band AS nvarchar(20)) + N' MAXVALUE 5999999999999999 NO CYCLE CACHE 50;';
    EXEC sys.sp_executesql @sql;
END
""");
```
   `Down`: `migrationBuilder.Sql("DROP SEQUENCE IF EXISTS dbo.CustomerIdSequence;");`. Class comment: why dynamic SQL (the start must come from the live table — the PROD max is unknown at authoring time), why the band (D5).
4. `scripts/_VerifySchema.sql`: append the migration id to `@Migrations` (count comment 52 → 53), add an "Updated 2026-10-06" line to the header, and add a sequence existence check next to the unique-index check — read that block first and copy its problem-row shape exactly: `IF NOT EXISTS (SELECT 1 FROM sys.sequences s JOIN sys.schemas sc ON sc.schema_id = s.schema_id WHERE sc.name = 'dbo' AND s.name = 'CustomerIdSequence') INSERT INTO <the script's problems table> … 'FAIL', 'Missing sequence dbo.CustomerIdSequence'`.
5. Verify: `ConnectionStrings__DefaultConnection="…same…" dotnet ef migrations has-pending-model-changes --project api/GrainOriginatorPortal.Infrastructure --startup-project api/GrainOriginatorPortal.Api --context ApplicationDbContext` → "No changes have been made to the model since the last migration." Then `dotnet build GrainOriginatorPortal.sln`.
Commit: `feat(schema): dbo.CustomerIdSequence for customers minted from CTRM (start from the live max, band 5e15)`

### B3b — `ICustomerSyncRepository.ReserveCustomerIdsAsync`
`needs-serial` (chain B3) · write-set: `INF/Interfaces/ICustomerSyncRepository.cs`, `INF/Repositories/CustomerSyncRepository.cs`, `TEST/Repositories/CustomerSyncRepositoryReserveIdsTests.cs`

Test: `ReserveCustomerIdsAsync_ZeroOrNegative_ReturnsEmpty_WithoutTouchingTheDatabase` (InMemory contexts; count 0 and -1 → `[]`). The SQL path cannot run in-memory; it is exercised by the Dev dry-run in D1 and the test file header says so.
Implementation:
```csharp
public async Task<List<long>> ReserveCustomerIdsAsync(int count, CancellationToken cancellationToken)
{
    if (count <= 0) return [];
    var first = new SqlParameter("@first", System.Data.SqlDbType.Variant) { Direction = System.Data.ParameterDirection.Output };
    await _appDb.Database.ExecuteSqlRawAsync(
        "EXEC sys.sp_sequence_get_range @sequence_name = N'dbo.CustomerIdSequence', @range_size = @count, @range_first_value = @first OUTPUT",
        [new SqlParameter("@count", count), first], cancellationToken);
    var start = Convert.ToInt64(first.Value, System.Globalization.CultureInfo.InvariantCulture);
    return Enumerable.Range(0, count).Select(i => start + i).ToList();
}
```
Interface doc: one round trip; gaps left by an aborted run are expected and harmless.
Commit: `feat(customer-sync): reserve minted customer ids from the sequence in one round trip`

### B4 — Source abstractions + factory + ODS source
`safe-parallel` · `hard` · write-set: `INF/Sync/CustomerSyncSources.cs`, `INF/Sync/ICustomerSyncSource.cs`, `INF/Sync/CustomerSyncSourceRow.cs`, `INF/Sync/CustomerSyncSourceResult.cs`, `INF/Sync/CustomerSyncSourceFactory.cs`, `INF/Sync/OdsCustomerSyncSource.cs`, `TEST/Services/OdsCustomerSyncSourceTests.cs`, `TEST/Services/CustomerSyncSourcesTests.cs`

Tests:
```csharp
// CustomerSyncSourcesTests — same table as ContractRepositorySwitchTests
[Theory] [InlineData(null)] [InlineData("")] [InlineData("ods")] [InlineData("ctrmm")] [InlineData("graphql")] public void Resolve_AnythingOtherThanCtrm_IsOds(string? v)
[Theory] [InlineData("ctrm")] [InlineData("CTRM")] [InlineData("  ctrm  ")] public void Resolve_TheExplicitOptIn_IsCtrm(string v)
// OdsCustomerSyncSourceTests — Mock<ICustomerSyncRepository>
[Fact] public async Task LoadAsync_MapsEveryViewRow_KeyedByOdsCustomerId()   // 3 view rows (2 customers) → 3 rows, CustomerId == view.CustomerId, TradeUnit verbatim, Attributes is OdsCustomerSyncAttributes
[Fact] public async Task LoadAsync_ManualCustomersOutsideTheView_AreLookedUpInTheMaster()
// appState: manual customer 900 not in view; repo.LoadCurrentCustomerMasterAsync([900]) returns a row → ManualMaster[900] present, ManualMasterComplete true
[Fact] public async Task LoadAsync_ManualCustomerMissingFromMaster_IsAbsentFromManualMaster()  // caller deactivates it, as today
[Fact] public async Task LoadAsync_NoManualCustomers_DoesNotQueryTheMaster()
```
Implementation: `CustomerSyncSourceFactory(IServiceProvider sp)`; in B4 it returns `OdsCustomerSyncSource` for both names with a `// C4a wires "ctrm"` comment so the batch compiles without the CTRM class. `OdsCustomerSyncSource.LoadAsync`: `rows = (await repo.LoadOdsTradeUnitRowsAsync(ct)).Select(v => new CustomerSyncSourceRow { CustomerId = v.CustomerId, TradeUnit = v.TradeUnit, Attributes = new OdsCustomerSyncAttributes(v) })`; `manualOutside = appState.Customers.Where(c => c.IsManual && !rowIds.Contains(c.Id))`; master rows → `ManualMaster[r.CustomerId] = new OdsCustomerSyncAttributes(r)`. Minted adoption is C3 (this task is the behaviour-preserving extraction only).
Commit: `feat(customer-sync): source abstraction with the ODS feeder extracted unchanged`

---

## 7. Batch C — the sync service on sources, guard, dry run, CTRM feeder, last-run record (serial chain; after Batch B)

### C1 — `CustomerSyncService` consumes `ICustomerSyncSource`
`needs-serial` · `hard` · write-set: `API/Services/CustomerSyncService.cs`, `TEST/Services/CustomerSyncServiceTests.cs`, `TEST/Controllers/DiagnosticsControllerAppAccessTests.cs`

Test harness (new file): `StubSource : ICustomerSyncSource` returning a preset `CustomerSyncSourceResult`; `Mock<ICustomerSyncRepository>` whose `LoadAppCustomersAsync`/`LoadAppTradeUnitsAsync` return lists the test owns, `AddCustomer`/`AddTradeUnit` capture, `SaveChangesAsync` counted; `Mock<ICustomerRepository>` (`GetOpenActivityTradeUnitsAsync` → empty set); a `ServiceCollection` registering those plus `ICustomerSyncSourceFactory` → `new StubFactory(stubSource)`; config via `ConfigurationBuilder.AddInMemoryCollection`; `new CustomerSyncService(provider.GetRequiredService<IServiceScopeFactory>(), config, NullLogger<CustomerSyncService>.Instance)`.
Tests:
```csharp
[Fact] public async Task SyncAsync_NewRowInserts_ExistingRowUpdates_MissingRowDeactivates()
// app: customer 1 (active, Name "Old"), customer 2 (active); rows: (1,"1085",Name "New"), (3,"2200",Name "Third") → AddCustomer called with Id 3 IsActive true; customer 1 Name "New", CustomersUpdated 1; customer 2 IsActive false, CustomersDeactivated 1; CustomersInserted 1; SaveChanges once
[Fact] public async Task SyncAsync_ManualCustomerAbsentFromRows_IsRefreshedFromManualMaster_OrDeactivatedWhenMissing()
[Fact] public async Task SyncAsync_ManualMasterIncomplete_NeverDeactivatesManualCustomers()
[Fact] public async Task SyncAsync_SourceNotOk_AbortsWithTheSourceCode_AndNeverSaves()   // Failed("ctrm","CUSTOMER_SYNC_NO_PERMISSION","…") → result.Aborted, AbortCode, SaveChanges never
[Fact] public async Task SyncAsync_ReportsTheSourceName()
```
Implementation: constructor `(IServiceScopeFactory, IConfiguration, ILogger<CustomerSyncService>)`; resolve `ICustomerSyncSourceFactory` from the scope; `sourceName = CustomerSyncSources.Resolve(_configuration)` (override arrives in C2); load app state first (tracked), then `source.LoadAsync(appState, CustomerSyncLoadOptions.Default, ct)`; `if (!load.Ok) { result.Aborted = true; result.AbortCode = load.FailureCode; result.AbortReason = load.FailureDetail; _logger.LogError("[{ErrorCode}] [{ErrorCategory}] CustomerSync aborted before any write: {Detail}", load.FailureCode, "Integration", load.FailureDetail); return result; }`; replace `odsRows` with `load.Rows`, `odsRow.ToCustomer()` + `IsActive = true` with `attrs.CreateNew(customerId)`, `ApplyAttributes(existing, odsRow)` with `attrs.ApplyTo(existing)`; manual pass iterates `appCustomers.Where(c => c.IsManual && !sourceCustomersById.ContainsKey(c.Id) && !load.ManualUnverifiable.Contains(c.Id))`, refreshes from `load.ManualMaster`, deactivates only when `load.ManualMasterComplete`; the repo's `LoadCurrentCustomerMasterAsync` is no longer called from the service. Delete the private `ApplyAttributes` (now `OdsCustomerSyncAttributes`). Bring-back pass unchanged. Rewrite the class XML summary for two sources. Fix the `CustomerSyncService` construction in `DiagnosticsControllerAppAccessTests` (add `new ConfigurationBuilder().Build()` as the second argument) so the solution builds at this commit. Also add `Source`, `Aborted`, `AbortCode`, `AbortReason` to `CustomerSyncResult` now (the rest of the new properties in C2).
Commit: `refactor(customer-sync): run the passes over source rows from ICustomerSyncSource`

### C2 — Guard + options + dry run + abort logging
`needs-serial` · write-set: `API/Services/CustomerSyncService.cs`, `API/Services/CustomerSyncBackgroundService.cs`, `TEST/Services/CustomerSyncServiceTests.cs`

Tests:
```csharp
[Fact] public async Task SyncAsync_GuardTrips_AbortsWithoutSaving_AndReportsTheVerdict()   // config {"CustomerSync:MaxDeactivationCount":"10"}; app 100 active customers, rows cover 10 → Aborted, AbortCode CUSTOMER_SYNC_GUARD_TRIPPED, Guard.Tripped, SaveChanges never
[Fact] public async Task SyncAsync_EmptyRowsOnPopulatedApp_AbortsAsSourceEmpty()            // AbortCode CUSTOMER_SYNC_SOURCE_EMPTY
[Fact] public async Task SyncAsync_Force_BypassesTheGuard_AndSaves()
[Fact] public async Task SyncAsync_DryRun_ComputesCounters_ButNeverSaves()   // result.DryRun true, CustomersDeactivated > 0, SaveChanges never
[Fact] public async Task SyncAsync_SourceOverride_IsHonouredOnlyWithDryRun()  // StubFactory records the requested name: ("ctrm", DryRun false) → "ods"; ("ctrm", DryRun true) → "ctrm"
```
Implementation: `SyncAsync(CustomerSyncOptions options, ct)` per §3.5 (including the new `Trigger` property, default `"manual"` — v2, consumed by C6) and the parameterless overload delegating to it; `activeCustomersBefore = appCustomers.Count(c => c.IsActive)`, `activeLinksBefore = appTradeUnits.Count(t => t.IsActive)` captured before the passes; pass `new CustomerSyncLoadOptions { DryRun = options.DryRun, DiscoveryFrom = options.DiscoveryFrom }` to the source; after the bring-back pass: `var verdict = CustomerSyncGuard.Evaluate(load.Rows.Count, activeCustomersBefore, result.CustomersDeactivated + result.ManualCustomersDeactivated, activeLinksBefore, result.TradeUnitsDeactivated, CustomerSyncGuardLimits.FromConfiguration(_configuration)); result.Guard = verdict;` tripped && !Force → `Aborted`, `AbortCode = verdict.SourceRows == 0 ? "CUSTOMER_SYNC_SOURCE_EMPTY" : "CUSTOMER_SYNC_GUARD_TRIPPED"`, `AbortReason = verdict.Reason`, LogError with the code, return; tripped && Force → LogWarning "guard bypassed by force"; `if (options.DryRun) { result.DryRun = true; LogInformation("CustomerSync dry run — nothing persisted"); return result; }`; copy `load.CustomersMinted/Lookup/Discovery` onto the result. `CustomerSyncBackgroundService.RunSyncSafelyAsync`: `var result = await _sync.SyncAsync(new CustomerSyncOptions { Trigger = reason }, stoppingToken); if (result.Aborted) _logger.LogError("[{ErrorCode}] [{ErrorCategory}] CustomerSync {Reason} aborted: {Detail}", result.AbortCode, "Integration", reason, result.AbortReason);` (the alertable line; D4 adds the KQL to the playbook; `reason` is already `"startup"` / `"scheduled"` there — v2 threads it through so the last-run record can name the trigger).
Commit: `feat(customer-sync): abort instead of mass-deactivating; dry run and force options`

### C3 — ODS source adopts minted rows by `ScoularId`
`needs-serial` · write-set: `INF/Sync/OdsCustomerSyncSource.cs`, `TEST/Services/OdsCustomerSyncSourceTests.cs`

Tests:
```csharp
[Fact] public async Task LoadAsync_ViewRowForAnUnknownOdsId_WithAMintedRowOfTheSameScoularId_IsRemappedToTheMintedId()
// appState: customer Id 5_000_000_000_000_042 ScoularId "SMITFAR"; view row CustomerId 777 ScoularId "smitfar " → row.CustomerId == 5_000_000_000_000_042
[Fact] public async Task LoadAsync_ViewRowForAKnownOdsId_IsNotRemapped()
[Fact] public async Task LoadAsync_MintedManualCustomers_AreUnverifiable_NotLookedUp()   // ManualUnverifiable contains the minted id; LoadCurrentCustomerMasterAsync called without it
```
Implementation: `mintedByCode = appState.Customers.Where(c => CustomerIdMinting.IsMinted(c.Id) && !string.IsNullOrWhiteSpace(c.ScoularId)).GroupBy(c => c.ScoularId!.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.OrderBy(c => c.Id).First().Id, StringComparer.OrdinalIgnoreCase)`; `knownIds` = app ids; remap when `!knownIds.Contains(v.CustomerId) && mintedByCode.TryGetValue(v.ScoularId?.Trim() ?? "", out var minted)`; log the adoption count at Information. Manual pass: minted manual ids → `ManualUnverifiable`, excluded from the master query. XML remark (v2): this is the mechanism that makes the `ods` flip-back safe once minted ids carry notes — it must stay for as long as reversibility is wanted (D5, §11 Q7).
Commit: `feat(customer-sync): the ODS feeder keeps minted ids instead of inserting a second row`

### C4a — `CtrmCustomerSyncSource`: master lookup → rows from existing links
`needs-serial` · `hard` · write-set: `INF/Sync/CtrmCustomerSyncSource.cs`, `INF/Sync/CustomerSyncSourceFactory.cs`, `TEST/Services/CtrmCustomerSyncSourceTests.cs`

Constructor: `CtrmCustomerSyncSource(CtrmCustomerReader customers, CtrmCustomerActivityReader activity, ICustomerSyncRepository repository, IConfiguration configuration, ILogger<CtrmCustomerSyncSource> logger, Func<DateTime>? today = null)`. Harness: the readers are real, built on ONE fake `ICtrmGraphQlClient` that answers all three document kinds (aliased customers by regex as in B1; `ContractLinksInWindow` and `TicketLinksInWindow` from preset lists; empty by default); `Mock<ICustomerSyncRepository>` for `ReserveCustomerIdsAsync`.
Tests:
```csharp
[Fact] public async Task LoadAsync_LooksUpEveryScoularIdInTheAppTable_ActiveOrNot_ManualOrNot()   // 4 app customers (one inactive, one manual, one with null ScoularId) → lookup requested exactly the 3 codes
[Fact] public async Task LoadAsync_InScopeCustomer_ReassertsItsActiveSyncLinks_AndSkipsManualAndInactiveOnes()
// customer 1 links: ("1085" active), ("2200" active IsManual), ("3300" inactive), ("4400" inactive UserDeactivated) → rows for 1: exactly {"1085"}
[Fact] public async Task LoadAsync_CustomerWithOnlyUserDeactivatedLinks_GetsAPresenceRowWithNullTradeUnit()
[Fact] public async Task LoadAsync_CustomerFailingTheFilters_GetsNoRows()        // activeYN "N" → absent (caller deactivates, guarded)
[Fact] public async Task LoadAsync_TwoAppRowsSharingAScoularId_EachGetTheirOwnRows()
[Fact] public async Task LoadAsync_ManualCustomerInScopeWithoutEvidence_LandsInManualMaster()
[Fact] public async Task LoadAsync_LookupUnauthorized_ReturnsFailedNoPermission_WithLookupInfo()   // Ok false, FailureCode CUSTOMER_SYNC_NO_PERMISSION, Lookup.Permission "missing", Rows empty
[Fact] public async Task LoadAsync_LookupHttp400_ReturnsFailedSchemaMismatch()
[Fact] public async Task LoadAsync_LookupEgressBlocked_ReturnsFailedSourceUnavailable()
```
Implementation (discovery is C4b; here discovered links are an empty set and `Discovery` stays null): `codes` = distinct trimmed `ScoularId` of ALL app customers; `lookup = await _customers.GetBySourceCodesAsync(codes, ct)`; failure → `Failed(Ctrm, code, detail)` where code = `"missing"` permission → `CUSTOMER_SYNC_NO_PERMISSION`; `QueryError && HttpStatus == 400` → `CUSTOMER_SYNC_SCHEMA_MISMATCH`; else `CUSTOMER_SYNC_SOURCE_UNAVAILABLE`; always attach `Lookup` info. For each app customer with a found, in-scope dto: `attrs = new CtrmCustomerSyncAttributes(dto)`; `active = links of c.Id where !IsManual && IsActive`; `evidence = active.Any() || links.Any(l => l.CustomerId == c.Id && !l.IsManual && l.UserDeactivated)`; one row per active link (`TradeUnit = l.TradeUnit.Trim()`), or one `TradeUnit = null` row if only UserDeactivated evidence; no evidence → no rows, and if `c.IsManual` → `ManualMaster[c.Id] = attrs`. Manual customers with no master row (lookup Ok) → absent from ManualMaster (deactivated by the service, as today); `ManualMasterComplete = true`; blank-`ScoularId` manual customers → `ManualUnverifiable`. Factory: `"ctrm"` now resolves `CtrmCustomerSyncSource`.
Commit: `feat(customer-sync): CTRM feeder — master by sourceCode, links re-asserted from the app table`

### C4b — Discovery merge + minting new producers
`needs-serial` · `hard` · write-set: `INF/Sync/CtrmCustomerSyncSource.cs`, `TEST/Services/CtrmCustomerSyncSourceTests.cs`

Tests:
```csharp
[Fact] public async Task LoadAsync_DiscoveredLinkForAKnownCustomer_AddsARow()           // contract link ("SMITFAR","5500") → row (customer of SMITFAR, "5500")
[Fact] public async Task LoadAsync_DiscoveredUnknownCode_InScope_IsMintedAndGetsItsLinks()
// ticket link ("NEWGUY1","2200"); master returns an in-scope dto for NEWGUY1; repo.ReserveCustomerIdsAsync(1) → [5_000_000_000_000_100] → row CustomerId 5e15+100, CustomersMinted 1, Discovery.NewCodes 1
[Fact] public async Task LoadAsync_DiscoveredUnknownCode_NotInMaster_IsCountedUnknown_NotMinted()   // Discovery.UnknownCodes 1, ReserveCustomerIdsAsync never
[Fact] public async Task LoadAsync_DryRun_UsesNegativePlaceholderIds_AndNeverReservesIds()        // CustomerId -1, ReserveCustomerIdsAsync never
[Fact] public async Task LoadAsync_DiscoveryFails_StillReturnsOk_WithExistingLinks_AndRecordsTheStatus()   // Discovery.ContractsStatus "EgressBlocked", Ok true, rows from existing links only
[Fact] public async Task LoadAsync_DiscoveryWindow_DefaultsToSevenDaysEndingTomorrow_OrHonoursDiscoveryFrom()   // today() = 2026-10-06 → from 2026-09-29, to 2026-10-07; options.DiscoveryFrom 2026-01-01 → from 2026-01-01
```
Implementation order inside `LoadAsync`: (1) discovery (`from = options.DiscoveryFrom ?? today.AddDays(-Math.Clamp(CtrmConfig.ReadInt(_configuration, "CustomerSync:DiscoveryWindowDays", 7), 1, 3660))`, `to = today.AddDays(1)`); failure → `CUSTOMER_SYNC_DISCOVERY_FAILED` warning, links = whatever was returned (possibly empty); (2) `newCodes` = discovered codes not matching any app customer's `ScoularId` (OrdinalIgnoreCase); (3) ONE master lookup for `appCodes ∪ newCodes`; (4) rows for known customers = C4a rows ∪ discovered links for their code; (5) new codes with an in-scope master row → ids from `ReserveCustomerIdsAsync(n)` (or `-1, -2, …` on dry run) → one row per discovered link, one `CtrmCustomerSyncAttributes` per code; new codes not in master or out of scope → `UnknownCodes`, logged once as `CUSTOMER_SYNC_UNKNOWN_CODES` with the count only. Populate `CustomerSyncDiscoveryInfo` fully.
Commit: `feat(customer-sync): discover new producer↔trade-unit links from recent contracts and tickets; mint ids for new producers`

### C5 — DI registration
`needs-serial` · write-set: `INF/DependencyInjection.cs`, `TEST/Services/CustomerSyncSourceFactoryTests.cs`

Test: build a `ServiceCollection` by hand with the five registrations below plus InMemory `ApplicationDbContext`/`OriginationDbContext`, a `Mock<ICtrmGraphQlClient>`, an empty `IConfiguration`, `NullLoggerFactory`, `Mock<ICustomerSyncRepository>`; assert `factory.Create("ctrm") is CtrmCustomerSyncSource` and `factory.Create("ods") is OdsCustomerSyncSource`.
Implementation in `DependencyInjection.cs` next to the CTRM readers: `services.AddSingleton<CtrmCustomerReader>(); services.AddSingleton<CtrmCustomerActivityReader>(); services.AddScoped<OdsCustomerSyncSource>(); services.AddScoped<CtrmCustomerSyncSource>(); services.AddScoped<ICustomerSyncSourceFactory, CustomerSyncSourceFactory>();` with a comment: readers are singletons like `CtrmContractReader` (shared `ICtrmGraphQlClient`, no per-request state); sources are scoped because they hold the scoped sync repository. (v2: the batch's full gate moves to C6, which is now the last task of Batch C.)
Commit: `feat(customer-sync): register the CTRM customer readers and both sync feeders`

### C6 — `CustomerSyncService` remembers its last non-dry run (v2, Mentor change 2 / D14)
`needs-serial` · write-set: `API/Services/CustomerSyncService.cs`, `TEST/Services/CustomerSyncServiceTests.cs`

Why here and not in the background service (v2 rationale): `CustomerSyncService` is the singleton (`API/Program.cs:147`) that every trigger — startup, scheduled, manual `POST run` — passes through, so recording in `SyncAsync` covers all three with no new type registration and no constructor change; recording in `CustomerSyncBackgroundService` would miss manual runs and would need the hosted service exposed to the controller. Placed last in Batch C so it never shares a dispatch with C1/C2 (same file).

Tests (same harness as C1/C2; the service instance is the unit):
```csharp
[Fact] public async Task SyncAsync_CompletedRun_RecordsLastRunOk_WithTriggerSourceAndCounters()   // options Trigger "scheduled" → LastRun.Outcome "ok", Trigger "scheduled", Source "ods", Result same counters, FinishedUtc >= StartedUtc, LastSuccessfulRunUtc == LastRun.FinishedUtc
[Fact] public async Task SyncAsync_AbortedRun_RecordsLastRunAborted_WithTheCode_AndLeavesLastSuccessfulUntouched()   // guard trips → Outcome "aborted", AbortCode CUSTOMER_SYNC_GUARD_TRIPPED, LastSuccessfulRunUtc unchanged from the previous ok run
[Fact] public async Task SyncAsync_RepositoryThrows_RecordsLastRunFailed_WithTheExceptionTypeOnly_AndRethrows()   // LoadAppCustomersAsync throws InvalidOperationException("secret") → Outcome "failed", ExceptionType "InvalidOperationException", AbortReason null (message never stored), Result null; the exception propagates
[Fact] public async Task SyncAsync_DryRun_NeverTouchesLastRun()   // LastRun stays whatever it was (null on a fresh instance)
[Fact] public void StartedUtc_IsSetOnConstruction()
```
Implementation: `StartedUtc { get; } = DateTime.UtcNow;` `LastRun`, `LastSuccessfulRunUtc` with private setters (reference/struct assignments — no lock needed; one run at a time by construction of the background loop, and a concurrent manual run simply records last). The public `SyncAsync(options, ct)` becomes a thin wrapper: `var started = DateTime.UtcNow; try { var result = await RunAsync(options, ct); if (!options.DryRun) Record(started, options, result, exception: null); return result; } catch (Exception ex) when (!options.DryRun && ex is not OperationCanceledException) { Record(started, options, result: null, ex); throw; }` where `RunAsync` is today's body renamed (private). `Record` builds `CustomerSyncLastRun` per §3.5: Outcome `"failed"` when `exception != null`, `"aborted"` when `result.Aborted`, else `"ok"` (and then `LastSuccessfulRunUtc = finished`); `Source = result?.Source ?? CustomerSyncSources.Resolve(_configuration)`; `ExceptionType = ex.GetType().Name` only. Cancellation during shutdown is not a "failed" run — hence the `when` filter. One Information log line per record: outcome, trigger, source, elapsed; no PII. Run the full gate here (end of Batch C).
Commit: `feat(customer-sync): keep the last non-dry run in memory so an aborted guard is visible from the app`

---

## 8. Batch D — diagnostics and documentation (after Batch C; D1→D1b→D2→D3 serial on the controller, D4 and D5 parallel to them)

### D1 — `CustomerSyncDiagnosticsController` takes over `POST run` with the new options; one "production-like" gate
`needs-serial` (chain D) · write-set: `API/Controllers/CustomerSyncDiagnosticsController.cs`, `API/Controllers/DiagnosticsEnvironmentGate.cs`, `API/Controllers/DiagnosticsController.cs`, `TEST/ControllerAuthorizationTests.cs`, `TEST/Controllers/DiagnosticsControllerAppAccessTests.cs`, `TEST/Controllers/CustomerSyncDiagnosticsControllerTests.cs`, `TEST/Controllers/DiagnosticsEnvironmentGateTests.cs`

Tests (new file; `CustomerSyncService` is concrete and resolves everything from a scope, so build it exactly as `CustomerSyncServiceTests` does with a stub source):
```csharp
[Fact] public async Task Run_SourceOverrideWithoutDryRun_Returns400()
[Fact] public async Task Run_AbortedResult_Returns409_WithTheResultBody()        // stub source returns Failed(...) → ObjectResult 409, body is CustomerSyncResult with Aborted true
[Fact] public async Task Run_DryRun_Returns200_WithDryRunTrue()
[Fact] public void Controller_IsAdminOnly()                                       // AuthorizeAttribute with Policy "AdminOnly"
// DiagnosticsEnvironmentGateTests (v2, Mentor change 4)
[Theory] [InlineData("Development", false)] [InlineData("Dev", false)] [InlineData("QA", false)] [InlineData("Production", true)] [InlineData("Staging", true)] [InlineData("", true)]
public void IsProductionLike_OnlyTheThreeNonProdNamesAreOpen(string environmentName, bool expected)   // Mock<IWebHostEnvironment>.EnvironmentName
```
Implementation: class per §3.5; constructor `(CustomerSyncService sync, ICustomerSyncRepository repository, ICustomerSyncSourceFactory sources, CtrmCustomerReader customerReader, IWebHostEnvironment env, IConfiguration config, ILogger<CustomerSyncDiagnosticsController> logger)`; `[HttpPost("run")] public async Task<IActionResult> Run([FromQuery] bool dryRun = false, [FromQuery] bool force = false, [FromQuery] string? source = null, [FromQuery] DateTime? discoveryFrom = null, CancellationToken cancellationToken = default)` → `if (source is not null && !dryRun) return BadRequest(new { Error = "source may only be overridden on a dry run (dryRun=true)." });` → `var result = await _sync.SyncAsync(new CustomerSyncOptions { DryRun = dryRun, Force = force, SourceOverride = source, DiscoveryFrom = discoveryFrom, Trigger = "manual" }, cancellationToken); return result.Aborted ? StatusCode(StatusCodes.Status409Conflict, result) : Ok(result);`. Keep the XML remark from the old route (no env gate; PROD recovery uses it; AdminOnly). Create `DiagnosticsEnvironmentGate` per §3.5. In `DiagnosticsController`: delete the `customer-sync/run` action, the `CustomerSyncService` field/ctor parameter and its `using` if now unused; **(v2, Mentor change 4)** replace the body of the private `DenyIfProduction()` with `=> DiagnosticsEnvironmentGate.IsProductionLike(_env) ? NotFound() : null;` so the two controllers share one definition of "production-like" (the v1 plan left a second copy in place; two definitions drift); `DenyIfNotDevelopment()` is a stricter, different gate — leave it. `ControllerAuthorizationTests.AllControllerTypes`: add `yield return new object[] { typeof(CustomerSyncDiagnosticsController) };` in alphabetical position. `DiagnosticsControllerAppAccessTests.CreateSut`: drop the `CustomerSyncService` argument.
Commit: `feat(diagnostics): customer-sync diagnostics controller — run with dryRun/force/source/discoveryFrom; one production-like gate`

### D1b — `GET last-run` (v2, Mentor change 2 / D14)
`needs-serial` (chain D, between D1 and D2 — same controller file) · write-set: `API/Controllers/CustomerSyncDiagnosticsController.cs`, `TEST/Controllers/CustomerSyncDiagnosticsControllerTests.cs`

Tests:
```csharp
[Fact] public async Task LastRun_BeforeAnyRun_Returns200_WithNullLastRun_AndTheProcessStart()   // body.LastRun null, ProcessStartedUtc == sync.StartedUtc, Stale true (no success yet)
[Fact] public async Task LastRun_AfterAnAbortedRun_ReportsTheAbortCode()                          // drive sync.SyncAsync with a Failed stub first → body.LastRun.Outcome "aborted", AbortCode CUSTOMER_SYNC_NO_PERMISSION, Trigger "manual"
[Fact] public async Task LastRun_AfterASuccessfulRun_IsNotStale()
[Fact] public void LastRun_HasNoEnvironmentGate()   // env "Production" → still OkObjectResult (same posture as run: PROD is where this matters)
```
Implementation: `[HttpGet("last-run")] public IActionResult LastRun()` → `var now = DateTime.UtcNow; return Ok(new { ProcessStartedUtc = _sync.StartedUtc, NowUtc = now, _sync.LastSuccessfulRunUtc, Stale = _sync.LastSuccessfulRunUtc is not { } ok || now - ok > TimeSpan.FromHours(26), _sync.LastRun });` — 26 h = one daily schedule plus slack; the threshold is a constant with a comment, not a config key (nothing else would read it). No PII is possible: `CustomerSyncLastRun` holds codes, counters and a type name. XML remark: "null `LastRun` right after a deploy is normal — the startup sync runs 60 s after boot; `Stale: true` with a non-null aborted `LastRun` is the signal the playbook (D4) asks for."
Commit: `feat(diagnostics): expose the customer sync's last run so a tripped guard is visible without KQL`

### D2 — `CustomerSyncComparer` (pure) + `GET compare`
`needs-serial` (chain D) · `hard` · write-set: `INF/Sync/CustomerSyncComparer.cs`, `API/Controllers/CustomerSyncDiagnosticsController.cs`, `TEST/Services/CustomerSyncComparerTests.cs`, `TEST/Controllers/CustomerSyncDiagnosticsControllerTests.cs`

Tests:
```csharp
// comparer — identity is ScoularId (trimmed, OrdinalIgnoreCase) because the CTRM side may carry placeholder ids
[Fact] public void Compare_CountsCustomersAndLinksInBoth_OnlyOds_OnlyCtrm_WithCappedSamples()
// ods rows: (1,"1085",code A),(1,"2200",A),(2,"1085",B); ctrm rows: (1,"1085",A),(3,"9000",C) with app customers 1→A,2→B,3→C → Customers InBoth 1, OnlyInOds 1 (B), OnlyInCtrm 1 (C); Links InBoth 1, OnlyInOds 2, OnlyInCtrm 1; samples "B", "C", "A|2200", "B|1085", "C|9000"; 30 only-in-ods codes → SampleOnlyInOds.Count == 25
[Fact] public void Compare_FieldDiffs_CountOnlyCustomersInBoth_AfterTrim()   // Name "Smith Farms" vs "Smith Farms " → no diff; Phone differs → Fields["Phone"].Differs 1, Compared 1
[Fact] public void Compare_CtrmFailed_ReportsTheSideAsNotOk_WithPermission_AndSkipsDiffs()   // Failed(...NO_PERMISSION) with Lookup.Permission "missing" → Ctrm.Ok false, CustomerPermission "missing", Customers/Links diffs zero, Fields empty
[Fact] public void Compare_NullTradeUnitRows_CountAsCustomersNotLinks()
// controller
[Fact] public async Task Compare_InProductionLikeEnvironment_Returns404()   // env "Production" → NotFoundResult
[Fact] public async Task Compare_RunsBothSourcesAsDryRun_AndReturnsTheComparison()   // stub factory serves two stub sources; assert ctrm source received DryRun true and the response is CustomerSyncComparison
```
Implementation: `Compare` builds `codeById` from `appState.Customers` (minted placeholders `< 0` take their code from the ctrm row's attributes applied to a scratch `Customer`); customer sets = distinct codes of rows; link sets = `"{CODE}|{TU}"` for non-null TUs; field diffs by applying each side's first attributes per code to two fresh `Customer` instances. Controller: `[HttpGet("compare")]` → `if (DiagnosticsEnvironmentGate.IsProductionLike(_env)) return NotFound();` → app state via `_repository.LoadAppCustomersAsync/LoadAppTradeUnitsAsync` → `ods = await _sources.Create("ods").LoadAsync(app, new() { DryRun = true }, ct)` and `ctrm = await _sources.Create("ctrm").LoadAsync(app, new() { DryRun = true, DiscoveryFrom = discoveryFrom }, ct)` **sequentially** — the shared scoped `OriginationDbContext` is not safe for concurrent use; concurrent use of it broke PROD on 2026-09-29, which is why `GetOpenActivityTradeUnitsAsync` also runs its two reads one after the other (dossier §2.4, inlined) → `Ok(CustomerSyncComparer.Compare(ods, ctrm, app, DateTime.UtcNow))`. Wrap each side in try/catch producing `Failed(side, "CUSTOMER_SYNC_SOURCE_UNAVAILABLE", ex.GetType().Name)` so an ODS outage still yields the CTRM half. Log one line with counts only.
Commit: `feat(diagnostics): ODS-vs-CTRM customer and trade-unit diff report (Dev/QA, no PII)`

### D3 — `GET ctrm-probe`
`needs-serial` (chain D) · write-set: `API/Controllers/CustomerSyncDiagnosticsController.cs`, `TEST/Controllers/CustomerSyncDiagnosticsControllerTests.cs`

Tests: `Probe_InProductionLikeEnvironment_Returns404`; `Probe_ReturnsPermissionStatusAndConfiguredFlags` (fake client answering Unauthorized → body `Permission == "missing"`, `Configured` from `ICtrmGraphQlClient.IsConfigured`, `Source == CustomerSyncSources.Resolve(config)`).
Implementation: `[HttpGet("ctrm-probe")] Probe([FromQuery] string? sourceCode = null, ct)` → gate → `var r = await _customerReader.ProbeAsync(sourceCode?.Trim(), ct);` → `Ok(new { Configured = <ICtrmGraphQlClient>.IsConfigured, Source = CustomerSyncSources.Resolve(_config), Status = r.Status.ToString(), r.HttpStatus, r.ErrorCode, r.Detail, Permission = r.Value?.Permission ?? CtrmCustomerReader.DescribePermission(r), r.Value?.TotalCount, r.Value?.ProjectionAccepted, r.Value?.SampleFound, r.Value?.IdKind, Note = "Permission 'missing' means Customers.Read.All (or ReadCustomersBasic) is not granted to this client id; the nightly sync on Source=ctrm aborts with CUSTOMER_SYNC_NO_PERMISSION until it is. IdKind is the JSON type of customers.id on the sample row — record it in the app-context doc on the first successful probe (see the plan's §10)." })`. Inject `ICtrmGraphQlClient` into the controller for `IsConfigured` (constructor grows by one; update the tests' SUT builder). (v2: `IdKind` added so the first Dev probe after the permission lands records what `customers.id` is, per D5.)
Commit: `feat(diagnostics): customers permission and projection probe`

### D4 — Playbook and Shared Infrastructure updates
`safe-parallel` · write-set: `docs/operations/OUTAGE-RECOVERY-PLAYBOOK.md`, `docs/application-context/Shared Infrastructure.md`

Playbook edits (exact spots): §2 first bullet — replace "and it has **no guard against an empty or partial view**" with "since 2026-10 it refuses to run when the source is empty or would deactivate more than `CustomerSync:MaxDeactivationCount` (500) rows or `CustomerSync:MaxDeactivationPercent` (5 %) of the active customers or links (log code `CUSTOMER_SYNC_GUARD_TRIPPED` / `CUSTOMER_SYNC_SOURCE_EMPTY`, nothing written); the restart risk is now a *stale* list, not an empty one"; C2 — add "and check for aborted runs": **first** `GET /api/diagnostics/customer-sync/last-run` (AdminOnly, works in PROD; `Stale: true` or `LastRun.Outcome: "aborted"` is the signal — v2), then the KQL `traces | where customDimensions.ErrorCode in ("CUSTOMER_SYNC_GUARD_TRIPPED","CUSTOMER_SYNC_SOURCE_EMPTY","CUSTOMER_SYNC_NO_PERMISSION","CUSTOMER_SYNC_SOURCE_UNAVAILABLE") | project timestamp, message` for history, and the recovery `POST /api/diagnostics/customer-sync/run?dryRun=true` first, then `?force=true` only when the deactivation really is legitimate; §G — add a row "Customers from CTRM (`CustomerSync:Source=ctrm`)" with the fallback `CustomerSync__Source=ods`; Known gaps — strike the empty-source bullet, reword "no persisted last-run record" to "last-run record is in memory only (lost on restart); no persisted history". Shared Infrastructure edits: line 128 table row (view "drives the sync when `CustomerSync:Source` is not `ctrm`"), line 136 last sentence (access check now reads `dbo.CustomerTradeUnit`), line 150 (synced "from ODS or CTRM per `CustomerSync:Source`"), line 199 (`ValidateCustomerAccessAsync` row).
Commit: `docs(operations): customer sync guard, abort codes, last-run route and the CTRM source in the playbook and shared-infrastructure doc`

### D5 — CTRM data-source app-context doc
`safe-parallel` · write-set: `docs/application-context/CTRM GraphQL Data Source.md`

Add a section `## Customers from CTRM (sync, 2026-10)` after "Known gaps" covering: the switch (`CustomerSync:Source`, per run, rollback setting), the feeder algorithm (D2 of this plan in prose: existing links re-asserted, 7-day discovery window of unfiltered contracts/tickets, append-only links until the pairs query lands), the master lookup (aliased `sourceCode`, 20 per request, canonical-row rule), minting (`dbo.CustomerIdSequence`, band 5e15, ODS adoption by `ScoularId`, and — v2 — that the band and the adoption are permanent once a minted id carries notes in PROD: a one-way door), onboarding dedupe by `ScoularId` (D13, v2), the guard (defaults, `force`), dry run and `source` override, the diagnostics routes (`run`, `last-run`, `compare`, `ctrm-probe`), Stage 1 field mapping and the untouched columns, the deviation table from §2 of this plan (copy it), and a placeholder line "`customers.id` is a <IdKind> — recorded <date> from the first Dev probe" to be filled in when the permission lands (v2). Reword the "ODS by design, on both sources" bullet: "customer master (`dbo.Customer`, filled nightly by the customer sync from ODS or CTRM per `CustomerSync:Source`)". Under "Known gaps (waiting on the API team)" add the requested customer fields/filters/pairs query with the 2026-10-05 date (the list in D3). Add a `Files:` line listing `INF/Sync/*`, `INF/Ctrm/CtrmCustomerReader.cs`, `INF/Ctrm/CtrmCustomerActivityReader.cs`, `INF/Ctrm/CtrmCustomerQueries.cs`, `API/Controllers/CustomerSyncDiagnosticsController.cs`, `API/Controllers/DiagnosticsEnvironmentGate.cs`.
Commit: `docs(app-context): customers from CTRM — switch, feeder, minting, guard, diagnostics`

---

## 9. Batch E — Stage 2, every task `blocked-on-api` (do NOT dispatch until the named dependency is confirmed in Dev via `GET /api/diagnostics/customer-sync/ctrm-probe`)

Priority with the API team (v2, from the Mentor's Q3): E7 and E8 are the relief valves for the nightly ~840-request load on the PROD gateway and should be raised **before** E1; E6 is the parity path if §11 Q1 turns out badly.

### E1 — Extended fields + NOP id from GraphQL
`blocked-on-api`: Customer fields `merchandisingEmail, extendedPrimaryPhone, supplementalEmail, extendedAddressLine1, extendedAddressLine2, extendedAddressLine3, extendedAddressLine4, extendedCity, extendedStateProvince, extendedPostalCode, extendedCountry, nopidNo` · `needs-serial` · write-set: `INF/Ctrm/Dtos/CtrmCustomerDtos.cs`, `INF/Ctrm/CtrmCustomerQueries.cs`, `INF/Sync/CustomerSyncAttributes.cs`, `API/appsettings.json`, `TEST/Services/CustomerSyncAttributesTests.cs`, `TEST/Repositories/CtrmCustomerQueriesTests.cs`
Design: new knob `CustomerSync:CtrmExtendedFields` (bool, default false); `CtrmCustomerQueries.CustomerProjection(bool extended)` appends `ExtendedProjection = "merchandisingEmail extendedPrimaryPhone supplementalEmail extendedAddressLine1 extendedAddressLine2 extendedAddressLine3 extendedAddressLine4 extendedCity extendedStateProvince extendedPostalCode extendedCountry nopidNo"`; `CtrmCustomerSyncAttributes(dto, bool extended)` applies the twelve more columns when `extended` (NOP through `OdsValues.NormaliseNopId`), `UntouchedColumns` shrinks to `["EffectiveStartDate","EffectiveEndDate"]` in extended mode. Tests: projection tripwire for both modes; `ApplyTo` extended sets `Email`/`ExtendedCity`/`NopIdNumber`; non-extended still leaves them untouched. The flag exists because the field names cannot be probed (introspection is HC0046): flip it in Dev, watch `ctrm-probe.ProjectionAccepted`. This knob is the one Stage 2 toggle that stays (D15).

### E2 — ACH badge from `paymentMethod`
`blocked-on-api`: Customer field `paymentMethod` · `needs-serial` · write-set: `INF/Data/Entities/Customer.cs`, `INF/Data/ApplicationDbContext.cs`, `INF/Data/Migrations/<ts>_AddCustomerPaymentMethod.cs` + `.Designer.cs`, `INF/Data/Migrations/ApplicationDbContextModelSnapshot.cs`, `scripts/_VerifySchema.sql`, `INF/Ctrm/Dtos/CtrmCustomerDtos.cs`, `INF/Ctrm/CtrmCustomerQueries.cs`, `INF/Sync/CustomerSyncAttributes.cs`, `INF/Repositories/CustomerRepository.cs`, `TEST/CustomerAchTests.cs`, `TEST/Repositories/CustomerRepositoryTradeUnitsTests.cs`
Design: `dbo.Customer.PaymentMethod nvarchar(10) NULL` (idempotent `IF COL_LENGTH('dbo.Customer','PaymentMethod') IS NULL ALTER TABLE … ADD`), `_VerifySchema` column row; projection gains `paymentMethod` behind `CtrmExtendedFields`; `EnrichCustomersWithAchAsync` reads `dbo.Customer.PaymentMethod` through `IsAchPaymentMethod` when `CustomerSyncSources.Resolve(config) == "ctrm"` (inject `IConfiguration` into `CustomerRepository`), else today's `base.Customer` read. `GetByIdAsync` stays un-enriched (as today). No What's New (same badge). Tests: migration pending-model check; repository test proving the ctrm branch never touches `OriginationDbContext`.

### E3 — Add-customer search via GraphQL
`blocked-on-api`: filter `industryCode1` on `customers` AND Customer field `duplicateYN` (the view parity needs `IsDuplicate = 0`; without the filter a `nameContains` page of 500 is filtered client-side, which is acceptable only once `duplicateYN` exists) · `needs-serial` · `hard` · write-set: `INF/Ctrm/CtrmCustomerQueries.cs`, `INF/Ctrm/CtrmCustomerReader.cs`, `INF/Interfaces/ICustomerRepository.cs`, `INF/Repositories/CustomerRepository.cs`, `INF/Repositories/CustomerOnboardingSearchSwitch.cs` (new), `INF/DependencyInjection.cs`, `TEST/Repositories/CustomerOnboardingSearchTests.cs`
Design: `CtrmCustomerReader.SearchAsync(string nameContains, string? exactSourceCode, CancellationToken)` → `customers(skip: 0, take: 500, nameContains: $name, industryCode1: "PR")` plus, when the term looks like a code (`^[A-Z0-9]{3,7}$`), one `sourceCode:` alias; in-memory: `CtrmCustomerFilters.IsInScope`, `duplicateYN != "Y"`, every search word must appear in `name` (today's multi-word AND), cap 50, order by name; drop codes already in `dbo.Customer` by `ScoularId` **and** id (A8 already does both on the ODS path; E3 re-routes A8's `QueryOnboardingCandidatesAsync` seam to CTRM and keeps the dedupe step as is). `ICustomerRepository.SearchOdsAsync` is renamed in meaning only (keep the name; XML doc "onboarding search, source per `CustomerSync:Source`") and routed by a `CustomerOnboardingSearchSwitch` reading `CustomerSync:Source` per call (same shape as `ContractRepositorySwitch`). Results for not-yet-onboarded candidates carry `Id = 0` and `ScoularId`. AR-04's 3-character floor and PII rule unchanged.

### E4 — Onboard by `ScoularId` (client + server)
`blocked-on-api`: transitively on E3 · `needs-serial` · write-set: `API/Models/Requests/AssignTradeUnitsRequest.cs`, `API/Controllers/CustomersController.cs`, `API/Services/CustomerService.cs`, `API/Services/ICustomerService.cs`, `INF/Interfaces/ICustomerRepository.cs`, `INF/Repositories/CustomerRepository.cs`, `client/src/app/core/services/api.service.ts`, `client/src/app/features/customers/components/edit-customer-dialog/edit-customer-dialog.component.ts`, `client/src/app/models/customer.model.ts`, `TEST/Controllers/CustomersControllerTests.cs`, `client/src/app/core/services/api.service.spec.ts`
Design: `AssignTradeUnitsRequest` gains `string? ScoularId`; `PUT /customers/0/trade-units` with a `ScoularId` → `AssignTradeUnitsAsync(0, codes, scoularId, user)`: look up the master row (CTRM: `GetBySourceCodesAsync([code])`; ODS: by `SourceCustomerId` in `base.vw_CurrentCustomers`) through A9's `LoadOnboardingCandidateAsync` seam, mint an id via `ReserveCustomerIdsAsync(1)` on the CTRM path, insert `IsManual = true`. Builds on A9's `AssignTradeUnitsOutcome` (the adopted/minted id already travels back) and A10's client handling (the client already follows the returned id, so `customer.id === 0` needs no new client plumbing beyond sending `scoularId`). Client: `assignTradeUnits(customerId, codes, scoularId?)`; the dialog sends `scoularId` when `customer.id === 0`. vitest spec for the request body; What's New item folded into E5's entry.

### E5 — What's New + docs for the user-visible Stage 2 changes
`blocked-on-api`: E2 and E3 shipped in the same deploy · `safe-parallel` · write-set: `API/Content/whats-new.json`, `docs/application-context/CTRM GraphQL Data Source.md`, `docs/application-context/Customer Home Page.md`
One entry (one deploy, one entry): "Add-a-customer search and the ACH badge now come from CTRM"; group `Producers`, kinds `changed`. `WhatsNewControllerTests` validates the file.

### E6 — Exact link parity via the customer↔tradeUnit pairs query
`blocked-on-api`: the requested "customer to tradeUnit pairs" query (name and arguments unknown) · `needs-serial` · `hard` · write-set: `INF/Ctrm/CtrmCustomerQueries.cs`, `INF/Ctrm/CtrmCustomerActivityReader.cs`, `INF/Sync/CtrmCustomerSyncSource.cs`, `API/appsettings.json`, `TEST/Services/CtrmCustomerSyncSourceTests.cs`, `TEST/Repositories/CtrmCustomerActivityReaderTests.cs`
Design: new knob `CustomerSync:LinkStrategy` = `appendOnly` (default, today's D2) | `pairs`; with `pairs`, rows come from the pairs query for every known code (and discovery remains only for new-producer detection) and link deactivation regains ODS parity (deviation D-1 closes). The guard still applies. Projection and arguments are filled in from the API team's delivery; the tripwire test for the document is written then. **Sunset (v2, D15):** `LinkStrategy` is a migration aid, not a feature. Once `pairs` has run in PROD for one release with `compare` clean and no guard trips attributable to it, the next release deletes the `appendOnly` code path in `CtrmCustomerSyncSource`, the `LinkStrategy` key and its `"// LinkStrategy"` prose, and the discovery reader shrinks to new-producer detection; the knob's prose must state this sunset from the day it is added, and the deletion PR is listed as E6b in the dispatch summary.

### E7 — Batch lookup through `sourceCodes: [String!]`
`blocked-on-api`: confirmation that `customers(sourceCodes:)` exists (probe it with one request in Dev before writing code) · `needs-serial` · write-set: `INF/Ctrm/CtrmCustomerQueries.cs`, `INF/Ctrm/CtrmCustomerReader.cs`, `API/appsettings.json`, `TEST/Repositories/CtrmCustomerReaderTests.cs`
Design: knob `CustomerSync:CustomerLookupStrategy` = `aliased` (default) | `sourceCodes`; the latter sends `customers(skip, take: 500, sourceCodes: $codes)` paged per 500-code chunk, same fail-closed rules, ~34 requests instead of ~840. **Sunset (v2, D15):** same rule as E6 — one PROD release after `sourceCodes` is verified (lookup counts equal, no `CUSTOMER_SYNC_SCHEMA_MISMATCH`), delete the aliased builder `CustomersBySourceCodesAliased`, its chunking path in `CtrmCustomerReader`, the `CustomerLookupStrategy` key and prose (E7b). `CustomerAliasCount` goes with it.

### E8 — Incremental master refresh with a last-changed filter
`blocked-on-api`: a `lastChangedUtcFrom`-style filter on `customers` · `needs-serial` · write-set: `INF/Ctrm/CtrmCustomerReader.cs`, `INF/Sync/CtrmCustomerSyncSource.cs`, `TEST/Services/CtrmCustomerSyncSourceTests.cs`
Design: nightly runs fetch only customers changed since the last successful run (needs a persisted watermark — the playbook's "persisted last-run record" gap; a `dbo.CustomerSyncRun` table would be introduced here, with migration and `_VerifySchema` rows, superseding the in-memory `LastRun` of D14), full lookup weekly. Optimisation only; not needed for correctness.

---

## 10. Dispatch summary

| Batch | Tasks | Parallelism | Gate before next batch |
|---|---|---|---|
| A | A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 (10) | all parallel; A5 and A7 after A2's commit (DTO dependency); A8→A9 serial (same file); A10 client-only | targeted tests green (+ the A10 vitest spec and client build) |
| B | B1a-c, B2a-c, B3a-b, B4 (9) | four chains in parallel | `has-pending-model-changes` clean (B3a); targeted tests |
| C | C1 C2 C3 C4a C4b C5 C6 (7) | strictly serial | full `dotnet test GrainOriginatorPortal.sln --filter "Category!=Integration"` at C6 |
| D | D1 D1b D2 D3 (serial) ∥ D4 D5 (6) | two lanes | full gate at D3; docs proof-read |
| E | E1–E8 (+ E6b/E7b sunset deletions) | — | each `blocked-on-api`; not dispatched |

Stage 1 total: 32 tasks (v1 had 27; v2 added A8, A9, A10, C6, D1b); Stage 2: 8 blocked tasks plus the two sunset deletions.

**Acceptance check in Dev after D3 (user-run, nothing automated):** `GET /api/diagnostics/customer-sync/ctrm-probe` → expect `Permission: "missing"` today; `GET /api/diagnostics/customer-sync/compare` → ODS half populated, CTRM half `Ok: false, CustomerPermission: "missing"`, discovery half populated; `POST /api/diagnostics/customer-sync/run?dryRun=true` → `Source: "ods"`, counters, `DryRun: true`, nothing written; `GET /api/diagnostics/customer-sync/last-run` → `LastRun` describes the startup run (`Trigger: "startup"`, `Outcome: "ok"`), `Stale: false`; onboarding: search for a producer already in `dbo.Customer` and confirm it is absent from the add-a-customer results (A8); `PUT /customers/<unknown ODS id>/trade-units` for a producer whose `ScoularId` is already held returns the existing customer and inserts no row (A9).

**When `Customers.Read.All` lands in Dev (v2, before anything else on `ctrm`):** (1) `ctrm-probe?sourceCode=<known code>` → `Permission: "granted"`, `ProjectionAccepted: true`, `SampleFound: true`; **record `IdKind` and whether `id` is stable across two probes a day apart in `CTRM GraphQL Data Source.md` (D5's placeholder line)** — this is the evidence that `customers.id` is not a substitute for the minted band; (2) `compare` → read `Fields` to settle §11 Q3 (`name` vs `merchandisingName`) and `Customers.OnlyInOds/OnlyInCtrm`; (3) `run?dryRun=true&source=ctrm` → counters and `Guard` not tripped; (4) only then flip Dev (§11 Q5).

**Before the first PROD `ctrm` run (v2, the one-way door):** §11 Q7 answered in writing (adoption by `ScoularId` on the ODS path is accepted as permanent, or the flip-back is declared a non-goal); `compare` run **weekly in Dev/QA for at least four weeks** with `Links.OnlyInCtrm` recorded each time — a growing count is the empirical answer to §11 Q1 (D-1) and the trigger to prioritise E6; §11 Q8 confirmed; the producer count re-counted per environment; `last-run` checked in QA after at least one scheduled `ctrm` night.

**Before the first `ctrm` run in each environment (added 2026-10-06, hand-off 3 — user-run):**
1. `SELECT COUNT(*) FROM dbo.CustomerTradeUnit WHERE DATALENGTH(TradeUnit) <> DATALENGTH(LTRIM(RTRIM(TradeUnit)));` — record the count (the rows the stored-spelling rule protects); and `SELECT CustomerId, LTRIM(RTRIM(TradeUnit)) AS Unit, COUNT(*) FROM dbo.CustomerTradeUnit GROUP BY CustomerId, LTRIM(RTRIM(TradeUnit)) HAVING COUNT(*) > 1;` — must return 0 rows.
2. ODS: `SELECT COUNT(*) FROM base.vw_CurrentCustomers WHERE IsActive = 0;` — see §11 Q10.
3. `POST …/run?dryRun=true&source=ctrm`: `ManualCustomersDeactivated` must be 0 and `ManualCustomersRefreshed + ManualCustomersReactivated` must equal the manual-customer count; any deactivation means a manual producer's code is absent from the CTRM master — list those codes before flipping.
4. The app's managed identity has UPDATE on `dbo.CustomerIdSequence` (§11 Q11).

## 11. Candidate questions for the user (non-blocking for Stage 1 unless marked)

1. **Contract `IsActive` semantics (affects deviation D-1).** The plan assumes ODS `base.Contract.IsActive = 1` is an ETL "current row" flag, so links are effectively append-only. If it is a business flag that flips (and the business expects a producer to leave a trade unit when it does), E6 (pairs query) becomes the parity path and should be prioritised with the API team. The one-shot acceptance check cannot answer this; the weekly `compare` series in §10 can.
2. **Guard defaults** 5 % / 500 rows for both customers and links — acceptable? Appendix C of the playbook has no PROD baseline for "typical daily deactivations"; a first PROD week on `ods` will show the real number in the `CustomerSync Customer diff` log line and in `last-run`.
3. **`name` vs `merchandisingName`.** Which GraphQL field equals ODS `CustomerName`? The compare report counts differences for `Name`; if `merchandisingName` turns out to be the match, D10 changes one line.
4. **Ticket discovery includes cancelled and consolidated tickets** (view parity). Prefer excluding them (cleaner links, small deviation)?
5. **Flipping Dev.** When `Customers.Read.All` lands: App Service setting `CustomerSync__Source=ctrm` on Dev, or commit it in `appsettings.Dev.json`? The plan leaves every env file at `""`.
6. **`sourceSystem` filter.** Do CTRM-origin customers carry a specific `sourceSystem` value we should pin (`CustomerSync:CtrmSourceSystem`), or is `sourceCode` alone unambiguous?
7. **Minted-id adoption on the ODS path (C3; tie-break active-first-then-lowest-id, matching A9/D13 — corrected 2026-10-06 per the C3 review) — BLOCKING before the first PROD `ctrm` run (v2).** C3 changes the ODS sync's matching rule for the first time (id, then `ScoularId` for minted rows only), and A9 does the same for onboarding. Once a minted id carries notes in PROD, these adoptions are what make `CustomerSync__Source=ods` a safe rollback; they, and the band `[5e15, 6e15)`, are then permanent. Confirm this is wanted rather than treating the switch as one-way; the answer is recorded in the app-context doc (D5) before the PROD flip.
8. **`ScoularId` ≡ `sourceCode` (v2, new).** C3, A8/A9 and the comparer all key on `dbo.Customer.ScoularId` matching GraphQL `sourceCode` (and, for onboarding, `base.vw_CurrentCustomers.ScoularId` matching `vw_CustomerTradeUnits.SourceCustomerId`). The repo maps the view's `SourceCustomerId` column to `ScoularId` (`OriginationDbContext.cs:65`) and the contract reader already treats `customerId` as "one namespace" with `ScoularId`; confirm on the first Dev probe (`SampleFound: true` for a code taken from `dbo.Customer.ScoularId`) — if it fails, every adoption key in this plan is wrong at once.

10. **Inactive customers in the ODS manual-refresh view (added 2026-10-06, hand-off 3).** If `base.vw_CurrentCustomers` never holds `IsActive = 0` rows, the ODS manual refresh never kept an inactive producer, and the CTRM keep-rule for found-but-out-of-scope manual customers must exclude `reason == "inactive"` (one line: `if (customer.IsManual && reason != "inactive")`) before the flip. If it does hold them, parity is as implemented.
11. **Sequence permission (added 2026-10-06, B3 review).** The App Service managed identity needs UPDATE on `dbo.CustomerIdSequence` before the first non-dry `ctrm` run that mints an id, in each environment (`db_datawriter` does not cover sequences). BLOCKING for that run only.

---

## Mentor review (2026-10-06)

**Verdict:** proceed with changes. Q1 (do it at all): yes — customers are the last ODS dependency, the nightly ODS job's failure mode is already in the outage playbook, and discovery is justified because without it new producers are invisible the moment `Source=ctrm` is flipped. Q2 (shape): the view-shaped source abstraction is the most durable choice; four adjustments required. Q3 (silent commitments): a permanent id convention plus `ScoularId` adoption (a one-way door disguised as reversible), a behaviour change on the existing ODS sync, nightly PROD-gateway load, D-1 undetectable by the one-shot check, and an ephemeral evidence trail. Verified sound and unchanged: fail-closed permission handling (D4), the guard rules (D7), band placement (D5), dry-run/source override (D8), the Stage 1 field-mapping tripwire (D10), diagnostics kept out of `DiagnosticsController` (D11).

**What changed in this revision (v2), and why:**

| Mentor item | Change in the plan |
|---|---|
| Change 1 (must) — double-onboard hole opened by minting | New **D13**. New Stage 1 tasks **A8** (onboarding search also excludes by `ScoularId`; `needs-serial` chain A8→A9; write-set `INF/Repositories/CustomerRepository.cs`, `TEST/Repositories/CustomerRepositoryOnboardingTests.cs`), **A9** (`AssignTradeUnitsAsync` adopts an existing row by `ScoularId` before inserting and returns the adopted id through the new `AssignTradeUnitsOutcome` record; `hard`; write-set adds `INF/Abstractions/CustomerResults.cs`, `INF/Interfaces/ICustomerRepository.cs`, `API/Services/ICustomerService.cs`, `API/Services/CustomerService.cs`, `API/Controllers/CustomersController.cs`, `TEST/Services/CustomerServiceTests.cs`, `TEST/Controllers/CustomersControllerTests.cs`) and **A10** (`safe-parallel`, client only: `home.component.ts` follows the returned id via the pure helper `adopt-assigned-customer.ts` + spec). Three tasks rather than the Mentor's one because the controller re-reads the customer by the requested id and the client writes details under it — server-side adoption alone would move the split from `dbo.Customer` to the details tables. Two `protected virtual` seams on `CustomerRepository` make the ODS SQL testable on the InMemory provider; E3/E4 re-route the same seams later. Placed in Batch A (nothing else in Stage 1 touches these files). |
| Change 2 (should) — make a guard abort observable | New **D14**, in-memory option chosen (orchestrator). `CustomerSyncOptions.Trigger` added to §3.5 and threaded through C2; new **C6** (serial, last in Batch C, write-set `API/Services/CustomerSyncService.cs`, `TEST/Services/CustomerSyncServiceTests.cs`): the singleton service records `LastRun` / `LastSuccessfulRunUtc` for every non-dry run including exceptions; new **D1b** (chain D, between D1 and D2, write-set the controller + its tests): `GET api/diagnostics/customer-sync/last-run`, AdminOnly, no environment gate, with `Stale` (no success in 26 h). Batch C's full gate moved from C5 to C6. D4's playbook text now names `last-run` as the first check; A6's guard prose and D5's route list mention it. No table, no alert rule. |
| Change 3 (should) — strategy knobs as replacements | New **D15**; E6 and E7 now carry an explicit sunset (old path + knob deleted one PROD release after the new path is verified; E6b/E7b listed in §10), `API/appsettings.json` added to their write-sets so the knob prose states the sunset from day one; E1's `CtrmExtendedFields` recorded as the one toggle that stays. |
| Change 4 (minor) — one definition of "production-like" | Folded into **D1**: `DiagnosticsController.DenyIfProduction()` now delegates to `DiagnosticsEnvironmentGate.IsProductionLike`; `TEST/Controllers/DiagnosticsEnvironmentGateTests.cs` added to D1's write-set; D11 and §3.5 updated. |
| Q3 — one-way door | D5 says so explicitly; §11 Q7 is now marked blocking before the first PROD `ctrm` run; §10 gained a "Before the first PROD `ctrm` run" checklist (Q7 in writing, four weekly `compare` runs watching `Links.OnlyInCtrm`, Q8, re-count) and a "When `Customers.Read.All` lands" checklist whose first step records `customers.id` type/stability. `CtrmCustomerProbe.IdKind` added (§3.4, B1c, D3) so the probe can report it without exposing a value; D5's doc gets a placeholder line for it. New §11 **Q8** records the `ScoularId` ≡ `sourceCode` assumption every adoption key depends on. |
| Q3 — ODS sync behaviour change / gateway load | D7 notes the ODS-side behaviour change; Batch E header states E7/E8 are prioritised with the API team over E1. |
| Q3 — evidence trail | The dossier now lives at `agents-docs/plans/customers-from-graphql-dossier_2026-10-06.md`; the header and every "dossier §n" citation point there. Inlined where used: the view's two WHERE clauses (D2), the confirmed 2026-10-05 Customer field list and the requested-but-missing list (D3), the `"// Key"` prose convention (A6), the 2026-09-29 concurrent-`OriginationDbContext` incident behind the sequential `compare` (D2 task), the `ValueGeneratedNever` and `ValidateCustomerAccessAsync` facts (D5, D9). The 16.7k figure is flagged as a planning-session count to re-verify. |
| Orchestrator — commit trailer | Every commit now ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (§4); the earlier Fable trailer is gone from the plan. |

Totals moved from 27 to 32 Stage 1 tasks. No frozen contract from v1 was removed; additions are `CustomerSyncOptions.Trigger`, `CustomerSyncService.StartedUtc/LastRun/LastSuccessfulRunUtc`, `CustomerSyncLastRun`, `CtrmCustomerProbe.IdKind`, `AssignTradeUnitsOutcome`, the two `CustomerRepository` seams, `applyAdoptedCustomerId`, and the `GET last-run` route.
