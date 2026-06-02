using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class AddCanolaMilletPlantingDropWhiteMilo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Planting Intentions curated list update: add CANP (Canola), CASM (Canola Seed),
            // MIL (Millet); remove WHTM (White Milo). Data-only follow-up to the earlier seeds.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities SET ShowInPlantingIntentions = 1 WHERE Code IN ('CANP','CASM','MIL');
                UPDATE dbo.Commodities SET ShowInPlantingIntentions = 0 WHERE Code IN ('WHTM');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities SET ShowInPlantingIntentions = 0 WHERE Code IN ('CANP','CASM','MIL');
                UPDATE dbo.Commodities SET ShowInPlantingIntentions = 1 WHERE Code IN ('WHTM');");
        }
    }
}
