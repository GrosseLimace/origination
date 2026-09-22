# Authorization & Trade-Unit Model

## TL;DR

**Trade-unit entitlements are a UX filter, not an access boundary.**

Any authenticated Scoular user can read or mutate any customer's records via the Origination API. Trade-unit selection narrows the *default* result set in the UI but does not restrict what an authenticated user is permitted to see or change.

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

## How authorization is actually expressed (and what it deliberately is NOT)

Authorization here is **two Azure AD app roles plus data scoping** — there is no roles/permissions
table, no `resource:action:scope` permission strings, no `IPermissionService`, and no
`GET /api/me/permissions`. The style guide's enterprise permissions model prescribes all of those;
this app deliberately doesn't have them, and that is not an oversight:

- The real authorization surface is nearly binary — "may you open the Usage Dashboard" (the `Admin`
  app role, granted by the *Origination App {Env} Super Users* group) and "how much of it do you
  see" (the `UsageDashboard:ViewAll` config list). Everything else is trade-unit **data scoping**,
  which is a tenancy filter, not a role.
- Adding the table model would mean maintaining a second source of truth beside Azure AD group
  membership, which is where access is actually administered.

Two consequences worth stating plainly, so a scan flagging them gets triaged rather than re-fixed:

- **No in-app audit trail of role changes.** `Admin` membership lives in an Azure AD group and the
  `ViewAll` list lives in `appsettings`, so neither is ever mutated through app code and
  `role_assigned` / `role_removed` events can't exist in our telemetry. That history is in Azure
  AD's own audit log and in config/deployment history. `SecurityAuditMiddleware` plus
  `AuthorizationAuditResultHandler` do cover the one event type we can emit: 401/403 outcomes.
- **`/api/me` appends a synthetic `UsageDashboardViewAll` role.** It is presentational only — it
  tells the SPA whether to render the manager dropdown. The server never trusts it back;
  `UsageDashboardService` re-derives scope from config on every request, so forging it client-side
  changes a menu and nothing else.

Revisit if the role surface stops being near-binary — more than a handful of distinct roles, or
any need to grant a permission to someone who isn't in the corresponding AAD group.

## Relevant code

- [api/GrainOriginatorPortal.Api/Filters/EnforceTradeUnitAccessAttribute.cs](../../api/GrainOriginatorPortal.Api/Filters/EnforceTradeUnitAccessAttribute.cs) — the trade-unit filter (UX scoping; fail-CLOSED on an uncached outage).
- [api/GrainOriginatorPortal.Api/Services/UserEntitlementService.cs](../../api/GrainOriginatorPortal.Api/Services/UserEntitlementService.cs) — `ValidateCustomerAccessAsync` lives here.
- [api/GrainOriginatorPortal.Api/Controllers/CustomersController.cs](../../api/GrainOriginatorPortal.Api/Controllers/CustomersController.cs) — example of a controller where the GETs intentionally skip the check.
