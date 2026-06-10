# Enterprise Application Permissions Model

## Style Guide & Implementation Standard

**Role-Based Access Control (RBAC) Reference**
**For Application Developers & Claude Code**

**Scoular** | scoular.com

Version 1.0 | February 2025

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Core Concepts](#2-core-concepts)
3. [Standard Roles](#3-standard-roles)
4. [Permission Naming Convention](#4-permission-naming-convention)
5. [Data Model](#5-data-model)
6. [Enforcement Patterns](#6-enforcement-patterns)
7. [API Response Standards](#7-api-response-standards)
8. [Frontend Implementation Guidelines](#8-frontend-implementation-guidelines)
9. [Seeding & Migration Requirements](#9-seeding--migration-requirements)
10. [Audit Logging](#10-audit-logging)
11. [Testing Requirements](#11-testing-requirements)
12. [Instructions for Claude Code](#12-instructions-for-claude-code)
13. [Implementation Checklist](#13-implementation-checklist)
14. [Appendix A: Example Role-Permission Matrix](#appendix-a-example-role-permission-matrix)
15. [Appendix B: Version History](#appendix-b-version-history)

---

## 1. Purpose & Scope

This style guide establishes the standard approach for implementing role-based access control (RBAC) across all Scoular enterprise applications. It provides a consistent, reusable permissions model that every development team must follow, whether building new applications or refactoring existing ones.

### 1.1 Who This Guide Is For

- Scoular application developers (all experience levels) building enterprise software
- AI coding assistants (e.g., Claude Code) generating application scaffolding or features
- Architects reviewing application designs for security and access control compliance
- QA engineers validating that permissions are enforced correctly

### 1.2 Goals

1. Provide a single, consistent RBAC pattern across all Scoular enterprise applications
2. Reduce implementation errors by giving developers clear naming conventions, data models, and enforcement rules
3. Enable centralized auditability of who can do what across the organization
4. Make onboarding faster for developers moving between application teams

### 1.3 Scope

This guide covers application-level permissions only. Authentication (verifying who someone is) is handled by **Azure AD (Microsoft Entra ID)**, Scoular's identity provider. This guide addresses **authorization**: determining what an authenticated user is allowed to do within a given application.

> **⚠ Important Distinction**
> Authentication = Who are you? (handled by Azure AD). Authorization = What can you do? (handled by your application using this guide).

### 1.4 Technology Stack

Scoular enterprise applications are built on the following standard stack. All code examples and implementation patterns in this guide are specific to these technologies:

| Layer | Technology |
|-------|-----------|
| **Backend** | .NET (C#) — ASP.NET Core Web API |
| **Frontend** | Angular (TypeScript) |
| **Identity Provider** | Azure AD (Microsoft Entra ID) |
| **Database** | Azure SQL Database (Entity Framework Core for data access) |

---

## 2. Core Concepts

Before diving into implementation, all developers should understand the foundational terms and relationships in this model. These definitions are not optional — they are the shared vocabulary every application must use.

### 2.1 Terminology

| Term | Definition | Example |
|------|-----------|---------|
| **User** | An authenticated individual who interacts with the application. Identified by a unique ID from Azure AD. | jane.smith@scoular.com |
| **Role** | A named collection of permissions that represents a job function or responsibility level within the application. | Editor, Viewer, Admin |
| **Permission** | A specific, granular action that can be performed on a resource. Expressed as `resource:action`. | `reports:create`, `users:delete` |
| **Resource** | An entity or object within the application that permissions apply to. | reports, users, settings, dashboards |
| **Action** | An operation that can be performed on a resource. | create, read, update, delete, export |
| **Scope** | An optional boundary that limits where a permission applies (e.g., own data vs. all data, or a specific department). | own, team, department, global |

### 2.2 How It All Fits Together

The relationship chain is: Users are assigned to Roles. Roles contain Permissions. Permissions grant the ability to perform an Action on a Resource, optionally within a Scope.

> **📎 Visual Guide Available**
> For a full visual walkthrough of how RBAC works — including a hotel keycard analogy, color-coded flow diagrams, and step-by-step examples — see the companion file: **RBAC_Visual_Guide.html**. It is designed for anyone new to permissions and requires no technical background.

**The three layers in plain language:**

```
┌─────────────────┐       ┌─────────────────┐       ┌──────────────────────┐
│     USERS        │       │     ROLES        │       │    PERMISSIONS       │
│  (People)        │       │  (Job Functions)  │       │    (Actions)         │
│                  │       │                  │       │                      │
│  Jane Smith ─────┼──────▶│  Admin ──────────┼──────▶│  reports:create      │
│                  │       │                  │       │  reports:read:global  │
│                  │       │                  │       │  reports:delete       │
│                  │       │                  │       │  users:manage         │
│                  │       │                  │       │  settings:manage      │
│                  │       │                  │       │                      │
│  Bob Jones ──────┼──────▶│  Editor ─────────┼──────▶│  reports:create      │
│                  │       │                  │       │  reports:read:global  │
│                  │       │                  │       │  reports:update:own   │
│                  │       │                  │       │                      │
│  Sara Lee ───────┼──────▶│  Viewer ─────────┼──────▶│  reports:read:global │
└─────────────────┘       └─────────────────┘       └──────────────────────┘
```

**Reading the diagram:** Jane is assigned the Admin role, so she gets every permission. Bob is an Editor, so he can create, read, and edit his own reports — but not delete them. Sara is a Viewer, so she can only read. If Sara tries to create a report, the system checks her permissions, doesn't find `reports:create`, and denies the request.

**The key rule:** Permissions are never assigned directly to a person. They always flow through a role. This means you manage a handful of roles instead of hundreds of individual user assignments.

### 2.3 Design Principles

- **Least Privilege:** Users should receive only the minimum permissions required for their function. Start restrictive and grant access upward — never the reverse.
- **Deny by Default:** If a permission is not explicitly granted through a role, access is denied. There is no implicit access.
- **Separation of Duties:** High-risk actions (e.g., deleting users, modifying system settings) should require elevated roles and should be assigned sparingly.
- **Role-Based, Not User-Based:** Permissions are never assigned directly to individual users. They are always assigned via roles. No exceptions.
- **Auditability:** Every role assignment and permission check should be traceable. Log access decisions in production.

---

## 3. Standard Roles

Every Scoular enterprise application must implement the **Admin** base role. Beyond Admin, applications should define roles that align with their specific business functions and user needs. The following table shows Admin as the required base role, along with common roles that teams may adopt or adapt as needed.

### 3.1 Required Base Role

| Role Name | Description | Typical Permissions | Intended For |
|-----------|------------|-------------------|-------------|
| **Admin** | Full access to all resources and system configuration. Can manage users, roles, and application settings. | `*:*` (all actions on all resources) | IT administrators, app owners, system operators |

### 3.2 Common Role Examples

The following roles are **not required** but represent common patterns across enterprise applications. Use them as starting points when defining your application's role structure.

| Role Name | Description | Typical Permissions | Intended For |
|-----------|------------|-------------------|-------------|
| **Viewer** | Read-only access. Can view resources but cannot create, modify, or delete anything. | `*:read:own` or `*:read:global` depending on application context | Stakeholders, auditors, read-only consumers of data |
| **Editor** | Can create and modify resources they own or are assigned to. Cannot delete or manage users. | `*:create`, `*:read`, `*:update:own` | Day-to-day users who produce and manage content or data |
| **Manager** | Full CRUD on resources within their team or department. Can view team member activity. Cannot modify system-level settings. | `*:create`, `*:read`, `*:update:team`, `*:delete:team` | Team leads, department heads, people managers |

### 3.3 Custom Roles

When a base role does not adequately describe a function in your application, you may define custom roles. Custom roles must follow these rules:

1. Custom roles must be composed from existing permissions (`resource:action` format) — never invent ad-hoc permission strings.
2. Custom role names must use **PascalCase** and be descriptive: e.g., `ReportApprover`, `BillingAnalyst`, `ContentModerator`.
3. Custom roles must be documented in your application's README or internal wiki with a clear description and the full list of permissions they grant.
4. Custom roles must not duplicate the intent of a base role. If your custom role looks like Viewer with one extra permission, extend Viewer through role composition instead.

### 3.4 Role Composition & Hierarchy

Roles can inherit from other roles to reduce duplication. When using inheritance, follow a strict hierarchy where higher roles include all permissions of lower roles plus additional ones.

> **Recommended Hierarchy**
> If your application uses multiple roles, arrange them in a clear hierarchy where higher roles include all permissions of lower roles plus additional ones. For example: `Viewer ⊂ Editor ⊂ Manager ⊂ Admin`. The Admin role should always sit at the top with full access.

If your application supports role inheritance in code, implement it explicitly rather than duplicating permissions across role definitions. This makes maintenance easier and reduces the chance of drift.

---

## 4. Permission Naming Convention

Consistent permission naming is critical for readability, tooling, and cross-application reporting. Every permission string across every Scoular enterprise application must follow the format defined here.

### 4.1 Format

```
resource:action
resource:action:scope    (when scope is needed)
```

### 4.2 Rules

| Component | Rules | Examples |
|-----------|-------|---------|
| **Resource** | Lowercase, plural nouns. Use hyphens for multi-word names. Must correspond to a real entity in your application. | `reports`, `users`, `audit-logs`, `billing-accounts` |
| **Action** | Lowercase verbs from the standard action set (see below). Custom actions allowed only when standard set is insufficient. | `create`, `read`, `update`, `delete`, `export`, `approve` |
| **Scope** | Optional. Lowercase. Describes the boundary of access. When omitted, defaults to "global" for that permission. | `own`, `team`, `department`, `global` |

### 4.3 Standard Actions

Use these standard actions wherever possible. Only introduce custom actions when none of these fit your use case.

| Action | Description | Example Permission |
|--------|------------|-------------------|
| `create` | Create a new instance of the resource | `reports:create` |
| `read` | View or retrieve an existing resource | `reports:read:own` |
| `update` | Modify an existing resource | `reports:update:team` |
| `delete` | Remove a resource (soft or hard delete) | `users:delete` |
| `export` | Export or download resource data | `reports:export` |
| `approve` | Approve or sign off on a resource (workflows) | `invoices:approve` |
| `assign` | Assign a resource to a user or group | `tasks:assign:team` |
| `manage` | Administrative control over a resource type (configure, enable/disable) | `settings:manage` |

> **✘ Anti-Pattern: Avoid These**
> Never use permission strings like `canEditReports`, `isAdmin`, `hasAccess`, or `REPORT_WRITE`. These are not parseable, not consistent, and break cross-application tooling. Always use the `resource:action[:scope]` format.

---

## 5. Data Model

Every application must implement the following database schema using **Entity Framework Core** with **Azure SQL Database**. The entity classes and DbContext configuration should follow the patterns below. If your application uses a different ORM or data access approach, the logical structure must still match what is described here.

### 5.1 Required Tables / Collections

#### 5.1.1 `Roles`

| Column | C# Type / SQL Type | Constraints | Description |
|--------|-------------------|------------|-------------|
| `Id` | `Guid` / `UNIQUEIDENTIFIER` | PRIMARY KEY | Unique role identifier |
| `Name` | `string` / `NVARCHAR(100)` | UNIQUE, NOT NULL | PascalCase role name |
| `Description` | `string` / `NVARCHAR(MAX)` | NOT NULL | Human-readable description |
| `IsSystem` | `bool` / `BIT` | DEFAULT 0 | True for the Admin base role (cannot be deleted) |
| `ParentRoleId` | `Guid?` / `UNIQUEIDENTIFIER` | FK → Roles.Id, NULLABLE | For role hierarchy / inheritance |
| `CreatedAt` | `DateTime` / `DATETIME2` | NOT NULL | When the role was created |
| `UpdatedAt` | `DateTime` / `DATETIME2` | NOT NULL | Last modification timestamp |

#### 5.1.2 `Permissions`

| Column | C# Type / SQL Type | Constraints | Description |
|--------|-------------------|------------|-------------|
| `Id` | `Guid` / `UNIQUEIDENTIFIER` | PRIMARY KEY | Unique permission identifier |
| `Resource` | `string` / `NVARCHAR(100)` | NOT NULL | Lowercase plural noun |
| `Action` | `string` / `NVARCHAR(50)` | NOT NULL | Lowercase verb |
| `Scope` | `string` / `NVARCHAR(50)` | DEFAULT 'global' | own, team, department, global |
| `Description` | `string?` / `NVARCHAR(MAX)` | NULLABLE | Human-readable description |

#### 5.1.3 `RolePermissions` (join table)

| Column | C# Type / SQL Type | Constraints | Description |
|--------|-------------------|------------|-------------|
| `RoleId` | `Guid` / `UNIQUEIDENTIFIER` | FK → Roles.Id, NOT NULL | Role being granted the permission |
| `PermissionId` | `Guid` / `UNIQUEIDENTIFIER` | FK → Permissions.Id, NOT NULL | Permission being granted |

Composite primary key on (`RoleId`, `PermissionId`).

#### 5.1.4 `UserRoles` (join table)

| Column | C# Type / SQL Type | Constraints | Description |
|--------|-------------------|------------|-------------|
| `UserId` | `string` / `NVARCHAR(255)` | NOT NULL | User ID from Azure AD (Object ID or UPN) |
| `RoleId` | `Guid` / `UNIQUEIDENTIFIER` | FK → Roles.Id, NOT NULL | Role assigned to the user |
| `AssignedBy` | `string` / `NVARCHAR(255)` | NOT NULL | Who assigned this role |
| `AssignedAt` | `DateTime` / `DATETIME2` | NOT NULL | When the role was assigned |
| `ExpiresAt` | `DateTime?` / `DATETIME2` | NULLABLE | Optional expiration for temporary access |

Composite primary key on (`UserId`, `RoleId`).

#### 5.1.5 EF Core Entity Example

```csharp
public class Role
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public bool IsSystem { get; set; }
    public Guid? ParentRoleId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    // Navigation properties
    public Role? ParentRole { get; set; }
    public ICollection<RolePermission> RolePermissions { get; set; } = new List<RolePermission>();
    public ICollection<UserRole> UserRoles { get; set; } = new List<UserRole>();
}

public class Permission
{
    public Guid Id { get; set; }
    public string Resource { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string Scope { get; set; } = "global";
    public string? Description { get; set; }

    // Convenience property for the full permission string
    public string Key => string.IsNullOrEmpty(Scope) || Scope == "global"
        ? $"{Resource}:{Action}"
        : $"{Resource}:{Action}:{Scope}";

    public ICollection<RolePermission> RolePermissions { get; set; } = new List<RolePermission>();
}
```

> **ℹ Why Not Assign Permissions Directly to Users?**
> Direct user-to-permission mappings create unmanageable complexity at scale. If 500 users each have 20 individually assigned permissions, that is 10,000 individual assignments to audit and manage. With roles, you manage 4–10 role definitions and assign users to them. Changes to a role automatically propagate to all users with that role.

---

## 6. Enforcement Patterns

Defining roles and permissions is only half the job. Your application must actively enforce permissions at every layer. This section defines where and how to check permissions.

### 6.1 Enforcement Layers

Every application must enforce permissions at a minimum of two layers. Relying on a single layer creates risk if that layer is bypassed.

| Layer | What It Does | Implementation |
|-------|-------------|---------------|
| **UI / Frontend (Angular)** | Hides or disables controls the user lacks permission for. This is a UX convenience only — it is NOT a security boundary. | Use an Angular `PermissionsService`, structural directives (e.g., `*appHasPermission`), and route guards to conditionally render components and protect routes. |
| **API / Backend (ASP.NET Core)** | The authoritative enforcement point. Every API endpoint must check the caller's permissions before executing the requested action. This is the security boundary. | Use a custom `[RequirePermission("resource:action")]` authorization attribute backed by an `IAuthorizationHandler` that resolves the user's roles → permissions. |
| **Data / Query (EF Core)** | Filters data results based on scope. Ensures users with "own" scope only see their records, "team" scope only sees team records, etc. | Apply global query filters or use a scoped repository pattern that automatically adds `WHERE` clauses based on the user's permission scope. |

> **✘ Critical Rule**
> Never rely solely on the frontend to enforce permissions. A user can bypass UI restrictions using browser dev tools or direct API calls. The backend must ALWAYS validate permissions independently.

### 6.2 Authorization Attribute Pattern (ASP.NET Core)

Implement a custom authorization attribute and handler that runs before your controller action. The attribute accepts the required permission string and the handler checks it against the authenticated user's resolved permissions.

**Custom attribute:**

```csharp
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public class RequirePermissionAttribute : AuthorizeAttribute, IAuthorizationRequirement
{
    public string Permission { get; }

    public RequirePermissionAttribute(string permission)
    {
        Permission = permission;
        Policy = $"Permission:{permission}";
    }
}
```

**Authorization handler:**

```csharp
public class PermissionAuthorizationHandler : AuthorizationHandler<RequirePermissionAttribute>
{
    private readonly IPermissionService _permissionService;

    public PermissionAuthorizationHandler(IPermissionService permissionService)
    {
        _permissionService = permissionService;
    }

    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        RequirePermissionAttribute requirement)
    {
        var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userId == null) return;

        var permissions = await _permissionService.GetUserPermissionsAsync(userId);
        if (permissions.Contains(requirement.Permission))
        {
            context.Succeed(requirement);
        }
    }
}
```

**Usage on a controller:**

```csharp
[ApiController]
[Route("api/[controller]")]
public class ReportsController : ControllerBase
{
    [HttpPost]
    [RequirePermission("reports:create")]
    public async Task<IActionResult> Create(CreateReportRequest request) { ... }

    [HttpDelete("{id}")]
    [RequirePermission("reports:delete")]
    public async Task<IActionResult> Delete(Guid id) { ... }

    [HttpGet]
    [RequirePermission("reports:read")]
    public async Task<IActionResult> GetAll() { ... }
}
```

### 6.3 Permission Resolution

When a user makes a request, the system must resolve their effective permissions by collecting all permissions from all roles assigned to that user (including inherited permissions from parent roles). The resolution steps are:

1. Look up all roles assigned to the user (`UserRoles` table).
2. For each role, collect all direct permissions (`RolePermissions` table).
3. For each role, traverse `ParentRoleId` to collect inherited permissions.
4. Merge all permissions into a deduplicated `HashSet<string>`.
5. Check the required permission against this set.

**Permission service example:**

```csharp
public interface IPermissionService
{
    Task<HashSet<string>> GetUserPermissionsAsync(string userId);
}

public class PermissionService : IPermissionService
{
    private readonly AppDbContext _db;
    private readonly IMemoryCache _cache;

    public PermissionService(AppDbContext db, IMemoryCache cache)
    {
        _db = db;
        _cache = cache;
    }

    public async Task<HashSet<string>> GetUserPermissionsAsync(string userId)
    {
        var cacheKey = $"permissions:{userId}";
        if (_cache.TryGetValue(cacheKey, out HashSet<string>? cached))
            return cached!;

        var roleIds = await _db.UserRoles
            .Where(ur => ur.UserId == userId
                && (ur.ExpiresAt == null || ur.ExpiresAt > DateTime.UtcNow))
            .Select(ur => ur.RoleId)
            .ToListAsync();

        // Include inherited roles via parent hierarchy
        var allRoleIds = await ResolveRoleHierarchyAsync(roleIds);

        var permissions = await _db.RolePermissions
            .Where(rp => allRoleIds.Contains(rp.RoleId))
            .Select(rp => rp.Permission.Key)
            .Distinct()
            .ToListAsync();

        var result = new HashSet<string>(permissions);
        _cache.Set(cacheKey, result, TimeSpan.FromMinutes(15));
        return result;
    }
}
```

Use `IMemoryCache` for single-instance deployments or `IDistributedCache` with **Azure Cache for Redis** for multi-instance deployments to cache resolved permissions per user. Invalidate the cache when role assignments or role definitions change.

**Register in `Program.cs`:**

```csharp
builder.Services.AddMemoryCache();
builder.Services.AddScoped<IPermissionService, PermissionService>();
builder.Services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();
```

### 6.4 Scope Enforcement

When a permission includes a scope, the application must filter data accordingly at the query level. Here is how each scope should be handled:

| Scope | Behavior |
|-------|---------|
| `own` | Filter results to only records where `owner_id` (or `created_by`) matches the authenticated user's ID. |
| `team` | Filter results to records owned by any member of the user's team. Requires a team membership lookup (can leverage Azure AD security groups). |
| `department` | Filter results to records within the user's department. Requires department assignment data (can be sourced from Azure AD user attributes). |
| `global` | No filtering applied. User can access all records of this resource type. |

---

## 7. API Response Standards

All applications must follow consistent patterns for how permissions information is communicated through API responses, particularly for unauthorized access and for conveying the current user's permissions to frontend clients.

### 7.1 Error Responses

| HTTP Status | When to Use | Response Body |
|------------|-------------|--------------|
| `401` | User is not authenticated (no valid session/token). | `{ "error": "Unauthorized", "message": "Authentication required" }` |
| `403` | User is authenticated but lacks the required permission. | `{ "error": "Forbidden", "message": "Insufficient permissions", "required": "reports:delete" }` |

> **⚠ Security Note**
> In the 403 response, include the required permission string to help developers debug, but never expose the full list of the user's current permissions in error responses. That information should only be available through a dedicated permissions endpoint.

### 7.2 Current User Permissions Endpoint

Every application must expose an endpoint that returns the authenticated user's resolved roles and permissions. This endpoint is used by frontend applications to determine what UI elements to display.

```json
GET /api/me/permissions

{
  "user_id": "jane.smith@scoular.com",
  "roles": ["Editor", "ReportApprover"],
  "permissions": [
    "reports:create",
    "reports:read:global",
    "reports:update:own",
    "reports:approve",
    "dashboards:read:global"
  ]
}
```

---

## 8. Frontend Implementation Guidelines (Angular)

The Angular frontend should use the permissions data from the `/api/me/permissions` endpoint to control UI visibility. This section defines the expected patterns.

### 8.1 Permissions Service

Every Angular application must implement a centralized `PermissionsService`. Do not scatter inline permission logic throughout your components.

```typescript
// permissions.service.ts
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private permissions = new Set<string>();
  private roles: string[] = [];

  constructor(private http: HttpClient) {}

  /** Call once on app initialization or after login */
  loadPermissions(): Observable<void> {
    return this.http.get<PermissionsResponse>('/api/me/permissions').pipe(
      tap(response => {
        this.roles = response.roles;
        this.permissions = new Set(response.permissions);
      }),
      map(() => void 0)
    );
  }

  /** Check if the current user has a specific permission */
  hasPermission(permission: string): boolean {
    return this.permissions.has(permission);
  }

  /** Check if the current user has ANY of the given permissions */
  hasAnyPermission(permissions: string[]): boolean {
    return permissions.some(p => this.permissions.has(p));
  }

  /** Force reload (call after role changes) */
  refresh(): Observable<void> {
    return this.loadPermissions();
  }
}
```

### 8.2 Structural Directive

Create a reusable `*appHasPermission` directive to conditionally render elements in templates:

```typescript
// has-permission.directive.ts
@Directive({ selector: '[appHasPermission]' })
export class HasPermissionDirective implements OnInit {
  @Input('appHasPermission') permission: string = '';

  constructor(
    private templateRef: TemplateRef<any>,
    private viewContainer: ViewContainerRef,
    private permissionsService: PermissionsService
  ) {}

  ngOnInit(): void {
    if (this.permissionsService.hasPermission(this.permission)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    } else {
      this.viewContainer.clear();
    }
  }
}
```

**Usage in templates:**

```html
<!-- Button only renders if user has reports:create permission -->
<button *appHasPermission="'reports:create'" (click)="createReport()">
  New Report
</button>

<!-- Entire section hidden without reports:delete -->
<div *appHasPermission="'reports:delete'">
  <button (click)="deleteReport(report.id)">Delete</button>
</div>
```

### 8.3 Route Guard

Protect Angular routes using a permission-based `CanActivate` guard:

```typescript
// permission.guard.ts
export const permissionGuard = (requiredPermission: string): CanActivateFn => {
  return () => {
    const permissionsService = inject(PermissionsService);
    const router = inject(Router);

    if (permissionsService.hasPermission(requiredPermission)) {
      return true;
    }
    return router.createUrlTree(['/access-denied']);
  };
};

// In your routing module:
{
  path: 'admin/settings',
  component: SettingsComponent,
  canActivate: [permissionGuard('settings:manage')]
}
```

### 8.4 UI Rules

- **Hide, don't just disable.** Use the `*appHasPermission` directive to remove controls entirely rather than showing grayed-out buttons. This reduces confusion.
- **Route guards.** Protect entire pages/routes that require specific permissions. Redirect unauthorized users to a friendly "Access Denied" page, not a blank screen.
- **Load permissions on app init.** Call `PermissionsService.loadPermissions()` in your `APP_INITIALIZER` so permissions are available before any component renders.
- **Refresh on role change.** If the application supports mid-session role changes (e.g., an admin upgrades someone), call `PermissionsService.refresh()`.

---

## 9. Seeding & Migration Requirements

Every application must include an **EF Core migration and seed** that creates the base roles and their default permissions on first deployment. This ensures consistency and prevents manual configuration errors.

### 9.1 Required Seed Data

Your seed should be implemented in an EF Core migration or in `OnModelCreating` using `HasData`. It must create:

1. The **Admin** base role with `IsSystem = true`. Additional application-specific roles should also be seeded.
2. All permissions relevant to your application's resources using the `resource:action[:scope]` format.
3. The `RolePermissions` mappings that connect each role to its permissions. Admin should receive all permissions.

**Example seed in a migration:**

```csharp
public partial class SeedRolesAndPermissions : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        var adminRoleId = Guid.NewGuid();

        migrationBuilder.InsertData(
            table: "Roles",
            columns: new[] { "Id", "Name", "Description", "IsSystem", "CreatedAt", "UpdatedAt" },
            values: new object[] { adminRoleId, "Admin",
                "Full access to all resources and system configuration",
                true, DateTime.UtcNow, DateTime.UtcNow });

        // Seed permissions and role_permissions...
    }
}
```

### 9.2 Migration Guidelines

- **Additive only.** Never remove a permission from a base role in a migration. If a permission needs to be removed, create a new migration that explicitly documents why.
- **Idempotent.** Seed logic must be safe to run multiple times. Use EF Core's `HasData` (which handles upserts) or add existence checks in raw SQL migrations.
- **Version controlled.** All migrations must be committed to your application's source repository and applied via `dotnet ef database update` in your CI/CD pipeline — never applied manually to Azure SQL databases.

---

## 10. Audit Logging

Every permission-related action must be logged for compliance and troubleshooting. This is not optional. Use the built-in `ILogger<T>` with **structured logging** so audit events can be queried and analyzed.

### 10.1 Events to Log

| Event | When | What to Capture |
|-------|------|----------------|
| `role_assigned` | A role is assigned to a user | user_id, role_id, assigned_by, timestamp |
| `role_removed` | A role is removed from a user | user_id, role_id, removed_by, timestamp |
| `permission_denied` | A permission check fails (403) | user_id, requested_permission, endpoint, timestamp |
| `role_modified` | Permissions within a role are changed | role_id, changes (added/removed permissions), modified_by, timestamp |
| `privilege_escalation` | A user is elevated to Admin or Manager | user_id, new_role, elevated_by, timestamp, justification |

### 10.2 Log Format

Use `ILogger` with structured log templates so fields are captured as queryable properties. At a minimum, every audit log entry must include: `EventType`, `Timestamp` (ISO 8601), `ActorId` (who performed the action), `TargetId` (who/what was affected), and `Details` (event-specific data).

**Example using ILogger:**

```csharp
_logger.LogInformation(
    "PermissionDenied: {EventType} | User {ActorId} denied {Permission} on {Endpoint} at {Timestamp}",
    "permission_denied",
    userId,
    requiredPermission,
    httpContext.Request.Path,
    DateTime.UtcNow.ToString("o"));
```

For production applications, consider using **Serilog** with **Azure Application Insights** as the primary sink to make audit logs searchable and alertable within the Azure ecosystem.

---

## 11. Testing Requirements

Permissions logic must be covered by automated tests. Untested permissions are effectively unenforceable.

### 11.1 Required Test Cases

For every protected endpoint in your application, you must have tests for the following scenarios:

| Scenario | Expected Outcome |
|----------|-----------------|
| Unauthenticated request | Returns 401 Unauthorized |
| Authenticated, insufficient permissions | Returns 403 Forbidden with the required permission in the response |
| Authenticated, correct permissions | Returns expected success response (200, 201, etc.) |
| Scope enforcement (own) | User can only access their own records; returns 403 or empty set for others' records |
| Scope enforcement (team) | User can access team records but not other teams' records |
| Role hierarchy | Higher-privilege roles can perform lower-privilege actions; lower-privilege roles cannot escalate |

### 11.2 Test Organization

**Backend (C# / xUnit):** Group permission tests into a dedicated test class (e.g., `PermissionsTests.cs`). Use `WebApplicationFactory<Program>` for integration tests that verify the full authorization pipeline. Mock `IPermissionService` for unit tests of individual handlers.

```csharp
public class ReportsPermissionsTests : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task CreateReport_WithoutPermission_Returns403()
    {
        // Arrange: authenticate as a user WITHOUT reports:create
        // Act: POST /api/reports
        // Assert: response.StatusCode == HttpStatusCode.Forbidden
    }

    [Fact]
    public async Task CreateReport_WithPermission_Returns201()
    {
        // Arrange: authenticate as a user WITH reports:create
        // Act: POST /api/reports
        // Assert: response.StatusCode == HttpStatusCode.Created
    }
}
```

**Frontend (Angular / Jasmine):** Test the `PermissionsService`, `HasPermissionDirective`, and route guards in dedicated spec files. Verify that components correctly hide/show elements based on permissions.

```typescript
describe('HasPermissionDirective', () => {
  it('should render element when user has permission', () => {
    permissionsService.hasPermission.and.returnValue(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeTruthy();
  });

  it('should NOT render element when user lacks permission', () => {
    permissionsService.hasPermission.and.returnValue(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
});
```

---

## 12. Instructions for Claude Code

This section provides direct instructions for Claude Code (or any AI coding assistant) when generating application code that involves user permissions. Scoular applications use **.NET (C#) with ASP.NET Core** on the backend and **Angular (TypeScript)** on the frontend. When this style guide is referenced, Claude Code should follow these rules exactly.

### 12.1 When Generating a New Application

1. Create EF Core entity classes for `Role`, `Permission`, `RolePermission`, and `UserRole` as defined in Section 5, along with a `DbContext` configuration with proper relationships and composite keys.
2. Create an EF Core migration that seeds the **Admin** base role with `IsSystem = true`, plus any application-specific roles.
3. Generate permissions using the `resource:action[:scope]` naming convention for every resource in the application.
4. Map permissions to roles appropriately. Admin should receive all permissions (`*:*`). Other roles should follow least-privilege principles.
5. Implement `IPermissionService` with `IMemoryCache` for resolving and caching user permissions (see Section 6.3).
6. Implement a `[RequirePermission]` authorization attribute and `IAuthorizationHandler` (see Section 6.2).
7. Apply `[RequirePermission("resource:action")]` to every controller action. No endpoint should be unprotected.
8. Create a `GET /api/me/permissions` endpoint that returns the authenticated user's roles and resolved permission strings.
9. Create an Angular `PermissionsService`, `*appHasPermission` directive, and `permissionGuard` (see Section 8).
10. Register `PermissionsService.loadPermissions()` in an `APP_INITIALIZER` so permissions are available before routing.
11. Add structured audit logging using `ILogger` for the events listed in Section 10.

### 12.2 When Adding Features to an Existing Application

1. Check if the application already has the RBAC entities, `IPermissionService`, and `[RequirePermission]` attribute. If not, create them.
2. For each new resource, define permissions in `resource:action[:scope]` format.
3. Add the new permissions to the appropriate roles via a new EF Core migration.
4. Apply `[RequirePermission]` to all new controller actions.
5. Update the Angular frontend to use `*appHasPermission` on new controls and add `permissionGuard` to new routes.
6. Add xUnit permission tests for the new endpoints and Jasmine tests for new Angular components.

### 12.3 Things Claude Code Must Never Do

- **Never** assign permissions directly to users — always use roles.
- **Never** use permission strings like `canEdit`, `isAdmin`, or `WRITE_ACCESS` — always use `resource:action[:scope]`.
- **Never** create a controller action without applying `[RequirePermission]`.
- **Never** rely on Angular-only permission checks without ASP.NET Core backend enforcement.
- **Never** hard-code role names in business logic (e.g., `if (user.Role == "Admin")`). Always check permissions, not roles.
- **Never** use `[Authorize(Roles = "Admin")]` from ASP.NET Core's built-in role checks — always use the custom `[RequirePermission]` attribute that checks against the application's permission model.

> **ℹ Claude Code Quick Reference**
> Stack: ASP.NET Core + Angular | Permission format: `resource:action[:scope]` | Backend: `[RequirePermission]` attribute + `IPermissionService` | Frontend: `PermissionsService` + `*appHasPermission` directive + `permissionGuard` | Always log with `ILogger` | Test with xUnit (backend) and Jasmine (frontend)

---

## 13. Implementation Checklist

Use this checklist before submitting your application for review. Every item must be completed.

### 13.1 Data Model

- [ ] EF Core entities exist for `Role`, `Permission`, `RolePermission`, and `UserRole` with proper relationships
- [ ] `Permissions` entity includes `Resource`, `Action`, and `Scope` columns
- [ ] Composite keys configured for `RolePermissions` and `UserRoles` in `OnModelCreating`
- [ ] `UserRoles` includes `AssignedBy` and `AssignedAt` columns
- [ ] **Admin** base role is seeded with `IsSystem = true` via EF Core migration
- [ ] Application-specific roles are seeded with appropriate permissions
- [ ] Seed migration is idempotent and committed to source control

### 13.2 Permission Naming

- [ ] All permissions follow `resource:action[:scope]` format
- [ ] Resources are lowercase, plural nouns
- [ ] Actions are from the standard set (or documented custom actions)
- [ ] No legacy naming patterns (camelCase, UPPER_SNAKE, boolean-style)

### 13.3 Backend Enforcement (ASP.NET Core)

- [ ] `IPermissionService` is implemented with caching (`IMemoryCache` or `IDistributedCache` with Azure Cache for Redis)
- [ ] `[RequirePermission]` attribute and `IAuthorizationHandler` are implemented
- [ ] Every controller action has `[RequirePermission("resource:action")]` applied
- [ ] Scope filtering is implemented at the EF Core query layer
- [ ] `GET /api/me/permissions` endpoint exists and returns roles + resolved permissions
- [ ] Services registered in `Program.cs` (PermissionService, AuthorizationHandler, MemoryCache)

### 13.4 Frontend Enforcement (Angular)

- [ ] `PermissionsService` is implemented and loaded via `APP_INITIALIZER`
- [ ] `*appHasPermission` structural directive is implemented and used on all permission-gated elements
- [ ] `permissionGuard` is applied to all protected routes
- [ ] Frontend hides (not just disables) unauthorized controls
- [ ] Access Denied page exists for unauthorized route access

### 13.5 Audit & Testing

- [ ] Audit logging captures: `role_assigned`, `role_removed`, `permission_denied`, `role_modified`, `privilege_escalation`
- [ ] Logs use `ILogger` with structured templates (or Serilog equivalent)
- [ ] xUnit integration tests exist for every protected controller action (401, 403, success, scope)
- [ ] Jasmine/Karma tests exist for `PermissionsService`, `HasPermissionDirective`, and `permissionGuard`

---

## Appendix A: Example Role-Permission Matrix

The following matrix shows a sample mapping for a typical application with reports, users, and settings resources. The Viewer, Editor, and Manager roles shown here are **examples** — your application should define roles that fit its specific needs. Admin is the only required role. Use this as a template when defining your own application's permissions.

| Permission | Viewer | Editor | Manager | Admin |
|-----------|--------|--------|---------|-------|
| `reports:read:own` | ✓ | ✓ | ✓ | ✓ |
| `reports:read:global` | — | — | ✓ | ✓ |
| `reports:create` | — | ✓ | ✓ | ✓ |
| `reports:update:own` | — | ✓ | ✓ | ✓ |
| `reports:update:team` | — | — | ✓ | ✓ |
| `reports:delete:team` | — | — | ✓ | ✓ |
| `reports:export` | — | ✓ | ✓ | ✓ |
| `users:read` | — | — | ✓ | ✓ |
| `users:create` | — | — | — | ✓ |
| `users:update` | — | — | — | ✓ |
| `users:delete` | — | — | — | ✓ |
| `settings:manage` | — | — | — | ✓ |

---

## Appendix B: Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | February 2025 | Scoular Technology Team | Initial release |
| 1.1 | February 2025 | Scoular Technology Team | Updated for .NET (C#) / Angular stack with implementation examples |
