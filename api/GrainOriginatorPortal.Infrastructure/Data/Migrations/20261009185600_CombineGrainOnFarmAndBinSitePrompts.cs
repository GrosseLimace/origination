using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Data only (user 2026-10-09): Build a List's grain-on-farm and bin-site prompts share one library
    /// column, "Grain on Farm &amp; Bin Sites" — grain on farm is now stored at a bin site. Renames the
    /// "Grain on Farm" category (admin-added cards in it move too) and moves the three bin-site cards
    /// out of "Producers" to the end of it, matched by QueryText (ids differ per environment), with
    /// descriptions that no longer say a site is only a latitude/longitude. The client also accepts the
    /// old category name, because a saved list remembers its prompt's category in its Filters JSON.
    /// Down puts the cards back under "Producers" and the category back to "Grain on Farm".
    /// </summary>
    public partial class CombineGrainOnFarmAndBinSitePrompts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
UPDATE dbo.QueryLibrary SET Category = N'Grain on Farm & Bin Sites' WHERE Category = N'Grain on Farm';

DECLARE @base int = ISNULL((SELECT MAX(SortOrder) FROM dbo.QueryLibrary WHERE Category = N'Grain on Farm & Bin Sites'), 0);

UPDATE dbo.QueryLibrary
SET Category = N'Grain on Farm & Bin Sites',
    SortOrder = @base + CASE QueryText
        WHEN N'Producers with bin sites' THEN 10
        WHEN N'Producers with multiple bin sites' THEN 20
        WHEN N'Producers without bin sites' THEN 30 END,
    Description = CASE QueryText
        WHEN N'Producers with bin sites' THEN N'Producers with at least one bin site recorded on their profile.'
        WHEN N'Producers with multiple bin sites' THEN N'Producers with two or more bin sites recorded.'
        WHEN N'Producers without bin sites' THEN N'Producers with no bin site recorded yet. Useful for filling in where their bins are and what is in them.' END
WHERE Category = N'Producers'
  AND QueryText IN (N'Producers with bin sites', N'Producers with multiple bin sites', N'Producers without bin sites');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DECLARE @base int = ISNULL((SELECT MAX(SortOrder) FROM dbo.QueryLibrary WHERE Category = N'Producers'), 0);

UPDATE dbo.QueryLibrary
SET Category = N'Producers',
    SortOrder = @base + CASE QueryText
        WHEN N'Producers with bin sites' THEN 10
        WHEN N'Producers without bin sites' THEN 20
        WHEN N'Producers with multiple bin sites' THEN 30 END,
    Description = CASE QueryText
        WHEN N'Producers with bin sites' THEN N'Producers with at least one bin site (latitude and longitude) recorded on their profile.'
        WHEN N'Producers with multiple bin sites' THEN N'Producers with two or more bin sites recorded.'
        WHEN N'Producers without bin sites' THEN N'Producers with no bin site recorded yet. Useful for filling in where their bins are.' END
WHERE Category = N'Grain on Farm & Bin Sites'
  AND QueryText IN (N'Producers with bin sites', N'Producers with multiple bin sites', N'Producers without bin sites');

UPDATE dbo.QueryLibrary SET Category = N'Grain on Farm' WHERE Category = N'Grain on Farm & Bin Sites';");
        }
    }
}
