using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUsageDashboardViewAllUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UsageDashboardViewAllUsers",
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
                    table.PrimaryKey("PK_UsageDashboardViewAllUsers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UsageDashboardViewAllUsers_UserId",
                schema: "dbo",
                table: "UsageDashboardViewAllUsers",
                column: "UserId",
                unique: true);

            // Seed the five names that were in the UsageDashboard:ViewAll config array this table
            // replaces. NOT optional: without it the first deploy would silently drop every viewer
            // to self-scope and the manager dropdown would disappear for everyone. All five already
            // hold the Admin role in QA and PROD via the Super Users groups, so the same seed is
            // correct in every environment.
            //
            // Idempotent on UserId so re-running against a database where the table was created by
            // hand cannot trip the unique index.
            migrationBuilder.Sql(@"
INSERT INTO dbo.UsageDashboardViewAllUsers (UserId, Reason, CreatedBy)
SELECT v.UserId, v.Reason, 'migration'
FROM (VALUES
    ('CEgr',      'Seeded from UsageDashboard:ViewAll config'),
    ('TThimesch', 'Seeded from UsageDashboard:ViewAll config'),
    ('HCollins',  'Seeded from UsageDashboard:ViewAll config'),
    ('MPaulson',  'Seeded from UsageDashboard:ViewAll config'),
    ('SFletcher', 'Seeded from UsageDashboard:ViewAll config')
) AS v(UserId, Reason)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.UsageDashboardViewAllUsers e WHERE e.UserId = v.UserId
);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UsageDashboardViewAllUsers",
                schema: "dbo");
        }
    }
}
