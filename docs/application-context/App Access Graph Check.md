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

- `GraphDirectoryClient` (`api/GrainOriginatorPortal.Api/Services/`) — minimal Graph reader, no SDK:
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
| `EgressBlocked` | NSG blocks `graph.microsoft.com` (expected first result) | **Grant 1** below |
| `PermissionMissing` (401/403) | Egress OK; managed identity lacks the Graph app role | **Grant 2** below |
| `TokenFailure` | Managed identity itself couldn't get a token | Check the App Service identity |
| `NotFound` | Group name doesn't resolve | Fix `AppAccess:GroupName` |
| `NotConfigured` | No group configured for this environment | Intentional for QA/Prod today |
| `Ok` + member list | Fully working | Dashboard/digest filtering activates within ~5 min |

Expected progression on dev: `EgressBlocked` → (Grant 1) → `PermissionMissing` → (Grant 2) → `Ok`.

## IT request (coordinated with IT Infrastructure, like the Logic Apps' Mail.Send grant)

**Grant 1 — outbound network rule.** Add to `networking.customOutboundRules` in the infra
template's `app-config.json` (out of this repo): allow **`graph.microsoft.com`, TCP 443** from the
Origination App Service. Note `login.microsoftonline.com` (Entra ID service tag) is already allowed —
only the Graph data plane is new. Rules apply to all environments per the infra template.

**Grant 2 — Graph application role on the managed identity.** Assign **`GroupMember.Read.All`**
(Microsoft Graph application permission) to the App Service's system-assigned managed identity —
dev first (`app-origination-dev-eus`), then `app-origination-qa-eus` / `app-origination-eus` when
those environments get an access group. Example (Graph PowerShell, admin consent implied by the
app-role assignment):

```powershell
$graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
$mi      = Get-MgServicePrincipal -Filter "displayName eq 'app-origination-dev-eus'"
$role    = $graphSp.AppRoles | Where-Object { $_.Value -eq 'GroupMember.Read.All' -and $_.AllowedMemberTypes -contains 'Application' }
New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $mi.Id -PrincipalId $mi.Id -ResourceId $graphSp.Id -AppRoleId $role.Id
```

Scope note for the security review: `GroupMember.Read.All` is tenant-wide (Graph app permissions
aren't scoped per group) — the app only *uses* it to read the configured access group; membership
data is cached in-process for 30 minutes and never persisted or logged (counts only).

## Config reference

| Key | Where | Meaning |
| --- | --- | --- |
| `AppAccess:GroupName` | base `appsettings.json` (= local + deployed Dev); overridden empty in QA/Prod | Access group display name; empty disables (NotConfigured → fail open) |
| `AppAccess:CacheMinutes` | base (30) | Success-cache TTL; failures retry after ~5 min |

## Verification log

| Date | Env | Outcome | Notes |
| --- | --- | --- | --- |
| 2026-07-20 | Local (developer credential) | `Ok` — 12 members | Group id `0e4dd29c-b23c-4e11-a2a3-13e1be934c2b` |
| _(pending)_ | Dev (managed identity) | | Deploy branch, run the diagnostic, record here |
