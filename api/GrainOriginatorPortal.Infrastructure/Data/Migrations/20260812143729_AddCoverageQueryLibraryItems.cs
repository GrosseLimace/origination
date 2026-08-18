using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Seeds the two production-coverage prompt cards under the Planting category — "Under 50%
    /// contracted" and "Highest uncontracted bushels" — the trade-unit-wide counterpart to the
    /// Growth Opportunity panel on a producer's page.
    /// <para>
    /// The handlers for these already existed but were UNREACHABLE. They were written when Build a
    /// List had a free-text NLQ box; commit 1f9bbc16 replaced that with the curated query library
    /// and no cards were ever created for them, so nothing could produce a query containing their
    /// trigger phrases (<c>BuildListComponent._applyPlantingCoverageFilter</c> is reached only from
    /// a gate matching "percent contracted" / "uncontracted").
    /// </para>
    /// <para>
    /// QueryText is load-bearing, not decorative — that gate matches the raw text. The first card
    /// must contain "under &lt;n&gt; percent contracted" (the threshold is parsed straight out of it
    /// by <c>/under\s+(\d+)\s*percent/</c>), and the second must contain "uncontracted". Rewording
    /// either past those phrases silently returns the card to dead code.
    /// </para>
    /// <para>
    /// SortOrder is computed from the category's current max rather than hardcoded: the existing
    /// cards were inserted straight into each database and are not in source control, so their
    /// numbering differs per environment. Idempotent — the NOT EXISTS guard keys on QueryText, and
    /// the UPDATE repairs the display text if a card was already seeded with different wording.
    /// </para>
    /// </summary>
    public partial class AddCoverageQueryLibraryItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DECLARE @cards TABLE (
    Category    nvarchar(100),
    Name        nvarchar(200),
    Description nvarchar(500),
    QueryText   nvarchar(500),
    SortBump    int
);

INSERT INTO @cards (Category, Name, Description, QueryText, SortBump) VALUES
    ('Planting', 'Under 50% contracted',
     'Producers who have contracted less than half of their projected production this season.',
     'Producers under 50 percent contracted', 10),
    ('Planting', 'Highest uncontracted bushels',
     'Top 10 producers by projected bushels not yet contracted.',
     'Producers with the highest uncontracted bushels', 20);

-- Append after whatever Planting cards this environment already has.
DECLARE @sortOrder int =
    (SELECT ISNULL(MAX(SortOrder), 0) FROM dbo.QueryLibrary WHERE Category = 'Planting');

INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT c.Category, c.Name, c.Description, c.QueryText,
       'planting,contracts,coverage,uncontracted', @sortOrder + c.SortBump, 1, SYSUTCDATETIME()
FROM @cards c
WHERE NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary q WHERE q.QueryText = c.QueryText);

-- Self-correcting: if an environment already received these with different wording, bring the
-- display text back in line without needing a follow-up migration.
UPDATE q
SET q.Name        = c.Name,
    q.Description = c.Description,
    q.IsActive    = 1,
    q.ModifiedAt  = SYSUTCDATETIME()
FROM dbo.QueryLibrary q
JOIN @cards c ON c.QueryText = q.QueryText
WHERE q.Name <> c.Name
   OR ISNULL(q.Description, '') <> c.Description
   OR q.IsActive = 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM dbo.QueryLibrary
WHERE QueryText IN ('Producers under 50 percent contracted',
                    'Producers with the highest uncontracted bushels');");
        }
    }
}
