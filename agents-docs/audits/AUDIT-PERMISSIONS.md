# Audit: Permissions Model (`permissions`)

Style guide: `style-guides/permissions-model.md`
Scope: ASP.NET Core authorization, trade-unit entitlement scoping, Angular permission checks,
`SECURITY-REVIEWS/ACCEPTED-RISKS.md`, `docs/application-context/SECURITY-MODEL.md`

**Findings:** 1 open — 0 critical, 0 high, 1 medium, 0 low (6 resolved/accepted to date)
**Opened:** 2026-09-19 | **Last verified:** 2026-11-05

## Reconciliation notes (2026-11-05 pass)

Reviewed every commit touching permission-relevant files since the 2026-10-20 pass (~45 commits:
field-plan/45Z feature build-out, bid-sheet sharing, CTRM managed-identity auth change, help panel,
Teams channel picker, dependency pins) against `style-guides/permissions-model.md`'s enforcement,
naming, and testing requirements:

- **New finding — `permissions.controller-authorize-regression-test-missing-4-controllers` (medium,
  open).** `ControllerAuthorizationTests.AllControllerTypes()` is this app's regression net for "no
  endpoint ships without [Authorize]." Diffing the `Controllers/` directory (35 real controllers)
  against the test's hand-maintained `typeof(...)` list (30 entries) found 4 gaps:
  `TeamsChannelsController` (added 2026-09-14), `ClientTelemetryController` (2026-10-13),
  `HelpController` (2026-10-14), and `TDiscController` (2026-11-03, this pass's new 45Z T-DISC
  controller). Read each file directly: all 4 currently carry `[Authorize]`, so there is no live
  unauthenticated endpoint today. But the test provides zero protection for these 4 — if `[Authorize]`
  were ever dropped from one of them, nothing would catch it. Notably, the `TeamsChannelsController`
  gap predates every prior permissions pass back to 2026-09-19, and the 2026-10-20 pass explicitly
  reviewed `ClientTelemetryController` and called it "properly gated, no new finding" without checking
  whether the regression test actually covered it. Filed as medium (same bar as the other
  test-coverage-gap findings already resolved in this tracker, e.g.
  `stored-grain-service-untested-entitlement-scoping`). Suggested fix: add the 4 missing entries, and
  consider replacing the hand-maintained list with reflection over `ControllerBase`-derived types so
  this can't recur.
- **Field-plan / 45Z feature (largest change set this pass) — correctly follows the documented
  deviation pattern, not a new gap.** `FieldPlanController`'s own doc comment states it is "open to any
  signed-in originator, like planting intentions: no per-producer object-level authorization by
  design," citing AR-01 and AR-02. Checked `SECURITY-REVIEWS/ACCEPTED-RISKS.md` directly rather than
  trusting the comment: the field-plan routes (`/api/field-plan/fields`, `/seasons`, `/records`,
  `/records/{id}/confirm` etc., and the `GET /api/field-plan/customer/{customerId}` /
  `/records/{id}/tickets` reads) are listed in AR-01/AR-02 as of the 2026-11-03 update — including the
  enrollment-routes removal note. This is exactly the registry-citation discipline the
  now-resolved `storedgrain-customer-route-missing-from-ar02-registry` finding was about; this time
  the team did it themselves. No finding.
- **`FdCicController` (new, 2026-11-03) and `TDiscController` (new, 2026-11-03) — reference/calculator
  endpoints, no customer-scoped data.** Both only expose USDA reference tables (versions, states,
  counties, crop/tillage options) and score caller-submitted inputs; neither reads or returns another
  user's or customer's stored data, so there is no object-level-authorization surface to scope.
  `[Authorize]` present on both (see the `ControllerAuthorizationTests` finding above for why that
  alone isn't a complete guarantee going forward).
- **Bid-sheet sharing (`SetSheetSharesAsync`, commit range around "taking yourself off a shared sheet")
  — deliberate, documented, not a gap.** `BidSheetService.SetSheetSharesAsync` lets any sheet member
  (not just the owner) widen who the sheet is shared with; the method's own comment explains this is
  the accepted trade for a shared working list, that every share is stamped with `SharedBy` for
  traceability, and that the owner discovers widening by looking. Consistent with this app's existing
  pattern of documenting authorization trade-offs inline rather than silently allowing them.
- **CTRM managed-identity change (`fc854518`, `d368968f`, `2f0eb3bf`) — authentication, not
  application-layer authorization.** Switches how the API's own outbound call to the CTRM GraphQL API
  authenticates (developer's `az login` locally vs. the App Service managed identity in Azure); does
  not change what any end user of this app is permitted to do. Out of this audit's scope per
  §1.3 of the style guide (authentication vs. authorization).
- Previously-resolved and previously-accepted findings (`enforce-trade-unit-access-silent-noop`,
  `stored-grain-service-untested-entitlement-scoping`,
  `storedgrain-customer-route-missing-from-ar02-registry`,
  `accepted-risks-countersignature-banner-contradicts-ar10`,
  `access-control-risk-acceptances-lack-independent-signoff`, `no-rbac-permission-data-model`,
  `role-change-audit-trail-gap`) re-checked against the current tree: no regressions, all still hold.

## Reconciliation notes (2026-10-20 pass)

Reviewed every commit touching permission-relevant files since the 2026-10-13 pass
(`SECURITY-REVIEWS/ACCEPTED-RISKS.md`, `docs/application-context/SECURITY-MODEL.md`,
`**/*Controller.cs`, entitlement/authorization code) rather than trusting the tracker blindly:

- **Corrected a stale summary line, no substantive change.** The prior copy of this document
  still listed `permissions.accepted-risks-countersignature-banner-contradicts-ar10` as "1 open
  (low)," but `AUDIT-TRACKING.json` already recorded it `resolved` on 2026-10-13 (AR-10's closing
  line was rewritten to point at the 2026-09-21 banner instead of contradicting it). Verified
  directly against `SECURITY-REVIEWS/ACCEPTED-RISKS.md:1597-1598`: the fix is in the tree. This
  document's finding count was simply never updated after that resolution landed — now corrected
  to 0 open.
- **New controller added — `ClientTelemetryController.cs` (commit `9d6c3469`, 2026-10-14).** Serves
  the App Insights connection string to the signed-in browser app. Carries plain `[Authorize]`,
  consistent with the app's existing (accepted) deviation from the style guide's
  `[RequirePermission]` RBAC model — see `permissions.no-rbac-permission-data-model`. Controller
  count is now 29 (was 28). Properly gated, no new finding.
- **Entitlements picker fix (commit `1960dfba`, 2026-10-14) — not an authorization change.** The
  recap-group picker's Trade Unit list now reads from the caller's own rows instead of the
  active-only colleague rows, so a caller missing/inactive in `dbo.Users` doesn't lose visibility
  into their own trade unit. The result is still filtered to `callerTuCodes.Contains(...)` — no
  widening of what trade units a caller can see, just a bug fix to a visibility gap affecting the
  caller's own data. No new finding.
- **Diagnostics controller refactor (commit `a5355b87`, 2026-10-13) — behaviour-preserving.** Moved
  `DiagnosticsController`'s bodies into six services. The commit message and its 56 pinning tests
  (including a route-contract test and gate tests) assert every route, status code,
  `DenyIfProduction`/`DenyIfNotDevelopment` gate, and authorization attribute is identical before
  and after. No authorization-relevant change.
- **Entitlements catalog dedup (commit `e9699fc5`, 2026-10-13) — behaviour-preserving.** Consolidated
  duplicated `vw_UserTradeUnitPreferences` reads behind `IEntitlementsDirectoryService`, both
  outputs pinned by full-shape tests before and after, mutation-checked. No authorization-relevant
  change.
- Previously-resolved findings (`enforce-trade-unit-access-silent-noop`,
  `stored-grain-service-untested-entitlement-scoping`,
  `storedgrain-customer-route-missing-from-ar02-registry`,
  `accepted-risks-countersignature-banner-contradicts-ar10`) and previously-accepted findings
  (`access-control-risk-acceptances-lack-independent-signoff`, `no-rbac-permission-data-model`,
  `role-change-audit-trail-gap`) re-checked against the current tree: no regressions, no new
  facts, all still hold.

## Overall health

The authorization implementation remains materially more mature than typical for the style
guide's applicable checklist items: fail-closed entitlement checks, mutation-tested scope
enforcement, a controller-wide `[Authorize]` regression test (now covering 29 controllers, up from
28), and a `SECURITY-MODEL.md` that formally documents the app's deliberate deviation from the
style guide's RBAC data model. No new permissions-relevant gaps surfaced this pass; the only item
of note was correcting this document's own stale finding count after last pass's resolution.
