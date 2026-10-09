using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class DropUsageDashboardViewAllUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Retires the usage dashboard's "who sees the whole org" list (created by
            // 20260921152258_AddUsageDashboardViewAllUsers). The manager dropdown is now offered to
            // everyone who can open the dashboard and defaults to the signed-in user, so the table has
            // no reader. The data loss EF warns about is intended: it only ever held a handful of short
            // names (five seeded by the original migration, plus any added by hand since).
            migrationBuilder.DropTable(
                name: "UsageDashboardViewAllUsers",
                schema: "dbo");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UsageDashboardViewAllUsers",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false, defaultValue: "system"),
                    Reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    UserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UsageDashboardViewAllUsers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UsageDashboardViewAllUsers_UserId",
                schema: "dbo",
                table: "UsageDashboardViewAllUsers",
                column: "UserId",
                unique: true);
        }
    }
}
