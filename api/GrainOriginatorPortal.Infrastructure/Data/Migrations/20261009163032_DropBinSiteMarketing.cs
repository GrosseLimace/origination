using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Drops dbo.ProducerBinSite.Marketed and Unmarketed: the business no longer needs per-site
    /// marketing bushels (user 2026-10-09), the same day 20261009141509_AddBinSiteCommodityAndMarketing
    /// added them alongside CommodityCode, which stays. Destructive for any values entered — on Dev that
    /// was one test site; QA/PROD never ran the add, so there they add and drop in the same deploy.
    /// Down re-adds both columns empty.
    /// </summary>
    public partial class DropBinSiteMarketing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Marketed",
                schema: "dbo",
                table: "ProducerBinSite");

            migrationBuilder.DropColumn(
                name: "Unmarketed",
                schema: "dbo",
                table: "ProducerBinSite");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "Marketed",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Unmarketed",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(18,2)",
                nullable: true);
        }
    }
}
