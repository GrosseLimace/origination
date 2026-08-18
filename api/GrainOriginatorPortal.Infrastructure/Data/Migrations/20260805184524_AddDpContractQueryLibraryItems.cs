using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Seeds the "DP Contracts" curated prompt cards into dbo.QueryLibrary so Build A List surfaces
    /// them (selecting a card runs its QueryText through the NLQ engine, which understands DP /
    /// delayed-pricing phrasing). The category name must stay exactly "DP Contracts" — build-list's
    /// showDpFilters and the dimension-aware crop filter both key off it, so a rename would silently
    /// drop the DP refine panel and the crop scoping.
    ///
    /// Data-only: no schema change, which is why the generated Up/Down were empty. Inserts are guarded
    /// by NOT EXISTS on QueryText so re-running — or running after the rows were added manually in an
    /// environment — is a no-op.
    /// </summary>
    public partial class AddDpContractQueryLibraryItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The ranked card's Name states its cap ("Top 25 …") because the query text is what
            // enforces it — a card called just "Top by DP bushels" gives no hint that 25 is the
            // limit, so a producer beyond the cut looks like a missing result.
            migrationBuilder.Sql(@"
DECLARE @cards TABLE (Category nvarchar(100), Name nvarchar(200), Description nvarchar(500),
                      QueryText nvarchar(500), Tags nvarchar(500), SortOrder int);

INSERT INTO @cards (Category, Name, Description, QueryText, Tags, SortOrder)
VALUES
    ('DP Contracts', 'Has DP contracts',       'Producers holding grain on a delayed-pricing contract.',                  'Producers with DP contracts',         'dp,delayed pricing',     10),
    ('DP Contracts', 'On DP over 90 days',     'DP positions that have been accruing for over 90 days.',                  'Producers on DP over 90 days',        'dp,days,aging',          20),
    ('DP Contracts', 'DP charges over $500',   'Producers whose accumulated DP charges exceed $500.',                     'Producers with DP charges over $500', 'dp,charges,cost',        30),
    ('DP Contracts', 'Top 25 by DP bushels',   'The 25 producers with the most bushels on DP. Capped at 25 results.',     'Top 25 producers by DP bushels',      'dp,top,ranking,bushels', 40),
    ('DP Contracts', 'No DP contracts',        'Producers with no delayed-pricing positions.',                            'Producers with no dp',                'dp,none',                50);

INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT c.Category, c.Name, c.Description, c.QueryText, c.Tags, c.SortOrder, 1, SYSUTCDATETIME()
FROM @cards c
WHERE NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary q WHERE q.QueryText = c.QueryText);

-- Self-correcting: brings the label/description of already-seeded rows in line, so an environment
-- that got an earlier version of these cards is fixed without needing a second migration.
UPDATE q
SET q.Name = c.Name, q.Description = c.Description, q.Tags = c.Tags,
    q.SortOrder = c.SortOrder, q.ModifiedAt = SYSUTCDATETIME()
FROM dbo.QueryLibrary q
JOIN @cards c ON c.QueryText = q.QueryText
WHERE q.Name <> c.Name OR ISNULL(q.Description, '') <> c.Description;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM dbo.QueryLibrary
WHERE QueryText IN (
    'Producers with DP contracts',
    'Producers on DP over 90 days',
    'Producers with DP charges over $500',
    'Top 25 producers by DP bushels',
    'Producers with no dp'
);");
        }
    }
}
