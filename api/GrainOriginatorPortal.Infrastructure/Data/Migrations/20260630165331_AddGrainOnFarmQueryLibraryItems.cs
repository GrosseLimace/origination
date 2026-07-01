using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Seeds the four "Grain on Farm" curated prompt cards into dbo.QueryLibrary so the Build A List
    /// page surfaces them (selecting a card runs its QueryText through the NLQ engine, which now
    /// understands grain-on-farm / target phrasing). Inserts are guarded by NOT EXISTS on QueryText
    /// so re-running — or running after the rows were added manually in an environment — is a no-op.
    /// </summary>
    public partial class AddGrainOnFarmQueryLibraryItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT v.Category, v.Name, v.Description, v.QueryText, v.Tags, v.SortOrder, 1, SYSUTCDATETIME()
FROM (VALUES
    ('Grain on Farm', 'Has grain on farm',     'Producers with bushels on hand entered on their profile.', 'Producers with grain on farm',       'grain,on farm,bushels', 10),
    ('Grain on Farm', 'No target set',         'Has grain on farm but no $/bu target price set yet.',      'Grain on farm with no target set',   'grain,target',          20),
    ('Grain on Farm', 'Has a target price',    'Has a $/bu target set on at least one commodity.',         'Producers with a grain target',      'grain,target,price',    30),
    ('Grain on Farm', 'Top by grain on farm',  'Producers ranked by total bushels on hand.',               'Top 25 producers by grain on farm',  'grain,top,ranking',     40)
) AS v(Category, Name, Description, QueryText, Tags, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary q WHERE q.QueryText = v.QueryText);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM dbo.QueryLibrary
WHERE QueryText IN (
    'Producers with grain on farm',
    'Grain on farm with no target set',
    'Producers with a grain target',
    'Top 25 producers by grain on farm'
);");
        }
    }
}
