using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFieldPlanDocument : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FieldPlanDocument",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    DocStoreId = table.Column<string>(type: "nvarchar(36)", maxLength: 36, nullable: false),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    CropYear = table.Column<int>(type: "int", nullable: false),
                    DocumentType = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    FieldProgramRecordId = table.Column<int>(type: "int", nullable: true),
                    SplitId = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Commodity = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    FileName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    ContentType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    CreatedByName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FieldPlanDocument", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FieldPlanDocument_Customer_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                    table.ForeignKey(
                        name: "FK_FieldPlanDocument_FieldProgramRecord_FieldProgramRecordId",
                        column: x => x.FieldProgramRecordId,
                        principalSchema: "dbo",
                        principalTable: "FieldProgramRecord",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_FieldPlanDocument_Customer_CropYear",
                schema: "dbo",
                table: "FieldPlanDocument",
                columns: new[] { "CustomerId", "CropYear" });

            migrationBuilder.CreateIndex(
                name: "IX_FieldPlanDocument_FieldProgramRecordId",
                schema: "dbo",
                table: "FieldPlanDocument",
                column: "FieldProgramRecordId");

            migrationBuilder.CreateIndex(
                name: "UQ_FieldPlanDocument_DocStoreId",
                schema: "dbo",
                table: "FieldPlanDocument",
                column: "DocStoreId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FieldPlanDocument",
                schema: "dbo");
        }
    }
}
