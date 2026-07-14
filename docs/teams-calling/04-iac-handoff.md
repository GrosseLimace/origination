# IaC Handoff — Azure Provisioning for Teams Calling Screen-Pop

**Audience**: an infrastructure/IaC agent with no prior context on this feature. Everything
needed to provision is in this document; the app-side design lives in the sibling docs
(`00-overview.md` … `03-shared-behavior.md`) but is not required reading to execute this.

## Table of Contents

- [What this is for](#what-this-is-for)
- [Where the infrastructure is defined](#where-the-infrastructure-is-defined)
- [1. Azure Communication Services resource](#1-azure-communication-services-resource)
- [2. Entra ID app registration changes](#2-entra-id-app-registration-changes)
- [3. Key Vault secret](#3-key-vault-secret)
- [4. NSG outbound rule](#4-nsg-outbound-rule)
- [5. App settings](#5-app-settings)
- [6. Tagging](#6-tagging)
- [Prerequisites owned by other teams](#prerequisites-owned-by-other-teams)
- [SBOM impact (app repo, not infra)](#sbom-impact-app-repo-not-infra)
- [Execution checklist](#execution-checklist)
- [Verification](#verification)

## What this is for

The Grain Originator Portal (repo `scoular.ghe.com/IT/origination`, deployed as App Service
`app-origination-{dev|qa}-eus` / `app-origination-eus`) is adding a caller-ID screen-pop: the
Angular SPA hosts an Azure Communication Services (ACS) Calling SDK client authenticated **as the
signed-in user's own Teams identity** ("Teams user" interop / custom Teams client). When a
producer calls the originator's Teams Phone number, the browser receives the `incomingCall` event
and pops the matching producer record. The backend's only ACS role is a token exchange: it swaps
the user's Entra access token for an ACS access token via
`CommunicationIdentityClient.GetTokenForTeamsUser(...)` using the ACS resource connection string.

This is a **real production dependency** — Key Vault/Azure-SQL-grade treatment. It is explicitly
NOT like this repo's local-only field-tagging POC (`docs/maps/PATH-TO-PRODUCTION.md` documents
that pattern's deliberate shortcuts; none of them apply here).

## Where the infrastructure is defined

- Origination's infra config: `infrastructure-as-code` repo (GHE `IT/infrastructure-as-code`),
  file `origination/app-config.json`. Relevant existing sections:
  - `customResources[]` — per-app Bicep add-ons (precedent: the two Logic App entries). The ACS
    resource should be added here as a new Bicep file.
  - `networking.customOutboundRules[]` — currently `[]`; zero-trust outbound NSG means all
    non-private-endpoint egress is denied by default (see `developer-docs/CLAUDE.md` in the
    origination repo, "Critical Constraint: Network Access").
  - `appRegistrations.{dev,qa,prod}.spa` — SPA app registration client/object IDs (targets of
    the Entra change below).
  - `keyVault.shortName: "orig"` → vaults `kv-orig-dev-eus`, `kv-orig-qa-eus`, `kv-orig-eus`.
- Tagging standards: `infrastructure-as-code/docs/AZURE-TAGGING-STANDARDS.md`.
- Subscriptions: nonprod for dev/qa, prod for prod (the repo's GitHub Actions use
  `AZURE_SUBSCRIPTION_ID_NONPROD` / `AZURE_SUBSCRIPTION_ID_PROD`).

## 1. Azure Communication Services resource

One ACS resource per environment (matches every other per-env resource in this app):

| Environment | Suggested name | Resource group |
|---|---|---|
| Dev | `acs-origination-dev` | `rg-origination-dev-eus` |
| QA | `acs-origination-qa` | `rg-origination-qa-eus` |
| Prod | `acs-origination` | `rg-origination-eus` |

Notes:

- Resource type `Microsoft.Communication/communicationServices`; location is `global` with
  `dataLocation: 'United States'`. No region suffix in the name for that reason (adjust to
  naming standards if they require one anyway).
- No phone numbers are purchased on this resource, no Email/SMS/Chat provisioning — it exists
  solely to mint "Teams user" access tokens. Cost at rest is $0; usage cost is $0 for the
  recommended hidden-listener option (tokens and ringing are free; only *connected* browser
  calls bill at $0.004/participant-minute, which only the deferred "embedded dialer" option
  would incur).
- ACS does not sit behind the app's private endpoints; the backend reaches it over public
  HTTPS (hence the NSG rule in §4). Public network access on ACS stays enabled — the data-plane
  operations are authenticated by access key (connection string) held in Key Vault.
- Implement as `customResources[]` Bicep (e.g. `acs-teams-calling.bicep`, environments
  `["dev","qa","prod"]`), following the existing Logic App entries' shape.

## 2. Entra ID app registration changes

Add **delegated** permissions to the **SPA** app registrations (the token being exchanged is
acquired by the SPA):

| Environment | SPA app registration | Client ID |
|---|---|---|
| Dev | Origination - Dev | `e0f25943-ae8b-4c2d-8060-c9ffbd448aff` |
| QA | Origination - QA | `c2bb1208-063d-43aa-bad0-6b51d21437b4` |
| Prod | Origination | `958fd665-daa3-42c5-9903-3c9c00638bf1` |

Required API permissions — resource is the first-party **"Azure Communication Services"** API
(application ID `1fd5118e-2576-4263-8130-9503064c837a` — verify against the tenant's service
principal before scripting):

- `Teams.ManageCalls` (delegated)
- `Teams.ManageChats` (delegated)

Both are required together — the Calling SDK's `createTeamsCallAgent` needs both even though this
feature never sends a chat. **Tenant admin consent** is required once per app registration (this
is not per-user or per-call consent). The permission model is deliberately narrow: delegated
scopes mean any minted ACS token is bound to the signed-in user's own identity and calls only —
far smaller blast radius than an application-permission bot.

**Sequencing requirement (org policy)**: a security review via **asksecurity@scoular.com** must
happen **before** admin consent is granted. Include in the review request: the two delegated
scopes, the token-exchange endpoint design (`POST /api/teams-calling/token` in the origination
API, `[Authorize]`-protected, user object id pinned from the caller's own JWT `oid` claim), and
the fact that the connection string never leaves the backend.

Note: `origination/app-config.json` has a `graphPermissions[]` array; these scopes are on the
ACS first-party API, not Microsoft Graph — confirm whether the provisioning tooling handles
non-Graph resources there, otherwise grant via `az ad app permission add/grant` or the portal
and record the change in the config file's conventions.

## 3. Key Vault secret

Per environment, store the ACS resource's primary connection string:

| Vault | Secret name |
|---|---|
| `kv-orig-dev-eus` | `TeamsCalling--AcsConnectionString` |
| `kv-orig-qa-eus` | `TeamsCalling--AcsConnectionString` |
| `kv-orig-eus` | `TeamsCalling--AcsConnectionString` |

- The double-dash name surfaces as `TeamsCalling:AcsConnectionString` through the app's existing
  `AddAzureKeyVault` configuration wiring (`api/GrainOriginatorPortal.Api/Program.cs` in the
  origination repo) — no new app code or app setting is needed for the secret to be readable.
- The App Service managed identities already hold Key Vault read (RBAC); no new access policy
  work. Key Vault access is private-endpoint-only and audit-logged (existing posture).
- Secret value: `endpoint=https://<acs-name>.communication.azure.com/;accesskey=...` from the
  ACS resource's Keys blade / `az communication list-key`.
- The mere **presence** of this secret enables the feature server-side (the app's config
  endpoint reports `enabled: true` when it is non-empty) — so populate Dev first, QA/Prod only
  at their rollout milestones. Removing the secret is the ops kill switch.
- Future improvement (not v1): replace the connection string with Entra/managed-identity auth to
  ACS (`CommunicationIdentityClient(endpoint, TokenCredential)` + data-plane RBAC). v1 uses the
  connection string per the settled design; do not block provisioning on this.

## 4. NSG outbound rule

Deployed environments deny all outbound except an allow-list. The backend token exchange calls
`https://<acs-name>.communication.azure.com` (TCP 443). Add to
`networking.customOutboundRules[]` in `origination/app-config.json` an HTTPS allow rule for the
ACS endpoint FQDNs (all three, or per-env if the mechanism is env-scoped — note the existing
comment in `developer-docs/CLAUDE.md` that custom outbound rules apply to **all environments
including Dev**). If the NSG mechanism is IP-based rather than FQDN-based, use the
`fortigateFqdnRules` path instead — whichever the platform uses for FQDN egress.

Browser-side note (no infra action): the ACS Calling SDK's signaling traffic
(`*.communication.azure.com`, trouter hosts) originates from **users' browsers**, not the App
Service, so it does not traverse this NSG. Its allow-listing is a Content-Security-Policy change
inside the app (`SecurityHeadersMiddleware.cs`), owned by the app team.

## 5. App settings

No new App Service app settings are required from infrastructure:

- `KeyVaultUri` is already pre-configured on every environment (standard platform setting).
- The one new non-secret config value, `TeamsCalling:SpaClientId` (the environment's SPA client
  ID, needed as a parameter of the token exchange), ships in the app's own
  `appsettings.{Dev,QA,Production}.json` — app repo change, not infra.

## 6. Tagging

Tag the new ACS resources per `infrastructure-as-code/docs/AZURE-TAGGING-STANDARDS.md` — at
minimum the standard set used by the other `rg-origination-*` resources (Environment, Owner,
CostCenter, plus the org-required data-classification tag). Suggested data classification:
**Confidential** — the resource brokers tokens tied to user identities and handles producer
caller-ID metadata (PII-adjacent). Match the exact tag keys/values already on the app's Key
Vault/App Service rather than inventing new ones.

## Prerequisites owned by other teams

Confirm before (or in parallel with) provisioning:

1. **Teams admin**: the tenant (`1521f999-f722-4a4f-9747-166f93e9b0d1`, scoular.com) must be
   Teams **commercial cloud** — ACS Teams-user interop is **not supported in Teams GCC**. Get
   explicit confirmation from whoever owns Teams administration.
2. **Teams admin**: target users (grain originators) have Teams Phone licenses/numbers —
   without them there is nothing to screen-pop for PSTN calls.
3. **Security**: review request to asksecurity@scoular.com submitted and answered before admin
   consent (§2).
4. **Change management**: production enablement (prod consent grant + prod Key Vault secret)
   goes through a ServiceNow CHG per org policy; dev/qa can proceed under normal dev change
   flow.

## SBOM impact (app repo, not infra)

For awareness — the app team must add these to the SBOM tables in the origination repo's
`README.md` (§"Software Bill of Materials") when the implementation lands, per org policy:

| Package | Layer | License | Purpose |
|---|---|---|---|
| `@azure/communication-calling` | Frontend (npm) | MIT | ACS Calling SDK — Teams-user incoming-call events |
| `@azure/communication-common` | Frontend (npm) | MIT | ACS token credential types |
| `Azure.Communication.Identity` | Backend (NuGet) | MIT | Entra→ACS token exchange (`GetTokenForTeamsUser`) |

## Execution checklist

Dev first; QA/Prod repeat at their rollout milestones.

- [ ] Confirm Teams commercial cloud (not GCC) with Teams admin
- [ ] Confirm originators have Teams Phone licenses
- [ ] Submit security review to asksecurity@scoular.com (scopes + design summary above); wait for sign-off
- [ ] Author `acs-teams-calling.bicep` and add `customResources[]` entry in `origination/app-config.json`
- [ ] Deploy ACS resource to Dev (`acs-origination-dev`, `rg-origination-dev-eus`, nonprod subscription), tagged per §6
- [ ] Add delegated `Teams.ManageCalls` + `Teams.ManageChats` (ACS first-party API) to the Dev SPA app registration (`e0f25943-ae8b-4c2d-8060-c9ffbd448aff`)
- [ ] Grant tenant admin consent for the Dev SPA app registration
- [ ] Store `TeamsCalling--AcsConnectionString` in `kv-orig-dev-eus`
- [ ] Add ACS endpoint outbound rule (`networking.customOutboundRules` / FQDN rules) and redeploy networking
- [ ] Hand back to app team for Dev verification (below)
- [ ] Repeat resource + consent + secret + verification for QA (`c2bb1208-063d-43aa-bad0-6b51d21437b4`, `kv-orig-qa-eus`)
- [ ] Prod: ServiceNow CHG, then repeat for Prod (`958fd665-daa3-42c5-9903-3c9c00638bf1`, `kv-orig-eus`)

## Verification

After the Dev checklist, the app team validates end-to-end; the infra-verifiable parts:

```bash
# Resource exists and lists keys
az communication list-key --name acs-origination-dev --resource-group rg-origination-dev-eus

# Secret present
az keyvault secret show --vault-name kv-orig-dev-eus --name TeamsCalling--AcsConnectionString --query id

# Consent visible: the SPA service principal shows the two delegated grants
az ad app permission list --id e0f25943-ae8b-4c2d-8060-c9ffbd448aff
```

Functional proof (app team): a console/API spike calling
`GetTokenForTeamsUser(aadToken, spaClientId, userObjectId)` with a real Dev user token returns an
ACS token; from the deployed Dev App Service the same call succeeds (proves the NSG rule); a test
call to the developer's Teams number raises `incomingCall` in the browser client.
