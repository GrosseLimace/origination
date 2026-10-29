# Origination — Teams Calling in the Browser: Implementation Guide

> Received from Infrastructure (Karl Hague): v1.0 on 2026-10-27, **v2.1 on 2026-10-29** (this copy,
> from `IT/infrastructure-as-code` `origination/developer-docs/TEAMS-CALLING-GUIDE.md` at commit
> `b0ba8363`), stored here verbatim so the implementation can be checked against it. Where the
> Workbench implementation differs from this guide, the differences are listed in
> [Incoming Calls - Notes for Infrastructure.md](./Incoming%20Calls%20-%20Notes%20for%20Infrastructure.md).

*Provisioned 2026-10-27 in dev as a proof of concept; out of the POC phase 2026-10-29 after scenario 1 (a direct PSTN call answered in the browser) worked. **QA infrastructure is live** (2026-10-29); prod is defined but waits for go-live. This guide covers what the Infrastructure team has built, the exact values your code needs per environment, the patterns for the API and the Angular SPA, the problems we hit getting it working and their fixes, and the site-number scenario that still has to be validated.*

## Table of contents

- [What this is](#what-this-is)
- [Status](#status)
- [Scenarios to validate](#scenarios-to-validate)
- [How it fits together](#how-it-fits-together)
- [Reference values](#reference-values)
- [What Infrastructure has already done](#what-infrastructure-has-already-done)
- [Access for developers (local token exchange)](#access-for-developers-local-token-exchange)
- [API (.NET): the token-exchange endpoint](#api-net-the-token-exchange-endpoint)
  - [NuGet](#nuget)
  - [Configuration](#configuration)
  - [Program.cs — register the identity client](#programcs--register-the-identity-client)
  - [The endpoint](#the-endpoint)
  - [Security rules for the endpoint](#security-rules-for-the-endpoint)
- [SPA (Angular): the call agent](#spa-angular-the-call-agent)
  - [npm packages](#npm-packages)
  - [Environment config](#environment-config)
  - [Getting the Entra token for ACS](#getting-the-entra-token-for-acs)
  - [Creating the TeamsCallAgent](#creating-the-teamscallagent)
  - [Reconnect, backoff and registrar throttling](#reconnect-backoff-and-registrar-throttling)
  - [Microphone permission](#microphone-permission)
  - [Handling an incoming call and the screen pop](#handling-an-incoming-call-and-the-screen-pop)
  - [Lifecycle: one agent, one tab, clean teardown](#lifecycle-one-agent-one-tab-clean-teardown)
  - [Make failures visible](#make-failures-visible)
- [Security headers (CSP and Permissions-Policy)](#security-headers-csp-and-permissions-policy)
- [Network requirements](#network-requirements)
  - [API egress (Azure → ACS)](#api-egress-azure--acs)
  - [Users' devices](#users-devices)
- [Test plan — what to capture](#test-plan--what-to-capture)
- [Known limitations](#known-limitations)
- [Failure modes](#failure-modes)
- [Rollout status and next steps](#rollout-status-and-next-steps)
- [Revision notes](#revision-notes)
- [References](#references)

---

## What this is

Originators want to **see and answer phone calls inside the Origination web app**, with Origination looking up the caller and opening the customer record — similar to the Dynamics 365 Teams dialer.

The approach is Microsoft's **Azure Communication Services (ACS) "custom Teams endpoint"**: the signed-in originator's own Teams identity runs inside the Origination browser tab via the ACS Calling SDK. It is a Teams endpoint like Teams desktop or Teams mobile — calls ring on all of them at once, and whichever one answers takes the call. Call audio flows through the browser tab (WebRTC), not through the installed Teams client.

**Nothing calls back into Origination.** ACS never sends anything to the API. The browser receives the incoming-call event directly from the Teams/ACS cloud, and your Angular code decides what to do with it. The API's only ACS involvement is one outbound call to exchange tokens.

---

## Status

| Capability | Status (2026-10-29) |
|---|---|
| ACS resource for token exchange | Live in **dev** and **qa** |
| Admin consent for the ACS Teams scopes on the SPA registration | Granted in **dev** and **qa** |
| API managed-identity access to ACS | Live in **dev** (**verified** — the deployed API's exchange returns 200) and **qa** |
| API egress to ACS (FortiGate) | Live in **dev** (**verified**), **qa** and **prod** (prod ahead of go-live). See [API egress](#api-egress-azure--acs) |
| Developer access for local exchanges | Via the **Origination - Developer Azure Access** access package (direct role assignment, **dev only** — local development runs against dev) — see [Access for developers](#access-for-developers-local-token-exchange) |
| Scenario 1 (direct PSTN call, answered in the browser) | **Works** |
| Scenarios 2 and 3 (site-number queue calls) | **Not yet validated** — needs the test originator on a conference-mode queue. Required before site numbers rely on browser calling |
| QA in the app | **Your change:** set `Acs:Endpoint` in `appsettings.QA.json` and the QA values in `environment.qa.ts` (see [Reference values](#reference-values)). Until then QA's exchange returns 204 and calling stays off |
| Prod | Defined, not provisioned — go-live needs a change request and Microsoft's answer on post-2028 support |

---

## Scenarios to validate

Two kinds of inbound call must both work:

| # | Scenario | Question | Why it matters |
|---|---|---|---|
| 1 | A producer dials an originator's **own** Teams number (Direct Routing) | Does it ring in the Origination tab, and does `callerInfo` carry the caller's **phone number**? | **Confirmed working 2026-10-28** |
| 2 | A producer dials a **site** number (`<Site> AutoAttd` → `<Site> Main` call queue, **conference mode ON**) | Does it ring in the Origination tab for an originator who is an agent on that queue? Does `callerInfo` carry the **original caller's** number, or the queue / resource account? | **Undocumented for our configuration — not yet validated.** Microsoft's Teams call-queue docs list only Teams desktop/mobile clients; one field report saw the queue's number instead of the caller's |
| 3 | Same as 2, answered in **Teams desktop** while the Origination tab is open | Can the tab still pop the customer record even when the user answers in Teams? | A fallback experience if in-browser answering is unwanted |

Scenario 1 is enough for direct numbers. If scenario 2 fails, site numbers would use **Teams Phone extensibility** (server-side call routing) instead, while direct numbers keep this approach. Don't build anything for that yet — just report what you observed.

---

## How it fits together

```mermaid
sequenceDiagram
    autonumber
    actor Producer as Producer (caller)
    participant SPA as Angular SPA<br/>(Origination - Dev)
    participant Entra as Microsoft Entra ID
    participant API as Origination API<br/>(app-origination-dev-eus)
    participant ACS as ACS<br/>(acs-origination-dev-eus)
    participant Teams as Teams / ACS cloud

    rect rgb(235, 242, 250)
    Note over SPA,ACS: Start the call agent (once per tab; the token refresher repeats steps 1-6 before expiry)
    SPA->>Entra: acquireTokenSilent(Teams.ManageCalls, Teams.ManageChats)
    Entra-->>SPA: Entra token (aud = ACS, appid = SPA client ID)
    SPA->>API: POST /api/calling/token<br/>Authorization: normal API token<br/>body: teamsUserAadToken
    Note over API: [Authorize]<br/>oid taken from the validated API token
    API->>ACS: GetTokenForTeamsUser(token, SPA client ID, oid)<br/>authenticated as the App Service managed identity
    ACS-->>API: ACS access token (validates appid and oid match)
    API-->>SPA: token, expiresOn
    SPA->>Teams: createTeamsCallAgent(AzureCommunicationTokenCredential)<br/>registers the endpoint (registrar.communication.microsoft.com)
    Note over SPA,Teams: Signalling and media go directly between the browser and Microsoft,<br/>outbound from the user's device. The API is not in this path.
    end

    rect rgb(240, 248, 235)
    Note over Producer,Teams: Inbound call (direct number, or site number via auto attendant and call queue)
    Producer->>Teams: Dials originator's number or a site number
    Teams-->>SPA: incomingCall event (also rings Teams desktop / mobile)
    Note over SPA: Read callerInfo.identifier (PhoneNumberIdentifier, E.164)
    SPA->>API: look up the customer by phone
    API-->>SPA: Customer record
    Note over SPA: Show who is calling; open the record (before or on Answer)
    SPA->>Teams: incomingCall.accept()
    Teams-->>SPA: Call connected (audio in the browser tab)
    end
```

Route names are illustrative — use your API's own conventions (Origination's controllers are `api/[controller]`, so its exchange is `POST /api/calling/token`).

Two Entra tokens are involved and they are **different tokens**:

| Token | Requested by | Audience | Used for |
|---|---|---|---|
| Normal API token | SPA (existing `MsalInterceptor`) | Origination API | Authenticating the call to your exchange endpoint |
| ACS Teams token | SPA (new, explicit `acquireTokenSilent`) | Azure Communication Services | Passed *in the request body* to be exchanged — the API never validates or reads it itself |

An Entra access token is issued for one resource, so these cannot be combined into a single request.

---

## Reference values

Per environment:

| Item | dev | qa |
|---|---|---|
| SPA app registration | **Origination - Dev**, client ID `e0f25943-ae8b-4c2d-8060-c9ffbd448aff` | **Origination - QA**, client ID `c2bb1208-063d-43aa-bad0-6b51d21437b4` |
| API app registration | **Origination API - Dev**, client ID `00078a10-3f3f-4d17-9350-fe90401125ae` | **Origination API - QA**, client ID `f3fcab2b-98c8-4622-86bd-c874d281b22a` |
| ACS resource | `acs-origination-dev-eus` (`rg-origination-dev-eus`) | `acs-origination-qa-eus` (`rg-origination-qa-eus`) |
| ACS endpoint (`Acs:Endpoint`) | `https://acs-origination-dev-eus.unitedstates.communication.azure.com` | `https://acs-origination-qa-eus.unitedstates.communication.azure.com` |
| App Service managed identity (principal ID) | `7ff98598-94a0-42cb-81d9-87a6200cb3d9` | `14bc8ee3-de60-48ea-a2f5-5064ad568371` |

Prod (`acs-origination-eus`) isn't provisioned yet — leave its `Acs:Endpoint` empty.

All environments:

| Item | Value |
|---|---|
| Tenant ID | `1521f999-f722-4a4f-9747-166f93e9b0d1` |
| Subscription (dev, qa) | `scoular-apps-nonprod` |
| ACS data location | United States |
| ACS Teams scopes (request both) | `https://auth.msft.communication.azure.com/Teams.ManageCalls`<br>`https://auth.msft.communication.azure.com/Teams.ManageChats` |
| `clientId` argument for the exchange | **That environment's SPA client ID** — it must equal the `appid` of the ACS Teams token, which the SPA requested |
| App Service managed identity (system-assigned) | Principal (object) IDs above. Some portal views show an identity's *application* ID instead (dev: `1e4465d9-62bc-4ec3-bcac-c75462ee439e`) — same identity |
| ACS role | **Communication and Email Service Owner** — sufficient for the exchange; **Contributor is not needed** |
| Azure Communication Services first-party app | appId `1fd5118e-2576-4263-8130-9503064c837a` (already present in the tenant) |
| Local auth (access keys / connection strings) | **Disabled.** There is no connection string. Key-signed requests are rejected with HTTP 401 |
| Hosts the SDK was observed using | `config.teams.microsoft.com`, `go.trouter.teams.microsoft.com` (HTTPS + WSS), `teams.microsoft.com`, `registrar.communication.microsoft.com` |

---

## What Infrastructure has already done

You do **not** need to do any of these, and should not try to — most need roles developers don't hold:

1. **Created the ACS resource** with `disableLocalAuth: true`. Authentication is Entra-only, so there is no secret to store, rotate or leak.
2. **Granted `Communication and Email Service Owner`** to the App Service's system-assigned managed identity, **directly** on the ACS resource. That is what the deployed API uses, and it works.
3. **Gave developers direct access through the access package** (see [Access for developers](#access-for-developers-local-token-exchange)). The original grant to the *Azure - Origination App - Developer Admins* **group** does not work for ACS — see below.
4. **Granted tenant-wide admin consent** for the dev and qa SPA registrations to `Teams.ManageCalls` and `Teams.ManageChats` on Azure Communication Services. Users will **not** see a consent prompt. Both now appear in the configured list on the SPA registration's **API permissions** blade — they're managed by Infrastructure's IaC; don't add or remove permissions there yourself.
5. **Opened API egress to the ACS endpoint** on the FortiGate (see [API egress](#api-egress-azure--acs)).

**No new app settings were added** to the App Service. The values your code needs are non-secret; put them in `appsettings.{Env}.json` and `environment.{env}.ts`.

---

## Access for developers (local token exchange)

**ACS ignores Azure role assignments granted through group membership.** Infrastructure confirmed this on 2026-10-28 with controlled tests on `acs-origination-dev-eus` — the same role works directly and fails via a group, even with the group present in the token:

| Role | Assigned to | Result |
|---|---|---|
| Communication and Email Service Owner / Contributor | the user, **directly** (resource or resource group) | ✅ authorized within ~1–2 minutes |
| Communication and Email Service Owner / Contributor | a **group** the user is in | ❌ `401 Denied by the resource provider` (still denied after 8 minutes) |
| Owner | a group, inherited from the tenant root | ❌ 401 |

So the role was never the problem — **Contributor is not required**. What matters is that the assignment is **to the user directly**.

**How developers get it:** the **Origination - Developer Azure Access** access package (My Access) now also delivers *Communication and Email Service Owner* at the `rg-origination-dev-eus` resource group as a **direct, per-user** assignment, alongside the usual group memberships. If you already hold the package, you have it (existing assignments were reprocessed on 2026-10-28). New requests get it automatically. Allow 1–2 minutes after the assignment appears before testing.

Locally, `DefaultAzureCredential` uses your `az login`, so sign in with the account that holds the package (regular or admin account — whichever you requested it for).

---

## API (.NET): the token-exchange endpoint

### NuGet

```
Azure.Communication.Identity      (Origination uses 1.3.1)
Azure.Identity                    (already referenced for Key Vault / SQL)
```

### Configuration

`appsettings.Dev.json`:

```json
{
  "Acs": {
    "Endpoint": "https://acs-origination-dev-eus.unitedstates.communication.azure.com",
    "TeamsClientId": "e0f25943-ae8b-4c2d-8060-c9ffbd448aff"
  }
}
```

`TeamsClientId` is the **SPA** client ID, not `AzureAd:ClientId` (which is the API's).

A good pattern (Origination's): when `Acs:Endpoint` is empty, the exchange endpoint returns **204** and the client treats that as "no calling in this environment" — it never downloads the SDK. That keeps qa/prod builds safe until those environments are provisioned.

### Program.cs — register the identity client

Reuse the credential pattern already used for Key Vault — `ManagedIdentityCredential` on App Service, `DefaultAzureCredential` locally. Excluding the managed-identity probe locally avoids a slow IMDS timeout on a laptop:

```csharp
using Azure.Communication.Identity;
using Azure.Core;
using Azure.Identity;

var isAppService = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"));
TokenCredential acsCredential = isAppService
    ? new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned)
    : new DefaultAzureCredential(new DefaultAzureCredentialOptions { ExcludeManagedIdentityCredential = true });

builder.Services.AddSingleton(_ =>
    new CommunicationIdentityClient(
        new Uri(builder.Configuration["Acs:Endpoint"]!),
        acsCredential));
```

A lazily-constructed singleton (built on first exchange) is equally fine and lets the API start with `Acs:Endpoint` empty.

### The endpoint

```csharp
using System.Security.Claims;
using Azure.Communication.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

public sealed record TeamsTokenRequest(string TeamsUserAadToken);
public sealed record TeamsTokenResponse(string Token, DateTimeOffset ExpiresOn);

[ApiController]
[Route("api/calling")]   // follow your API's own route convention
[Authorize]
public sealed class CallingController(
    CommunicationIdentityClient identityClient,
    IConfiguration configuration,
    ILogger<CallingController> logger) : ControllerBase
{
    [HttpPost("token")]
    public async Task<ActionResult<TeamsTokenResponse>> ExchangeAsync(
        [FromBody] TeamsTokenRequest request, CancellationToken cancellationToken)
    {
        // The user's object ID comes from the VALIDATED API token, never from the request body.
        var oid = User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
                  ?? User.FindFirstValue("oid");
        if (string.IsNullOrEmpty(oid) || string.IsNullOrWhiteSpace(request.TeamsUserAadToken))
        {
            return BadRequest();
        }

        try
        {
            var result = await identityClient.GetTokenForTeamsUserAsync(
                new GetTokenForTeamsUserOptions(
                    request.TeamsUserAadToken,
                    configuration["Acs:TeamsClientId"]!,
                    oid),
                cancellationToken);

            return new TeamsTokenResponse(result.Value.Token, result.Value.ExpiresOn);
        }
        catch (Azure.RequestFailedException ex)
        {
            // Log the status and error code only -- never the tokens.
            logger.LogWarning("ACS Teams token exchange failed: {Status} {ErrorCode}", ex.Status, ex.ErrorCode);
            return StatusCode(StatusCodes.Status502BadGateway);
        }
    }
}
```

Set a sensible timeout on the exchange (or its `CancellationToken`): with Azure.Core's default retries, an unreachable endpoint can hang the request for minutes before failing.

### Security rules for the endpoint

- **Take `oid` from the authenticated principal**, not from the client. ACS checks that the Entra token was issued to that `oid` and to that `clientId`, so binding `oid` to the caller's own API token means a user can only ever obtain an ACS token for themselves.
- **Never log either token** (the incoming Entra token or the returned ACS token). Both are bearer credentials.
- **`[Authorize]` is enough when it's the same gate as the rest of the API.** Only members of the app's access groups can sign in to the SPA at all (SPA assignment-required), so a valid API token already means "an Origination user". Add an app-role policy only if calling should be narrower than the app.
- **Do not cache tokens server-side.** The SPA refreshes on demand.
- Do not add `AllowCredentials()` CORS or any new CORS origin for this endpoint — the SPA calls it same-origin.

---

## SPA (Angular): the call agent

### npm packages

```
@azure/communication-calling      (2.0.0 GA)
@azure/communication-common
```

`@azure/msal-browser` / `@azure/msal-angular` are already in use. The GA 2.0.0 typings include `transferorInfo` on incoming calls (reported by the Origination team), so the beta package isn't needed to capture it for the test plan. Microsoft's reference still marks some of these properties preview — don't build production logic on them without checking.

### Environment config

Add to `environment.dev.ts` (and `environment.ts` for local runs):

```typescript
incomingCallEnabled: true,   // false in qa/prod until provisioned
acs: {
  teamsScopes: [
    'https://auth.msft.communication.azure.com/Teams.ManageCalls',
    'https://auth.msft.communication.azure.com/Teams.ManageChats',
  ],
},
```

Build the exchange URL from your existing API base URL rather than adding a second base. Do **not** add the ACS scopes to the `MsalInterceptor` `protectedResourceMap`, and do **not** add them to the login request — they are requested explicitly, only when the call agent starts.

### Getting the Entra token for ACS

```typescript
import { InteractionRequiredAuthError } from '@azure/msal-browser';

async function getAcsTeamsEntraToken(msal: MsalService): Promise<string> {
  const account = msal.instance.getActiveAccount()!;
  const request = { scopes: environment.acs.teamsScopes, account };
  try {
    return (await msal.instance.acquireTokenSilent(request)).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      // Admin consent is already granted, so this should only fire for a session
      // problem (e.g. expired refresh token), never for consent.
      return (await msal.instance.acquireTokenPopup(request)).accessToken;
    }
    throw e;
  }
}
```

### Creating the TeamsCallAgent

```typescript
import { CallClient, TeamsCallAgent } from '@azure/communication-calling';
import { AzureCommunicationTokenCredential } from '@azure/communication-common';

async function fetchAcsToken(): Promise<string> {
  const teamsUserAadToken = await getAcsTeamsEntraToken(msal);
  const res = await firstValueFrom(
    http.post<{ token: string; expiresOn: string }>(`${apiBaseUrl}/calling/token`, { teamsUserAadToken }),
  );
  return res.token;
}

// ONE CallClient per tab, created once and reused for every (re)connect.
const callClient = new CallClient();

function createCredential() {
  return new AzureCommunicationTokenCredential({
    tokenRefresher: fetchAcsToken,   // called again automatically before expiry
    refreshProactively: true,
  });
}

let credential = createCredential();
const teamsCallAgent: TeamsCallAgent = await callClient.createTeamsCallAgent(credential);
```

- **Do not call `askDevicePermission` here.** See [Microphone permission](#microphone-permission) — doing so on every start is what kept the microphone in use.
- Always use the `tokenRefresher` form. The SDK reads the expiry from the token itself and refreshes ahead of it; the refresher re-runs both steps (MSAL silent → exchange endpoint) transparently.
- When you replace an agent, **dispose the old agent and its credential** (the credential's refresh timer otherwise keeps running and makes extra exchange calls).

### Reconnect, backoff and registrar throttling

When the agent starts, the SDK **registers** the browser as a Teams endpoint (`POST https://registrar.communication.microsoft.com/registrar/prod/v3/registrations`). **The registrar throttles aggressive re-registration** and says how long to wait:

```
429 {"code":42901,"retryAfter":"00:01:54.63","message":"Request was throttled"}
```

What went wrong in the first dev build (observed live, 2026-10-28): the app reacted to every `Disconnected` by waiting 2 s, disposing everything and starting again with a fresh token, a new `CallClient` and a new registration — and reset its retry counter as soon as `createTeamsCallAgent` resolved, so the delay never grew. One tab made ~90 token exchanges in 4 minutes, every registration got a 429, and the throttle never expired.

Rules that fixed it:

- **Reset the failure counter only after the registration has stayed `Connected` for a while** (e.g. 60 s) — not when `createTeamsCallAgent` resolves.
- **Exponential backoff with jitter and a cap** (e.g. 5 s, 10 s, 20 s… capped at a few minutes).
- **Honour `retryAfter`** on a 429 / code 42901 as the minimum wait; if a 429 carries no readable value, wait a couple of minutes.
- **Branch on the disconnect reason.** `connectionStateChanged` reports `reason: 'invalidToken' | 'connectionIssue'`; the SDK can't swap an agent's credential, so `invalidToken` rebuilds with a fresh token — but through the same backoff.
- **Give up** after N consecutive failures (e.g. 6) and settle in an "unavailable" state until the next page load or sign-in.
- **Ignore late events from an agent you've already replaced**, and if the connection drops during a call, re-register after the call ends.

After a throttling episode, the registrar keeps throttling for about **2 minutes after the last attempt** — close the tab and wait before retesting.

### Microphone permission

**The SDK's `deviceManager.askDevicePermission({ audio: true })` opens a real microphone stream and holds it for about 5 seconds** — even when permission is already granted (from reading SDK 2.0.0's code). Calling it on every agent start, combined with the reconnect loop above, kept the microphone-in-use indicator permanently on.

Recommended pattern (the microphone is only opened for a fraction of a second, once):

1. When the agent has registered, check **`navigator.permissions.query({ name: 'microphone' })`** — this does **not** open the device. Treat an unsupported/throwing query as `prompt`.
   - **`granted`** — do nothing.
   - **`prompt`** — show a small one-time banner (*"Enable call audio so you can answer Teams calls here"*, **Enable** / **Not now**). On **Enable** (a user gesture), call `navigator.mediaDevices.getUserMedia({ audio: true })` and **immediately stop every track** (`stream.getTracks().forEach(t => t.stop())`). The browser remembers the grant for the site. "Not now" suppresses the banner for the session.
   - **`denied`** — show a non-blocking hint that the microphone is blocked for this site and how to allow it, so users find out before a call.
   - Listen to the `PermissionStatus` `change` event so the UI follows site-setting changes.
2. **Keep a check on Answer** (`askDevicePermission` there is fine — the call is about to use the microphone anyway). It covers users who chose Chrome's "Allow this time" or dismissed the banner.
3. Only the elected agent tab should show the banner.

**Admin alternative for a production rollout:** Chrome and Edge's managed policy **`AudioCaptureAllowedUrls`** pre-grants the microphone for listed origins on managed devices (no prompt at all). That's an Endpoint Management change, not an app change.

### Handling an incoming call and the screen pop

```typescript
import { isPhoneNumberIdentifier, isMicrosoftTeamsUserIdentifier } from '@azure/communication-common';

teamsCallAgent.on('incomingCall', async ({ incomingCall }) => {
  const caller = incomingCall.callerInfo;            // { identifier, displayName }
  const id = caller.identifier;

  let phoneE164: string | undefined;
  if (id && isPhoneNumberIdentifier(id)) {
    phoneE164 = id.phoneNumber;                      // e.g. '+18165551234' -- E.164
  } else if (id && isMicrosoftTeamsUserIdentifier(id)) {
    // internal Teams-to-Teams call; id.microsoftTeamsUserId is the caller's Entra oid
  }

  // Look the customer up BEFORE the user answers, so the ringing UI can say who it is.
  const customer = phoneE164 ? await customerService.findByPhone(phoneE164) : undefined;

  showIncomingCallUi({
    displayName: caller.displayName,
    customer,
    accept: async () => {
      const call = await incomingCall.accept();      // audio now in this tab
      if (customer) router.navigate(['/customers', customer.id]);
      call.on('stateChanged', () => { /* 'Connected' | 'Disconnected' ... */ });
    },
    reject: () => incomingCall.reject(),
  });

  incomingCall.on('callEnded', () => hideIncomingCallUi()); // answered elsewhere, or caller hung up
});
```

Notes:

- **When to open the record is a product choice.** Origination shows who's calling on the ringing card and opens the producer's page on **Answer**, so originators aren't pulled off their work for calls they don't take. Do the lookup before answering either way.
- **Teams-to-Teams (colleague) calls** can be left to Teams entirely — Origination doesn't pop for them. To test the popup, call from an outside phone (PSTN), not from a Teams colleague.
- `callEnded` fires when the call is answered on **another** endpoint (Teams desktop/mobile) or abandoned — dismiss your ringing UI on it.
- Phone numbers arrive in **E.164**. Normalise the customer records you match against.
- **Caller phone numbers are PII — keep them out of telemetry and logs in every environment.** Three places they leak without anyone writing a log line:
  - **The request URL.** The API's App Service auto-instrumentation records every request's **full URL, query string included**, in App Insights (`requests.url`) — verified on Origination dev, 2026-10-29. So never put the number in a query string or route (`GET …/calling/match?number=…` stores every caller's number). Send it in a **POST body**, which isn't recorded.
  - **Browser dependency tracking.** Keep the App Insights JS SDK's `disableAjaxTracking` / `disableFetchTracking` on (Origination has them on), or the SDK records the same URLs from the browser.
  - **Server logs.** Log counts and outcomes (`matched {Count} producers`), never the number.
- For the [test plan](#test-plan--what-to-capture), log `callerInfo` / `transferorInfo` to the browser console in **dev builds only**. Gate it on an explicit dev-only flag, **not** `!environment.production`: Origination's QA build also has `production: false`. QA gets real calls from real producers — a call to an originator's own number rings every endpoint they're signed into, a QA tab included.

### Lifecycle: one agent, one tab, clean teardown

- **One call agent per user.** Every open tab with an agent is a separate endpoint that rings and can answer. Elect a single tab with the **Web Locks API** (e.g. lock `origination.incomingCall.agent`) and only create the agent there; other tabs wait for the lock.
- **Keep the tab alive.** Ringing needs the tab open with a connected agent. Background tabs work but browsers throttle them; a sleeping laptop drops the connection (the reconnect rules above handle recovery).
- **Teardown on sign-out:** dispose the agent and its credential, then `callClient.dispose()` (which also releases its device manager).

### Make failures visible

An exchange or registration failure is otherwise indistinguishable from "working, no call yet". At minimum, log a one-line reason to the console in non-production builds (e.g. `[incoming-call] … re-registering in N s (failure k of 6)`), and log the server-side exchange failure (status/error code only) to App Insights.

---

## Security headers (CSP and Permissions-Policy)

Origination builds its policy in `SecurityHeadersMiddleware.cs` (there is no separate `CspNonceMiddleware` in this app). Apply the calling additions **only when calling is enabled** (e.g. when `Acs:Endpoint` is set):

1. **`worker-src 'self' blob:` is required.** The Calling SDK starts a Web Worker from a `blob:` URL; without `worker-src`, the browser falls back to `script-src 'self'` and blocks it:
   ```
   Creating a worker from 'blob:https://…' violates the following Content Security Policy directive: "script-src 'self'".
   Note that 'worker-src' was not explicitly set, so 'script-src' is used as a fallback.
   ```
   (Origination: config key `SecurityHeaders:SpaCallingWorkerSrc = "blob:"`.)
2. **`connect-src`** must reach the hosts the SDK uses. Observed in dev: `https://config.teams.microsoft.com`, `https://go.trouter.teams.microsoft.com` + `wss://go.trouter.teams.microsoft.com`, `https://teams.microsoft.com`, `https://registrar.communication.microsoft.com`. Microsoft doesn't publish a CSP list and some hosts are dynamic, so a wildcard set is practical:
   ```csharp
   "connect-src 'self' " +
       // existing MSAL / App Insights entries ...
       "https://*.communication.azure.com wss://*.communication.azure.com " +
       "https://*.teams.microsoft.com wss://*.teams.microsoft.com " +
       "https://*.microsoft.com wss://*.microsoft.com " +
       "https://*.skype.com wss://*.skype.com; "
   ```
   `*.microsoft.com` is broad; tighten it (e.g. to `*.teams.microsoft.com` and `*.communication.microsoft.com`) once the hosts are confirmed over a longer test. A host with no port matches only the default port — if a console violation shows a non-default port (a Microsoft Q&A thread reports the signalling socket on `:3443`), add it explicitly.
3. **Permissions-Policy:** don't block the microphone. Origination sets no `Permissions-Policy` today; if one is added, use `microphone=(self)`, not `microphone=()`.
4. **Media is not governed by `connect-src`** — WebRTC media bypasses it — so audio problems are network problems, not CSP.

CSP violations appear only in **DevTools → Console** — never in HAR files or App Insights.

---

## Network requirements

### API egress (Azure → ACS)

The API's token exchange leaves Azure through the FortiGate. The ACS endpoint resolves through **Azure Front Door** (`azurecommunicationservice.azurefd.net` → Traffic Manager) to a rotating set of `150.171.x.x` addresses.

What we found (2026-10-28): the standard FQDN allow rule — which also requires the TLS application signatures (SSL_TLSv1.2 / 1.3 / 1.3.PQC) — **did not match** this traffic; the FortiGate classed it as `Microsoft-Azure.Front.Door` / `Microsoft-Office365` and it fell through to the subnet's deny rule, so the exchange **timed out** from the deployed API (it worked locally, where traffic doesn't cross that firewall). The rule now matches the ACS hostname on **service HTTPS without application-signature matching**, and the exchange returns 200. Infrastructure is codifying that rule shape; nothing is needed from app teams, but a **timeout from the deployed API that doesn't happen locally** is the signature of this class of problem.

### Users' devices

These are requirements on the **originator's own network path** (office LAN, Wi-Fi, VPN), not on Azure. If calls connect but there's no audio, or audio is choppy, this is where to look — a Network team conversation, not a code change.

| Purpose | Destination | Ports |
|---|---|---|
| Media (audio) | `20.202.0.0/16` | UDP 3478–3481, TCP 443 |
| Signalling, registration, telemetry | `*.skype.com`, `*.microsoft.com`, `*.azure.net`, `*.azure.com`, `*.office.com` | TCP 443, 80 |

Microsoft recommends **split-tunnel VPN** for this traffic. Note `20.202.0.0/16` is **not** the Teams client's media range (`52.112.0.0/14`), so "Teams works on my laptop" does not prove ACS media will.

---

## Test plan — what to capture

For each test call, record (browser console in dev is fine):

| Field | Source |
|---|---|
| Scenario (1 / 2 / 3 above), site queue name, time | — |
| `incomingCall.callerInfo` (full JSON) | GA |
| `incomingCall.transferorInfo` (full JSON) | GA 2.0.0 typings (see note above) |
| Whether the call rang in the tab at all, and in Teams desktop at the same time | observation |
| Who could answer, and what happened on the other endpoints | observation |
| Audio quality on office network and on VPN | observation |

Healthy startup in DevTools: **one** `POST …/calling/token` (200) at sign-in, one registration with no 429, the trouter WebSocket staying open, and **no microphone indicator** until the user enables call audio or answers.

Infrastructure will arrange, with the Teams administrators, a test originator who has a Direct Routing number **and** is an agent on one conference-mode site queue. Send the captured results to Infrastructure — they decide whether site numbers use this approach or the Teams Phone extensibility fallback.

---

## Known limitations

- **Mobile browsers are not a realistic softphone.** Android Chrome mutes the microphone after about a minute in the background; iOS Safari reloads the page on app switch; no Bluetooth on iOS Safari. Desktop Chrome / Edge / Safari are supported.
- **Teams dial plans and caller-ID policies are not applied** to calls placed from this endpoint — dial in E.164, and outbound calls show the user's own number (not a site number).
- **Channel-based call queues are unsupported** (2 of the 52 site queues today) — Microsoft supports them on the Teams Windows/Mac clients only.
- **Emergency (911) calls** from a browser endpoint may not convey a dispatchable location on our Direct Routing setup. Don't promote browser calling as the place to dial 911.
- **Platform lifecycle:** Microsoft has announced ACS's standalone retirement for 2028-09-30. Calling SDK workloads stay supported only when used with a supported Teams-aligned service; Microsoft's guide names Teams Phone Extensibility and Teams Meeting interoperability among them but does **not** name this pattern (one-to-one calls received as a Teams user via a custom Teams endpoint) verbatim. **Infrastructure is getting confirmation through a Microsoft support case (https://aka.ms/acs-retirement-support) before prod**, and plan for an SDK major-version upgrade before 2028.

---

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| MSAL `AADSTS65001` (consent required) for the ACS scopes | Requested from a different registration than the dev SPA, or in a non-dev environment | Use the SPA client ID of the same environment; prod isn't provisioned |
| **Local** exchange returns `401 Denied by the resource provider` | Your access comes only via a **group** (ACS ignores group-based role assignments) | Request / hold the **Origination - Developer Azure Access** package (direct assignment); wait 1–2 minutes |
| Exchange returns 401 / mismatch error | `clientId` ≠ the ACS token's `appid` (e.g. you passed the API client ID), or `oid` doesn't match | Pass the **SPA** client ID; take `oid` from the authenticated API principal |
| Exchange **times out from the deployed API**, works locally | FortiGate egress rule not matching the ACS (Front Door) traffic | Infrastructure — see [API egress](#api-egress-azure--acs) |
| `Creating a worker from 'blob:…' violates … "script-src 'self'"` in the console | No `worker-src` in the CSP | Add `worker-src 'self' blob:` |
| `Refused to connect … violates the following Content Security Policy directive` | CSP `connect-src` | See [Security headers](#security-headers-csp-and-permissions-policy) |
| Token exchange repeating every few seconds; `429 … registrations … "code":42901` | Reconnect loop with no growing backoff, ignoring `retryAfter` | See [Reconnect, backoff and registrar throttling](#reconnect-backoff-and-registrar-throttling); close the tab ~2 min before retesting |
| Microphone-in-use indicator permanently on with no call | `askDevicePermission` called on every agent start (holds the mic ~5 s each time), usually combined with a reconnect loop | See [Microphone permission](#microphone-permission) |
| Microphone permission silently denied | `Permissions-Policy: microphone=()`, or the site is blocked in browser settings | Use `microphone=(self)`; check the site's permission (the `denied` hint) |
| Nothing visible happens, no popup | Exchange or registration failing silently | Check the Network tab for the exchange status; see [Make failures visible](#make-failures-visible) |
| Call connects, no audio | User's network blocks UDP 3478–3481 / `20.202.0.0/16`, or VPN hairpin | Network team; try off-VPN to confirm |
| Phone rings in Teams desktop but not in the tab | No connected call agent (tab closed, laptop slept, gave up after repeated failures) or the scenario is unsupported (channel-based queue) | Reload; record it as a test result if it's a queue scenario |
| No popup for a colleague's Teams call | By design if your app ignores Teams-to-Teams callers | Test with an outside (PSTN) call |

---

## Rollout status and next steps

Infrastructure has:

1. Codified the SPA's ACS delegated permissions (`spaDelegatedPermissions[]` in the IaC app config) — dev's hand-made consent was adopted, qa's created.
2. Provisioned **qa**: ACS resource, managed-identity role, consent and FortiGate rule. Developer access-package roles stay **dev only** (local development runs against dev).
3. Codified the FQDN egress rule shape that works for Front Door-fronted endpoints, and created the **prod** FortiGate rule ahead of go-live.

Still to come:

- **Your QA config** — `Acs:Endpoint` and the QA SPA values (see [Reference values](#reference-values)).
- **Scenario 2/3 validation** with a test originator on a conference-mode site queue.
- **Prod go-live** — change request, the Microsoft support-case answer, then the prod ACS resource and consent.
- Header, scope and external-access requirements against IT Security's mobile-access standard before any external (Static Web App) exposure of calling.

Your code should therefore keep the endpoint and client ID in **per-environment config**, never hardcoded.

---

## Revision notes

**2.1 (2026-10-29)** — out of the POC phase. Caller-number PII rules made explicit after a code review (request URLs are recorded by App Service auto-instrumentation; `!environment.production` is true in QA builds). QA infrastructure live (ACS resource, MI role, consent, FortiGate rule); per-environment reference values; the consent now appears in the SPA's configured API permissions (managed by IaC); prod defined but not provisioned; scenario 2/3 reframed as an open validation for site numbers rather than a go/no-go for the whole feature.

**2.0 (2026-10-28)** — after the first end-to-end dev test, combining Infrastructure's live diagnosis with the Origination team's implementation notes (Caden, 2026-10-28). Items marked *reported* come from the Origination team and weren't independently re-tested by Infrastructure.

- **Developer access:** ACS ignores group-based role assignments; access moved to a direct assignment via the access package. Contributor is not required (the original role was correct).
- **API egress:** the FQDN rule needed service-HTTPS matching without application signatures for the Front Door-fronted ACS endpoint.
- **Microphone:** removed the advice to call `askDevicePermission` up front (it holds the microphone ~5 s per call); added the permission-query + one-time banner pattern and the `AudioCaptureAllowedUrls` policy option.
- **Reconnect:** added the registrar throttling (429 / 42901 / `retryAfter`) findings and backoff rules; one `CallClient` per tab; dispose credentials.
- **CSP:** `worker-src 'self' blob:` is required; listed observed hosts; corrected the reference to a `CspNonceMiddleware` that Origination doesn't have; Origination sets no `Permissions-Policy` (*reported*).
- **Routes and config:** routes follow the API's conventions (no `/v1` in Origination); exchange URL built from the API base URL; the 204-when-unconfigured pattern; `DefaultAzureCredential` without the managed-identity probe locally.
- **SDK:** GA 2.0.0's typings include `transferorInfo` (*reported*); beta package not needed for the test plan.
- **Gate:** `[Authorize]` with the app's standard sign-in gate is sufficient.
- **Screen pop / colleagues:** documented lookup-before-answer with open-on-Answer as a valid product choice, and that colleague Teams calls may be left to Teams.
- **Reference values:** managed identity's object ID vs application ID clarified; registrar host added.
- **2028 wording:** clarified that the custom Teams endpoint isn't named verbatim among Teams-aligned scenarios; recommend a Microsoft support case before qa/prod.

**1.0 (2026-10-27)** — initial guide.

---

## References

- [Custom Teams endpoint use cases](https://learn.microsoft.com/en-us/azure/communication-services/concepts/interop/custom-teams-endpoint-use-cases)
- [Teams endpoint overview](https://learn.microsoft.com/en-us/azure/communication-services/concepts/teams-endpoint)
- [Set up and create access tokens for Teams users (quickstart)](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/manage-teams-identity)
- [Authentication for apps with Microsoft 365 users](https://learn.microsoft.com/en-us/azure/communication-services/concepts/interop/custom-teams-endpoint-authentication-overview)
- [Manage calls for Teams users](https://learn.microsoft.com/en-us/azure/communication-services/how-tos/cte-calling-sdk/manage-calls)
- [Network recommendations](https://learn.microsoft.com/en-us/azure/communication-services/concepts/voice-video-calling/network-requirements)
- [Retirement and breaking changes guide](https://learn.microsoft.com/en-us/azure/communication-services/acs-retirement-and-breaking-changes-guide)
- [Assign Azure RBAC roles in access packages (preview)](https://learn.microsoft.com/en-us/entra/id-governance/entitlement-management-azure-role-assignments)

Questions or issues: contact Infrastructure.

---

*Document version: 2.1 | 2026-10-29*
