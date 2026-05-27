using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class AddIsManualFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsManual",
                schema: "dbo",
                table: "CustomerTradeUnit",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsManual",
                schema: "dbo",
                table: "Customer",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsManual",
                schema: "dbo",
                table: "CustomerTradeUnit");

            migrationBuilder.DropColumn(
                name: "IsManual",
                schema: "dbo",
                table: "Customer");
        }
    }
}
