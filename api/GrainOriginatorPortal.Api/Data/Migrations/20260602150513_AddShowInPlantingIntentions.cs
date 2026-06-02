using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class AddShowInPlantingIntentions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ShowInPlantingIntentions",
                schema: "dbo",
                table: "Commodities",
                type: "bit",
                nullable: false,
                defaultValue: false);

            // Seed the curated Planting Intentions crop list (Ellie's approved set, mapped to
            // real commodity codes). Idempotent — re-running just re-sets the same rows to 1.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET ShowInPlantingIntentions = 1
                WHERE Code IN ('HRWW','SRWW','HWW','YC','YCNG','YSB','NYSB','SOR','WHTM');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ShowInPlantingIntentions",
                schema: "dbo",
                table: "Commodities");
        }
    }
}
