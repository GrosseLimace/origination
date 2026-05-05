# Authorization & Trade-Unit Model

## TL;DR

**Trade-unit entitlements are a UX filter, not an access boundary.**

Any authenticated Scoular user can read or mutate any customer's records via the Origination API. Trade-unit selection narrows the *default* result set in the UI but does not restrict what an authenticated user is permitted to see or change.

This is intentional. Originators routinely cross trade units (e.g., search by name, follow a referral, edit notes on a producer outside their region), and a hard access boundary at the trade-unit level was creating false-positive blocks during legitimate workflows.

## What this means in practice

- `GET /api/customers/{id}`, `GET /api/customers/by-source/{sourceId}`, and `GET /api/customers/linked-to/{sourceId}` return any customer regardless of the caller's entitled trade units.
- All customer-bound read endpoints behave the same way: contracts, tickets, notes, planting intentions, producer details, stored grain, and pricing lines.
- Mutation endpoints (`PUT /api/customers/{id}`, all `NotesController` writes, `PlantingIntentionsController` writes, `ProducerDetailsController` writes) deliberately omit `ValidateCustomerAccessAsync`. See PR #239 (`fix_StorageLoadAndEntitlementsErrors`) for the change and the rationale.
- The `[EnforceTradeUnitAccess]` filter fails open on entitlement-database outages for `GET`/`HEAD` requests. Since trade units are a UX filter, this gives users unfiltered reads during an outage rather than a blocked read.

## Accepted-by-design security findings

The following findings (codex / static-analysis output) flag this model as a vulnerability. They are accepted by design under the current model and should not be re-opened without a change to the access policy:

- **H-034** — customer-scoped GET endpoints don't call `ValidateCustomerAccessAsync`.
- **H-036** — `GET /api/customers/{id}` and related endpoints don't call `ValidateCustomerAccessAsync`.
- **H-035** — `EnforceTradeUnitAccessAttribute` fails open on entitlement-DB outage for GET/HEAD.

## When to revisit

If any of the following ever becomes true, **all three findings re-open as real issues** and the codepaths above need to be tightened:

- Origination becomes multi-tenant (non-Scoular accounts gain access).
- Compliance or legal requires per-user customer scoping.
- Customer data grows to include classifications (PII tiers, embargoed accounts) that not every authenticated user should see.

The fix in that case:
- Require `ValidateCustomerAccessAsync` (or a stricter equivalent) on every customer-bound read endpoint, resolving the parent customer first for endpoints that take an indirect identifier (`sourceContractId`, `scoularId`, etc.).
- Replace the `await next(); return;` outage path in `EnforceTradeUnitAccessAttribute` with a 503/403, or fall back to a trusted cached entitlement set.
- Constrain linked-producer traversal so the bidirectional logic doesn't surface customers outside the caller's allowed scope.

## Relevant code

- [api/GrainOriginatorPortal.Api/Filters/EnforceTradeUnitAccessAttribute.cs](../api/GrainOriginatorPortal.Api/Filters/EnforceTradeUnitAccessAttribute.cs) — the trade-unit filter (UX scoping, fail-open on outage).
- [api/GrainOriginatorPortal.Api/Services/UserEntitlementService.cs](../api/GrainOriginatorPortal.Api/Services/UserEntitlementService.cs) — `ValidateCustomerAccessAsync` lives here.
- [api/GrainOriginatorPortal.Api/Controllers/CustomersController.cs](../api/GrainOriginatorPortal.Api/Controllers/CustomersController.cs) — example of a controller where the GETs intentionally skip the check.
