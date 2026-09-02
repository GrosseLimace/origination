using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCommodityTradeUnitScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TradeUnitScope",
                schema: "dbo",
                table: "Commodities",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            // Four specialty soy/corn grades for trade units 2090, 2291 and 2295. Those three are
            // only half of Organics & IP, so TradeGroupScope cannot express this -- see the
            // TradeUnitScope doc comment on the Commodity entity.
            //
            // Insert-if-missing first, same reason as AddCommodityTradeGroupScope: dbo.Commodities
            // is hand-curated and its bulk seed (Scripts/PopulateCommodities.sql) is run by hand in
            // SSMS, so these rows exist in Dev but may not in QA/PROD. A bare UPDATE would affect
            // zero rows, report success, and ship a dead feature. Names/categories are copied
            // verbatim from that script (L286, L288, L406, L721).
            migrationBuilder.Sql(@"
                INSERT INTO dbo.Commodities (Code, Name, Category, IsActive, ShowInPlantingIntentions)
                SELECT s.Code, s.Name, s.Category, 1, 0
                FROM (VALUES
                    ('DNGS', 'DEHULLED NON-GMO SOYBEANS', 'SOYBEANS'),
                    ('DOSB', 'DEHULLED ORGANIC SOYBEANS', 'SOYBEANS'),
                    ('HEC',  'HARD ENDOSPERM CORN',       'CORN'),
                    ('YWC',  'WAXY CORN',                 'CORN')
                ) AS s (Code, Name, Category)
                WHERE NOT EXISTS (SELECT 1 FROM dbo.Commodities c WHERE c.Code = s.Code);
            ");

            // Curated so they reach the pickers, and unit-scoped so only 2090/2291/2295 see them.
            // TradeGroupScope is deliberately left NULL: these are additive to what those units
            // already get from the Organics group scope, and the two columns OR together.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET ShowInPlantingIntentions = 1,
                    TradeUnitScope = N'2090,2291,2295'
                WHERE Code IN ('DNGS', 'DOSB', 'HEC', 'YWC');
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Take the four back out of the curated picker list. The rows themselves stay -- they are
            // legitimate CTRM commodities that existing contracts and tickets resolve names against,
            // and dropping the column already discards the unit scope.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET ShowInPlantingIntentions = 0
                WHERE Code IN ('DNGS', 'DOSB', 'HEC', 'YWC');
            ");

            migrationBuilder.DropColumn(
                name: "TradeUnitScope",
                schema: "dbo",
                table: "Commodities");
        }
    }
}
