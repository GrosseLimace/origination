using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Drops dbo.ProducerDetails.BinCapacity (user 2026-10-09: the producer-level Bin Capacity is removed
    /// everywhere; capacity lives on each bin site). 20261009185518_MoveBinCapacityAndGrainOntoBinSites, just
    /// before this in the same deploy, copied every value onto a "Bin 1" site first. Down re-adds the column
    /// and fills it with the sum of the producer's site capacities — the closest available value, not the
    /// original number if sites were edited since.
    /// </summary>
    public partial class DropProducerDetailsBinCapacity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BinCapacity",
                schema: "dbo",
                table: "ProducerDetails");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "BinCapacity",
                schema: "dbo",
                table: "ProducerDetails",
                type: "decimal(18,2)",
                nullable: true);

            migrationBuilder.Sql(@"
UPDATE d
SET d.BinCapacity = s.Total
FROM dbo.ProducerDetails AS d
JOIN (SELECT CustomerId, SUM(Capacity) AS Total FROM dbo.ProducerBinSite GROUP BY CustomerId) AS s
  ON s.CustomerId = d.CustomerId
WHERE s.Total > 0;");
        }
    }
}
