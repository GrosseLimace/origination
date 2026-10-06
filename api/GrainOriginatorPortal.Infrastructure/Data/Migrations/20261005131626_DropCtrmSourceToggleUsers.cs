using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class DropCtrmSourceToggleUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Retires the TEMPORARY tester list of the ODS / CTRM toggle (created by
            // 20261001133422_AddCtrmSourceToggleUsers). From the 2026-10-06 go-live every user reads CTRM and
            // the toggle and its code are removed, so the table has no reader. The data loss EF warns about is
            // intended: it only ever held the validation group's names.
            migrationBuilder.DropTable(
                name: "CtrmSourceToggleUsers",
                schema: "dbo");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CtrmSourceToggleUsers",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false, defaultValue: "system"),
                    DisplayName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    Notes = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    UserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CtrmSourceToggleUsers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CtrmSourceToggleUsers_UserId",
                schema: "dbo",
                table: "CtrmSourceToggleUsers",
                column: "UserId",
                unique: true);
        }
    }
}
