using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   AddSelectedYearsToBidSheetPreference
       Author:      Origination engineering
       Description: Remembers which crop years the Edit Bids grid is showing, now that it shows several.
       Rollback:    Down() drops the column. The grid falls back to the panel's single year.
    */

    /// <summary>
    /// Stores the Edit Bids grid's crop-year selection, as a JSON array beside the SelectedMonths it
    /// composes with.
    ///
    /// The grid used to show one year, stepped with arrows, and nothing needed persisting because the
    /// year was re-seeded from the panel on every open. Multi-year selection is a deliberate
    /// arrangement the user builds, and re-opening the grid happens on paths they would not expect to
    /// lose it -- adding a location reopens it -- so it has to survive.
    ///
    /// Nullable, and read defensively: a malformed value falls back to the panel's year rather than
    /// leaving the grid with no columns.
    /// </summary>
    public partial class AddSelectedYearsToBidSheetPreference : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SelectedYears",
                schema: "dbo",
                table: "BidSheetPreferences",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SelectedYears",
                schema: "dbo",
                table: "BidSheetPreferences");
        }
    }
}
