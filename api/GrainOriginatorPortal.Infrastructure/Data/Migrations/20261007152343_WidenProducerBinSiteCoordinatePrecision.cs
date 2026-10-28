using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Widens dbo.ProducerBinSite.Latitude/Longitude from decimal(9,6) to decimal(18,15) so a
    /// full-precision Google Maps paste (e.g. 41.39034548435109) is stored exactly as entered rather
    /// than rounded to six places; the profile shortens it for display. Up is lossless — both types
    /// keep three integer digits and only gain scale. Down narrows back and would round to six.
    /// </summary>
    public partial class WidenProducerBinSiteCoordinatePrecision : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<decimal>(
                name: "Longitude",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(18,15)",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(9,6)");

            migrationBuilder.AlterColumn<decimal>(
                name: "Latitude",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(18,15)",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(9,6)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<decimal>(
                name: "Longitude",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(9,6)",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,15)");

            migrationBuilder.AlterColumn<decimal>(
                name: "Latitude",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(9,6)",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,15)");
        }
    }
}
