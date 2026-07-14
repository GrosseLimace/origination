# Access-Group Membership Read for Usage Auditing

Implementation plan for granting `UsageAggregationBackgroundService` a **narrowly scoped**,
secretless way to read the membership of the Entra ID groups that grant access to Origination,
so the Usage Dashboard can compare **who has access** against **who actually uses the app**.

**Status: proposed — not yet implemented.** Requires identity-team sign-off before the Entra
steps run (see [Open Questions](#open-questions--approvals)).

---

## Table of Contents

- [Goal](#goal)
- [Design Decision](#design-decision)
  - [Chosen approach](#chosen-approach)
  - [Alternatives considered and rejected](#alternatives-considered-and-rejected)
- [Architecture](#architecture)
- [Part 1 — Entra ID Configuration](#part-1--entra-id-configuration)
  - [Prerequisites](#prerequisites)
  - [Step 1: Create the custom directory role](#step-1-create-the-custom-directory-role)
  - [Step 2: Collect the principal and scope IDs](#step-2-collect-the-principal-and-scope-ids)
  - [Step 3: Assign the role, scoped per group](#step-3-assign-the-role-scoped-per-group)
  - [Step 4: Smoke-test before writing any code](#step-4-smoke-test-before-writing-any-code)
- [Part 2 — Networking](#part-2--networking)
- [Part 3 — Application Changes](#part-3--application-changes)
  - [Configuration](#configuration)
  - [NuGet dependency and SBOM](#nuget-dependency-and-sbom)
  - [Snapshot entity and migration](#snapshot-entity-and-migration)
  - [Membership service](#membership-service)
  - [Aggregation service integration](#aggregation-service-integration)
  - [Identity join semantics](#identity-join-semantics)
  - [Local development](#local-development)
- [Security Considerations](#security-considerations)
- [Rollout Plan](#rollout-plan)
- [Backout Plan](#backout-plan)
- [Open Questions / Approvals](#open-questions--approvals)

---

## Goal

The usage-tracking subsystem (see `UsageTrackingBackgroundService`,
`UsageAggregationBackgroundService`) records which users exercise which features. It can answer
*"who used the app"* but not *"who could have"*. To surface entitled-but-inactive users, the
aggregation service needs the member list of the application access groups documented in
[`developer-docs/ENTRA-ID-GROUPS-GUIDE.md`](../../developer-docs/ENTRA-ID-GROUPS-GUIDE.md):

| Env | Group | App Role |
|-----|-------|----------|
| Dev | Origination App Dev Users | `User` |
| Dev | Origination App Dev Super Users | `Admin` |
| Dev/QA | Azure - Origination App - Developer Admins | `Admin` |
| QA | Origination App QA Users | `User` |
| QA | Origination App QA Super Users | `Admin` |
| Prod | Origination App Users | `User` |
| Prod | Origination App Super Users | `Admin` |
| Prod | Azure - Origination App - Production Support | `Admin` |

The constraint: Microsoft Graph **application** permissions for group membership
(`GroupMember.Read.All`, `Directory.Read.All`) are tenant-wide. This design avoids them
entirely.

## Design Decision

### Chosen approach

**A custom Entra ID directory role containing only `microsoft.directory/groups/members/read`,
assigned to the App Service's system-assigned managed identity, scoped to each access group
object individually.**

Why this shape:

- **Narrow by construction.** The identity can enumerate members of exactly the scoped groups.
  Graph returns `403` for every other group in the tenant. There is no tenant-wide grant
  anywhere in the design.
- **Secretless.** Directory roles can be assigned to service principals, and a managed identity
  *is* a service principal. Tokens for the MI can only be minted from inside the App Service —
  there is no credential to store, rotate, leak, or use off-box. (Same pattern as assigning
  *Directory Readers* to an Azure SQL server identity.)
- **The MI, not the API app registration's SP.** The `Origination API - *` app registration is
  a purely *inbound* identity today — the runtime validates tokens issued *to* it and never
  authenticates *as* it. Using its SP for outbound Graph calls would force its Key Vault client
  secret into runtime code: a portable bearer credential carrying directory rights. The MI keeps
  the grant compute-bound. If a self-documenting identity is preferred, a dedicated
  user-assigned MI works identically (see [Open Questions](#open-questions--approvals)).
- **Dormant without config.** Like the `FieldTags:*` pattern, the app feature activates only
  when the `UsageAccessAudit:*` configuration section is present.

### Alternatives considered and rejected

| Alternative | Why rejected |
|-------------|--------------|
| `GroupMember.Read.All` application permission | Tenant-wide read of every group membership; exactly the blast radius this design avoids. Fallback if custom roles are vetoed. |
| Enumerate Enterprise App assignments (`servicePrincipals/{id}/appRoleAssignedTo`) | Requires `Application.Read.All` (tenant-wide) *and* returns group assignments, not flattened users — member expansion is still needed. Strictly worse. |
| Entitlement Management API (access packages) | `EntitlementManagement.Read.All` is tenant-wide, and only the admin groups flow through access packages; the `appManaged` Users groups are owner-managed directly. |
| Harvest identities from sign-in tokens | Only sees users who *do* sign in — cannot find entitled-but-inactive users, which is the point. |
| Resource-specific consent | Only exists for Teams/chat resources, not security groups. |
| External exporter pushes a snapshot table (Logic App / runbook / pipeline) | Viable "option 2" that keeps all directory rights off the app. Rejected for now as a second deployable moving part; revisit if the custom-role approach is vetoed. |

## Architecture

```mermaid
flowchart LR
    subgraph Entra ID
        R[Custom role:<br/>App Group Membership Reader<br/>groups/members/read only]
        G1[(Access group 1)]
        G2[(Access group 2)]
        G3[(Access group 3)]
    end
    subgraph App Service
        MI[System-assigned<br/>managed identity]
        AGG[UsageAggregationBackgroundService]
        SVC[IAccessGroupMembershipService<br/>GraphServiceClient + ManagedIdentityCredential]
    end
    DB[(ApplicationDbContext<br/>AccessGroupMemberSnapshot)]
    UD[Usage Dashboard queries]

    R -- assigned to MI,<br/>scoped per group --> G1 & G2 & G3
    AGG -- daily --> SVC
    SVC -- GET /groups/id/transitiveMembers --> G1 & G2 & G3
    SVC --> DB
    DB --> UD
```

Once per aggregation cycle (daily granularity), the aggregation service snapshots the
transitive membership of each configured group into an app table. Dashboard queries join the
snapshot against `UserActivityDaily` / `WeeklyLoginAggregate` to report access-vs-usage.

## Part 1 — Entra ID Configuration

### Prerequisites

- **Entra ID P1** — required for custom directory roles (Scoular has this).
- **Privileged Role Administrator** — held by IT Security. Steps 1 and 3 are executed by
  them; the formal request (with ready-to-run scripts) is
  [`REQUEST-APP-GROUP-MEMBERSHIP-READER.md`](REQUEST-APP-GROUP-MEMBERSHIP-READER.md).
- Scoped assignments to a service principal must be made via Graph / Microsoft.Graph
  PowerShell; the portal UX does not cover this combination.

All scripts below follow the standing rule: always pass the Scoular tenant ID
(`1521f999-f722-4a4f-9747-166f93e9b0d1`) to `Connect-MgGraph`.

### Step 1: Create the custom directory role

One role definition serves all three environments (assignments differ per env).

```powershell
Connect-MgGraph -TenantId "1521f999-f722-4a4f-9747-166f93e9b0d1" `
    -Scopes "RoleManagement.ReadWrite.Directory" -NoWelcome

$role = New-MgRoleManagementDirectoryRoleDefinition -BodyParameter @{
    displayName     = "App Group Membership Reader"
    description     = 'Read-only membership enumeration of specific Entra groups. Grants nothing at definition level - assign scoped to individual group objects. Owned by IT Security; assignments granted per application request.'
    isEnabled       = $true
    rolePermissions = @(
        @{ allowedResourceActions = @("microsoft.directory/groups/members/read") }
    )
}
$role.Id   # record this — used in Step 3
```

### Step 2: Collect the principal and scope IDs

**Managed identity object IDs** (the *service principal* object ID, i.e. `principalId`):

```powershell
# Repeat per environment / subscription context
(Get-AzWebApp -ResourceGroupName rg-origination-dev-eus -Name app-origination-dev-eus).Identity.PrincipalId
```

**Access-group object IDs** — authoritative source is `appGroups[]` in the infrastructure
repo's `app-config.json` (the same source that generates `ENTRA-ID-GROUPS-GUIDE.md`), or:

```powershell
Get-MgGroup -Filter "displayName eq 'Origination App Dev Users'" | Select-Object Id, DisplayName
```

| Env | App Service (MI principal) | Groups to scope |
|-----|---------------------------|-----------------|
| Dev | `app-origination-dev-eus` | Origination App Dev Users; Origination App Dev Super Users; Azure - Origination App - Developer Admins |
| QA | `app-origination-qa-eus` | Origination App QA Users; Origination App QA Super Users; Azure - Origination App - Developer Admins |
| Prod | `app-origination-eus` | Origination App Users; Origination App Super Users; Azure - Origination App - Production Support |

### Step 3: Assign the role, scoped per group

One assignment per (environment MI × group). `directoryScopeId` of `"/<groupObjectId>"`
restricts the role to that single group object.

```powershell
$roleId      = "<role definition id from Step 1>"
$miPrincipal = "<MI service principal object id for this env>"
$groupIds    = @("<users-group-id>", "<superusers-group-id>", "<admins-group-id>")

foreach ($groupId in $groupIds) {
    New-MgRoleManagementDirectoryRoleAssignment -BodyParameter @{
        roleDefinitionId = $roleId
        principalId      = $miPrincipal
        directoryScopeId = "/$groupId"
    }
}
```

> **Note:** assignments to service principals must be permanent/active — PIM eligibility does
> not apply to workload identities.

An **administrative unit** containing the groups (scope `"/administrativeUnits/<auId>"`) is an
equivalent alternative that reduces assignment count and auto-covers future groups added to the
AU. Per-group scoping is preferred here because the group set is small and static, and the
per-object assignment is self-evidently minimal in an access review.

### Step 4: Smoke-test before writing any code

The load-bearing assumption is that Graph honors a *custom* directory role carried in an
app-only token's `wids` claim. **Verify this in Dev before building anything on it.**

Directory role activation for a service principal can take a few minutes to propagate. Then,
from inside the Dev App Service (Kudu — `/azure-exec` skill):

```bash
# 1. Get an MI token for Graph (App Service token endpoint)
TOKEN=$(curl -s "$IDENTITY_ENDPOINT?resource=https://graph.microsoft.com&api-version=2019-08-01" \
  -H "X-IDENTITY-HEADER: $IDENTITY_HEADER" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 2. MUST succeed (200, member list) — a scoped access group
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/groups/<dev-users-group-id>/transitiveMembers?\$select=id,userPrincipalName"

# 3. MUST fail (403) — any group NOT scoped to the role
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/groups/<unrelated-group-id>/members"
```

If step 2 returns `403` after propagation time, custom-role authorization for app-only Graph
membership reads is not honored as designed — stop, and fall back to the exporter model
(option 2 in [Alternatives](#alternatives-considered-and-rejected)) with this same scoped role
on the exporter's identity, or escalate to the identity team.

## Part 2 — Networking

Per [`developer-docs/CLAUDE.md`](../../developer-docs/CLAUDE.md), the App Service's VNet
egress is NSG-restricted and external API calls need a custom outbound rule.

- **Token acquisition** uses the App Service-local identity endpoint — no NSG change.
- **`graph.microsoft.com:443`** is a new outbound dependency. Verify whether the existing
  `AzureActiveDirectory` service-tag rule (used for token validation metadata) already covers
  Microsoft Graph IPs; if not, add an outbound allow rule for Graph before rollout. Test from
  Kudu with the smoke-test above — a hang/timeout on step 2 indicates NSG, not authorization.

## Part 3 — Application Changes

### Configuration

New optional section; the feature is **dormant when absent** (mirrors the `FieldTags` POC
pattern). Group IDs are per-environment App Service app settings, not committed JSON.

```jsonc
"UsageAccessAudit": {
  "Groups": [
    { "objectId": "<guid>", "name": "Origination App Dev Users",       "appRole": "User"  },
    { "objectId": "<guid>", "name": "Origination App Dev Super Users", "appRole": "Admin" },
    { "objectId": "<guid>", "name": "Azure - Origination App - Developer Admins", "appRole": "Admin" }
  ]
}
```

App Service setting form: `UsageAccessAudit__Groups__0__ObjectId`, etc. Group **object IDs are
not secrets** — plain app settings are fine; Key Vault is not required.

### NuGet dependency and SBOM

- Add `Microsoft.Graph` (latest 5.x) to `GrainOriginatorPortal.Api`. `Azure.Identity` 1.18.0
  is already referenced.
- **Update the SBOM tables in `README.md` per org policy** in the same PR that adds the
  package (name, version, MIT license, purpose: "Graph client for access-group membership
  snapshots").

### Snapshot entity and migration

New `ApplicationDbContext` entity + EF migration (read/write context — correct home per the
Data Sources rules):

```csharp
public class AccessGroupMemberSnapshot
{
    public int Id { get; set; }
    public DateOnly SnapshotDate { get; set; }
    public string GroupObjectId { get; set; } = string.Empty;
    public string GroupName { get; set; } = string.Empty;
    public string AppRole { get; set; } = string.Empty;        // "User" | "Admin"
    public string UserObjectId { get; set; } = string.Empty;   // Entra oid
    public string UserPrincipalName { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;         // normalized join key — see below
    public string? DisplayName { get; set; }
    public bool AccountEnabled { get; set; }
}
```

Suggested indexes: `(SnapshotDate, GroupObjectId)` and `(SnapshotDate, UserId)`. Retention:
delete snapshots older than the existing usage-retention window (90 days,
`CleanupUsageRetentionAsync`) so access history and usage history cover the same span.

### Membership service

`IAccessGroupMembershipService` in `GrainOriginatorPortal.Api/Services`, registered only when
`UsageAccessAudit:Groups` is non-empty:

- `GraphServiceClient` built on `ManagedIdentityCredential` (per the cold-start guidance in
  `developer-docs/CLAUDE.md` — do not use `DefaultAzureCredential` on App Service).
- For each configured group: `GET /groups/{id}/transitiveMembers/microsoft.graph.user`
  with `$select=id,userPrincipalName,displayName,accountEnabled`, following `@odata.nextLink`
  pages. **Transitive** members so nested-group members are captured.
- Writes one snapshot per day (idempotent: delete-and-rewrite the current date's rows, so an
  intra-day rerun self-heals).
- **Failure isolation:** wrap in the same pattern as `RefreshTradeUnitSnapshotAsync` — log a
  warning and continue. A Graph outage must never fail the aggregation cycle; dashboard
  queries fall back to the most recent successful snapshot.

### Aggregation service integration

Add a `SnapshotAccessGroupMembershipAsync` step to the `UsageAggregationBackgroundService`
hourly loop, guarded to run once per UTC day (alongside the existing daily aggregations), plus
the retention delete in `CleanupRetentionAsync`. No other changes to the service's shape — it
stays a scheduler that delegates to injected services.

### Identity join semantics

`UsageTrackingMiddleware` keys usage rows on the **UPN prefix**:
`preferred_username` truncated before `@`, falling back to the raw `oid` when
`preferred_username` is absent (`UsageTrackingMiddleware.cs`). Therefore:

- `AccessGroupMemberSnapshot.UserId` = `UserPrincipalName` truncated before `@`, lowercased to
  match comparison behavior in dashboard queries.
- Because usage rows can occasionally carry an `oid` fallback, dashboard comparison queries
  should join on `UserId` **or** `UserObjectId`.
- Guest accounts (`#EXT#` UPNs) won't match the prefix convention; none are expected in these
  groups, but the snapshot preserves the full UPN so they remain identifiable.

### Local development

`ManagedIdentityCredential` does not exist locally. Two acceptable options:

1. Leave `UsageAccessAudit` unconfigured locally — feature stays dormant (default).
2. For testing the service itself, use `AzureCliCredential` behind an `IsDevelopment()` branch;
   a signed-in developer's *delegated* token can read group membership under default user
   permissions.

Never work around it by putting a client secret in local config.

## Security Considerations

- **Blast radius if the App Service is fully compromised:** attacker can enumerate members of
  the configured access groups — names/UPNs of app users — and nothing else directory-wise.
  No write path, no other groups, no tenant-wide read.
- **Grant visibility:** the custom role and its assignments appear in Entra role assignments
  and audit logs; assignment/removal events are logged. Include the role in periodic access
  reviews alongside the existing quarterly group reviews.
- **Data classification:** the snapshot stores employee UPNs/display names (internal PII —
  Confidential). It lives in the same Azure SQL database as the usage data it joins against,
  behind private endpoints. Do not log member lists; log counts only.
- **In-process scope:** anything running in the API process can use the MI, not just the
  aggregation service. Accepted: the MI already holds Key Vault read and SQL access; this adds
  a strictly-scoped directory read. A dedicated user-assigned MI is the alternative if the
  grant should be self-documenting (see below).
- **Change management:** the Prod role assignment and NSG change require a ServiceNow CHG.

## Rollout Plan

1. **Dev:** create role → assign to Dev MI (3 groups) → smoke-test (Step 4) → NSG
   verification → app changes behind config → verify snapshot rows and dashboard join.
2. **QA:** assign to QA MI, set config, verify. Exercise the Graph-outage path (temporarily
   remove one assignment; confirm warning log + stale-snapshot fallback).
3. **Prod:** CHG ticket covering role assignment + app settings + (if needed) NSG rule.
   Deploy config after the assignment propagates; verify first snapshot next cycle.

Each step is independently reversible; the app ships dormant until its config is set.

## Backout Plan

- **App level:** remove the `UsageAccessAudit` app settings — feature returns to dormant on
  next restart. Snapshot table is inert data; drop via migration at leisure.
- **Entra level:** request IT Security remove assignments
  (`Remove-MgRoleManagementDirectoryRoleAssignment`) — each removal instantly revokes that
  reach. The shared role definition stays (Security-owned); no credentials to clean up.

## Open Questions / Approvals

1. **IT Security sign-off and execution** — the role definition and assignments require
   Privileged Role Administrator, held by IT Security. The formal request is
   [`REQUEST-APP-GROUP-MEMBERSHIP-READER.md`](REQUEST-APP-GROUP-MEMBERSHIP-READER.md): a
   generically named, Security-owned shared role (`App Group Membership Reader`), with
   Origination holding only scoped assignments. Supporting facts (tenant surveyed
   2026-07-14): Entra allows 100 custom roles per tenant; Scoular has 2 today (`Verkada
   Administrator`, `LAPS admin`), neither granting `groups/members/read` — no existing role
   to reuse, ample headroom, and `LAPS admin` is precedent for the
   single-tightly-bounded-permission pattern. If the request is declined: fall back to the
   external-exporter model (scoped role on a pipeline identity, app reads only the table)
   before falling back to `GroupMember.Read.All`.
2. **System-assigned vs dedicated user-assigned MI.** This doc specifies the system-assigned
   MI (pragmatic; no new identity). A user-assigned MI dedicated to usage auditing is
   self-documenting in access reviews and portable if the usage services move to their own
   host — but within one process the separation is cosmetic. Decide at Dev rollout; the
   scripts differ only in `principalId`.
3. **Smoke-test outcome (Step 4)** — the design is contingent on Graph honoring the scoped
   custom role for app-only membership reads. Validated in Dev before any application work
   proceeds.
