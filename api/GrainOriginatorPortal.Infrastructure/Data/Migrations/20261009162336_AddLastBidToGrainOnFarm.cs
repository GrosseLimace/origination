using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the nullable <c>LastBid</c> column to dbo.ProducerGrainOnFarm: the last bid for that
    /// commodity, user-entered. decimal(18,4) and signed, because a basis bid is negative and can carry
    /// quarter-cents. Existing rows read NULL ("not entered") — no backfill.
    /// </summary>
    public partial class AddLastBidToGrainOnFarm : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Guarded add (raw SQL rather than AddColumn) so this is idempotent if the column was
            // applied by hand in an environment before deploy runs the migration — same as Grade.
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.ProducerGrainOnFarm', 'LastBid') IS NULL
    ALTER TABLE dbo.ProducerGrainOnFarm ADD LastBid DECIMAL(18,4) NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.ProducerGrainOnFarm', 'LastBid') IS NOT NULL
    ALTER TABLE dbo.ProducerGrainOnFarm DROP COLUMN LastBid;");
        }
    }
}
