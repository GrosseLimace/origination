using System;

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   RetireBidSheetLocationOrders
       Author:      Origination engineering
       Description: Drops the per-trade-unit row-order table and the trade-unit index that only served
                    a read nothing calls, and clears preference rows saved under a trade-unit key.
       Rollback:    Down() rebuilds the table and both indexes. It cannot bring back the rows.
    */

    /// <summary>
    /// Clears out what the trade-unit-scoped bid sheet left behind.
    ///
    /// Row order used to be a per-user, per-trade-unit blob of location ids in
    /// dbo.BidSheetLocationOrders. A sheet carries its own order now -- BidSheetLocationLinks.SortOrder,
    /// saved through PUT /sheets/{id}/location-order -- and it is shared with everyone on the sheet
    /// rather than private to one person on one desk. Nothing has read the old table since sheets
    /// landed; its endpoints and repository methods go with it in this same change.
    ///
    /// IX_BidSheetLocations_TradeUnitCode existed for one query: the location read filtered by trade
    /// unit, which is also gone. TradeUnitCode itself STAYS -- it records which desk first added a
    /// location, and the BarChart picker reads it to show where a listing is already in use -- but
    /// nothing filters on it any more, so the index is pure write cost.
    ///
    /// Preferences keyed by a trade unit are unreachable rather than merely unused: the client asks
    /// for exactly one key now, the global one, so a row under 2190 or under a comma-list like
    /// 2038,2111,2115 can never be read again. They are deleted here so every environment ends up
    /// with the same one-row-per-user shape rather than Dev being tidy while QA and PROD keep
    /// whatever their users happened to save.
    ///
    /// Guarded raw SQL rather than DropTable/DropIndex: dbo.BidSheetLocationOrders is created by no
    /// migration in this repository -- it predates them, from the SSMS era -- so whether QA and PROD
    /// actually have it is not something the migration history can answer. An unguarded drop of a
    /// table that is not there fails the deploy.
    /// </summary>
    public partial class RetireBidSheetLocationOrders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.BidSheetLocationOrders', 'U') IS NOT NULL
BEGIN
    DECLARE @orders int = (SELECT COUNT(*) FROM dbo.BidSheetLocationOrders);
    DROP TABLE dbo.BidSheetLocationOrders;
    PRINT CONCAT('RetireBidSheetLocationOrders: dropped dbo.BidSheetLocationOrders (', @orders, ' row(s)).');
END
ELSE
    PRINT 'RetireBidSheetLocationOrders: dbo.BidSheetLocationOrders not present, nothing to drop.';

IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = 'IX_BidSheetLocations_TradeUnitCode'
              AND object_id = OBJECT_ID('dbo.BidSheetLocations'))
BEGIN
    DROP INDEX [IX_BidSheetLocations_TradeUnitCode] ON [dbo].[BidSheetLocations];
    PRINT 'RetireBidSheetLocationOrders: dropped IX_BidSheetLocations_TradeUnitCode.';
END
");

            // Counted before the delete so the number reaches the deploy log -- this is not reversible.
            migrationBuilder.Sql(@"
DECLARE @stale int = (SELECT COUNT(*) FROM dbo.BidSheetPreferences WHERE TradeUnitKey <> N'__global__');

DELETE FROM dbo.BidSheetPreferences WHERE TradeUnitKey <> N'__global__';

DECLARE @kept int = (SELECT COUNT(*) FROM dbo.BidSheetPreferences);

PRINT CONCAT('RetireBidSheetLocationOrders: removed ', @stale,
             ' preference row(s) saved under a trade-unit key; ', @kept, ' global row(s) remain.');
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Schema only. The row order and the per-desk preferences are gone; after a rollback a user
            // reordering the grid simply starts from the default.
            migrationBuilder.CreateTable(
                name: "BidSheetLocationOrders",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    LocationOrder = table.Column<string>(type: "nvarchar(max)", nullable: false, defaultValue: "[]"),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    TradeUnitKey = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BidSheetLocationOrders", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BidSheetLocations_TradeUnitCode",
                schema: "dbo",
                table: "BidSheetLocations",
                column: "TradeUnitCode");

            migrationBuilder.CreateIndex(
                name: "IX_BidSheetLocationOrders_UserId",
                schema: "dbo",
                table: "BidSheetLocationOrders",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "UQ_BidSheetLocationOrders_User_TradeUnitKey",
                schema: "dbo",
                table: "BidSheetLocationOrders",
                columns: new[] { "UserId", "TradeUnitKey" },
                unique: true);
        }
    }
}
