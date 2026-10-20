using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   AddSelectedColumnsToBidSheetPreference
       Author:      Origination engineering
       Description: Remembers the Edit Bids columns the user chose, one pick per column.
       Rollback:    Down() drops the column. The grid falls back to synthesising a column list from
                    the CropOrder/HiddenCrops/SelectedMonths/SelectedYears still on the row, which is
                    why those four are kept rather than dropped here.
    */

    /// <summary>
    /// Stores the Edit Bids grid's columns as an explicit ordered list, replacing the crop x month x
    /// year cross product that SelectedMonths and SelectedYears described between them.
    ///
    /// The cross product could not express a run of months that crosses a year boundary. Asking for
    /// Dec 2026, Jan 2027 and Feb 2027 meant selecting years {2026,2027} and months {12,1,2}, which
    /// yields all six combinations in calendar-then-year order -- Jan 26 beside Jan 27 -- and no
    /// re-sort fixes that, because the shape of the selection, not its ordering, is what is wrong.
    ///
    /// A JSON array of picks: [{"c":"YC","y":2026,"m":12},{"c":"YC","y":2027,"m":1}]. Read and
    /// written whole, never queried by element, so a column costs nothing and a child table would
    /// buy nothing -- the same reasoning as SelectedBidSheetIds beside it.
    ///
    /// Nullable, and null is meaningful: it marks a user who has not opened the new grid yet, whose
    /// column list is synthesised once from the four legacy fields so their arrangement survives the
    /// upgrade. It is written back only when they next change a column.
    /// </summary>
    public partial class AddSelectedColumnsToBidSheetPreference : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SelectedColumns",
                schema: "dbo",
                table: "BidSheetPreferences",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SelectedColumns",
                schema: "dbo",
                table: "BidSheetPreferences");
        }
    }
}
