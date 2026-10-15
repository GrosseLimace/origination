# ADR-001 — Mobile surface topology: separate assembly in the existing host, behind APIM

| | |
|---|---|
| **Status** | Proposed (awaiting Phase 0 decisions and Solutions Architect / IT Security countersign) |
| **Date** | 2026-09-15 |
| **Deciders** | Origination app team; IT Security; Solutions Architect (countersign) |
| **Related** | [docs/mobile/MOBILE-ARCHITECTURE-PLAN.md](../mobile/MOBILE-ARCHITECTURE-PLAN.md) · [developer-docs/EXTERNAL-SPA-GUIDE.md](../mobile/reference/EXTERNAL-SPA-GUIDE.md) · [SEC-ARCH-BURDI-001 v1.0](../mobile/reference/SEC-ARCH-BURDI-001-mobile-security-architecture.md) (repo copy) · [SECURITY-REVIEWS/ACCEPTED-RISKS.md](../../SECURITY-REVIEWS/ACCEPTED-RISKS.md) |


> **Decided 2026-10-14: Burdi's hosting pattern.** The mobile app is served by the existing Origination App Service at `/mobile` (like Burdi's `/driver`), and Origination becomes "hybrid internet-accessible" like Burdi: from the internet, FortiGate and the Application Gateway WAF let through only `/mobile/*` and `/api/mobile/v1/*`. **No Static Web App, no APIM, no Data Integrations work.** Sign-in stays separate from the desktop (own app registration and `Origination.Mobile.{Env}` scope), so the server refuses phone sign-ins outside the mobile API even if the WAF list changes; sharing the desktop sign-in like Burdi was considered and deferred until Security confirms it. Sections below that describe a Static Web App or APIM are superseded by this note.
>
> **Decided 2026-10-15: sign-in shared with the desktop, as in Burdi.** The phone signs in with the existing Origination SPA registration and the `Origination.Application.{Env}` scope, with `/mobile` added as a redirect URI — exactly as Burdi's PWA registration lists `/driver`. The mobile API still accepts only tokens issued to that registration (`Mobile:AllowedClientAppIds`), and the WAF allow-list is what keeps the rest of the API off the internet. `Mobile:SharedSignIn` switches back to a separate registration if Security ever requires it.

## Context

The Origination Workbench is adding an internet-reachable mobile component. Scoular's security architecture specification (SEC-ARCH-BURDI-001) requires, among other things, that external and internal components be **separate deployments**, that all database access go through a **business-logic layer**, that all external traffic pass through **Azure API Management**, and that tiers **not share service accounts**.

Facts about the codebase that constrain the decision:

- `GrainOriginatorPortal.Api` is a single ASP.NET Core Web host containing 25 controllers (128 endpoints), all 21 application services, DTOs, mappers, filters and middleware. `GrainOriginatorPortal.Infrastructure` (DbContexts, repositories, entities) is a clean leaf with no dependency on the host. There is no separate business-logic assembly.
- The desktop Angular SPA builds into the API's `wwwroot` and is served by the same App Service, which is private-only (VPN/LAN).
- Authorization today is coarse: JWT validation plus `Admin`/`User` roles; no scope (`scp`) check; trade-unit entitlements are documented as a UX filter, not an access boundary (`docs/application-context/SECURITY-MODEL.md`, accepted risks AR-01…AR-05, each with an "exposed to external users" re-evaluation trigger).
- The infrastructure team's implemented pattern (EXTERNAL-SPA-GUIDE.md) is: external Angular SPA on a Static Web App → APIM (App Gateway + WAF in front) → private endpoint → the **existing** App Service. The minimal external surface is the APIM operation allowlist imported from `openapi/mobile/specification.yaml`. The infrastructure template does not model two App Services for one application.
- Burdi, the app the spec is named after, did **not** implement the spec's separate external service or APIM inbound; its driver PWA is served from the same App Service. There is no working reference in the org.

## Options considered

### Option 1 — Mobile controllers inside the existing host, no structural change
Add `api/mobile/v1/*` controllers to `GrainOriginatorPortal.Api`, gate them with a mobile policy, and rely on the APIM allowlist for surface minimisation.

- Pros: least work; no refactor.
- Cons: no compile-time isolation between mobile and desktop code paths; cannot demonstrate "all DB via BLL" or "separate deployment" for the API tier; a later host split requires untangling; developers can trivially reach Infrastructure types from mobile controllers.

### Option 2 — Separate `GrainOriginatorPortal.Mobile.Api` host on its own App Service now
New Web host, own App Service per environment, own user-assigned managed identity with `db_datareader` plus narrow write grants, sharing a newly extracted business-logic assembly with the desktop host.

- Pros: literal compliance with "separate deployments" and "no shared service accounts"; independent scaling and blast radius.
- Cons: a fourth App Service per environment (three environments) provisioned from an infrastructure template that does not model it; long platform lead time; duplicated deploy workflows; EF migrations must run from exactly one host; premature while user population and feature scope are undecided.

### Option 3 — Hybrid: separate assembly in the existing host, structured for a later host split (chosen)
1. Extract business logic into a new class library `GrainOriginatorPortal.Application` (services, DTOs, mappers, exceptions, pure authorization helpers), moved mechanically with namespaces preserved so the existing 376 tests compile unchanged.
2. Add `GrainOriginatorPortal.Mobile`, a class library holding only the mobile controllers, mobile DTOs, `MobileAccess` policy, deny-not-filter trade-unit entitlement attribute, audit filter and rate-limit registration. It references `Application` only; a test asserts it never references `Infrastructure`.
3. The existing host loads the Mobile assembly with `AddApplicationPart`; APIM exposes only the operations listed in `openapi/mobile/specification.yaml`; a drift test keeps the two equal.
4. A later host split becomes a new `Mobile.Host/Program.cs` plus removing the `AddApplicationPart` line, with no controller changes.

## Decision

Adopt **Option 3**. Deliver the mobile surface as its own assembly hosted in the existing private App Service behind APIM, with the business-logic extraction as the first pull request. Treat the APIM operation allowlist as the realisation of the spec's "External API Service" layer. Keep Option 2 as the defined exit path.

## Compliance mapping and exceptions to file

| Spec invariant | How Option 3 meets it | Status |
|---|---|---|
| No direct DB access from external clients | The SWA has no database path; APIM routes only to the private App Service | Met |
| All DB access via BLL | Mobile assembly may reference `Application` only, never `Infrastructure`; enforced by an assembly-reference test | Met |
| External and internal components are separate deployments | Client: met (SWA vs `wwwroot`). API: **not met** — shared host behind APIM | **Exception 1** — exit criterion: host split (Option 2) when producers are onboarded or when IT Security requires it |
| All external traffic via APIM | QA/Prod through APIM; Dev direct by the guide's own design | Met |
| No credentials on devices or bundles | Bundle contains only client id and authority | Met |
| No shared service accounts between tiers | Same process, same managed identity | **Exception 2** — compensations: dedicated mobile client app registration and scope, `azp` check, APIM subscription, surface excludes ODS producer-master, PII and admin operations; ODS and TradeUnitPreferences contexts are read-only regardless |
| Device binding / certificate pinning (mobile) | Not achievable in a PWA | **Exception 3** — compensations: MFA and a sign-in frequency set by Identity, Continuous Access Evaluation, client-id check. Phones are personal and unmanaged and no native app will be built (decided 2026-10-14), so there is no compliant-device control and no pinning path |
| Encrypted storage on device | Browser IndexedDB / Cache Storage are not app-encrypted | **Exception 4** — compensations: contacts and search never cached, other producer reads cached at most 1 hour (notes 15 minutes), wipe on logout and bootstrap failure. Device encryption cannot be assumed on personal phones (decided 2026-10-14); IT Security may require no on-phone producer data at all |

The four exceptions are submitted to asksecurity@scoular.com in one package together with the pending countersigns for AR-01, AR-02 and AR-08, and recorded via ServiceNow risk acceptance per the spec.

## Consequences

- The mobile subset becomes the first surface in Origination with real object-level authorization: scope and client-id checks, trade-unit entitlement as a deny boundary, author-only mutations, and audited writes. AR-01 and AR-02 are narrowed for that subset; the desktop model is unchanged.
- The `Application` extraction is a repository-wide mechanical change and must be scheduled ahead of feature work and merged in isolation (no behavioural refactors in the same PR).
- `openapi/mobile/specification.yaml` becomes a source of truth: it drives APIM configuration, the generated mobile TypeScript client, and a CI drift test against the live `api/mobile/v1` routes.
- EF migrations continue to run only from the desktop deploy workflow. If the host split happens, this stays true and must be re-stated in that ADR.
- Two open platform questions can still change this decision and are tracked in the plan: whether APIM passes the user token through unchanged (required), and whether a dedicated external SPA app registration is created (EXTERNAL-SPA-GUIDE.md) or the desktop one reused (APP-REGISTRATIONS.md). The `azp` isolation depends on the dedicated registration.

## Revisit when

- Producers or other non-Scoular identities are onboarded (Entra External ID) — device binding becomes mandatory; re-evaluate Options 2 and Capacitor.
- IT Security declines Exception 1 or 2 — move to Option 2.
- IT Security declines Exception 3 or 4 — a native wrapper was ruled out by the business (2026-10-14), so the response is tighter sign-in rules and/or no on-phone producer data; revisit only if the business reverses that decision.
- The mobile surface grows beyond roughly a dozen operations or gains write paths beyond note creation.
