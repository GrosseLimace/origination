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

> **Decided 2026-10-14: Burdi's hosting pattern.** The mobile app is served by the existing Origination App Service at `/mobile` (like Burdi's `/driver`), and Origination becomes "hybrid internet-accessible" like Burdi: from the internet, FortiGate and the Application Gateway WAF let through only `/mobile/*` and `/api/mobile/v1/*`. **No Static Web App, no APIM, no Data Integrations work.** Sign-in stays separate from the desktop (own app registration and `Origination.Mobile.{Env}` scope), so the server refuses phone sign-ins outside the mobile API even if the WAF list changes; sharing the desktop sign-in like Burdi was considered and deferred until Security confirms it. Sections below that describe a Static Web App or APIM are superseded by this note.

## 1. Data Integrations — not needed

There is no APIM in Burdi's hosting pattern, so nothing is asked of Data Integrations.

---

## 2. Infrastructure — Burdi-style access, plus a separate mobile sign-in

**To:** _Infrastructure (Charles)_
**Subject:** Origination mobile – can we follow the Burdi setup?

Hi Charles,

We're planning a mobile version of the Origination Workbench so originators can look up producers and add notes from their own phones in the field. It's a website, not an app-store app.

We'd like to follow the same setup as Burdi's driver app: the mobile app served from our existing App Service at /mobile, with Origination made "hybrid internet-accessible" like Burdi. Only the mobile paths would be reachable from outside:
- /mobile/*
- /api/mobile/v1/*

Everything else would stay internal, as it is today.

We also need:
- A separate sign-in registration for the mobile app, with its own permission (scope) on our API, so the server can keep phone sign-ins limited to the mobile paths even if the firewall list ever changes. Redirect URI https://origination-{env}.scoular.com/mobile, the same subpath pattern Burdi uses for /driver.

A few questions:
1. Is that the right ask, and is there a request process you'd like us to use?
2. Burdi's notes say external access is QA and Prod only. Is there a way to test from a phone in Dev, or do we start in QA?
3. Anything Burdi learned that we should do differently?

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
| Core Invariant 3, API tier: the mobile API shares the private App Service host with the desktop API | Mobile surface is its own assembly with its own authorization policy, own client registration and scope, and a WAF allow-list that exposes only the mobile paths (17 operations), as for Burdi; nothing else in the API accepts a mobile token. Defined exit path to a separate host (ADR-001 Option 2) |
| Core Invariant 6 / §3.5: same managed identity for both tiers | As above; the mobile surface excludes ODS producer-master search, admin, reporting and bulk operations (§3.2 "what this layer must NOT contain"), and ODS is read-only regardless |
| §4.3 device-bound tokens, certificate pinning | MFA, sign-in frequency, Continuous Access Evaluation, client-id check on every request. The business has decided against an app-store app, so pinning is not available |
| §4.2 token storage in Keychain/Keystore: browser storage is not app-encrypted, and the phones are personal and unmanaged | Sign-in kept per browser tab (session storage); contact phone/email and search never cached; other producer reads cached at most 1 hour (notes 15 minutes) to ride out dropped signal; changes made without signal (notes, farm details, contacts, planting) wait on the phone until they are sent, as in Burdi's driver app; everything wiped on sign-out and on authentication failure. **If you prefer, we keep no producer data on the phone at all** (offline then covers only what is on screen) |

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

Offline: Changes made without signal (notes, farm details, planting) are already kept on the phone and sent once signal returns, like Burdi's driver app. Is it enough that producers already opened stay viewable through a dropped signal during a visit? Or do originators need to open producers they haven't looked at yet, for hours with no signal at all?

Thanks,
Caden

---

## After sending

- Record the send date and the named contact per team in [PLATFORM-REQUESTS.md](PLATFORM-REQUESTS.md) `Status` column.
- Data Integrations' answers on token pass-through and subscription keys close meeting Q6 and unblock the `MobileAccess` policy configuration.
- Infrastructure's answer on the app-registration model closes Q8.
- Identity's answers close Q7. Device posture (Q2) was answered 2026-10-14: personal, unmanaged phones, no app-store app.
