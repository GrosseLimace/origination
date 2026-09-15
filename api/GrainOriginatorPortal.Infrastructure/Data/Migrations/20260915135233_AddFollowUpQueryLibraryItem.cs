using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the "Follow-Ups Scheduled" card to the Build-A-List Producers category.
    ///
    /// The card resolves entirely client-side against the caller's own open follow-ups, so it needs
    /// no new API surface. Seeded active: where the reminders feature is flagged off the client
    /// hides the card, and a saved list built from it simply resolves to nobody.
    ///
    /// SortOrder is derived rather than hardcoded because the original rows were inserted straight
    /// into each database and the numbering differs per environment.
    /// </summary>
    public partial class AddFollowUpQueryLibraryItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary WHERE QueryText = 'Producers with a follow-up scheduled')
INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT 'Producers', 'Follow-Ups Scheduled',
       'Producers you have an open follow-up reminder for, including any you have missed. Only your own follow-ups are listed.',
       'Producers with a follow-up scheduled', 'producers,follow-up,reminders',
       ISNULL((SELECT MAX(SortOrder) FROM dbo.QueryLibrary WHERE Category = 'Producers'), 0) + 10,
       1, SYSUTCDATETIME();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM dbo.QueryLibrary WHERE QueryText = 'Producers with a follow-up scheduled';");
        }
    }
}
