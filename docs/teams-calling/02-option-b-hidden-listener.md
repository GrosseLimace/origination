# Option B — Hidden Listener (Recommended)

No calling UI at all. A core singleton service holds an ACS `TeamsCallAgent` authenticated as the
signed-in user's own Teams identity, purely to catch the `incomingCall` event, read `callerInfo`,
and hand off to the shared screen-pop behavior ([`03-shared-behavior.md`](03-shared-behavior.md)).
It never calls `.accept()` or `.reject()`: no microphone prompts, no ACS billing, no audio support
burden. The user answers on their normal Teams client exactly as today.

## Table of Contents

- [Design summary](#design-summary)
- [Frontend: listener service](#frontend-listener-service)
- [Token flow](#token-flow)
- [Backend](#backend)
- [Configuration and gating](#configuration-and-gating)
- [CSP changes](#csp-changes)
- [Multi-tab behavior](#multi-tab-behavior)
- [Error handling and telemetry](#error-handling-and-telemetry)
- [Phased implementation plan](#phased-implementation-plan)

## Design summary

```
MSAL login (existing, client/src/main.ts)
   │
   ▼
TeamsCallingService (new core singleton)
   ├─ GET /api/teams-calling/config          → enabled?  (no → dormant, zero SDK code loaded)
   ├─ MSAL acquireTokenSilent(ACS scopes)    → Entra token for the ACS resource
   ├─ POST /api/teams-calling/token          → ACS access token (backend does the exchange)
   ├─ dynamic import('@azure/communication-calling')
   ├─ createTeamsCallAgent(tokenCredential)
   └─ on('incomingCall') ──────────────────► CallScreenPopService (03-shared-behavior.md)
                                              └─ match producer → navigate / picker / guard
```

## Frontend: listener service

**File**: `client/src/app/core/services/teams-calling.service.ts` (`@Injectable({ providedIn:
'root' })`, signals, no zones — per `style-guides/angular.md` §Service Style).

**Bootstrapping**: instantiated once in the app shell constructor, exactly like the existing
cross-route singletons in `client/src/app/app.component.ts`:

```ts
inject(IdleTimeoutService).start();
inject(DataPreloadService);
...
inject(TeamsCallingService).start();   // new — no-op unless enabled (see gating)
```

**Lifecycle inside `start()`**:

1. Wait for auth: subscribe `MsalBroadcastService.inProgress$` until `InteractionStatus.None`
   with an account present — the same readiness pattern `AppComponent` already uses.
2. `GET /api/teams-calling/config`. If `enabled === false`, stop. Nothing else runs, and the
   ACS SDK bundle is never downloaded.
3. Acquire the Entra token for ACS (see [Token flow](#token-flow)).
4. `const acs = await import('@azure/communication-calling')` — **dynamic import is required**:
   the calling SDK is large (order of MB) and must not be in the initial bundle. Same for
   `@azure/communication-common` (small, but keep both out of eager chunks).
5. Create the credential and agent:
   ```ts
   const credential = new AzureCommunicationTokenCredential({
     refreshProactively: true,
     tokenRefresher: () => this.exchangeToken(),   // MSAL silent → POST /token → string
     token: initialAcsToken,
   });
   const callClient = new CallClient();
   this.agent = await callClient.createTeamsCallAgent(credential);
   ```
6. Subscribe:
   ```ts
   this.agent.on('incomingCall', ({ incomingCall }) => {
     const info = toCallerInfo(incomingCall.callerInfo);  // E.164 number or Teams user + displayName
     this.incomingCall.set(info);
     this.screenPop.handleIncomingCall(info);             // 03-shared-behavior.md
     incomingCall.on('callEnded', () => this.incomingCall.set(null));
   });
   ```
7. **Never** call `incomingCall.accept()` or `.reject()`. Letting the ring time out on this
   unused endpoint is the deliberate design (see `00-overview.md` §Prerequisites, item 4 — the
   reject-vs-other-endpoints interaction is unconfirmed, so we don't depend on it).

**Exposed state** (consumed only by diagnostics in Option B; Option A's drawer builds on it):

```ts
agentState = signal<'off' | 'starting' | 'ready' | 'error'>('off');
incomingCall = signal<IncomingCallInfo | null>(null);
```

**Teardown**: `DestroyRef.onDestroy` → `agent.dispose()`. On MSAL logout events
(`MsalBroadcastService.msalSubject$`), dispose and return to `'off'`.

## Token flow

Two tokens are involved; neither is ever persisted client-side beyond MSAL's normal
SessionStorage cache (`client/src/main.ts` documents that decision):

1. **Entra token for the ACS resource.** The MSAL interceptor config in `client/src/main.ts`
   only covers the portal API (`environment.apiConfig`); ACS scopes are a *different resource*,
   so the service acquires them explicitly:
   ```ts
   const ACS_SCOPES = [
     'https://auth.msft.communication.azure.com/Teams.ManageCalls',
     'https://auth.msft.communication.azure.com/Teams.ManageChats',
   ];
   const { accessToken } = await msal.instance.acquireTokenSilent({ scopes: ACS_SCOPES, account });
   ```
   After tenant admin consent (see `04-iac-handoff.md`) this succeeds silently. If it throws
   `InteractionRequiredAuthError`, log a telemetry event and go to `'error'` — do **not**
   trigger an interactive redirect from a background service; surface a one-time toast at most.
2. **ACS access token.** `POST /api/teams-calling/token` with the Entra ACS token in the JSON
   body (the request itself is authorized by the normal API bearer token via the existing MSAL
   interceptor). Response: `{ token, expiresOn }`.
3. **Refresh loop**: `AzureCommunicationTokenCredential` with `refreshProactively: true` calls
   `tokenRefresher` before expiry; the refresher repeats steps 1–2. ACS tokens issued via
   `GetTokenForTeamsUser` track the underlying Entra token lifetime (~1 h), so this fires
   roughly hourly. MSAL's silent refresh handles the Entra side (the ~24 h refresh-token
   ceiling is already handled app-wide by the `ACQUIRE_TOKEN_FAILURE` guidance in
   `developer-docs/CLAUDE.md`).

## Backend

New controller + service following the existing conventions (explicit kebab route like
`api/GrainOriginatorPortal.Api/Controllers/FieldTagConfigController.cs`; scoped service
registered in the `builder.Services.AddScoped<...>` block of
`api/GrainOriginatorPortal.Api/Program.cs`):

| File | Contents |
|---|---|
| `api/GrainOriginatorPortal.Api/Controllers/TeamsCallingController.cs` | `[ApiController] [Authorize] [Route("api/teams-calling")]` |
| `api/GrainOriginatorPortal.Api/Services/ITeamsCallingTokenService.cs` / `TeamsCallingTokenService.cs` | Wraps `CommunicationIdentityClient` |
| `api/GrainOriginatorPortal.Api/Models/Requests/ExchangeTeamsTokenRequest.cs` | `{ string TeamsUserAadToken }` |
| `api/GrainOriginatorPortal.Api/Models/Responses/TeamsCallingTokenResponse.cs` | `{ string Token, DateTimeOffset ExpiresOn }` |
| `api/GrainOriginatorPortal.Api/Models/Responses/TeamsCallingConfigResponse.cs` | `{ bool Enabled }` |

**Endpoints**:

- `GET /api/teams-calling/config` → `{ enabled }`. Enabled iff
  `Configuration["TeamsCalling:AcsConnectionString"]` is non-empty (mirrors
  `FieldTagConfigController`'s presence-gating). Unlike the field-tag config endpoint, **no
  secret material is ever returned** — the connection string stays server-side.
- `POST /api/teams-calling/token` → exchange:
  ```csharp
  var client = new CommunicationIdentityClient(connectionString);        // Azure.Communication.Identity
  var userObjectId = User.FindFirst("oid")?.Value;                       // same claim RequestContextService reads
  var spaClientId = _configuration["TeamsCalling:SpaClientId"];          // per-env, appsettings.{Env}.json
  var acsToken = await client.GetTokenForTeamsUserAsync(
      new GetTokenForTeamsUserOptions(request.TeamsUserAadToken, spaClientId, userObjectId), ct);
  ```
  - `spaClientId` = the SPA app registration client id for the environment (the app that
    acquired the Entra token) — values already tabulated in `developer-docs/CLAUDE.md`
    §Authentication and mirrored in `client/src/environments/*.ts`.
  - `userObjectId` from the caller's own JWT `oid` claim (pattern:
    `api/GrainOriginatorPortal.Api/Services/RequestContextService.cs`) — this pins the exchange
    to the signed-in user; a caller cannot mint a token for someone else because ACS validates
    the inner AAD token against both parameters.
  - Return 502-style problem details on `RequestFailedException` via the existing
    `GlobalExceptionHandler` (`api/GrainOriginatorPortal.Api/Middleware/`); 400 when the body
    token is missing; never echo or log either token (`style-guides/logging.md`).

**NuGet**: `Azure.Communication.Identity` (SBOM entry required — see `04-iac-handoff.md`).

**Outbound network**: the App Service calls `https://<acs-resource>.communication.azure.com` for
the exchange. Deployed environments sit behind a zero-trust outbound NSG
(`developer-docs/CLAUDE.md` §Critical Constraint) — this **requires a new custom outbound rule**;
provisioning is in `04-iac-handoff.md`. Locally it works without changes.

## Configuration and gating

Two gates, both must pass (matching the repo's double-gating style — cf. `bidSheetEnabled` in
`client/src/environments/environment.ts` + config-presence gating in `FieldTagConfigController`):

1. `environment.teamsCallingEnabled` flag in `client/src/environments/environment*.ts` —
   compile-time kill switch per environment, controls whether `start()` does anything at all.
2. Backend `enabled` from `/api/teams-calling/config` — true only where the Key Vault secret
   `TeamsCalling--AcsConnectionString` (surfaced as `TeamsCalling:AcsConnectionString` through
   the existing `AddAzureKeyVault` wiring in `api/GrainOriginatorPortal.Api/Program.cs`) is
   present. Lets ops disable per environment without a client build.

Non-secret setting `TeamsCalling:SpaClientId` goes in `appsettings.Dev.json` /
`appsettings.QA.json` / `appsettings.Production.json` (per-env files already exist).

## CSP changes

`SecurityHeadersMiddleware.BuildSpaContentSecurityPolicy`
(`api/GrainOriginatorPortal.Api/Middleware/SecurityHeadersMiddleware.cs`) currently allows only
`'self'`, Microsoft login/graph, and per-env hosts from `SecurityHeaders:SpaConnectSrcHosts`.
The ACS calling SDK's signaling needs additional `connect-src` entries (HTTPS + WSS). Expected
host families — **capture the exact list empirically in milestone B2** (CSP violations show only
in DevTools console, not HAR/App Insights — `developer-docs/CLAUDE.md` §CSP Allow-List):

```
https://*.communication.azure.com  wss://*.communication.azure.com
https://*.trouter.teams.microsoft.com  wss://*.trouter.teams.microsoft.com
https://*.skype.com  wss://*.skype.com          // legacy trouter/registrar hosts still in use by the SDK
```

Add the verified set inline in the middleware next to the existing Microsoft hosts (they are
environment-invariant), gated behind the same "is teams calling configured" check if we want to
avoid loosening CSP where the feature is off.

## Multi-tab behavior

Each open portal tab that starts the listener registers its own ACS endpoint; each would raise
`incomingCall` and pop independently. v1 accepts this (duplicate pops in duplicate tabs — benign,
and most users run one tab). Hardening option, deferred to B4: single-listener election via the
Web Locks API (`navigator.locks.request('teams-calling-listener', ...)`) so only one tab holds
the agent; the pop then only appears in that tab, which is arguably worse UX — decide with real
usage feedback before building anything here.

## Error handling and telemetry

- `start()` failures (config fetch, consent missing, exchange failure, SDK init) → `agentState
  ('error')`, one telemetry event, one retry with backoff (e.g. 1 min, 5 min, give up until next
  login). The screen-pop feature degrades to "does nothing" — it must never break the portal.
- Follow `style-guides/error-handling.md` / `logging.md`. Never log caller phone numbers in
  telemetry — mirror `api/GrainOriginatorPortal.Api/Services/TelemetrySanitizer.cs` (it already
  redacts phone patterns for usage events; keep pop events to customerId-only properties).
- Client-side visibility: emit events through the existing
  `client/src/app/core/services/usage-tracking.service.ts` pipeline (`listener-started`,
  `incoming-call-popped`, `no-match`, `multi-match`) so adoption is measurable in the usage
  dashboard.

## Phased implementation plan

| Milestone | Scope | Exit criteria |
|---|---|---|
| **B0 — prerequisites** | Execute `04-iac-handoff.md`: GCC confirmation, security review, admin consent, Dev ACS resource, Key Vault secret, NSG rule | `GetTokenForTeamsUser` succeeds from a local console spike against the Dev ACS resource with a real user token |
| **B1 — backend exchange** | `TeamsCallingController` + `TeamsCallingTokenService` + request/response models + DI + unit tests (xUnit, mock `CommunicationIdentityClient` behind the service interface — `api/GrainOriginatorPortal.Api.Tests` conventions) | `POST /api/teams-calling/token` returns a valid ACS token in local dev; no tokens in logs |
| **B2 — listener spike** | `TeamsCallingService` behind `teamsCallingEnabled=true` locally: silent ACS-scope token, exchange, dynamic import, agent, `incomingCall` → `console`-level + telemetry output only. Validate with real phone calls to the developer's Teams number. **Explicitly validate**: (a) other Teams endpoints ring/answer normally while the listener is attached and ignores the call; (b) exact CSP hosts; (c) token refresh across >1 h sessions | Caller ID observed for PSTN + internal calls; desktop Teams answering verified unaffected; CSP list documented |
| **B3 — screen-pop** | Implement `03-shared-behavior.md`: phone matching, navigation, multi-match picker, unsaved-changes guard + dialogs; wire `handleIncomingCall`. Vitest coverage for `phone-match.ts` and the guard service | Single-match pop, multi-match picker, and all three unsaved-changes choices demonstrably work during live test calls |
| **B4 — hardening + Dev rollout** | Retry/backoff, logout teardown, multi-tab decision, CSP change merged, telemetry events, SBOM + README endpoint table updates, `docs/application-context/` screen-doc touch-ups | Enabled for the Dev user group for 2 weeks; no portal regressions; pop latency (ring→profile) < ~2 s |
| **B5 — QA/Prod** | QA ACS resource + consent already granted tenant-wide; enable QA, then Prod with ServiceNow CHG per org change-management policy | Prod enabled; support runbook (what "listener error" means, how to disable via Key Vault secret removal) published |

Option A, if ever pursued, starts from here — see `01-option-a-embedded-dialer.md` §Phased plan.
