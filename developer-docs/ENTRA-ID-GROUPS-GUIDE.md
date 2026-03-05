# Origination - Entra ID Groups

## Overview

Origination uses Entra ID security groups to control access across three categories: **Admin groups** grant Azure infrastructure permissions + application access. **User groups** grant application access only. **SQL groups** grant database role memberships.

Developers typically have two accounts:
- **Admin account** (`admin-jdoe@scoular.com`) — infrastructure management
- **User account** (`jdoe@scoular.com`) — application use and testing

## Groups at a Glance

| Group | Object ID | Environments | Purpose | Access Package |
|-------|-----------|-------------|---------|----------------|
| Azure - Origination App - Developer Admins | `83f44135-230c-4b28-a633-009e57088080` | Dev, QA | Azure RBAC + app access (admin accounts) | Developer Access |
| Azure - Origination App - Production Support | `5a0d1b24-2451-42a9-a709-a1e945068db8` | Prod | Azure RBAC + app access (admin accounts) | Production Support |
| Origination App Dev Users | `0e4dd29c-b23c-4e11-a2a3-13e1be934c2b` | Dev | App access only (user accounts) | Developer Access |
| Origination App QA Users | `8f0e0182-661e-4396-bda3-9fa43217f258` | QA | App access only (user accounts) | Developer Access |
| Origination App Users | `0cb70d50-df9d-4a98-8385-65112e4a7f50` | Prod | App access only (user accounts) | Production Support |
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

## Admin Groups

Admin groups provide Azure RBAC roles on the app's infrastructure resources, plus Enterprise Application assignment for app access. The Developer Access package is available to both admin and regular developer accounts.

### Azure - Origination App - Developer Admins

**Object ID:** `83f44135-230c-4b28-a633-009e57088080`
**Environments:** Dev, QA
**Granted via:** Origination - Developer Access package

**Azure RBAC roles:**
| Role | Scope | What It Allows |
|------|-------|----------------|
| VSCode App Service Browser | Subscription (nonprod) | Browse App Services in VSCode Azure extension |
| Reader | Resource Group | View all resources, deployment history, metrics |
| Website Contributor | App Service | Deploy code, start/stop/restart, view logs, Kudu console |
| Key Vault Secrets Officer | Key Vault | Create, read, update, delete secrets |

**Enterprise App assignment:** Assigned to both API and SPA Enterprise Applications. Allows authentication and full application use.

**Additional:** Members of this group are set as **Owners** of the Dev Users and QA Users groups, allowing them to directly add/remove application users via [Groups I Own](https://myaccount.microsoft.com/groups/groups-i-own).

### Azure - Origination App - Production Support

**Object ID:** `5a0d1b24-2451-42a9-a709-a1e945068db8`
**Environments:** Prod
**Granted via:** Origination - Production Support package

**Azure RBAC roles:**
| Role | Scope | What It Allows |
|------|-------|----------------|
| VSCode App Service Browser | Subscription (prod) | Browse App Services in VSCode Azure extension |
| Reader | Resource Group | View all resources, deployment history, metrics |
| Website Contributor | App Service | Deploy code, start/stop/restart, view logs, Kudu console |
| Key Vault Secrets Officer | Key Vault | Create, read, update, delete secrets |

**Enterprise App assignment:** Assigned to both production API and SPA Enterprise Applications.

## User Groups

User groups provide **application access only** — no Azure infrastructure permissions. These groups are assigned to the API and SPA Enterprise Applications so members can authenticate.

The API Enterprise Application has "Assignment required" enabled, meaning only members of assigned groups can obtain tokens.

### Origination App Dev Users

**Object ID:** `0e4dd29c-b23c-4e11-a2a3-13e1be934c2b`
**Environment:** Dev
**Granted via:** Origination - Developer Access package
**Managed by:** Developer Admins (group owners) via [Groups I Own](https://myaccount.microsoft.com/groups/groups-i-own)

Use this group for developer user accounts and testers who need to use the Dev application.

### Origination App QA Users

**Object ID:** `8f0e0182-661e-4396-bda3-9fa43217f258`
**Environment:** QA
**Granted via:** Origination - Developer Access package
**Managed by:** Developer Admins (group owners) via [Groups I Own](https://myaccount.microsoft.com/groups/groups-i-own)

Use this group for QA testers and developer user accounts who need to use the QA application.

### Origination App Users

**Object ID:** `0cb70d50-df9d-4a98-8385-65112e4a7f50`
**Environment:** Prod
**Granted via:** Origination - Production Support package

Use this group for end users and authorized personnel who need production application access.

## SQL Permission Groups

SQL database access is controlled through Entra ID groups that map to SQL Server database roles. Each group is created as an external user in the SQL database and assigned to the corresponding role. Members of these groups inherit that database role when connecting via `Active Directory Default` authentication.

Most SQL groups are granted through Access Packages (Developer Access for Dev/QA, Production Support for Prod). The `db_owner` role is **not** included in access packages and is managed directly by the infrastructure team.

The CI/CD workflow identity (GitHub Actions) is added to `db_datareader`, `db_datawriter`, and `db_ddladmin` to support EF Core migrations and data seeding.

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


## How Groups Map to Enterprise Applications

Each environment has two app registrations (API and SPA) with corresponding Enterprise Applications. All groups for that environment are assigned to both Enterprise Apps:

| Environment | API Enterprise App | SPA Enterprise App | Assigned Groups |
|-------------|-------------------|--------------------|----|
| Dev | Origination API - Dev | Origination - Dev | Developer Admins, Dev Users |
| QA | Origination API - QA | Origination - QA | Developer Admins, QA Users |
| Prod | Origination API | Origination | Production Support, Prod Users |

All assigned users receive the `Origination.Application` App Role, which is the same across all environments.

## Troubleshooting

**"I can't deploy code to Dev"**
- Use your **admin account**, not your user account
- Verify your admin account is in **Developer Admins** group
- Wait 15-30 minutes after being added to a group (Entra ID sync delay)

**"I can't access the application"**
- Verify you're in the correct User group for the environment
- Sign out and back in to refresh your token
- Check you're accessing the correct URL: `https://origination-dev.scoular.com` (Dev), `https://origination-qa.scoular.com` (QA), `https://origination.scoular.com` (Prod)

**"I can't see Key Vault secrets"**
- Use your **admin account**
- Verify membership in the appropriate admin group for the environment

**Check your group memberships:** [myaccount.microsoft.com/groups](https://myaccount.microsoft.com/groups)

## Related Documentation

- **[ACCESS-PACKAGES-USER-GUIDE.md](ACCESS-PACKAGES-USER-GUIDE.md)** — How to request access via My Access portal
- **[APP-REGISTRATIONS.md](APP-REGISTRATIONS.md)** — App registration details and client IDs
- **[START-HERE.md](START-HERE.md)** — Infrastructure overview and getting started

---

*Document version: 1.1 | 2026-02-17*
