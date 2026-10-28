# Origination — Teams Calling in the Browser (POC) Implementation Notes

*Origination's response to Infrastructure's implementation guide of 2026-10-27 (TEAMS-CALLING-GUIDE.md). The guide has been implemented on branch `spike_IncomingCallAcs`. This document covers what was built, the exact values the code uses, every place the implementation differs from the guide and why, corrections we'd suggest to the guide, the blocker found in the first local test, and what Origination still needs from Infrastructure before the POC calls can be made.*

## What this is

We followed the guide. The browser acquires the ACS Teams token, the API exchanges it as the App Service managed identity (the developer's own `az login` locally), one elected tab runs `createTeamsCallAgent`, and an inbound call pops a card with the producer's name, customer code and location — plus the saved contact's name when the number belongs to a contact an originator added to that producer. **Answer** connects the call in the browser and opens the producer's page; **Decline**, **Hold / Resume** and **Hang up** are wired. Nothing calls back into Origination, exactly as the guide describes.

| Item | Status |
|---|---|
| API token-exchange endpoint (`POST /api/calling/token`) | **Built**, tests green |
| Caller lookup (`GET /api/calling/match?number=`) | **Built**, tests green |
| Angular call agent, single-tab election, popup | **Built**, tests green |
| CSP `connect-src` for the calling hosts (config-gated) | **Built**; to be tightened from the Dev console findings |
| Dev config (`appsettings.Dev.json`, `environment.dev.ts`) | **Set** to the guide's reference values |
| First local exchange against `acs-origination-dev-eus` | **Fails — `401 Denied by the resource provider`** (see Blocker) |
| Deployed to Dev | **Not yet** — waiting on the role fix |

## How it was built

Flow: SPA `acquireTokenSilent(Teams.ManageCalls, Teams.ManageChats)` (popup only on `InteractionRequiredAuthError`) → `POST /api/calling/token` with the normal API token and `{ teamsUserAadToken }` in the body → API `GetTokenForTeamsUserAsync(token, Acs:TeamsClientId, oid)` as the managed identity, `oid` taken from the validated API token → `{ token, expiresOn }` back to the SPA → `AzureCommunicationTokenCredential({ tokenRefresher, refreshProactively: true })` → `createTeamsCallAgent`. On `incomingCall` the SPA reads `callerInfo.identifier`, looks the caller up before the user answers, and shows the popup. No server-side token cache, no new CORS, neither token is ever logged.

## Reference values we are using (dev)

| Item | Value |
|---|---|
| `Acs:Endpoint` | `https://acs-origination-dev-eus.unitedstates.communication.azure.com` |
| `Acs:TeamsClientId` | `e0f25943-ae8b-4c2d-8060-c9ffbd448aff` (the **SPA** client ID, as the guide says) |
| ACS Teams scopes (`environment.dev.ts` → `acs.teamsScopes`) | `https://auth.msft.communication.azure.com/Teams.ManageCalls`<br>`https://auth.msft.communication.azure.com/Teams.ManageChats` |
| Credential on App Service | `ManagedIdentityCredential(SystemAssigned)` (when `WEBSITE_SITE_NAME` is set) |
| Credential locally | `DefaultAzureCredential` with the managed-identity probe excluded → resolves to the developer's `az login` |
| Single-tab election | Web Locks API, lock `origination.incomingCall.agent` |
| SDK | `@azure/communication-calling` **2.0.0 (GA)**, `@azure/communication-common`; NuGet `Azure.Communication.Identity` 1.3.1 |
| Calling CSP hosts | Config key `SecurityHeaders:SpaCallingConnectSrcHosts`, applied only when `Acs:Endpoint` is set |
| Feature flag | `incomingCallEnabled` — true in local and dev, false in qa and prod; an empty `Acs:Endpoint` also switches it off server-side |

## Where the implementation differs from the guide

All deliberate and all on our side; nothing here changes what Infrastructure provisioned.

| # | Guide says | Origination does | Why |
|---|---|---|---|
| 1 | Endpoint route `POST /api/v1/calling/token` | `POST /api/calling/token` | This API has no `/v1` prefix anywhere; every controller is `api/[controller]`. Same contract otherwise (body `{ teamsUserAadToken }`, response `{ token, expiresOn }`). |
| 2 | Customer lookup `GET /api/v1/customers/by-phone` | `GET /api/calling/match?number=` | The lookup already existed under the calling controller. It also returns the **added-contact name** when the number belongs to a contact an originator saved on the producer, so the popup can say *who* is calling, not just which producer. |
| 3 | On the exchange, `catch RequestFailedException → 502` | Same, plus **204 when calling is not configured** in the environment, and 400 when the body carries no token | 204 is how the client knows "this environment has no calling" and never downloads the SDK (QA and Production today). Error bodies use the API's standard error envelope. |
| 4 | Locally use `new DefaultAzureCredential()` | `DefaultAzureCredential` with the managed-identity probe excluded | Same result (the developer's `az login`), but without the IMDS probe that times out on a laptop. Matches how the rest of the API already builds credentials. On App Service it is `ManagedIdentityCredential(SystemAssigned)` exactly as in the guide. |
| 5 | Register `CommunicationIdentityClient` as a singleton | A singleton factory that caches one client per endpoint | Lets tests substitute a mock client, and lets the API start with `Acs:Endpoint` empty (no client is constructed until the first exchange). Behaviourally one client, as the guide intends. |
| 6 | "Gate it with the existing app-role authorization" | `[Authorize]`, the same gate as every other Workbench endpoint | This API has no per-endpoint app-role policy for ordinary users: the gate is a valid Workbench API token, the same sign-in check every other endpoint has. Admin-only endpoints carry their own policy; the calling endpoints are for every originator, so they take the standard gate. **Confirm this matches what you meant.** |
| 7 | Screen pop navigates to the customer **before** the user answers | The popup shows who is calling before they answer; the producer **page** opens when they click Answer (or click the producer on the popup) | Product decision from the Origination owner: don't pull the originator off whatever they were doing until they decide to take the call. Picking up in Teams instead leaves a small banner with the link. The lookup still happens before answering, as the guide says. |
| 8 | Teams-to-Teams (`microsoftTeamsUser`) callers: "internal Teams-to-Teams call" | We **don't pop** for colleague calls; they are answered in Teams as usual | The feature is about producers. Every other caller kind pops: phone numbers are looked up; anything else (e.g. a queue / resource account in POC scenario 2) pops with the SDK's display name so the tester can see the tab rang. |
| 9 | `@azure/communication-calling@beta` for `transferorInfo` | GA `2.0.0` | `transferorInfo` is already in the GA typings (`IncomingCallCommon.transferorInfo?: CallerInfo`), so no beta package is needed. We log both `callerInfo` and `transferorInfo` as JSON to the browser console in non-production builds, per the test plan. |
| 10 | `environment.acs.tokenExchangeUrl` | Only `environment.acs.teamsScopes` | The client builds every API URL from `apiBaseUrl`; a second base would drift. The scopes are the only ACS-specific config the browser needs. |
| 11 | CSP `connect-src` list (without Teams hosts or port 3443) | The guide's list **plus** `https://*.teams.microsoft.com`, `wss://*.teams.microsoft.com` and `wss://*.skype.com:3443` | Teams-user calling signals through Teams hosts as well, and the trouter signalling socket has been reported on port 3443 in a Microsoft Q&A thread (a CSP host without a port only matches the default port). The Dev console will confirm which hosts are really used; the list is config and only applied when `Acs:Endpoint` is set, so we can tighten it with a config change. |
| 12 | Edit `CspNonceMiddleware.cs` | Nothing to edit | There is no `CspNonceMiddleware` in this repo (a stale reference in our own developer docs). The policy lives in `SecurityHeadersMiddleware.cs`. |
| 13 | `Permissions-Policy: microphone=(self)` | No change | The API sets no `Permissions-Policy` header at all, so the microphone is not blocked. Noted in case one is added later. |

## Corrections we'd suggest to the guide

1. **Managed identity ID in the role listing.** The guide's principal ID `7ff98598-94a0-42cb-81d9-87a6200cb3d9` is right (that is the App Service's system-assigned identity, verified 2026-10-28). The role assignment on the ACS resource shows `1e4465d9-62bc-4ec3-bcac-c75462ee439e`, which is the same identity's *application* ID, not a different principal. Worth a note so nobody thinks the role landed on the wrong identity.
2. **"Permissions-Policy: if it currently sets `microphone=()`"** — it doesn't; see #13.
3. **`CspNonceMiddleware.cs`** — doesn't exist; see #12.
4. **Beta SDK for `transferorInfo`** — not needed on 2.0.0; see #9.
5. **2028 retirement wording.** The guide says the Calling SDK "continues for Teams-aligned scenarios". Microsoft's guide names three such scenarios (Teams Phone Extensibility, Teams *Meeting* interoperability, Click-to-Call) and does not spell out one-to-one PSTN calls received as a Teams user, even though the Teams interop page documents it. We'd still like a Microsoft support ticket (`https://aka.ms/acs-retirement-support`) to confirm before QA/PROD; the Dev test does not depend on the answer.

## Blocker (2026-10-28): the granted role does not cover the ACS data plane

| Symptom | Cause | Fix needed |
|---|---|---|
| The exchange fails with **`401 Denied — "Denied by the resource provider"`** from ACS, locally, with the `az login` of a *Developer Admins* member | **`Communication and Email Service Owner` is a management-plane role.** Its definition (`az role definition list --name "Communication and Email Service Owner"`) lists only `Microsoft.Communication/*` read / write / delete / ListKeys-style **actions** and **no data actions**, so ACS refuses data-plane calls (identity creation, token exchange) made with it | **Contributor**, scoped to the one ACS resource `acs-origination-dev-eus`, for both principals |

**How we isolated it.** A plain `CreateUser` on the Identity SDK — no Teams token, no client ID, no user involved — gets the same 401 with the same identity, whose token does carry the *Azure - Origination App - Developer Admins* group (`83f44135-230c-4b28-a633-009e57088080`) in its `groups` claim. So it is not the Teams token, the client ID or the group membership: the identity is not authorised to use the resource at all.

**Why Contributor.** It is the role Microsoft's own ACS quickstarts assign for Entra authentication (`az ad sp create-for-rbac --role Contributor`), and Microsoft Q&A answers to this exact error point to Contributor or Owner. We have only tested the granted role, which fails; we have not found a documented narrower role. Role assignments take a few minutes to propagate; we re-test as soon as it is in.

## What Origination needs from Infrastructure

| # | Item | Needed for |
|---|---|---|
| 1 | **Contributor on `acs-origination-dev-eus`** for the `app-origination-dev-eus` managed identity (`7ff98598-94a0-42cb-81d9-87a6200cb3d9`) and for *Azure - Origination App - Developer Admins* (`83f44135-230c-4b28-a633-009e57088080`), replacing `Communication and Email Service Owner` | **Everything.** Nothing can be tested until it lands |
| 2 | Confirmation that the FortiManager install push for the FortiGate rule has run | The exchange from the **deployed** Dev API (locally it goes out as the developer) |
| 3 | User-device network: `20.202.0.0/16` on UDP 3478–3481 (plus TCP 443) from the originator's PC, in the office and over GlobalProtect | Audio in the browser. Ringing and the popup work without it; audio does not |
| 4 | A test originator with a Direct Routing number who is an agent on one conference-mode site queue | Scenarios 2 and 3 |
| 5 | The Microsoft support question on 2028 support (`https://aka.ms/acs-retirement-support`), from whoever owns the support plan | Go / no-go for QA and PROD. The Dev test does not depend on the answer |

## POC test plan — what the build captures

In non-production builds the browser console logs, for every incoming call:

```
[incoming-call] callerInfo {"identifier":{"kind":"phoneNumber","phoneNumber":"+1..."},"displayName":"..."} transferorInfo {...}|null
```

The tester records that line plus: scenario (1 / 2 / 3), site queue name, time, whether the tab and Teams desktop rang together, who could answer and what happened on the other endpoints, and audio quality on the office network and on VPN. Caller numbers are never sent to App Insights. The tester's step-by-step checklist is in the Testing section of our *Incoming Calls* doc in the repo.

## After the role fix

1. Re-run the exchange locally (a microphone prompt on `http://localhost:4200` means the exchange worked) and place a real call to the developer's own Teams number — scenario 1.
2. Deploy the branch to Dev and repeat from the deployed API (this is where item 2 above matters).
3. Run scenarios 2 and 3 with the test originator and send the captured console lines and observations to Infrastructure.

## References

- TEAMS-CALLING-GUIDE.md — Infrastructure's guide this document responds to (stored verbatim in the Origination repo)
- https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/identity/service-principal — Microsoft's Entra authentication quickstart for ACS (assigns Contributor)
- https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/manage-teams-identity
- https://learn.microsoft.com/en-us/azure/communication-services/acs-retirement-and-breaking-changes-guide
- https://aka.ms/acs-retirement-support

*Document version: 1.0 | 2026-10-28 (Origination)*
