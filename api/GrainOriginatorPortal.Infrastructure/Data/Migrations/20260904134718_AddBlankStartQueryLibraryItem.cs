using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Seeds the second Producers-category card: a deliberately blank starting point (the
    /// opposite of "All Producers") so a user can build a list entirely by hand via Manage
    /// Members — search, add one at a time, starting from zero.
    /// <para>
    /// QueryText is load-bearing here in an unusual way: NlqFilterService.filterCustomers has an
    /// exact-match early return for "start with no producers" (lowercased, trimmed) that returns
    /// []  BEFORE any other rule runs — every other unrecognized query defaults to matching
    /// EVERYONE (filterCustomers only ever narrows from the full list), so this is the only way
    /// a card can mean "match nobody." Rewording the card without updating that check would
    /// silently turn it into another "All Producers."
    /// </para>
    /// </summary>
    public partial class AddBlankStartQueryLibraryItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary WHERE QueryText = 'Start with no producers')
INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT 'Producers', 'Start From Scratch',
       'Begin with an empty list and manually search for and add the producers you want, one at a time.',
       'Start with no producers', 'producers,blank,manual,scratch',
       ISNULL((SELECT MAX(SortOrder) FROM dbo.QueryLibrary WHERE Category = 'Producers'), 0) + 10,
       1, SYSUTCDATETIME();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM dbo.QueryLibrary WHERE QueryText = 'Start with no producers';");
        }
    }
}
