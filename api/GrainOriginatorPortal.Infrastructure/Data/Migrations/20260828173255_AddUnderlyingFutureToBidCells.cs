using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   AddUnderlyingFutureToBidCells
       Author:      Origination engineering
       Description: Records which futures contract a fed bid is quoted against, so the Bid Sheet's Year
                    column can name it instead of naming a delivery month.
       Rollback:    Down() drops the column. Feed rows repopulate it on the next apply-bids run.
    */

    /// <summary>
    /// Adds the futures contract behind a fed bid cell, e.g. ZCZ26 for December 2026 corn.
    ///
    /// The Year column has no year-level bid to show -- the feed does not publish one -- so it borrows
    /// the nearest delivery month still open. It used to label that value with the month it came from,
    /// which is not what an originator compares on: the contract behind a bid is not always its
    /// delivery month, and Kansas City wheat delivering in January trades against the March board
    /// (KEBF27 -> KEH27). Two elevators can therefore quote the same month against different boards,
    /// and the month label made those look comparable when they were not.
    ///
    /// The value comes from dbo.BarchartInstrument.UnderlyingFuture, which is populated on every active
    /// instrument in the catalog. Nullable because manual cells have no contract behind them.
    /// </summary>
    public partial class AddUnderlyingFutureToBidCells : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "UnderlyingFuture",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UnderlyingFuture",
                schema: "dbo",
                table: "BidSheetLocationBids");
        }
    }
}
