# Accepted Security Risks — Grain Originator Portal (Origination)

This document records security findings that have been reviewed and **formally accepted** as
residual risk, with rationale and compensating controls. It is the canonical "security model"
record for intentional deviations from least-privilege defaults. Scanners may continue to flag
these patterns; triage against the AR-IDs below before re-opening.

| ID | Title | Severity | CWE | Status | Accepted | Re-review by |
|----|-------|----------|-----|--------|----------|-------------|
| AR-01 | Collaborative edit/delete of shared producer data (no per-record ownership check) | Medium | CWE-639 | Accepted — engineering only (see *Countersignature* below) | 2026-06-23 | 2027-06-23 |
| AR-02 | Customer-scoped reads not restricted by trade-unit entitlement (no object-level authz) | High | CWE-639 / CWE-284 | Accepted — engineering only (see *Countersignature* below) | 2026-06-23 | 2027-06-23 |
| AR-03 | Rep-driven trade-unit assignment (CustomerTradeUnit membership mutable by any rep) | High | CWE-284 / CWE-639 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-04 | ODS onboarding search exposes producer-master PII to any authenticated rep | High | CWE-284 / CWE-200 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-05 | Bid-sheet **location** reads unscoped across trade units (writes are gated; the elevators half was fixed 2026-09-14) | High | CWE-284 | Accepted | 2026-06-23 | 2027-06-23 |
| AR-06 | Production SQL hostnames / db names in appsettings.Production.json (no credentials) | Low | CWE-200 | Accepted | 2026-06-23 | Before go-live |
| AR-07 | Mentioning a group addresses that group's members, not the mentioner's entitlements — and, since 2026-09-14, may post the note to its Teams channel instead | Medium | CWE-284 | Accepted — engineering only (see *Countersignature* below) | 2026-08-11 (amended 2026-09-14) | 2027-08-11 |
| AR-08 | Person mentions require a real active user, but are not scoped to the mentioner's colleagues | High | CWE-284 | Accepted — engineering only (see *Countersignature* below) | 2026-09-01 | 2027-09-01 |
| AR-09 | The caller's UPN (an email-shaped identifier) is written into the structured log scope of every request | Low | CWE-532 | Accepted | 2026-09-21 | 2027-09-21 |

---

## AR-01 — Collaborative edit/delete of shared producer data

**Finding** (scan 2026-06-22; CWE-639 / OWASP A01:2021 Broken Access Control). The following
mutation endpoints perform no per-record ownership or trade-unit authorization check — any
authenticated user may modify or delete any record by enumerating its ID:

- `NotesController` — `PUT /api/notes/{id}`, `PUT /api/notes/{id}/toggle-pin`, `DELETE /api/notes/{id}`
- `PlantingIntentionsController` — `PUT /api/plantingintentions/{id}`, `DELETE /api/plantingintentions/{id}`
- `ProducerDetailsController` — `PUT /api/producerdetails/customer/{customerId}` (the `DELETE` on the same route was **removed from this entry 2026-09-14** — see the update below)
- ~~`CustomersController` — `PUT /api/customers/{id}`~~ — **LISTED IN ERROR 2026-09-14; ROUTE DELETED 2026-09-21.** M-039 described it as updating producer contact info, farm links and `LinkedProducerIds`, and that description was accepted without opening the repository. It persisted nothing — `CustomerRepository.UpdateAsync` ran an `AsNoTracking` existence probe, logged, and returned, with no `SaveChanges`. Re-flagged as **M-044** (2026-09-21) on the same false premise, at which point the endpoint was found to be dead and **removed outright**. Nothing to accept, and nothing left to flag.
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

> ## Countersignature — decision recorded 2026-09-21
>
> **IT Security countersignature will NOT be sought for AR-01, AR-02 or AR-08.** Decided by the
> project owner (CEgr) on 2026-09-21. These entries stand as **Origination engineering acceptances**
> and that is their final status, not an interim one.
>
> Earlier text in this file — written before the decision — describes taking AR-01/AR-02/AR-08 to
> asksecurity@scoular.com and calls the countersignature "the only thing that closes it". **That
> action is closed as declined.** Those passages are left in place because they record why the
> question was raised, but they are no longer open items and should not be re-raised.
>
> Practical consequence, stated plainly so it is not a surprise: the weekly scanner does not read
> this register, so these entries **will keep re-flagging** — AR-02 is at nine flags. That is now
> expected noise to be matched against this file during triage, not a signal of anything unresolved.

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

**M-039 — ⚠ MIS-TRIAGED 2026-09-14; corrected 2026-09-21 (see the M-044 update below).** It was
recorded as "re-accepted, but it exposed a listing gap" and `PUT /api/customers/{id}` was added to
the route list above as a mutation of producer contact info, farm links and `LinkedProducerIds`.
**That description came from the finding, not from the code.** The route mutates nothing:
`CustomerRepository.UpdateAsync` checks the customer exists, logs, and returns. The listing gap was
real — the route did carry an uncited paraphrase, the H-060 pattern — but the remedy was to explain
that it is a no-op, not to file it under an entry about accepting unguarded mutations.

### Update (2026-09-21) — M-045: a stale premise, and the H-062 fix was incomplete

**M-045** (`claude`, CWE-639, 8/10) against `PUT /api/producerdetails/customer/{customerId}`.

**The authorization half rests on a stale premise — declined.** The finding argues the upsert must
be scoped because the sibling `GET` was "remediated and is now trade-unit authorized", leaving a
read-403 / write-200 asymmetry that lets a caller poison a record they cannot read back. **That GET
scoping was reverted the same day** (2026-09-21) — see the banner at the top of AR-02 and the
comment on `GetByCustomerAsync`. There is no asymmetry: `GET` and `PUT` are both open and both
covered by the register; only `DELETE` is scoped, for the reasons H-062 records. The scan evidently
ran against the intermediate tree.

Independently, the upsert could not take this check even if the premise held: it has six callers,
two of which write to cross-trade-unit LINKED producers by design, plus an onboarding path that
writes details immediately after assigning membership. This is the same check that broke
search-and-click when it was added to the read.

**The audit half was valid, and verifying it exposed a worse gap in the H-062 fix.**

| Path | Before | After |
|---|---|---|
| `UpsertAsync` | plain `LogInformation`, no audit code, no actor | `AUDIT_UPDATE` + `User` + contact/grain counts |
| `DeleteAsync` | `AUDIT_DELETE` + cascade counts, **no actor** | `AUDIT_DELETE` + `User` + cascade counts |

⚠ **The delete gap is the serious one, and it was mine.** The H-062 fix (2026-09-14) was made
specifically to satisfy this entry's "every mutation is attributable" claim. It added the audit
code and the cascade counts **but not the actor**, and `IProducerDetailsRepository.DeleteAsync` did
not even accept a `currentUser`. This is a HARD delete — `Remove()` on the details row plus
`RemoveRange()` on `ProducerContacts` and `ProducerGrainOnFarm` — so no `DeletedBy` survives on any
row. For seven days the most destructive route in the application, which erases hand-entered
producer contact PII with no upstream source to restore from, recorded **who did it nowhere**.
The repository method now takes the acting user and logs it.

**Fifth instance** of a compensating control being thinner than claimed — H-062, H-071, M-041,
M-043, and now the *fix for* H-062. Writing the fix is not the same as verifying it: **re-read the
log line's fields after changing it.** Delete guard re-verified by mutation (3 of 6
`ProducerDetailsDeleteTests` fail with the entitlement check removed).

### Update (2026-09-21) — M-043: planting intentions, and a HARD delete with no attribution

**M-043** (`claude`, CWE-639, 8/10) against `PUT`/`DELETE /api/plantingintentions/{id}` (this entry)
and `GET /api/plantingintentions/customer/{customerId}` (AR-02, listed there). **Both halves
re-accepted** — same reasoning as the notes routes: planting intentions are collaborative forward
crop plans, and a trade-unit predicate restricts nobody who can self-assign trade units.

**But the finding repeats M-041's false claim, and here it matters much more.** It states the
`AUDIT_UPDATE`/`AUDIT_DELETE` lines give "attribution but not prevention". They recorded only
`IntentionId`. And unlike a note:

| | Note | Planting intention |
|---|---|---|
| Delete type | **Soft** — `IsDeleted`/`DeletedAt`/`DeletedBy`, recoverable | **HARD** — `Remove()`, row gone |
| Attribution surviving a delete | `DeletedBy` on the row | **none** |
| Audit line before this fix | no `User` | no `User` |

So deleting another region's forward crop plan left **no trace of who did it anywhere** — the row
was gone and the log line did not name the actor. The update path was safe only incidentally, via
the row's `ModifiedBy`.

**Fixed (2026-09-21):** `AUDIT_CREATE`, `AUDIT_UPDATE` and `AUDIT_DELETE` now carry `User={User}`.
The delete route also gained the AR-01 citation it was missing (only the update had one).

**Fourth instance** of a compensating control being thinner than claimed — after H-062, H-071 and
M-041. The pattern is now unmistakable: **every `AUDIT_` claim in this register has been wrong at
least once. Verify the log line's fields, not just its presence.**

✅ **Durability recommendation — ACTIONED 2026-09-21.** Planting-intention delete *was* a hard
delete of hand-entered forward origination data with no upstream system of record to restore from —
the same durability argument that took the producer-details delete OUT of this entry under H-062.
It is now a **soft delete** (`IsDeleted` / `DeletedAt` / `DeletedBy`, recoverable by flipping the
flag), so the route gives both recovery and row-level attribution.

Approved by the project owner and implemented on branch `fix_PlantingIntentionSoftDelete`
(commit `b49d969d`, off `main`, **not yet merged or deployed** — the migration must be applied per
environment like any other). Two notes for whoever reviews it:

- Reads are filtered by a single `HasQueryFilter` on the model, **not** by Note's per-query
  `!IsDeleted` predicate repeated in eleven places. These rows are SUMMED into trade-unit acreage
  rollups, so one forgotten predicate would be a wrong total with no error. Verified that no raw
  SQL touches `ProducerPlantingIntentions`, since a global filter would not apply to it.
- The `AUDIT_DELETE` line now carries crop, acres and planting year as well as the actor, so the
  log is self-sufficient. That was the actual gap: the M-043 fix recorded *who* and *which id* but
  never *what*, so perfect attribution still could not reconstruct the plan.

**The authorization half of M-043 is unaffected and remains accepted** — this was a data-durability
fix, not an access control. Nothing about who may delete a planting intention has changed.

### Update (2026-09-21) — M-041: notes mutations, fifth pass

**M-041** (`claude`, CWE-639, 8/10) against `PUT /api/notes/{id}`, `PUT /api/notes/{id}/toggle-pin`
and `DELETE /api/notes/{id}` — the fifth flag on this same route set after M-033, M-035 and M-038.
**Re-accepted, no restriction added.** Notes are collaborative by intent; an author-ownership
predicate is the control this entry exists to decline, and a trade-unit predicate would restrict
nobody (see AR-02's banner).

**Two of the finding's factual claims are wrong and must not be carried forward:**

1. *"destroys another originator's customer interaction record"* — **false.** `NoteRepository.DeleteAsync`
   is a **soft delete**: the row survives with `IsDeleted` / `DeletedAt` / `DeletedBy` and is recovered
   by flipping `IsDeleted` back. Nothing is destroyed and the actor is stamped on the row.
2. *"Structured AUDIT_UPDATE/AUDIT_DELETE log lines ... provides after-the-fact attribution"* —
   **it did not.** The four `AUDIT_` lines in `NotesController` recorded `NoteId` and `CustomerId`
   but **not who acted**. Update and delete were still attributable through the row (`ModifiedBy`,
   `DeletedBy`); **toggle-pin was attributable nowhere at all.**

**Fixed (2026-09-21):** all four lines (`AUDIT_CREATE`, both `AUDIT_UPDATE`, `AUDIT_DELETE`) now
carry `User={User}` from `IRequestContextService`.

⚠ **Toggle-pin deliberately does NOT stamp `ModifiedBy`/`ModifiedAt`, and must not be changed to.**
Those fields mean "someone edited the text": `ModifiedBy` feeds NLQ author search ("notes by
<name>") and `ModifiedAt` drives note sort order. Stamping them on a pin would forge authorship and
reorder the list. The audit log line is the correct place for that actor, and now holds it.

**Third instance of this class of error** — after H-062 (AR-01) and H-071 (AR-03), both of which
claimed an `AUDIT_` control that was not implemented. Here the lines existed but recorded the wrong
fields. **The compensating controls in this register must be re-read, not assumed, every time one
is cited.**

### Update (2026-09-21) — M-044: the route this entry listed does not exist as a mutation

**M-044** (CWE-639) re-flagged `PUT /api/customers/{id}` as an unguarded mutation missing both an
entitlement check and an audit trail. **Re-accepted with the listing struck, because the premise is
false.** `CustomerRepository.UpdateAsync` confirms the customer exists, writes a log line, and
returns. Nothing persists. Location, phone and email originate in the ODS and cannot be written
from the app at all; `FarmIds`, `LinkedProducerIds` and `TotalAcres` live on `ProducerDetails` and
are written through those endpoints. There is no write to authorize and no mutation to audit.

Both halves of the finding therefore fall away, and neither needs this entry:

| M-044 asks for | Disposition |
|---|---|
| An entitlement check before the update | No update occurs. And a trade-unit check would not be a control regardless — originators self-assign their trade units. See the banner at the top of AR-02. |
| An `AUDIT_UPDATE` entry for the mutation | There is no mutation to audit. The existing log line records the call. |

**The instructive part is how it got listed.** The 2026-09-14 triage of M-039 accepted the
finding's own description of what the route does and never opened the repository. A scanner
describes what a route *looks* like from the controller down; the register is supposed to record
what it *does*. This is the second register error of its class — AR-01 (H-062) and AR-03 (H-071)
both claimed an `AUDIT_` control that was never implemented. **Rule: before a route enters or
leaves this register, read it to its last layer.**

**Resolution: the endpoint was deleted.** `api.service.updateCustomer` had no caller and no test
referenced it, so the whole surface came out — the controller action, `UpdateCustomerRequest`,
`ICustomerService.UpdateAsync` + `CustomerService.UpdateAsync`, `ICustomerRepository.UpdateAsync` +
`CustomerRepository.UpdateAsync`, and the client wrapper. A route that accepts a body, returns 200
and silently discards the write is worse than no route: it invites a future caller to assume it
worked. Deleting it also permanently ends this finding, which a comment would not have —
documentation has now failed to stop a re-flag twice on this same route.

Verified after removal: backend 533/533, client 601/601 across 51 files, typecheck clean, and no
reference to `updateCustomer` anywhere in `client/src`.

**H-062 — split. `GET` and `PUT` re-accepted; `DELETE` fixed.**

Two of the finding's claims are wrong and should not be carried forward. It states
`ProducerDetailsController` is "the only data controller lacking `[EnforceTradeUnitAccess]`" — it is
not; `NotesController`, `PlantingIntentionsController`, `StoredGrainController` and
`DpContractsController` also lack it, and **no** peer controller guards its by-customer route. It
also reads the `GetAllAsync`-scoped / `GetByCustomerAsync`-open split as an oversight; that split is
the documented app-wide pattern recorded under AR-02 below.

- **`GET`** — ⚠ **this bullet has been wrong twice, and both versions are kept rather than quietly
  edited, because the second mistake is more instructive than the first.**
  - *Version 1 (2026-09-09):* "stays accepted under AR-02 — narrowing it would break the
    linked-producer profile view." Never verified, and false: the linked-producer cache feeds only
    the last-contact badge, not a selectable row.
  - *Version 2 (2026-09-14):* "the GET is now scoped and removed from AR-02." Correct that the
    original claim was wrong, but it drew the wrong conclusion — it treated a trade-unit test as a
    control. **Reverted 2026-09-21.**
  - *Current:* the GET is **unscoped**, stays under AR-02, and a mutation-verified regression test
    pins it that way. Originators self-assign trade units, so the check restricted nobody while
    silently blanking the profile for any producer not yet onboarded. See the banner at the top of
    AR-02.

  The pattern worth keeping: each version was a narrower reading of the evidence than the last. The
  first assumed a dependency without checking; the second checked the callers but not whether the
  control meant anything; only the third asked what a trade unit actually *is* in this product.
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

### Update (2026-09-28) — moving planting intentions between trade units: `POST retag` and the `TradeUnit` field on `PUT`

Two scan findings against the planting-intention trade-unit work that shipped in PR #656
(`fix_PlantingIntentionTradeUnit`):

1. **`POST /api/plantingintentions/retag`** re-tags every planting intention a producer has on
   `fromTradeUnit` to `toTradeUnit`, with `[Authorize]` as the only gate. `toTradeUnit` is checked
   against the **producer's** active trade units; `fromTradeUnit` is not checked at all; neither is
   checked against the **caller's** entitlements, and `[EnforceTradeUnitAccess]` could not fire here
   anyway (the request has no `TradeUnitKey`).
2. **`PUT /api/plantingintentions/{id}`** gained a client-settable `TradeUnit`, applied through the same
   producer-membership check, so any authenticated user can move one row to another trade unit. The
   finding notes this route was already listed here, but argues the new field is not covered.

**Both re-accepted — no caller-entitlement check added.** The technical descriptions are accurate.
The remedy both propose, `ValidateTradeUnitsOrThrowAsync` on the caller, is the one the AR-02 banner
explains is not a control in this application: originators self-assign trade units in Trade Unit
Preferences, so anyone the check refused could join the trade unit and repeat the move a moment
later. It would also break the route's actual caller. Retag runs straight after a producer is
removed from a trade unit, which AR-03 lets any rep do. A caller-entitlement check on `fromTradeUnit`
would therefore refuse exactly the rep doing that legitimate clean-up, and `fromTradeUnit` cannot be
checked against the producer either, because the producer has just left it. Both routes do keep the
rule that does mean something: the **target** must be one of the producer's own active trade units
(`PlantingIntentionService.ResolveTradeUnitAsync`), which is data integrity, not access control.

The finding's comparison with `GetAllAsync` (reads filtered by caller entitlement, fail-closed) is the
documented `GetAllAsync`-scoped / `GetByCustomerAsync`-open split recorded under AR-02. That filter
scopes the list and dashboard views to the caller's trade units; it is a presentation boundary, and
the producer's full planting set is readable through `GetByCustomerAsync` by design.

**What the review found missing, and fixed (2026-09-28).** Following the M-043 rule — verify the
log line's fields, not just its presence — the compensating control on these two routes was thinner
than this entry's rationale claims:

| Route | Audit line before | Gap | Fixed |
|---|---|---|---|
| `POST retag` (controller `AUDIT_UPDATE`) | customer, from, to, count | **no actor** — the same gap M-043 closed on create/update/delete | `User` added |
| `POST retag` (repository line) | count, customer, from, to | after the move the rows are indistinguishable from those already on the target, so the move could not be undone | `User` and the moved `IntentionIds` added |
| `PUT {id}` (`AUDIT_UPDATE`) | id, new trade unit, user | **no previous trade unit**, so a move could not be traced or reversed | `FromTradeUnit` added |

Each moved row also carries `ModifiedBy` / `ModifiedAt`. Covered by
`PlantingIntentionsControllerTests.Retag_ReturnsTheNumberOfRowsMoved` and
`Update_ThatMovesTheTradeUnit_AuditsWhereItCameFromAndWho`, and by `PlantingIntentionRetagTests`
(live rows only, soft-deleted rows stay put, ids and actor logged). The retag assertion was
mutation-verified: removing `User` from the line fails it. Both controller actions carry inline
citations to this update.

**Re-evaluate if** trade-unit membership stops being self-service, at which point caller-entitlement
checks become meaningful on every route in this entry, not only these two.

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

> ### ⚠ READ THIS BEFORE TRIAGING ANY FINDING AGAINST THIS ENTRY
>
> **A trade-unit check is not an access control in this application, and cannot be made into one.**
> Originators **self-assign** their own trade units through the Trade Unit Preferences app. Anyone a
> trade-unit test refuses can open that app, join the group, and load the same producer legitimately
> seconds later. The test therefore narrows nothing — it only adds a detour, and it breaks
> onboarding candidates outright (see below). This is what the nine *"trade units are a UX filter,
> not an access boundary"* comments across the API mean, stated plainly.
>
> Every scan finding against this entry proposes the same remedy — resolve the owning trade unit and
> call `ValidateTradeUnitsOrThrowAsync`. **That remedy does not do what it appears to do.** It is not
> a weaker control than the finding wants; it is not a control at all. Saying so is the answer to
> this whole class of finding, and it is a better answer than the per-route caller traces recorded
> further down (which are true, but secondary).
>
> **Proven the hard way, 2026-09-21.** A trade-unit check was added to
> `GET /api/producerdetails/customer/{customerId}` on 2026-09-14 in response to H-062, and reverted
> a week later. It did not restrict anyone — but ODS **onboarding candidates** carry a real
> `CustomerId` with **no `CustomerTradeUnit` row at all**, so the membership test refused them.
> `handleSelectCustomer` swallows that error, and the details fetch gates
> `_fetchMissingLinkedProducers`, `_loadCustomerData` and `_ensureCustomerNotes` — so searching for a
> producer you had not yet onboarded opened a **blank profile with no error**. The product
> requirement it broke: *an originator may search for and open any producer.*
>
> `IUserEntitlementService.ValidateCustomerAccessAsync` documents this exact trap — "it fails CLOSED
> when a customer has no trade-unit mapping" — and is deliberately never wired for that reason. The
> 2026-09-14 change reimplemented it by hand anyway. **Before adding any entitlement test to a read,
> ask what happens to a producer with no trade unit yet.**
>
> Two trade-unit checks remain in the codebase, on the producer-details `DELETE` and the bid-sheet
> `elevators` read. Both are **speed bumps on routes nothing calls**, kept because they cost nothing
> and deter a blind id sweep. Neither is evidence that producer data is entitlement-protected.

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
- `GET /api/producerdetails/customer/{customerId}` (briefly scoped 2026-09-14, **reverted 2026-09-21** — see the banner at the top of this entry; the check was not a control and broke onboarding candidates)
- `GET /api/dpcontracts/customer/{customerId}` (added 2026-08-18 — see the update below)
- `GET /api/storedgrain/customer/{customerId}` (added 2026-09-21 per **M-040** — **a listing gap, not
  a new decision.** Returns warehouse-receipt positions by commodity — quantities, storage rates,
  storage days and receivable amounts — read live from `ctrm.vw_GNTA39D1`, so the accepted exposure
  here is real and not an empty payload. The route has always had the same unscoped-by-design shape
  as its `dpcontracts` sibling: `StoredGrainService.GetByCustomerAsync` deliberately applies no
  entitlement scoping while `GetAllAsync` does, the documented app-wide split. It was simply never
  written down here, and the sibling controller carried an inline AR-02 citation while this one did
  not. Found independently by the weekly scan (M-040) and the Code Quality Dashboard pilot audit
  (PR #613). The inline citation now exists too. Third time this entry has been extended for a route
  that was deliberate but unlisted — H-060, M-039, and now this — which is itself the argument for
  adding a route the moment the decision is made rather than when a scan finds it.)

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

⚠⚠ **THIS PARAGRAPH IS SUPERSEDED — the scoping it describes was REVERTED on 2026-09-21.** It is
kept rather than deleted so the reasoning, and its error, stay on the record. What follows was
written on 2026-09-14 and was wrong at the level of principle, not detail: it treated a trade-unit
test as a control, which in this application it is not. See the banner at the top of this entry.

~~The producer-details GET was NOT re-accepted — it is now FIXED, and this entry was wrong about
it for a day.~~ The first pass kept it here on the stated grounds that scoping it "would break the
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

### Update (2026-09-21) — M-040: the last uncited customer-scoped read

**M-040** (`claude`, CWE-639, 8/10) against `GET /api/storedgrain/customer/{customerId}`.
**Re-accepted, listed above, and cited in code.** No behaviour change.

The finding is accurate on every point, including the one that matters: *"Unlike the neighbouring
controllers this route carries no risk-register citation or documented rationale."* It was the only
customer-scoped read of its shape missing from this list — eight siblings were here, this one never
was, and `StoredGrainController` contained no AR reference at all. That is the **fourth** time this
exact gap has produced a finding, after H-060 (`ContractsController`), M-039 (`PUT /api/customers/{id}`)
and M-042 (the notes reads). **An undocumented deliberate decision re-flags every single scan.**

Why it stays accepted: scoping it restricts nobody, because originators self-assign their trade
units in the Trade Unit Preferences app (see the banner at the top of this entry). And the split the
finding reads as inconsistent — `GetAllAsync` entitlement-scoped, `GetByCustomerAsync` open — is the
documented app-wide pattern, followed identically by `ProducerDetailsService` and `DpContractService`:
the list view scopes for relevance, the per-producer read does not gate.

⚠ **The data is real — do not dismiss this route as empty.** An internal note had recorded
"StoredGrain service returns stubs". That is **false**: `StoredGrainRepository` runs live SQL against
`ctrm.vw_GNTA39D1` (latest warehouse receipts, deduplicated per receipt/location/customer) joined to
the elevator master, returning quantities, storage rates, storage days and receivable amounts. The
accepted risk is therefore genuine: any authenticated employee can read any producer's storage
position. Accepted on the same basis as the rest of this entry, not on a belief that the payload is
empty. (Only some *fields* on the entity are unmapped, which is presumably where the stub note came
from.)

### Update (2026-09-21) — M-042: the notes reads, re-accepted with citations added

**M-042** (`claude`, CWE-200, 7/10) against `GET /api/notes` (`NotesController.cs:43`),
`GET /api/notes/last-contact` and `GET /api/notes/customer/{id}`. **Re-accepted, no behaviour
change** — all three are already listed in this entry's route list above, and the reasoning has
been in `NoteService` all along: trade units scope WHICH producers a rep works, not which of a
producer's notes are visible, so the badge, the profile and NLQ search all see one consistent set.
Its suggested fix — scope the notes to the caller's entitled trade units — restricts nobody,
because originators self-assign those trade units. See the banner at the top of this entry.

The finding is right that client-side narrowing is not a control, and right that the payload
crosses the trust boundary. That is the accepted risk, stated plainly: **any authenticated Scoular
employee can read any producer note.** It is accepted because the alternative check is not a check.

**What did need fixing: the citations.** The finding points at `NotesController.cs:43`, and only
`GetByCustomer` carried an AR-02 reference — `GetAll` and `GetLastContact` had accurate comments
with no AR number, so a reader starting at the controller saw an undocumented unscoped read. Both
now cite AR-02. Same failure mode as H-060 and M-039.

### Update (2026-09-21) — THREE AR-02 findings in one weekly batch: H-069, H-073, H-075

All three come from the same scanner on the same date, all re-accepted with no behaviour change,
and **all three land on routes that share one dependency.** Read this section before triaging any
future by-customer finding — it is the trace those findings keep rediscovering.

#### The linked-producer dependency (the reason these routes are unscoped)

`handleSelectLinkedCustomer` in `home.component.ts` handles a user clicking a **linked producer**.
It has an explicit else-branch for the case where that producer is **not** in the caller's roster —
commented *"Linked customer is in a different trade unit — fetch them from the API"* — which fetches
them via `GET /api/customers/{id}` and then calls `_loadCustomerContractsAndTickets` and
`_loadCustomerData` on them. `_fetchMissingLinkedProducers` separately pulls in linked producers
absent from `customers()` via `GET /api/customers/by-source/{sourceId}`, plus the reverse-link
lookup `GET /api/customers/linked-to/{sourceId}` so producers who link *to* this one appear in the
dropdown.

Everything that loader touches is therefore reached cross-trade-unit **by design**:

| Finding | Routes | Reached via |
|---|---|---|
| **H-069** | contracts by-customer / pacing / by-farm / pricing-lines (×2) | `_loadCustomerContractsAndTickets` |
| **H-073** | customers by-id, by-source, linked-to | `handleSelectLinkedCustomer`, `_fetchMissingLinkedProducers` |
| **H-075** | dpcontracts by-customer | `_loadCustomerContractsAndTickets` (same loader as H-069) |

Every one of these findings suggests the same fix — resolve the owning trade unit and call
`ValidateTradeUnitsOrThrowAsync` — and that fix would 403 this path and break the linked-producer
profile. **This is one accepted design reported three times in a week, not three exposures.**

#### H-075 specifically — the "financial exposure" framing was already answered

H-075 (`claude`, CWE-639, confidence 8/10) presents `ReceivableAmount`, `PrepaidAmount`,
`UnearnedStorageAmount`, `UnpaidHandlingAmount`, `StorageRate` and `StorageDays` as a distinct class
of exposure. They are not a first crossing: the **already-accepted**
`GET /api/contracts/customer/{customerId}` returns `Price` and `TotalValue` — the dollar value of a
producer's contracts — plus `SettledQuantity` and `OpenBalanceQuantity`, org-wide. That analysis was
written into this entry on 2026-08-18 specifically so a later scan would not relitigate it. This is
that scan. `DpContractsController` already carries its inline AR-02 citation; no code change.

#### The exception worth keeping straight

`GET /api/customers/{id}/trade-units` (H-073) is **not** part of the linked-producer flow — it feeds
the edit dialog's membership list and rests on this entry's general position instead. The code says
so at the call site. Do not extend the linked-producer defence to it.

#### Detail

**Update (2026-09-21):** re-flagged as **H-069** (`claude`, CWE-639, confidence 9/10) against the
five `ContractsController` by-customer / by-farm / pricing-line routes — the same five H-060 added
to the list above on 2026-09-09. **Re-accepted — no change.** All five already carried inline AR-02
citations, so nothing was undocumented this time; this is a straight re-flag of the accepted
exposure, which the finding is correct to say still exists.

**This is the SEVENTH flag on AR-02** — 2026-06-23, 2026-08-10, twice on 2026-08-18, 2026-09-09,
2026-09-14 and 2026-09-21 — every one self-accepted by Origination engineering.

Applying the caller test to these routes settles them the opposite way from H-062, and the evidence
is concrete: `handleSelectLinkedCustomer` in `home.component.ts` has an explicit else-branch for a
linked producer who is **not** in the caller's roster — commented *"Linked customer is in a
different trade unit — fetch them from the API"* — which then calls `_loadCustomerContractsAndTickets`
on that producer. The suggested fix (resolve the owning trade unit, validate the stored value) would
403 that path and break the linked-producer profile. Producer details had no equivalent caller and
was therefore scoped; contracts does, and stays.

Checked at the same time, because the H-062 fix touched this area: `getProducerDetails` still has
exactly one call site (`handleSelectCustomer`), and the cross-trade-unit linked path does **not**
reach it — it reads producer details from the already-filtered map. The 2026-09-14 scoping did not
break the linked-producer view.

**What changed:** comments only. The five routes said "no per-producer object-level authz by design"
without naming *which* design, so the finding's "the asymmetry is self-evident in the same file"
argument had nothing in the code to answer it. `GetByCustomer` now carries the full explanation and
the other four point at it. Expect this to re-flag anyway — unlike H-060 and H-068, the gap here was
not documentation. **The countersignature is the only thing that closes it.**

**H-073 detail.** The *second* AR-02 finding in the same weekly round
(`claude`, CWE-639, confidence 9/10), against `GetById`, `GetBySourceId`, `GetLinkedTo` and
`GetTradeUnits` — the same four routes as H-059 (2026-09-09) and H-067 (2026-09-14).
**Re-accepted — no change.**

Three of the four have a proven cross-trade-unit caller, the same evidence that settled H-069:

- **`GetById`** — `handleSelectLinkedCustomer` fetches a linked producer who is not in the roster,
  commented *"Linked customer is in a different trade unit — fetch them from the API"*.
- **`GetBySourceId` / `GetLinkedTo`** — `_fetchMissingLinkedProducers` looks specifically for linked
  producers **absent** from `customers()` and fetches them, plus the reverse-link lookup so
  producers who link *to* this one still appear in the dropdown.

The suggested stored-trade-unit re-authorization would 403 all three and break linked producers.

**`GetTradeUnits` is the exception and is now documented as such.** It is not part of the linked-
producer flow — it feeds the edit dialog's membership list — so it rests on AR-02's general position
rather than on a cross-TU caller. H-073 adds a chaining argument: it hands an attacker the trade-unit
codes to aim at `AssignTradeUnits` (AR-03). That chain is real but adds nothing, since AR-03 already
accepts that any rep may assign trade units, and every rep can read the codes from their own picker.
Lumping this route in with the other three would have overstated the defence, so the code now says
which argument each route rests on.

⚠ **Two AR-02 findings landed in the same 2026-09-21 batch (H-069 and H-073), from the same
scanner.** That is not new exposure — it is one accepted risk being reported twice in one week. The
entry has now been flagged on seven separate dates and always self-accepted by engineering. No
further comment, citation or route note will change that; the finding asks for a decision
engineering cannot make alone.

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

**Update (2026-09-21) — re-accepted, but the audit half of this entry's compensating control was
only half-implemented, and is now fixed.** Re-flagged as **H-071** (`claude`, CWE-284, confidence
9/10), the strongest framing so far: *"privilege escalation via unguarded mutation of the
authorization data plane"* — attach a producer to a trade unit you hold, and they become legitimately
visible through the **guarded** endpoints. That escalation path is real and this entry has accepted
it since 2026-06-23; it is the New Customer Trade Units onboarding flow.

Three suggestions, three different answers:

1. **`[Authorize(Policy = "AdminOnly")]` — declined, fifth time.** Admin-gating removes rep-driven
   onboarding, which is the feature. Unchanged from 2026-08-10, H-058 and H-064.
2. **`ValidateTradeUnitsOrThrowAsync` on the submitted codes — declined, because it does not do what
   the finding wants.** The attack it describes is "attaching a high-value producer to a trade unit
   they **are** entitled to". Validating submitted codes against the caller's own entitlements lets
   exactly that through — the attacker is assigning to their own trade unit. It would only block
   assigning to a trade unit the caller does **not** hold, which is not the described attack, and
   would add a restriction on legitimate cross-desk corrections without closing anything. Note this
   is a *different* suggestion from the one rebutted under H-058 (which validated the customer's
   **current** memberships and fails closed on onboarding); both fail, for different reasons.
3. **`AUDIT_UPDATE` on the assignment — ADOPTED. This one found a real gap.**

⚠ **The compensating control below was half-true.** It claims "mutations are attributable (audit
logging + `CreatedBy`/`ModifiedBy`/`IsActive` soft-delete)". The row stamps were always there, and
`DeactivateTradeUnitAsync` did emit a proper `[AUDIT_UPDATE] [DataMutation]` line — but
`AssignTradeUnitsAsync`, the write that actually rewrites the authorization mapping, logged a bare
`LogInformation` with **no audit code and no acting user**. It was not queryable as an audit event.
It now emits `AUDIT_UPDATE` with the caller and the **before / after / deactivated** code sets, the
before-set snapshotted ahead of the reconcile loops that mutate those entities in place.

**This is the second time a stated compensating control in this file turned out not to be
implemented** — H-062 found the same thing under AR-01 on the producer-details delete. When an entry
leans on a control, verify it **per route**, in the code, rather than trusting the entry.

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

**Update (2026-09-21):** re-flagged as **H-072** (`claude`, CWE-200, confidence 8/10). **Re-accepted
— no change.** Fourth pass. Two suggestions, and they need different answers:

1. **"Scope the ODS search to the caller's entitled trade units by joining through
   `dbo.CustomerTradeUnit`" — structurally impossible, not merely disruptive.** This search exists
   to find producers who are in CTRM but have **no contract or ticket yet**, and such a producer has
   no `CustomerTradeUnit` row at all. The join would return zero rows for precisely the population
   the feature serves. The client confirms the shape: `customer-list.component.ts` fires the ODS
   lookup only as a fallback — when the scoped search returns **nothing**, no trade unit or group is
   selected, and the term is ≥3 characters — and tags the results `isOnboardCandidate`. Scoping it
   by trade unit would mean the onboarding search could only find producers already onboarded.

2. **"Gate it behind a dedicated policy/role" — DECLINED as a product decision, 2026-09-21.** The
   user was asked directly and the answer was explicit: *there should not be a guard on searching
   for producers.* Any originator may look a producer up. This is not a security judgement to be
   revisited by the next scan — it is the same product direction AR-03 records for rep-driven
   onboarding ("originators onboard producers"), re-accepted there three times. A role gate would
   contradict AR-03, and would need a new Entra app role to implement.

The finding is right that the three-character minimum and `TOP 50` cap are not authorization
controls. AR-04 has never claimed they were — they bound bulk extraction, and the acceptance rests
on the trusted internal population, not on them.

No code change: the route already carries two inline AR-04 citations and this finding does not rest
on an undocumented asymmetry, so there is nothing a comment would answer.

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

## AR-05 — Bid-sheet location/elevator reads unscoped across trade units

**Finding** (scan 2026-06-23; HIGH; CWE-284). `GET /api/bidsheet/locations` and
`GET /api/bidsheet/elevators` become unscoped when the `tradeUnitCode` query parameter is omitted:
`BidSheetController` only validates entitlements when the parameter is present, and the service then
returns every location (with its full `Bids` collection) / every elevator across all trade units. Any
authenticated user can read bid-sheet data outside their assigned trade units by omitting the filter.

**Update (2026-09-14) — AR-05 NARROWED to `GET /api/bidsheet/locations`. The elevators read is
FIXED, not accepted.** Re-flagged as **H-066** (`codex`). Re-examined, and the entry's justification
only ever covered half of what it defended:

- **`GET /api/bidsheet/locations` — re-accepted.** The map genuinely needs it.
  `_loadAllMapLocations` and the All-Producers refresh in `bid-sheet.component.ts` both call the
  parameterless read, so cross-trade-unit visibility here is on the product's happy path.
- **`GET /api/bidsheet/elevators` — fixed.** `tradeUnitCode` is now **required** and validated.
  Nothing in the client ever called it (`getElevators()` in `api.service.ts` had no caller), so the
  map rationale never applied and requiring a scope costs no behaviour. The client signature was
  tightened from optional to required in the same change, so a future caller fails at compile time
  rather than with a runtime 400.

One correction to the finding: it implies the write side is exposed too. It is not — mutations
re-authorize against the row's **stored** trade unit via
`BidSheetService.AuthorizeLocationByStoredTradeUnitAsync`, not the client-supplied one, added as an
earlier AR-05 fix. A client cannot escalate by sending a trade unit it happens to hold.

⚠ **A bypass worth remembering, found while fixing this.** `ValidateTradeUnitsOrThrowAsync` filters
blank codes and returns early on an empty set, so `?tradeUnitCode=` (empty string) passes validation
**vacuously**. On the elevators route that would have fallen straight through to the unscoped
repository path. Any route that treats a trade-unit parameter as required must reject
null/whitespace explicitly *before* calling the validator — validating is not the same as requiring.

**Update (2026-09-21):** re-flagged as **H-068** (`claude`, CWE-284, confidence 8/10) against the
remaining half, `GET /api/bidsheet/locations`. **Re-accepted — no behaviour change.**

The finding's central argument is that the sibling `GetElevators` requires `tradeUnitCode`, so "the
correct pattern is known to this codebase" and locations is an oversight. **That contrast is an
artifact of the 2026-09-14 fix above, not evidence of a miss** — the two routes were separated on
whether a client path actually depends on the unscoped read, the same test that settled H-061 and
H-062. Elevators had no caller at all; locations is load-bearing:

- `bid-sheet.component.ts` references `allMapLocations` in **24 places**.
- `_loadAllMapLocations` feeds the ~4,000-pin catalog map; the no-TU-selected refresh path reloads
  through it; and with no trade unit active the entire flattened location view *is* `allMapLocations`.
- The crop and crop-year filter lists are derived from `allMapLocations().flatMap(l => l.bids)`, so
  **the bids are needed cross-trade-unit too** — serving pins without prices would not work either.

Both suggested fixes therefore break the feature. Requiring `tradeUnitCode`, or defaulting the scope
to the caller's entitled set, leaves a rep seeing only their own bids — the one thing the catalog
map exists to look past.

On the empty-string point: `?tradeUnitCode=` returning everything is **not** a bypass here. Omitting
the parameter is the documented intent, so blank behaving identically is consistent. That only
mattered on elevators because the parameter became *required* there.

**What did change:** the asymmetry now explains itself at the call site. The `GetLocations` comment
previously said only "cross-TU visibility is a feature" and never said why its sibling differs, so a
scanner comparing two near-identical routes reasonably read the difference as an oversight. Same
failure mode as H-060, M-039 and H-063 — a deliberate decision that the code does not state gets
rediscovered every scan. **Lesson: when a fix makes two sibling routes behave differently, document
the difference at the point of the difference, not only in this file.**

### Decision: Accepted (locations only — see the 2026-09-14 and 2026-09-21 updates above)

**Rationale.** Cross-trade-unit *visibility* of bid-sheet locations and bids is **intended** — the
frontend deliberately loads all locations for the map view, and reps benefit from seeing the wider
bid picture. The authorization boundary that matters for bid sheets is **mutation**, and that is
enforced: every write path validates the caller's trade-unit entitlement —
`POST/PUT/DELETE /locations`, `DELETE /locations/{id}/bids/...`, `POST /bids/bulk`, and the
`cropyears` / `commodities` / `bidmonths` / `location-order` endpoints all call
`ValidateTradeUnitsOrThrowAsync`. A user can only **edit** trade units they are entitled to; the
broad read is a deliberate product decision, not financial/PII data.

**Scope / compensating controls.** Authenticated Scoular employees only; the unscoped path is
**read-only**; all bid-sheet mutations are entitlement-gated; data is internal bid info (no PII).

**Residual risk.** An employee can read bid-sheet locations/bids outside their trade units. Accepted
as intended visibility.

**Re-evaluate if:** bid pricing becomes competitively sensitive *between* trade units such that a
read boundary is required. At that point, scope the omitted-parameter path to the caller's allowed
trade units (derive server-side via `IUserEntitlementService`) instead of returning all.

**Accepted by:** Origination engineering — recorded 2026-06-23.

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
   **Widened 2026-09-14 — this is now a delivery path for note content; see the amendment below.**
2. **CC widening.** A member can add any `@scoular.com` address. Low impact: the recap workflow
   already sends one message per group with every member in `toRecipients` and the CC list in
   `ccRecipients`, so all members already receive the union. This widens the internal recipient set,
   not the content boundary.
3. **Enabled toggle.** A member can start or stop the daily send — a nuisance, not a disclosure.
   Also audit-logged with `ByCreator`.
4. **Emptying the group.** Still closed, by a narrower rule since 2026-09-14: `[MinLength(1)]` was
   replaced by a check in `RecapGroupRequest.Validate` that permits an empty member list **only**
   under Teams delivery, where the channel rather than the members is the recipient. Email delivery
   still requires at least one member, so such a group cannot be stripped to nothing and silently
   stop being mentionable.

---

### Amendment 2026-09-14 — the Teams channel IS now a mention recipient

The trigger this entry named has occurred, deliberately. A group's **`DeliveryMethod`** is now its
whole routing decision: setting it to `teams` sends **both** the daily recap and any @-mention of the
group to its channel, and the members are not emailed at all (`NoteService.ExpandGroupsAsync` skips
expansion; the Instant Share Note workflow's `HTTP_Send_Channel_Post` delivers it). Capability 1
above therefore now redirects **note content**, not just the daily recap — and because it rides on
the existing delivery method rather than a new opt-in flag, **an existing Teams group's @-mentions
change destination from its members to its channel the moment this ships.** Re-assessed and **still
accepted**, on these grounds:

- **The destination is never client-authored.** The stored mention row is `{type:"app-group","id":"7"}`
  with no address — `NormalizeMention` drops `email` on every non-person row. The workflow reads
  `TeamsChannelEmail` from `dbo.DailyRecapGroups` at send time. This is the same property M-025 /
  M-025a established for person recipients, reached the same way.
- **The tenant pin is enforced twice, by different code.** `RecapGroupRequest.Validate` rejects a
  non-Scoular channel on save; the workflow independently re-checks the shape it read before sending,
  so a row edited directly in SQL cannot become an exfiltration path. A Teams group with a missing or
  malformed address **fails the run** rather than silently notifying nobody.
- **The content boundary is unchanged.** A note is already visible to every authenticated user
  (AR-02), and every recipient remains inside the Scoular tenant.
- **It is visible, not covert.** The picker labels such an entry "Posts to Teams channel", the card
  carries an "@-mentions post to channel" badge, and create/update are audit-logged with the flag.

**Residual, accepted:** a Scoular Teams channel may contain B2B guests, so a note can reach a guest
who would not receive the equivalent email. Unchanged in kind from the recap path accepted in 2026-08;
what changed is the volume and immediacy of what flows through it. No per-channel allowlist and no
approval step on registering a channel — any user may point an entry at any Scoular channel, which is
the behaviour the business asked for.

**Extended 2026-09-14 (same day) — channels are now mentionable directly.** A second, lighter path
was added: the composer lists the Teams channels the SIGNED-IN USER belongs to (delegated
`Team.ReadBasic.All` + `Channel.ReadBasic.All`, held on the **API** registration and called
**on-behalf-of** the user) and picking one registers it in `dbo.TeamsChannels`, after which **anyone**
may mention it. Assessed as no material change to this entry's risk:

- **Scoping is stronger, not weaker, than the group path.** A user is only ever offered channels they
  personally belong to, enforced by Microsoft rather than by our code. On-behalf-of preserves that:
  the exchange carries the caller's identity, so Graph applies the same membership check it would
  have applied to a token issued to the browser. The registry is then open to
  everyone, which is the same "a group addresses its own members, not yours" property already
  accepted here.
- **The address handling is identical.** The note stores the registry id; the workflow reads the
  address and re-checks the Scoular-tenant shape; a bad row fails the run.
- **No new write capability.** `ChannelSettings.ReadWrite.All`, which would let the app create channel
  email addresses, was deliberately NOT requested. Channels without an address simply do not appear.

Gated behind `teamsChannelMentionsEnabled`, off in QA and production until consent is granted.

**Migration note for whoever ships this.** Because routing now rides on `DeliveryMethod`, every
PRE-EXISTING group already set to `teams` silently changes behaviour on deploy: its @-mentions stop
emailing its members and start posting to its channel. Dev held exactly one such group at the time of
writing (`Intermountain`, one member). **Count the `teams` groups in QA and PROD before promoting**
(`SELECT Id, Name, Enabled FROM dbo.DailyRecapGroups WHERE DeliveryMethod = 'teams'`) and tell their
creators, or the change looks like mentions silently going missing.

**Re-evaluate if:** groups become shareable beyond their membership (e.g. an org-wide directory of
groups), note content becomes restricted per producer — at which point AR-02 changes too and the
mention path should be re-scoped alongside it — or Scoular begins admitting B2B guests to channels
that carry producer data, which would make the residual above material rather than theoretical.

**Accepted by:** Origination engineering — recorded 2026-08-11, amended 2026-09-02 and 2026-09-14.
**Security sign-off pending** — take this amendment to asksecurity@scoular.com together with AR-01,
AR-02 and AR-08.

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

**Update (2026-09-21):** re-flagged a **third** time, same route, same suggested fix. **Re-accepted —
the 2026-09-01 business decision stands, now confirmed three times.** The code already carries the
AR-08 citation added on 2026-09-14, so this is not a documentation gap.

**A stronger rationale than the one recorded above, and it should be the first answer given.** Every
version of this finding proposes intersecting mentions with "the caller's entitled roster" — people
sharing a trade unit with the caller. **Trade units are self-assigned** through the Trade Unit
Preferences app, so a caller blocked from mentioning someone can join a trade unit that person is in
and the check then passes. Like the read checks discussed in AR-02's banner, it is a speed bump, not
a control. It is a slightly firmer speed bump than the read case — joining a trade unit is a
deliberate, recorded act, where a crafted API call is not — but it prevents nothing.

⚠ **One part of this finding the trade-unit argument does NOT dispose of, recorded so it is not
lost.** Its sharpest point is not read access but **delivery**: the note is mailed from a *shared
mailbox* to the named person, so the recipient passively receives producer commercial content
without ever choosing to look at it. "They could have joined the trade unit anyway" answers a read;
it answers a push less well, because no act is required of the recipient. The accepted position is
unchanged and was taken with the exposure understood — `NormalizeMention` keeps the address in-tenant
so this cannot leave Scoular, and the population is trusted employees. But if this entry is ever
revisited, **that is the argument to revisit it on**, not the entitlement one.

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

## AR-09 — The caller's UPN is written into every request's structured log scope

**Finding:** `RequestContextMiddleware` resolves `preferred_username` — the user's UPN, e.g.
`CEgr@scoular.com` — and puts it in the `UserId` field of the `BeginScope` that wraps every
request's logs. Every `ILogger` call inside the request inherits it, so it also becomes a queryable
custom dimension on every App Insights trace. The style guide prefers a stable non-sensitive
identifier (an object id) over an email-shaped one when a user identifier is needed
(`logging.user-upn-logged-on-every-request`, CWE-532).

**Accepted, because the UPN is the point.** This is an internal line-of-business app where every
user is a Scoular employee, and the logs exist to answer "who did this" during an incident or an
access review. An `oid` GUID satisfies the letter of the guide and makes that question
unanswerable without a second lookup against Azure AD — which is exactly the lookup you can't do
quickly at 2am. The same short name is already the identity key in `UserActivity`,
`UserTradeUnitSnapshot` and the entitlements view, so an `oid` in logs wouldn't even join to our
own tables without translation.

**What makes the residual risk low:**

- The identifier is a corporate work email, not customer PII. It is not a credential, and it
  discloses nothing that the Azure AD directory doesn't already expose to every employee.
- Scope is Scoular-internal only — the app is not multi-tenant and has no external accounts
  (see [SECURITY-MODEL.md](../docs/application-context/SECURITY-MODEL.md)).
- Access to the logs is itself controlled: Log Analytics / App Insights in the Scoular tenant, not
  a customer-reachable surface.
- It is the *only* identifier logged. No passwords, tokens, or customer PII go into the scope —
  `CorrelationIdMiddleware` now also validates the inbound `X-Correlation-Id` before it reaches
  the same scope, so a caller can't inject arbitrary content into these fields.
- Retention is bounded by the workspace retention policy, not by us holding it indefinitely.

**Revisit if any of these becomes true:**

- Origination gains non-Scoular users, so a UPN starts identifying someone outside the company.
- Log data leaves the tenant, is shipped to a third-party aggregator, or gains broader read access.
- A data-classification policy explicitly classifies employee UPNs as restricted.

**Compensating direction if it ever needs changing:** log the `oid` as `UserId` and keep the short
name as a separate, droppable field, so the join to our own tables survives while the
email-shaped value can be suppressed independently.

**Accepted by:** Origination engineering — recorded 2026-09-21. Surfaced by the Code Quality
Dashboard pilot audit (PR #613). Not routed for IT Security countersignature: unlike AR-01/02/08
this is a data-classification choice about our own employees' identifiers rather than an
object-level authorization gap — raise it with AR-01/02/08 if Security would rather rule on it.

---

## Dependabot #134 / #135 (2026-10-05) — accepted: NO FIX EXISTS

Two alerts where the upstream answer is genuinely "none". Both are dev-only build tooling, neither
is reachable with untrusted input, and **neither can be closed by a version bump** — which makes
them different from every other npm alert this repo has handled, where raising an `overrides` floor
was the whole fix.

### #134 — `braces` <= 3.0.3, stack exhaustion via deeply nested patterns (GHSA-vfj7-8cjw-p6xm)

**No fix exists.** `3.0.3` is the latest published version (2024-09-18) and the advisory range is
`<= 3.0.3` with `patched: NONE`. There is nothing to upgrade to, and no `overrides` entry can help.

Reaches us dev-only through `micromatch`, which the Angular/Vite build tooling uses for glob
matching. The attack needs deeply nested brace patterns fed to the matcher; ours come from
`angular.json` and `tsconfig`, never from a user. Nothing in `client/src`, `client/projects` or the
API imports `braces` or `micromatch` directly.

Same shape as the `brace-expansion` advisories (#127/#128/#129, 2026-09-30) — except those had a
patched release and this does not. **Re-check when `braces` publishes above 3.0.3; until then there
is no action, only a standing accept.**

### #135 — `http-cache-semantics` <= 4.2.0, cross-user cache disclosure (GHSA-ch52-4w7c-c8xp)

🔴 **4.3.0 exists and is NOT a fix for this. Do not bump it believing otherwise.**

The advisory says `patched: NONE`, but `4.3.0` published 2026-10-04, after it was filed — so it
looks like the answer. It is not. Diffing the published 4.2.0 and 4.3.0 tarballs, the flagged
`max-stale` logic is **byte-identical**, only shifted down a line:

```js
const allowsStaleWithoutRevalidation = 'max-stale' in requestCC &&
    (true === requestCC['max-stale'] || requestCC['max-stale'] > this.age() - this.maxAge());
```

What 4.3.0 actually changed is **Vary header matching** — `hasOwnProperty` guards on header lookups
and a restructured `vary: '*'` check. Real hardening, unrelated issue.

⚠ **Bumping to 4.3.0 would CLOSE this Dependabot alert** (4.3.0 falls outside the declared
`<= 4.2.0` range) **while leaving the reported behaviour exactly as it is.** That is a worse state
than an open alert: a clean dashboard asserting something untrue. Left at 4.2.0 deliberately so the
alert stays honest. If 4.3.0 is ever taken for the Vary hardening on its own merits, this entry
must be updated to say the max-stale issue is still open and merely no longer flagged.

**Exposure is nil regardless.** `http-cache-semantics` arrives through npm's own internals —
`npm-registry-fetch`, `node-gyp`, `@sigstore/sign`, `tuf-js` — i.e. npm's local package cache on a
developer machine or CI runner. Single user, fetching the registry. The advisory's threat model is
a *shared* HTTP cache handing one user's `Set-Cookie` to another; no such cache exists here, and
nothing of ours calls the library.

### Dismissal wording for Dependabot

Both: **"Risk is tolerable to this project."** Neither has a patched release; both are build-time
only, with the vulnerable paths unreachable from untrusted input. Do **not** dismiss #135 as
"a fix has already been started" — nothing is in flight and no fix is available.

---

## Resolved findings — already remediated (not accepted risks; do not re-open)

Findings a scanner may re-surface that are **already fixed in code**. Listed here so triage
matches them to their remediation instead of re-doing the work.

| Finding | Date | Disposition |
|---------|------|-------------|
| **M-046 / M-047** — recap group `Name` interpolated raw into the daily-recap HTML email (`<h2>CRM Activities for @{variables('groupName')}</h2>`), so any rep could name a group `<a href="https://attacker.example/login">…</a>` and have it delivered as live markup from the shared mailbox to every member and every Teams channel the recap posts to (CWE-79) | 2026-10-07 | **Fixed** on `fix_RecapGroupNameHtmlEncoding`. The `<h2>` now applies the same `&`→`<`→`>` replace chain the instant-share Logic App already uses in production (`&` first, or the entities double-encode). One change covers all four sends — two email, two Teams — because all four deliver the single `emailBody`. Subjects and run-log text deliberately stay RAW: Graph renders subjects as plain text, so encoding them would show `Corn &amp; Soy` to recipients. Pinned by `DailyRecapHtmlEncodingTests`, which read the template itself: no raw interpolation, `&`-first ordering, every `contentType: HTML` send delivers `emailBody` only, subjects still raw. Mutation-verified. **Server-side input restriction NOT added**, deliberately: with output encoded there is nothing left to defend, and rejecting `<`/`>` would block names like `Corn & Soy <West>` that now render correctly (before the fix, `<West>` was swallowed as a tag). ⚠ **Takes effect only after each environment's "Daily Digest … Deploy Logic App" workflow is run** — the app deploy does not touch Logic Apps. |
| **M-044 / M-039** — `PUT /api/customers/{id}` performs an unguarded mutation of producer contact info, farm links and `LinkedProducerIds` with no entitlement check and no audit trail (CWE-639) | 2026-09-21 | **Fixed by deletion (2026-09-21) — and the finding's premise was false.** The route mutated nothing: `CustomerRepository.UpdateAsync` ran an `AsNoTracking` existence probe, wrote a log line and returned, with no `SaveChanges`. Location/phone/email originate in the ODS and cannot be written from the app; `FarmIds`, `LinkedProducerIds` and `TotalAcres` live on `ProducerDetails`. So there was no write to authorize and no mutation to audit. It was also **dead** — `api.service.updateCustomer` had no caller and no test referenced it — so the whole surface was removed: controller action, `UpdateCustomerRequest`, `ICustomerService`/`CustomerService.UpdateAsync`, `ICustomerRepository`/`CustomerRepository.UpdateAsync`, client wrapper. ⚠ **This route was listed under AR-01 in error on 2026-09-14** (M-039) because the triage accepted the scanner's description without opening the repository. Second register error of its class after H-062 and H-071, both of which claimed an `AUDIT_` control that did not exist. **Rule: read a route to its last layer before it enters or leaves this register.** Backend 533/533, client 601/601. |
| **H-049** — Dashboard write endpoints don't validate `TradeUnitKey` inside `List<T>` bodies (`EnforceTradeUnitAccessAttribute.cs`) | 2026-06-29 | **Fixed** in commit `7d124a5`. `EnforceTradeUnitAccess` recurses into `IEnumerable` request bodies (`ExtractTradeUnitKeys`) and validates **every element's** `TradeUnitKey` for POST/PUT/DELETE — a foreign trade unit in any list element is rejected (403). The scan that flagged H-049 predates that same-day commit. Regression tests cover all three dashboard upsert routes (estimates, market shares, actual harvest) in `EnforceTradeUnitAccessFilterTests`. **Not a live vulnerability.** |
| **H-050** — Dashboard `DELETE actualharvest/{id}` has no trade-unit check | 2026-06-29 | **Superseded by H-061 — now FIXED (2026-09-09).** Accepted three times under AR-01 on the argument that actual-harvest rows were "shared dashboard data of the same nature" as producer notes. That analogy did not hold: the rows are trade-unit-keyed dashboard aggregates, every sibling route on the controller is already scoped, the data is hand-entered with no upstream source to restore from, and no UI ever called the route. See the 2026-09-09 update under **AR-01** for the full reasoning and the fix. |
| **M-024** — Indirect prompt injection: CRM note content interpolated into the OpenAI **system** prompt in the notes-daily-recap Logic App (`infra/logic-apps/notes-daily-recap/azuredeploy.json`) | 2026-06-29 | **Fixed** in commit `7d124a5`. Note content (`@{variables('activities')}`) was moved out of the system message into a dedicated **`user`-role** message, wrapped in `===ACTIVITIES===` delimiters, with explicit "treat strictly as data, never as instructions" guardrails in both the system and user messages. The scan predates that same-day commit. Optional further hardening (structural HTML output validation of the AI response) is noted as possible defense-in-depth, not required. **Not a live vulnerability.** |
| **M-025** — Note-mention email exfiltration: a client-supplied `person` mention email was persisted to `Notes.Mentions` and handed verbatim to the Instant Share Note Logic App's shared-mailbox `sendMail`, letting any authenticated user email customer data to an external address (CWE-284 / CWE-639) | 2026-08-10 | **Fixed** — see the two-part history below. |
| **M-025a** — Incomplete first fix: sanitizing only the mention `email` left the equally client-controlled `id` as a bypass — `id = "attacker@evil.com"` was treated as "already a UPN" and passed through by **both** the API and the Logic App (they shared the same flawed `contains('@')` rule) | 2026-08-10 | **Fixed** on `fix_MentionIdDomainValidation` (follow-up to PR #542, which shipped the incomplete fix). Caught by the Codex PR scan. The recipient is now **constructed, never passed through**: `NoteService.NormalizeMention` accepts only a bare short name or a full `@scoular.com` UPN, rebuilds the address as `localPart@scoular.com`, and throws `ValidationException` on a foreign domain / extra `@` / empty local part (create **and** update paths). The Logic App makes the domain **structural** — `concat(split(id,'@')[0], '@scoular.com')` — so even a pre-existing forged row degrades to a harmless internal address instead of leaving the tenant. Regression tests cover foreign domains, mixed case, `x@evil.com@scoular.com` laundering, lookalike domains, and empty local parts. **Lesson: validate every client-authored field that reaches the recipient, not just the one the finding named.** |
| **H-056** — A `person` mention id was only domain-checked, never resolved, so a crafted API call could mail an authored note to any employee from the shared mailbox (CWE-284) | 2026-08-31 | **Partially fixed; remainder accepted — see AR-08.** `NoteService.ValidatePersonMentionsAsync` now requires a directly-typed person mention to name an **active** user in `TradeUnitPreferences.dbo.Users` (create and update, fail-closed on a roster outage), and the server clears client-supplied `via` so group provenance can't be forged to skip the check. Caller-scoping the mention set to the author's own trade units was **deliberately declined** (business decision 2026-09-01) — that residual is AR-08. |
| **M-036** — The Instant Share Note Logic App interpolated the raw note body, author name and customer name into the `sendMail` HTML, so authored content rendered as markup in mail from the shared mailbox — HTML/link injection enabling internal phishing and tracking pixels (CWE-79) | 2026-08-31 | **Fixed** (2026-09-01). Three `Compose_Safe_*` actions inside `Condition_Has_Recipients` HTML-escape `&`, `<`, `>` (in that order — `&` first, or later replaces would double-encode), and the template interpolates only those outputs; `HTTP_Send_Share_Email` runs after all three. Only those three characters are escaped because every interpolation sits in a **text node**, none inside an attribute. The `subject` is intentionally left raw — it is a plain-text Graph field. The sibling `notes-daily-recap` workflow needed **no change**: its note text reaches the mail only through `Create_HTML_table`, which encodes cell values, and its AI summary is separately escaped. |
| **H-061** — Dashboard `DELETE actualharvest/{id}` performs no per-record or trade-unit authorization: the sequential integer id flows to a bare `FindAsync` + `Remove`, and the class-level `[EnforceTradeUnitAccess]` filter evaluates nothing because the route carries no trade-unit value, so any authenticated user could enumerate ids and destroy another trade unit's actual-harvest rows (CWE-639) | 2026-09-07 | **Fixed (2026-09-09).** `DashboardService.DeleteActualHarvestAsync` resolves the row's own `TradeUnitKey` and calls `ValidateTradeUnitsOrThrowAsync` before deleting — 403 for another trade unit's row, silent 204 no-op for a non-existent id (so the route is not an existence oracle), and 503 fail-closed on an entitlements outage. The audit log records the resolved trade unit, and misses are logged too. Covered by `DashboardActualHarvestDeleteTests` (5 tests, mutation-verified). This route was **removed from AR-01** — see that entry's 2026-09-09 update for why the original H-050 acceptance was mistaken. |
| **M-037** — Instant Share Note Logic App interpolates the user-authored note `Description` and the author display name into a `contentType: "HTML"` Graph `sendMail` body with no encoding, so a note author can deliver arbitrary markup (anchors with attacker-chosen hrefs, fake banners, hidden content) as trusted HTML from the privileged shared mailbox — internal content-spoofing / phishing rather than script execution, since Outlook strips scripts (CWE-79) | 2026-09-07 | **Fixed — duplicate of M-036 above.** The weekly baseline re-flagged the defect against `main` on 2026-09-07 while the fix was still unmerged on `fix_NoteMentionSecurity`; it lands on `main` with that branch, so no separate remediation exists or is needed. See the **M-036** row for the escaping detail, including why the subject stays raw and why the sibling `notes-daily-recap` workflow needs no change. **Deploy note:** merging the template does not change any environment — the `deploy-logic-app-instant-share-note-*` workflow must be dispatched per environment, together with the API half (H-056), because the two are halves of one attack: who can be targeted, and what can be delivered. |
| **H-062 (DELETE half)** — `DELETE /api/producerdetails/customer/{customerId}` performed no trade-unit authorization at any layer: the sequential `customerId` path segment reached a bare repository delete that hand-cascades to the `ProducerContacts` and `ProducerGrainOnFarm` child rows, so any authenticated user could enumerate ids and destroy another trade unit's producer contact PII and grain-on-farm positions (CWE-639) | 2026-09-14 | **Fixed (2026-09-14).** `ProducerDetailsService.DeleteAsync` resolves the caller's entitled trade units, confirms membership via `GetActiveCustomerIdsInTradeUnitsAsync`, and returns 403 otherwise — with 503 fail-closed on an entitlements outage and a silent no-op when no details row exists, so the route is not an existence oracle. The repository now emits a structured `AUDIT_DELETE` including the cascade counts, and the controller logs misses. Covered by `ProducerDetailsDeleteTests` (5 tests, mutation-verified). ⚠ **The `GET` was also scoped on 2026-09-14 and REVERTED on 2026-09-21 — do not re-add it.** That change was wrong in principle: a trade-unit test is not an access control here, because originators self-assign trade units through the Trade Unit Preferences app. It also broke search-and-click, because ODS onboarding candidates carry a real `CustomerId` with no `CustomerTradeUnit` row and were refused, silently blanking the profile. See the banner at the top of AR-02. A regression test (`GetByCustomerAsync_ForAProducerOutsideTheCallersTradeUnits_StillReturns`) now pins the read as unscoped and is mutation-verified. **`PUT` remains accepted under AR-01** — it has six live callers, two writing to cross-trade-unit linked producers by design, plus an onboarding path that would race freshly-written membership. See AR-01's and AR-02's 2026-09-14 updates. |
| **H-066 (elevators half)** — `GET /api/bidsheet/elevators` returned every elevator across every trade unit when `tradeUnitCode` was omitted, with no entitlement validation (CWE-284) | 2026-09-14 | **Fixed (2026-09-14).** `tradeUnitCode` is now required and validated, and blank is rejected explicitly *before* `ValidateTradeUnitsOrThrowAsync` — which filters blanks and returns early, so `?tradeUnitCode=` would otherwise have passed validation vacuously and fallen through unscoped. Nothing in the client called this route, so the fix costs no behaviour; the client signature was tightened to a required parameter so a future caller fails at compile time. Covered by `BidSheetElevatorScopeTests` (5 cases, mutation-verified). **Only the elevators half was fixed** — `GET /api/bidsheet/locations` remains accepted under AR-05 because the bid-sheet map genuinely needs the unscoped read. |

---

## QA SPECTER scan 2026-09-30 — dispositions

Scanned `release_CtrmGoLive_2026-10-01` against origination-qa (report generated 18:04 UTC). Nine
findings. The fixes landed on the same branch (commits `304eaa9c`, `5a46c55c`), so QA and, from the
2026-10-01 go-live, PROD carry them. The three dispositions below are recorded so they stop re-firing.

### HIGH `@angular/router` 21.2.23 / CVE-2026-101896 — FIXED by patch, and not exploitable here anyway

The scanner says "fixed in 22.2.0 or later". The Angular CHANGELOG shows the 21.x backport in
**21.2.24** ("avoid dense elements allocation for numeric URL keys", 2026-09-23), so the nine framework
packages moved to 21.2.25 in lockstep — a patch, not the major the report implies. It was also never
live here: the advisory is **Angular SSR**, and this application has no SSR (no `@angular/ssr`, no
`platformServer`, no `server` or `prerender` target, no `server.ts`; the SPA is built to static files
served from the API's `wwwroot`). Route parsing runs in the visitor's own browser, so before the patch
the worst case was a user hanging their own tab. If SSR is ever introduced, re-check this class of
advisory at that point rather than waiting for a rescan.

### MEDIUM SavedLists team query "trusts client-supplied tradeUnits" — FALSE POSITIVE

The review read `SavedListsController.GetTeam` and stopped at the controller. One layer down,
`SavedListService.GetTeamListsAsync` calls `ScopeToAllowedTradeUnitsAsync`, which intersects the
requested codes with `IUserEntitlementService.GetAllowedTradeUnitCodesAsync` for the caller and
returns an empty list when nothing survives — precisely the "derive from identity and intersect"
remedy the finding asks for. The controller now carries a comment pointing at the service so the
next reader does not have to re-derive it.

### LOW "Timestamp disclosure" on `/api/Customers` — FALSE POSITIVE

The anonymous response is a bodiless 401. Authenticated, the body carries numeric customer ids,
which is what the scanner's ten-digit regex matched. Nothing to act on.

### Fixed on the branch

| Finding | Fix |
|---|---|
| CSP has no `frame-ancestors` / `form-action` (no fallback to `default-src`) — reported twice, Medium + Low | Both added to the SPA policy, `frame-ancestors 'none'` to the API policy. `frame-ancestors` duplicates the existing `X-Frame-Options: DENY` rather than replacing it. MSAL returns the sign-in response in the URL fragment, so `form-action 'self'` does not touch the login flow. |
| Log injection via URL-decoded `Request.Path` (RequestContextMiddleware scope, SecurityAuditMiddleware audit lines) | `LogSanitizer.Clean` turns control characters into spaces and caps at 256, applied to method, path and identity name. The finding's claim about the trace id was wrong: `CorrelationIdMiddleware.IsWellFormed` already allow-lists it to 64 ASCII letters, digits and `-_.:`. |
| `dompurify` 3.4.13 DOM XSS (GHSA-p98j-92pf-mc4p) | Override floor `>=3.4.12` → `>=3.4.16 <4`. Our own floor was what held the vulnerable version. Transitive via `jspdf` (PDF export); the affected hooks are not used. |

### Still open by choice

`style-src 'unsafe-inline'` (Medium) is real and NOT fixed. Angular injects component styles as inline
`<style>` elements at runtime; removing the keyword needs Angular's `ngCspNonce` plumbed from a
per-request server value into the served `index.html`. That is a change to how the SPA is hosted, not
a header edit, and it is deliberately out of scope for a scan response the day before a go-live.
`script-src` is already `'self'` only, which is the directive that stops script injection; inline
styles alone cannot execute code. Recorded in the middleware remarks and pinned by a test so a future
edit cannot drop it by accident.
