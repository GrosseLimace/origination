using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBidSheets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BidSheets",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    OwnerUserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    CropOrder = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    HiddenCrops = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    SelectedMonths = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    SelectedYears = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BidSheets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "BidSheetLocationLinks",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    BidSheetId = table.Column<int>(type: "int", nullable: false),
                    BidSheetLocationId = table.Column<int>(type: "int", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    AddedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    AddedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BidSheetLocationLinks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BidSheetLocationLinks_BidSheetLocations_BidSheetLocationId",
                        column: x => x.BidSheetLocationId,
                        principalSchema: "dbo",
                        principalTable: "BidSheetLocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BidSheetLocationLinks_BidSheets_BidSheetId",
                        column: x => x.BidSheetId,
                        principalSchema: "dbo",
                        principalTable: "BidSheets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BidSheetShares",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    BidSheetId = table.Column<int>(type: "int", nullable: false),
                    MemberUserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    MemberName = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    SharedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    SharedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BidSheetShares", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BidSheetShares_BidSheets_BidSheetId",
                        column: x => x.BidSheetId,
                        principalSchema: "dbo",
                        principalTable: "BidSheets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BidSheetLocationLinks_BidSheetLocationId",
                schema: "dbo",
                table: "BidSheetLocationLinks",
                column: "BidSheetLocationId");

            migrationBuilder.CreateIndex(
                name: "UQ_BidSheetLocationLinks_Sheet_Location",
                schema: "dbo",
                table: "BidSheetLocationLinks",
                columns: new[] { "BidSheetId", "BidSheetLocationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BidSheets_OwnerUserId",
                schema: "dbo",
                table: "BidSheets",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "UQ_BidSheets_Owner_Name",
                schema: "dbo",
                table: "BidSheets",
                columns: new[] { "OwnerUserId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BidSheetShares_MemberUserId",
                schema: "dbo",
                table: "BidSheetShares",
                column: "MemberUserId");

            migrationBuilder.CreateIndex(
                name: "UQ_BidSheetShares_Sheet_Member",
                schema: "dbo",
                table: "BidSheetShares",
                columns: new[] { "BidSheetId", "MemberUserId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BidSheetLocationLinks",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "BidSheetShares",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "BidSheets",
                schema: "dbo");
        }
    }
}
