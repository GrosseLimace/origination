using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class ReplaceBidSheetTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "BidSheetEntries", schema: "dbo");
            migrationBuilder.DropTable(name: "BidReferences", schema: "dbo");

            migrationBuilder.CreateTable(
                name: "BidSheetLocations",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Address = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    City = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    State = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true),
                    Latitude = table.Column<double>(type: "float", nullable: true),
                    Longitude = table.Column<double>(type: "float", nullable: true),
                    ElevatorCode = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    TradeUnitCode = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    GroupName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BidSheetLocations", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BidSheetLocations_TradeUnitCode",
                schema: "dbo",
                table: "BidSheetLocations",
                column: "TradeUnitCode");

            migrationBuilder.CreateTable(
                name: "BidSheetLocationBids",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    LocationId = table.Column<int>(type: "int", nullable: false),
                    CommodityCode = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CommodityName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CommodityCategory = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    CropYear = table.Column<int>(type: "int", nullable: false),
                    Bid = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BidSheetLocationBids", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BidSheetLocationBids_BidSheetLocations_LocationId",
                        column: x => x.LocationId,
                        principalSchema: "dbo",
                        principalTable: "BidSheetLocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UQ_BidSheetLocationBids_Location_Commodity_Year",
                schema: "dbo",
                table: "BidSheetLocationBids",
                columns: new[] { "LocationId", "CommodityCode", "CropYear" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "BidSheetLocationBids", schema: "dbo");
            migrationBuilder.DropTable(name: "BidSheetLocations", schema: "dbo");

            migrationBuilder.CreateTable(
                name: "BidSheetEntries",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false).Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Address = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    City = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    State = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true),
                    Latitude = table.Column<double>(type: "float", nullable: true),
                    Longitude = table.Column<double>(type: "float", nullable: true),
                    ElevatorCode = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    TradeUnitCode = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    GroupName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CommodityCode = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CommodityName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CommodityCategory = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    CropYear = table.Column<int>(type: "int", nullable: false),
                    Bid = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table => { table.PrimaryKey("PK_BidSheetEntries", x => x.Id); });

            migrationBuilder.CreateTable(
                name: "BidReferences",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false).Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    TradeUnitCode = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    CommodityCode = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    ElevatorCode = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
                },
                constraints: table => { table.PrimaryKey("PK_BidReferences", x => x.Id); });
        }
    }
}
