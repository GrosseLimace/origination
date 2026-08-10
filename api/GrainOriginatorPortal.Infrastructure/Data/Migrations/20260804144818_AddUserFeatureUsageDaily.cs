using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserFeatureUsageDaily : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserFeatureUsageDaily",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ActivityDate = table.Column<DateOnly>(type: "date", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    FeatureCode = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    SubFeatureCode = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false, defaultValue: "__total__"),
                    RequestCount = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    InteractionCount = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    ScreenMinutes = table.Column<double>(type: "float", nullable: false, defaultValue: 0.0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserFeatureUsageDaily", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserFeatureUsageDaily_FeatureCode",
                schema: "dbo",
                table: "UserFeatureUsageDaily",
                columns: new[] { "FeatureCode", "ActivityDate" });

            migrationBuilder.CreateIndex(
                name: "UQ_UserFeatureUsageDaily",
                schema: "dbo",
                table: "UserFeatureUsageDaily",
                columns: new[] { "ActivityDate", "UserId", "FeatureCode", "SubFeatureCode" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserFeatureUsageDaily",
                schema: "dbo");
        }
    }
}
