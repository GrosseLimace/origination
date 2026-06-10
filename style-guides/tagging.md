# Tagging Guide — Azure Resource Tagging Standard

**Version:** 0.1
**Date:** 2026-05-27
**Applies to:** All Azure resources (subscriptions, resource groups, and resource-level), authored by Bicep / ARM / Terraform or created in the portal
**Purpose:** Establish a single, organization-wide resource tagging standard so every Azure resource is consistently attributable (team, application, ownership), governable (lifecycle, review), and cost-traceable. Source of record: *Cloud Governance — Cloud-Based (Azure) Resource Tagging Standard* (`Team All IT/General/Cloud Governance/Tagging_Standards.docx`).

> **Related guides:**
>
> - Use `security.md` for data-classification handling and audit requirements.
> - Use `logging.md` for diagnostic/observability settings (separate from tags).

---

## 1. Required tags

The following tags are **required** at the indicated scope. A resource inherits applicable tags from its resource group unless it overrides them.

| Tag | Required at | Acceptable values / notes |
|---|---|---|
| `Environment` | Subscription and below | Subscription: `Prod` or `Non-Prod` only. Resource Group: `Dev`, `QA`, `UAT`, or `Prod`. |
| `Team` | Resource Group and below | The owning team, e.g. `Infrastructure`, `Automation`, `Data Integrations`. |
| `Application` | Resource Group and below | High-level at the RG (e.g. `Logic Apps`, `Storage Accounts`, `Power Apps`, `Analytics`); more specific at the resource (e.g. `Scout`, `CTRM`, `SQL`). For generic resources (`NetworkWatcherRG`, `dashboards`, `DefaultResourceGroups-XXX`) use `Azure-Generated`. A resource that spans multiple applications adds `Application2`, `Application3`, … |
| `DefaultCreatedBy` | Resource Group (resource-level default) | The default value applied to `CreatedBy` for resources created in this group. |
| `CreatedBy` | Resource-level | Who created the resource. Defaults to the resource group's `DefaultCreatedBy`; **must be populated manually** when it differs. |
| `CreationDate` | Resource-level | **Automatically populated by Azure Policy on creation** (`YYYY-MM-DD`). Do **not** set this in IaC — let the policy own it (see §4). |

## 2. Optional tags

| Tag | Acceptable values / notes |
|---|---|
| `LastReviewed` | Date of the last resource review by the owning team (`YYYY-MM-DD`). |
| `DeleteAfter` | For deprecated resources, the approximate review-for-deletion date (`YYYY-MM-DD`), or `TBD` if unknown. POC / Sandbox resources default to 3 or 6 months out. |
| `RefNumber` | A tracking reference, e.g. `INC0123456`, `CHG0306123`, `DevOps Task 1234`. |

## 3. Value conventions

- **Casing & format.** Tag *names* are PascalCase as written above. Dates are ISO `YYYY-MM-DD`.
- **`Environment` differs by scope.** Subscriptions carry only `Prod` / `Non-Prod`; resource groups and resources carry the specific lifecycle stage (`Dev` / `QA` / `UAT` / `Prod`).
- **`Team` vs `Application`.** `Team` is who owns/operates the resource; `Application` is what it serves. They are independent — the same team may own resources for several applications.
- **Multi-application resources.** When one resource genuinely backs more than one application, tag the primary in `Application` and add `Application2`, `Application3`, … rather than concatenating.
- **Generic / platform resources.** Use `Application = Azure-Generated` for resources Azure creates on your behalf.

## 4. Implementation notes

- **IaC owns `Environment`, `Team`, `Application`, `DefaultCreatedBy`, `CreatedBy`.** Set these in the template (Bicep/ARM/Terraform) at the resource-group and resource scope so every deployed resource is tagged at create time. A shared tags module (e.g. `bicep/shared/tags.bicep`) is the recommended single source.
- **Azure Policy owns `CreationDate`.** It is stamped on creation by policy; templates and pipelines must not set or overwrite it, to avoid fighting the policy assignment.
- **Inheritance.** Resource-group tags are not automatically inherited by resources in Azure; apply resource-level tags explicitly (or via an inheritance policy) so `Team` / `Application` / `CreatedBy` are present on the resource itself, not only the group.
- **Additional tags are allowed.** Teams may carry extra operational tags (e.g. `CostCenter`, `DataClassification`, `Workload`, `Owner`, `ManagedBy`, `Repository`) alongside the required set; this standard defines the *minimum*, not the maximum.

## 5. Compliance

- New resource groups and resources must carry all required tags for their scope before deployment is considered complete.
- Drift (missing or empty required tags) should be caught by Azure Policy audit/deny assignments at the subscription level. Where a repo's PR gate is extended to check tags, the rule will be authored as a machine-readable `rule` block in this guide (none today — this is a prose standard pending per-repo IaC adoption).
