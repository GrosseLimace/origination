using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Gives the access tables the standard audit columns (<c>CreatedAt</c>, <c>CreatedBy</c>, <c>ModifiedAt</c>,
    /// <c>ModifiedBy</c>) and drops <c>dbo.Roles.ParentRoleId</c>, which nothing used: grants never inherit.
    /// <para>The grant tables' <c>GrantedBy</c> and <c>GrantedAt</c> become <c>CreatedBy</c> and <c>CreatedAt</c>. A
    /// grant is added or removed, never edited, so they get no <c>Modified</c> columns; their history tables
    /// record removals.</para>
    /// <para>Nothing here switches system versioning off on the two temporal grant tables. Adding and renaming
    /// columns doesn't need it, and neither the deploy identity nor developers are allowed to.</para>
    /// </summary>
    public partial class AddAccessAuditColumns : Migration
    {
        // The roles the earlier migrations seeded, and who created them. Literals, as in those migrations: a
        // migration must make the same change forever.
        private static readonly Guid Admin = new("1826864d-58d6-45b0-877e-1be18da7c3cd");
        private static readonly Guid Originator = new("18041e71-c0da-473e-b61b-b1d0f2dcb4bf");
        private static readonly Guid Support = new("c42dc66f-74e2-44a6-9d9c-6a0cd0440df5");
        private static readonly Guid Editor = new("24faf940-89ec-4d6b-894c-818d346d52ee");
        private static readonly Guid Manager = new("f95d66ba-eb0e-4614-bbe1-00d5bde2c005");
        private static readonly Guid Pipeline = new("11b63e97-b26f-49d6-8dde-33c275c31588");
        private const string AddAccessGrants = "migration:AddAccessGrants";
        private const string AddPipelineRole = "migration:AddPipelineRole";
        private const string SeededFromCatalog = "seed:AppPermissions";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // dbo.Roles: no parent role.
            migrationBuilder.DropForeignKey(
                name: "FK_Roles_Roles_ParentRoleId",
                schema: "dbo",
                table: "Roles");

            migrationBuilder.DropIndex(
                name: "IX_Roles_ParentRoleId",
                schema: "dbo",
                table: "Roles");

            migrationBuilder.DropColumn(
                name: "ParentRoleId",
                schema: "dbo",
                table: "Roles");

            // dbo.Roles: UpdatedAt held the insert time on rows nobody has changed. ModifiedAt starts empty instead.
            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                schema: "dbo",
                table: "Roles");

            migrationBuilder.AddColumn<DateTime>(
                name: "ModifiedAt",
                schema: "dbo",
                table: "Roles",
                type: "datetime2(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ModifiedBy",
                schema: "dbo",
                table: "Roles",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true);

            // dbo.Roles.CreatedBy: added empty, filled for the seeded roles, then made required, so no default is
            // left behind to stand in for a missing name. A role no migration seeded would stop it here.
            migrationBuilder.AddColumn<string>(
                name: "CreatedBy",
                schema: "dbo",
                table: "Roles",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.UpdateData(
                table: "Roles",
                schema: "dbo",
                keyColumn: "Id",
                keyValues: new object[] { Admin, Originator, Support, Editor, Manager },
                column: "CreatedBy",
                values: new object[] { AddAccessGrants, AddAccessGrants, AddAccessGrants, AddAccessGrants, AddAccessGrants });

            migrationBuilder.UpdateData(
                table: "Roles",
                schema: "dbo",
                keyColumn: "Id",
                keyValue: Pipeline,
                column: "CreatedBy",
                value: AddPipelineRole);

            migrationBuilder.AlterColumn<string>(
                name: "CreatedBy",
                schema: "dbo",
                table: "Roles",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(256)",
                oldMaxLength: 256,
                oldNullable: true);

            // dbo.Permissions: CreatedAt takes the database default; existing rows get the time this runs.
            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                schema: "dbo",
                table: "Permissions",
                type: "datetime2(3)",
                precision: 3,
                nullable: false,
                defaultValueSql: "SYSUTCDATETIME()");

            // dbo.Permissions.CreatedBy: the same three steps as on Roles. Every permission comes from the catalog.
            migrationBuilder.AddColumn<string>(
                name: "CreatedBy",
                schema: "dbo",
                table: "Permissions",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.Sql($"UPDATE [dbo].[Permissions] SET [CreatedBy] = N'{SeededFromCatalog}';");

            migrationBuilder.AlterColumn<string>(
                name: "CreatedBy",
                schema: "dbo",
                table: "Permissions",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(256)",
                oldMaxLength: 256,
                oldNullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ModifiedAt",
                schema: "dbo",
                table: "Permissions",
                type: "datetime2(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ModifiedBy",
                schema: "dbo",
                table: "Permissions",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true);

            // The temporal grant tables: renames only, which SQL Server applies to the history tables as well.
            migrationBuilder.RenameColumn(
                name: "GrantedBy",
                schema: "dbo",
                table: "RolePermissions",
                newName: "CreatedBy");

            migrationBuilder.RenameColumn(
                name: "GrantedAt",
                schema: "dbo",
                table: "RolePermissions",
                newName: "CreatedAt");

            migrationBuilder.RenameColumn(
                name: "GrantedBy",
                schema: "dbo",
                table: "RoleSegments",
                newName: "CreatedBy");

            migrationBuilder.RenameColumn(
                name: "GrantedAt",
                schema: "dbo",
                table: "RoleSegments",
                newName: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreatedBy",
                schema: "dbo",
                table: "Roles");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                schema: "dbo",
                table: "Roles");

            migrationBuilder.DropColumn(
                name: "ModifiedBy",
                schema: "dbo",
                table: "Roles");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                schema: "dbo",
                table: "Permissions");

            migrationBuilder.DropColumn(
                name: "CreatedBy",
                schema: "dbo",
                table: "Permissions");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                schema: "dbo",
                table: "Permissions");

            migrationBuilder.DropColumn(
                name: "ModifiedBy",
                schema: "dbo",
                table: "Permissions");

            migrationBuilder.RenameColumn(
                name: "CreatedBy",
                schema: "dbo",
                table: "RoleSegments",
                newName: "GrantedBy");

            migrationBuilder.RenameColumn(
                name: "CreatedAt",
                schema: "dbo",
                table: "RoleSegments",
                newName: "GrantedAt");

            migrationBuilder.RenameColumn(
                name: "CreatedBy",
                schema: "dbo",
                table: "RolePermissions",
                newName: "GrantedBy");

            migrationBuilder.RenameColumn(
                name: "CreatedAt",
                schema: "dbo",
                table: "RolePermissions",
                newName: "GrantedAt");

            migrationBuilder.AddColumn<Guid>(
                name: "ParentRoleId",
                schema: "dbo",
                table: "Roles",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                schema: "dbo",
                table: "Roles",
                type: "datetime2(3)",
                precision: 3,
                nullable: false,
                defaultValueSql: "SYSUTCDATETIME()");

            migrationBuilder.CreateIndex(
                name: "IX_Roles_ParentRoleId",
                schema: "dbo",
                table: "Roles",
                column: "ParentRoleId");

            migrationBuilder.AddForeignKey(
                name: "FK_Roles_Roles_ParentRoleId",
                schema: "dbo",
                table: "Roles",
                column: "ParentRoleId",
                principalSchema: "dbo",
                principalTable: "Roles",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
