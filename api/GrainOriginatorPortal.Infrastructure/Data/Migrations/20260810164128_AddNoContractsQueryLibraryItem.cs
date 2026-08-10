using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Seeds the "No contracts" Build-A-List prompt card under the Contracts category — the inverse
    /// of the existing has-contracts cards, i.e. the "who should I be calling?" list.
    /// <para>
    /// No application code is needed: the NLQ engine already filters this phrasing
    /// (<c>NlqFilterService.applyContractFilters</c> matches "no contract(s)" / "without contract"
    /// and keeps producers with zero OPEN contracts). The QueryText must contain "contract" so the
    /// contracts-load gate engages — otherwise a failed contract load would leave the filter set
    /// empty and the card would match every producer. It deliberately avoids the words "planting"
    /// and "deliver", which route to the cross-entity rules instead.
    /// </para>
    /// <para>
    /// SortOrder is computed as (max within the Contracts category + 10) rather than hardcoded: the
    /// existing Contracts cards were inserted straight into each database and are not in source
    /// control, so their numbering differs per environment. This lands the card at the end of the
    /// Contracts list wherever it runs. Idempotent — the NOT EXISTS guard keys on QueryText, and the
    /// UPDATE repairs the display text if this card was already seeded with different wording.
    /// </para>
    /// </summary>
    public partial class AddNoContractsQueryLibraryItem : Migration
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
    Tags        nvarchar(500)
);

INSERT INTO @cards (Category, Name, Description, QueryText, Tags) VALUES
    ('Contracts', 'No contracts', 'Producers with no open contracts.', 'Producers with no contracts', 'contracts,none,uncontracted');

-- Append after whatever Contracts cards this environment already has.
DECLARE @sortOrder int =
    (SELECT ISNULL(MAX(SortOrder), 0) + 10 FROM dbo.QueryLibrary WHERE Category = 'Contracts');

INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT c.Category, c.Name, c.Description, c.QueryText, c.Tags, @sortOrder, 1, SYSUTCDATETIME()
FROM @cards c
WHERE NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary q WHERE q.QueryText = c.QueryText);

-- Self-correcting: if an environment already received this card with different wording, bring the
-- display text back in line without needing a follow-up migration.
UPDATE q
SET q.Name        = c.Name,
    q.Description = c.Description,
    q.Tags        = c.Tags,
    q.IsActive    = 1,
    q.ModifiedAt  = SYSUTCDATETIME()
FROM dbo.QueryLibrary q
JOIN @cards c ON c.QueryText = q.QueryText
WHERE q.Name <> c.Name
   OR ISNULL(q.Description, '') <> c.Description
   OR ISNULL(q.Tags, '') <> c.Tags
   OR q.IsActive = 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "DELETE FROM dbo.QueryLibrary WHERE QueryText = 'Producers with no contracts';");
        }
    }
}
