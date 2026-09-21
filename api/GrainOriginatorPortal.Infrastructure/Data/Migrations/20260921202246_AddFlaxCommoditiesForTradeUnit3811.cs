using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the four flax grades (brown #1/#2, golden #1/#2) to the planting pickers for trade unit
    /// 3811 (Pulses Trading) and nobody else. Data-only: reuses the TradeUnitScope column that
    /// AddCommodityTradeUnitScope introduced for the 2090/2291/2295 grades, so no model change.
    /// </summary>
    public partial class AddFlaxCommoditiesForTradeUnit3811 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Insert-if-missing first, for the same reason as the two earlier scope migrations:
            // dbo.Commodities is hand-curated and its bulk seed (Scripts/PopulateCommodities.sql) is run
            // by hand in SSMS, so a bare UPDATE could touch zero rows, report success and ship a dead
            // feature. BFL1, BFL2 and GFL1 are copied verbatim from that script (L161, L162, L390).
            // GFL2 is NOT in the script (only GFL1 and GFL3 are); its name follows the same pattern and
            // its code is what the business asked for, so a contract carrying GFL2 in CTRM resolves to it.
            migrationBuilder.Sql(@"
                INSERT INTO dbo.Commodities (Code, Name, Category, IsActive, ShowInPlantingIntentions)
                SELECT s.Code, s.Name, s.Category, 1, 0
                FROM (VALUES
                    ('BFL1', 'BROWN FLAX #1',  'FEED & FERT INGREDIENTS'),
                    ('BFL2', 'BROWN FLAX #2',  'FEED & FERT INGREDIENTS'),
                    ('GFL1', 'GOLDEN FLAX #1', 'FEED & FERT INGREDIENTS'),
                    ('GFL2', 'GOLDEN FLAX #2', 'FEED & FERT INGREDIENTS')
                ) AS s (Code, Name, Category)
                WHERE NOT EXISTS (SELECT 1 FROM dbo.Commodities c WHERE c.Code = s.Code);
            ");

            // Curated so they reach the pickers, unit-scoped so only 3811 sees them, and labelled
            // "Flax" on the planting surfaces. Category is left alone on purpose -- it is the app-wide
            // crop-group key -- but its ODS value here is the commodity GROUP "FEED & FERT INGREDIENTS",
            // which is no crop label at all, so without PlantingCategory the dashboard would group flax
            // acres and coverage under that heading. The two colours of flax collapse to one label the
            // way HRWW/SRWW collapse to "Wheat"; the grade number is a quality spec, not a crop.
            // TradeGroupScope stays NULL: 3811 is not in an Organics group and the two scopes OR together.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET ShowInPlantingIntentions = 1,
                    TradeUnitScope = N'3811',
                    PlantingCategory = N'Flax'
                WHERE Code IN ('BFL1', 'BFL2', 'GFL1', 'GFL2');
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Take the four back out of the curated picker list and clear what this migration set. The
            // rows themselves stay -- they are legitimate CTRM commodities that existing contracts and
            // tickets resolve names against, and three of them predate this migration in the seed.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET ShowInPlantingIntentions = 0,
                    TradeUnitScope = NULL,
                    PlantingCategory = NULL
                WHERE Code IN ('BFL1', 'BFL2', 'GFL1', 'GFL2');
            ");
        }
    }
}
