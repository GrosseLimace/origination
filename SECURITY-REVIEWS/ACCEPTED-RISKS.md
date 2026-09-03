# Accepted Security Risks — Grain Originator Portal (Origination)

This document records security findings that have been reviewed and **formally accepted** as
residual risk, with rationale and compensating controls. It is the canonical "security model"
record for intentional deviations from least-privilege defaults. Scanners may continue to flag
these patterns; triage against the AR-IDs below before re-opening.

| ID | Title | Severity | CWE | Status | Accepted | Re-review by |
|----|-------|----------|-----|--------|----------|-------------|
| AR-01 | Collaborative edit/delete of shared producer data (no per-record ownership check) | Medium | CWE-639 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-02 | Customer-scoped reads not restricted by trade-unit entitlement (no object-level authz) | High | CWE-639 / CWE-284 | Accepted — **security sign-off pending** | 2026-06-23 | 2027-06-23 |
| AR-03 | Rep-driven trade-unit assignment (CustomerTradeUnit membership mutable by any rep) | High | CWE-284 / CWE-639 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-04 | ODS onboarding search exposes producer-master PII to any authenticated rep | High | CWE-284 / CWE-200 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-05 | Bid-sheet locations and bids are company-wide; destructive ops restricted to creator/Admin | High | CWE-284 | Accepted — **awaiting countersign** (amended 2026-09-03) | 2026-09-02 | 2027-09-02 |
| AR-06 | Production SQL hostnames / db names in appsettings.Production.json (no credentials) | Low | CWE-200 | Accepted | 2026-06-23 | Before go-live |

---

## AR-01 — Collaborative edit/delete of shared producer data

**Finding** (scan 2026-06-22; CWE-639 / OWASP A01:2021 Broken Access Control). The following
mutation endpoints perform no per-record ownership or trade-unit authorization check — any
authenticated user may modify or delete any record by enumerating its ID:

- `NotesController` — `PUT /api/notes/{id}`, `PUT /api/notes/{id}/toggle-pin`, `DELETE /api/notes/{id}`
- `PlantingIntentionsController` — `PUT /api/plantingintentions/{id}`, `DELETE /api/plantingintentions/{id}`
- `ProducerDetailsController` — `PUT/DELETE /api/producerdetails/customer/{customerId}`
- `DashboardPlantingEstimatesController` — `DELETE /api/dashboardplantingestimates/actualharvest/{id}` (added per Codex scan 2026-06-29; re-flagged as **H-050** on 2026-06-29). The controller's `[EnforceTradeUnitAccess]` filter validates the trade-unit-keyed reads and upserts, but the delete-by-id route carries no trade-unit parameter to check. Actual-harvest rows are shared dashboard data of the same nature as the records above, so this delete is **intentionally left matching the shared-record delete model** rather than made stricter than every other delete in the app. A per-row trade-unit check was drafted and **deliberately reverted** to honor this decision — do not re-add without re-opening AR-01.

**Update (2026-08-10):** re-flagged as **M-033** by the GHE security scan (CWE-639, confidence 8/10)
against the three `NotesController` mutation routes (`PUT {id}`, `PUT {id}/toggle-pin`,
`DELETE {id}`), suggesting a `CreatedBy`-match predicate modeled on `SavedListService`. **Re-accepted
— no change.** The SavedList comparison is inapposite: saved lists are a rep's *personal* working
set (ownership is meaningful), whereas notes are *shared* producer records — enforcing per-author
edit/delete is exactly what AR-01 rejects because it breaks coverage/hand-off. All three routes carry
inline AR-01 citations. Triage future scan hits on these routes against this entry.

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
- `GET /api/customers/linked-to/{sourceId}` (reverse linked-producer lookup — links deliberately span trade units)
- `GET /api/customers/{id}/trade-units` (membership list for the edit dialog)
- `GET /api/contracts/customer/{customerId}`
- `GET /api/tickets/customer/{customerId}`
- `GET /api/notes/customer/{customerId}`
- `GET /api/plantingintentions/customer/{customerId}`
- `GET /api/producerdetails/customer/{customerId}`
- `GET /api/dpcontracts/customer/{customerId}` (added 2026-08-18 — see the update below)

**Update (2026-07-21):** the notes list/search endpoints are no longer trade-unit-filtered on the
server either — note **content** is now returned org-wide to any authenticated rep:

- `GET /api/notes` (bulk; feeds NLQ / saved-list / Build-A-List keyword search)
- `GET /api/notes/last-contact` (per-customer last-contact aggregate; feeds list + dashboard badges)

This was a deliberate performance change (two-tier notes loading): the server sends the full note set
and the client filters to the selected trade unit's producers, so **UI results remain trade-unit-scoped**
— a rep still only *sees* notes for producers in their selected trade units. The broadening is on the
wire only (the raw payload contains org-wide note content, visible via browser dev tools). This falls
squarely under the same "trade units are a UX filter, not an access boundary" rationale below.

**Update (2026-08-10):** re-flagged by the GHE security scan (CWE-639 / OWASP A01:2021, confidence
8/10) against `CustomersController` `GetById` / `GetBySourceId` / `GetLinkedTo` / `GetTradeUnits` and
the notes reads. Reviewed and **re-accepted** — product direction confirmed: originators must be able
to pull up any producer (cross-trade-unit coverage, linked producers that span trade units, and the
upcoming incoming-call popup all depend on it), so per-producer read authorization is intentionally
not enforced. Route list above extended to name every endpoint the scan cited. Triage future scan
hits on these routes against this entry.

**Update (2026-08-18):** flagged HIGH by the Codex scan against the new
`DpContractsController.GetByCustomer` / `DpContractService.GetByCustomerAsync`. Reviewed and
**accepted under this entry** — the route is the same shape as `GET /api/contracts/customer/{customerId}`
already listed above (`[Authorize]` only, no object-level check, straight to the repository), it feeds
the DP Contracts tab on the producer page, and the surrounding Contracts and Tickets tabs on that same
page are already open. `GetAllAsync` filters by entitled trade units and `GetByCustomerAsync` does not:
that is the app-wide pattern, not an oversight — **list** views are trade-unit-scoped as a relevance
default, **by-id** reads are open by design.

The scan's stated reason for saying this entry does not cover the route ("the accepted customer-read
risk explicitly excludes financial/system-of-record data") is a misreading: the compensating control
below excludes financial/system-of-record **mutation**, not financial reads, and contract positions
with quantities and prices are already in scope via the contracts route.

Worth recording plainly, because it is the closest this entry has come to its own re-evaluation
trigger: this endpoint returns producer **balance** fields — `ReceivableAmount`, `PrepaidAmount`,
`UnearnedStorageAmount`, `UnpaidHandlingAmount`, plus `StorageRate` and `StorageDays` — which is a
step beyond the quantities and prices previously exposed. Judged not to cross the "regulatory/financial
sensitivity" line in **Re-evaluate if** below: it is storage-settlement data originators work daily,
read-only, and gating it would make DP stricter than every neighbouring tab on the same page. If that
judgement is revisited, wire `ValidateCustomerAccessAsync` onto the route — and onto the contracts and
tickets routes at the same time, or the inconsistency simply moves.

**Update (2026-08-18, second scan — same route, independent finding).** The Claude security scan
raised `GET /api/dpcontracts/customer/{customerId}` HIGH on its own, adding two arguments the Codex
hit did not make. Both were considered; the entry stands, with one process action falling out of it.

*"Crosses a data-confidentiality boundary with financial impact"* — **overstated as a new boundary.**
`ContractResponse` on the already-listed `GET /api/contracts/customer/{customerId}` route already
returns `Price` and `TotalValue` (the dollar value of the producer's contract), plus `SettledQuantity`
and `OpenBalanceQuantity`, org-wide to any authenticated user. Producer financial figures have been
readable cross-trade-unit, deliberately, since this entry was written. DP's storage receivable /
prepaid / unearned amounts are the same class of data, not a first crossing. Recording that precedent
here so the third scan doesn't have to relitigate it.

*"Enumerable sequential `customerId`, not an unguessable UUID"* — true, and true of every route in the
list above. Not specific to this one.

*Suggestion to wire `ValidateCustomerAccessAsync`* — answered in the method's own summary
(`UserEntitlementService.cs`, recorded on main 2026-08-18): deliberately not called on any path,
because it would break cross-trade-unit coverage, linked producers, and the incoming-call popup, and
it fails CLOSED for producers with no trade-unit mapping. Don't wire it without reopening this entry.

*Middle suggestion — keep the route open but strip the balance fields for producers outside the
caller's trade units* — **considered and not taken.** It would blank part of the DP tab during exactly
the coverage workflow this entry exists to protect, and to be consistent it would have to strip
`Price`/`TotalValue` from the contracts route too, or the boundary simply moves one tab over. Revisit
alongside AR-02 as a whole if the access model changes — it is the least-disruptive option on the table
if per-record protection of financial fields is ever required.

*The argument that does land:* **"the acceptance is a project-level decision and does not satisfy the
mandatory enforcement checklist."** Fair. Every entry in this file is signed "Origination engineering,"
and AR-02 specifically has now been flagged four times (2026-06-23, 2026-08-10, and twice on
2026-08-18) and self-accepted each time. Engineering accepting its own repeatedly-raised HIGH
authorization finding is a process gap independent of whether the technical judgement is right.
**Action: take AR-02 to IT Security (asksecurity@scoular.com) for a sign-off line, or a rejection that
forces the code change.** Until that exists, expect this to re-flag every release. See the pending-
sign-off note under **Accepted by** below.

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

**⚠ Security-team sign-off PENDING (raised 2026-08-18).** Engineering acceptance only, on a finding
now raised four times by automated scans. Not a blocker for the technical judgement above, which
stands, but this entry needs IT Security (asksecurity@scoular.com) either to countersign it or to
reject it and require the code change. Whoever gets that answer: record it on this line with a date.

---

## AR-03 — Rep-driven trade-unit assignment

**Finding** (scan 2026-06-23; HIGH; CWE-284 / CWE-639). `PUT /api/customers/{id}/trade-units` and
`DELETE /api/customers/{id}/trade-units/{tradeUnit}` let any authenticated user change a producer's
`dbo.CustomerTradeUnit` membership — the data that drives entitlement scoping — with no admin check
and no validation that the requested trade units are permitted for the caller. In principle a user
could onboard a producer into their own trade unit (then see that producer via entitlement-scoped
views) or remove legitimate memberships.

**Update (2026-08-10):** re-flagged by the GHE security scan (CWE-284 / OWASP A01:2021, confidence
8/10) with the same path ("assign a producer to a trade unit the caller holds → producer passes the
scoped filters"). Reviewed and **re-accepted** — that path *is* the New Customer Trade Units
onboarding feature; admin-gating or entitlement-validating it would remove the feature. The removal
vector is also tighter than the original text records: the DELETE only deactivates **dormant**
memberships (server re-validates no open purchase contract / unapplied ticket in that TU, else 409),
sets `UserDeactivated` so the nightly sync restores the row when activity returns, and the PUT's
reconcile only touches **manual** (`IsManual`) rows — sync-sourced memberships backed by real
activity can never be stripped. Both endpoints carry inline AR-03 comments. Triage future scan hits
on these routes against this entry.

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

---

## AR-04 — ODS onboarding search exposes producer-master PII

**Finding** (scan 2026-06-23; HIGH; CWE-284 / CWE-200). `GET /api/customers/search-ods` returns
onboarding candidates from the CTRM producer master (`base.vw_CurrentCustomers`) to any authenticated
caller with no trade-unit or role scoping. Results include producer contact PII (address, phone,
email) and a broad term (even a single letter) can enumerate up to 50 not-yet-onboarded producers
per request, outside the caller's trade units.

**Update (2026-08-10):** re-flagged by the GHE security scan (CWE-200 / OWASP A01:2021, confidence
8/10), which noted the single-letter enumeration vector. The unscoped-full-PII aspect remains
**accepted** (onboarding must search the whole master by design — see rationale). One partial fix was
applied on `fix_SecurityFindings`: the `>= 3` char minimum is now enforced **server-side** in
`CustomersController.SearchOds` (`MinOdsSearchLength`), not just in the client — so a direct API call
with a 1–2 char term can no longer harvest master PII a page at a time. The role-scoping / PII-
minimization suggestions were **not** adopted: they'd degrade the onboarding UX (which shows
location/phone/email on the candidate card) and contradict the confirmed product direction that reps
may look up any producer.

### Decision: Accepted (with the server-side min-length hardening above)

**Rationale.** This endpoint is the **rep onboarding search** (the home-page fallback for the "New
Customer Trade Units" flow, AR-03). It is *intentionally* unscoped: these producers have no trade
unit yet, so trade-unit scoping is impossible and a rep must be able to search the whole producer
master to find someone to onboard. All callers are trusted, authenticated Scoular employees, and the
data originates from CTRM (the system of record), which staff already access. A `>= 3` character
minimum and `TOP 50` bound the query; results exclude already-onboarded producers.

**Scope / compensating controls.** Authenticated Scoular employees only (Azure AD JWT); read-only;
no source-of-record mutation; minimum search length + 50-row cap limit bulk extraction; the data is
internal producer contact info, not regulated/financial.

**Residual risk.** An authenticated employee could enumerate producer-master contact PII outside
their trade units. Mitigated by the trusted internal population and the search-length / row caps.

**Re-evaluate if:** the app is exposed to external/untrusted users, or producer contact PII becomes
regulated. At that point, trim `search-ods` to non-sensitive identification fields (name, ScoularId,
city/state) and fetch full contact detail only for a producer the rep actually onboards.

**Accepted by:** Origination engineering — recorded 2026-06-23.

---

## AR-05 — Bid-sheet locations and bids are company-wide, with only destructive actions restricted

**Superseded 2026-09-02.** The original finding (scan 2026-06-23; HIGH; CWE-284) was that
`GET /api/bidsheet/locations` and `GET /api/bidsheet/elevators` return every trade unit's data when the
`tradeUnitCode` parameter is omitted. That was accepted on the grounds that *"the authorization
boundary that matters for bid sheets is mutation, and that is enforced"* — every write validated the
caller's trade-unit entitlement.

**That rationale is no longer true, and this entry is rewritten rather than re-accepted.**

### What changed

The bid sheet was remodelled so that a location is a **company-wide** record rather than a per-desk
one. Previously the same elevator was stored once per trade unit — one row per desk, each with its own
bids — and every mutation was authorized against the row's persisted `TradeUnitCode`
(`BidSheetService.AuthorizeLocationByStoredTradeUnitAsync`, the AR-05-era IDOR fix).

There is now **one row per elevator and one shared set of bids**, so there is no per-row trade unit
left to authorize against. Trade-unit scoping has been removed from the Bid Sheet screen entirely;
`TradeUnitCode` survives on the row only as provenance (which desk first added it) and nothing reads it
to decide what a user may see or change.

### Decision: Accepted, with destructive operations newly restricted

**Rationale.** Shared visibility was always intended, and is now the explicit product model: everyone
sees every location and every bid, and users curate what they care about into their own sheets. What
changed is the *blast radius of a write*. Previously a bad or careless edit damaged one desk's copy;
now one row serves everybody.

Mutations are therefore split by kind:

- **Open to any authenticated user** — entering and overriding bids, renaming a location, re-siting it,
  and the Scoular flag. These are shared-record edits, consistent with AR-01's position that bid sheet
  records are shared rather than owned, and they match how originators actually work: whoever is looking
  at a bid is the person best placed to correct it. A wrong value is visible, correctable, and
  reclaimed by the feed on its next run.
- **Restricted to the row's creator or an Admin** — deleting a location, and deleting every bid for a
  commodity on it. These are destructive, irreversible from the UI, and now remove the elevator and its
  whole bid history from *every* user's sheet at once. Enforced by
  `BidSheetService.AuthorizeDestructiveLocationChangeAsync`, which reads the persisted `CreatedBy` and
  throws `ForbiddenException` (a real 403 — a 404 would tell the user the row vanished and send them
  hunting a bug that isn't there).

**Scope / compensating controls.** Authenticated Scoular employees only. Data is internal competitor
bid information — no PII, no financial account data. Destructive actions are creator-or-Admin and carry
a UI confirmation stating how many sheets hold the location. Feed-owned cells are reclaimed by the
nightly bridge, so an incorrect override to a fed bid self-heals within a day. The pre-remodel state of
every table is preserved in `dbo.*_PreGlobal` snapshots.

**Residual risk — larger than before, and stated plainly.**
1. Any authenticated employee can change any bid on any location company-wide. There is no audit trail
   of *who* changed a bid beyond `ModifiedBy` on the row, and no undo in the UI.
2. Bids auto-save on blur with no confirmation. Two users editing the same cell will each keep their
   own value locally and **neither is told they overwrote the other**. A concurrency answer
   (last-write-wins with an indicator, or a version token) is an open item for the sheets phase.
3. A hand-typed bid on a location the feed does not publish has no self-healing path — it persists
   until someone notices.

**Re-evaluate if:** bid pricing becomes competitively sensitive *between* desks (which would require a
read boundary and undo this model); or if concurrent-edit collisions prove to happen in practice; or if
the sheets phase introduces membership, at which point mutation could reasonably be scoped to "a
location on a sheet you belong to" instead of being fully open.

### Addendum — the sheets phase, 2026-09-03

The "re-evaluate if" clause above named the sheets phase specifically, so here is what it changed.
**The decision is unchanged**; two facts about the authorization surface are not.

**1. Sheets are a new authorization boundary, but not over bids.** `dbo.BidSheets` /
`BidSheetShares` / `BidSheetLocationLinks` give a sheet an owner and a share list. Reading or editing a
sheet requires being its owner or on its share list; renaming, resharing and deleting one are
owner-only (`BidSheetService.RequireVisibleSheetAsync` / `RequireSheetOwnerAsync`, both checking
persisted values, both returning a real 403 rather than a 404 for a genuine outsider).

Mutation of **bids and locations was deliberately NOT scoped to sheet membership.** The clause above
offered that as an option; it was not taken, because a location is company-wide and appears on many
sheets at once, so "a location on a sheet you belong to" is satisfied by almost every user for almost
every location — it would read as a control while enforcing nearly nothing. Residual risk 1 stands
unchanged: any authenticated employee can change any bid.

**2. The two destructive endpoints no longer call `ValidateTradeUnitsOrThrowAsync`.**
`DELETE /bidsheet/locations/{id}` and `DELETE /bidsheet/locations/{id}/bids/{commodity}` used to
validate the caller against a `tradeUnitCode` the **caller supplied in the query string**. Post-remodel
the client could only supply the row's provenance trade unit — the desk that first added the
location — which is very often not the caller's. The check therefore denied legitimate deletes while
adding nothing against an attacker, who chose the value being checked. It has been removed; the
creator-or-Admin guard on the persisted `CreatedBy` is now the sole and actual authorization on both
endpoints. **This is a narrowing of a check that was decorative, not the removal of a real one**, but
it is a reduction in the surface as written and is recorded here rather than left to a diff.

**3. Deleting a location clears its sheet links.** The link FK is `RESTRICT`, so no other code path can
empty a colleague's sheet as a side effect; the delete path clears links explicitly, after the UI has
shown the caller how many sheets hold the elevator
(`GET /bidsheet/locations/{id}/sheet-count`). Residual risk: that count is the only warning, and the
delete is still irreversible from the UI.

**4. Residual risk 2 (concurrent edits) is unchanged and now applies to more than bids.** A sheet's
shared column layout and row order are last-write-wins with no indicator, so two members rearranging
the same sheet will silently overwrite each other. Lower stakes than a bid — a layout is re-set in
seconds — but the same missing mechanism.

**Countersign note:** this addendum changes what is being signed off. It is part of the same pending
request to asksecurity@scoular.com, not a separate one.

**Amended by:** Origination engineering — 2026-09-03.

**Status: awaiting IT Security countersign** (asksecurity@scoular.com), alongside AR-02. The feature is
Dev-only and gated behind `environment.barchartBidsEnabled`; it must not reach PROD without sign-off.

**Rewritten by:** Origination engineering — 2026-09-02. Supersedes the 2026-06-23 acceptance.

---

## AR-06 — Production SQL hostnames / database names in source control

**Finding** (scan 2026-06-23; LOW; CWE-200 / OWASP A05:2021 Security Misconfiguration).
`appsettings.Production.json` (and the equivalent per-env files + `deploy-prod.yml`) commit the
production Azure SQL server hostname (`azrscosqlp01.database.windows.net`) and database names
(`ODS`, `Origination`, `Entitlements`) to the repository. This discloses the production
infrastructure naming convention and SQL endpoints to anyone with repo access.

### Decision: Accepted (deferred to go-live)

**Rationale.** **No credentials are exposed** — every connection string uses
`Authentication=Active Directory Default` (managed identity), so there is no password, key, or
connection secret in the file. What remains is non-secret infrastructure metadata (hostname + db
names). The Azure SQL server already enforces its own authentication and network controls, so
knowing the endpoint does not by itself grant access. The repository is private to the Scoular
`IT` org. Moving these to Key Vault has a **hard ops prerequisite** (the `ConnectionStrings--*`
secrets must exist in each environment's Key Vault *before* the file values are removed, or
startup breaks), which is appropriately sequenced with the existing go-live TODO already recorded
inline in the file.

**Scope / compensating controls.** No secrets disclosed (managed-identity auth only); repo is
private to the `IT` org; Azure SQL enforces AAD auth + firewall/private-endpoint network controls
independently of endpoint knowledge; Key Vault is already wired as a config provider in
`Program.cs`, so the migration is a config/ops change, not new code.

**Residual risk.** An actor with repository access learns the production SQL endpoint and database
names — useful only as reconnaissance, not access. Low blast radius given managed-identity auth and
network controls.

**Re-evaluate if / before go-live:** before general availability, create
`ConnectionStrings--ODSConnection`, `--DefaultConnection`, `--OriginationConnection`,
`--EntitlementsConnection` secrets in each environment's Key Vault and remove the
`ConnectionStrings` block from the per-env `appsettings.*.json` (they will then resolve from Key
Vault via the existing provider). This matches the TODO already present in
`appsettings.Production.json`.

**Accepted by:** Origination engineering — recorded 2026-06-23.

---

## AR-07 — Mentioning a group addresses that group's members, not the mentioner's entitlements

**Finding** (self-raised 2026-08-11; MEDIUM; CWE-284). A user can `@`-mention any group they can
**see** — the ones they created plus the ones they are a member of. The API flattens that group into
its member references and the Instant Share Note Logic App emails the note to all of them. Those
members were validated against the **creator's** entitlement overlap when the group was saved
(`DailyRecapGroupService.BuildValidatedMembersAsync`, fail-closed), so mentioning someone else's
group can reach people the direct person picker would not have offered the mentioner — that picker is
scoped to users sharing a trade unit with the caller.

### Decision: Accepted

**Rationale.** Every recipient is an **internal address constructed server-side** from a UPN local
part — twice, independently: the API rebuilds person addresses in `NoteService.NormalizeMention`, and
the Logic App re-derives them from `UserId` columns rather than trusting anything stored
(**M-025 / M-025a**). The boundary in question is therefore *which internal colleague receives an
internal note*, never whether data can leave the tenant. That is consistent with **AR-02**: notes are
already open per producer, and trade-unit entitlement is a relevance default rather than an access
boundary. The group is also not an arbitrary set — someone entitled to assemble it did so
deliberately, and if its daily recap is on, that same set already receives those notes every evening.

Re-validating each member against the *mentioner's* entitlements was considered and rejected: it
would make cross-trade-unit groups — the main reason to build one — unusable, and it would put a
fail-closed entitlements call in the note-save path, which is high-frequency and user-blocking.

**Scope / compensating controls.** A group the caller can neither see nor own is **rejected** at save
(`ValidationException`, nothing persisted) — visibility is enforced server-side against the same query
that builds the picker, so a forged group id in a crafted request does not resolve. Expansion is
capped at 250 mention rows per note. Group membership is still entitlement-validated fail-closed at
group-save time, and only the creator can modify a group. All recipients are `@scoular.com` by
construction.

**Residual risk.** An employee can cause an internal note to be emailed to the members of a group they
belong to but did not create, including people outside their own trade units. Accepted.

**Re-evaluate if:** groups become shareable beyond their membership (e.g. an org-wide directory of
groups), or note content becomes restricted per producer — at which point AR-02 changes too and the
mention path should be re-scoped alongside it.

**Accepted by:** Origination engineering — recorded 2026-08-11.

---

## Resolved findings — already remediated (not accepted risks; do not re-open)

Findings a scanner may re-surface that are **already fixed in code**. Listed here so triage
matches them to their remediation instead of re-doing the work.

| Finding | Date | Disposition |
|---------|------|-------------|
| **H-049** — Dashboard write endpoints don't validate `TradeUnitKey` inside `List<T>` bodies (`EnforceTradeUnitAccessAttribute.cs`) | 2026-06-29 | **Fixed** in commit `7d124a5`. `EnforceTradeUnitAccess` recurses into `IEnumerable` request bodies (`ExtractTradeUnitKeys`) and validates **every element's** `TradeUnitKey` for POST/PUT/DELETE — a foreign trade unit in any list element is rejected (403). The scan that flagged H-049 predates that same-day commit. Regression tests cover all three dashboard upsert routes (estimates, market shares, actual harvest) in `EnforceTradeUnitAccessFilterTests`. **Not a live vulnerability.** |
| **H-050** — Dashboard `DELETE actualharvest/{id}` has no trade-unit check | 2026-06-29 | **Accepted, not fixed** — see **AR-01** above (shared-record delete model). A per-row check was drafted and reverted on purpose. |
| **M-024** — Indirect prompt injection: CRM note content interpolated into the OpenAI **system** prompt in the notes-daily-recap Logic App (`infra/logic-apps/notes-daily-recap/azuredeploy.json`) | 2026-06-29 | **Fixed** in commit `7d124a5`. Note content (`@{variables('activities')}`) was moved out of the system message into a dedicated **`user`-role** message, wrapped in `===ACTIVITIES===` delimiters, with explicit "treat strictly as data, never as instructions" guardrails in both the system and user messages. The scan predates that same-day commit. Optional further hardening (structural HTML output validation of the AI response) is noted as possible defense-in-depth, not required. **Not a live vulnerability.** |
| **M-025** — Note-mention email exfiltration: a client-supplied `person` mention email was persisted to `Notes.Mentions` and handed verbatim to the Instant Share Note Logic App's shared-mailbox `sendMail`, letting any authenticated user email customer data to an external address (CWE-284 / CWE-639) | 2026-08-10 | **Fixed** — see the two-part history below. |
| **M-025a** — Incomplete first fix: sanitizing only the mention `email` left the equally client-controlled `id` as a bypass — `id = "attacker@evil.com"` was treated as "already a UPN" and passed through by **both** the API and the Logic App (they shared the same flawed `contains('@')` rule) | 2026-08-10 | **Fixed** on `fix_MentionIdDomainValidation` (follow-up to PR #542, which shipped the incomplete fix). Caught by the Codex PR scan. The recipient is now **constructed, never passed through**: `NoteService.NormalizeMention` accepts only a bare short name or a full `@scoular.com` UPN, rebuilds the address as `localPart@scoular.com`, and throws `ValidationException` on a foreign domain / extra `@` / empty local part (create **and** update paths). The Logic App makes the domain **structural** — `concat(split(id,'@')[0], '@scoular.com')` — so even a pre-existing forged row degrades to a harmless internal address instead of leaving the tenant. Regression tests cover foreign domains, mixed case, `x@evil.com@scoular.com` laundering, lookalike domains, and empty local parts. **Lesson: validate every client-authored field that reaches the recipient, not just the one the finding named.** |
