# Origination Workbench — Mobile Component: Architecture & Execution Plan

| | |
|---|---|
| **Status** | Phase 1 (Contract) — scope fixed by cards #641–#651 on 2026-09-23; OpenAPI draft written |
| **Date** | 2026-09-15, updated 2026-09-23 |
| **Owner** | Origination app team |
| **Governing docs** | [SEC-ARCH-BURDI-001 v1.0](reference/SEC-ARCH-BURDI-001-mobile-security-architecture.md) (Security Architecture Specification: Burdi Design Pattern, IT Security, 2026-03-25; repo copy); [developer-docs/EXTERNAL-SPA-GUIDE.md](reference/EXTERNAL-SPA-GUIDE.md) v1.7 |
| **Companion docs** | [MEETING-QUESTIONS.md](MEETING-QUESTIONS.md) · [PLATFORM-REQUESTS.md](PLATFORM-REQUESTS.md) · [REQUEST-MESSAGES.md](REQUEST-MESSAGES.md) · [ADR-001](../adr/ADR-001-mobile-surface-topology.md) · [openapi/mobile/](../../openapi/mobile/README.md) |

> **Decided 2026-10-14 (application owner):** originators use their **own, unmanaged phones** (no company phones, no Intune/Company Portal), and the mobile piece stays a **website (PWA)**, with no app-store app. So the "compliant device" Conditional Access control and the Capacitor/native fallback below are **off the table**. The compensating controls are MFA, sign-in frequency, Continuous Access Evaluation, the client-id check, and keeping as little producer data on the phone as possible. IT Security decides whether the phone may hold producer data briefly (§5.4).

> **Decided 2026-10-14: Burdi's hosting pattern.** The mobile app is served by the existing Origination App Service at `/mobile` (like Burdi's `/driver`), and Origination becomes "hybrid internet-accessible" like Burdi: from the internet, FortiGate and the Application Gateway WAF let through only `/mobile/*` and `/api/mobile/v1/*`. **No Static Web App, no APIM, no Data Integrations work.** Sign-in stays separate from the desktop (own app registration and `Origination.Mobile.{Env}` scope), so the server refuses phone sign-ins outside the mobile API even if the WAF list changes; sharing the desktop sign-in like Burdi was considered and deferred until Security confirms it. Sections below that describe a Static Web App or APIM are superseded by this note.
>
> **Decided 2026-10-15: sign-in shared with the desktop, as in Burdi and Grain Vision.** The phone signs in with the existing Origination SPA registration and the `Origination.Application.{Env}` scope, with `/mobile` added as a redirect URI — exactly as Burdi's PWA registration lists `/driver`. The mobile API still accepts only tokens issued to that registration (`Mobile:AllowedClientAppIds`), and the WAF allow-list is what keeps the rest of the API off the internet. `Mobile:SharedSignIn` switches back to a separate registration if Security ever requires it.
>
> **Decided 2026-10-15: follow Grain Vision's external app — supersedes the Burdi notes above.** Grain Vision (IT/grain-vision) implements the EXTERNAL-SPA-GUIDE: the field app is its own Azure Static Web App (Dev `ext-origination-dev.scoular.com`; QA/Prod on the desktop's address via split-horizon DNS), it calls the API through APIM at `api{dev,qa,}.scoular.com/external/origination/v1` (App Gateway + WAF in front; Dev too, as Grain Vision's does), and the App Service stays fully private — no "hybrid" paths, no `/mobile` on the App Service. Sign-in stays shared with the desktop (Grain Vision does the same). Open: the Guide restricts external access to company-managed devices; our originators use personal, unmanaged phones (PLATFORM-REQUESTS.md D1).

## 1. Purpose

Add a mobile component to the Origination Workbench (Angular 21 + .NET 10, internal grain-originator app) that conforms to Scoular's mixed-trust-zone security architecture. Feature scope is decided at the Phase 0 stakeholder meeting; this document fixes the **architecture, the platform asks, and the delivery phases** so implementation can start as soon as scope is known.

## 2. How the two governing documents fit together

**SEC-ARCH-BURDI-001** prescribes six layers: Edge WAF → External API Service → APIM → Internal Web App → Business Logic Layer (sole DB path) → Azure SQL. Its core invariants: no direct DB access from external clients; all DB access through the BLL; external and internal components are separate deployments; all external traffic through APIM; no credentials on devices or in bundles; no shared service accounts between tiers.

**EXTERNAL-SPA-GUIDE.md** is the infrastructure team's implemented mechanics for the same goal:

```
External user (company-managed device)
  → Entra ID Conditional Access (device compliance)
  → Azure Static Web App  (separate external Angular SPA)
  → APIM  api{env}.scoular.com/{apimPathPrefix}   (App Gateway + WAF in front, behind FortiGate)
  → private endpoint
  → App Service (fully private, never internet-exposed)
```

Scoular's edge is **App Gateway + WAF**, not Front Door. The spec's "External API Service" layer is realised by **APIM's operation allowlist**, imported from the app team's `openapi/mobile/specification.yaml`: the only internet-reachable API component is the APIM gateway, which has no DB access and exposes only the listed operations. That interpretation is recorded in [ADR-001](../adr/ADR-001-mobile-surface-topology.md) and needs a Solutions Architect countersign.

The app team's deliverables under the guide are `openapi/mobile/specification.yaml` (OpenAPI 3.0, external endpoints only, paths relative to the APIM prefix) and `openapi/mobile/README.md` (workflow table with an *Offline Behavior* column). Dev has no APIM: the dev SWA calls the App Service directly and needs CORS.

### 2.1 Burdi is not a precedent for the spec

The Burdi repo (`scoular.ghe.com/IT/burdi`) was reviewed file by file. `Burdi.DriverApp` is an internal-employee Angular 21 PWA built into the **same** App Service `wwwroot` under `/driver`, served by the same `Burdi.API`, using the same SPA app registration. It has no APIM inbound, no separate external API, no Static Web App (that request was abandoned), no device binding, no certificate pinning, no B2C, and no push. Its driver-facing authorization policy is the broadest in the app; surface reduction is a client-side role check only.

Consequence: there is **no working SWA → APIM example in the org**. Origination would be the first, following the guide.

What Burdi does provide and we will reuse (paths under `Burdi.DriverApp/src/app/`):

- `guards/offline-auth.guard.ts` — online → `MsalGuard`; offline with cached account → allow; offline without account → `/offline`. Fixes the blank-screen incident INC0966632.
- `services/storage.service.ts` and `services/sync.service.ts` — IndexedDB stores (`activeSession`, `syncQueue`, `referenceData`), dependency-ordered queue drain, reset of stuck `syncing` items on start, re-read of local state after each API call, server-side idempotency key where a duplicate counts as success.
- `app.config.ts` — MSAL bootstrap in an app initializer emitting `MSAL.Bootstrap*` App Insights events; `protectedResourceMap` registering both a glob and the bare base URL (msal-angular strict-matching gotcha).
- Backend gotchas: use `ManagedIdentityCredential` directly on App Service (Origination already does); keep a hardcoded `ValidAudiences`/`ValidIssuers` fallback because egress-restricted apps may not reach OIDC metadata; CSP `frame-src login.microsoftonline.com` is required for `ssoSilent`.
- Open Burdi finding **M-030**: PWA IndexedDB data is unencrypted. We address it explicitly (§5.4).

## 3. Origination today versus the spec

| Spec requirement | Current state | Gap |
|---|---|---|
| Minimal external API surface | 25 controllers / 128 endpoints in one private Web host; no `openapi/`; no URL versioning | Build new |
| APIM in front | APIM is reachable **outbound** only (NSG allows the APIM private endpoint); nothing fronts the app | Platform request |
| BLL tier | Services, DTOs and mappers live **inside** `GrainOriginatorPortal.Api` (the Web host). `GrainOriginatorPortal.Infrastructure` (4 DbContexts, 21 repositories) is a clean leaf | Extract |
| SQL via private endpoint + managed identity | Done (`Authentication=Active Directory Default`, private endpoints, private-only inbound) | — |
| Internal app VPN/LAN only | Done ([NETWORK-DIAGRAM.md](../../developer-docs/NETWORK-DIAGRAM.md)) | — |
| Separate deployments per trust zone | SPA builds into `api/GrainOriginatorPortal.Api/wwwroot`; one App Service per env serves both | Split client to SWA |
| Per-tier managed identities | One system-assigned identity per App Service, shared by SQL, Key Vault and Graph | Defer with exception |
| JWT on external surface | JWT validated (`Program.cs`), but **no scope (`scp`) check anywhere**; only `AdminOnly` and `UsageDashboardViewer` policies | **Largest gap** |
| Object-level authorization | [SECURITY-MODEL.md](../application-context/SECURITY-MODEL.md): "Trade-unit entitlements are a UX filter, not an access boundary." Accepted as **AR-01…AR-05** in [ACCEPTED-RISKS.md](../../SECURITY-REVIEWS/ACCEPTED-RISKS.md); each carries a "re-evaluate if exposed to external/untrusted users" trigger. AR-01/02/08 are still "sign-off pending" | Reopens |
| Audit logging of mutations | `AUDIT_*` log lines in some controllers only; Customers, BidSheet and SavedLists writes are unaudited | Filter for mobile |
| Rate limiting | Global fixed window per user-or-IP | Mobile partition |
| SAST / dependency scanning in CI | None in `.github/workflows/` | Add |
| Mobile client | Nothing: no PWA, service worker, manifest, IndexedDB or `navigator.*` use; laptop-tuned layout; `ApiService` is a flat ~120-method class; `DataPreloadService` bulk-loads an entire trade unit | Build new |
| Platform readiness | [START-HERE.md](../../developer-docs/START-HERE.md) already lists provision-if-enabled `swa-origination-{dev,qa}-eus`, `swa-origination-eus` and `ext-origination-*` domains | Flip `externalApp.enabled` |

**Documentation conflict to resolve with Infrastructure:** EXTERNAL-SPA-GUIDE.md says a *dedicated* `Origination External - {Env}` SPA app registration; [APP-REGISTRATIONS.md](../../developer-docs/APP-REGISTRATIONS.md) ("External SPA" section) says the *existing* SPA registration is reused. We need the dedicated one (§5.1).

## 3.1 Scope as decided (cards #641–#651, 2026-09-23)

Users are **originators only**. Phase 1 is eight producer-centric cards; Phase 2 is three.

| Card | Feature | Reads from | Writes | Notes for the design |
|---|---|---|---|---|
| #641 | Producer search and detail | Origination DB | — | Search only; bulk list building and actionable insights are desktop-only |
| #642 | Tap-to-call / tap-to-email | Origination DB | — | Native dialer, not Teams (cell reliability). Contact PII on the device, never cached |
| #643 | Edit on-farm details | Origination DB | **Yes** | Acres, bin sites (name, capacity) and grain on farm per site (on hand, sold, target, last bid, grade) are all **editable on mobile** (decided 2026-10-14). The phone sends the lists back whole with every field it read, so nothing the desktop entered is lost; a desktop edit made in between returns 409. Attributed and timestamped |
| #644 | Add and view notes | Origination DB | **Yes** | Pinned note first, then 10 most recent; add is the primary action |
| #645 | Contract cards | **ODS view** | — | Number, quantity, price, delivery, special type; no dollar value |
| #646 | Ticket roll-up | **ODS view** | — | Count + bushels per group; no line items, weights, crop or location |
| #647 | Planting intentions | Origination DB | **Yes** | View, add, update; crop, acres, year only |
| #648 | Storage + DP cards | **ODS views** | — | Count + bushels summary, cards expand for detail. Tab hidden entirely when the trade unit offers no storage, derived from DP and storage rows (decided 2026-10-14). DP data exists only in Prod |
| #649 | Prospect capture (Phase 2) | new | Yes | New entity; overlaps issue #518 |
| #650 | Directions (Phase 2) | — | — | Native maps link; desktop already has it (`feature_AddressMapLink`) |
| #651 | Dictated notes (Phase 2) | — | — | Device speech-to-text into `createNote`; no AI summarisation |

What this changes versus the original assumptions:

- **Three write paths, not one.** Notes, on-farm details and planting intentions. The offline decision (meeting Q3) now matters for all three; the OpenAPI contract carries `clientRequestId` on every mutation and `expectedModifiedAt` on updates so either answer can be implemented.
- **ODS reads are in scope** for four of eight screens, so the serverless cold-start risk applies to the core experience. The contract returns 503 with a retry hint and the client serves cache first.
- **Reminders and bid view are out.** They were candidates in the first draft and are not on any card.
- **Which trade units offer storage (card #648)** is derived from the data (decided 2026-10-14): any producer at the trade unit with a DP contract or storage receipt. A config list can force one on.
- **Contract:** [openapi/mobile/specification.yaml](../../openapi/mobile/specification.yaml), 17 operations, and the workflow/offline table in [openapi/mobile/README.md](../../openapi/mobile/README.md).

## 4. Target topology (ADR-001, Option 3: hybrid, split-ready)

```
Personal phone (Entra MFA, own mobile registration)
        │  https://origination{-qa,}.scoular.com/mobile        (the app)
        │  https://origination{-qa,}.scoular.com/api/mobile/v1 (its API; bearer scp = Origination.Mobile.{Env})
        ▼
FortiGate → App Gateway + WAF   allow-list: /mobile/* and /api/mobile/v1/* only (Burdi's externalAllowedPaths)
        ▼  private endpoint                      (company network reaches every path directly, as today)
App Service app-origination-{env}-eus  (existing host; serves the desktop app at / and the mobile app at /mobile)
        ├─ GrainOriginatorPortal.Mobile          NEW assembly: api/mobile/v1/* controllers, MobileAccess policy,
        │                                        deny-not-filter trade-unit entitlement, audit filter, mobile rate limit
        ├─ GrainOriginatorPortal.Application     NEW: business logic extracted from Api (services, DTOs, mappers)
        └─ GrainOriginatorPortal.Infrastructure  unchanged (DbContexts, repositories) ──MI──▶ Azure SQL (private endpoint)
Desktop SPA stays in wwwroot, VPN/LAN only, unchanged.
```

Options considered:

- **Option 1 — mobile controllers inside the existing host, nothing else.** Cheapest, but no compile-time isolation, no argument for any spec invariant, and a later host split becomes an untangling job.
- **Option 2 — separate `Mobile.Api` App Service with its own user-assigned identity now.** Cleanest against the spec, but requires a fourth App Service per environment from the infrastructure template (which does not model two hosts per app), doubles deploy workflows, and is premature while scope is undecided.
- **Option 3 — recommended.** Build the mobile surface as its own assembly, extract the BLL first so the assembly can reference services without a circular dependency, and host it in the existing App Service behind APIM. The later host split is a new `Mobile.Host/Program.cs` plus removing one `AddApplicationPart` line.

### 4.1 Invariant scorecard

| Spec invariant | Met by | Status |
|---|---|---|
| No direct DB from external clients | The phone reaches only the mobile API paths through the WAF; no DB path | Met |
| All DB access via BLL | Mobile assembly may reference `Application` only, never `Infrastructure` (enforced by a test) | Met |
| Separate deployments | Mobile app and API share the App Service with the desktop (Burdi's pattern) | **Not met — documented exception**, as for Burdi; exit criterion is the host split |
| All external traffic via APIM | External traffic goes through FortiGate and the App Gateway WAF (path allow-list), not APIM — Burdi's pattern | **Not met — documented exception**; per-user rate limiting and auditing are app-side |
| No credentials on devices | Bundle holds only client id and authority | Met |
| No shared service accounts | Same process, same identity | **Not met — documented exception**; mitigated by a separate client app registration, scope, APIM subscription, and a surface that excludes ODS producer-master, PII and admin operations |
| Versioned paths | `api/mobile/v1` | Met |
| SAST + dependency scanning in CI | New CI jobs | New work |
| Bicep IaC with tags | Infrastructure team's repository | Met by platform |

## 5. Design

### 5.1 Authorization hardening

The mobile surface is the first place where "entitlement is a UX filter" is unacceptable, and it is also the smallest surface. Fix AR-01…05 **for the mobile subset**, and make the mobile subset the only thing a mobile token can reach.

- **Scope and client isolation.** New policy `MobileAccess` in `GrainOriginatorPortal.Mobile/Authorization/`: requires `scp` to contain `Origination.Mobile.{Env}` **and** `azp` to be in `Mobile:AllowedClientAppIds`. An inverse `DesktopAccess` policy is applied to every non-mobile controller by a single `IControllerModelConvention`, so a mobile token cannot reach the 128-endpoint desktop surface. Scopes and audiences are configuration-driven (`Mobile:RequiredScopes`, `Mobile:AdditionalAudiences`) because the QA/Prod scope comes from Data Integrations. Never authorize on APIM-injected headers.
- **Audience.** `Program.cs` pins `ValidAudiences` to the API app registration. APIM must **pass the user's token through** with `aud` = Origination API app registration. Reject any token-exchange design; it loses the user identity and makes object-level authorization impossible.
- **Trade-unit entitlement as a boundary.** New `RequireTradeUnitEntitlementAttribute`, modelled on `Filters/EnforceTradeUnitAccessAttribute.cs`, but returning 403 on non-entitled trade units instead of silently filtering. Producer-scoped routes call a new `ICustomerAccessService.AssertCanAccessAsync`, returning 404 outside entitlement to prevent enumeration. Keep the existing 503 fail-closed path when the entitlement database is unavailable.
- **Ownership on mutations.** Mobile note edit and delete are author-only via a new Application method. The desktop path is untouched (AR-01 explicitly rejects author-only for desktop; see meeting question 10).
- **Audit filter.** `MobileAuditActionFilter` on every mobile mutation emits `AUDIT_{CREATE|UPDATE|DELETE}` with user `oid`, `azp`, correlation id (from the existing `CorrelationIdMiddleware`), entity type and id, and before/after values captured through a scoped `IAuditScope`. PII fields are hashed.
- **Rate limit and request size.** A "mobile" sliding-window partition keyed by `oid`, applied by convention; `[RequestSizeLimit]`, `[Consumes("application/json")]`, DTO `[MaxLength]`/`[Range]`. APIM is the primary control; this is defence in depth.
- **Convention tests.** Convert `ControllerAuthorizationTests.cs` from a hand-maintained list to reflection over both assemblies. Add: every Mobile controller has `MobileAccess`, an `api/mobile/v1` route, the audit filter on non-GET actions, and the trade-unit attribute wherever `customerId` or `tradeUnits` appear; the Mobile assembly does not reference Infrastructure; every non-mobile controller ends up with `DesktopAccess`; an **OpenAPI drift test** diffs `{method, template}` pairs under `api/mobile/v1` against `openapi/mobile/specification.yaml` in both directions (`Microsoft.OpenApi` is already referenced).

### 5.2 Identity and tokens

**Employees (recommended v1).** MSAL v5 redirect flow, `BrowserCacheLocation.SessionStorage`, `provideAppInitializer` bootstrap per the guide, `clientCapabilities: ['CP1']` to opt into Continuous Access Evaluation as the compensating control for browser token lifetime. Dedicated SPA app registration `Origination External - {Env}`. New delegated scope `Origination.Mobile.{Env}` on the existing API app registration; the desktop SPA is not granted it. The spec's 15-minute access token is a tenant-owned `tokenLifetimePolicy` applied by Identity; if it lands on the shared API resource it also shortens desktop tokens (more silent renewals). Refresh tokens for SPAs are already 24-hour, single-use and rotated by Entra. Conditional Access "require compliant device" targets the mobile client; pilot iOS Safari (needs the Authenticator SSO extension) and Android Chrome early.

**Device binding and pinning.** Not achievable in a PWA (token protection is Windows-only). Document an exception with MFA, sign-in frequency, CAE and the `azp` check as compensation. **No native app (decided 2026-10-14)**, so there is no escalation path to pinning or device binding; the `MobileAuthPort` seam stays, now only for testability.

**Producers / customers (if ever).** Entra External ID tenant, second JWT bearer scheme, a `ProducerAccess` policy on a separate controller subset, a `ProducerIdentityLink` table, re-cut DTOs. Conditional Access does not apply to external identities, so device binding becomes mandatory and forces Capacitor. This is a separate later programme; Option 3 makes it addable without redesign.

### 5.3 Client architecture

- **Second project in `client/angular.json`** (`newProjectRoot` is already `projects`): `origination-mobile`, root `client/projects/mobile`, prefix `mob`, output `dist/mobile` — never `wwwroot`. Rejected: a sibling folder (duplicate toolchain and `@it/design-system` registry install) and Nx (overkill at two apps).
- **Shared layer by moving, not copying:** `src/app/models` → `client/libs/models`; `src/app/shared/utils` and the dumb components → `client/libs/shared`; `src/testing` → `client/libs/testing`. Remap `@models`, `@shared/*` and `@testing/*` in `client/tsconfig.json` so the desktop app compiles unchanged. Split the Tailwind `@theme` brand tokens out of `client/src/styles.css` into `client/libs/styles/tokens.css`. ESLint `no-restricted-imports` boundaries: mobile imports `@libs/*` and `@mobile/*` only; desktop may not import `@mobile/*`.
- **Generated API client** from `openapi/mobile/specification.yaml` via `ng-openapi-gen` into `projects/mobile/src/app/api/generated/` (committed; CI regenerates and fails on diff). The mobile app has no `ApiService`, so it cannot call anything outside the allowlist.
- **State.** Do not use `AppStateService` or `DataPreloadService`; bulk-loading a trade unit is hostile to LTE and needs the wide surface. Use per-route `resource()`/`httpResource()` loaders and a small `MobileSessionStore` (user, selected trade unit, online flag, queue length).
- **Environments** in `projects/mobile/src/environments/`: local → `http://localhost:5000/api/mobile/v1` with the app's own scope; dev → `https://origination-dev.scoular.com/api/mobile/v1` (no APIM in dev); qa/prod → `https://api{qa}.scoular.com/{apimPathPrefix}` with the APIM-provided scope. A Vitest spec asserts deployed environment files contain no localhost URLs. Budgets around 450 kB warn / 550 kB error; no Leaflet; self-hosted or system font.
- **Tests.** Own Vitest target reusing the moved MSAL mocks. Playwright projects for `Pixel 7` and `iPhone 14`, including an offline scenario via `context.setOffline(true)`.

### 5.4 PWA and offline model

- `ng add @angular/pwa --project origination-mobile`; `ngsw-config.json` under `projects/mobile/`.
- Reads served from cache via `dataGroups` with absolute cross-origin URL patterns: reference data (1 day), my customers and customer detail (1 hour, 3-second network timeout), recent notes (short). **Never cache ODS producer-master fields or contact PII.**
- Writes: note creation is queued, with a client-generated `clientRequestId` and a server unique index so a duplicate returns the existing row. On-farm detail edits (#643) and planting-intention add/update (#647) **default to graceful failure with a retry prompt** until meeting Q3 is answered; if "hours offline" is required they join the same queue, with `expectedModifiedAt` conflicts surfaced to the user rather than silently overwritten.
- Port Burdi's guard, storage and sync patterns into `projects/mobile/src/app/core/offline/` on top of the `idb` package.
- sessionStorage reality: iOS kills backgrounded PWAs and each relaunch is a new session, so offline-after-relaunch is impossible under `SessionStorage`. v1 offline means "survive a signal drop mid-session" unless Security grants a `LocalStorage` exception for the mobile client (meeting question 3).
- M-030 response: phones are personal and unmanaged (decided 2026-10-14), so device encryption cannot be assumed. Today the service worker keeps producer reads up to 1 hour and notes up to 15 minutes, and IndexedDB holds queued notes; contacts and search are never cached; sign-out and bootstrap failure wipe IndexedDB and Cache Storage. **IT Security decides** whether that brief cache is acceptable or the phone must keep no producer data at all (a change to `ngsw-config.json`; offline then shrinks to what is on screen). The Capacitor branch closes it with secure storage.

### 5.5 CI/CD

- `ci.yml`: add `mobile-client` (build, Vitest, budgets), `openapi-lint` (`@redocly/cli lint`, regenerate client, `git diff --exit-code`) and `security-scan` (CodeQL for C# and TypeScript or the org's GHE scan pipeline; `dotnet list package --vulnerable --include-transitive`; `npm audit --audit-level=high`). Keep SHA pinning; use `paths:` filters to limit runner time.
- `deploy-mobile-{dev,qa,prod}.yml` (workflow_dispatch, self-hosted): `ng build origination-mobile --configuration {env}` → `azure/login` OIDC → `npm i -g @azure/static-web-apps-cli` → `swa deploy ./client/dist/mobile/browser --resource-group rg-origination-{env}-eus --app-name swa-origination-{env}-eus --env production`. Runs **after** the API deploy of the same commit. Do not use `azure/static-web-apps-deploy@v1` (Docker; incompatible with self-hosted runners).
- `e2e.yml`: add the mobile Playwright projects against the dev SWA.
- EF migrations stay in `deploy-{env}.yml` only; record this in the ADR for the eventual host split.

## 6. Phased roadmap

Roughly 10–14 calendar weeks for a modest feature set. Platform waits dominate; the critical path is the APIM token model and operations (Data Integrations) and the Conditional Access pilot (Identity), so file those in Phase 1.

| Phase | ~Weeks | Work | Exit criteria |
|---|---|---|---|
| **0 Discovery** | 1 | **DONE 2026-09-23.** Scope cards #641–#651; users = originators; PWA-first stands. Still open from the question list: device posture (Q2), offline depth (Q3), Security's view of the exceptions (Q5), APIM token model (Q6), token lifetime (Q7), app-registration model (Q8), storage-per-trade-unit source (Q13) | Decisions recorded |
| **1 Contract** | 1–2 | **IN PROGRESS.** OpenAPI draft written (16 operations) and workflow/offline table filled; finalise ADR-001; send **one** security pre-review package (four exceptions; AR-01/02/08 countersigns were declined 2026-09-21, so cite them as accepted-by-owner, do not re-raise); submit platform requests E1–E3 and E7–E10; get Q2/Q3/Q13 answered | Infrastructure acknowledges; Data Integrations confirms pass-through and scope; pre-review scheduled |
| **2 Backend** | 3–4 | **PR 1 BUILT** (`feature_MobileApplicationLayer`, 2026-09-23): mechanical `Application` extraction, 160 renames, zero code edits, 857/857 green. **PR 2 BUILT** (`feature_MobileSurface`, stacked on PR 1, 2026-09-23): `GrainOriginatorPortal.Mobile` with the 16 operations, `MobileAccess` (scope + client id) and `DesktopAccess` (convention) policies, deny-not-filter `RequireTradeUnitEntitlement` (404 outside entitlement), `MobileAuditActionFilter` with redacted before/after, per-user sliding-window rate limit, `RequestSizeLimit`, in-memory idempotency store, 110 new tests incl. the OpenAPI drift test; 967/967 green; API boots and mobile routes answer 401 unauthenticated. **CI gates DONE** (same branch): npm audit (production tree, high+), NuGet transitive vulnerability scan, Redocly lint of the contract, and the Roslyn security analyzers (injection, deserialization, crypto, TLS, token validation) enforced as build errors via `api/.editorconfig`; CodeQL waits on Advanced Security (E14). **Still to do in this phase:** durable idempotency (unique `ClientRequestId` index) once Q3 is answered; `Mobile:AllowedClientAppIds` per environment once E3 lands; `StorageTradeUnits` source (Q13). **Merge order:** PR 1 after `release_2026-09-29`, then PR 2 | Dev serves `api/mobile/v1/*`; all tests and drift check green |
| **3 Client** | 3–4 (overlaps Phase 2 once the spec is frozen) | **FIRST CUT BUILT** (`feature_MobileSurface`, 2026-09-23): second Angular project `origination-mobile` (`client/projects/mobile`, port 4300, output `dist/mobile`, own budgets); brand tokens extracted to `client/libs/styles/tokens.css` and shared by both apps; API types generated from the contract (`openapi-typescript`, CI drift check) behind a 16-method `MobileApiService` (the only HTTP surface, enforced by a boundary spec); MSAL bootstrap with `MSAL.Bootstrap*` events and `CP1`; `MobileAuthPort` seam for a future native wrapper; offline-aware guard; IndexedDB sync queue for note creation with stuck-item recovery; PWA manifest + `ngsw-config.json` (contacts never cached); SWA config with CSP; all eight Phase 1 screens (search, overview with tap-to-call/email, notes, contracts, tickets, planting, storage/DP, on-farm edit with 409 handling); `deploy-mobile-{dev,qa,prod}.yml`. **Previewed live 2026-09-23** against the local API with the desktop Dev registration borrowed ([LOCAL-PREVIEW.md](LOCAL-PREVIEW.md)); flow reshaped from that review: **group dropdown → tick trade units → Next → producers** (browse the selection, search narrows, saved-list dropdown), header `2190 - Pratt, KS` with a back arrow, avatar opens a menu (Light/Dark, change trade units, sign out) instead of signing out, title "Origination Workbench". Contract: 17 operations (session groups and `getTradeUnitStorage` added; saved lists **removed from mobile 2026-10-14**, originators search instead, because lists are evaluated in the desktop browser over the whole trade unit's data). Bin sites and grain on farm editable on mobile (2026-10-14). **Not yet:** the shared-lib *move* (aliases point into `src/app` read-only for now), real brand icons, Playwright mobile smoke against a served build, end-to-end sign-in with the mobile identity (blocked on E3/E9) | Installed PWA on a test phone works against Dev; `MSAL.Bootstrap*` events visible |
| **4 QA wiring** | 2 plus waits | QA environment file (APIM prefix and scope), `deploy-mobile-qa.yml`, Conditional Access pilot on iOS and Android, APIM policy verification (429, correlation id, header stripping), audit log review | End-to-end through WAF → APIM → private App Service in QA |
| **5 Security review** | 2 | IT Security and Solutions Architect review against the spec's developer checklist; penetration test of the APIM surface; AR-01/02 narrowed for the mobile subset; exceptions filed; ServiceNow risk acceptance | Sign-offs; `ACCEPTED-RISKS.md` updated |
| **6 Prod** | 1 | `deploy-mobile-prod.yml`, Prod APIM operations, alerts live, pilot originators | Clean dashboards for a week |

## 7. Risks (ranked)

1. **APIM token model unknown.** If APIM expects an APIM-owned audience or exchanges tokens, the backend rejects everything or loses user identity. Resolve with Data Integrations in Phase 1; `Mobile:AdditionalAudiences` is the configuration escape hatch.
2. **App registration documentation conflict.** The `azp` isolation depends on a dedicated client id.
3. **AR-01…05 reopen plus the countersign backlog.** Package everything once, in Phase 1, not at Phase 5.
4. **Unmanaged personal phones (decided 2026-10-14).** No device-compliance control is available and no native app will be built; Security must accept MFA + sign-in frequency + CAE + minimal on-phone data as the control set.
5. **sessionStorage cold-open on phones** (2–5 s on LTE; no offline after relaunch). Decide v1 offline scope at the meeting.
6. **ODS serverless auto-pause** (up to 60 s cold start). Four of eight Phase 1 screens read ODS (contracts, tickets, storage, DP), so this cannot be avoided; the contract returns 503 with a retry hint and the client is cache-first with a visible "refreshing" state. DP data exists only in Prod, so Dev/QA cannot exercise that screen with real data.
7. **Producer PII on devices.** Card #642 requires contact phone and email on the phone. Return them, never cache them, and say so in the storage exception.
7a. ~~Storage tab visibility needs a fact that does not exist.~~ **Resolved 2026-10-14:** derived from DP and storage rows per trade unit, cached; Hope and Travis confirm the rule.
8. **Shared identity and single host until the split.** Blast-radius only; ODS and TradeUnitPreferences contexts are read-only anyway.
9. **Developer gravity toward `ApiService`/`AppStateService`.** ESLint boundaries and a generated-client-only design from day one.
10. **External dependencies on poor signal.** Google Fonts, Nominatim geocoding (do not expose on mobile), `@it/design-system` CSS size.

## 8. References

- SEC-ARCH-BURDI-001 — Security Architecture Specification: Burdi Design Pattern v1.0 (IT Security / Architecture)
- [developer-docs/EXTERNAL-SPA-GUIDE.md](reference/EXTERNAL-SPA-GUIDE.md), [NETWORK-DIAGRAM.md](../../developer-docs/NETWORK-DIAGRAM.md), [START-HERE.md](../../developer-docs/START-HERE.md), [APP-REGISTRATIONS.md](../../developer-docs/APP-REGISTRATIONS.md)
- [docs/application-context/SECURITY-MODEL.md](../application-context/SECURITY-MODEL.md), [SECURITY-REVIEWS/ACCEPTED-RISKS.md](../../SECURITY-REVIEWS/ACCEPTED-RISKS.md)
- Burdi repository: `https://scoular.ghe.com/IT/burdi` — `Burdi.DriverApp/`, `app-context/KEY-DECISIONS.md`, `Burdi_Security_Review_V3_2026-02-13.md`
