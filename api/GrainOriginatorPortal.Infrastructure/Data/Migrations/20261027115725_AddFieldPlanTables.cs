using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   AddFieldPlanTables
       Author:      Origination engineering
       Description: Schema only. Four new tables for the field plan and sustainability programs (45Z,
                    GrainCraft): ProducerField (a producer's CTRM split), ProducerFieldSeason (a field on a
                    crop row for a year), FieldProgramRecord (a season's program inputs and locked estimate)
                    and ProgramEnrollment. No existing table or row is touched.
       Rollback:    Down() drops the four tables (their data goes with them).
    */
    /// <summary>
    /// See docs/application-context/Field Plan - Database Plan.md. APPROVAL GATE: every deploy runs
    /// "dotnet ef database update", so this must not reach main or a release branch before that plan is approved.
    /// </summary>
    public partial class AddFieldPlanTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProducerField",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    SplitId = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    SplitPercent = table.Column<decimal>(type: "decimal(7,3)", nullable: false),
                    EffectiveDate = table.Column<DateOnly>(type: "date", nullable: true),
                    State = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: true),
                    County = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProducerField", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProducerField_Customer_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                });

            migrationBuilder.CreateTable(
                name: "ProgramEnrollment",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    EnrollmentKey = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWID()"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    ProgramKey = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    CropYear = table.Column<int>(type: "int", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Attestation = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    AttestedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    AttestedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    Snapshot = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    HarvestCompleteAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    WithdrawnReason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true)
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

            migrationBuilder.CreateTable(
                name: "ProducerFieldSeason",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProducerFieldId = table.Column<int>(type: "int", nullable: false),
                    PlantingIntentionId = table.Column<int>(type: "int", nullable: false),
                    CropYear = table.Column<int>(type: "int", nullable: false),
                    CropLabel = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Acres = table.Column<decimal>(type: "decimal(10,2)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    DeletedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProducerFieldSeason", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProducerFieldSeason_ProducerField_ProducerFieldId",
                        column: x => x.ProducerFieldId,
                        principalSchema: "dbo",
                        principalTable: "ProducerField",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ProducerFieldSeason_ProducerPlantingIntentions_PlantingIntentionId",
                        column: x => x.PlantingIntentionId,
                        principalSchema: "dbo",
                        principalTable: "ProducerPlantingIntentions",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "FieldProgramRecord",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProducerFieldSeasonId = table.Column<int>(type: "int", nullable: false),
                    ProgramKey = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Data = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CopiedFromYear = table.Column<int>(type: "int", nullable: true),
                    CopiedFromField = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    Frozen = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    LockedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    LockedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    Reopened = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Official = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    DeletedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FieldProgramRecord", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FieldProgramRecord_ProducerFieldSeason_ProducerFieldSeasonId",
                        column: x => x.ProducerFieldSeasonId,
                        principalSchema: "dbo",
                        principalTable: "ProducerFieldSeason",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "UQ_FieldProgramRecord_Season_Program",
                schema: "dbo",
                table: "FieldProgramRecord",
                columns: new[] { "ProducerFieldSeasonId", "ProgramKey" },
                unique: true,
                filter: "[IsDeleted] = 0");

            migrationBuilder.CreateIndex(
                name: "IX_ProducerField_CustomerId",
                schema: "dbo",
                table: "ProducerField",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "UQ_ProducerField_SplitId",
                schema: "dbo",
                table: "ProducerField",
                column: "SplitId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProducerFieldSeason_PlantingIntentionId",
                schema: "dbo",
                table: "ProducerFieldSeason",
                column: "PlantingIntentionId");

            migrationBuilder.CreateIndex(
                name: "IX_ProducerFieldSeason_ProducerFieldId",
                schema: "dbo",
                table: "ProducerFieldSeason",
                column: "ProducerFieldId");

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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FieldProgramRecord",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "ProgramEnrollment",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "ProducerFieldSeason",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "ProducerField",
                schema: "dbo");
        }
    }
}
