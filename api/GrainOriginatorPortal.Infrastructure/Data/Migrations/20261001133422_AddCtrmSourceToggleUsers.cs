using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCtrmSourceToggleUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CtrmSourceToggleUsers",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false, defaultValue: "system")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CtrmSourceToggleUsers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CtrmSourceToggleUsers_UserId",
                schema: "dbo",
                table: "CtrmSourceToggleUsers",
                column: "UserId",
                unique: true);

            // Seed the initial validation group (named by the product owner 2026-10-01) so the toggle is
            // live for them the moment the deploy finishes, with no manual SQL step on go-live day. The
            // same eight apply in every environment. UserId is the UPN (preferred_username) the matching
            // is done on. Idempotent on UserId so re-running against a table created by hand cannot trip
            // the unique index. Later additions use Documents\ctrm-measure-2026-09-17\add-ctrm-toggle-tester.sql.
            migrationBuilder.Sql(@"
INSERT INTO dbo.CtrmSourceToggleUsers (UserId, DisplayName, Notes, IsActive, CreatedBy)
SELECT v.UserId, v.DisplayName, v.Notes, 1, 'migration'
FROM (VALUES
    ('CEgr@scoular.com',      'Caden Egr',        'Initial CTRM validation group, 2026-10-01'),
    ('TThimesch@scoular.com', 'Travis Thimesch',  'Initial CTRM validation group, 2026-10-01'),
    ('HCollins@scoular.com',  'Hope Collins',     'Initial CTRM validation group, 2026-10-01'),
    ('MPaulson@scoular.com',  'Marc Paulson',     'Initial CTRM validation group, 2026-10-01'),
    ('SFletcher@scoular.com', 'Stacey Fletcher',  'Initial CTRM validation group, 2026-10-01'),
    ('BCozart@scoular.com',   'Bailey Cozart',    'Initial CTRM validation group, 2026-10-01'),
    ('EHatcher@scoular.com',  'Ellie Hatcher',    'Initial CTRM validation group, 2026-10-01'),
    ('LHenebry@scoular.com',  'Luke Henebry',     'Initial CTRM validation group, 2026-10-01')
) AS v(UserId, DisplayName, Notes)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.CtrmSourceToggleUsers e WHERE e.UserId = v.UserId
);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CtrmSourceToggleUsers",
                schema: "dbo");
        }
    }
}
