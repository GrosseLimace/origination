using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCommodityTradeGroupScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TradeGroupScope",
                schema: "dbo",
                table: "Commodities",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            // The four Organics & IP crops. dbo.Commodities is hand-curated (see Program.cs) and its
            // bulk seed, Scripts/PopulateCommodities.sql, is run by hand in SSMS -- so we cannot
            // assume these rows already exist in every environment. A bare UPDATE would affect zero
            // rows, report success, and ship a dead feature. Insert-if-missing first using the exact
            // CTRM code/name/category from that script, then set visibility. Idempotent: safe to
            // re-run, and it converges a partially seeded table.
            migrationBuilder.Sql(@"
                INSERT INTO dbo.Commodities (Code, Name, Category, IsActive, ShowInPlantingIntentions)
                SELECT s.Code, s.Name, s.Category, 1, 0
                FROM (VALUES
                    ('HRWO', 'ORGANIC HARD RED WINTER WHEAT', 'WHEAT'),
                    ('WHTO', 'ORGANIC WHEAT',                 'WHEAT'),
                    ('YCO',  'ORGANIC YELLOW CORN',           'CORN'),
                    ('YSBO', 'ORGANIC SOYBEANS',              'SOYBEANS')
                ) AS s (Code, Name, Category)
                WHERE NOT EXISTS (SELECT 1 FROM dbo.Commodities c WHERE c.Code = s.Code);
            ");

            // Curated, so they reach the pickers -- AND scoped, so only Organics & IP actually sees
            // them. 'Organics' (not the full group name) is matched client-side as a case-insensitive
            // SUBSTRING of the trade group name, so this still resolves if the group is renamed from
            // "Organics & IP".
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET ShowInPlantingIntentions = 1,
                    TradeGroupScope = N'Organics'
                WHERE Code IN ('HRWO', 'WHTO', 'YCO', 'YSBO');
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Take the four back out of the curated picker list. The rows themselves stay -- they are
            // legitimate CTRM commodities that existing contracts and tickets resolve names against,
            // and dropping the column already discards the scope.
            migrationBuilder.Sql(@"
                UPDATE dbo.Commodities
                SET ShowInPlantingIntentions = 0
                WHERE Code IN ('HRWO', 'WHTO', 'YCO', 'YSBO');
            ");

            migrationBuilder.DropColumn(
                name: "TradeGroupScope",
                schema: "dbo",
                table: "Commodities");
        }
    }
}
