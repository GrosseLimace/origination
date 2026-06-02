using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class FlagSwwDnswForPlantingIntentions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add SWW (Soft White Wheat) and DNSW (Dark Northern Spring Wheat) to the curated
            // Planting Intentions crop list. Data-only follow-up to AddShowInPlantingIntentions.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET ShowInPlantingIntentions = 1
                WHERE Code IN ('SWW','DNSW');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET ShowInPlantingIntentions = 0
                WHERE Code IN ('SWW','DNSW');");
        }
    }
}
