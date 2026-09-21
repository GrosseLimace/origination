# Audit: Permissions Model (`permissions`)

Style guide: `style-guides/permissions-model.md`
Scope: ASP.NET Core authorization, trade-unit entitlement scoping, Angular permission checks, `SECURITY-REVIEWS/ACCEPTED-RISKS.md`

**Findings:** 6 open — 0 critical, 0 high, 3 medium, 3 low
**Opened:** 2026-09-19 | **Last verified:** 2026-09-19

## Medium

### Trade-unit filter fails silently (no log/error) when a decorated action's parameters don't match its 3 recognized shapes (`permissions.enforce-trade-unit-access-silent-noop`)
- **Files:** `Filters/EnforceTradeUnitAccessAttribute.cs`, `Filters/EnforceTradeUnitAccessFilterTests.cs`
- Investigated as a suspected cross-trade-unit bypass on StoredGrain/DpContracts — that turned out to be a false alarm at the data-access level, since `StoredGrainService`/`DpContractService` independently apply entitlement scoping in the service layer as defense-in-depth (proven by `DpContractServiceTests.cs`). The silent-noop design defect in the attribute itself is still real: it already caused one live gap in the past (H-061, fixed 2026-09-09) with no test forcing loud failure on a future recurrence.
- **Related findings:** `dotnet.inconsistent-trade-unit-entitlement-filtering`
- **Suggested fix:** Add an `else` branch that logs a warning whenever none of the 3 patterns match, and add a regression test asserting that log fires.

### StoredGrainService's entitlement-scoping logic has zero test coverage, unlike the identical logic in DpContractService (`permissions.stored-grain-service-untested-entitlement-scoping`)
- **Files:** `Services/StoredGrainService.cs`
- `StoredGrainService.GetAllAsync` duplicates `DpContractService.GetAllAsync` line-for-line, but no test file anywhere references `StoredGrainService`. A future refactor that accidentally drops the entitlement filter would ship a real cross-trade-unit data leak with nothing to catch it.
- **Related findings:** `dotnet.inconsistent-trade-unit-entitlement-filtering`, `test-gaps.repository-layer-gap`
- **Suggested fix:** Add a `StoredGrainServiceTests.cs` mirroring `DpContractServiceTests.cs`'s three entitlement-scoping tests.

### High-severity object-level-authorization risk acceptances (AR-01, AR-02, AR-08) are self-accepted by engineering with no independent security sign-off (`permissions.access-control-risk-acceptances-lack-independent-signoff`)
- **Files:** `SECURITY-REVIEWS/ACCEPTED-RISKS.md`
- AR-01, AR-02, and AR-08 remain security-sign-off-pending. AR-02 alone has been re-flagged by automated scanners 6 times since 2026-06-23 and re-accepted by engineering each time with no IT Security countersignature. The org's stance on cross-trade-unit producer data exposure (financial fields included) has never received independent authorization review.
- **Suggested fix:** Send AR-01, AR-02, and AR-08 to asksecurity@scoular.com for formal countersignature or rejection.

## Low

### GET /api/storedgrain/customer/{customerId} follows the AR-02 accepted-risk pattern but isn't listed or cited (`permissions.storedgrain-customer-route-missing-from-ar02-registry`)
- **Files:** `Controllers/StoredGrainController.cs`, `SECURITY-REVIEWS/ACCEPTED-RISKS.md`
- `DpContractsController.GetByCustomer` carries an inline AR-02 citation; `StoredGrainController.GetByCustomer` has the identical unscoped-by-design shape but was never added to AR-02's route table.
- **Suggested fix:** Add the route to AR-02's list and cite it inline in the controller, matching the DpContracts pattern.

### No Role/Permission/RolePermission/UserRole data model or resource:action:scope permissions exist anywhere in the app (`permissions.no-rbac-permission-data-model`)
- **Files:** `Program.cs`, `Controllers/MeController.cs`, `Authorization/UsageDashboardAccess.cs`, `client/src/app/core/services/user-roles.service.ts`
- Authorization is a single Azure-AD Admin app role plus a config-driven allowlist, with trade-unit entitlement data-scoping doing the rest. Functionally correct for the app's needs, but a full deviation from the style guide's RBAC model, nowhere acknowledged as deliberate the way AR-01–AR-08 document other deviations.
- **Suggested fix:** Record this as a deliberate architectural deviation in a new SECURITY-REVIEWS or ADR entry.

### No in-app audit trail for role/access-list changes (`permissions.role-change-audit-trail-gap`)
- **Files:** `Middleware/SecurityAuditMiddleware.cs`, `Program.cs`
- Admin membership lives in an Azure AD group and the usage-dashboard allowlist lives in config, so role_assigned/removed/modified events never appear in the app's own telemetry. `SecurityAuditMiddleware` does cover 401/403 outcomes.
- **Suggested fix:** Low priority given the trusted/internal user population; if ever needed, periodically snapshot group membership into the app's own audit log.

## Overall health

This codebase's authorization implementation is materially more mature than typical — extensive fail-closed entitlement checks, mutation-tested scope enforcement where tests exist, a controller-wide `[Authorize]` regression test, and an unusually candid, actively-maintained accepted-risk ledger that self-corrects when scanners find real gaps. The primary lead investigated here — a suspected cross-trade-unit bypass — turned out to be a false alarm at the data-access level but a true, still-live design smell at the filter level with a real, verifiable test-coverage asymmetry behind it. The model deviates entirely from the style guide's prescribed RBAC data model in favor of a single Admin role plus trade-unit data scoping — reasonable for this app, but not formally acknowledged as a deviation. The most consequential open item is governance, not code: several HIGH-severity, repeatedly-scanner-flagged authorization decisions (AR-01/02/08) remain self-accepted by engineering alone with security sign-off pending for months.
