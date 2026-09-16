# Accepted Security Risks — Grain Originator Portal (Origination)

This document records security findings that have been reviewed and **formally accepted** as
residual risk, with rationale and compensating controls. It is the canonical "security model"
record for intentional deviations from least-privilege defaults. Scanners may continue to flag
these patterns; triage against the AR-IDs below before re-opening.

| ID | Title | Severity | CWE | Status | Accepted | Re-review by |
|----|-------|----------|-----|--------|----------|-------------|
| AR-01 | Collaborative edit/delete of shared producer data (no per-record ownership check) | Medium | CWE-639 | Accepted — **security sign-off pending** | 2026-06-23 | 2027-06-23 |
| AR-02 | Customer-scoped reads not restricted by trade-unit entitlement (no object-level authz) | High | CWE-639 / CWE-284 | Accepted — **security sign-off pending** | 2026-06-23 | 2027-06-23 |
| AR-03 | Rep-driven trade-unit assignment (CustomerTradeUnit membership mutable by any rep) | High | CWE-284 / CWE-639 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-04 | ODS onboarding search exposes producer-master PII to any authenticated rep | High | CWE-284 / CWE-200 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-05 | Bid-sheet **location** reads are company-wide; destructive ops restricted to creator/Admin; the elevators half is gone (route deleted 2026-09-14); sheet rename/reshare opened to any member (2026-09-16) | High | CWE-284 | Accepted — **awaiting countersign** (amended 2026-09-16) | 2026-09-02 | 2027-09-02 |
| AR-06 | Production SQL hostnames / db names in appsettings.Production.json (no credentials) | Low | CWE-200 | Accepted | 2026-06-23 | Before go-live |
| AR-07 | Mentioning a group addresses that group's members, not the mentioner's entitlements | Medium | CWE-284 | Accepted | 2026-08-11 | 2027-08-11 |
| AR-08 | Person mentions require a real active user, but are not scoped to the mentioner's colleagues | High | CWE-284 | Accepted — **security sign-off pending** | 2026-09-01 | 2027-09-01 |

---

## AR-01 — Collaborative edit/delete of shared producer data

**Finding** (scan 2026-06-22; CWE-639 / OWASP A01:2021 Broken Access Control). The following
mutation endpoints perform no per-record ownership or trade-unit authorization check — any
authenticated user may modify or delete any record by enumerating its ID:

- `NotesController` — `PUT /api/notes/{id}`, `PUT /api/notes/{id}/toggle-pin`, `DELETE /api/notes/{id}`
- `PlantingIntentionsController` — `PUT /api/plantingintentions/{id}`, `DELETE /api/plantingintentions/{id}`
- `ProducerDetailsController` — `PUT /api/producerdetails/customer/{customerId}` (the `DELETE` on the same route was **removed from this entry 2026-09-14** — see the update below)
- `CustomersController` — `PUT /api/customers/{id}` (added 2026-09-14 per **M-039**; updates producer contact info, farm links and `LinkedProducerIds`. Always in scope of this entry's rationale, but never listed — the route carried a comment paraphrasing it with no AR number, so each scan met an apparently-undocumented unguarded mutation. Same gap H-060 found on `ContractsController`.)
- ~~`DashboardPlantingEstimatesController` — `DELETE /api/dashboardplantingestimates/actualharvest/{id}`~~ — **REMOVED FROM THIS ENTRY 2026-09-09 and FIXED in code.** It was added per the Codex scan 2026-06-29 (**H-050**) on the argument that actual-harvest rows are "shared dashboard data of the same nature as the records above". That analogy was wrong, and re-examining it under **H-061** is what finally settled the matter — see the 2026-09-09 update below. This route is now trade-unit authorized; do not cite AR-01 for it.

**Update (2026-08-10):** re-flagged as **M-033** by the GHE security scan (CWE-639, confidence 8/10)
against the three `NotesController` mutation routes (`PUT {id}`, `PUT {id}/toggle-pin`,
`DELETE {id}`), suggesting a `CreatedBy`-match predicate modeled on `SavedListService`. **Re-accepted
— no change.** The SavedList comparison is inapposite: saved lists are a rep's *personal* working
set (ownership is meaningful), whereas notes are *shared* producer records — enforcing per-author
edit/delete is exactly what AR-01 rejects because it breaks coverage/hand-off. All three routes carry
inline AR-01 citations. Triage future scan hits on these routes against this entry.

**Update (2026-09-01):** re-flagged a third time as **M-035** (Claude scan, CWE-639, confidence
8/10) against the same three `NotesController` routes, with the same `SavedListRepository`
`CreatedBy`-match suggestion already answered under M-033 above. **Re-accepted — no change.**
Nothing in the technical analysis is new or wrong; what it describes is the product's intended
behaviour, and the client is built on it — `customer-notes.component.html` renders Edit / Delete /
Pin on **every** note for every user, with no author gate, because reps clean up and correct each
other's notes on shared producers. Restricting the routes without also changing that UI would give
users buttons that 403.

The scan's one genuinely new point is **procedural, not technical**: "per the audit mandate a
project-level acceptance does not suppress the finding." That is fair — every AR entry in this file
has been accepted by Origination engineering alone, and no IT Security countersignature exists on
any of them. AR-01 is therefore marked **security sign-off pending** in the summary table, matching
AR-02. **Action: AR-01 and AR-02 go to asksecurity@scoular.com together** for countersignature or
rejection; expect a re-flag every release until that signature exists. The compensating control
this entry leans on was re-verified on 2026-09-01: `AUDIT_UPDATE` / `AUDIT_DELETE` structured log
entries do fire on all three routes (`NotesController.cs`), so every mutation remains attributable.

**Update (2026-09-09) — AR-01 NARROWED. The actual-harvest delete is FIXED, not accepted.**
Re-flagged as **H-061** (Claude scan, CWE-639, confidence 9/10) against
`DELETE /api/dashboardplantingestimates/actualharvest/{id}`, the third pass at that route after
H-050 (2026-06-29). The first response was another documentation-only pass — adding the inline
AR-01 citation the route had always been missing. The scanner rejected that on the merge check, and
it was right to: *"a project-level risk acceptance does not remove the technical exposure and is not
a compensating control under the mandatory enforcement checklist."*

Re-examined, and **AR-01 never actually fitted this route.** Four things separate it from the notes
/ planting-intentions / producer-details deletes this entry exists for:

1. **It is not a shared producer record.** Every row is stamped with exactly one `TradeUnitKey` — it
   is a trade-unit-keyed dashboard aggregate (bushels per trade unit × crop category × year), not a
   record *about a producer* that reps hand off to each other. AR-01's coverage/hand-off rationale
   has nothing to bite on.
2. **Its own controller already disagrees.** Every sibling route — `GetSummary`, `Get`,
   `GetMarketShares`, `GetActualHarvest` and all three upserts — is trade-unit scoped. Guarding this
   one makes it *consistent* with its controller, not stricter than the app.
3. **The data is hand-entered with no upstream system of record.** Unlike contracts and tickets
   (re-syncable from ODS), these bushels exist nowhere else. AR-01's "changes are reversible
   (records can be re-entered)" holds only in the sense that someone retypes them — and nobody would
   know which figures had vanished. They feed the market-share percentage on the Planting Intentions
   dashboard, so a deletion silently changes a reported number rather than removing visible content.
4. **No user workflow depended on it.** `deleteHarvestRow()` in `dashboard.component.ts` is not
   wired to anything — no template binding, no other caller. Reps add and edit these figures through
   the *upsert* route, which the filter already validates. So the check that was "drafted and
   reverted" to protect coverage was never protecting any real workflow; the only caller it could
   ever have refused is a hand-crafted request.

**Fixed** in `DashboardService.DeleteActualHarvestAsync`: resolve the row's own `TradeUnitKey`, then
`ValidateTradeUnitsOrThrowAsync` before deleting (403 on another trade unit's row). A non-existent id
stays a silent 204 no-op — returning 403 there would make the route an existence oracle for other
trade units' ids. An entitlements outage now **fails closed with 503**, mirroring
`EnforceTradeUnitAccessAttribute` and `DpContractService`, rather than deleting a row it cannot
authorize. The audit entry records the resolved trade unit, and a miss is logged too, so an
enumeration sweep leaves a trail. Five tests in `DashboardActualHarvestDeleteTests` pin it, including
one asserting the trade unit is resolved *before* the delete; the foreign-trade-unit test was
verified to FAIL with the guard removed.

**The reusable lesson:** H-050 was accepted by *analogy* — "same nature as the records above" — and
the analogy was never re-checked across three scans. When an entry is extended to a new route, test
the rationale against that route's actual data model and callers, not against the entry's summary.
The remaining routes below are genuinely shared producer records; this one never was.

**Update (2026-09-14) — AR-01 NARROWED AGAIN. The producer-details DELETE is FIXED, not accepted;
and `PUT /api/customers/{id}` is ADDED.**

Re-flagged by the weekly baseline as **H-062** (`claude`, CWE-639) against
`GET/PUT/DELETE /api/producerdetails/customer/{customerId}`, plus **M-038** (`codex`) against the
three `NotesController` mutations and **M-039** (`codex`) against `PUT /api/customers/{id}`.

**M-038 — re-accepted, no change.** Third pass at the notes mutations after M-033 and M-035; all
three routes already carry inline AR-01 citations and the client renders Edit/Delete/Pin on every
note to every user. Nothing new.

**M-039 — re-accepted, but it exposed a listing gap.** The route was never in this entry's list
despite being squarely within its rationale, and its inline comment paraphrased that rationale
without naming AR-01. Now listed above and cited in code. This is the H-060 pattern exactly: an
undocumented deliberate decision re-flags every scan.

**H-062 — split. `GET` and `PUT` re-accepted; `DELETE` fixed.**

Two of the finding's claims are wrong and should not be carried forward. It states
`ProducerDetailsController` is "the only data controller lacking `[EnforceTradeUnitAccess]`" — it is
not; `NotesController`, `PlantingIntentionsController`, `StoredGrainController` and
`DpContractsController` also lack it, and **no** peer controller guards its by-customer route. It
also reads the `GetAllAsync`-scoped / `GetByCustomerAsync`-open split as an oversight; that split is
the documented app-wide pattern recorded under AR-02 below.

- **`GET`** — ⚠ **this bullet was WRONG when first written, and is corrected here rather than
  quietly edited.** It originally read "stays accepted under AR-02 — narrowing it would break the
  linked-producer profile view". That claim was never verified: the linked-producer cache feeds only
  the last-contact badge, not a selectable row, so no such breakage existed. The PR scan flagged the
  read as the remaining unguarded path and was right. **The GET is now scoped and removed from
  AR-02** — see AR-02's 2026-09-14 update for the trace and the criterion it established.
- **`PUT`** stays accepted under this entry. It has **six live call sites**, and two of them
  (`home.component.ts` `_propagatePrimaryContact` and the removed-incoming-links path) write to
  **linked producers in other trade units by design**, with inline comments saying so. A third runs
  during onboarding, where the check would race trade-unit membership written moments earlier. An
  entitlement check here breaks real work — do not add one without re-opening this entry.
- **`DELETE` is fixed** in `ProducerDetailsService.DeleteAsync`: resolve the caller's entitled trade
  units, confirm the customer is a member via `GetActiveCustomerIdsInTradeUnitsAsync`, 403 otherwise,
  and **503 fail-closed** on an entitlements outage. A customer with no details row stays a silent
  no-op so the route is not an existence oracle. Covered by `ProducerDetailsDeleteTests` (5 tests,
  mutation-verified — removing the membership check makes the foreign-customer test fail).

**Why the DELETE and not the PUT** — the same three-part test that settled H-061:

1. **No client caller.** `deleteProducerDetails()` in `api.service.ts` is invoked by nothing — no
   component, no template, no spec. This entry's coverage/hand-off rationale was protecting a
   workflow that does not exist.
2. **It hand-cascades.** `ProducerDetailsRepository.DeleteAsync` explicitly removes the
   `ProducerContacts` and `ProducerGrainOnFarm` child rows, because they FK to `dbo.Customer` rather
   than to `ProducerDetails` and so do not cascade. One call destroys a producer's contact names,
   phones and emails plus their whole grain-on-farm position.
3. **The data has no upstream source.** Unlike contracts and tickets, none of it can be re-synced
   from ODS or CTRM. "Records can be re-entered" means someone retypes it — if they know what was
   there.

⚠ **And this entry was overstating its own mitigation.** The compensating-control paragraph below
claimed every covered mutation emits a structured `AUDIT_UPDATE` / `AUDIT_DELETE` entry. On the
producer-details delete that was **false** — the repository logged a plain `LogInformation` with no
audit code, so a destructive cascade left no audit-queryable trace. That is now fixed (the delete
emits `AUDIT_DELETE` with the cascade counts, and the controller logs misses too), and the paragraph
below is corrected. **Lesson: when an entry leans on a compensating control, verify the control
exists on every route it covers — a stated mitigation is not an implemented one.**

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
- **Attribution & audit** — mutations emit a structured `AUDIT_UPDATE` / `AUDIT_DELETE` log entry (record id + actor identity via `SecurityAuditMiddleware` / correlation id), and `CreatedBy` / `ModifiedBy` columns capture the acting user where present, so changes are attributable and reconstructable from history. ⚠ **Verify this per route rather than assuming it** — H-062 (2026-09-14) found the producer-details delete emitting only a plain `LogInformation` with no audit code, so this control did not in fact hold there. It was corrected in the same change, but the discovery is the point: a control stated in this file is not evidence that the code implements it.
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
- `GET /api/contracts/pacing/{customerId}` (Contract Pacing year-over-year; reads `base.Contract` for prior-year closed contracts) (added 2026-09-09 — see the update below)
- `GET /api/contracts/farm/{farmId}` (farm-scoped contracts) (added 2026-09-09 — see the update below)
- `GET /api/contracts/pricing-lines` (by `sourceContractId`) (added 2026-09-09 — see the update below)
- `GET /api/contracts/pricing-lines/by-customer` (by `scoularId`) (added 2026-09-09 — see the update below)
- `GET /api/tickets/customer/{customerId}`
- `GET /api/notes/customer/{customerId}`
- `GET /api/plantingintentions/customer/{customerId}`
- ~~`GET /api/producerdetails/customer/{customerId}`~~ — **REMOVED FROM THIS ENTRY 2026-09-14 and FIXED in code.** See the update below. Do not cite AR-02 for it.
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

**Update (2026-09-09):** re-flagged twice more by the weekly baseline scan — **H-059** against
`CustomersController` `GetById` / `GetBySourceId` / `GetLinkedTo` / `GetTradeUnits` (a third pass at
the 2026-08-10 finding) and **H-057** against `GET /api/dpcontracts/customer/{customerId}` (a third
pass at the two 2026-08-18 findings). Both **re-accepted — no change**; every route named is already
listed above and already carries an inline AR-02 citation. H-059 restated the process argument —
that a project-level acceptance does not remove the technical exposure and that AR-02's own sign-off
is still pending — which remains the genuine open item, not a code defect. That makes **five**
flags for AR-02 (2026-06-23, 2026-08-10, twice on 2026-08-18, and 2026-09-09).

**H-060 was the one finding in this round that added something.** It flagged `ContractsController`
and correctly observed that four sibling routes — `pacing/{customerId}`, `farm/{farmId}`,
`pricing-lines` and `pricing-lines/by-customer` — were **absent from this entry's route list and
carried no inline AR-02 citation**, while `GetAll` and `GetByCropYear` on the same controller do
carry `[EnforceTradeUnitAccess]`. The scan read that asymmetry as evidence the boundary was intended
to apply and had been missed. Those routes were always within AR-02's rationale — they return the
same `ContractResponse` / `ContractPricingLineResponse` shapes as the already-listed customer route,
so they cross no boundary the customer route does not already cross — but the silence made them look
like an oversight rather than a decision. **The documentation was fixed, not the behaviour:** all
four are now listed above, and each carries an inline AR-02 citation. Triage future hits on them
against this entry.

**Update (2026-09-14):** re-flagged as **H-067** (`codex`) against `GET /api/customers/{id}` "and
related customer-scoped endpoints", and again as the GET half of **H-062** against
`GET /api/producerdetails/customer/{customerId}`.

**H-067 re-accepted — no change.** Its routes are listed above and inline-cited; it explicitly
acknowledges the AR-02 citation and argues the exposure remains concrete, which is true and is
exactly what this entry accepts.

⚠ **The producer-details GET was NOT re-accepted — it is now FIXED, and this entry was wrong about
it for a day.** The first pass kept it here on the stated grounds that scoping it "would break the
linked-producer profile view". The PR scan pushed back, and re-tracing every client path showed that
claim was false:

- the read fires only from `selectCustomer`, and both `filteredCustomers` sources start from
  `customers()` — the entitled roster;
- deep links resolve via `customers().find()` and give up after 5s rather than widening the set;
- the cross-trade-unit linked-producer cache feeds **only** the last-contact badge, never a
  selectable row.

So no client path needed the cross-TU read, and the response carries `ProducerContact` PII — contact
names, phones and emails. `ProducerDetailsService.GetByCustomerAsync` now resolves entitlement before
touching the repository (403 out of scope, 503 fail-closed), sharing one `EnsureCustomerEntitledAsync`
helper with the delete. Three tests, mutation-verified.

**The criterion this establishes, and the reason the other by-customer routes stay:** what earns the
AR-02 exception is *a real client path that depends on the cross-trade-unit read*, not the shape of
the route. `GET /api/notes/customer/{id}` has one — `_ensureCustomerNotes` fetches notes for every
linked-group member, with an inline comment saying the endpoint has no TU filter so linked producers
in unselected trade units are covered. Producer details had no equivalent. Apply that test, per
route, before assuming this entry covers something.

That makes **six** flags for AR-02 — 2026-06-23, 2026-08-10, twice on 2026-08-18, 2026-09-09 and
2026-09-14 — every one self-accepted by engineering. The finding's own suggestion ("obtain formal
security approval if cross-trade-unit access must remain intentional") is the correct one, and it is
not a code change. See **Accepted by** below.

One clarification worth recording, because H-062 read it as a defect: `GetAllAsync` filtering to
entitled trade units while `GetByCustomerAsync` does not is **the app-wide pattern**, implemented
identically in `ProducerDetailsService`, `StoredGrainService` and `DpContractService` — list views
are a relevance default, by-id reads are open by design. It is not an inconsistency to be corrected.

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

**Update (2026-09-09):** re-flagged as **H-058** by the weekly baseline scan (CWE-284, confidence
8/10) against `PUT /api/customers/{id}/trade-units` and `RemoveDormantTradeUnit`, framed as
"manipulation of the authorization data plane itself, not merely an unscoped read". **Re-accepted —
no change.** That framing is fair, and it is the same escalation path the 2026-08-10 update already
records and re-accepted: assigning a producer into a trade unit the caller holds *is* the New Customer
Trade Units onboarding flow, so admin-gating or entitlement-validating it removes the feature. Both
routes already carry inline AR-03 citations.

Worth recording because it will come up again: the suggested fix — calling
`ValidateTradeUnitsOrThrowAsync` for the customer's *current* trade units as well as the requested
codes — cannot work for onboarding. A producer being onboarded is by definition not yet in the trade
unit being assigned, and may be in none at all, so validating the current membership against the
caller's entitlements fails closed on precisely the case the feature exists to serve. Gating to an
admin/onboarding role remains the correct move *if* trade-unit membership ever becomes a hard
security boundary, as the re-evaluation trigger below already states.

**Update (2026-09-14):** re-flagged as **H-064** (`codex`) against `PUT /api/customers/{id}/trade-units`,
with the same "arbitrary trade-unit codes for any customer ID" framing as the 2026-08-10 scan and
H-058. **Re-accepted — no change.** Third pass, no new technical content; the route carries an
inline AR-03 citation. The suggested fix — requiring caller entitlement for the customer's *current*
memberships — still cannot work for onboarding, where the producer is by definition not yet in the
trade unit being assigned. That rebuttal is recorded in the 2026-09-09 update above.

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

**Update (2026-09-14):** re-flagged as **H-065** (`codex`). **Re-accepted — no change.** The finding
restates the 2026-08-10 position, including conceding that the three-character minimum "limits
breadth but does not prevent" a targeted lookup — which is precisely what the min-length hardening
was scoped to do, and why it was never claimed as a fix. Its field-minimization suggestion was
already considered and rejected above for the same reason. The route carries two inline AR-04
citations.

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

**Update (2026-09-14) — AR-05 covers `GET /api/bidsheet/locations` only. The elevators half is
gone.** The entry defended two reads, and its justification only ever fitted one of them:

- **`GET /api/bidsheet/locations` — still accepted, on the terms set out below.** The map genuinely
  needs it: the bid sheet loads every location in one unscoped request, so cross-trade-unit
  visibility here is the product's happy path, not an oversight.
- **`GET /api/bidsheet/elevators` — the route no longer exists.** It was re-flagged as **H-066**
  (`codex`) and fixed on `main` by making `tradeUnitCode` required. This branch went further and
  **deleted the endpoint**, along with its service and repository methods and the client's uncalled
  `getElevators()`, as part of retiring the trade-unit-scoped API surface. Nothing called it, and
  `dbo.ElevatorCache` does not even exist in the Dev database. A deleted route cannot be re-opened
  by accident; if one is ever needed again, it must be written scoped from the start.

⚠ **A bypass worth remembering, recorded on `main` while fixing H-066 and kept here because it
applies to every route, not just that one.** `ValidateTradeUnitsOrThrowAsync` filters blank codes and
returns early on an empty set, so `?tradeUnitCode=` (empty string) passes validation **vacuously**.
Any route that treats a trade-unit parameter as required must reject null/whitespace explicitly
*before* calling the validator — validating is not the same as requiring.

(`main`'s note that writes re-authorize via `AuthorizeLocationByStoredTradeUnitAsync` was true of the
pre-remodel model and is deliberately not carried forward: that method is gone, because there is no
per-row trade unit left to authorize against. What replaced it is set out under "What changed" below.)

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
**⚠ Superseded 2026-09-16 — only DELETE is owner-only now. See the addendum below.**

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

### Addendum — rename and reshare opened to sheet members, 2026-09-16

**A deliberate relaxation, requested by the product owner, recorded here because it widens who can
change who sees a sheet.** The 2026-09-03 addendum above recorded rename, reshare and delete as
owner-only; two of the three no longer are.

| Action on a sheet | Before | Now | Enforced by |
|---|---|---|---|
| Rename | Owner only | **Any member** | `RequireVisibleSheetAsync` |
| Reshare (add/remove members) | Owner only | **Any member** | `RequireVisibleSheetAsync` |
| Delete | Owner only | Owner only — unchanged | `RequireSheetOwnerAsync` |

**Why.** A bid sheet is a shared working list, not a personal document. The people working from it are
the ones who know what it should be called and which colleague needs to be on it, and routing both
through whoever happened to create it made the owner a bottleneck for clerical changes. Deleting is
the one action that cannot be undone and takes the sheet away from everyone on it, so it stays with
the creator.

**The residual risk this adds, stated plainly: a member can widen who sees a sheet they do not own,
and the owner is not notified.** They find out by opening the share dialog. Bounded by:

- A member can only reshare a sheet already shared with them — this grants no new reach to an
  outsider, it lets an insider extend an existing circle.
- Every share row records `SharedBy`, so who widened it is on the record and queryable.
- Sharing a sheet conveys no privilege the recipient did not already have: locations and bids are
  company-wide and readable by every authenticated employee (residual risk 1 above). A sheet is a
  *curated view* of data the recipient could already see. What leaks is the curation — which elevators
  a desk watches — not the prices.
- Authenticated Scoular employees only; internal competitor bid data, no PII.

**A related check that had to move with it.** The rename endpoint tested the new name for uniqueness
against the CALLER's sheets, which was the same set as the owner's while only the owner could rename.
Left alone it would have let a member give the owner two sheets with one name, while rejecting a name
the owner was not using. It now checks the OWNER's list. Not a security fault — a correctness one
that the authorization change created.

**Not done, and worth knowing:** there is no notification to the owner, and no per-sheet setting to
keep resharing owner-only. Both were considered and left out as disproportionate for the data class.

**Re-evaluate if:** which elevators a desk tracks becomes competitively sensitive between desks, or if
sheets are ever used to carry data that is not already company-readable. Either would make the
curation itself worth protecting and should restore owner-only resharing.

**Amended by:** Origination engineering — 2026-09-16.

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
members were validated against the entitlement overlap of **whoever added them** — originally always
the creator; since the 2026-09-02 amendment below, whichever member added them
(`DailyRecapGroupService.BuildValidatedMembersAsync`, fail-closed). Either way it is *somebody else's*
overlap, so mentioning someone else's group can reach people the direct person picker would not have
offered the mentioner — that picker is scoped to users sharing a trade unit with the caller.

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
capped at 250 mention rows per note. Adding a member is still entitlement-validated fail-closed at
group-save time. All recipients are `@scoular.com` by construction.

**Residual risk.** An employee can cause an internal note to be emailed to the members of a group they
belong to but did not create, including people outside their own trade units. Accepted.

### Amended 2026-09-02 — shared editing (any member can edit a group)

An earlier version of this entry listed *"only the creator can modify a group"* among the
compensating controls. **That is no longer true**, and the sentence has been removed above. Edit
rights now equal visibility: anyone who can see a recap group — its creator, or a member directly or
via a member trade unit / trade-unit group — can rename it, add and remove members, change the CC
list, set the delivery method, and toggle the daily recap. **DELETE remains creator-only**
(`DailyRecapGroupService.DeleteAsync` throws `ForbiddenException`; previously a non-creator's DELETE
was a silent no-op that returned 204 and logged a misleading `AUDIT_DELETE`).

**Why this does not widen the finding.** Adding a member is validated against the **editor's**
entitlement overlap exactly as before, because only the **delta** is checked
(`DailyRecapGroupService.BuildValidatedMembersAsync`): members already on the group pass through from
the stored row, and only additions are vetted. So an editor can never introduce a recipient outside
their own scope. Removing and re-adding the same person in one save is a no-op (the row never left
the database); doing it across two saves makes the second one an addition, which is validated. Person
recipient addresses are re-derived server-side as `{MemberId}@scoular.com` for *every* person member
— pass-through included — so the M-025 / M-025a guarantee is unchanged, and pass-through rows keep
their stored `MemberName` so an editor cannot relabel someone else's member.

**New capabilities a member gains, ranked.** All are accepted:

1. **Teams-channel redirect.** A member can switch `DeliveryMethod` to `teams` and point the group's
   recap at a different channel. `RecapGroupRequest.Validate` still pins the destination to the
   Scoular tenant (`*.scoular.com@*.teams.ms`), so it cannot leave the tenant, but a Scoular channel
   can carry B2B guests. Mitigation: the `AUDIT_UPDATE` log line now records `ByCreator`,
   `DeliveryMethod` and `TeamsChannel`, so a redirect by a non-creator is queryable.
2. **CC widening.** A member can add any `@scoular.com` address. Low impact: the recap workflow
   already sends one message per group with every member in `toRecipients` and the CC list in
   `ccRecipients`, so all members already receive the union. This widens the internal recipient set,
   not the content boundary.
3. **Enabled toggle.** A member can start or stop the daily send — a nuisance, not a disclosure.
   Also audit-logged with `ByCreator`.
4. **Emptying the group.** Closed: `RecapGroupRequest.Members` now carries `[MinLength(1)]`, so a
   group cannot be stripped to nothing and silently stop being mentionable.

**Re-evaluate if:** groups become shareable beyond their membership (e.g. an org-wide directory of
groups), note content becomes restricted per producer — at which point AR-02 changes too and the
mention path should be re-scoped alongside it — or the Teams channel becomes a mention recipient
rather than recap-only, which would turn capability 1 into a delivery path for note content.

**Accepted by:** Origination engineering — recorded 2026-08-11, amended 2026-09-02.

**Unchanged by H-056 (2026-09-01):** direct person mentions now have to name an active user, but
group-derived rows are deliberately exempt from that check — they were already validated at
group-save time, and re-checking them here would silently narrow group mentions. See **AR-08**.

---

## AR-08 — Person mentions are limited to real active users, not to the mentioner's colleagues

**Finding** (scan 2026-08-31; **H-056**; HIGH; CWE-284 / OWASP A01:2021). Any authenticated caller
could submit a `person` mention whose id was any internal short name / UPN.
`NoteService.NormalizeMention` verified only the `@scoular.com` domain, so a **hand-crafted API
call** — the client's `@` picker offers no free-typing path — could name any employee, and the
Instant Share Note Logic App would mail the attacker-authored note to them from the privileged
shared mailbox. The scan's suggested fix was to resolve mentions against the caller's own mention
catalog (users sharing an entitled trade unit) and reject anything outside it.

**Update (2026-09-14):** re-flagged as **H-063** (`codex`) against
`NoteService.ValidatePersonMentionsAsync`. **Re-accepted — the 2026-09-01 business decision stands
(re-confirmed 2026-09-14).** The finding adds nothing this entry had not already conceded: it argues
that validation "only confirms the target exists" and that a scoped check should be required, and
the entry below already says exactly that, including that the picker is trade-unit scoped so the
server check would cost real UI users nothing.

**The reason it re-flagged is a citation gap, now closed.** `NoteService` documented the decision in
prose and even cited AR-07 for the adjacent group exemption, but never named **AR-08** — grepping the
codebase for `AR-08` returned zero hits, so nothing connected the code to this entry. The method doc
now cites it. Same failure mode as H-060 and M-039: an undocumented deliberate decision re-flags
every scan.

### Decision: Partially fixed; the caller-scoping half is accepted as residual risk

**What was fixed** (2026-09-01, this change). `NoteService.ValidatePersonMentionsAsync` now rejects
a directly-typed person mention that does not name an **active** user in
`TradeUnitPreferences.dbo.Users` — the same roster the Logic App's `Get_Active_Users` gate consults,
checked one step earlier where it can be refused (`ValidationException`, nothing persisted) instead
of silently dropped at send time. It runs on **create and update** (both funnel through
`BuildMentionsJsonAsync`) and fails **closed**: if the roster can't be read the save is refused with
a 503, matching `ExpandGroupsAsync`. The server also now clears the client-supplied `via` field on
every inbound row, so a forged `"via": "app-group:1"` cannot buy the group-derived exemption.
Separately, **M-036** removed the payload half: the note body, author and customer names are
HTML-escaped before they reach the email (see the Resolved findings table).

The `@` picker (`NotesController.GetMentionCatalog`) was filtered to active users in the same
change, because it reads a **different object** from the check — the trade-unit assignment view,
not `dbo.Users` — and a leaver lingers in the view after being deactivated. On Dev, 2 of 142
assignable people were inactive, so without the filter the dropdown would have offered names the
save then refused. `NotesControllerMentionCatalogTests` pins the two sources together.

**What was NOT done, and why.** Mentions are deliberately **not** restricted to people sharing the
caller's trade units — a business decision taken 2026-09-01: originators must be able to loop in a
colleague outside their own trade units, and the product does not treat trade units as an access
boundary anywhere else (**AR-02**, **AR-07**). Note that the picker *already* offers only
co-workers, so enforcing it server-side would not have changed anything a real user can do through
the UI; the choice is about not hard-coding a boundary the business does not want, and it is
recorded here rather than left implicit.

This also **supersedes part of M-025a's** stated reasoning ("deliberately NOT resolving ids against
Entitlements at write time"). Its two objections were cost and availability coupling; both are
answered by the shape of this check — the lookup is skipped entirely unless a note carries a direct
person mention, is filtered to the handful of ids in question rather than loading the roster, and
fail-closed on outage is already the established policy on the adjacent group path.

**Scope / compensating controls.** Recipients are internal `@scoular.com` addresses **constructed**
server-side, twice and independently (M-025 / M-025a) — no mention can address outside the tenant.
Note content is HTML-escaped in the outbound mail (M-036), so an injected anchor or tracking pixel
renders as literal text. Every note carries server-set author attribution, and mentions are capped
at 250 rows per note. All callers are authenticated Scoular employees.

**Residual risk.** A user who bypasses the UI and crafts an API request can cause an internal note
they authored to be emailed to any **active internal employee**, from the shared mailbox, outside
their own trade units. The content is plain text and attributed to them. Accepted.

**Re-evaluate if:** the shared mailbox is ever trusted for actionable/transactional mail (approval
links, credential resets), or note mentions gain an external-recipient path — either would make
recipient selection a real boundary rather than a routing convenience. The narrower fix is already
scoped: swap the roster lookup for the caller's catalog set
(`IEntitlementsRepository.GetByUserAsync` + `GetUsersByTradeUnitsAsync`, exactly as
`DailyRecapGroupService.BuildValidatedMembersAsync` does).

**Accepted by:** Origination engineering — recorded 2026-09-01. **Security sign-off pending** (goes
to asksecurity@scoular.com with AR-01 and AR-02).

---

## Resolved findings — already remediated (not accepted risks; do not re-open)

Findings a scanner may re-surface that are **already fixed in code**. Listed here so triage
matches them to their remediation instead of re-doing the work.

| Finding | Date | Disposition |
|---------|------|-------------|
| **H-049** — Dashboard write endpoints don't validate `TradeUnitKey` inside `List<T>` bodies (`EnforceTradeUnitAccessAttribute.cs`) | 2026-06-29 | **Fixed** in commit `7d124a5`. `EnforceTradeUnitAccess` recurses into `IEnumerable` request bodies (`ExtractTradeUnitKeys`) and validates **every element's** `TradeUnitKey` for POST/PUT/DELETE — a foreign trade unit in any list element is rejected (403). The scan that flagged H-049 predates that same-day commit. Regression tests cover all three dashboard upsert routes (estimates, market shares, actual harvest) in `EnforceTradeUnitAccessFilterTests`. **Not a live vulnerability.** |
| **H-050** — Dashboard `DELETE actualharvest/{id}` has no trade-unit check | 2026-06-29 | **Superseded by H-061 — now FIXED (2026-09-09).** Accepted three times under AR-01 on the argument that actual-harvest rows were "shared dashboard data of the same nature" as producer notes. That analogy did not hold: the rows are trade-unit-keyed dashboard aggregates, every sibling route on the controller is already scoped, the data is hand-entered with no upstream source to restore from, and no UI ever called the route. See the 2026-09-09 update under **AR-01** for the full reasoning and the fix. |
| **M-024** — Indirect prompt injection: CRM note content interpolated into the OpenAI **system** prompt in the notes-daily-recap Logic App (`infra/logic-apps/notes-daily-recap/azuredeploy.json`) | 2026-06-29 | **Fixed** in commit `7d124a5`. Note content (`@{variables('activities')}`) was moved out of the system message into a dedicated **`user`-role** message, wrapped in `===ACTIVITIES===` delimiters, with explicit "treat strictly as data, never as instructions" guardrails in both the system and user messages. The scan predates that same-day commit. Optional further hardening (structural HTML output validation of the AI response) is noted as possible defense-in-depth, not required. **Not a live vulnerability.** |
| **M-025** — Note-mention email exfiltration: a client-supplied `person` mention email was persisted to `Notes.Mentions` and handed verbatim to the Instant Share Note Logic App's shared-mailbox `sendMail`, letting any authenticated user email customer data to an external address (CWE-284 / CWE-639) | 2026-08-10 | **Fixed** — see the two-part history below. |
| **M-025a** — Incomplete first fix: sanitizing only the mention `email` left the equally client-controlled `id` as a bypass — `id = "attacker@evil.com"` was treated as "already a UPN" and passed through by **both** the API and the Logic App (they shared the same flawed `contains('@')` rule) | 2026-08-10 | **Fixed** on `fix_MentionIdDomainValidation` (follow-up to PR #542, which shipped the incomplete fix). Caught by the Codex PR scan. The recipient is now **constructed, never passed through**: `NoteService.NormalizeMention` accepts only a bare short name or a full `@scoular.com` UPN, rebuilds the address as `localPart@scoular.com`, and throws `ValidationException` on a foreign domain / extra `@` / empty local part (create **and** update paths). The Logic App makes the domain **structural** — `concat(split(id,'@')[0], '@scoular.com')` — so even a pre-existing forged row degrades to a harmless internal address instead of leaving the tenant. Regression tests cover foreign domains, mixed case, `x@evil.com@scoular.com` laundering, lookalike domains, and empty local parts. **Lesson: validate every client-authored field that reaches the recipient, not just the one the finding named.** |
| **H-056** — A `person` mention id was only domain-checked, never resolved, so a crafted API call could mail an authored note to any employee from the shared mailbox (CWE-284) | 2026-08-31 | **Partially fixed; remainder accepted — see AR-08.** `NoteService.ValidatePersonMentionsAsync` now requires a directly-typed person mention to name an **active** user in `TradeUnitPreferences.dbo.Users` (create and update, fail-closed on a roster outage), and the server clears client-supplied `via` so group provenance can't be forged to skip the check. Caller-scoping the mention set to the author's own trade units was **deliberately declined** (business decision 2026-09-01) — that residual is AR-08. |
| **M-036** — The Instant Share Note Logic App interpolated the raw note body, author name and customer name into the `sendMail` HTML, so authored content rendered as markup in mail from the shared mailbox — HTML/link injection enabling internal phishing and tracking pixels (CWE-79) | 2026-08-31 | **Fixed** (2026-09-01). Three `Compose_Safe_*` actions inside `Condition_Has_Recipients` HTML-escape `&`, `<`, `>` (in that order — `&` first, or later replaces would double-encode), and the template interpolates only those outputs; `HTTP_Send_Share_Email` runs after all three. Only those three characters are escaped because every interpolation sits in a **text node**, none inside an attribute. The `subject` is intentionally left raw — it is a plain-text Graph field. The sibling `notes-daily-recap` workflow needed **no change**: its note text reaches the mail only through `Create_HTML_table`, which encodes cell values, and its AI summary is separately escaped. |
| **H-061** — Dashboard `DELETE actualharvest/{id}` performs no per-record or trade-unit authorization: the sequential integer id flows to a bare `FindAsync` + `Remove`, and the class-level `[EnforceTradeUnitAccess]` filter evaluates nothing because the route carries no trade-unit value, so any authenticated user could enumerate ids and destroy another trade unit's actual-harvest rows (CWE-639) | 2026-09-07 | **Fixed (2026-09-09).** `DashboardService.DeleteActualHarvestAsync` resolves the row's own `TradeUnitKey` and calls `ValidateTradeUnitsOrThrowAsync` before deleting — 403 for another trade unit's row, silent 204 no-op for a non-existent id (so the route is not an existence oracle), and 503 fail-closed on an entitlements outage. The audit log records the resolved trade unit, and misses are logged too. Covered by `DashboardActualHarvestDeleteTests` (5 tests, mutation-verified). This route was **removed from AR-01** — see that entry's 2026-09-09 update for why the original H-050 acceptance was mistaken. |
| **M-037** — Instant Share Note Logic App interpolates the user-authored note `Description` and the author display name into a `contentType: "HTML"` Graph `sendMail` body with no encoding, so a note author can deliver arbitrary markup (anchors with attacker-chosen hrefs, fake banners, hidden content) as trusted HTML from the privileged shared mailbox — internal content-spoofing / phishing rather than script execution, since Outlook strips scripts (CWE-79) | 2026-09-07 | **Fixed — duplicate of M-036 above.** The weekly baseline re-flagged the defect against `main` on 2026-09-07 while the fix was still unmerged on `fix_NoteMentionSecurity`; it lands on `main` with that branch, so no separate remediation exists or is needed. See the **M-036** row for the escaping detail, including why the subject stays raw and why the sibling `notes-daily-recap` workflow needs no change. **Deploy note:** merging the template does not change any environment — the `deploy-logic-app-instant-share-note-*` workflow must be dispatched per environment, together with the API half (H-056), because the two are halves of one attack: who can be targeted, and what can be delivered. |
| **H-062 (DELETE + GET halves)** — `DELETE /api/producerdetails/customer/{customerId}` performed no trade-unit authorization at any layer: the sequential `customerId` path segment reached a bare repository delete that hand-cascades to the `ProducerContacts` and `ProducerGrainOnFarm` child rows, so any authenticated user could enumerate ids and destroy another trade unit's producer contact PII and grain-on-farm positions (CWE-639) | 2026-09-14 | **Fixed (2026-09-14).** `ProducerDetailsService.DeleteAsync` resolves the caller's entitled trade units, confirms membership via `GetActiveCustomerIdsInTradeUnitsAsync`, and returns 403 otherwise — with 503 fail-closed on an entitlements outage and a silent no-op when no details row exists, so the route is not an existence oracle. The repository now emits a structured `AUDIT_DELETE` including the cascade counts, and the controller logs misses. Covered by `ProducerDetailsDeleteTests` (5 tests, mutation-verified). **The `GET` was fixed too, one day later.** The first pass left it under AR-02 believing the linked-producer profile view needed the cross-trade-unit read; the PR scan pushed back and re-tracing every client path showed that was false — the cross-TU cache feeds only the last-contact badge, and deep links resolve through the entitled roster. `GetByCustomerAsync` now runs the same `EnsureCustomerEntitledAsync` check before touching the repository, so the `ProducerContact` PII never leaves it for an out-of-scope producer. **`PUT` remains accepted under AR-01** — it has six live callers, two writing to cross-trade-unit linked producers by design, plus an onboarding path that would race freshly-written membership. See AR-01's and AR-02's 2026-09-14 updates. |
| **H-066 (elevators half)** — `GET /api/bidsheet/elevators` returned every elevator across every trade unit when `tradeUnitCode` was omitted, with no entitlement validation (CWE-284) | 2026-09-14 | **Fixed (2026-09-14) — on `main` by scoping, and on `feature_BidSheetRemodelAndBarchartFeed` by deleting the route outright, which supersedes it. What follows describes the `main` fix; on the bid-sheet branch the endpoint, its service and repository methods, the client’s uncalled `getElevators()` and `BidSheetElevatorScopeTests` are all gone, so there is nothing left to scope.** `tradeUnitCode` is now required and validated, and blank is rejected explicitly *before* `ValidateTradeUnitsOrThrowAsync` — which filters blanks and returns early, so `?tradeUnitCode=` would otherwise have passed validation vacuously and fallen through unscoped. Nothing in the client called this route, so the fix costs no behaviour; the client signature was tightened to a required parameter so a future caller fails at compile time. Covered by `BidSheetElevatorScopeTests` (5 cases, mutation-verified). **Only the elevators half was fixed** — `GET /api/bidsheet/locations` remains accepted under AR-05 because the bid-sheet map genuinely needs the unscoped read. |
