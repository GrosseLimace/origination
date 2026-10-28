# Incoming Calls — Notes for Infrastructure

**For:** Karl Hague (Infrastructure). **About:** the Origination Workbench's implementation of
[TEAMS-CALLING-GUIDE.md](./TEAMS-CALLING-GUIDE.md) (your guide dated 2026-10-27).
**Status:** implemented on branch `spike_IncomingCallAcs`, 2026-10-28.

We followed the guide. This file lists every place where the implementation differs from it or
where we found something worth correcting, so the guide can be updated on your side. Nothing here
changes what you provisioned; it is all on our side.

## Differences from the guide (ours, deliberate)

| # | Guide says | We did | Why |
|---|---|---|---|
| 1 | Endpoint route `POST /api/v1/calling/token` | `POST /api/calling/token` | This API has no `/v1` prefix anywhere; every controller is `api/[controller]`. Same contract otherwise (body `{ teamsUserAadToken }`, response `{ token, expiresOn }`). |
| 2 | Customer lookup `GET /api/v1/customers/by-phone` | `GET /api/calling/match?number=` | The lookup already existed under the calling controller. It also returns the **added-contact name** when the number belongs to a contact an originator saved on the producer (so the popup can say *who* is calling, not just which producer). |
| 3 | On the exchange, `catch RequestFailedException → 502` | Same, plus **204 when calling is not configured** in the environment, and 400 when the body carries no token | 204 is how the client knows "this environment has no calling" and never downloads the SDK (QA and Production today). Error bodies use the API's standard error envelope. |
| 4 | Locally use `new DefaultAzureCredential()` | `DefaultAzureCredential` with the managed-identity probe excluded | Same result (your `az login`), but without the IMDS probe that times out on a laptop. Matches how the rest of the API already builds credentials. On App Service it is `ManagedIdentityCredential(SystemAssigned)` exactly as in the guide. |
| 5 | Register `CommunicationIdentityClient` as a singleton | A singleton factory that caches one client per endpoint | Lets tests substitute a mock client, and lets the API start with `Acs:Endpoint` empty (no client is constructed until the first exchange). Behaviourally one client, as the guide intends. |
| 6 | "Gate it with the existing app-role authorization" | `[Authorize]`, the same gate as every other Workbench endpoint | This API has no per-endpoint app-role policy for ordinary users; access is a valid Workbench API token (the user must be assigned to the app in Entra). Admin-only endpoints carry their own policy; the calling endpoints are for every originator, so they take the standard gate. Confirm this matches what you meant. |
| 7 | Screen pop navigates to the customer **before** the user answers | The popup shows who is calling before they answer; the producer **page** opens when they click Answer (or click the producer on the popup) | Product decision from the Origination owner: don't yank the originator off whatever they were doing until they decide to take the call. Picking up in Teams instead leaves a small banner with the link. Lookup still happens before answering, as the guide says. |
| 8 | Teams-to-Teams (`microsoftTeamsUser`) callers: "internal Teams-to-Teams call" | We **don't pop** for colleague calls; they are answered in Teams as usual | The feature is about producers. Every other caller kind pops: phone numbers are looked up; anything else (e.g. a queue / resource account in POC scenario 2) pops with the SDK's display name so the tester can see the tab rang. |
| 9 | `@azure/communication-calling@beta` for `transferorInfo` | GA `2.0.0` | `transferorInfo` is already in the GA typings (`IncomingCallCommon.transferorInfo?: CallerInfo`), so no beta package is needed. We log both `callerInfo` and `transferorInfo` as JSON to the browser console in non-production builds, per the test plan. |
| 10 | `environment.acs.tokenExchangeUrl` | Only `environment.acs.teamsScopes` | The client builds every API URL from `apiBaseUrl`; a second base would drift. The scopes are the only ACS-specific config the browser needs. |
| 11 | CSP `connect-src` list (without Teams hosts or port 3443) | Your list **plus** `https://*.teams.microsoft.com`, `wss://*.teams.microsoft.com` and `wss://*.skype.com:3443` | Teams-user calling signals through Teams hosts as well, and the trouter signalling socket has been seen on port 3443 (a CSP host without a port only matches the default port). The list is config (`SecurityHeaders:SpaCallingConnectSrcHosts`) and only applied when `Acs:Endpoint` is set, so we can tighten it from the Dev console findings with a config change. |
| 12 | Edit `CspNonceMiddleware.cs` | Nothing to edit | There is no `CspNonceMiddleware` in this repo (a stale reference in our own developer docs). The policy lives in `SecurityHeadersMiddleware.cs`. |
| 13 | `Permissions-Policy: microphone=(self)` | No change | The API sets no `Permissions-Policy` header at all, so the microphone is not blocked. Noted in case one is added later. |

## Things we'd correct in the guide

1. **Managed identity ID in the role listing.** The guide's principal ID `7ff98598-94a0-42cb-81d9-87a6200cb3d9` is right (that is the App Service's system-assigned identity, verified 2026-10-28). The role assignment on the ACS resource shows `1e4465d9-62bc-4ec3-bcac-c75462ee439e`, which is the same identity's *application* ID, not a different principal. Worth a note so nobody thinks the role landed on the wrong identity.
2. **"Permissions-Policy: if it currently sets microphone=()"**: it doesn't; see #13.
3. **`CspNonceMiddleware.cs`**: doesn't exist; see #12.
4. **Beta SDK for `transferorInfo`**: not needed on 2.0.0; see #9.
5. **2028 retirement wording.** The guide says the Calling SDK "continues for Teams-aligned scenarios". Microsoft's guide names three such scenarios (Teams Phone Extensibility, Teams *Meeting* interoperability, Click-to-Call) and does not spell out one-to-one PSTN calls received as a Teams user, even though the Teams interop page documents it. We'd still like a Microsoft support ticket (`https://aka.ms/acs-retirement-support`) to confirm before QA/PROD; the Dev test does not depend on the answer.

## 🔴 Blocker found in the first local test (2026-10-28): the ACS role does not cover the data plane

The exchange fails with **`401 Denied — "Denied by the resource provider"`** from ACS. We isolated it:
a plain `CreateUser` on the Identity SDK, with the developer's own `az login` (a member of
*Azure - Origination App - Developer Admins*, confirmed present in the token's `groups` claim), gets
the same 401. So it is not the Teams token, the client id or the user: the identity is not authorised
to use the resource at all.

**Cause:** `Communication and Email Service Owner` is a management-plane role. Its definition
(`az role definition list --name "Communication and Email Service Owner"`) lists only
`Microsoft.Communication/*` read/write/delete/ListKeys-style **actions** and **no data actions**, so
ACS refuses data-plane calls (identity creation, token exchange) made with it.

**Ask:** replace it with **Contributor**, scoped to the one ACS resource `acs-origination-dev-eus`,
for both principals (the `app-origination-dev-eus` managed identity `7ff98598-…` and the Developer
Admins group). Contributor is the role Microsoft's own ACS quickstarts assign for Entra authentication
(`az ad sp create-for-rbac --role Contributor`). Owner would also work; nothing narrower that we can
find does. Role assignments take a few minutes to propagate; we re-test as soon as it is in.

## Still needed from Infrastructure

- **The role fix above** (Contributor on `acs-origination-dev-eus`). Nothing else can be tested until it lands.

- **FortiGate push.** Please confirm the FortiManager install has run before we test the exchange from the deployed Dev API (locally it goes out as the developer).
- **User-device network.** Call audio needs `20.202.0.0/16` on UDP 3478–3481 (plus TCP 443) from the originator's PC, in the office and over GlobalProtect. Ringing and the popup work without it; audio in the browser does not.
- **Test originator** with a Direct Routing number who is an agent on one conference-mode site queue, for scenarios 2 and 3.
- **The Microsoft support question** above (whoever owns the support plan).

## What the POC build captures for you

In non-production builds the browser console logs, for every incoming call:

```
[incoming-call] callerInfo {"identifier":{"kind":"phoneNumber","phoneNumber":"+1..."},"displayName":"..."} transferorInfo {...}|null
```

The tester records that line plus: scenario (1/2/3), queue name, time, whether the tab and Teams
desktop rang together, who could answer, and audio quality on office network and VPN. The checklist
is in [Incoming Calls.md](./Incoming%20Calls.md#testing).
