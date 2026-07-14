# Request: Create Custom Entra Role "App Group Membership Reader"

**To:** IT Security (Privileged Role Administrator holders)
**From:** Origination team (Karl Hague)
**Date:** 2026-07-14
**Action requested:** Create one custom Entra ID role definition and nine scoped role
assignments (scripts provided below, ready to run).

---

## Table of Contents

- [The Ask](#the-ask)
- [Why This Is Needed](#why-this-is-needed)
- [What the Role Grants — and Does Not](#what-the-role-grants--and-does-not)
- [Why a Generic Name](#why-a-generic-name)
- [Requested Role Definition](#requested-role-definition)
- [Requested Assignments](#requested-assignments)
- [Execution Script](#execution-script)
- [Acceptance Check](#acceptance-check)
- [Ownership and Governance](#ownership-and-governance)
- [Backout](#backout)
- [References](#references)

---

## The Ask

1. **Create one custom directory role**: `App Group Membership Reader`, containing the single
   permission `microsoft.directory/groups/members/read`.
2. **Create nine scoped assignments** of that role to the Origination App Service managed
   identities — one assignment per (environment identity × access group), each scoped to a
   single group object (`directoryScopeId = "/<groupObjectId>"`).

Both actions require Privileged Role Administrator, which is why this request comes to your
team. Origination will supply the managed-identity and group object IDs at execution time
(lookup commands included below).

## Why This Is Needed

Origination's usage-tracking subsystem records who uses the app. To report
**entitled-but-inactive** users (access reviews, license hygiene), its background service needs
to read the member lists of the Entra groups that grant application access — nothing else.

- **Workload identities start from zero.** Managed identities have no default directory read.
  (Every *member user* in the tenant can already read these non-hidden group memberships by
  default — this request raises a locked-down workload identity to *less than* ordinary user
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
| **No user-object rights** | Confers nothing over the users listed; scoped-object assignments explicitly do not extend to a group's members as directory objects. |
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

## Requested Role Definition

| Field | Value |
|-------|-------|
| Display name | `App Group Membership Reader` |
| Description | `Read-only membership enumeration of specific Entra groups. Grants nothing at definition level — assign scoped to individual group objects (directoryScopeId = "/<groupId>"). Owned by IT Security; assignments granted per application request.` |
| Permissions | `microsoft.directory/groups/members/read` (only) |
| Enabled | `true` |

## Requested Assignments

Principal is the **system-assigned managed identity** of each Origination App Service.
All nine assignments use this single role definition; only principal and scope vary.

| Env | App Service (principal) | Scoped group |
|-----|------------------------|--------------|
| Dev | `app-origination-dev-eus` | Origination App Dev Users |
| Dev | `app-origination-dev-eus` | Origination App Dev Super Users |
| Dev | `app-origination-dev-eus` | Azure - Origination App - Developer Admins |
| QA | `app-origination-qa-eus` | Origination App QA Users |
| QA | `app-origination-qa-eus` | Origination App QA Super Users |
| QA | `app-origination-qa-eus` | Azure - Origination App - Developer Admins |
| Prod | `app-origination-eus` | Origination App Users |
| Prod | `app-origination-eus` | Origination App Super Users |
| Prod | `app-origination-eus` | Azure - Origination App - Production Support |

If a phased approach is preferred, **Dev only** (first three rows) is sufficient to validate
the design; QA/Prod assignments can follow as separate requests (Prod under its ServiceNow
CHG).

> Note: assignments to service principals are always permanent/active — PIM eligibility does
> not apply to workload identities.

## Execution Script

```powershell
# Requires: Privileged Role Administrator (active), Microsoft Graph PowerShell SDK
Connect-MgGraph -TenantId "1521f999-f722-4a4f-9747-166f93e9b0d1" `
    -Scopes "RoleManagement.ReadWrite.Directory" -NoWelcome

# --- 1. Create the role definition ---
$role = New-MgRoleManagementDirectoryRoleDefinition -BodyParameter @{
    displayName     = "App Group Membership Reader"
    description     = 'Read-only membership enumeration of specific Entra groups. Grants nothing at definition level - assign scoped to individual group objects (directoryScopeId = "/<groupId>"). Owned by IT Security; assignments granted per application request.'
    isEnabled       = $true
    rolePermissions = @(
        @{ allowedResourceActions = @("microsoft.directory/groups/members/read") }
    )
}

# --- 2. Resolve principals and scopes ---
# MI object ID per App Service (run in the matching subscription context):
#   (Get-AzWebApp -ResourceGroupName rg-origination-dev-eus -Name app-origination-dev-eus).Identity.PrincipalId
# Group object IDs:
#   Get-MgGroup -Filter "displayName eq 'Origination App Dev Users'" | Select Id, DisplayName

# --- 3. Create scoped assignments (repeat per environment) ---
$miPrincipal = "<managed-identity object id>"
$groupIds    = @("<users-group-id>", "<superusers-group-id>", "<admins-group-id>")

foreach ($groupId in $groupIds) {
    New-MgRoleManagementDirectoryRoleAssignment -BodyParameter @{
        roleDefinitionId = $role.Id
        principalId      = $miPrincipal
        directoryScopeId = "/$groupId"
    }
}
```

## Acceptance Check

After propagation (allow ~15 minutes), Origination will verify from inside the Dev App
Service using its managed-identity token:

- `GET /groups/<scoped-group-id>/transitiveMembers` → **200** with member list.
- `GET /groups/<any-other-group-id>/members` → **403**.

Origination will report both results back as confirmation the grant behaves as scoped.

## Ownership and Governance

- **Role definition:** owned by IT Security as a shared tenant primitive. Other teams wanting
  the same capability request their own scoped assignments; the definition never changes.
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
- Microsoft: [Entra RBAC overview (assignment scope)](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/custom-overview),
  [Default user permissions](https://learn.microsoft.com/en-us/entra/fundamentals/users-default-permissions),
  [Entra service limits](https://learn.microsoft.com/en-us/entra/identity/users/directory-service-limits-restrictions)
