# Audit: Permissions Model (`permissions`)

Style guide: `style-guides/permissions-model.md`
Scope: ASP.NET Core authorization, trade-unit entitlement scoping, Angular permission checks,
`SECURITY-REVIEWS/ACCEPTED-RISKS.md`, `docs/application-context/SECURITY-MODEL.md`

**Findings:** 0 open — 0 critical, 0 high, 0 medium, 0 low (6 resolved/accepted to date)
**Opened:** 2026-09-19 | **Last verified:** 2026-10-20

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
