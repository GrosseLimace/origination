using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Corrects three QueryLibrary cards whose display text drifted from (or never matched) what
    /// the NLQ parser actually does, and seeds the first card in a new "Producers" category —
    /// a blank starting point (matches every producer, no narrowing) for building a list purely
    /// from the refine panel (crops / states / delivery location / the General-panel fields).
    /// <para>
    /// "Notes mentioning bin" only ever searched the literal word "bin" despite promising a
    /// crop-in-storage search; broadened to also match the major grain crop names.
    /// "Top 10 by contract value" ranks by total contracted BUSHELS (a volume), not a dollar
    /// value — its own Description already said so. Renamed to match. Verified the new QueryText
    /// still contains "by contract" so <c>applyRankingFilters</c> keeps routing it the same way.
    /// "Top 10 largest operations" worked only via the "largest ... operations" -&gt; "top 10 by
    /// acres" synonym rewrite in <c>normalizeSynonyms</c>; pointed QueryText directly at "top 10
    /// by acres" (the ranking engine's default branch) to remove that indirection.
    /// </para>
    /// <para>
    /// The three corrections are UPDATE-only (the rows already exist) keyed on the CURRENT
    /// QueryText rather than Id, since card ids differ per environment — a no-op (0 rows) on any
    /// environment where the text was already corrected, so safe to re-run. The Producers card is
    /// a guarded INSERT, same NOT EXISTS pattern the other card-seed migrations use.
    /// </para>
    /// </summary>
    public partial class FixQueryLibraryCardWordingAndAddProducersCategory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
UPDATE dbo.QueryLibrary
SET QueryText = 'Notes mentioning bin corn soybeans wheat oats barley sorghum milo canola and sunflower',
    Description = 'Producers whose notes mention a stored crop or bin',
    ModifiedAt = SYSUTCDATETIME()
WHERE QueryText = 'Notes mentioning bin';

UPDATE dbo.QueryLibrary
SET Name = 'Top 10 by contracted bushels',
    QueryText = 'Top 10 by contracted bushels',
    ModifiedAt = SYSUTCDATETIME()
WHERE QueryText = 'Top 10 by contract value';

UPDATE dbo.QueryLibrary
SET QueryText = 'Top 10 by acres',
    ModifiedAt = SYSUTCDATETIME()
WHERE QueryText = 'Top 10 largest operations';

IF NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary WHERE QueryText = 'All producers')
INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT 'Producers', 'All Producers',
       'Every producer in the selected trade unit(s), unfiltered - start here and narrow with the refine filters below.',
       'All producers', 'producers,all,broad',
       ISNULL((SELECT MAX(SortOrder) FROM dbo.QueryLibrary WHERE Category = 'Producers'), 0) + 10,
       1, SYSUTCDATETIME();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM dbo.QueryLibrary WHERE QueryText = 'All producers';

UPDATE dbo.QueryLibrary
SET QueryText = 'Top 10 largest operations',
    ModifiedAt = SYSUTCDATETIME()
WHERE QueryText = 'Top 10 by acres';

UPDATE dbo.QueryLibrary
SET Name = 'Top 10 by contract value',
    QueryText = 'Top 10 by contract value',
    ModifiedAt = SYSUTCDATETIME()
WHERE QueryText = 'Top 10 by contracted bushels';

UPDATE dbo.QueryLibrary
SET QueryText = 'Notes mentioning bin',
    Description = 'Producers whose notes mention grain in the bin',
    ModifiedAt = SYSUTCDATETIME()
WHERE QueryText = 'Notes mentioning bin corn soybeans wheat oats barley sorghum milo canola and sunflower';");
        }
    }
}
