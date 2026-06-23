# Accepted Security Risks — Grain Originator Portal (Origination)

This document records security findings that have been reviewed and **formally accepted** as
residual risk, with rationale and compensating controls. It is the canonical "security model"
record for intentional deviations from least-privilege defaults. Scanners may continue to flag
these patterns; triage against the AR-IDs below before re-opening.

| ID | Title | Severity | CWE | Status | Accepted | Re-review by |
|----|-------|----------|-----|--------|----------|-------------|
| AR-01 | Collaborative edit/delete of shared producer data (no per-record ownership check) | Medium | CWE-639 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-02 | Customer-scoped reads not restricted by trade-unit entitlement (no object-level authz) | High | CWE-639 / CWE-284 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-03 | Rep-driven trade-unit assignment (CustomerTradeUnit membership mutable by any rep) | High | CWE-284 / CWE-639 | Accepted | 2026-06-23 | 2027-06-23 |

---

## AR-01 — Collaborative edit/delete of shared producer data

**Finding** (scan 2026-06-22; CWE-639 / OWASP A01:2021 Broken Access Control). The following
mutation endpoints perform no per-record ownership or trade-unit authorization check — any
authenticated user may modify or delete any record by enumerating its ID:

- `NotesController` — `PUT /api/notes/{id}`, `PUT /api/notes/{id}/toggle-pin`, `DELETE /api/notes/{id}`
- `PlantingIntentionsController` — `PUT /api/plantingintentions/{id}`, `DELETE /api/plantingintentions/{id}`
- `ProducerDetailsController` — `PUT/DELETE /api/producerdetails/customer/{customerId}`

### Decision: Accepted

**Rationale.** The portal is an internal tool for Scoular grain originators. Producer notes,
planting intentions, and producer details are **shared, collaborative records about a producer** —
not personal data owned by an individual rep. Originators cover for one another and work the same
producers across trade units, so **trade units are a UX filter, not an access boundary** (as
documented inline in each controller). Enforcing per-author edit/delete would break legitimate
hand-off and coverage workflows and contradicts the product's collaboration model.

**Scope / blast radius.**
- All callers are **authenticated Scoular employees** — Azure AD JWT is required on every endpoint; no anonymous access.
- Limited to producer notes / planting intentions / producer details. No financial, contract, or system-of-record data is mutated (CTRM/ODS are read-only upstream).
- Read access is already intentionally broad for the same collaboration reasons.

**Compensating controls.**
- **Authentication** on every endpoint (Azure AD bearer token).
- **Attribution & audit** — every mutation emits a structured `AUDIT_UPDATE` / `AUDIT_DELETE` log entry (record id + actor identity via `SecurityAuditMiddleware` / correlation id), and `CreatedBy` / `ModifiedBy` columns capture the acting user where present, so changes are attributable and reconstructable from history.
- Changes are reversible (records can be re-entered; upstream sources of record are unaffected).

**Residual risk.** A malicious or careless authenticated employee could alter or delete another
rep's note/intention/detail. Mitigated by full attribution (audit trail) and a trusted, internal,
authenticated user population.

**Re-evaluate if:** the application is exposed to external or untrusted users, or these records
gain regulatory/financial significance that would require per-record ownership enforcement.

**Accepted by:** Origination engineering — recorded 2026-06-23.

---

## AR-02 — Customer-scoped reads not restricted by trade-unit entitlement

**Finding** (scan 2026-06-23; HIGH; CWE-639 / CWE-284 Broken Access Control). Customer-scoped read
endpoints accept a client-supplied identifier and return the producer's data without an object-level
authorization check (no `ValidateCustomerAccessAsync` or equivalent) — they require only a valid
bearer token. An authenticated user who learns/guesses another producer's id or ScoularId can read
that producer's profile and related data outside their entitled trade units:

- `GET /api/customers/{id}`, `GET /api/customers/by-source/{sourceId}`
- `GET /api/contracts/customer/{customerId}`
- `GET /api/tickets/customer/{customerId}`
- `GET /api/notes/customer/{customerId}`
- `GET /api/plantingintentions/customer/{customerId}`

### Decision: Accepted

**Rationale.** Same model as AR-01 — this is an internal collaboration tool for authenticated Scoular
originators, and **trade units are a UX filter, not an access boundary**. Reps cover for one another
and routinely work producers across trade units; the per-customer read endpoints are intentionally
open so a rep can pull up any producer. Trade-unit entitlement is applied to *list/search* views as a
relevance default, not as a per-record security boundary. Enforcing object-level authz here would
break legitimate cross-trade-unit workflows (and contradicts AR-01).

**Scope / compensating controls.** Read-only; authenticated Scoular employees only (Azure AD JWT on
every endpoint); no financial/system-of-record mutation (CTRM/ODS are read-only upstream); access is
attributable via request logging/correlation id. Server still derives authoritative customer fields
from the persisted record rather than trusting client-supplied display values where it matters.

**Residual risk.** A curious/malicious authenticated employee could read a producer outside their
trade units by id. Mitigated by the trusted internal user population and audit logging.

**Re-evaluate if:** the app is exposed to external/untrusted users, or producer data gains
regulatory/financial sensitivity requiring per-record authorization. The mechanism already exists
(`UserEntitlementService.ValidateCustomerAccessAsync`) and could be wired onto these routes if the
access model changes.

**Accepted by:** Origination engineering — recorded 2026-06-23.

---

## AR-03 — Rep-driven trade-unit assignment

**Finding** (scan 2026-06-23; HIGH; CWE-284 / CWE-639). `PUT /api/customers/{id}/trade-units` and
`DELETE /api/customers/{id}/trade-units/{tradeUnit}` let any authenticated user change a producer's
`dbo.CustomerTradeUnit` membership — the data that drives entitlement scoping — with no admin check
and no validation that the requested trade units are permitted for the caller. In principle a user
could onboard a producer into their own trade unit (then see that producer via entitlement-scoped
views) or remove legitimate memberships.

### Decision: Accepted

**Rationale.** This is the **intended rep-driven producer-onboarding flow** (the "New Customer Trade
Units" feature): originators onboard producers that exist in CTRM but have no contract/ticket by
assigning trade units. Because trade units are a UX filter and not an access boundary (AR-01/AR-02),
"onboard a producer into my trade unit" is a normal, expected rep action, not a privilege escalation
in this model. All actors are trusted, authenticated Scoular employees.

**Scope / compensating controls.** Authenticated Scoular employees only; mutations are attributable
(audit logging + `CreatedBy`/`ModifiedBy`/`IsActive` soft-delete on `CustomerTradeUnit`, so changes
are reversible and traceable); no source-of-record (CTRM/ODS) data is altered.

**Residual risk.** A malicious employee could broaden their own visibility or disrupt another rep's
producer memberships. Mitigated by attribution (audit trail), soft-delete reversibility, and the
trusted internal population.

**Re-evaluate if:** onboarding moves to a restricted role, the app is exposed to external/untrusted
users, or trade-unit membership becomes a hard security boundary. At that point, gate these endpoints
to an admin/onboarding role and validate requested trade units against the caller's entitlements.

**Accepted by:** Origination engineering — recorded 2026-06-23.
