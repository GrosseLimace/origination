using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveRecapGroupMentionsToChannel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MentionsToChannel",
                schema: "dbo",
                table: "DailyRecapGroups");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "MentionsToChannel",
                schema: "dbo",
                table: "DailyRecapGroups",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }
    }
}
