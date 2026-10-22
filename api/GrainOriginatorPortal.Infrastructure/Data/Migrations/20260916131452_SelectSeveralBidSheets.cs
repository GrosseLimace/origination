using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   SelectSeveralBidSheets
       Author:      Origination engineering
       Description: BidSheetPreferences.SelectedBidSheetId (one sheet) becomes SelectedBidSheetIds,
                    a JSON array, so the screen can remember several sheets open at once.
       Rollback:    Down() restores the scalar and keeps the FIRST id of each list. A user who had
                    several sheets open comes back with one.
    */

    /// <summary>
    /// Lets the remembered sheet selection be a set rather than a single sheet.
    ///
    /// The bid sheet is getting multi-select -- several sheets shown together on one map -- and the
    /// column that remembers what you had open was a scalar int. It holds a JSON array of ids now
    /// ("[120,133]"), which is how CropOrder, SelectedMonths and SelectedYears already store their
    /// lists on this same row: read and written whole, never queried by element, so a column costs
    /// nothing and a join table would buy nothing.
    ///
    /// ORDER MATTERS. The scaffolded version dropped the old column before adding the new one, which
    /// would have thrown away every user's saved sheet. Add, carry the value across, then drop.
    /// </summary>
    public partial class SelectSeveralBidSheets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SelectedBidSheetIds",
                schema: "dbo",
                table: "BidSheetPreferences",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            // A single remembered sheet becomes a one-element list, so nobody's screen reopens empty.
            // Rows that never had one stay NULL, which the client reads as "no selection".
            migrationBuilder.Sql(@"
UPDATE dbo.BidSheetPreferences
   SET SelectedBidSheetIds = CONCAT(N'[', SelectedBidSheetId, N']')
 WHERE SelectedBidSheetId IS NOT NULL;
");

            migrationBuilder.DropColumn(
                name: "SelectedBidSheetId",
                schema: "dbo",
                table: "BidSheetPreferences");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SelectedBidSheetId",
                schema: "dbo",
                table: "BidSheetPreferences",
                type: "int",
                nullable: true);

            // Keeps the first id of the list -- the scalar cannot hold more. A user who had several
            // sheets open reopens on one of them rather than on nothing. Parsed with string work
            // rather than OPENJSON so the rollback does not depend on the database compatibility
            // level, and TRY_CONVERT so a malformed value rolls back as NULL instead of failing.
            migrationBuilder.Sql(@"
UPDATE dbo.BidSheetPreferences
   SET SelectedBidSheetId = TRY_CONVERT(int,
         LEFT(
           STUFF(SelectedBidSheetIds, 1, 1, N''),
           CASE
             WHEN CHARINDEX(N',', STUFF(SelectedBidSheetIds, 1, 1, N'')) > 0
               THEN CHARINDEX(N',', STUFF(SelectedBidSheetIds, 1, 1, N'')) - 1
             ELSE LEN(STUFF(SelectedBidSheetIds, 1, 1, N'')) - 1
           END))
 WHERE SelectedBidSheetIds IS NOT NULL
   AND LEN(SelectedBidSheetIds) > 2;
");

            migrationBuilder.DropColumn(
                name: "SelectedBidSheetIds",
                schema: "dbo",
                table: "BidSheetPreferences");
        }
    }
}
