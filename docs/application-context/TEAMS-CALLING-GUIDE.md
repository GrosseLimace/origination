# Origination — Teams Calling in the Browser (POC) Implementation Guide

> Received from Infrastructure (Karl Hague) on 2026-10-27, stored here verbatim so the
> implementation can be checked against it. Where the Workbench implementation differs from this
> guide, the differences are listed in [Incoming Calls - Notes for Infrastructure.md](./Incoming%20Calls%20-%20Notes%20for%20Infrastructure.md).

*Infrastructure provisioned 2026-10-27 in **dev only**. This guide covers what the Infrastructure team has built, the exact values your code needs, the code patterns for the API and the Angular SPA, and what the proof of concept has to prove before qa/prod infrastructure is built.*

## What this is

Originators want to **see and answer phone calls inside the Origination web app**, with Origination looking up the caller and opening the customer record as they pick up — similar to the Dynamics 365 Teams dialer.

The approach is Microsoft's **Azure Communication Services (ACS) "custom Teams endpoint"**: the signed-in originator's own Teams identity runs inside the Origination browser tab via the ACS Calling SDK. It is a Teams endpoint like Teams desktop or Teams mobile — calls ring on all of them at once, and whichever one answers takes the call. Call audio flows through the browser tab (WebRTC), not through the installed Teams client.

**Nothing calls back into Origination.** ACS never sends anything to the API. The browser receives the incoming-call event directly from the Teams/ACS cloud, and your Angular code decides what to do with it. The API's only ACS involvement is one outbound call to exchange tokens.

| Capability | Status |
|---|---|
| ACS resource for token exchange | Live in **dev** |
| Admin consent for the ACS Teams scopes on the dev SPA registration | Granted in **dev** |
| API managed-identity access to ACS | Live in **dev** |
| API egress to the ACS endpoint (FortiGate) | Staged in **dev** — confirm with Infrastructure that the FortiManager install push has run before testing the exchange from the deployed API |
| qa / prod | **Not provisioned.** Built only if the POC succeeds |

## What the POC must prove

| # | Scenario | Question | Why it matters |
|---|---|---|---|
| 1 | A producer dials an originator's **own** Teams number (Direct Routing) | Does it ring in the Origination tab, and does `callerInfo` carry the caller's **phone number**? | Expected to work — documented and GA. Confirms the plumbing end to end |
| 2 | A producer dials a **site** number (`<Site> AutoAttd` → `<Site> Main` call queue, **conference mode ON**) | Does it ring in the Origination tab for an originator who is an agent on that queue? Does `callerInfo` carry the **original caller's** number, or the queue / resource account? | **Undocumented for our configuration — this is the deciding test.** Microsoft's Teams call-queue docs list only Teams desktop/mobile clients; one field report saw the queue's number instead of the caller's |
| 3 | Same as 2, answered in **Teams desktop** while the Origination tab is open | Can the tab still pop the customer record even when the user answers in Teams? | A fallback experience if in-browser answering is unwanted |

If scenario 2 fails, Infrastructure's fallback is **Teams Phone extensibility** (server-side call routing for the site numbers). Don't build anything for that yet — just report what you observed.

## How it fits together

Two Entra tokens are involved and they are **different tokens**:

| Token | Requested by | Audience | Used for |
|---|---|---|---|
| Normal API token | SPA (existing `MsalInterceptor`) | Origination API | Authenticating the call to your exchange endpoint |
| ACS Teams token | SPA (new, explicit `acquireTokenSilent`) | Azure Communication Services | Passed *in the request body* to be exchanged — the API never validates or reads it itself |

Flow: SPA `acquireTokenSilent(Teams.ManageCalls, Teams.ManageChats)` → `POST /api/v1/calling/token` with the normal API token and `teamsUserAadToken` in the body → API `GetTokenForTeamsUser(token, SPA client ID, oid)` as the App Service managed identity → ACS token back to the SPA → `createTeamsCallAgent`. Signalling and media go directly between the browser and Microsoft. On an inbound call the SPA reads `callerInfo.identifier` (E.164), looks the customer up, navigates, and can `accept()`.

## Reference values (dev)

| Item | Value |
|---|---|
| Tenant ID | `1521f999-f722-4a4f-9747-166f93e9b0d1` |
| SPA app registration | **Origination - Dev**, client ID `e0f25943-ae8b-4c2d-8060-c9ffbd448aff` |
| API app registration | **Origination API - Dev**, client ID `00078a10-3f3f-4d17-9350-fe90401125ae` |
| ACS resource name | `acs-origination-dev-eus` (resource group `rg-origination-dev-eus`, subscription `scoular-apps-nonprod`) |
| ACS endpoint | `https://acs-origination-dev-eus.unitedstates.communication.azure.com` |
| ACS data location | United States |
| ACS Teams scopes (request both) | `https://auth.msft.communication.azure.com/Teams.ManageCalls`<br>`https://auth.msft.communication.azure.com/Teams.ManageChats` |
| `clientId` argument for the exchange | **The SPA client ID** (`e0f25943-ae8b-4c2d-8060-c9ffbd448aff`) — it must equal the `appid` of the ACS Teams token, which the SPA requested |
| App Service managed identity (system-assigned) | principal ID `7ff98598-94a0-42cb-81d9-87a6200cb3d9` |
| Azure Communication Services first-party app | appId `1fd5118e-2576-4263-8130-9503064c837a` (already present in the tenant) |
| Local auth (access keys / connection strings) | **Disabled.** There is no connection string. Key-signed requests are rejected with HTTP 401 |

## What Infrastructure has already done

1. **Created the ACS resource** with `disableLocalAuth: true`. Authentication is Entra-only, so there is no secret to store, rotate or leak.
2. **Granted `Communication and Email Service Owner`** on the ACS resource to the App Service's system-assigned managed identity and to **Azure - Origination App - Developer Admins** (so developers can run the exchange locally with their own `az login`).
3. **Granted tenant-wide admin consent** for the SPA registration to `Teams.ManageCalls` and `Teams.ManageChats` on Azure Communication Services. Users will **not** see a consent prompt. In the portal this appears on the SPA registration's **API permissions** blade under *Other permissions granted for The Scoular Company* rather than in the configured list — that is expected; do not "Add a permission" there yourself.
4. **Staged a FortiGate rule** allowing the App Service outbound HTTPS to the ACS endpoint above.

**No new app settings were added** to the App Service. The values your code needs are non-secret; put them in `appsettings.Dev.json` and `environment.dev.ts`.

## API (.NET): the token-exchange endpoint

- NuGet: `Azure.Communication.Identity`, `Azure.Identity`.
- `appsettings.Dev.json`: `Acs:Endpoint` = the ACS endpoint; `Acs:TeamsClientId` = the **SPA** client ID (not `AzureAd:ClientId`).
- Register `CommunicationIdentityClient(new Uri(endpoint), credential)` as a singleton, with `ManagedIdentityCredential(SystemAssigned)` on App Service and `DefaultAzureCredential` locally (your `az login`; you must be in Developer Admins).
- Endpoint: `POST api/v1/calling/token`, `[Authorize]` + the API's app-role policy, body `{ teamsUserAadToken }`. **Take `oid` from the validated API token**, never the body. Call `GetTokenForTeamsUserAsync(new GetTokenForTeamsUserOptions(teamsUserAadToken, Acs:TeamsClientId, oid))`; return `{ token, expiresOn }`. On `RequestFailedException` log status + error code only (never tokens) and return 502.

Security rules: `oid` from the principal; never log either token; gate with the existing app-role authorization; **do not cache tokens server-side**; no new CORS.

## SPA (Angular): the call agent

- npm: `@azure/communication-calling`, `@azure/communication-common`. `@beta` may be used in the POC to observe `transferorInfo`; do not ship beta-only properties.
- `environment.dev.ts` / `environment.ts`: `acs.teamsScopes` (both scopes) and `acs.tokenExchangeUrl`. Do **not** add the ACS scopes to the `MsalInterceptor` `protectedResourceMap` or the login request — request them explicitly when the agent starts.
- Entra token: `acquireTokenSilent({ scopes, account })`, falling back to `acquireTokenPopup` only on `InteractionRequiredAuthError`.
- Agent: `AzureCommunicationTokenCredential({ tokenRefresher: fetchAcsToken, refreshProactively: true })` where the refresher runs MSAL silent → exchange endpoint; `askDevicePermission({ audio: true, video: false })` up front so answering is one click; `createTeamsCallAgent(credential)`.
- Incoming call: read `callerInfo.identifier` (`isPhoneNumberIdentifier` → E.164; `isMicrosoftTeamsUserIdentifier` → internal). Look the customer up **before** the user answers and navigate. `accept()` / `reject()`. `callEnded` fires when answered elsewhere or abandoned — dismiss the ringing UI. Don't send caller numbers to App Insights (PII); console-log in dev only.
- Lifecycle: **one call agent per user** — elect a single tab (BroadcastChannel / Web Locks) and only create the agent there; keep the tab alive; watch `connectionStateChanged` and recreate the agent on `Disconnected`; `dispose()` on sign-out.

## Security headers (CSP and Permissions-Policy)

1. **Permissions-Policy:** if it currently sets `microphone=()`, change to `microphone=(self)`.
2. **`connect-src`:** start from `https://*.communication.azure.com wss://*.communication.azure.com https://*.skype.com wss://*.skype.com https://*.microsoft.com wss://*.microsoft.com https://*.azure.net https://*.azure.com https://*.office.com`, verify with a report-only policy / DevTools console while calling, then tighten.
3. **Media is not governed by `connect-src`** — audio problems are network problems.

## Network requirements for users' devices

| Purpose | Destination | Ports |
|---|---|---|
| Media (audio) | `20.202.0.0/16` | UDP 3478–3481, TCP 443 |
| Signalling, registration, telemetry | `*.skype.com`, `*.microsoft.com`, `*.azure.net`, `*.azure.com`, `*.office.com` | TCP 443, 80 |

Microsoft recommends **split-tunnel VPN**. `20.202.0.0/16` is **not** the Teams client's media range (`52.112.0.0/14`), so "Teams works on my laptop" does not prove ACS media will.

## POC test plan — what to capture

For each test call: scenario (1/2/3), site queue name, time; `incomingCall.callerInfo` (full JSON); `incomingCall.transferorInfo` (full JSON); whether it rang in the tab and in Teams desktop at the same time; who could answer and what happened on the other endpoints; audio quality on office network and on VPN. Infrastructure will arrange a test originator with a Direct Routing number who is an agent on one conference-mode site queue. Send the results to Infrastructure.

## Known limitations

- Mobile browsers are not a realistic softphone. Desktop Chrome / Edge / Safari are supported.
- Teams dial plans and caller-ID policies are not applied to calls placed from this endpoint.
- Channel-based call queues are unsupported (2 of the 52 site queues today).
- Emergency (911) calls from a browser endpoint may not convey a dispatchable location.
- ACS standalone retirement 2028-09-30: the Calling SDK continues for Teams-aligned scenarios on a new major SDK version; plan the upgrade; avoid ACS-only features.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| MSAL `AADSTS65001` for the ACS scopes | Wrong registration / non-dev environment | Use the dev SPA client ID |
| Exchange 401/403 from ACS | Not in Developer Admins locally, or `clientId` ≠ the ACS token's `appid` | Check group; pass the **SPA** client ID |
| "token was issued to a different user" | `oid` mismatch | Take `oid` from the authenticated principal |
| Exchange times out from the deployed API, works locally | FortiGate rule not yet pushed | Ask Infrastructure to confirm the FortiManager push |
| CSP `Refused to connect` in the console | `connect-src` | See Security headers |
| Microphone silently denied | `Permissions-Policy: microphone=()` | Change to `microphone=(self)` |
| Call connects, no audio | User's network blocks UDP 3478–3481 / `20.202.0.0/16`, or VPN hairpin | Network team |
| Rings in Teams desktop but not in the tab | No connected call agent, or unsupported scenario (channel-based queue) | Check `connectionStateChanged`; record as a POC result |

## After the POC

If the POC succeeds, Infrastructure will codify the SPA's ACS delegated permissions in the template, provision qa (and later prod) ACS resources, role assignments, consent and FortiGate rules, and revisit header/scope/external-access requirements with IT Security before any external exposure of calling. Keep the endpoint and client ID in **per-environment config**, never hardcoded.

## References

- https://learn.microsoft.com/en-us/azure/communication-services/concepts/interop/custom-teams-endpoint-use-cases
- https://learn.microsoft.com/en-us/azure/communication-services/concepts/teams-endpoint
- https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/manage-teams-identity
- https://learn.microsoft.com/en-us/azure/communication-services/concepts/interop/custom-teams-endpoint-authentication-overview
- https://learn.microsoft.com/en-us/azure/communication-services/how-tos/cte-calling-sdk/manage-calls
- https://learn.microsoft.com/en-us/azure/communication-services/concepts/voice-video-calling/network-requirements
- https://learn.microsoft.com/en-us/azure/communication-services/acs-retirement-and-breaking-changes-guide

*Document version: 1.0 | 2026-10-27 (Infrastructure)*
