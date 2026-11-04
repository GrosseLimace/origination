using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Drops dbo.ProgramEnrollment (user 2026-11-03): 45Z only calculates and confirms a CI, so no producer
    /// attestation, withdrawal or enrollment row is kept; a field is in 45Z when it has a FieldProgramRecord.
    /// Created by 20261029193914_AddFieldPlanTables (Dev and QA). Destructive for any enrollments entered (test data).
    /// Down recreates the table empty.
    /// </summary>
    public partial class DropProgramEnrollment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProgramEnrollment",
                schema: "dbo");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProgramEnrollment",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    Attestation = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    AttestedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    AttestedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    CropYear = table.Column<int>(type: "int", nullable: false),
                    EnrollmentKey = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWID()"),
                    HarvestCompleteAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ProgramKey = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Snapshot = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    WithdrawnReason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramEnrollment", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProgramEnrollment_Customer_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramEnrollment_Program_Year",
                schema: "dbo",
                table: "ProgramEnrollment",
                columns: new[] { "ProgramKey", "CropYear", "Status" });

            migrationBuilder.CreateIndex(
                name: "UQ_ProgramEnrollment_EnrollmentKey",
                schema: "dbo",
                table: "ProgramEnrollment",
                column: "EnrollmentKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UQ_ProgramEnrollment_Live",
                schema: "dbo",
                table: "ProgramEnrollment",
                columns: new[] { "CustomerId", "ProgramKey", "CropYear" },
                unique: true,
                filter: "[Status] IN ('Open', 'Attested')");
        }
    }
}
