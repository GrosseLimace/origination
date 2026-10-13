using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds dbo.ProducerDetails.BinSitesModifiedAt (user 2026-10-09): when a producer's bin sites or grain on
    /// farm last actually changed — the repository sets it only on saves that change them — so Build a List
    /// can order the Grain on Farm &amp; Bin Sites prompts by newest additions/changes. Backfilled for producers
    /// that already have sites or grain from their details' last change (ModifiedAt, else CreatedAt), the
    /// closest value there is. Runs before 20261009201700_DropProducerDetailsBinCapacity in the same deploy.
    /// </summary>
    public partial class AddBinSitesModifiedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "BinSitesModifiedAt",
                schema: "dbo",
                table: "ProducerDetails",
                type: "datetime2",
                nullable: true);

            migrationBuilder.Sql(@"
UPDATE d
SET d.BinSitesModifiedAt = COALESCE(d.ModifiedAt, d.CreatedAt)
FROM dbo.ProducerDetails AS d
WHERE EXISTS (SELECT 1 FROM dbo.ProducerBinSite b WHERE b.CustomerId = d.CustomerId)
   OR EXISTS (SELECT 1 FROM dbo.ProducerGrainOnFarm g WHERE g.CustomerId = d.CustomerId);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BinSitesModifiedAt",
                schema: "dbo",
                table: "ProducerDetails");
        }
    }
}
