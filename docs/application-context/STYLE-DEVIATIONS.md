# Deliberate deviations from the style guides

Places where this codebase knowingly does something the Scoular style guides say not to, with the
reason. **These are not defects and not accepted *risks*** — security acceptances live in
[SECURITY-REVIEWS/ACCEPTED-RISKS.md](../../SECURITY-REVIEWS/ACCEPTED-RISKS.md) and the
authorization model in [SECURITY-MODEL.md](./SECURITY-MODEL.md). This page exists because audits
and style-guide scans re-surface each of these, and without a written reason the next person either
"fixes" a deliberate choice or re-litigates it from scratch.

Each entry says what would make it worth revisiting. If you change one, update the entry in the
same commit.

Most entries were recorded 2026-09-21 from the Code Quality Dashboard pilot audit (PR #613), and
their finding ids are that tracker's. The [permissions model](#permissions-model) entries were added
2026-11-06 with Phase 1 of the
[modular architecture plan](../../agents-docs/plans/plan-modular-architecture.md), and cite the
section of `permissions-model.md` they depart from.

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

### `CustomerTradeUnit → Customer` used `Cascade` while nine sibling FKs use `NoAction` — RESOLVED 2026-10-13
`sql.customertradeunit-cascade-delete-breaks-pattern`

No longer a deviation. The premise that the rows were sync-rebuilt stopped being true once
`PUT /api/customers/{id}/trade-units` went live and started inserting hand-curated rows; production
held 22,491 of them when checked on 2026-10-13, with this the only `CASCADE` among the ten FKs into
`Customer`. Migration `RestrictCustomerTradeUnitDeleteAndValidateCustomerFks` changes it to
`NoAction` to match its siblings. The same migration validates the three FKs that were added
`WITH NOCHECK` in May 2026 (Notes, ProducerDetails, ProducerPlantingIntentions): production had zero
orphan rows behind any of them, so validation turns on with nothing to clean up.

---

## API shape and organisation

### Folders by module, not by layer
`csharp.md` "Project Structure" and "Adding New Features" · `Api/Platform`, `Api/Modules/<Module>`,
`Infrastructure/Platform`, `Infrastructure/Modules/<Module>`

The guide puts each layer in one folder per project: `Api/Controllers`, `Api/Services`,
`Infrastructure/Repositories` and so on. From Phase 2 of the
[modular architecture plan](../../agents-docs/plans/plan-modular-architecture.md) (2026-11-07), each
project is organised by module first and by layer inside the module: `Api/Modules/Producers/Controllers`,
`Infrastructure/Modules/Producers/Repositories`. Shared code sits under `Platform`. The point of the
work is that a feature is added or removed in one place. With layer folders, a producer change touches
six sibling directories that each mix producer and shared files, and a reviewer can't see at a glance
whether a change crosses a module boundary.

The guide's real constraints still hold: two projects, `Api → Infrastructure`, mapping in services,
entities in Infrastructure. Two kinds of test keep the module boundaries:
- `ModuleBoundaryTests` (ArchUnitNET) checks which module may depend on which. A module uses only the modules it
  builds on, and never their repositories. It may join their entities, since every module shares one DbContext.
  Platform uses no module at all.
- `ControllerAuthorizationTests` requires every controller to sit in Platform or a module, and to name its
  permissions.

Since 2026-11-08 nothing is left in the old layer folders. Platform is organised by area the same way
(`Api/Platform/Identity`, `Preferences`, `ReferenceData`, `Telemetry`, `Ctrm` and so on), with one exception:
the DbContexts and their migrations stay in `Infrastructure/Data`, because moving them would rewrite every
generated migration for no change at run time.

**Revisit if:** a module gets its own team or its own deployment. Then lift its folders into a project
of its own (`GrainOriginatorPortal.Modules.Producers`), which the boundary tests make a mechanical move.

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

## Permissions model

How the model works is in [SECURITY-MODEL.md](./SECURITY-MODEL.md). These are the places it
departs from `permissions-model.md`.

### Role assignments come from the token, not a `UserRoles` table
`permissions-model.md` §5.1.4, §6.3, §10.1

Who holds which role is administered in the company's entitlements app, and the roles arrive as
claims on the access token. `ClaimsUserRoleSource` reads them, and this app keeps no user-to-role
table. A table of our own would be a second place to assign roles, beside the one IT already
administers, and the two would drift.

So this app never assigns a role, and it can't log `role_assigned`, `role_removed` or
`privilege_escalation`. That history is in the entitlements app; until it issues this app's roles,
`Admin` still comes from the *Origination App {Env} Super Users* group, whose history is in Entra's
audit log. A role change reaches the API with the user's next access token, roughly 60–90 minutes
with Entra's defaults.

**Revisit if:** the entitlements app can't carry this app's roles, or removing someone's access
can't wait for their token to expire.

### Resources are business-level, not one per entity
`permissions-model.md` §4.2 ("must correspond to a real entity")

The 42 permissions cover 27 resources, each a thing a user would name: `planting-intentions`,
`bid-sheets`, `saved-lists`. They aren't one per table. Per-table resources would roughly double
the permissions, their grants would always move together, and the grants would be harder to read.

**Revisit if:** a role needs part of a resource, such as one of its tables but not another.

### Flat grants, with no role inheritance
`permissions-model.md` §3.4, §5.1.1 (`ParentRoleId`)

Every grant is its own row, role to permission, and there are no wildcard grants such as `*:read`.
`dbo.Roles` has no `ParentRoleId`: the guide's column was created unused and dropped by the
`AddAccessAuditColumns` migration, so nobody can set it expecting inheritance.

Roles combine instead. A user holds a persona role, which decides what they see, plus add-on roles
such as `Editor` and `Manager`, which decide what they may do with it. Their permissions are the
union. A `Viewer ⊂ Editor ⊂ Manager` ladder can't express "a trader who edits" beside "an
originator who only reads"; the union can. Forgetting an add-on fails safe: the user is read-only.

The cost is repetition: a new read permission's grant migration adds a row to every persona role.

**Revisit if:** there are enough roles that those repeated rows start to drift.

### One `write` action instead of `create`, `update` and `delete`
`permissions-model.md` §4.2, §4.3

The guide allows a custom action when its standard set doesn't fit. Here, no role may add a record
without also being allowed to change and remove it, so the three permissions would always be granted
together. `write` covers all three. The other actions are `read`, and `manage` for IT's operational
powers (diagnostics, re-running the customer sync, usage exclusions). The one separate delete is
`bid-sheet-locations:delete:global`: a manager may remove a location someone else created.

**Revisit if:** a role needs to add without editing, or edit without deleting.

### A permission's key is its own string, not a Guid
`permissions-model.md` §5.1.2, §5.1.3

`dbo.Permissions.Id` is the permission itself (`notes:write`), and `RolePermissions.PermissionId`
references it. The catalog lives in code (`AppPermissions`), and `dbo.Permissions` is generated
from it through EF `HasData`. A Guid would be a second identity to keep stable across environments.
The string is already unique, and it reads as itself in grants, logs and the access map. Roles keep
the guide's Guid ids.

**Revisit if:** permissions need renaming in place. Today a rename is a new permission plus a grant
migration.

### Audit columns follow the SQL guide, and grant rows have no `Modified` columns
`permissions-model.md` §5.1.1, §5.1.3; `sql.md` (Audit Columns)

The two guides disagree: §5.1.1 gives `Roles` a `CreatedAt` and an `UpdatedAt`, and `sql.md` puts
`CreatedAt`, `CreatedBy`, `ModifiedAt` and `ModifiedBy` on every table. The access tables follow
`sql.md`, as the rest of this database does:

- **`Roles` and `Permissions`** have all four. `ModifiedAt` and `ModifiedBy` stay null until the row
  changes. A `HasData` change to a permission updates only the changed columns, so a migration that
  edits a permission should set them too.
- **`RolePermissions` and `RoleSegments`** have `CreatedAt` and `CreatedBy` but no `Modified`
  columns. A grant is added or removed, never edited, so they would always be null. Both are SQL
  temporal tables, and their history tables record when each grant was removed.

They are `datetime2(3)` and `nvarchar(256)` rather than `sql.md`'s `datetime2` and `nvarchar(100)`:
a UPN can be longer than 100 characters. There is no `RowVersion`: until the grant editor (Phase 1b)
nothing edits these rows.

**Revisit if:** the grant editor needs to stop two people editing the same role at once (add a
`RowVersion` to `Roles`), or "who removed a grant" has to come from the database rather than the
editor's `role_modified` log.

### A temporary default role for anyone without a persona role
`permissions-model.md` §2.3 (deny by default)

Until the entitlements app issues persona roles, a signed-in person whose token carries none gets
`Access:DefaultRoles`: `Originator` + `Editor`. Each use is logged once per user per hour, and
app-only tokens never get it. Today that is everyone, and it reproduces what a non-admin could do
before permissions arrived, so nobody lost access in the switch.

**Revisit:** this has to go (`DefaultRoles: []`) before traders launch. Otherwise a trader whose
roles lag behind, or a token issued during an entitlements outage, would silently get producer
access and edit rights.

### No Access Denied page
`permissions-model.md` §8.3, §8.4

`permissionGuard` is a `canMatch` guard, not the guide's `canActivate`. A route the user may not
open doesn't match, so it falls through to the catch-all and lands on the home page, and its code
is never downloaded. The usage dashboard behaved this way before permissions. It is the only gated
screen, and its menu item shows only to people who hold the permission, so an Access Denied page
would only be seen by someone typing the URL.

**Revisit if:** people start following shared links to screens their colleagues can't open.

### Permissions load at startup without blocking it, and don't refresh
`permissions-model.md` §8.4 (load in `APP_INITIALIZER`; refresh on role change)

`PermissionService` starts its load once MSAL has settled, not in an app initializer. Blocking
would hold the first screen on an API call, and during a sign-in redirect there is no account to
load for yet. Nothing decides on the empty set held while loading: `permissionGuard` waits for the
load, and `*appHasPermission` re-renders when it lands.

Permissions are read once per page load. Roles change only with a new access token, and this app
assigns none, so nothing in the app could trigger a refresh. The API enforces a grant change
within about five minutes; the SPA shows it on the next reload.

**Revisit if:** the grant editor (Phase 1b) should update its user's own screen at once, or people
keep the app open for days.

### The SPA's `PermissionService` follows the API's names
`permissions-model.md` §8.1, §8.2

The guide's sample is `PermissionsService` with `hasPermission` and `hasAnyPermission`. Here it is
`PermissionService`, matching the API's `IPermissionService`, with `has` and `hasAll`. A list
passed to `*appHasPermission` likewise means all of them. Every control so far needs all of its
permissions: assigning a team list needs both `saved-lists:read:team` and `saved-lists:write:team`.
The permission ids are typed (`PermissionId`, generated from `AppPermissions`), not bare strings.

**Revisit if:** a control should show for either of two permissions. Add `hasAny` then.

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
