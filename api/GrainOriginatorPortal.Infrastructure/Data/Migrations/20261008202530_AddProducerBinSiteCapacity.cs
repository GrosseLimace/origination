using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds dbo.ProducerBinSite.Capacity — optional storage capacity in bushels, decimal(18,2) like
    /// ProducerDetails.BinCapacity. Stored per site only; it is NOT summed into BinCapacity (deferred
    /// by the user 2026-10-08). Nullable, no default, no backfill.
    /// </summary>
    public partial class AddProducerBinSiteCapacity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "Capacity",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(18,2)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Capacity",
                schema: "dbo",
                table: "ProducerBinSite");
        }
    }
}
