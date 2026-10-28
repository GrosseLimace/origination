using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Drops dbo.ProducerBinSite.CommodityCode: a bin site is now just Name, Capacity and
    /// Latitude/Longitude (user 2026-10-09). It came in the same day with
    /// 20261009141509_AddBinSiteCommodityAndMarketing; 20261009163032_DropBinSiteMarketing already took
    /// the other two. Destructive for any codes entered (Dev test data only; QA/PROD never ran the add).
    /// Down re-adds the column empty.
    /// </summary>
    public partial class DropBinSiteCommodity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CommodityCode",
                schema: "dbo",
                table: "ProducerBinSite");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CommodityCode",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);
        }
    }
}
