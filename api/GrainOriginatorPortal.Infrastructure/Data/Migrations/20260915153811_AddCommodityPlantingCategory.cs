using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCommodityPlantingCategory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PlantingCategory",
                schema: "dbo",
                table: "Commodities",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            // The label is the MARKET the grain sells into, which is what acres, season targets and
            // contract coverage should be grouped by on the planting surfaces. Category is left alone on
            // purpose: it is the app-wide crop-group key (Build-A-List chips, NLQ, colours) and changing
            // it would re-group these everywhere, not just on planting. Three groups of rows:
            //
            //   1. The Organics & IP crops the planting pickers offer, curated by AddCommodityTradeGroupScope
            //      (YSBO, YCO, HRWO, WHTO) and AddCommodityTradeUnitScope (DNGS, DOSB, HEC, YWC). These
            //      drive the labels planting rows are grouped under. Organic wheat CLASSES collapse to
            //      "Organic Wheat" exactly as HRWW/SRWW collapse to "Wheat"; the IP grades are distinct
            //      products with their own contracts, so each keeps its own name (YWC is "Waxy Corn",
            //      not "Corn").
            //   2. Organic grain rows that are never planted through the app but DO appear on purchase
            //      contracts (Dev ODS 2026-09-15: BARO 5, SORO 2). Labelling them keeps the CONTRACT side
            //      of coverage consistent -- an organic barley contract no longer counts toward a
            //      conventional Barley planting row.
            //   3. Deliberately untouched: YCNG / NYSB (non-GMO corn and soybeans, offered to EVERY trade
            //      unit since the original curated list) still group under Corn / Soybeans -- splitting
            //      them out is a business call for the conventional units; and organic products outside
            //      the field-crop categories (oils, meals, pellets, "Other Grain" oats).
            //
            // A plain UPDATE: the eight curated rows are guaranteed by the two insert-if-missing
            // migrations above; the others simply stay unlabelled in an environment that lacks them,
            // which is the same as today.
            migrationBuilder.Sql(@"
                UPDATE c
                SET PlantingCategory = s.PlantingCategory
                FROM dbo.Commodities c
                JOIN (VALUES
                    -- Organics (group-scoped, curated)
                    ('YSBO', N'Organic Soybeans'),
                    ('YCO',  N'Organic Corn'),
                    ('HRWO', N'Organic Wheat'),
                    ('WHTO', N'Organic Wheat'),
                    -- IP grades (unit-scoped to 2090/2291/2295, curated)
                    ('YWC',  N'Waxy Corn'),
                    ('HEC',  N'Hard Endosperm Corn'),
                    ('DNGS', N'Dehulled Non-GMO Soybeans'),
                    ('DOSB', N'Dehulled Organic Soybeans'),
                    -- Organic grain on contracts only (not curated)
                    ('A083', N'Organic Soybeans'),
                    ('A084', N'Organic Soybeans'),
                    ('WCO',  N'Organic Corn'),
                    ('RSWO', N'Organic Wheat'),
                    ('SORO', N'Organic Sorghum'),
                    ('BARO', N'Organic Barley'),
                    ('CNLO', N'Organic Canola')
                ) AS s (Code, PlantingCategory) ON s.Code = c.Code;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Dropping the column discards the labels; nothing else to undo.
            migrationBuilder.DropColumn(
                name: "PlantingCategory",
                schema: "dbo",
                table: "Commodities");
        }
    }
}
