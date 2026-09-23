# Mobile Component — Phase 1 Request Messages

Ready-to-send drafts for the three teams on the critical path. Sent by the Origination app team (Caden), not automatically. Fill the `To:` lines, then send all three in the same week; the APIM token question and the Conditional Access pilot are the longest lead items in the whole plan.

Links assume the branch `docs_MobileArchitecturePlan`; update them once merged to `main`.

- Spec: https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/openapi/specification.yaml
- Workflow/offline summary: https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/openapi/README.md
- Architecture plan: https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/docs/mobile/MOBILE-ARCHITECTURE-PLAN.md
- ADR-001: https://scoular.ghe.com/IT/origination/blob/docs_MobileArchitecturePlan/docs/adr/ADR-001-mobile-surface-topology.md

---

## 1. Data Integrations (APIM) — requests E7 and E8

**To:** _Data Integrations / APIM owners_
**Subject:** Origination mobile: APIM operations + one token-handling question that blocks our design

Hi team,

We are adding a mobile component to the Origination Workbench following the External SPA guide (Static Web App → APIM → private App Service). Per the guide we have produced the OpenAPI contract for the external surface:

- `openapi/specification.yaml` (16 operations, OpenAPI 3.0.3, Redocly-valid): link above
- `openapi/README.md` (workflow and offline summary): link above

**One question that blocks our backend design — could you answer this first, even before the import?**

Will APIM validate the user's Entra token and **pass it through to the backend unchanged**, with the audience being the Origination API app registration and a scope we define (`Origination.Mobile.{Env}`)? Our backend authorises per user (trade-unit entitlement, per-record checks, audit trail with the user's identity), so we need the user's token to arrive intact. If APIM instead expects an APIM-owned audience, or exchanges the token for a service identity, please tell us so we can adapt before we build.

**What we would like configured (QA and Prod only; Dev calls the App Service directly per the guide):**

| Item | Request |
|---|---|
| Import | `openapi/specification.yaml` via APIOps, under a path prefix of your choosing (we assumed `/external/origination/v1`; tell us the real one and we will update the spec's `servers`) |
| Backend URL | `https://app-origination-qa-eus.azurewebsites.net/api/mobile/v1` and `https://app-origination-eus.azurewebsites.net/api/mobile/v1` — including the `/api/mobile/v1` suffix so operation templates map 1:1 with no rewrite policy |
| `validate-jwt` | Issuer: our tenant `1521f999-f722-4a4f-9747-166f93e9b0d1`; audience: the Origination API app registration for that environment (QA `f3fcab2b-98c8-4622-86bd-c874d281b22a`, Prod `e1458bcd-7212-4ea0-a836-7e08d03b5bbf`); required scope `Origination.Mobile.QA` / `Origination.Mobile.Prod` |
| `rate-limit-by-key` | Keyed on the token's `oid` claim; a starting point of 120 calls/minute per user is fine, we will tune |
| `quota-by-key` | Daily quota per user at your standard |
| Correlation | Pass through the client's `X-Correlation-Id` if present, otherwise inject one; forward it to the backend |
| Outbound | Strip server and `X-Forwarded-*` headers from responses |
| CORS | Allow the Static Web App origin for that environment (Infrastructure will confirm the domain: `origination-qa.scoular.com` / `origination.scoular.com` via split-horizon DNS) |
| Caching | No response caching on any operation; every response carries producer data |
| Diagnostics | APIM logs to the same Log Analytics workspace as `appi-origination-*`, with the correlation id |

The spec is a living document and will change after our stakeholder decisions land (offline depth mainly affects two write operations). We will notify you on each revision.

Thanks,
Caden

---

## 2. Infrastructure — requests E1, E2, E3 (and a documentation conflict)

**To:** _Infrastructure (Charles; Karl when back)_
**Subject:** Origination: enable the external SPA (mobile) per EXTERNAL-SPA-GUIDE

Hi Charles,

We are following `developer-docs/EXTERNAL-SPA-GUIDE.md` to add a mobile web app to Origination. The OpenAPI contract is committed at the link above, which per the guide is the trigger for the infrastructure side. Requests:

1. **Enable `externalApp` for Origination** in app-config.json and create the three Static Web Apps that START-HERE.md already lists as provision-if-enabled: `swa-origination-dev-eus`, `swa-origination-qa-eus`, `swa-origination-eus`. Custom domains per the guide: dev `ext-origination-dev.scoular.com`; QA and Prod share the App Service custom domains via split-horizon DNS.
2. **WAF policy** on the Application Gateway for the APIM path prefix Data Integrations assigns (we have asked them in parallel and will forward the prefix).
3. **A dedicated SPA app registration per environment, `Origination External - {Env}`**: SPA platform, redirect URIs = the SWA custom domain plus `http://localhost:4200`, pre-authorised for the delegated scope `Origination.Mobile.{Env}` on the existing Origination API app registration (Identity is creating the scope; request sent separately).
4. **Documentation conflict, please resolve:** EXTERNAL-SPA-GUIDE.md (v1.7, "Building the External Angular SPA") says a dedicated `{App} External - {Env}` registration is used. APP-REGISTRATIONS.md ("External SPA (if external app enabled)") says the existing desktop SPA registration is reused and no separate registration is created. We need the dedicated one: our backend rejects mobile-scoped tokens on desktop routes and vice versa by checking the client id, which only works if the two clients differ. Could you confirm the dedicated model and correct APP-REGISTRATIONS.md?
5. **Dev CORS:** add `https://ext-origination-dev.scoular.com` to the `AllowedOrigins` app setting on `app-origination-dev-eus` (dev only; QA and Prod go through APIM).
6. **Deploy permission:** the existing GitHub Actions OIDC service principal needs Contributor on the three SWAs so we can `swa deploy` from the workflow, per the guide.
7. Please confirm the **inbound path APIM → App Service private endpoint** is allowed in QA and Prod.

Nothing here touches production traffic until the QA wiring phase; the App Service stays private throughout.

Thanks,
Caden

---

## 3. Identity / IT Security — requests E9 and E10, plus a pre-review heads-up

**To:** asksecurity@scoular.com; _Identity team_
**Subject:** Origination mobile component: scope + Conditional Access requests, and an architecture decision for your review

Hi,

Origination is adding a mobile component for originators (Scoular employees only; no producers or external identities). It follows SEC-ARCH-BURDI-001 as implemented by the infrastructure team's External SPA guide: a separate Angular app on a Static Web App, all traffic through APIM behind the Application Gateway WAF, the App Service staying private, and a dedicated mobile surface in the API with scope, client-id and trade-unit checks on every operation.

**Identity requests**

1. Create a delegated scope **`Origination.Mobile.{Env}`** on the existing Origination API app registrations (Dev `00078a10-3f3f-4d17-9350-fe90401125ae`, QA `f3fcab2b-98c8-4622-86bd-c874d281b22a`, Prod `e1458bcd-7212-4ea0-a836-7e08d03b5bbf`). Grant it only to the new `Origination External - {Env}` client registrations that Infrastructure is creating; do **not** grant it to the desktop SPA registrations.
2. Apply a **token lifetime policy of 15 minutes** for access tokens issued to the mobile client, per the spec's token table. If the policy can only attach to the API resource (which would also shorten desktop tokens), tell us and we will document a 60-minute exception with Continuous Access Evaluation as compensation.
3. Enable **Continuous Access Evaluation** for the mobile client; our app opts in with the `CP1` client capability.
4. A **Conditional Access policy requiring a compliant device** targeting the mobile client registrations, and a short **pilot on iOS Safari and Android Chrome** with us before QA wiring. On iOS, device-compliance signals only reach Safari through the Authenticator SSO extension, so we want to confirm the real behaviour early.

**Security pre-review (for scheduling, not sign-off yet)**

ADR-001 (link above) records how we meet the spec's invariants and names four items we cannot meet literally in a browser-based app and propose to document as exceptions with compensations:

| Exception | Compensation |
|---|---|
| Mobile API shares the private App Service host with the desktop API | Separate assembly, separate client registration and scope, APIM allow-list of 16 operations; defined exit path to a separate host |
| Same managed identity for both tiers | Same as above; mobile surface excludes ODS producer-master search, admin and bulk operations |
| No device-bound tokens or certificate pinning (PWA) | Conditional Access compliant device, Continuous Access Evaluation, client-id check on every request |
| Browser storage is not app-encrypted | Intune device encryption via Conditional Access; contact PII is never cached; short cache lifetimes; wipe on sign-out |

We would like to book the architecture review (IT Security + Solutions Architect) for after our Dev build exists, roughly six to eight weeks out, and would value an early read on whether any of the four exceptions is a non-starter, since a "no" on the first two moves us to a separate App Service now, and a "no" on the last two moves us to a native wrapper.

The accepted-risk records AR-01, AR-02 and AR-08 were closed by the application owner on 2026-09-21; the mobile surface narrows them for its subset (trade-unit entitlement becomes a hard boundary; notes are add-and-view only) and we will update `SECURITY-REVIEWS/ACCEPTED-RISKS.md` accordingly rather than reopen them.

Thanks,
Caden

---

## After sending

- Record the send date and the named contact per team in [PLATFORM-REQUESTS.md](PLATFORM-REQUESTS.md) `Status` column.
- Data Integrations' answer to the pass-through question closes meeting Q6 and unblocks the `MobileAccess` policy configuration.
- Infrastructure's answer on the app-registration model closes Q8.
- Identity's answers close Q7 and inform Q2 (device posture) — pair them with the Hope/Travis questions in step 3.
