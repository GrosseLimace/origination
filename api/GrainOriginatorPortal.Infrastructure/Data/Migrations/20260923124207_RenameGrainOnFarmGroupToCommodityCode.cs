using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Grain on Farm moves from one row per crop GROUP ("Wheat") to one row per commodity CODE
    /// ("HRWW", "SRWW"), matching the producer's Commodities chips. Rename only, so it is safe on a
    /// live table and needs no idempotency guard (EF records it in history like any other).
    ///
    /// Existing values are deliberately NOT rewritten. A group cannot be mapped to one code without
    /// guessing — "Wheat" could be any of HRWW/SRWW/SWW/HWW/DNSW — and a wrong guess would silently
    /// misstate a producer's inventory. Legacy group rows keep working: the client resolves either a
    /// code or a group name for display and crop filters, and a user re-picks a code when editing.
    /// </summary>
    public partial class RenameGrainOnFarmGroupToCommodityCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "CommodityGroup",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                newName: "CommodityCode");

            migrationBuilder.RenameIndex(
                name: "UQ_ProducerGrainOnFarm_Customer_Group",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                newName: "UQ_ProducerGrainOnFarm_Customer_Commodity");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "CommodityCode",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                newName: "CommodityGroup");

            migrationBuilder.RenameIndex(
                name: "UQ_ProducerGrainOnFarm_Customer_Commodity",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                newName: "UQ_ProducerGrainOnFarm_Customer_Group");
        }
    }
}
