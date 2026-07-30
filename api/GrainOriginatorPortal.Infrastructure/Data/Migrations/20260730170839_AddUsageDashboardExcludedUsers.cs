using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUsageDashboardExcludedUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UsageDashboardExcludedUsers",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false, defaultValue: "system")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UsageDashboardExcludedUsers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UsageDashboardExcludedUsers_UserId",
                schema: "dbo",
                table: "UsageDashboardExcludedUsers",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UsageDashboardExcludedUsers",
                schema: "dbo");
        }
    }
}
