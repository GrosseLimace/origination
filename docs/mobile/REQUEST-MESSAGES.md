# Mobile Component — Phase 1 Request Messages

Ready-to-send drafts for the three teams on the critical path. Sent by the Origination app team (Caden), not automatically. Fill the `To:` lines, attach or link the two governing documents, then send all three in the same week; the APIM token question and the Conditional Access pilot are the longest lead items in the whole plan.

Every message cites the same two documents so each team can see which requirement drives each ask:

| Short name used below | Document |
|---|---|
| **the Spec** | `SEC-ARCH-BURDI-001` v1.0, *Security Architecture Specification: Burdi Design Pattern* (IT Security / Architecture, 2026-03-25). Repo copy: [reference/SEC-ARCH-BURDI-001-mobile-security-architecture.md](reference/SEC-ARCH-BURDI-001-mobile-security-architecture.md). Section numbers below (§3.3, §4.2, etc.) refer to it |
| **the Guide** | [EXTERNAL-SPA-GUIDE.md](reference/EXTERNAL-SPA-GUIDE.md) v1.7 (repo copy; the original in `developer-docs/` was removed by the 2026-10 infra docs sync), Infrastructure's implementation of the Spec for Scoular: Static Web App → APIM (App Gateway + WAF in front) → private App Service |

Links assume the branch `docs_MobileArchitecturePlan`; update them once merged to `main`.

- Spec (repo copy): https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/docs/mobile/reference/SEC-ARCH-BURDI-001-mobile-security-architecture.md
- Guide: https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/docs/mobile/reference/EXTERNAL-SPA-GUIDE.md
- OpenAPI contract: https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/openapi/mobile/specification.yaml
- Workflow/offline summary: https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/openapi/mobile/README.md
- Architecture plan: https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/docs/mobile/MOBILE-ARCHITECTURE-PLAN.md
- ADR-001 (topology decision + exceptions): https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/docs/adr/ADR-001-mobile-surface-topology.md

## Shared background (paste at the top of each message)

Origination is adding a mobile web app for Scoular originators, who work in the field and need producer information on their phones. It is the first Scoular app to implement **SEC-ARCH-BURDI-001** through the mechanics in **EXTERNAL-SPA-GUIDE.md**:

```
Originator's own phone (Entra ID sign-in with MFA)
  → Azure Static Web App  (separate mobile Angular app)          Spec Layer 2 client
  → Application Gateway + WAF                                      Spec Layer 1
  → Azure API Management  (validate-jwt, rate limit, quota)        Spec Layer 3
  → private endpoint → existing Origination App Service            Spec Layers 4–5
      mobile surface: api/mobile/v1, 17 operations, scope + client-id + trade-unit checks
  → Azure SQL over private endpoint, managed identity              Spec Layer 6
```

The App Service is never exposed to the internet. The only internet-reachable API component is APIM, and it exposes only the 17 operations in `openapi/mobile/specification.yaml`. Each message below explains what we need from your team and which Spec requirement it satisfies.

---

## 1. Data Integrations (APIM) — requests E7 and E8

**To:** _Data Integrations / APIM owners_
**Subject:** Origination mobile: APIM operations per SEC-ARCH-BURDI-001 §3.3, plus one token question that blocks our design

Hi team,

_(shared background)_

**Why you are involved.** The Spec makes APIM mandatory for all external traffic (Core Invariant 4) and lists the gateway policies every external API must have (§3.3). The Guide says Data Integrations owns those APIM operations and imports them from the app team's OpenAPI spec via APIOps. Our contract is committed at the link above: 17 operations, OpenAPI 3.0.3, Redocly-valid, and a CI test fails the build if the API and the contract ever disagree.

**Please answer this first; it decides how we configure token validation.** The mobile backend is built and tested against our Dev environment; this answer sets its production audience and scope settings.

Will APIM validate the user's Entra token and **forward it to the backend unchanged**, with audience = the Origination API app registration and a scope we define (`Origination.Mobile.{Env}`)?

Why it matters: the Spec requires the business layer to *re-validate caller permissions before every data operation* and to *log all data mutations with caller identity* (§3.5). Both need the real user in the token that reaches us. If APIM swaps in a service identity, we lose the user and cannot meet §3.5. If APIM expects an APIM-owned audience, we need to know so we can accept a second audience.

**What we need configured (QA and Prod only; the Guide has Dev calling the App Service directly):**

| Item | What to do | Why (Spec reference) |
|---|---|---|
| Import | Import `openapi/mobile/specification.yaml` via APIOps under a path prefix you assign (we assumed `/external/origination/v1`; tell us the real one and we update the spec's `servers`) | §3.3 API versioning: versioned endpoints are mandatory; the Guide's request process step 4 |
| Backend URL | `https://app-origination-qa-eus.azurewebsites.net/api/mobile/v1` and `https://app-origination-eus.azurewebsites.net/api/mobile/v1`, including the `/api/mobile/v1` suffix so operation templates map 1:1 with no rewrite policy | §3.3 backend routing via private endpoint only; a 1:1 mapping lets our CI drift test prove the APIM allow-list equals the mobile surface |
| `validate-jwt` | Issuer: tenant `1521f999-f722-4a4f-9747-166f93e9b0d1`; audience: the Origination API app registration for that environment (QA `f3fcab2b-98c8-4622-86bd-c874d281b22a`, Prod `e1458bcd-7212-4ea0-a836-7e08d03b5bbf`); required scope `Origination.Mobile.QA` / `Origination.Mobile.Prod` | §3.3 mandatory policy "validate-jwt on every inbound request"; §3.2 per-client identity and scoped claims |
| `rate-limit-by-key` | Keyed on the token's `oid` claim; start at 120 calls/minute per user, we will tune | §3.3 mandatory policy; §3.2 rate limiting on the external surface |
| `quota-by-key` | Daily quota per user at your standard | §3.3 mandatory policy "daily/monthly call limits per consumer" |
| `set-header` | Pass through the client's `X-Correlation-Id` if present, otherwise inject one; forward it to the backend. Strip server and `X-Forwarded-*` headers from responses | §3.3 mandatory policy "inject correlation ID, strip server headers"; §7.1 every APIM call logged with correlation id |
| `ip-filter` | Not applicable: callers are originators' phones on carrier networks, so there is no known IP range. Please note the exception in the API's policy comments | §3.3 "where client IP ranges are known" |
| Subscription keys | **Question:** §3.3 requires a subscription key for every consumer, rotated quarterly. Our client is a public browser app and cannot hold a secret. Do you issue a non-secret product key for identification and analytics only, or do we document an exception with `validate-jwt` as the control? | §3.3 subscription keys; §4.2 token table |
| CORS | Allow the Static Web App origin for that environment (Infrastructure will confirm: `origination-qa.scoular.com` / `origination.scoular.com` via split-horizon DNS) | §3.3 "CORS policy enforced at the gateway level"; §3.2 restrictive CORS |
| Caching | No response caching on any operation; every response carries producer data | §8 data classification: producer contact data is Confidential/PII |
| Diagnostics | APIM logs into the same Log Analytics workspace as `appi-origination-*`, with the correlation id | §3.3 logging; §7.3 alerts on sustained rate limiting and error spikes |

The spec is a living document and will change once our remaining stakeholder decisions land (offline depth affects two write operations). We will notify you on each revision.

Thanks,
Caden

---

## 2. Infrastructure — requests E1, E2, E3 (and a documentation conflict)

**To:** _Infrastructure (Charles; Karl when back)_
**Subject:** Origination: enable the external SPA (mobile) per EXTERNAL-SPA-GUIDE / SEC-ARCH-BURDI-001

Hi Charles,

_(shared background)_

**Why you are involved.** The Spec requires the edge WAF (Layer 1), separate deployments for the external and internal components (Core Invariant 3), and private networking end to end (§5). Your Guide already models exactly that for Origination: START-HERE.md lists `swa-origination-{dev,qa}-eus` and `swa-origination-eus` as provision-if-enabled, and the Guide's request process starts when the app team commits `openapi/`. That is now done.

| # | What to do | Why (Spec / Guide reference) |
|---|---|---|
| 1 | **Enable `externalApp` for Origination** in app-config.json and create the three Static Web Apps: `swa-origination-dev-eus`, `swa-origination-qa-eus`, `swa-origination-eus`. Custom domains per the Guide: dev `ext-origination-dev.scoular.com`; QA and Prod share the App Service custom domains via split-horizon DNS | Spec Core Invariant 3 (external and internal components are separate deployments): the mobile app is a separate deployable, not a folder in the App Service. Guide "Architecture" and "Request Process" steps 2–3 |
| 2 | **WAF policy** on the Application Gateway for the APIM path prefix Data Integrations assigns (requested in parallel; we will forward the prefix) | Spec Layer 1 §3.1: OWASP Core Rule Set, TLS 1.2+, DDoS. Guide "Security Notes": WAF in front of APIM |
| 3 | **Dedicated SPA app registration per environment, `Origination External - {Env}`**: SPA platform, redirect URIs = the SWA custom domain plus `http://localhost:4200`, pre-authorised for the delegated scope `Origination.Mobile.{Env}` on the existing Origination API registration (Identity is creating the scope; request sent separately) | Spec §3.2 "JWT auth **per client** identity" and §3.5 blast-radius containment. Our backend rejects mobile-scoped tokens on desktop routes and desktop tokens on mobile routes by checking the client id; that only works if the two clients are different registrations |
| 4 | **Resolve a documentation conflict.** EXTERNAL-SPA-GUIDE.md v1.7 ("Building the External Angular SPA") says a dedicated `{App} External - {Env}` registration is used. APP-REGISTRATIONS.md ("External SPA (if external app enabled)") says the existing desktop SPA registration is reused and no separate registration is created. We need the dedicated model for the reason in row 3. Please confirm and correct APP-REGISTRATIONS.md | Same as row 3 |
| 5 | **Dev CORS:** add `https://ext-origination-dev.scoular.com` to the `AllowedOrigins` app setting on `app-origination-dev-eus` (dev only; QA and Prod go through APIM) | Spec §3.2 restrictive CORS, explicitly allowed origins only. Guide "CORS for Dev Environment" |
| 6 | **Deploy permission:** grant the existing GitHub Actions OIDC service principal Contributor on the three SWAs so the workflow can `swa deploy` | Spec §6: no secrets in CI/CD (OIDC, no deployment tokens). Guide "Deploying to Static Web App" |
| 7 | Confirm the **inbound path APIM → App Service private endpoint** is allowed in QA and Prod, and that the App Service's access restrictions do not need a change for APIM's subnet | Spec §5.2 allowed flows "APIM → BLL layer"; §3.3 backend routing via private endpoints only |
| 8 | Confirm the platform already satisfies the Spec's Layer 6 and IaC items for Origination so we can cite it in the review: `publicNetworkAccess: Disabled` on SQL, Entra-only SQL auth, TDE, Azure SQL auditing to Log Analytics, mandatory tags (§3.6, §9.1) | Spec §3.6, §9.1; Spec §12 architecture review needs evidence per checklist item |
| 9 | **Was removing EXTERNAL-SPA-GUIDE.md intentional?** The October infra docs sync deleted `developer-docs/EXTERNAL-SPA-GUIDE.md` from our repo, while `developer-docs/START-HERE.md` and `developer-docs/CLAUDE.md` still point to it. We kept a verbatim copy of v1.7 (linked above) because this whole request follows it. Is there a newer version or a replacement we should follow instead? | The Guide is the source for every row above |

Nothing here touches production traffic until our QA wiring phase; the App Service stays private throughout (Guide "Security Notes": *the App Service is never exposed to the internet*).

Thanks,
Caden

---

## 3. Identity / IT Security — requests E9 and E10, plus a pre-review heads-up

**To:** asksecurity@scoular.com; _Identity team_
**Subject:** Origination mobile: identity requests under SEC-ARCH-BURDI-001 §4, and ADR-001 for your early read

Hi,

_(shared background)_

**Why you are involved.** The Spec's §4 sets the token and identity rules for external clients, and §12 puts IT Security and the Solutions Architect on the architecture review. We are asking Identity for four configuration items now, and giving Security an early look at the one design decision and the four exceptions we will bring to review, so that a "no" reaches us before we build the wrong thing.

Users are Scoular originators only; no producers or external identities. The Spec's priority order puts Entra ID second for internal users (§4.1), which is what we use; the B2C option for external users does not apply.

**Identity requests**

| # | What to do | Why (Spec reference) |
|---|---|---|
| 1 | Create a delegated scope **`Origination.Mobile.{Env}`** on the existing Origination API app registrations (Dev `00078a10-3f3f-4d17-9350-fe90401125ae`, QA `f3fcab2b-98c8-4622-86bd-c874d281b22a`, Prod `e1458bcd-7212-4ea0-a836-7e08d03b5bbf`). Grant it only to the new `Origination External - {Env}` client registrations Infrastructure is creating; **not** to the desktop SPA registrations | §3.2 "Authorization: scoped claims, only the operations this client needs". The scope is how APIM and our backend tell a mobile token from a desktop token |
| 2 | Apply a **token lifetime policy of 15 minutes** for access tokens issued to the mobile client. If the policy can only attach to the API resource (which would also shorten desktop tokens), tell us and we will document a 60-minute exception with Continuous Access Evaluation as compensation | §4.2 token table: external API JWT 15 minutes max, refresh 24 h single-use rotated. Entra SPA refresh tokens already meet the refresh line |
| 3 | Enable **Continuous Access Evaluation** for the mobile client; our app opts in with the `CP1` client capability | Compensating control for §4.2 and §4.3 in a browser: near-real-time revocation on sign-out, password change or risk |
| 4 | A **Conditional Access policy for the mobile client that fits personal phones.** Originators use their own phones, which are not managed (no company phones, no Company Portal), so a "compliant device" rule cannot apply. We propose MFA plus a sign-in frequency you choose, and a short **pilot on iOS Safari and Android Chrome** with us before QA wiring. Tell us if you require something else | §4.3 device binding: the Spec wants tokens bound to a device; a website on a personal phone cannot do that, so strong sign-in and short sessions are the nearest achievable control |

**Security pre-review (for scheduling and an early read, not sign-off yet)**

ADR-001 (link above) records how we meet each Core Invariant and names four Spec items we cannot meet literally in a browser-based app. We propose to document them as exceptions per §1 ("exceptions require written approval from IT Security with a documented risk acceptance via ServiceNow"):

| Spec requirement we miss | What we do instead |
|---|---|
| Core Invariant 3, API tier: the mobile API shares the private App Service host with the desktop API | Mobile surface is its own assembly with its own authorization policy, own client registration and scope, and an APIM allow-list of 17 operations; nothing else in the API accepts a mobile token. Defined exit path to a separate host (ADR-001 Option 2) |
| Core Invariant 6 / §3.5: same managed identity for both tiers | As above; the mobile surface excludes ODS producer-master search, admin, reporting and bulk operations (§3.2 "what this layer must NOT contain"), and ODS is read-only regardless |
| §4.3 device-bound tokens, certificate pinning | MFA, sign-in frequency, Continuous Access Evaluation, client-id check on every request. The business has decided against an app-store app, so pinning is not available |
| §4.2 token storage in Keychain/Keystore: browser storage is not app-encrypted, and the phones are personal and unmanaged | Sign-in kept per browser tab (session storage); contact phone/email and search never cached; other producer reads cached at most 1 hour (notes 15 minutes) to ride out dropped signal; everything wiped on sign-out and on authentication failure. **If you prefer, we keep no producer data on the phone at all** (offline then covers only what is on screen) |

Two things we would value from you now:

1. An early answer on whether any of the four exceptions is a non-starter. A "no" on the first two moves us to a separate App Service and managed identity immediately; for the last two, tell us what you need instead (an app-store app has been ruled out by the business). Both are cheaper to decide now than after the Dev build.
2. A slot for the §12 architecture review (IT Security + Solutions Architect) roughly six to eight weeks out, once the Dev build exists, with ADR-001 and the §11 developer checklist as the artifacts.

For the record: the accepted-risk entries AR-01, AR-02 and AR-08 were closed by the application owner on 2026-09-21. The mobile surface narrows them for its subset (trade-unit entitlement becomes a hard 404 boundary; notes are add-and-view only), and we will update `SECURITY-REVIEWS/ACCEPTED-RISKS.md` to say so rather than reopen them.

Thanks,
Caden

---

## 4. Hope and Travis — the one product question left

Decided 2026-10-14 and not asked: phones are personal and unmanaged, and there will be no app-store app; storage visibility is derived from the data.

**To:** Hope, Travis (cc Marc)
**Subject:** Origination mobile – 1 quick question

Hi Hope, Travis,

The mobile cards gave us almost everything we need. One answer would settle the rest:

Offline: Is it enough that the app keeps working through a dropped signal during a visit, with notes sent once signal returns? Or do originators need to work for hours with no signal at all?

Thanks,
Caden

---

## After sending

- Record the send date and the named contact per team in [PLATFORM-REQUESTS.md](PLATFORM-REQUESTS.md) `Status` column.
- Data Integrations' answers on token pass-through and subscription keys close meeting Q6 and unblock the `MobileAccess` policy configuration.
- Infrastructure's answer on the app-registration model closes Q8.
- Identity's answers close Q7. Device posture (Q2) was answered 2026-10-14: personal, unmanaged phones, no app-store app.
