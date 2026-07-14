# Custom Entra Role: "App Group Membership Reader"

**Team:** Origination (Karl Hague)
**Implemented:** 2026-07-14
**What this is:** One custom Entra ID role definition and nine scoped role assignments, granting
the Origination App Service managed identities read-only access to the membership of their own
access groups.

---

## Table of Contents

- [Current Status](#current-status)
- [Why This Exists](#why-this-exists)
- [What the Role Grants — and Does Not](#what-the-role-grants--and-does-not)
- [Why a Generic Name](#why-a-generic-name)
- [Role Definition](#role-definition)
- [Assignments](#assignments)
- [Codified Tooling](#codified-tooling)
- [Acceptance Check](#acceptance-check)
- [Ownership and Governance](#ownership-and-governance)
- [Backout](#backout)
- [References](#references)

---

## Current Status

| Item | Status |
|------|--------|
| Role definition created | ✅ Done — `App Group Membership Reader`, id `f1ab68f5-2123-4296-8549-c81b6330cb39`. Created directly by khague under active GA (Global Administrator), rather than by a separate IT Security executor as originally scoped when this started as a request. |
| Dev assignments (3) | ✅ Done — MI `7ff98598-94a0-42cb-81d9-87a6200cb3d9` → devUsers, devSuperUsers, developerAdmins |
| QA assignments (3) | ✅ Done — MI `14bc8ee3-de60-48ea-a2f5-5064ad568371` → qaUsers, qaSuperUsers, developerAdmins |
| Prod assignments (3) | ✅ Done — MI `a60a898f-0008-4bca-83a9-5bb05dc9d435` → prodUsers, superUsers, productionSupport. Applied without a separate ServiceNow CHG — treated as non-disruptive (read-only Graph directory-role grant, no deployment/downtime risk); IT Security's PIM approval of the Global Administrator activation used to make this change serves as the change record. |
| Assignment-side tooling | ✅ Done — lives in the **`infrastructure-as-code` repo**, not this one: `origination/Set-GroupMembershipReaderRoles.ps1` (idempotent, `-Environment`/`-WhatIf` support). Committed there (`6c52cdd`) and pushed to `origin/Karl_Jul13` 2026-07-14. Kept Origination-only rather than folded into the shared `Deploy-AppService`/app-groups module. (A 2026-07-14 search of *this* repo correctly found nothing — it was never meant to live here, since the IaC repo owns all deploy-time/infra scripts for template apps.) |
| Acceptance check | ✅ **Passed, 2026-07-14 (Dev).** `GET .../transitiveMembers` on a scoped group returned `200` with a real member list (12 users); the same call against an unrelated group returned `403`. Confirms the core design assumption — Graph honors the scoped custom role for app-only membership reads. Required the browser-based SSH console, not Kudu `/api/command` — that endpoint runs in a separate sidecar container with no `IDENTITY_ENDPOINT`/`IDENTITY_HEADER` env vars and cannot mint an MI token (confirmed empirically 2026-07-14). |
| IT Security awareness | ✅ **Resolved.** Security was aware throughout — activating the Global Administrator role used to create the role/assignments requires their PIM approval. See [Ownership and Governance](#ownership-and-governance). |
| User property read | ⚠️ **New follow-up, not this role's job.** The acceptance-check response had every member property (`userPrincipalName`, etc.) null except `id`/`@odata.type` — expected behavior for this role (see [What the Role Grants — and Does Not](#what-the-role-grants--and-does-not)), but it means a *second*, separate Graph permission (`User.ReadBasic.All`, Application) is needed to resolve profile data for the enumerated IDs. Tracked in [`GROUP-MEMBERSHIP-READ.md`](GROUP-MEMBERSHIP-READ.md#step-5-graph-permission-for-basic-profile-properties) — not a change to this role or its assignments. |

## Why This Exists

Origination's usage-tracking subsystem records who uses the app. To report
**entitled-but-inactive** users (access reviews, license hygiene), its background service needs
to read the member lists of the Entra groups that grant application access — nothing else.

- **Workload identities start from zero.** Managed identities have no default directory read.
  (Every *member user* in the tenant can already read these non-hidden group memberships by
  default — this grant raises a locked-down workload identity to *less than* ordinary user
  read, on named groups only.)
- **Graph application permissions cannot be scoped.** The standard alternative,
  `GroupMember.Read.All`, is tenant-wide by construction — it would let the app read the
  membership of every group in the tenant. A scoped directory-role assignment is the only
  mechanism Entra offers to confine an app-only membership read to specific groups.
- **Secretless by design.** The grant goes to the App Service system-assigned managed
  identities. No client secret or certificate is created, stored, or rotated; tokens can only
  be minted from inside the App Service itself.

## What the Role Grants — and Does Not

| | |
|---|---|
| **Grants** | Read the member list of a group — only where an assignment is scoped to that group. Graph returns `403` for every other group in the tenant. |
| **No writes** | Cannot modify membership, owners, or any group property. |
| **No user-object rights** | Confers nothing over the users listed; scoped-object assignments explicitly do not extend to a group's members as directory objects. **Empirically confirmed 2026-07-14** — the acceptance check's member list came back with every property null except `id`/`@odata.type`. Resolving profile data needs a separate permission; see [Current Status](#current-status). |
| **No standing reach** | The definition carries no scope. Each assignment names exactly one group. Removing an assignment removes that reach immediately. |

## Why a Generic Name

Scope lives on the **assignment**, not the role definition — the definition is a reusable,
scope-free permission bag. Naming it generically makes it a shared tenant primitive any app
team can request assignments of, instead of each team minting an identical app-branded copy:

- Entra allows **100 custom roles per tenant**. Scoular currently has **2** (`Verkada
  Administrator`, `LAPS admin` — surveyed 2026-07-14), so headroom is ample, but one shared
  definition avoids ever accumulating N identical ones.
- `LAPS admin` is existing precedent for this exact pattern: one tightly bounded permission in
  a custom role.
- Auditability is unaffected: the review surface is the assignment list (which principal,
  which group), not the definition.

## Role Definition

| Field | Value |
|-------|-------|
| Display name | `App Group Membership Reader` |
| Role ID | `f1ab68f5-2123-4296-8549-c81b6330cb39` |
| Description | `Read-only membership enumeration of specific Entra groups. Grants nothing at definition level — assign scoped to individual group objects (directoryScopeId = "/<groupId>"). Owned by IT Security; assignments granted per application request.` |
| Permissions | `microsoft.directory/groups/members/read` (only) |
| Enabled | `true` |

## Assignments

Principal is the **system-assigned managed identity** of each Origination App Service.
All nine assignments use this single role definition; only principal and scope vary.

| Env | App Service (principal) | MI Object ID | Scoped group |
|-----|------------------------|--------------|--------------|
| Dev | `app-origination-dev-eus` | `7ff98598-94a0-42cb-81d9-87a6200cb3d9` | Origination App Dev Users |
| Dev | `app-origination-dev-eus` | `7ff98598-94a0-42cb-81d9-87a6200cb3d9` | Origination App Dev Super Users |
| Dev | `app-origination-dev-eus` | `7ff98598-94a0-42cb-81d9-87a6200cb3d9` | Azure - Origination App - Developer Admins |
| QA | `app-origination-qa-eus` | `14bc8ee3-de60-48ea-a2f5-5064ad568371` | Origination App QA Users |
| QA | `app-origination-qa-eus` | `14bc8ee3-de60-48ea-a2f5-5064ad568371` | Origination App QA Super Users |
| QA | `app-origination-qa-eus` | `14bc8ee3-de60-48ea-a2f5-5064ad568371` | Azure - Origination App - Developer Admins |
| Prod | `app-origination-eus` | `a60a898f-0008-4bca-83a9-5bb05dc9d435` | Origination App Users |
| Prod | `app-origination-eus` | `a60a898f-0008-4bca-83a9-5bb05dc9d435` | Origination App Super Users |
| Prod | `app-origination-eus` | `a60a898f-0008-4bca-83a9-5bb05dc9d435` | Azure - Origination App - Production Support |

> Note: assignments to service principals are always permanent/active — PIM eligibility does
> not apply to workload identities.

## Codified Tooling

The assignment side is codified as `origination/Set-GroupMembershipReaderRoles.ps1` in the
**`infrastructure-as-code` repo** (`IT/infrastructure-as-code`, path `origination/` within it —
not this repo) — kept **Origination-only** rather than folded into the shared
`Deploy-AppService`/app-groups module, since this is currently a single-app need. Revisit
centralizing into the shared module only if another template app requests the same capability.

The script:
- Requires the `App Group Membership Reader` role definition to already exist (created above).
- Requires Privileged Role Administrator (active) to create assignments.
- Resolves each App Service's managed identity via `Get-AzWebApp` in the matching subscription.
- Is idempotent — checks existing role assignments before creating, skipping groups already
  assigned.
- Supports `-Environment {Dev|QA|Prod}` to target a single environment, and `-WhatIf` for a dry
  run.

```powershell
# Run from the infrastructure-as-code repo root (Requires: Privileged Role Administrator
# (active), Microsoft Graph PowerShell SDK, Az PowerShell)
./origination/Set-GroupMembershipReaderRoles.ps1              # all environments
./origination/Set-GroupMembershipReaderRoles.ps1 -Environment Dev -WhatIf   # dry run, one env
```

Internally, role-definition creation (a one-time, IT-Security-class operation) looked like:

```powershell
Connect-MgGraph -TenantId "1521f999-f722-4a4f-9747-166f93e9b0d1" `
    -Scopes "RoleManagement.ReadWrite.Directory" -NoWelcome

$role = New-MgRoleManagementDirectoryRoleDefinition -BodyParameter @{
    displayName     = "App Group Membership Reader"
    description     = 'Read-only membership enumeration of specific Entra groups. Grants nothing at definition level - assign scoped to individual group objects (directoryScopeId = "/<groupId>"). Owned by IT Security; assignments granted per application request.'
    isEnabled       = $true
    rolePermissions = @(
        @{ allowedResourceActions = @("microsoft.directory/groups/members/read") }
    )
}
```

## Acceptance Check

**Passed, 2026-07-14** — see [Current Status](#current-status). Verified from inside the real
Dev app worker via the browser-based SSH console, using the MI's own token:

- `GET /groups/<scoped-group-id>/transitiveMembers` → **200**, real member list (12 users). ✅
- `GET /groups/<any-other-group-id>/members` → **403**. ✅

Kudu's `/api/command` REST endpoint (the usual quick path for in-container checks) could not be
used for this — it runs in a separate sidecar container that lacks the `IDENTITY_ENDPOINT` /
`IDENTITY_HEADER` environment variables needed to mint an MI token (confirmed empirically
2026-07-14: `env | grep -c IDENTITY` → `0` inside that container). The browser-based SSH console
(execs into the real app container) is what actually worked.

**Follow-up finding, not a failure of this check:** the returned member objects had every
property null except `id`/`@odata.type` — this role only authorizes reading the membership
relationship, not the member objects' own properties (confirmed, not assumed, as of this test).
See [`GROUP-MEMBERSHIP-READ.md` Step 5](GROUP-MEMBERSHIP-READ.md#step-5-graph-permission-for-basic-profile-properties)
for the separate `User.ReadBasic.All` permission needed to resolve UPN/display name, and why
that's a Graph permission rather than an extension of this role.

## Ownership and Governance

- **Role definition:** intended to be owned by IT Security as a shared tenant primitive, per the
  original request. It was created directly by the Origination engineer rather than by a
  separate Security executor, under Global Administrator activation that required Security's
  PIM approval — so Security was aware this was happening, even though they didn't execute the
  Graph calls themselves. Formal transfer of the role definition into Security's own
  administration (so it shows up as theirs to manage day-to-day, not just something they
  approved once) is still worth doing at some point, but is not a blocking gap.
- **Assignments:** requested and lifecycle-tracked by the consuming team (Origination for
  these nine). When Origination no longer needs the read, we will request their removal.
- **Audit:** definition creation and every assignment/removal appear in Entra audit logs;
  current assignments are visible under the role in the Entra admin center. We suggest
  including this role's assignments in existing periodic access reviews.
- **Licensing:** custom roles require Entra ID P1 (in place at Scoular).

## Backout

- Remove any single assignment (`Remove-MgRoleManagementDirectoryRoleAssignment`) — that
  identity instantly loses read on that group. No credentials exist to revoke.
- The definition itself can be deleted whenever it has no remaining assignments (IT Security's
  call, as owner).

## References

- Full Origination design and application changes:
  [`docs/security/GROUP-MEMBERSHIP-READ.md`](GROUP-MEMBERSHIP-READ.md)
- Access-group inventory: [`developer-docs/ENTRA-ID-GROUPS-GUIDE.md`](../../developer-docs/ENTRA-ID-GROUPS-GUIDE.md)
- Assignment-side script: `Set-GroupMembershipReaderRoles.ps1` in the `infrastructure-as-code`
  repo (`IT/infrastructure-as-code`, path `origination/Set-GroupMembershipReaderRoles.ps1`) —
  not in this repo
- Microsoft: [Entra RBAC overview (assignment scope)](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/custom-overview),
  [Default user permissions](https://learn.microsoft.com/en-us/entra/fundamentals/users-default-permissions),
  [Entra service limits](https://learn.microsoft.com/en-us/entra/identity/users/directory-service-limits-restrictions)
