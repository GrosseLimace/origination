using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// A field is on a crop row (planting intention) once: a unique index on dbo.ProducerFieldSeason
    /// (ProducerFieldId, PlantingIntentionId), soft-deleted rows excluded. Backs FieldPlanService's
    /// FIELD_PLAN_FIELD_ON_ROW check in the database (user 2026-11-03). Fails if duplicate live rows exist;
    /// none can today, as Dev and QA run the field plan in memory.
    /// </summary>
    public partial class AddFieldSeasonUniqueRow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "UQ_ProducerFieldSeason_Field_PlantingIntention",
                schema: "dbo",
                table: "ProducerFieldSeason",
                columns: new[] { "ProducerFieldId", "PlantingIntentionId" },
                unique: true,
                filter: "[IsDeleted] = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UQ_ProducerFieldSeason_Field_PlantingIntention",
                schema: "dbo",
                table: "ProducerFieldSeason");
        }
    }
}
