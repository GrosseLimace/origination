# Authorization & Trade-Unit Model

## TL;DR

Two separate questions, answered separately:

- **What may this user do?** Permissions: roles from the token, each role's `resource:action[:scope]` grants in our database, and the permission each endpoint names. See [Permissions](#permissions-what-a-user-may-do) below.
- **Which customers?** Trade units, and that answer is **a UX filter, not an access boundary.**

Any authenticated Scoular user can read or mutate any customer's records via the Origination API. Trade-unit selection narrows the *default* result set in the UI but does not restrict what an authenticated user is permitted to see or change. (Once every endpoint names a permission, "any authenticated user" becomes "any user whose roles grant that kind of record". Trade units still won't narrow which customers.)

This is intentional. Originators routinely cross trade units (e.g., search by name, follow a referral, edit notes on a producer outside their region), and a hard access boundary at the trade-unit level was creating false-positive blocks during legitimate workflows.

## What this means in practice

- `GET /api/customers/{id}`, `GET /api/customers/by-source/{sourceId}`, and `GET /api/customers/linked-to/{sourceId}` return any customer regardless of the caller's entitled trade units.
- All customer-bound read endpoints behave the same way: contracts, tickets, notes, planting intentions, producer details, stored grain, and pricing lines.
- Mutation endpoints (`PUT /api/customers/{id}`, all `NotesController` writes, `PlantingIntentionsController` writes, `ProducerDetailsController` writes) deliberately omit `ValidateCustomerAccessAsync`. See PR #239 (`fix_StorageLoadAndEntitlementsErrors`) for the change and the rationale.
- The `[EnforceTradeUnitAccess]` filter **fails CLOSED** on an entitlement-database outage. This page used to say it failed open; that stopped being true once `UserEntitlementService` gained its last-known-good cache. Current behaviour, in order: serve the cached entitlement set when a recent successful fetch exists (so reads stay correctly filtered through a transient blip), and only when there is no cache, return **503** rather than an unfiltered read. Pinned by `UserEntitlementServiceTests` and `EnforceTradeUnitAccessFilterTests`.
- Where the filter recognises no trade-unit parameter on a decorated action — the id-only routes, which scope in the service layer instead — it now logs that once per action rather than silently applying nothing. That silent case is what produced H-061.

## Accepted-by-design security findings

The following findings (codex / static-analysis output) flag this model as a vulnerability. They are accepted by design under the current model and should not be re-opened without a change to the access policy:

- **H-034** — customer-scoped GET endpoints don't call `ValidateCustomerAccessAsync`.
- **H-036** — `GET /api/customers/{id}` and related endpoints don't call `ValidateCustomerAccessAsync`.
- **H-035** — `EnforceTradeUnitAccessAttribute` fails open on entitlement-DB outage for GET/HEAD.
  ⚠️ **No longer accepted-by-design — this one is FIXED.** The filter fails closed (see above). Triage
  a re-flag as already remediated, not as an accepted risk.

## When to revisit

If any of the following ever becomes true, **H-034 and H-036 re-open as real issues** (H-035 is
already fixed) and the codepaths above need to be tightened:

- Origination becomes multi-tenant (non-Scoular accounts gain access).
- Compliance or legal requires per-user customer scoping.
- Customer data grows to include classifications (PII tiers, embargoed accounts) that not every authenticated user should see.

The fix in that case:
- Require `ValidateCustomerAccessAsync` (or a stricter equivalent) on every customer-bound read endpoint, resolving the parent customer first for endpoints that take an indirect identifier (`sourceContractId`, `scoularId`, etc.).
- ~~Replace the `await next(); return;` outage path in `EnforceTradeUnitAccessAttribute` with a 503/403, or fall back to a trusted cached entitlement set.~~ **Already done** — both halves, in fact: the cached fallback *and* the 503 when there's no cache.
- Constrain linked-producer traversal so the bidirectional logic doesn't surface customers outside the caller's allowed scope.

## Permissions: what a user may do

Since 2026-11-06 (Phase 1 of the [modular architecture plan](../../agents-docs/plans/plan-modular-architecture.md)),
authorization follows the company permissions model. It replaces the earlier model of two Azure AD
app roles, no permissions table, with access administered through AAD group membership. Three
sources, each with one job:

- **The token says which roles a user holds.** `ClaimsUserRoleSource` reads the role claims on the
  access token. Roles are assigned in the company's entitlements app, which lets each app define its
  own roles, and this app keeps no user-to-role table. Until the entitlements app issues this app's
  roles, `Admin` still comes from the *Origination App {Env} Super Users* group. A token role with no
  `dbo.Roles` row grants nothing, and is logged.
- **Our database says what each role may do.** `dbo.RolePermissions` holds role → permission, and
  `dbo.RoleSegments` holds role → customer segment. Every grant is its own row: no wildcards, no
  inheritance. Grants change through migrations until the grant editor ships (Phase 1b).
- **The code names the permissions.** `AppPermissions` is the catalog: 42 `resource:action[:scope]`
  strings, such as `notes:write` and `saved-lists:read:team`. `dbo.Permissions` is generated from it.
  A new permission reaches nobody until a migration grants it.

Where this departs from the style guide, and why, is in
[STYLE-DEVIATIONS.md](./STYLE-DEVIATIONS.md#permissions-model).

### Roles

Roles only add: a user's permissions are the union of their roles' grants. A **persona** role
decides what you see, and an **add-on** role decides what you may do with it.

| Role | Kind | Holds | Segments |
|---|---|---|---|
| `Admin` | Base (system) | Every permission. In production it's meant for a break-glass account only; a production request carrying it logs a security warning, once per user per hour. | all |
| `Originator` | Persona | The reads originators use, plus personal writes (preferences, your own saved lists, reminders) | `Producer` |
| `Support` | Persona, for IT | Every read and personal writes, plus IT's operational powers: diagnostics, the customer sync, usage exclusions, the BarChart feed, the grant editor, the usage dashboard. No business-data writes. | all |
| `Editor` | Add-on | Every shared business-data write | none |
| `Manager` | Add-on | The usage dashboard, team saved lists, and removing other people's bid-sheet locations | none |
| `Origination.Application` | Machine | `bid-feed:manage`, for the BarChart pipeline | none |

**The default role.** Until the entitlements app issues persona roles, a signed-in person whose
token carries none gets `Access:DefaultRoles`: `Originator` + `Editor`. That is exactly what a
non-admin could do before permissions arrived. Today that's everyone; `Admin` holders also keep
everything, since `Admin` holds every permission. Each use is logged once per user per hour, and
app-only tokens never get defaults. **It must be emptied before traders launch**, or a trader whose
roles lag behind would silently get producer access and edit rights.

### What is checked today

`[RequirePermission(AppPermissions.X)]` on a controller or action checks a permission. Each
permission's policy also carries the default policy's requirements, so a permission check is never
weaker than "signed in". **Today it guards what used to need `Admin`, and every endpoint of the modules
Phase 2 has moved so far.** What used to need `Admin`:

| What | Permission |
|---|---|
| The usage dashboard | `usage-reports:read` |
| Usage exclusions | `usage-exclusions:manage` |
| Team saved lists: viewing them / assigning or changing another user's list | `saved-lists:read:team` / `saved-lists:write:team` |
| Removing a bid-sheet location someone else created (checked in `BidSheetService`; the creator may always remove their own) | `bid-sheet-locations:delete:global` |
| Diagnostics, and `GET /api/diagnostics/access-map` | `diagnostics:read`; the five diagnostics POSTs also need `diagnostics:manage` |
| Customer sync diagnostics | `customer-sync:manage` |
| BarChart ingest, by the pipeline or by a person re-running it | `bid-feed:manage` |

The modules moved so far, each controller with its read on the class and a write on each write action:

| Module | What | Read / write |
|---|---|---|
| Customers | Customers (the list, search, the onboarding search, by id and by code, a customer's trade units): viewing / assigning trade units, which also onboards a producer, and removing a dormant trade unit. Both needed only a sign-in before. | `customers:read` / `customers:write` |
| Customers | Customer sync diagnostics (listed above) | `customer-sync:manage` |
| Contracts | Contracts (the list, a customer's, by crop year) and pricing lines (by contract and by customer). They needed only a sign-in before. | `contracts:read` |
| Contracts | Delivery tickets (the list, today's for Spot Loads, a customer's, a customer's unapplied, a contract's applied). They needed only a sign-in before. | `tickets:read` |
| Producers | Planting intentions: viewing / adding, editing, retagging and deleting | `planting-intentions:read` / `:write` |
| Producers | Producer details, contacts, grain on farm and bin sites: viewing / saving and clearing | `producer-details:read` / `:write` |
| Producers | Incoming linked producers (`GET api/customers/linked-to/{id}`, now its own controller; it needed only a sign-in before) | `producer-details:read` |
| Producers | Stored grain; DP contracts | `stored-grain:read`; `dp-contracts:read` |
| Producers | Contract Pacing's prior-year contracts (`GET api/contracts/pacing/{customerId}`, now its own controller) | `contract-pacing:read` |
| Producers | Planting Dashboard estimates, market shares and actual harvest: viewing / saving, and deleting an actual harvest | `planting-estimates:read` / `:write` |
| Producers | Field plan (fields, seasons and records, confirming and reopening, and the 45Z documents): viewing / changing, uploading, archiving and restoring | `field-plans:read` / `:write` |
| Producers | The field plan's CTRM splits and T-DISC options | `field-plans:read` |
| Producers | The FD-CIC calculator, its scoring POST included (it stores nothing) | `carbon-intensity:read` |

`Originator` + `Editor`, which everyone holds through the default roles, grants all of these, so no
one has lost access. Only the SPA calls these endpoints, so no app-only caller needs a grant for them.

**Every endpoint that hasn't moved into a module yet still needs only a signed-in user**, as before.
Phase 2 moves one module at a time and puts a permission on every endpoint it moves.
`ControllerAuthorizationTests` fails on a controller in `Api/Modules/` or `Api/Platform/` that lacks a
read on the class or a write on any write action. Once every module has moved, that covers every
endpoint outside this exempt list:

- **Any signed-in user, by design:** `/api/me`, `/api/me/permissions`, `/api/version`, `/api/help`,
  `/api/whats-new`, `/api/clienttelemetry` (the browser's App Insights settings), and
  `POST /api/usage-dashboard/click-event`. They describe the caller or the app, or record the
  caller's own use of it.
- **No sign-in:** `/health/live` and `/health/ready`, the App Service probes.

There is no role check anywhere in code: no `RequireRole`, no `IsInRole`, and no role names.
`PermissionService` is the only code that reads roles.

### Denials, failures and timing

- **A missing permission** gets a 403 with code `AUTHZ_PERMISSION_DENIED`. Its `details` name each
  missing permission, never what the caller holds. `AuthorizationAuditResultHandler` writes the
  response and logs the same code with the permissions. Any other refusal gets the same envelope
  with code `AUTH_REQUIRED` (401) or `ACCESS_DENIED` (403), and that code in the log.
- **The grants fail closed.** Each instance caches every role's grants for about five minutes, with
  a last-known-good copy. With no copy at all, a permission check returns
  **503 `ACCESS_GRANTS_UNAVAILABLE`**, as do `/api/me/permissions` and the access map. An
  environment whose database lacks the grants migrations returns that 503 on every permission check.
- **How fast changes land.** A grant change reaches the API within about five minutes, and the SPA
  at its next page load. A role change waits for the user's next access token: roughly 60–90 minutes
  with Entra's defaults, unless their sessions are revoked.
- **What an environment grants** is visible at `GET /api/diagnostics/access-map`
  (`diagnostics:read`): every role's grants and segments, the default roles, and any permission no
  role holds or only `Admin` holds. Dev, QA and Prod each hold their own grants.

### The SPA hides; the API decides

The SPA loads `/api/me/permissions` once per page load. `permissionGuard` keeps a route from
matching, and `*appHasPermission` removes a control the user lacks. That is presentation only, and
the API's check is the boundary. Until the permissions load, and if the load fails, the SPA treats
the user as holding nothing. `forbiddenInterceptor` is the only place a 403 is shown, once.

### Segments

Each role's customer segments (`Producer`, `Commercial`) are granted and returned by
`/api/me/permissions`, but nothing filters customers by them yet. They come into use with the
trader work, and even then segment scope stays a UX filter, like trade units, unless the business
decides otherwise.

### Audit trail

- **Role assignments** are recorded where they're made: the entitlements app, and for today's
  `Admin`, Entra's audit log for the Super Users group. This app never assigns a role, so it can't
  emit `role_assigned` or `role_removed`.
- **Grants** are kept in `dbo.RolePermissions` and `dbo.RoleSegments`, which are SQL temporal
  tables, so "who held what, when" is a query. Today grants change only through reviewed
  migrations. The grant editor (Phase 1b) will log a `role_modified` event for every change.
- **Changing the two temporal tables.** Adding or renaming a column works with the `db_ddladmin`
  rights developers and the deploy identity hold: EF 10 does both without switching system
  versioning off. Anything that does switch it off needs CONTROL, which only the
  infrastructure-managed `db_owner` group has. That includes dropping either table, and so backing
  out `AddAccessGrants`. Before shipping any other change to these tables, check the
  `dotnet ef migrations script` output for `SYSTEM_VERSIONING = OFF`.
- **Decisions:** `SecurityAuditMiddleware` and `AuthorizationAuditResultHandler` log 401/403
  outcomes, including every `AUTHZ_PERMISSION_DENIED`.

### `/api/me`

`/api/me` reports the token's roles and the user id. The SPA no longer calls it, because
`/api/me/permissions` carries the same `userId`. Until 2026-10-09, `/api/me` also appended a
synthetic `UsageDashboardViewAll` role for the names in `dbo.UsageDashboardViewAllUsers`. That table
and the role behind it were retired when every dashboard user got the full manager dropdown.

## Relevant code

- [api/GrainOriginatorPortal.Api/Filters/EnforceTradeUnitAccessAttribute.cs](../../api/GrainOriginatorPortal.Api/Filters/EnforceTradeUnitAccessAttribute.cs) — the trade-unit filter (UX scoping; fail-CLOSED on an uncached outage).
- [api/GrainOriginatorPortal.Api/Services/UserEntitlementService.cs](../../api/GrainOriginatorPortal.Api/Services/UserEntitlementService.cs) — `ValidateCustomerAccessAsync` lives here.
- [api/GrainOriginatorPortal.Api/Modules/Customers/Controllers/CustomersController.cs](../../api/GrainOriginatorPortal.Api/Modules/Customers/Controllers/CustomersController.cs) — example of a controller where the GETs intentionally skip the check.
- [api/GrainOriginatorPortal.Infrastructure/Platform/Access/AppPermissions.cs](../../api/GrainOriginatorPortal.Infrastructure/Platform/Access/AppPermissions.cs) — the permission catalog.
- [api/GrainOriginatorPortal.Api/Platform/Access/](../../api/GrainOriginatorPortal.Api/Platform/Access/) — `ClaimsUserRoleSource`, `PermissionService`, the grant cache, `[RequirePermission]` and its handler, `/api/me/permissions` and the access map.
- [api/GrainOriginatorPortal.Api/Middleware/AuthorizationAuditResultHandler.cs](../../api/GrainOriginatorPortal.Api/Middleware/AuthorizationAuditResultHandler.cs) — the `AUTHZ_PERMISSION_DENIED` response and log.
- [client/src/app/core/access/](../../client/src/app/core/access/) — the SPA's `PermissionService`, `permissionGuard`, `*appHasPermission` and the generated permission ids.
