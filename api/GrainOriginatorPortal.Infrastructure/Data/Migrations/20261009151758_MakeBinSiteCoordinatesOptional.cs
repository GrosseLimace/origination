using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Makes dbo.ProducerBinSite.Latitude and Longitude NULLable: only a bin site's Name is required
    /// now (user 2026-10-09); a site without coordinates shows as plain text with no map link. Up only
    /// relaxes a constraint, so it loses nothing. Down restores NOT NULL and fills any missing
    /// coordinate with 0 — not a real location, so roll back only before such sites exist.
    /// </summary>
    public partial class MakeBinSiteCoordinatesOptional : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<decimal>(
                name: "Longitude",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(18,15)",
                nullable: true,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,15)");

            migrationBuilder.AlterColumn<decimal>(
                name: "Latitude",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(18,15)",
                nullable: true,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,15)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<decimal>(
                name: "Longitude",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(18,15)",
                nullable: false,
                defaultValue: 0m,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,15)",
                oldNullable: true);

            migrationBuilder.AlterColumn<decimal>(
                name: "Latitude",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "decimal(18,15)",
                nullable: false,
                defaultValue: 0m,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,15)",
                oldNullable: true);
        }
    }
}
