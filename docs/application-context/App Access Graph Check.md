# App Access via Entra Group (Graph) — spike + first consumers

**Status date:** 2026-07-20 · **Owner:** Origination engineering · **Branch:** `feature_AppAccessGraphCheck`

The app now knows **who can actually sign in** — the transitive members of the Entra access group
(`AppAccess:GroupName`, dev: `Origination App Dev Users`) — read via Microsoft Graph using the App
Service's **system-assigned managed identity** (the developer's own credential when running
locally). First consumers of that list:

| Surface | Behavior when the access set is readable | When it isn't (fail-open) |
| --- | --- | --- |
| **Usage Dashboard** (all endpoints) | "All users" = the access group (people with access but no entitlements — e.g. admin accounts — appear, with Entra display names); a trade-unit filter shows that unit's entitled users ∩ access | Exactly the pre-existing behavior: full entitlements snapshot |
| **Daily Digest → People picker** (`GET /api/entitlements/catalog`) | People sharing a TU with the caller ∩ access | Unfiltered people list, as before |
| **Diagnostic** `GET /api/diagnostics/app-access-group-members` (AdminOnly, all envs) | Full member list | The categorized reason (see table below) |

Not yet filtered: the Logic Apps' **send-time** expansion of trade-unit/group recipients (they read
the raw Entitlements tables directly). Future phase — likely a synced SQL table of the access set.

## How it works

- `GraphDirectoryClient` (`api/GrainOriginatorPortal.Application/Services/`) — minimal Graph reader, no SDK:
  resolve group by display name, page `transitiveMembers/microsoft.graph.user`. Token from
  `ManagedIdentityCredential` on App Service / `DefaultAzureCredential` locally (the Key Vault
  bootstrap split in Program.cs), cached until ~5 min before expiry. Named HttpClient `"graph"`
  (nominatim resilience shape; 4xx never retried).
- `AppAccessService` — cached access set keyed by **short user name** (UPN before `@`, the
  Entitlements `UserId` format). Success cached `AppAccess:CacheMinutes` (default 30), failure
  cached 5 min, single-flight, 8-second fetch timebox so blocked egress can't hang a page.
  Disabled accounts are excluded from the access set.
- **Fail-open is deliberate**: until the IT grants below land, deployed environments cannot read
  Graph — every consumer must behave exactly as before. QA/Prod also override `AppAccess:GroupName`
  to empty (NotConfigured) so they can never accidentally filter by the DEV group via config layering.

## Verifying on deployed Dev (the managed-identity test)

1. Deploy the branch (Actions → "Originations Deploy to DEV" → run on `feature_AppAccessGraphCheck` — dev deploys are manual and branch-selectable).
2. As an admin, call `GET /api/diagnostics/app-access-group-members` on the dev site.
3. Read the `outcome`:

| Outcome | Meaning | Remediation |
| --- | --- | --- |
| `EgressBlocked` | NSG blocks `graph.microsoft.com` (did NOT occur on dev — egress verified open 2026-07-20) | NSG outbound rule |
| `PermissionMissing` (401/403) | Egress OK; managed identity lacks the group read | The scoped group grant |
| `MembersIdOnly` | Group read works but members have no UPNs/names | Grant `User.ReadBasic.All` too |
| `TokenFailure` | Managed identity itself couldn't get a token | Check the App Service identity |
| `NotFound` | Group name doesn't resolve | Fix `AppAccess:GroupName` |
| `NotConfigured` | No group configured for this environment | Intentional for QA/Prod today |
| `Ok` + member list | Fully working | Dashboard/digest filtering activates within ~5 min |

Observed on dev 2026-07-20: `PermissionMissing` straight away (egress already open). Remaining
progression: (scoped group grant) → `MembersIdOnly` → (`User.ReadBasic.All`) → `Ok`. The two
grants can land together, jumping straight to `Ok`.

## IT request (coordinated with IT Infrastructure, like the Logic Apps' Mail.Send grant)

**Network egress: already open — no request needed.** Verified 2026-07-20 on deployed Dev: the
managed identity's call reached Graph and got an HTTP 403 back, proving both token acquisition and
the network path to `graph.microsoft.com` work today (no NSG change required, despite the
docs' deny-by-default description).

**The grant model (per Karl, 2026-07-20): scoped group read + `User.ReadBasic.All`.** The managed
identity is NOT given tenant-wide group read — it can only read the specific access group(s). Two
consequences the code is built around:

1. **No group listing/search.** `GET /groups?$filter=...` is denied; only the direct
   `GET /groups/{id}` object read works. The group **object id** is therefore configured
   (`AppAccess:GroupId`), and the name-search path exists purely as a local-dev convenience.
2. **Member reads come back id-only without a user-read permission.** With just the scoped group
   read, `transitiveMembers` returns members with only their object ids — no
   `userPrincipalName`/`displayName`. The app matches people to Entitlements **by UPN**, so
   id-only data is unusable; per Karl there's no good workaround other than also granting
   **`User.ReadBasic.All`** (application) to the identity. Until that lands, the diagnostic
   reports `MembersIdOnly` and all filtering stays off (fail-open) — an id-only member list must
   never be treated as an empty access set, or the dashboards would hide everyone.

So the remaining asks for dev are: the scoped read of group `0e4dd29c-b23c-4e11-a2a3-13e1be934c2b`
("Origination App Dev Users") for `app-origination-dev-eus`'s managed identity, plus
**`User.ReadBasic.All`** on the same identity. `User.ReadBasic.All` exposes only basic profile
fields (display name, UPN, mail); membership data is cached in-process for 30 minutes and never
persisted or logged (counts only).

## Config reference

| Key | Where | Meaning |
| --- | --- | --- |
| `AppAccess:GroupId` | base `appsettings.json` (= local + deployed Dev); overridden empty in QA/Prod | Access group **object id** — the direct read the scoped identity is allowed; empty (with no name) disables (NotConfigured → fail open) |
| `AppAccess:GroupName` | base; overridden empty in QA/Prod | Display label; name-search fallback when GroupId empty (works locally only) |
| `AppAccess:CacheMinutes` | base (30) | Success-cache TTL; failures retry after ~5 min |

## Verification log

| Date | Env | Outcome | Notes |
| --- | --- | --- | --- |
| 2026-07-20 | Local (developer credential) | `Ok` — 12 members | Group id `0e4dd29c-b23c-4e11-a2a3-13e1be934c2b` |
| 2026-07-20 | Dev (managed identity) | `PermissionMissing` (403) | **Egress to Graph confirmed open + MI token works** — grants remain |
| 2026-07-20 | — (Karl guidance) | — | Grant will be **scoped to the specific group(s)** (no listing/search) and members come back id-only without **`User.ReadBasic.All`** → code switched to direct-by-id read (`AppAccess:GroupId`) + id-only fail-open guard + `MembersIdOnly` outcome |
| _(pending)_ | Dev (managed identity, after grants) | | Re-run — expect `Ok`, 12 members; filtering activates within ~5 min |
