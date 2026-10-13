using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds three optional columns to dbo.ProducerBinSite: CommodityCode nvarchar(100) (Grain on Farm
    /// list), Marketed and Unmarketed decimal(18,2) bushels, typed by hand. Nullable, no default, no
    /// backfill. Nothing rolls up into Grain on Farm or Bin Capacity (user decision 2026-10-09).
    /// </summary>
    public partial class AddBinSiteCommodityAndMarketing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CommodityCode",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CommodityCode",
                schema: "dbo",
                table: "ProducerBinSite");

            migrationBuilder.DropColumn(
                name: "Marketed",
                schema: "dbo",
                table: "ProducerBinSite");

            migrationBuilder.DropColumn(
                name: "Unmarketed",
                schema: "dbo",
                table: "ProducerBinSite");
        }
    }
}
