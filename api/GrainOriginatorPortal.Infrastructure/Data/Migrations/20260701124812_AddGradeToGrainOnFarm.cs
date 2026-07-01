using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the free-text <c>Grade</c> column to dbo.ProducerGrainOnFarm (a per-commodity grade /
    /// quality note like "4.4%" or "TW 58"), and seeds a "Has a grade" curated prompt card into
    /// dbo.QueryLibrary. The card insert is guarded by NOT EXISTS on QueryText so it's idempotent
    /// (safe to re-run / safe if added manually in an environment first).
    /// </summary>
    public partial class AddGradeToGrainOnFarm : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Guarded add (raw SQL rather than AddColumn) so this is idempotent: the column may
            // already exist in an environment where it was applied by hand before deploy runs the
            // migration (the grain-on-farm branch is tested against dev directly before merge).
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.ProducerGrainOnFarm', 'Grade') IS NULL
    ALTER TABLE dbo.ProducerGrainOnFarm ADD Grade NVARCHAR(100) NULL;");

            migrationBuilder.Sql(@"
INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT 'Grain on Farm', 'Has a grade', 'Producers with a grade entered on a grain-on-farm row.', 'Producers with a grain grade', 'grain,grade', 50, 1, SYSUTCDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary q WHERE q.QueryText = 'Producers with a grain grade');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM dbo.QueryLibrary WHERE QueryText = 'Producers with a grain grade';");

            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.ProducerGrainOnFarm', 'Grade') IS NOT NULL
    ALTER TABLE dbo.ProducerGrainOnFarm DROP COLUMN Grade;");
        }
    }
}
