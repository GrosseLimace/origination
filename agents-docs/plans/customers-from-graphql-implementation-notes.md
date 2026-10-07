# customers-from-graphql — implementation notes carried between tasks

Orchestrator-owned. Facts and constraints learned during implementation that a later task's
implementer must honour. Each entry names its source.

## For C1 (source: independent review of B4, 2026-10-06 — verdict PASS)

1. Load the tracked app state (`LoadAppCustomersAsync`, `LoadAppTradeUnitsAsync`) BEFORE calling
   `source.LoadAsync`, and pass the very same list instances in `CustomerSyncAppState` (no copies).
2. Keep `GroupBy(CustomerId).First()` on `result.Rows` for customer-level attributes (row order is
   preserved by the ODS source); updates via `row.Attributes.ApplyTo(existing)`, inserts via
   `CreateNew(id)` (sets IsManual=false, IsActive=true). Today's insert is `ToCustomer()` then
   `IsActive = true`; verify both produce the same field set, incl. `Id`, before deleting `ToCustomer`.
3. Trade-unit passes: filter `!string.IsNullOrEmpty(row.TradeUnit)`, key on the RAW string, never
   trim and never `IsNullOrWhiteSpace`. The ODS source passes the view value verbatim ("" and null
   both mean customer-presence-only); only the CTRM source trims.
4. Manual-producer pass: recompute `appCustomers.Where(c => c.IsManual && !rowCustomerIds.Contains(c.Id))`
   AFTER the upsert pass, as today. In `ManualMaster` → ApplyTo + reactivate if inactive. Absent AND
   `ManualMasterComplete` AND active → deactivate. `ManualMasterComplete == false` → never deactivate
   a manual customer. `ManualUnverifiable` ids are never refreshed or deactivated. Do not iterate
   `ManualMaster` as the set.
5. ODS source read failures throw and must keep propagating. Only `Ok == false` is an aborted source;
   abort before any pass and before `SaveChanges`.
6. Resolve the factory from the run's scope (`scope.ServiceProvider`), never in the singleton's
   constructor. Select by `CustomerSyncSources.Resolve(configuration)`, or by `SourceOverride` only
   when `DryRun` is true.
7. The ODS path must produce zero behaviour change; existing CustomerSyncService expectations unchanged.
8. Small follow-ups worth folding in when the file is open: add tests for a null / "" ODS TradeUnit
   (presence-only, no trade-unit row) and for duplicate master ids throwing (ToDictionary, today's
   behaviour).

## For C4a / C5 (source: same review)

- C5: register `ICustomerSyncSourceFactory`/`CustomerSyncSourceFactory` and `OdsCustomerSyncSource`
  (and the CTRM source) as SCOPED. The factory resolves sources from the IServiceProvider it was
  created from; singleton or root resolution breaks scope validation or captures the root.
- C4a: replace the placeholder (`CustomerSyncSourceFactory.cs` returns the ODS source for any name)
  and add a test that "ctrm" does NOT return the ODS source.
- `CustomerSyncSourceRow.cs` comment says "blank values are skipped" — only null and "" are; reword
  to "null or empty" when that file is next touched.

## Decisions taken during Batch B (hand-off 3 / triage), with knock-ons for later tasks

- **Adoption is add-only (A9, hand-off 3, 2026-10-06).** E4's adoption branch inherits the same rule.
- **Discovery window guard is > 3661 days (B2, triage RESOLVABLE).** C4b's `to = today + 1` is deliberate;
  the 3660 in the Detail text refers to the configured window. C4b should log a Warning when the configured
  window exceeds 366 days (B2 review advisory) and must log `CUSTOMER_SYNC_DISCOVERY_FAILED` for discovery
  PartialSuccess and failure (B2 does not log page failures itself).
- **Customer lookup fails the whole read on a sourceCode mismatch (B1, hand-off 3).** New code
  `CUSTOMER_SYNC_FILTER_MISMATCH` (Error), `CtrmCustomerReader.FilterMismatchCode`.
  - §3.2: add it to the code list.
  - C4a failure mapping gains a FIRST branch: `lookup.ErrorCode == CtrmCustomerReader.FilterMismatchCode`
    → FailureCode `CUSTOMER_SYNC_FILTER_MISMATCH` (then permission → NO_PERMISSION, server timeout →
    SOURCE_UNAVAILABLE, QueryError+400 → SCHEMA_MISMATCH, else SOURCE_UNAVAILABLE). Test
    `LoadAsync_LookupFilterMismatch_ReturnsFailedFilterMismatch` (foreign sourceCode → Ok false, that
    FailureCode, Rows empty, Lookup.Permission "unknown").
  - D4 playbook KQL: add the code to the `ErrorCode in (...)` list.
- **HC0045 server timeouts are SOURCE_UNAVAILABLE, not SCHEMA_MISMATCH (B1 triage RESOLVABLE).** Check
  `CtrmServerTimeoutRetry.IsServerTimeout(result)` before the QueryError+400 branch, in B1 and in C4a.
- **B3 migration guard is `@liveMax >= 5999999999999999`** (fix-1 37c5cec1); the plan's literal said 6e15.
- **Sequence permission (user Q9).** The app identity needs UPDATE on dbo.CustomerIdSequence before the first
  non-dry CTRM mint in each environment. D4/D5 docs should name this prerequisite.
- **Profisee customer `id` is a GUID string in the API team's examples**, so PickCanonical's ordinal IdText
  tie-break is a stable order; revisit only if the first Dev probe reports IdKind "Number".

## From the C1–C3 review (PASS)

- Plan §7 C3 says "lowest id"; the implemented and correct rule is active-first-then-lowest-id (D13/A9).
  Reconcile the plan text at wrap-up.
- D1 must ship with C2: until `POST run?force=true` exists, the only recovery from a tripped guard is
  raising `CustomerSync:MaxDeactivationPercent` / `MaxDeactivationCount` via App Service settings. The D4
  playbook must document both.
- Early abort returns leave `ElapsedMs` / `CompletedAtUtc` unset (cosmetic; diagnostics only).
- An abort logs at Error twice (service + background service) by design; D4 alert guidance should key on one.
- ODS-path log wording changed: "loaded N rows from source ods", "grouped N distinct customers from the
  source"; "CustomerSync starting" now carries source/trigger/dryRun/force. No dependents found in the repo.

## E7 unblocked by measurement (2026-10-06 PM, ctrm-capabilities on the nonprod client)

- `customers` arguments that exist: skip, take, sourceCode, sourceSystem, code, nameContains, sourceCodes, codes. NOT present: industryCode1, sourceCodeContains, any changed-since argument.
- All 14 requested Customer fields now exist (E1 extended fields + nopidNo, E2 paymentMethod, duplicateYN) — 37 fields total.
- Timings (single requests, apiqa): `sourceCodes` 20 codes 6.9 s, 100 codes 5.2 s, all matched; 500 codes rejected by VALIDATION: "The filter is too long for the Profisee endpoint (7987 encoded characters, limit 7000) … The limit is on the length of the rendered filter, not on the number of values". nameContains "FARM": 4.1 s, totalCount 35,272 (all customers, not producers only).
- The aliased one-code-per-alias lookup measured ~27 s per 20 codes with HC0045 timeouts and a 500 at chunk 25 of 840 (first compare run) — unusable at 16.8k producers.
- **Orchestrator decisions (deviation from plan E7, evidence above):** (1) `CustomerSync:CustomerLookupStrategy` defaults to `sourceCodes`, with `aliased` the fallback until the E7b sunset; (2) chunks are sized by an estimate of the rendered filter length, not by a fixed 500: estimated length = Σ(len(code) + 9) (the measured 500 seven-char codes ≈ 7,987 encoded chars ⇒ ~16 per code), budget `CustomerSync:SourceCodesMaxFilterChars` default 6000 (margin under 7,000) and at most `CustomerSync:SourceCodesMaxPerRequest` 400 codes; a VALIDATION "too long" answer still fails the read closed and names the knob to lower.

## E1/E2 review (2026-10-07, PASS WITH FINDINGS)

- E1 `3124e2c5`: extended projection (12 fields + paymentMethod) behind `CustomerSync:CtrmExtendedFields` (default false; flag-off requests are byte-identical to before). The lookup records which projection it used and the sync applies attributes from that recorded value. E2 `d65f1846`: `dbo.Customer.PaymentMethod` nvarchar(10) NULL (migration `20261007133856_AddCustomerPaymentMethod`, idempotent), `[JsonIgnore]`; ACH reads it on `ctrm`, live `base.Customer` otherwise.
- Findings folded into the CTRM doc checklist items 7–10: flip CtrmExtendedFields with/before Source=ctrm (else no ACH badge on ctrm); verify GraphQL uses `H` for ACH; compare extended-field non-null counts before the flip (blank GraphQL values overwrite ODS-era ones); migrations before code (every dbo.Customer read selects PaymentMethod).
- Not done (optional): per-run counts of non-null / over-length PaymentMethod values; extend `compare` to diff the extended fields when the CTRM side ran extended.
