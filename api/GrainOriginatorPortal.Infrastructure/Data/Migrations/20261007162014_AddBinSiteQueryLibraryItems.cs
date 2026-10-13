using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds three bin-site cards to the Build-A-List Producers category: producers with bin sites,
    /// without bin sites, and with multiple bin sites. Bin sites are the lat/long locations recorded
    /// under a producer's address (dbo.ProducerBinSite); the cards resolve client-side through the
    /// NLQ parser's bin-site patterns, which are kept apart from the bin-CAPACITY ones.
    ///
    /// Each insert is guarded on QueryText so a re-run is harmless. SortOrder is derived rather than
    /// hardcoded because the original rows were inserted straight into each database and the
    /// numbering differs per environment.
    /// </summary>
    public partial class AddBinSiteQueryLibraryItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary WHERE QueryText = 'Producers with bin sites')
INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT 'Producers', 'Bin Sites Recorded',
       'Producers with at least one bin site (latitude and longitude) recorded on their profile.',
       'Producers with bin sites', 'producers,bin sites,bins,location,gps,map',
       ISNULL((SELECT MAX(SortOrder) FROM dbo.QueryLibrary WHERE Category = 'Producers'), 0) + 10,
       1, SYSUTCDATETIME();

IF NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary WHERE QueryText = 'Producers without bin sites')
INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT 'Producers', 'No Bin Sites Yet',
       'Producers with no bin site recorded yet. Useful for filling in where their bins are.',
       'Producers without bin sites', 'producers,bin sites,bins,location,gps,missing',
       ISNULL((SELECT MAX(SortOrder) FROM dbo.QueryLibrary WHERE Category = 'Producers'), 0) + 10,
       1, SYSUTCDATETIME();

IF NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary WHERE QueryText = 'Producers with multiple bin sites')
INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT 'Producers', 'Multiple Bin Sites',
       'Producers with two or more bin sites recorded.',
       'Producers with multiple bin sites', 'producers,bin sites,bins,location,gps,multiple',
       ISNULL((SELECT MAX(SortOrder) FROM dbo.QueryLibrary WHERE Category = 'Producers'), 0) + 10,
       1, SYSUTCDATETIME();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM dbo.QueryLibrary
WHERE QueryText IN ('Producers with bin sites', 'Producers without bin sites', 'Producers with multiple bin sites');");
        }
    }
}
