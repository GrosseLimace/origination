# Audit: Permissions Model (`permissions`)

Style guide: `style-guides/permissions-model.md`
Scope: ASP.NET Core authorization, trade-unit entitlement scoping, Angular permission checks, `SECURITY-REVIEWS/ACCEPTED-RISKS.md`, `docs/application-context/SECURITY-MODEL.md`

**Findings:** 1 open — 0 critical, 0 high, 1 medium, 0 low (5 resolved/accepted since the last pass)
**Opened:** 2026-09-19 | **Last verified:** 2026-09-21

## Reconciliation notes (this pass)

`AUDIT-TRACKING.json` statuses were already current — three findings marked `resolved`, two marked
`accepted`, one still `open`. Re-verified each against the current tree rather than trusting the
tracker blindly:

- **`enforce-trade-unit-access-silent-noop` — confirmed resolved.** `EnforceTradeUnitAccessAttribute.cs`
  now tracks an `enforced` flag across all three parameter patterns and logs a `LogWarning`
  (`ENTITLEMENTS_FILTER_NOT_APPLIED`) once per action id when none match, exactly the fix this
  finding asked for.
- **`stored-grain-service-untested-entitlement-scoping` — confirmed resolved.**
  `api/GrainOriginatorPortal.Api.Tests/.../Services/StoredGrainServiceTests.cs` now exists.
- **`storedgrain-customer-route-missing-from-ar02-registry` — confirmed resolved.**
  `StoredGrainController.cs:37` now carries an inline AR-02 citation, and AR-02 in
  `SECURITY-REVIEWS/ACCEPTED-RISKS.md` lists `GET /api/storedgrain/customer/{customerId}` explicitly
  (added 2026-09-21 per M-040).
- **`no-rbac-permission-data-model` — still accepted, now formally documented.** The suggested fix
  (record the RBAC deviation as a deliberate architectural decision) has been done:
  `docs/application-context/SECURITY-MODEL.md` now states plainly that authorization is "two Azure AD
  app roles plus data scoping," names every style-guide RBAC artifact the app deliberately lacks
  (`Role`/`Permission`/`RolePermission`/`UserRole` tables, `IPermissionService`,
  `GET /api/me/permissions`), and gives the re-evaluation triggers. No further action needed unless
  the role surface stops being near-binary.
- **`role-change-audit-trail-gap` — still accepted, now formally documented.** Same
  `SECURITY-MODEL.md` doc explicitly notes role/allowlist changes live in Azure AD group membership
  and `appsettings`, not app code, so `role_assigned`/`role_removed` can't appear in app telemetry —
  matching this finding's original suggested disposition.
- **`access-control-risk-acceptances-lack-independent-signoff` — still open, but the fact pattern
  changed.** See below.

## Medium

### High-severity object-level-authorization risk acceptances (AR-01, AR-02, AR-08) remain self-accepted by engineering with no independent security sign-off — now a deliberate, final decision rather than a pending one (`permissions.access-control-risk-acceptances-lack-independent-signoff`)
- **Files:** `SECURITY-REVIEWS/ACCEPTED-RISKS.md`
- **What changed since 2026-09-19:** the register previously described taking AR-01/AR-02/AR-08 to
  `asksecurity@scoular.com` as still-pending action. As of 2026-09-21 it carries a banner at the top
  of AR-01: *"IT Security countersignature will NOT be sought for AR-01, AR-02 or AR-08. Decided by
  the project owner (CEgr) on 2026-09-21. These entries stand as Origination engineering acceptances
  and that is their final status, not an interim one."* AR-02 alone has now been re-flagged by
  automated scanners **nine** times since 2026-06-23 (H-059, H-067, H-069, H-073, H-075, M-040, M-042
  among them) and re-accepted by engineering every time.
- **Why this still matters:** the underlying governance gap this finding names — HIGH-severity
  object-level-authorization decisions with no security-team countersignature — is unchanged; it has
  simply moved from "awaiting an answer" to "answered no" by engineering itself, which is the same
  self-review pattern the style guide's audit-logging/least-privilege principles caution against, not
  a resolution of it. The technical reasoning behind AR-01/02/08 (trade units are self-assigned, so a
  trade-unit check is not a real access boundary) is well-argued and consistently applied across every
  re-flag, and reads as sound engineering judgment. But that judgment has never been independently
  reviewed by IT Security, and per the org's own CLAUDE.md security policy, this class of finding
  (Broken Access Control / missing authorization) is explicitly one asksecurity@scoular.com exists to
  adjudicate.
- **Suggested fix:** none required in code. This is a governance decision, already made and recorded
  by the project owner; flagging it here is for visibility into the Code Quality Dashboard, not to
  imply the decision was made incorrectly or without authority. If policy requires IT Security
  sign-off on HIGH-severity accepted risks regardless of an engineering owner's decision, that's a
  process question for the project owner and asksecurity@scoular.com, not a code fix.

## Overall health

This codebase's authorization implementation remains materially more mature than typical for the
style guide's checklist items that actually apply to its access model — fail-closed entitlement
checks, mutation-tested scope enforcement, a controller-wide `[Authorize]` regression test, and (new
this pass) a dedicated `SECURITY-MODEL.md` that formally documents the app's deliberate, full
deviation from the style guide's RBAC data model. All findings opened in the initial pass have now
either been fixed in code (silent-noop filter, StoredGrainService test gap, AR-02 registry gap) or
converted from an implicit deviation into an explicitly documented one (no-RBAC-model,
no-in-app-audit-trail). The one remaining open item is unchanged in kind but sharper in framing: it is
now a documented, deliberate, project-owner-level decision not to pursue independent security
sign-off on three HIGH-severity access-control risk acceptances (AR-01, AR-02, AR-08), rather than an
oversight. Whether that decision itself needs escalating past the project owner is outside the scope
of a code audit.
