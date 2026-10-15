# Mobile Component — Phase 1 Request Messages

Ready-to-send drafts for the teams on the critical path. Sent by the Origination app team (Caden), not automatically. Fill the `To:` lines and send in the same week; the personal-phone question and the APIM operations are the longest lead items.

Every message can point to the same documents so each team can see which requirement drives each ask:

| Short name used below | Document |
|---|---|
| **the Spec** | `SEC-ARCH-BURDI-001` v1.0, *Security Architecture Specification: Burdi Design Pattern* (IT Security / Architecture, 2026-03-25). Repo copy: [reference/SEC-ARCH-BURDI-001-mobile-security-architecture.md](reference/SEC-ARCH-BURDI-001-mobile-security-architecture.md). Section numbers below (§3.3, §4.2, etc.) refer to it |
| **the Guide** | [EXTERNAL-SPA-GUIDE.md](reference/EXTERNAL-SPA-GUIDE.md) v1.7 (repo copy), Infrastructure's implementation of the Spec for Scoular: Static Web App → APIM (App Gateway + WAF in front) → private App Service. Grain Vision's external app is built on it |

Links assume the branch `feature_MobileForMain` (the one mobile branch since 2026-10-15); update them once merged to `main`.

- OpenAPI contract: https://scoular.ghe.com/IT/origination/blob/feature_MobileForMain/openapi/mobile/specification.yaml
- Workflow/offline summary: https://scoular.ghe.com/IT/origination/blob/feature_MobileForMain/openapi/mobile/README.md
- ADR-001 (topology decision + exceptions): https://scoular.ghe.com/IT/origination/blob/feature_MobileForMain/docs/adr/ADR-001-mobile-surface-topology.md
- Spec (repo copy): https://scoular.ghe.com/IT/origination/blob/feature_MobileForMain/docs/mobile/reference/SEC-ARCH-BURDI-001-mobile-security-architecture.md
- Guide: https://scoular.ghe.com/IT/origination/blob/feature_MobileForMain/docs/mobile/reference/EXTERNAL-SPA-GUIDE.md

> **Decided 2026-10-15: follow Grain Vision's external app** (replaces the 2026-10-14 Burdi decision). Own Static Web App (Dev `ext-origination-dev.scoular.com`; QA/Prod on the desktop's address via split-horizon DNS), API through APIM at `/external/origination/v1` in Dev, QA and Prod, App Service fully private, sign-in shared with the desktop. The only thing Grain Vision does not cover is **personal, unmanaged phones**; it is asked first in messages 1 and 3. Request numbers refer to [PLATFORM-REQUESTS.md](PLATFORM-REQUESTS.md).

---

## 1. Infrastructure — the Grain Vision setup for Origination (E1, E3, E5, D1)

**To:** _Infrastructure (Charles)_
**Subject:** Origination mobile – same external-app setup as Grain Vision

Hi Charles,

We've built a mobile version of the Origination Workbench so originators can look up producers, add notes and update farm details from their phones in the field. It's a website, not an app-store app, and we'd like it set up exactly like Grain Vision's external app.

What we need:
1. **The external app setup, like Grain Vision's:** a Static Web App per environment (swa-origination-dev-eus, swa-origination-qa-eus, swa-origination-eus), with Dev at ext-origination-dev.scoular.com and QA/Prod on origination-qa.scoular.com / origination.scoular.com through split-horizon DNS, plus the App Gateway/WAF path to APIM. The App Service stays private.
2. **One sign-in redirect address:** add https://ext-origination-dev.scoular.com to our existing "Origination - Dev" registration (e0f25943-ae8b-4c2d-8060-c9ffbd448aff). QA and Prod reuse their existing addresses, as Grain Vision's do.
3. **Deploy access:** our GitHub Actions service principal allowed to deploy to the three Static Web Apps (same as Grain Vision's deploy-external workflow).

One question before anything else: **originators use their own personal phones, which aren't company-managed.** The External SPA guide limits external access to company-managed devices. Can Origination allow personal phones (for example MFA plus a sign-in frequency), and is that your call or Security's?

Our API contract is ready for Data Integrations (openapi/mobile/specification.yaml in our repo). Is there a request process you'd like us to use?

Thanks,
Caden

---

## 2. Data Integrations — APIM operations (E7, E8)

**To:** _Data Integrations_
**Subject:** Origination mobile – APIM operations, same as Grain Vision's external API

Hi,

Origination is adding a mobile app built the same way as Grain Vision's external app. We need APIM operations for it in Dev, QA and Prod:

- **Contract:** openapi/mobile/specification.yaml in IT/origination (17 operations; README alongside).
- **Path prefix:** /external/origination/v1 if that works for you (Grain Vision uses /external/grainvision/v1).
- **Backend:** https://app-origination{-dev,-qa,}-eus.azurewebsites.net/api/mobile/v1 — paths map 1:1, no rewrite.
- **Policies:** validate-jwt (audience = our API registration, scope Origination.Application.{Env}), CORS for our Static Web App origins, rate limit per user (oid), correlation id passed through.
- **Token:** please pass the user's token through unchanged; our API re-checks it.

Thanks,
Caden

---

## 3. Identity / IT Security — personal phones (E10), plus a pre-review heads-up

**To:** asksecurity@scoular.com; _Identity team_
**Subject:** Origination mobile: personal phones, sign-in policy, and ADR-001 for your early read

Hi,

We're building Origination's mobile app on the same pattern as Grain Vision's external app (Static Web App → APIM → private App Service, desktop sign-in). Users are Scoular originators only; no producers or external identities.

**The main question.** Originators use their **own phones, which are not company-managed** (no company phones, no Company Portal), and the business has ruled out an app-store app. The External SPA guide restricts external access to company-managed devices. Can Origination's external app allow personal phones, and with what controls? We propose:

| # | What | Why (Spec reference) |
|---|---|---|
| 1 | A **Conditional Access policy for Origination sign-ins from iPhone and Android**: MFA plus a sign-in frequency you choose, and a short **pilot on iOS Safari and Android Chrome** with us before QA | §4.3 device binding: a website on a personal phone cannot bind tokens to the device, so strong sign-in and short sessions are the nearest achievable control |
| 2 | **Continuous Access Evaluation** for Origination; our app opts in with the `CP1` client capability | Near-real-time revocation on sign-out, password change or risk |
| 3 | **Token lifetime:** the phone signs in with the same Origination registration as the desktop (as Grain Vision's external app does), so a 15-minute policy would also shorten desktop tokens. We propose a documented 60-minute exception with CAE as compensation; tell us if you'd rather apply 15 minutes to both | §4.2 token table |

**Security pre-review (for scheduling and an early read, not sign-off yet)**

ADR-001 (link above) records how we meet each Core Invariant. Following Grain Vision closes the internet-exposure question: all external traffic goes through APIM and the App Service stays private. These items remain, and we propose to document them as exceptions per §1:

| Spec requirement we miss | What we do instead |
|---|---|
| Core Invariant 3, API tier: the mobile API shares the private App Service host with the desktop API | Mobile surface is its own assembly with its own routes and authorization policy (only tokens issued to the Origination registration, trade-unit entitlement as a hard boundary), reachable from outside only through the APIM operations in the contract (17). Defined exit path to a separate host (ADR-001 Option 2) |
| Core Invariant 6 / §3.5: same managed identity for both tiers | As above; the mobile surface excludes ODS producer-master search, admin, reporting and bulk operations, and ODS is read-only regardless |
| §4.3 device-bound tokens, certificate pinning, compliant devices | Personal phones: MFA, sign-in frequency, Continuous Access Evaluation, client-id check on every request. No app-store app, so pinning is not available |
| §4.2 token storage in Keychain/Keystore: browser storage is not app-encrypted | Sign-in kept per browser tab (session storage); contact phone/email and search never cached; other producer reads cached at most 1 hour (notes 15 minutes) to ride out dropped signal; changes made without signal (notes, farm details, contacts, planting) wait on the phone until they are sent; everything wiped on sign-out and on authentication failure. **If you prefer, we keep no producer data on the phone at all** |

Two things we would value from you now:

1. The answer on personal phones, and whether any exception above is a non-starter. Both are cheaper to decide now than after the Dev build.
2. A slot for the §12 architecture review (IT Security + Solutions Architect) once the Dev build is running, with ADR-001 and the §11 developer checklist as the artifacts.

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

Offline: Changes made without signal (notes, farm details, planting) are already kept on the phone and sent once signal returns. Is it enough that producers already opened stay viewable through a dropped signal during a visit? Or do originators need to open producers they haven't looked at yet, for hours with no signal at all?

Thanks,
Caden

---

## After sending

- Record the send date and the named contact per team in [PLATFORM-REQUESTS.md](PLATFORM-REQUESTS.md) `Status` column.
- Infrastructure's and Security's answers on personal phones (D1) decide whether the pilot can start; everything else proceeds in parallel.
- Data Integrations' answers (prefix, pass-through) close meeting Q6; if the prefix differs from `/external/origination/v1`, change the three mobile environment files and `ngsw-config.json`.
- Q8 (app-registration model) decided 2026-10-15: shared with the desktop, as in Grain Vision.
- Identity's answers close Q7. Device posture (Q2) was answered 2026-10-14: personal, unmanaged phones, no app-store app.
