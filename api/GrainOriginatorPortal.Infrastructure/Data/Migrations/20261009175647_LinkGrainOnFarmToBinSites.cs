using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Ties Grain on Farm to bin sites (user 2026-10-09): ProducerBinSite.SiteKey (a stable GUID — sites are
    /// matched by it on save; NEWID() backfills existing rows) and ProducerGrainOnFarm.BinSiteId (nullable FK,
    /// NoAction). Uniqueness moves from (customer, commodity) to (customer, site, commodity), unfiltered so
    /// rows without a site stay one per commodity. Existing grain rows keep BinSiteId NULL — no data is
    /// rewritten. Down restores the old index, which fails if a producer by then has the same commodity at
    /// two sites.
    /// </summary>
    public partial class LinkGrainOnFarmToBinSites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UQ_ProducerGrainOnFarm_Customer_Commodity",
                schema: "dbo",
                table: "ProducerGrainOnFarm");

            migrationBuilder.AddColumn<int>(
                name: "BinSiteId",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SiteKey",
                schema: "dbo",
                table: "ProducerBinSite",
                type: "uniqueidentifier",
                nullable: false,
                defaultValueSql: "NEWID()");

            migrationBuilder.CreateIndex(
                name: "IX_ProducerGrainOnFarm_BinSiteId",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                column: "BinSiteId");

            migrationBuilder.CreateIndex(
                name: "UQ_ProducerGrainOnFarm_Customer_Site_Commodity",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                columns: new[] { "CustomerId", "BinSiteId", "CommodityCode" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UQ_ProducerBinSite_SiteKey",
                schema: "dbo",
                table: "ProducerBinSite",
                column: "SiteKey",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ProducerGrainOnFarm_BinSite",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                column: "BinSiteId",
                principalSchema: "dbo",
                principalTable: "ProducerBinSite",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ProducerGrainOnFarm_BinSite",
                schema: "dbo",
                table: "ProducerGrainOnFarm");

            migrationBuilder.DropIndex(
                name: "IX_ProducerGrainOnFarm_BinSiteId",
                schema: "dbo",
                table: "ProducerGrainOnFarm");

            migrationBuilder.DropIndex(
                name: "UQ_ProducerGrainOnFarm_Customer_Site_Commodity",
                schema: "dbo",
                table: "ProducerGrainOnFarm");

            migrationBuilder.DropIndex(
                name: "UQ_ProducerBinSite_SiteKey",
                schema: "dbo",
                table: "ProducerBinSite");

            migrationBuilder.DropColumn(
                name: "BinSiteId",
                schema: "dbo",
                table: "ProducerGrainOnFarm");

            migrationBuilder.DropColumn(
                name: "SiteKey",
                schema: "dbo",
                table: "ProducerBinSite");

            migrationBuilder.CreateIndex(
                name: "UQ_ProducerGrainOnFarm_Customer_Commodity",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                columns: new[] { "CustomerId", "CommodityCode" },
                unique: true);
        }
    }
}
