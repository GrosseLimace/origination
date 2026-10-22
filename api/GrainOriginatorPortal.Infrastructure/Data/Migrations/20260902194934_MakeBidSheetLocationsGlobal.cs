using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   MakeBidSheetLocationsGlobal
       Author:      Origination engineering
       Description: Collapses per-trade-unit location rows into one canonical row per elevator, so the
                    bid sheet can show every location to everyone instead of scoping by trade unit.
       Rollback:    Down() restores the old indexes and the non-null column, but CANNOT un-merge rows.
                    Snapshots are left behind for that; see the summary.
    */

    /// <summary>
    /// Makes a bid sheet location a company-wide thing rather than a per-desk one.
    ///
    /// A location used to belong to a trade unit, and the bulk add created one row PER selected trade
    /// unit -- so the same elevator was stored several times over, each copy carrying its own bids that
    /// the bridge filled with the identical fed price. On Dev, Kanza Coop BELMONT is four rows across
    /// 2190/2191/2193/2194 with nine byte-identical fed cells each: 36 rows where 9 suffice. The
    /// multiplier is however many trade units a user ticks, and one saved preference on Dev holds ten.
    ///
    /// After this there is one row per BarChart listing, one shared set of bids, and TradeUnitCode is
    /// provenance only -- nothing reads it to decide what a user may see or change.
    ///
    /// ORDER IS LOAD-BEARING. BidSheetLocationBids cascades on delete, so dropping a loser row destroys
    /// its bids; and the unique index on (LocationId, Commodity, CropYear, Month) means cells cannot be
    /// blind-repointed. So: snapshot, merge cells into the survivor, only then delete, and only then
    /// tighten the index. Building the unique index first -- which is what a scaffolded migration does
    /// -- fails outright while duplicates still exist.
    ///
    /// Survivor is the lowest Id per key. On Dev all four copies share a creator and a created-second,
    /// so no other rule distinguishes them.
    ///
    /// Conflict rule for cells both rows hold: a manual bid beats a fed one (a human typed it, and the
    /// bridge reclaims the cell on its next run anyway), then the most recently touched wins. Bid and
    /// BasisBid move together as a unit -- splitting them loses data, because most manual bids ARE a
    /// basis. Dev has zero conflicts (all 36 duplicate cells are identical fed output and no manual bid
    /// is involved) but QA and PROD have hand-typed bids and will.
    ///
    /// Manual locations are NOT merged. All eight on Dev have distinct names and coordinates, and there
    /// is no natural key for them -- guessing one risks merging two genuinely different elevators. They
    /// simply become global. A later human pass can dedupe if it ever matters.
    /// </summary>
    public partial class MakeBidSheetLocationsGlobal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Snapshots. This destroys rows and Down() cannot reconstruct them, so the pre-state is
            // preserved as tables rather than trusting a backup window. Dropped by hand once the
            // remodel has settled -- deliberately NOT dropped by Down(), which would discard the only
            // copy at exactly the moment someone is rolling back because something went wrong.
            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.BidSheetLocations_PreGlobal', 'U') IS NULL
    SELECT * INTO dbo.BidSheetLocations_PreGlobal FROM dbo.BidSheetLocations;

IF OBJECT_ID('dbo.BidSheetLocationBids_PreGlobal', 'U') IS NULL
    SELECT * INTO dbo.BidSheetLocationBids_PreGlobal FROM dbo.BidSheetLocationBids;

IF OBJECT_ID('dbo.BidSheetLocationOrders_PreGlobal', 'U') IS NULL
    SELECT * INTO dbo.BidSheetLocationOrders_PreGlobal FROM dbo.BidSheetLocationOrders;
");

            // The survivor map and the cell merge.
            migrationBuilder.Sql(@"
SET NOCOUNT ON;

CREATE TABLE #SurvivorMap (LoserId int PRIMARY KEY, SurvivorId int NOT NULL);

INSERT #SurvivorMap (LoserId, SurvivorId)
SELECT r.Id, r.SurvivorId
  FROM (SELECT Id, SurvivorId = MIN(Id) OVER (PARTITION BY BarchartLocationKey)
          FROM dbo.BidSheetLocations
         WHERE BarchartLocationKey IS NOT NULL) AS r
 WHERE r.Id <> r.SurvivorId;

DECLARE @losers int = (SELECT COUNT(*) FROM #SurvivorMap);

-- A cell the survivor does not have yet simply moves across. Doing this before the overwrite below
-- keeps the two statements' target sets disjoint, so neither can trip the unique index.
UPDATE b
   SET b.LocationId = m.SurvivorId,
       b.ModifiedAt = SYSUTCDATETIME(),
       b.ModifiedBy = 'migration:MakeBidSheetLocationsGlobal'
  FROM dbo.BidSheetLocationBids AS b
 INNER JOIN #SurvivorMap AS m ON m.LoserId = b.LocationId
 WHERE NOT EXISTS (SELECT 1
                     FROM dbo.BidSheetLocationBids AS s
                    WHERE s.LocationId    = m.SurvivorId
                      AND s.CommodityCode = b.CommodityCode
                      AND s.CropYear      = b.CropYear
                      AND s.Month         = b.Month);

-- A cell both rows hold: keep the survivor's unless the loser's is better. Manual beats fed because a
-- person typed it; otherwise the more recently touched wins. Bid and BasisBid are copied together --
-- a manual bid is usually a basis, so moving one without the other loses it.
;WITH contender AS (
    SELECT SurvivorBidId = s.Id,
           l.Bid, l.BasisBid, l.Source, l.BarchartSymbol, l.BasisSymbol,
           l.QuoteAsOf, l.BasisQuoteAsOf, l.UnderlyingFuture,
           rn = ROW_NUMBER() OVER (
                    PARTITION BY s.Id
                    ORDER BY CASE WHEN l.Source = N'Manual' THEN 0 ELSE 1 END,
                             COALESCE(l.ModifiedAt, l.CreatedAt) DESC,
                             l.Id DESC)
      FROM dbo.BidSheetLocationBids AS l
     INNER JOIN #SurvivorMap AS m ON m.LoserId = l.LocationId
     INNER JOIN dbo.BidSheetLocationBids AS s
             ON s.LocationId    = m.SurvivorId
            AND s.CommodityCode = l.CommodityCode
            AND s.CropYear      = l.CropYear
            AND s.Month         = l.Month
     WHERE (l.Source = N'Manual' AND s.Source <> N'Manual')
        OR (l.Source = s.Source
            AND COALESCE(l.ModifiedAt, l.CreatedAt) > COALESCE(s.ModifiedAt, s.CreatedAt))
)
UPDATE s
   SET s.Bid              = c.Bid,
       s.BasisBid         = c.BasisBid,
       s.Source           = c.Source,
       s.BarchartSymbol   = c.BarchartSymbol,
       s.BasisSymbol      = c.BasisSymbol,
       s.QuoteAsOf        = c.QuoteAsOf,
       s.BasisQuoteAsOf   = c.BasisQuoteAsOf,
       s.UnderlyingFuture = c.UnderlyingFuture,
       s.ModifiedAt       = SYSUTCDATETIME(),
       s.ModifiedBy       = 'migration:MakeBidSheetLocationsGlobal'
  FROM dbo.BidSheetLocationBids AS s
 INNER JOIN contender AS c ON c.SurvivorBidId = s.Id AND c.rn = 1;

-- Whatever is left on a loser now duplicates the survivor's cell or lost the comparison. Counted
-- before deletion: this is irreversible and the number is worth having in the deploy log.
DECLARE @discarded int = (SELECT COUNT(*)
                            FROM dbo.BidSheetLocationBids AS b
                           INNER JOIN #SurvivorMap AS m ON m.LoserId = b.LocationId);

DELETE b FROM dbo.BidSheetLocationBids AS b
 INNER JOIN #SurvivorMap AS m ON m.LoserId = b.LocationId;

DELETE l FROM dbo.BidSheetLocations AS l
 INNER JOIN #SurvivorMap AS m ON m.LoserId = l.Id;

-- Saved row order stores location IDS, and the client silently drops ones it cannot find -- so a stale
-- order degrades invisibly rather than erroring. Remap losers onto survivors, keeping first appearance
-- and dropping the duplicates that remapping creates.
UPDATE o
   SET o.LocationOrder = x.Remapped,
       o.ModifiedAt = SYSUTCDATETIME()
  FROM dbo.BidSheetLocationOrders AS o
 CROSS APPLY (
    SELECT Remapped = N'[' + ISNULL(STRING_AGG(CONVERT(nvarchar(20), d.Id), N',')
                                    WITHIN GROUP (ORDER BY d.FirstSeen), N'') + N']'
      FROM (SELECT Id = COALESCE(m.SurvivorId, TRY_CONVERT(int, j.[value])),
                   FirstSeen = MIN(TRY_CONVERT(int, j.[key]))
              FROM OPENJSON(o.LocationOrder) AS j
              LEFT JOIN #SurvivorMap AS m ON m.LoserId = TRY_CONVERT(int, j.[value])
             WHERE TRY_CONVERT(int, j.[value]) IS NOT NULL
             GROUP BY COALESCE(m.SurvivorId, TRY_CONVERT(int, j.[value]))) AS d
 ) AS x
 WHERE EXISTS (SELECT 1
                 FROM OPENJSON(o.LocationOrder) AS j
                INNER JOIN #SurvivorMap AS m ON m.LoserId = TRY_CONVERT(int, j.[value]));

PRINT CONCAT('MakeBidSheetLocationsGlobal: merged ', @losers, ' duplicate location row(s); ',
             @discarded, ' bid cell(s) discarded after merge.');

DROP TABLE #SurvivorMap;
");

            // Indexes. Guarded with IF EXISTS rather than DropIndex because one of them was created by
            // hand in Dev and is declared by no migration and no model -- an unguarded drop fails the
            // deploy in any environment that never got it. See BidSheetRepository.LocationNameExistsAsync.
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = 'UQ_BidSheetLocations_TradeUnit_BarchartKey'
              AND object_id = OBJECT_ID('dbo.BidSheetLocations'))
    DROP INDEX [UQ_BidSheetLocations_TradeUnit_BarchartKey] ON [dbo].[BidSheetLocations];

IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = 'IX_BidSheetLocations_BarchartLocationKey'
              AND object_id = OBJECT_ID('dbo.BidSheetLocations'))
    DROP INDEX [IX_BidSheetLocations_BarchartLocationKey] ON [dbo].[BidSheetLocations];

-- Names were unique per trade unit BY DESIGN, because the bulk add put the same name on every desk.
-- With one row per elevator that rule is meaningless. It is deliberately NOT replaced with
-- UNIQUE(Name): that needs a duplicate-name sweep of QA and PROD first, and manual locations are
-- named freely by users.
IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = 'UQ_BidSheetLocations_Name_TradeUnit'
              AND object_id = OBJECT_ID('dbo.BidSheetLocations'))
    DROP INDEX [UQ_BidSheetLocations_Name_TradeUnit] ON [dbo].[BidSheetLocations];
");

            migrationBuilder.AlterColumn<string>(
                name: "TradeUnitCode",
                schema: "dbo",
                table: "BidSheetLocations",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100);

            // Safe only now that the duplicates are gone.
            migrationBuilder.CreateIndex(
                name: "UQ_BidSheetLocations_BarchartKey",
                schema: "dbo",
                table: "BidSheetLocations",
                column: "BarchartLocationKey",
                unique: true,
                filter: "[BarchartLocationKey] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Restores the schema, NOT the data. The merged rows are gone; dbo.*_PreGlobal holds the
            // pre-migration state and is left in place deliberately for a manual restore.
            migrationBuilder.DropIndex(
                name: "UQ_BidSheetLocations_BarchartKey",
                schema: "dbo",
                table: "BidSheetLocations");

            // Rows added without a desk in view get the old empty-string default so the column can go
            // back to NOT NULL.
            migrationBuilder.Sql(
                "UPDATE dbo.BidSheetLocations SET TradeUnitCode = N'' WHERE TradeUnitCode IS NULL;");

            migrationBuilder.AlterColumn<string>(
                name: "TradeUnitCode",
                schema: "dbo",
                table: "BidSheetLocations",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_BidSheetLocations_BarchartLocationKey",
                schema: "dbo",
                table: "BidSheetLocations",
                column: "BarchartLocationKey");

            migrationBuilder.CreateIndex(
                name: "UQ_BidSheetLocations_TradeUnit_BarchartKey",
                schema: "dbo",
                table: "BidSheetLocations",
                columns: new[] { "TradeUnitCode", "BarchartLocationKey" },
                unique: true,
                filter: "[BarchartLocationKey] IS NOT NULL");
        }
    }
}
