using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// The access tables (plan §4.3). <c>dbo.Permissions</c> is seeded from <c>AppPermissions</c> through
    /// <c>HasData</c>. Roles and grants are data, seeded below: five roles, and today's access split between
    /// them (plan §7.1 and §7.3). <c>dbo.RolePermissions</c> and <c>dbo.RoleSegments</c> are SQL temporal tables.
    /// <para>Until the entitlements app issues persona roles, a user gets <c>Originator</c> + <c>Editor</c>, which
    /// is what a non-admin can do today. <c>Admin</c> holds everything, which is what today's Super Users have.
    /// Nothing checks these grants yet: the API starts enforcing them in Phase 2.</para>
    /// </summary>
    public partial class AddAccessGrants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Permissions",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Resource = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Action = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Scope = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    ModuleId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Permissions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Roles",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    IsSystem = table.Column<bool>(type: "bit", nullable: false),
                    ParentRoleId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Roles", x => x.Id);
                    table.CheckConstraint("CK_Roles_Kind", "[Kind] IN ('Persona', 'AddOn', 'Base')");
                    table.ForeignKey(
                        name: "FK_Roles_Roles_ParentRoleId",
                        column: x => x.ParentRoleId,
                        principalSchema: "dbo",
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RolePermissions",
                schema: "dbo",
                columns: table => new
                {
                    RoleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PermissionId = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    GrantedBy = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    GrantedAt = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    ValidFrom = table.Column<DateTime>(type: "datetime2", nullable: false)
                        .Annotation("SqlServer:TemporalIsPeriodStartColumn", true),
                    ValidTo = table.Column<DateTime>(type: "datetime2", nullable: false)
                        .Annotation("SqlServer:TemporalIsPeriodEndColumn", true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RolePermissions", x => new { x.RoleId, x.PermissionId });
                    table.ForeignKey(
                        name: "FK_RolePermissions_Permissions_PermissionId",
                        column: x => x.PermissionId,
                        principalSchema: "dbo",
                        principalTable: "Permissions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RolePermissions_Roles_RoleId",
                        column: x => x.RoleId,
                        principalSchema: "dbo",
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("SqlServer:IsTemporal", true)
                .Annotation("SqlServer:TemporalHistoryTableName", "RolePermissionsHistory")
                .Annotation("SqlServer:TemporalHistoryTableSchema", "dbo")
                .Annotation("SqlServer:TemporalPeriodEndColumnName", "ValidTo")
                .Annotation("SqlServer:TemporalPeriodStartColumnName", "ValidFrom");

            migrationBuilder.CreateTable(
                name: "RoleSegments",
                schema: "dbo",
                columns: table => new
                {
                    RoleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Segment = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    GrantedBy = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    GrantedAt = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    ValidFrom = table.Column<DateTime>(type: "datetime2", nullable: false)
                        .Annotation("SqlServer:TemporalIsPeriodStartColumn", true),
                    ValidTo = table.Column<DateTime>(type: "datetime2", nullable: false)
                        .Annotation("SqlServer:TemporalIsPeriodEndColumn", true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoleSegments", x => new { x.RoleId, x.Segment });
                    table.ForeignKey(
                        name: "FK_RoleSegments_Roles_RoleId",
                        column: x => x.RoleId,
                        principalSchema: "dbo",
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("SqlServer:IsTemporal", true)
                .Annotation("SqlServer:TemporalHistoryTableName", "RoleSegmentsHistory")
                .Annotation("SqlServer:TemporalHistoryTableSchema", "dbo")
                .Annotation("SqlServer:TemporalPeriodEndColumnName", "ValidTo")
                .Annotation("SqlServer:TemporalPeriodStartColumnName", "ValidFrom");

            migrationBuilder.InsertData(
                schema: "dbo",
                table: "Permissions",
                columns: new[] { "Id", "Action", "Description", "ModuleId", "Resource", "Scope" },
                values: new object[,]
                {
                    { "bid-feed:manage", "manage", null, "bid-sheet", "bid-feed", "global" },
                    { "bid-feed:read", "read", null, "bid-sheet", "bid-feed", "global" },
                    { "bid-sheet-locations:delete:global", "delete", null, "bid-sheet", "bid-sheet-locations", "global" },
                    { "bid-sheets:read", "read", null, "bid-sheet", "bid-sheets", "global" },
                    { "bid-sheets:write", "write", null, "bid-sheet", "bid-sheets", "global" },
                    { "carbon-intensity:read", "read", null, "producers", "carbon-intensity", "global" },
                    { "contract-pacing:read", "read", null, "producers", "contract-pacing", "global" },
                    { "contracts:read", "read", null, "contracts", "contracts", "global" },
                    { "customer-sync:manage", "manage", null, "customers", "customer-sync", "global" },
                    { "customers:read", "read", null, "customers", "customers", "global" },
                    { "customers:write", "write", null, "customers", "customers", "global" },
                    { "diagnostics:manage", "manage", null, "platform", "diagnostics", "global" },
                    { "diagnostics:read", "read", null, "platform", "diagnostics", "global" },
                    { "dp-contracts:read", "read", null, "producers", "dp-contracts", "global" },
                    { "field-plans:read", "read", null, "producers", "field-plans", "global" },
                    { "field-plans:write", "write", null, "producers", "field-plans", "global" },
                    { "notes:read", "read", null, "engagement", "notes", "global" },
                    { "notes:write", "write", null, "engagement", "notes", "global" },
                    { "planting-estimates:read", "read", null, "producers", "planting-estimates", "global" },
                    { "planting-estimates:write", "write", null, "producers", "planting-estimates", "global" },
                    { "planting-intentions:read", "read", null, "producers", "planting-intentions", "global" },
                    { "planting-intentions:write", "write", null, "producers", "planting-intentions", "global" },
                    { "preferences:read:own", "read", null, "platform", "preferences", "own" },
                    { "preferences:write:own", "write", null, "platform", "preferences", "own" },
                    { "producer-details:read", "read", null, "producers", "producer-details", "global" },
                    { "producer-details:write", "write", null, "producers", "producer-details", "global" },
                    { "query-library:read", "read", null, "lists", "query-library", "global" },
                    { "recap-groups:read", "read", null, "engagement", "recap-groups", "global" },
                    { "recap-groups:write", "write", null, "engagement", "recap-groups", "global" },
                    { "reference-data:read", "read", null, "platform", "reference-data", "global" },
                    { "reminders:read:own", "read", null, "engagement", "reminders", "own" },
                    { "reminders:write:own", "write", null, "engagement", "reminders", "own" },
                    { "roles:manage", "manage", null, "platform", "roles", "global" },
                    { "saved-lists:read:own", "read", null, "lists", "saved-lists", "own" },
                    { "saved-lists:read:team", "read", null, "lists", "saved-lists", "team" },
                    { "saved-lists:write:own", "write", null, "lists", "saved-lists", "own" },
                    { "saved-lists:write:team", "write", null, "lists", "saved-lists", "team" },
                    { "stored-grain:read", "read", null, "producers", "stored-grain", "global" },
                    { "teams-channels:read", "read", null, "engagement", "teams-channels", "global" },
                    { "tickets:read", "read", null, "contracts", "tickets", "global" },
                    { "usage-exclusions:manage", "manage", null, "usage-analytics", "usage-exclusions", "global" },
                    { "usage-reports:read", "read", null, "usage-analytics", "usage-reports", "global" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_RolePermissions_PermissionId",
                schema: "dbo",
                table: "RolePermissions",
                column: "PermissionId");

            migrationBuilder.CreateIndex(
                name: "IX_Roles_Name",
                schema: "dbo",
                table: "Roles",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Roles_ParentRoleId",
                schema: "dbo",
                table: "Roles",
                column: "ParentRoleId");

            SeedRolesAndGrants(migrationBuilder);
        }

        // ---------------------------------------------------------------------------------------------
        // The first roles and grants. Roles are data, so these literals are the only place their ids and
        // names appear. Permission strings are literals too, not AppPermissions constants: a migration is
        // a snapshot and must insert the same rows after the catalog changes. AccessSeedTests replays every
        // migration and checks the result.
        // ---------------------------------------------------------------------------------------------
        private const string SeededBy = "migration:AddAccessGrants";

        private static readonly Guid Admin = new("1826864d-58d6-45b0-877e-1be18da7c3cd");
        private static readonly Guid Originator = new("18041e71-c0da-473e-b61b-b1d0f2dcb4bf");
        private static readonly Guid Support = new("c42dc66f-74e2-44a6-9d9c-6a0cd0440df5");
        private static readonly Guid Editor = new("24faf940-89ec-4d6b-894c-818d346d52ee");
        private static readonly Guid Manager = new("f95d66ba-eb0e-4614-bbe1-00d5bde2c005");

        // The reads of every module originators use.
        private static readonly string[] OriginatorReads =
        [
            "preferences:read:own", "reference-data:read",
            "customers:read",
            "contracts:read", "tickets:read",
            "notes:read", "reminders:read:own", "teams-channels:read", "recap-groups:read",
            "planting-intentions:read", "producer-details:read", "stored-grain:read", "dp-contracts:read",
            "contract-pacing:read", "planting-estimates:read", "field-plans:read", "carbon-intensity:read",
            "saved-lists:read:own", "query-library:read",
            "bid-sheets:read", "bid-feed:read",
        ];

        // The reads only managers and IT use.
        private static readonly string[] OversightReads = ["diagnostics:read", "saved-lists:read:team", "usage-reports:read"];

        // Personal writes stay with the persona roles, so a read-only user keeps them (Q9).
        private static readonly string[] PersonalWrites = ["preferences:write:own", "reminders:write:own", "saved-lists:write:own"];

        // Every shared business-data write.
        private static readonly string[] EditorWrites =
        [
            "customers:write", "notes:write", "recap-groups:write",
            "planting-intentions:write", "producer-details:write", "planting-estimates:write", "field-plans:write",
            "bid-sheets:write",
        ];

        private static readonly string[] ManagerGrants =
            ["usage-reports:read", "saved-lists:read:team", "saved-lists:write:team", "bid-sheet-locations:delete:global"];

        // IT's operational powers: not business-data writes, so Support holds them in production too.
        private static readonly string[] OperationalPowers =
            ["diagnostics:manage", "customer-sync:manage", "usage-exclusions:manage", "bid-feed:manage", "roles:manage"];

        private static void SeedRolesAndGrants(MigrationBuilder migrationBuilder)
        {
            // CreatedAt and UpdatedAt take the database default.
            migrationBuilder.InsertData(
                table: "Roles",
                schema: "dbo",
                columns: ["Id", "Name", "Kind", "IsSystem", "Description"],
                values: new object[,]
                {
                    { Admin, "Admin", "Base", true,
                        "Base role: every permission and every segment. In production, held only by a break-glass account." },
                    { Originator, "Originator", "Persona", false,
                        "Persona: the reads originators use, personal writes, and Producer customers." },
                    { Support, "Support", "Persona", false,
                        "Persona for IT: every read, personal writes and IT's operational powers, but no business-data writes." },
                    { Editor, "Editor", "AddOn", false,
                        "Add-on: every shared business-data write, where the holder's persona lets them read." },
                    { Manager, "Manager", "AddOn", false,
                        "Add-on: the usage dashboard, team saved lists, and deleting other people's bid-sheet locations." },
                });

            var grants = new List<(Guid Role, string Permission)>();
            void Grant(Guid role, IEnumerable<string> permissions) => grants.AddRange(permissions.Distinct().Select(p => (role, p)));

            Grant(Originator, OriginatorReads.Concat(PersonalWrites));
            Grant(Editor, EditorWrites);
            Grant(Manager, ManagerGrants);
            Grant(Support, OriginatorReads.Concat(OversightReads).Concat(PersonalWrites).Concat(OperationalPowers));
            Grant(Admin, OriginatorReads.Concat(OversightReads).Concat(PersonalWrites).Concat(EditorWrites)
                .Concat(ManagerGrants).Concat(OperationalPowers));

            var permissionRows = new object[grants.Count, 3];
            for (var i = 0; i < grants.Count; i++)
            {
                permissionRows[i, 0] = grants[i].Role;
                permissionRows[i, 1] = grants[i].Permission;
                permissionRows[i, 2] = SeededBy;
            }

            migrationBuilder.InsertData(
                table: "RolePermissions",
                schema: "dbo",
                columns: ["RoleId", "PermissionId", "GrantedBy"],
                values: permissionRows);

            // Originator sees producers. Support and Admin see every segment. Add-on roles hold none, so they
            // never widen which customers anyone sees.
            migrationBuilder.InsertData(
                table: "RoleSegments",
                schema: "dbo",
                columns: ["RoleId", "Segment", "GrantedBy"],
                values: new object[,]
                {
                    { Originator, "Producer", SeededBy },
                    { Support, "Producer", SeededBy },
                    { Support, "Commercial", SeededBy },
                    { Admin, "Producer", SeededBy },
                    { Admin, "Commercial", SeededBy },
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RolePermissions",
                schema: "dbo")
                .Annotation("SqlServer:IsTemporal", true)
                .Annotation("SqlServer:TemporalHistoryTableName", "RolePermissionsHistory")
                .Annotation("SqlServer:TemporalHistoryTableSchema", "dbo")
                .Annotation("SqlServer:TemporalPeriodEndColumnName", "ValidTo")
                .Annotation("SqlServer:TemporalPeriodStartColumnName", "ValidFrom");

            migrationBuilder.DropTable(
                name: "RoleSegments",
                schema: "dbo")
                .Annotation("SqlServer:IsTemporal", true)
                .Annotation("SqlServer:TemporalHistoryTableName", "RoleSegmentsHistory")
                .Annotation("SqlServer:TemporalHistoryTableSchema", "dbo")
                .Annotation("SqlServer:TemporalPeriodEndColumnName", "ValidTo")
                .Annotation("SqlServer:TemporalPeriodStartColumnName", "ValidFrom");

            migrationBuilder.DropTable(
                name: "Permissions",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "Roles",
                schema: "dbo");
        }
    }
}
