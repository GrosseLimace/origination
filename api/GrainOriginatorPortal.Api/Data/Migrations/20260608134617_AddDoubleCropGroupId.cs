using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDoubleCropGroupId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DoubleCropGroupId",
                schema: "dbo",
                table: "ProducerPlantingIntentions",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DoubleCropGroupId",
                schema: "dbo",
                table: "ProducerPlantingIntentions");
        }
    }
}
