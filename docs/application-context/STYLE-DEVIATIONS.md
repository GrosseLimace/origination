# Deliberate deviations from the style guides

Places where this codebase knowingly does something the Scoular style guides say not to, with the
reason. **These are not defects and not accepted *risks*** — security acceptances live in
[SECURITY-REVIEWS/ACCEPTED-RISKS.md](../../SECURITY-REVIEWS/ACCEPTED-RISKS.md) and the
authorization model in [SECURITY-MODEL.md](./SECURITY-MODEL.md). This page exists because audits
and style-guide scans re-surface each of these, and without a written reason the next person either
"fixes" a deliberate choice or re-litigates it from scratch.

Each entry says what would make it worth revisiting. If you change one, update the entry in the
same commit.

Recorded 2026-09-21 from the Code Quality Dashboard pilot audit (PR #613), which flagged all of
these. Finding ids are that tracker's.

---

## Data model

### Y/N flags stored as `nvarchar(1)` rather than `bit`
`sql.yn-flags-as-nvarchar-not-bit` · `MbpLocationSynonym.PushNotificationsHidden`,
`.CashBidsHidden`, `ElevatorCache.OurFacility`

`MbpLocationSynonym` is a **faithful mirror of `TSCPRDLIB.MBPLOCSYN`**, the bid-portal/CTRM
location-synonym table, and it's reloaded wholesale from a periodic export of that table. Y/N
strings are the source system's shape. Converting on load would mean the mirror no longer matches
what it mirrors, and the re-runnable load script would need conversion logic that silently guesses
at anything that isn't exactly `Y`/`N`.

**Revisit if:** the load stops being a straight mirror, or we start writing these columns
ourselves. `ElevatorCache.OurFacility` is the weaker case of the three — it's our own cache table —
so if one gets converted, start there.

### String-typed primary keys
`sql.unjustified-string-primary-keys` · `ElevatorCache.ElevatorCode`,
`UserTradeUnitSnapshot(UserId, TradeUnitCode)`

The style guide wants surrogate keys. `ElevatorCache` is keyed on `ElevatorCode` because that *is*
the natural key from ODS and every lookup is by code — a surrogate would add a column nothing
queries on. `UserTradeUnitSnapshot`'s composite is the same story: the pair is the identity of the
row, and every read is "what does this user have in this trade unit".

**Revisit if:** either table gains child tables that would carry the string key as an FK, or the
codes stop being stable.

### `CustomerTradeUnit → Customer` uses `Cascade` while nine sibling FKs use `NoAction`
`sql.customertradeunit-cascade-delete-breaks-pattern`

⚠️ **This one is NOT settled — it's an open decision, listed here so it isn't mistaken for
accepted.** It's inert today because every `CustomerTradeUnit` row comes from the ODS sync, so a
cascade has nothing to destroy that wouldn't be rebuilt. `feature_NewCustomerTradeUnits` introduces
**manually curated** rows, and at that point a `Customer` rebuild silently deletes hand-entered
membership. Decide before that feature lands. Tracked in the audit fix tracker.

---

## API shape and organisation

### Certification ingest DTOs opt out of `JsonUnmappedMemberHandling.Disallow`
`api.unmapped-members-skipped` · `Models/Requests/OrganicCertificationIngestRequest.cs` and its
three nested records

`Program.cs` sets `UnmappedMemberHandling.Disallow` for the whole API as mass-assignment hardening
(security-guide.md §4.1). These four records carry
`[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]` and so ignore unknown fields instead
of rejecting the request.

The payload is produced by a third party from USDA data. Under the global rule, one new field added
on their side would make **every** nightly message 400 until we shipped a matching DTO — a feed that
fails closed on a harmless addition, with certification data silently not arriving meanwhile.

The hardening exists to stop a caller setting properties they should not. Nothing here binds to a
persistence type: these are inert records, and `OrganicCertificationIngestService` copies field by
field into the entity, so an unknown member is dropped rather than assigned. The BarChart ingest
endpoint hit the same problem and solved it by taking a raw `string` body, which costs it validation,
model binding and an OpenAPI schema; `Skip` keeps all three.

**The real cost of this trade is not mass assignment** (Caden Egr, review 2026-09-24). It is that a
**field-name change becomes silent data loss instead of a loud failure**. If the sender renames
`scopes` or `items`, the property binds as `null` — indistinguishable from a deliberate omission —
and under `Disallow` that same rename would have been a 400. Two things stand between us and it, and
both must survive any future edit here:

- `ApplyScopes` / `ApplyItems` treat **absent as "no information"** and leave the stored set alone,
  reporting `SCOPES_ABSENT` / `ITEMS_ABSENT`. Only an **explicit empty array** clears. An earlier
  version cleared before the null check, which would have deleted every stored crop on a typo and
  still returned `"accepted": true`.
- `OrganicCertificationPayloadContractTests` pins the expected field names, so a captured sample from
  the sender immediately shows any that do not bind.

**Who can reach it:** the policy is `RequireRole("Origination.Application", "Admin")`. That is the
integration's managed identity **and human Admins** — the Admin role is granted through the
*Origination App {Env} Super Users* group, so this is not a machine-only endpoint. Fine in itself,
but do not lean on "machines only" as part of a security argument; an earlier version of this entry
did, and it was wrong.

**Revisit if:** one of these records is ever bound to an EF entity or reused on a user-facing
endpoint — at that point the global rule should apply again and the opt-out must come off. Note the
contact-PII fields (`contactFirstName`, `contactLastName`, `phone`, `email`) are ignored *because* of
this attribute; under `Disallow` their presence would have been a hard error.

### DTOs declared inline in controllers
`dotnet.dtos-inline-in-controllers` · `EntitlementsController`, `MeController`

The convention is one record per file under `Models/Responses` (34 files follow it). These handful
are response shapes with exactly one consumer — the endpoint directly above them — and reading the
endpoint alongside its payload is genuinely easier than a file hop. Low-value either way.

**Revisit if:** a second caller appears, or the shape starts being reused.

### ~30 record types in one `UsageDashboardDtos.cs`
`dotnet.usage-dashboard-dtos-file-organization`

One file per type would mean ~30 files that are only ever opened together, for one feature. The
whole set changes as a unit when a dashboard panel changes.

**Revisit if:** these start being consumed outside the usage dashboard.

### Repository interfaces return `Task<List<T>>` rather than `Task<IReadOnlyList<T>>`
`dotnet.repository-interface-return-type-inconsistency`

16 interfaces use `List<T>`, 2 use `IReadOnlyList<T>`. The guide prefers the read-only form. This is
worth doing, but as one sweep rather than opportunistically — a half-converted set is more confusing
than a consistently "wrong" one, and every call site has to be checked for mutation.

**Revisit:** when someone has an hour for the whole set at once. Not before.

### Hand-rolled parameter validation instead of a request record
`dotnet.duplicated-param-validation` · `DashboardPlantingEstimatesController.ValidateDashboardParams`

Four GET actions share a private validator for `tradeUnitKey`/`plantingYear`. Everything else
validated in this app uses a request record with data annotations — but these are query-string GETs,
and binding a record for two scalars to get annotations is more ceremony than the duplication costs.

**Revisit if:** a fifth action needs it, or the rules grow past two parameters.

---

## SQL

### `SELECT c.*` in raw SQL
`sql.select-star-in-raw-sql` · `ContractRepository`, `CustomerRepository` (5 sites)

`FromSqlInterpolated` mapping onto a full entity, where the entity is the contract for the shape.
Naming every column is more robust to view drift, and `TicketRepository` does exactly that — but
these five sit in queries where the column list would be 40+ lines and the entity already fails
loudly if the view loses a column.

**Revisit if:** one of these breaks on an ODS view change. Then name the columns in that query.

### `ExecuteSqlRawAsync` built by interpolating a compile-time constant
`sql.executesqlraw-interpolated-constant` · `UsageRepository`

Matches the letter of "no string-interpolated SQL". The interpolated value is a `private const`, and
the actual runtime value (the retention cutoff) goes through the parameterised overload. No
injection path exists — the constant can't be influenced by a caller.

**Revisit if:** anything caller-supplied ever reaches that interpolation. Then it's a real finding.

### A migration's `Down()` does more than its `Up()`
`sql.migration-down-applies-unrelated-destructive-changes` · `20260311180519_AddNoteCustomerCode`

`Up()` adds a nullable column; `Down()` also widens two PKs from `int` to `bigint`. Genuinely
untidy. It's accepted because **we never roll back** — migrations go forward only, and the deploy
workflows only ever run `database update`. Rewriting the `Down()` of an applied migration is riskier
than leaving it.

**Revisit if:** a rollback procedure is ever introduced. Then audit every `Down()`, not just this one.

---

## Client

### `@it/design-system` (`scoular-*`) classes largely unused
`angular.design-system-classes-unused`

The shared UI kit hand-rolls Tailwind variant maps rather than emitting `scoular-btn`,
`scoular-card` and friends (4 uses total, all in one template). The package is installed. This app
standardised on the Tailwind **brand colour tokens** instead — see the brand-colour notes — which
gives the same palette with utility-class composition.

**Revisit if:** the design system becomes the org-wide contract for component markup, not just
colour.

### `CardFooterComponent` exported but unconsumed
`clean-slop.unused-card-footer-export`

Kept on purpose. It's one member of a five-part card family (card / header / title / content /
footer) whose other four are all used, and the sibling `DialogFooterComponent` is used in eight
files. Deleting only the card's footer leaves an asymmetric primitive set that the next person
adding a card footer re-creates. Six lines.

**Revisit:** never, really — or delete it if the team prefers strict no-dead-exports.

### Client-side retry applied at only two call sites
`error-handling.inconsistent-client-retry-coverage`

`bid-sheet` and `build-list` apply timeout/retry; the other ~90 `ApiService` call sites don't. Those
two wrap the genuinely slow ODS scans where a transient blip is both likely and worth re-trying.
Blanket retry everywhere would multiply load during an outage and delay the error the user needs to
see.

**Revisit if:** a typed error contract lands (see the audit tracker) — retry policy is much easier
to reason about once call sites can distinguish transient from permanent.

---

## Observability

### App Insights via codeless attach, with no SDK reference
`logging.api-insights-instrumentation-unverified`

No Application Insights / OpenTelemetry / Serilog package in the API. `developer-docs/CLAUDE.md`
documents this as intentional: App Service codeless attach picks up `ILogger` output via
`APPLICATIONINSIGHTS_CONNECTION_STRING`. The finding's real point is that nothing in the repo
*proves* the rich `BeginScope` fields (`ServiceName`, `Operation`, `TraceId`, `UserId`) surface as
queryable custom dimensions — which is a KQL question, not a code defect.

**Revisit:** worth one confirming query against Log Analytics; if the scope fields don't land, the
codeless decision needs revisiting rather than the code.

### Client-side telemetry absent
`logging.client-side-telemetry-missing` (critical) · `logging.bootstrap-failure-not-logged`

⚠️ **Open, NOT accepted.** Listed here only so it isn't mistaken for a deviation. The client has no
telemetry at all, and `developer-docs/CLAUDE.md:542` says client-side App Insights is *required* for
any Scoular Angular SPA using MSAL — so today the code and our own standard disagree. Every
unhandled Angular error, MSAL failure and bootstrap failure in production is invisible. Needs a
decision: add it, or amend the standard. Tracked in the audit fix tracker.
