using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Gives the BarChart data pipeline a role, so its ingest calls are checked like everyone else's: by
    /// permission. Its managed identity's app-only token carries the <c>Origination.Application</c> app role;
    /// this row, of the new <c>Machine</c> kind, grants that role <c>bid-feed:manage</c> and nothing else.
    /// </summary>
    public partial class AddPipelineRole : Migration
    {
        // Literals, not constants, as in AddAccessGrants: a migration must insert the same rows forever.
        private const string SeededBy = "migration:AddPipelineRole";
        private static readonly Guid Pipeline = new("11b63e97-b26f-49d6-8dde-33c275c31588");

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Roles_Kind",
                schema: "dbo",
                table: "Roles");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Roles_Kind",
                schema: "dbo",
                table: "Roles",
                sql: "[Kind] IN ('Persona', 'AddOn', 'Base', 'Machine')");

            // The name must match the app role in the pipeline's token. It holds no segments: it reads no customers.
            migrationBuilder.InsertData(
                table: "Roles",
                schema: "dbo",
                columns: ["Id", "Name", "Kind", "IsSystem", "Description"],
                values: new object[,]
                {
                    { Pipeline, "Origination.Application", "Machine", false,
                        "Machine: the BarChart data pipeline's managed identity. Loads the bid feed; not a person." },
                });

            migrationBuilder.InsertData(
                table: "RolePermissions",
                schema: "dbo",
                columns: ["RoleId", "PermissionId", "GrantedBy"],
                values: new object[,] { { Pipeline, "bid-feed:manage", SeededBy } });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "RolePermissions",
                schema: "dbo",
                keyColumns: ["RoleId", "PermissionId"],
                keyValues: new object[] { Pipeline, "bid-feed:manage" });

            migrationBuilder.DeleteData(
                table: "Roles",
                schema: "dbo",
                keyColumn: "Id",
                keyValue: Pipeline);

            migrationBuilder.DropCheckConstraint(
                name: "CK_Roles_Kind",
                schema: "dbo",
                table: "Roles");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Roles_Kind",
                schema: "dbo",
                table: "Roles",
                sql: "[Kind] IN ('Persona', 'AddOn', 'Base')");
        }
    }
}
