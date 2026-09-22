using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Relabels the four flax grades on the planting surfaces by colour: BFL1/BFL2 group under
    /// "Brown Flax" and GFL1/GFL2 under "Golden Flax", not a single "Flax".
    ///
    /// AddFlaxCommoditiesForTradeUnit3811 collapsed both colours to one label on the wheat-class
    /// analogy. The business corrected that: brown and golden flax are distinct crops with their own
    /// acres, targets and contracts, so they must not be folded together. Only the grade number
    /// (#1/#2) is a quality spec that collapses. That migration is already applied in Dev, so this is
    /// a follow-up rather than an edit. Data-only; no model change.
    /// </summary>
    public partial class SplitFlaxPlantingCategoryByColour : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A plain UPDATE: the four rows are guaranteed by the insert-if-missing in the previous migration.
            migrationBuilder.Sql(@"
                UPDATE c
                SET PlantingCategory = s.PlantingCategory
                FROM dbo.Commodities c
                JOIN (VALUES
                    ('BFL1', N'Brown Flax'),
                    ('BFL2', N'Brown Flax'),
                    ('GFL1', N'Golden Flax'),
                    ('GFL2', N'Golden Flax')
                ) AS s (Code, PlantingCategory) ON s.Code = c.Code;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Back to the single label the previous migration set.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET PlantingCategory = N'Flax'
                WHERE Code IN ('BFL1', 'BFL2', 'GFL1', 'GFL2');
            ");
        }
    }
}
