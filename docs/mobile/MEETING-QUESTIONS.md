# Mobile Component — Stakeholder Meeting Questions

**Purpose:** collect the parameters that select between branches of the [architecture plan](MOBILE-ARCHITECTURE-PLAN.md). Each question lists which plan decision its answer drives. Record answers in the right-hand column and in ADR-001.

**Date:** _____ · **Attendees:** _____

| # | Question | Why it matters / what each answer selects | Answer |
|---|---|---|---|
| 1 | **Who uses the mobile component in v1?** Scoular originators only, or producers/customers too? | Originators → employee identity, Entra Conditional Access, PWA-first (plan §5.2). Producers → separate later programme: Entra External ID, mandatory device binding, Capacitor native wrapper. | |
| 2 | **What phones will originators use?** Intune-enrolled company devices, personal devices with Intune app protection (MAM), or unmanaged personal devices? | Conditional Access "require compliant device" only works on enrolled devices. Unmanaged BYOD pushes toward a native wrapper or a Security exception. | |
| 3 | **How much offline do we need?** Hours in the field with no signal, or just surviving a dropped connection mid-session? | Hours offline → needs a `LocalStorage` token-cache exception from Security and a full sync queue. Mid-session → the v1 default with `SessionStorage` (plan §5.4). | |
| 4 | **Which operations, exactly, are in v1?** Candidate list to approve or trim: my customers (trade-unit scoped), customer detail, recent notes, create a note (offline-queued), reminders, bid *view* (trade-unit scoped), commodity and trade-unit reference data. Proposed **out**: ODS producer-master search and onboarding, bid-sheet editing, dashboards, Build-A-List editing, admin. | Sets the size of `openapi/specification.yaml`, which accepted risks are exposed, and whether any ODS-backed reads (60-second cold start risk) are in scope. Target ≤ ~12 operations. | |
| 5 | **Does IT Security accept the four documented exceptions** — shared API host, shared managed identity, no device binding in a PWA, unencrypted browser storage with device-encryption compensation? | A "no" on host/identity forces the separate Mobile App Service now (Option 2). A "no" on device binding or storage forces Capacitor now. | |
| 6 | **Data Integrations: will APIM pass the user's token through** (audience = Origination API app registration, scope `Origination.Mobile.{Env}`) or require an APIM-owned audience / token exchange? | Pass-through is required for object-level authorization. Anything else changes `ValidAudiences` configuration or is rejected. | |
| 7 | **Identity: will a 15-minute access-token lifetime policy be applied to the mobile client?** Is the side effect on desktop tokens acceptable if it lands on the shared API resource? | Spec asks for 15 minutes. If refused, we document a 60-minute exception with Continuous Access Evaluation as compensation. | |
| 8 | **Which app registration model stands?** Dedicated `Origination External - {Env}` (EXTERNAL-SPA-GUIDE) or reuse of the desktop SPA registration (APP-REGISTRATIONS.md)? | Client-id isolation between desktop and mobile tokens depends on a dedicated registration. Infrastructure also needs to fix whichever document is wrong. | |
| 9 | **May producer contact phone numbers or email appear on the phone at all** (for example click-to-call)? | Decides whether mobile DTOs carry PII, what the storage exception must say, and whether contacts are ever cached. | |
| 10 | **Is author-only note edit/delete on mobile acceptable**, even though desktop keeps collaborative editing (AR-01)? | Narrows AR-01 for the mobile subset. If not acceptable, mobile edit/delete is dropped from v1 rather than shipped without ownership checks. | |
| 11 | **Target date, and can the business-logic extraction refactor be scheduled ahead of feature work?** | The extraction is a mechanical move with no behaviour change but touches the whole API project. It is the precondition for Option 3; without it we fall back to Option 1. | |
| 12 | **Who owns `openapi/specification.yaml` after v1?** | Recommended: app team as source of truth, enforced by the drift test in CI; Data Integrations imports from it. | |

## Decisions to walk out with

- v1 user population and device posture (Q1, Q2)
- v1 operation list, frozen enough to write the OpenAPI spec (Q4, Q9, Q10)
- Offline scope (Q3)
- Security's stance on the four exceptions (Q5)
- Named contacts at Data Integrations and Identity for Q6 and Q7, with dates
