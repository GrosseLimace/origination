using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class RemoveCasmFromPlantingIntentions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Correction to AddCanolaMilletPlantingDropWhiteMilo: CASM (Canola Seed) was
            // added to the curated planting-intentions list, but CANP (Canola) already
            // covers canola — we only need the one. Drop CASM back out.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities SET ShowInPlantingIntentions = 0 WHERE Code IN ('CASM');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities SET ShowInPlantingIntentions = 1 WHERE Code IN ('CASM');");
        }
    }
}
