using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   AddUniqueBarchartPlacementIndex
       Author:      Origination engineering
       Description: One placement of a BarChart location per trade unit, enforced by the database
                    instead of only by an application read-then-write check.
       Rollback:    Down() drops the index. No data change either way.
    */

    /// <summary>
    /// Stops a trade unit ending up with two rows for one BarChart elevator.
    ///
    /// The application checks for an existing placement before inserting, but the bulk add fires its
    /// creates in PARALLEL — so two creates for the same (trade unit, location) pair could both pass
    /// that check and both insert. The result was a duplicated row carrying duplicated fed bids, which
    /// then shadow each other in the client's name-keyed bid lookup.
    ///
    /// Filtered on BarchartLocationKey IS NOT NULL because most rows are manual locations with no key,
    /// and SQL Server would otherwise treat all those NULLs as colliding. Safe to apply anywhere: no
    /// environment can hold a duplicate yet (verified zero on Dev; the feed has never run elsewhere).
    ///
    /// Note the sibling rule this does NOT cover — unique location NAME per trade unit is still only an
    /// application check. That table predates the rule by years, so adding it needs a duplicate sweep
    /// of every environment first.
    /// </summary>
    public partial class AddUniqueBarchartPlacementIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "UQ_BidSheetLocations_TradeUnit_BarchartKey",
                schema: "dbo",
                table: "BidSheetLocations",
                columns: new[] { "TradeUnitCode", "BarchartLocationKey" },
                unique: true,
                filter: "[BarchartLocationKey] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UQ_BidSheetLocations_TradeUnit_BarchartKey",
                schema: "dbo",
                table: "BidSheetLocations");
        }
    }
}
