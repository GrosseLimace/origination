using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the nullable <c>BushelsSold</c> column to dbo.ProducerGrainOnFarm: of the bushels on hand
    /// for a commodity, how many the producer has already sold. User-entered, so existing rows simply
    /// read NULL ("not entered") — no backfill.
    /// </summary>
    public partial class AddBushelsSoldToGrainOnFarm : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Guarded add (raw SQL rather than AddColumn) so this is idempotent if the column was
            // applied by hand in an environment before deploy runs the migration — same as Grade.
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.ProducerGrainOnFarm', 'BushelsSold') IS NULL
    ALTER TABLE dbo.ProducerGrainOnFarm ADD BushelsSold DECIMAL(18,2) NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.ProducerGrainOnFarm', 'BushelsSold') IS NOT NULL
    ALTER TABLE dbo.ProducerGrainOnFarm DROP COLUMN BushelsSold;");
        }
    }
}
