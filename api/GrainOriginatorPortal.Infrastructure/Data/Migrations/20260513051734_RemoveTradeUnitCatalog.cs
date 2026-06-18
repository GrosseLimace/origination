using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class RemoveTradeUnitCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Drop the local TU catalog tables — they were superseded by the
            // Entitlements DB view vw_UserTradeUnitAccess (groups + user access)
            // and direct ODS lookups (customer → TU). See database-design-issues.md
            // "Architectural principle: Entitlements DB owns the TU/group catalog".
            //
            // IF EXISTS guards make this idempotent: safe to re-run, and safe in
            // environments where these tables may have been manually dropped.
            // FK-aware order: child (GroupTradeUnits) first, then parents.
            migrationBuilder.Sql("DROP TABLE IF EXISTS [dbo].[GroupTradeUnits]");
            migrationBuilder.Sql("DROP TABLE IF EXISTS [dbo].[TradeUnits]");
            migrationBuilder.Sql("DROP TABLE IF EXISTS [dbo].[TradeUnitGroups]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeUnitGroups",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    GroupName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeUnitGroups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TradeUnits",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Code = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeUnits", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GroupTradeUnits",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    GroupId = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    Location = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    TradeUnitCode = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupTradeUnits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroupTradeUnits_TradeUnitGroups_GroupId",
                        column: x => x.GroupId,
                        principalSchema: "dbo",
                        principalTable: "TradeUnitGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GroupTradeUnits_GroupId",
                schema: "dbo",
                table: "GroupTradeUnits",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupTradeUnits_TradeUnitCode",
                schema: "dbo",
                table: "GroupTradeUnits",
                column: "TradeUnitCode");

            migrationBuilder.CreateIndex(
                name: "IX_TradeUnits_Code",
                schema: "dbo",
                table: "TradeUnits",
                column: "Code",
                unique: true);
        }
    }
}
