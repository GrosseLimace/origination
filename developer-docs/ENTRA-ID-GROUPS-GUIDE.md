# Origination - Entra ID Groups

## Overview

Origination uses Entra ID security groups to control access across two broad categories: **Application access groups** grant access to the app (and, for admin groups, Azure infrastructure permissions); **SQL groups** grant database role memberships.

This guide is **generated from Origination's own configuration** (`appGroups[]` in `app-config.json`), so it shows exactly the groups this app has — including any app-specific groups — and the application role each one carries. As the app's groups change, this document stays correct automatically.

Developers typically have two accounts:
- **Admin account** (`admin-jdoe@scoular.com`) — infrastructure management
- **User account** (`jdoe@scoular.com`) — application use and testing

## How Groups Are Managed

Each group's **Managed As** column tells you how its membership and ownership are handled:

- **`igManaged`** — Identity Governance owns membership and ownership conferral (the Developer Admins / Production Support admin groups). You join these by requesting the relevant access package.
- **`appManaged`** — the infrastructure template ensures the group exists and holds its app role; group **owners** add/remove members directly via [Groups I Own](https://myaccount.microsoft.com/groups/groups-i-own). Owners are conferred through the access package.
- **`external`** — a shared or dynamic group not owned by this app (e.g. an org-wide licensing group). Referenced only — its membership is managed elsewhere.

## App Roles at a Glance

The application role each group carries appears in the app's JWT `roles` claim. This summary shows which group(s) hold each role per environment:

| App Role | Dev | QA | Prod |
|----------|-----|----|----|
| `Admin` | Azure - Origination App - Developer Admins<br>Origination App Dev Super Users | Azure - Origination App - Developer Admins<br>Origination App QA Super Users | Azure - Origination App - Production Support<br>Origination App Super Users |
| `User` | Origination App Dev Users | Origination App QA Users | Origination App Users |

## Application Access Groups

The following groups are defined for Origination, grouped by environment. Each row shows the group, the **app role** it carries (the `value` in the `roles` claim, with its display label), what that grants, how the group is managed, and how to get added.

Each group is assigned to **both** the API and the SPA Enterprise Application for its environment. The SPA is the sign-in gate (`Assignment required` enabled); the API carries the app role. A group assigned only to the API would be authorized for its role but unable to sign in.

### Dev

| Group | App Role | What It Grants | Managed As | How to Get Added |
|-------|----------|----------------|------------|------------------|
| Azure - Origination App - Developer Admins | `Admin` | Full administrative access (Azure RBAC + in-app admin) | igManaged | Origination - Developer Azure Access access package |
| Origination App Dev Users | `User` | Standard application access | appManaged | Managed by group owner (via Groups I Own) |
| Origination App Dev Super Users | `Admin` | Full administrative access (Azure RBAC + in-app admin) | appManaged | Managed by group owner (via Groups I Own) |

### QA

| Group | App Role | What It Grants | Managed As | How to Get Added |
|-------|----------|----------------|------------|------------------|
| Azure - Origination App - Developer Admins | `Admin` | Full administrative access (Azure RBAC + in-app admin) | igManaged | Origination - Developer Azure Access access package |
| Origination App QA Users | `User` | Standard application access | appManaged | Managed by group owner (via Groups I Own) |
| Origination App QA Super Users | `Admin` | Full administrative access (Azure RBAC + in-app admin) | appManaged | Managed by group owner (via Groups I Own) |

### Prod

| Group | App Role | What It Grants | Managed As | How to Get Added |
|-------|----------|----------------|------------|------------------|
| Azure - Origination App - Production Support | `Admin` | Full administrative access (Azure RBAC + in-app admin) | igManaged | Origination - Azure Production Support access package |
| Origination App Users | `User` | Standard application access | appManaged | Managed by group owner (via Groups I Own) |
| Origination App Super Users | `Admin` | Full administrative access (Azure RBAC + in-app admin) | appManaged | Managed by group owner (via Groups I Own) |

## SQL Permission Groups

SQL database access is controlled through Entra ID groups that map to SQL Server database roles. Each group is created as an external user in the SQL database and assigned to the corresponding role. Members of these groups inherit that database role when connecting via `Active Directory Default` authentication.

Most SQL groups are granted through Access Packages (Developer Access for Dev/QA, Production Support for Prod). The `db_owner` role is **not** included in access packages and is managed directly by the infrastructure team.

The CI/CD workflow identity (GitHub Actions) is added to `db_datareader`, `db_datawriter`, and `db_ddladmin`, and is also granted database-wide `EXECUTE`. Together these support EF Core migrations (including migrations that `EXEC` user-defined stored procedures), data seeding, and integration tests.

### Dev

| Group Name | Object ID | SQL Role | Permissions | Access Package |
|------------|-----------|----------|-------------|----------------|
| `azrscosqld01-Origination-db_datareader` | `bb60e7f4-944c-411a-bce0-b6c96ac1877d` | db_datareader | Read all data (SELECT on all tables/views) | Developer Access |
| `azrscosqld01-Origination-db_datawriter` | `fe5f0af0-dcbe-4ad5-89a7-35dbcf08aea5` | db_datawriter | Insert, update, delete data in all tables | Developer Access |
| `azrscosqld01-Origination-db_ddladmin` | `8dfbea12-7c93-4251-a493-b369efc7972c` | db_ddladmin | Create, alter, drop tables/indexes/views (DDL) | Developer Access |
| `azrscosqld01-Origination-db_owner` | `af3388d7-28be-4455-b667-c5b3e20e12a4` | db_owner | Full database ownership (all permissions) | Infrastructure-managed |
| `azrscosqld01-Origination-execute_sprocs` | `0818f668-a394-43c0-96e4-7c2c4797e06d` | execute_sprocs | Execute stored procedures | Developer Access |

### QA

| Group Name | Object ID | SQL Role | Permissions | Access Package |
|------------|-----------|----------|-------------|----------------|
| `azrscosqlq01-Origination-db_datareader` | `6db5faf3-c14e-4a33-b8cb-db4b5041fc47` | db_datareader | Read all data (SELECT on all tables/views) | Developer Access |
| `azrscosqlq01-Origination-db_datawriter` | `c097b10d-7340-4d2c-b621-43859c5ca7d7` | db_datawriter | Insert, update, delete data in all tables | Developer Access |
| `azrscosqlq01-Origination-db_ddladmin` | `0c39fd28-f2f7-4344-8730-371ce0c11234` | db_ddladmin | Create, alter, drop tables/indexes/views (DDL) | Developer Access |
| `azrscosqlq01-Origination-db_owner` | `0dd08142-1835-4598-9651-84963f279747` | db_owner | Full database ownership (all permissions) | Infrastructure-managed |
| `azrscosqlq01-Origination-execute_sprocs` | `aa6e8521-08d1-498e-a013-211f00b03265` | execute_sprocs | Execute stored procedures | Developer Access |

### Prod

| Group Name | Object ID | SQL Role | Permissions | Access Package |
|------------|-----------|----------|-------------|----------------|
| `azrscosqlp01-Origination-db_datareader` | `6fe18a94-b8fd-4f61-ab75-ce4a731dc318` | db_datareader | Read all data (SELECT on all tables/views) | Production Support |
| `azrscosqlp01-Origination-db_datawriter` | `018b91be-66ea-4ea5-9271-43c1ec59455a` | db_datawriter | Insert, update, delete data in all tables | Production Support |
| `azrscosqlp01-Origination-db_ddladmin` | `1c7602db-da3f-4256-9938-75236b8f3ee7` | db_ddladmin | Create, alter, drop tables/indexes/views (DDL) | Production Support |
| `azrscosqlp01-Origination-db_owner` | `f1f866a5-fb00-406c-942d-47f746066a2d` | db_owner | Full database ownership (all permissions) | Infrastructure-managed |
| `azrscosqlp01-Origination-execute_sprocs` | `2bf7735a-d6eb-4ecf-a1e7-c558bb40a682` | execute_sprocs | Execute stored procedures | Production Support |


## SQL Groups at a Glance

| Group Name | Object ID | Environment | SQL Role | Access Package |
|------------|-----------|-------------|----------|----------------|
| `azrscosqld01-Origination-db_datareader` | `bb60e7f4-944c-411a-bce0-b6c96ac1877d` | Dev | SQL db_datareader | Developer Access |
| `azrscosqld01-Origination-db_datawriter` | `fe5f0af0-dcbe-4ad5-89a7-35dbcf08aea5` | Dev | SQL db_datawriter | Developer Access |
| `azrscosqld01-Origination-db_ddladmin` | `8dfbea12-7c93-4251-a493-b369efc7972c` | Dev | SQL db_ddladmin | Developer Access |
| `azrscosqld01-Origination-db_owner` | `af3388d7-28be-4455-b667-c5b3e20e12a4` | Dev | SQL db_owner | Infrastructure-managed |
| `azrscosqld01-Origination-execute_sprocs` | `0818f668-a394-43c0-96e4-7c2c4797e06d` | Dev | SQL execute_sprocs | Developer Access |
| `azrscosqlq01-Origination-db_datareader` | `6db5faf3-c14e-4a33-b8cb-db4b5041fc47` | QA | SQL db_datareader | Developer Access |
| `azrscosqlq01-Origination-db_datawriter` | `c097b10d-7340-4d2c-b621-43859c5ca7d7` | QA | SQL db_datawriter | Developer Access |
| `azrscosqlq01-Origination-db_ddladmin` | `0c39fd28-f2f7-4344-8730-371ce0c11234` | QA | SQL db_ddladmin | Developer Access |
| `azrscosqlq01-Origination-db_owner` | `0dd08142-1835-4598-9651-84963f279747` | QA | SQL db_owner | Infrastructure-managed |
| `azrscosqlq01-Origination-execute_sprocs` | `aa6e8521-08d1-498e-a013-211f00b03265` | QA | SQL execute_sprocs | Developer Access |
| `azrscosqlp01-Origination-db_datareader` | `6fe18a94-b8fd-4f61-ab75-ce4a731dc318` | Prod | SQL db_datareader | Production Support |
| `azrscosqlp01-Origination-db_datawriter` | `018b91be-66ea-4ea5-9271-43c1ec59455a` | Prod | SQL db_datawriter | Production Support |
| `azrscosqlp01-Origination-db_ddladmin` | `1c7602db-da3f-4256-9938-75236b8f3ee7` | Prod | SQL db_ddladmin | Production Support |
| `azrscosqlp01-Origination-db_owner` | `f1f866a5-fb00-406c-942d-47f746066a2d` | Prod | SQL db_owner | Infrastructure-managed |
| `azrscosqlp01-Origination-execute_sprocs` | `2bf7735a-d6eb-4ecf-a1e7-c558bb40a682` | Prod | SQL execute_sprocs | Production Support |

## How Groups Map to Enterprise Applications

Each environment has two app registrations (API and SPA) with corresponding Enterprise Applications. All application access groups for that environment are assigned to **both** Enterprise Apps:

- **API Enterprise App** (`Origination API[ - Env]`) — hidden from My Apps; carries the app roles. The group's role assignment here determines the JWT `roles` claim.
- **SPA Enterprise App** (`Origination[ - Env]`) — visible in My Apps; `Assignment required` enabled. This is the sign-in gate.

See the **Application Access Groups** tables above for the per-environment, per-group role assignments.

## Group-to-Role Assignment

Each Entra ID group is assigned to an app role on the API Enterprise Application via the `appRole` field on its `appGroups[]` entry in `app-config.json`. The assigned role determines the value in the JWT `roles` claim.

When a group is added, removed, or re-roled, edit `appGroups[]` and re-run the reconcile/validation tooling — the group set above and the role labels in [APP-REGISTRATIONS.md](APP-REGISTRATIONS.md) are both sourced from config.

## Troubleshooting

**"I can't deploy code to Dev"**
- Use your **admin account**, not your user account
- Verify your admin account is in the **Developer Admins** group
- Wait 15-30 minutes after being added to a group (Entra ID sync delay)

**"I can't access the application"**
- Verify you're in one of the access groups for the environment (see the tables above)
- Sign out and back in to refresh your token
- Check you're accessing the correct URL: `https://origination-dev.scoular.com` (Dev), `https://origination-qa.scoular.com` (QA), `https://origination.scoular.com` (Prod)

**"I can't see Key Vault secrets"**
- Use your **admin account**
- Verify membership in the appropriate admin group for the environment

**Check your group memberships:** [myaccount.microsoft.com/groups](https://myaccount.microsoft.com/groups)

## Related Documentation

- **[ACCESS-PACKAGES-USER-GUIDE.md](ACCESS-PACKAGES-USER-GUIDE.md)** — How to request access via My Access portal
- **[APP-REGISTRATIONS.md](APP-REGISTRATIONS.md)** — App registration details, client IDs, and app roles
- **[START-HERE.md](START-HERE.md)** — Infrastructure overview and getting started

---

*Document version: 2.0 | 2026-06-21*
