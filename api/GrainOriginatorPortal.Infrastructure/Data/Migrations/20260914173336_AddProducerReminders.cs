using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddProducerReminders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProducerReminders",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    DueAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Subject = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    OutlookEventId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    IsCompleted = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    CompletedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProducerReminders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProducerReminders_Customer_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProducerReminders_CreatedBy_DueAt",
                schema: "dbo",
                table: "ProducerReminders",
                columns: new[] { "CreatedBy", "DueAt" },
                filter: "[IsCompleted] = 0");

            migrationBuilder.CreateIndex(
                name: "IX_ProducerReminders_CustomerId_CreatedBy_IsCompleted",
                schema: "dbo",
                table: "ProducerReminders",
                columns: new[] { "CustomerId", "CreatedBy", "IsCompleted" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProducerReminders",
                schema: "dbo");
        }
    }
}
