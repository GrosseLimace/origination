using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class CreateDailyRecapGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DailyRecapGroups",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    DeliveryMethod = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    TeamsChannelEmail = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    Enabled = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyRecapGroups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "DailyRecapGroupCcEmails",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RecapGroupId = table.Column<int>(type: "int", nullable: false),
                    Email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyRecapGroupCcEmails", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DailyRecapGroupCcEmails_DailyRecapGroups_RecapGroupId",
                        column: x => x.RecapGroupId,
                        principalSchema: "dbo",
                        principalTable: "DailyRecapGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "DailyRecapGroupMembers",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RecapGroupId = table.Column<int>(type: "int", nullable: false),
                    MemberType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    MemberId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    MemberName = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyRecapGroupMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DailyRecapGroupMembers_DailyRecapGroups_RecapGroupId",
                        column: x => x.RecapGroupId,
                        principalSchema: "dbo",
                        principalTable: "DailyRecapGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DailyRecapGroupCcEmails_RecapGroupId",
                schema: "dbo",
                table: "DailyRecapGroupCcEmails",
                column: "RecapGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_DailyRecapGroupMembers_RecapGroupId",
                schema: "dbo",
                table: "DailyRecapGroupMembers",
                column: "RecapGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_DailyRecapGroups_CreatedBy",
                schema: "dbo",
                table: "DailyRecapGroups",
                column: "CreatedBy");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyRecapGroupCcEmails",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "DailyRecapGroupMembers",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "DailyRecapGroups",
                schema: "dbo");
        }
    }
}
