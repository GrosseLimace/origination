# Audit: Permissions Model (`permissions`)

Style guide: `style-guides/permissions-model.md`
Scope: ASP.NET Core authorization, trade-unit entitlement scoping, Angular permission checks, `SECURITY-REVIEWS/ACCEPTED-RISKS.md`, `docs/application-context/SECURITY-MODEL.md`

**Findings:** 1 open — 0 critical, 0 high, 0 medium, 1 low (5 resolved/accepted since the first pass)
**Opened:** 2026-09-19 | **Last verified:** 2026-10-13

## Reconciliation notes (2026-10-13 pass)

Reviewed every commit touching permission-relevant files since the 2026-09-28 pass (`SECURITY-REVIEWS/ACCEPTED-RISKS.md`, `docs/application-context/SECURITY-MODEL.md`, `**/*Controller.cs`, `UsageDashboardAccess.cs`) rather than trusting the tracker blindly:

- **`access-control-risk-acceptances-lack-independent-signoff` — stays accepted, not re-raised.**
  Per the 2026-09-28 closure, the project owner directed this not be re-opened absent a change to the
  underlying AR-01/02/08 decision; there is none. Re-verified AR-01/02/08's substance is unchanged.
- **New finding opened — `accepted-risks-countersignature-banner-contradicts-ar10` (Low).** The
  2026-09-21 banner in `ACCEPTED-RISKS.md` declares IT Security countersignature for AR-01/02/08
  "closed as declined" and final. Commit `8d91ae7a` (2026-10-09) added AR-10 (Usage Dashboard
  authorization-scope widening — see below) with a closing line stating AR-01/02/07/08 are "routed
  ... for IT Security countersignature." The file now asserts both that this question is closed and
  that it is actively routed, for the same risk IDs, three weeks apart. This is a documentation
  consistency defect, not a re-litigation of whether sign-off should happen — the governance decision
  itself is out of scope and not being questioned here.
- **AR-10 substance (not a finding) — Usage Dashboard "ViewAll" scoping retired.** Commits `2c7df34d`
  and `8d91ae7a` (2026-10-09) removed `UsageDashboardAccess.CanViewAll`, the
  `dbo.UsageDashboardViewAllUsers` table, and the synthetic `UsageDashboardViewAll` role: every user
  who can open the dashboard (Admin role via the Super Users Entra group) can now see the whole
  organisation and pick any manager, where previously only a named allowlist could. This is a real
  authorization-scope widening, but it is exactly the kind of decision the style guide's governance
  model expects: recorded as AR-10 with rationale, compensating controls (data classification is
  adoption telemetry not PII, the org chart is visible elsewhere, exclusion list still enforced,
  `UsageDashboardViewer` policy still gates every read), explicit revisit triggers, and a documented
  rollback path (migration `Down()` re-seeds the original five names). Not flagged as a finding on its
  own merits — see the banner-contradiction finding above for the one defect in how it was recorded.
- **New controller added — `BarchartIngestController.cs` (commit `b6ac2420`, 2026-10-08).** Carries
  `[Authorize(Policy = "BarchartIngest")]`. Controller count is now 28 (was 27); the new one is
  properly gated.
- **Trade-unit entitlement decisions on planting-intention routes (commits `7bce8a92`, `f2d012ed`,
  2026-09-28) — consistent with the existing accepted model, no new finding.** Both commits
  deliberately did not add a trade-unit entitlement check to planting-intention move/retag routes,
  citing AR-02 (originators self-assign trade units, so the check would restrict nobody) and AR-03
  (reps need to do legitimate clean-up after a producer leaves a trade unit). This matches the
  already-accepted AR-01/02/03 reasoning rather than introducing a new gap.
- **CTRM per-user data-source toggle (commits `e412a5aa`, `3a461000`, `26abc762`, Sept–Oct 2026) —
  not a permissions concern.** The toggle switches which backing data source (ODS vs. CTRM/GraphQL) a
  request reads from; "same trade-unit entitlements on both sources, so nothing new is exposed" per
  the commit message. No authorization boundary changed, and the toggle's server-side allowlist was
  later removed entirely.
- Previously-resolved findings (`enforce-trade-unit-access-silent-noop`,
  `stored-grain-service-untested-entitlement-scoping`, `storedgrain-customer-route-missing-from-ar02-registry`)
  and previously-accepted findings (`no-rbac-permission-data-model`, `role-change-audit-trail-gap`)
  re-checked against the current tree: no regressions, no new facts.

## Low

### ACCEPTED-RISKS.md's countersignature banner now contradicts AR-10's own closing line (`permissions.accepted-risks-countersignature-banner-contradicts-ar10`)
- **Files:** `SECURITY-REVIEWS/ACCEPTED-RISKS.md`
- **What:** The 2026-09-21 banner (lines 52-65) says IT Security countersignature for AR-01, AR-02,
  and AR-08 is closed and declined, as a final decision. AR-10's entry (lines 1468-1470, added
  2026-10-09) says those same three risks, plus AR-07, are "routed ... for IT Security
  countersignature." A reader cannot tell from the file which statement currently holds.
- **Suggested fix:** Reconcile the two passages — either note in the banner that AR-10/AR-07 reopen
  the countersignature routing question notwithstanding the earlier AR-01/02/08 decision, or correct
  AR-10's line so it doesn't claim AR-01/02/08 are "routed" when the banner says that was declined.
  Pure documentation fix.

## Overall health

The authorization implementation remains materially more mature than typical for the style guide's
applicable checklist items: fail-closed entitlement checks, mutation-tested scope enforcement, a
controller-wide `[Authorize]` regression test (now covering 28 controllers, up from 27), and a
`SECURITY-MODEL.md` that formally documents the app's deliberate deviation from the style guide's
RBAC data model. The one notable change since the last pass — retiring the Usage Dashboard's
per-caller "ViewAll" scoping (AR-10) — is a genuine authorization-scope widening, but it was handled
the way the governance model is supposed to handle such things: documented, justified, given
compensating controls and a rollback path, before it shipped. The only new defect this pass is a
paperwork inconsistency in how that decision's countersignature routing was recorded against an
unrelated, already-settled banner three weeks older than it.
