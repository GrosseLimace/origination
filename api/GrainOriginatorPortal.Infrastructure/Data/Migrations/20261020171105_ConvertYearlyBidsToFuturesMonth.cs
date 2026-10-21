using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   ConvertYearlyBidsToFuturesMonth
       Author:      Origination engineering
       Description: Data only. (1) Moves each hand-typed "Yearly" bid (Month 0) onto the delivery month its
                    basis letter names, so it stays on the remodelled sheet. (2) Puts flat organic prices
                    back in the cash column, where MoveManualBidsToBasisColumn had filed them as basis.
       Rollback:    Down() is a no-op; see the remarks. BidSheetLocationBids_PreGlobal (taken by
                    MakeBidSheetLocationsGlobal) holds every row as it was before this release.
    */
    /// <summary>
    /// Two corrections measured against PRODUCTION data on 2026-10-20, the day the remodel shipped there.
    /// Dev, where the earlier bid sheet migrations were written, had neither case.
    ///
    /// <para><b>Yearly bids.</b> The remodel retires the Yearly period (Month 0) in favour of delivery
    /// months, and <c>RetireYearlyPeriodAddCoverageAndChangeStamps</c> leaves hand-typed Month 0 rows in
    /// place but never shows them. Production had 507 of them, 360 for crop year 2026, edited as recently
    /// as the day before the release -- originators were using them. They are not really year-wide: the
    /// basis names its futures month ("-65Z" is December, "-70N" July, "-75X" November, "-85U" September),
    /// and the business confirmed that is the month the bid stands for. So each one becomes that month's
    /// bid for its crop year. Measured: 503 of 507 carry a valid letter; 3 of those would land on a month
    /// the originator had also typed a bid for, and the typed monthly bid wins (the Yearly row is removed);
    /// the remaining 4 are typos ("5", "-", "T") with no month in them and stay at Month 0, hidden, for
    /// their owners to re-enter.</para>
    ///
    /// <para><b>Organic cash.</b> <c>MoveManualBidsToBasisColumn</c> moved every manual value into
    /// BasisBid on the premise, true in Dev, that originators type basis. Production also had 112 manual
    /// bids on the organic commodities (YSBO, YCO, HRWO, WHTO) typed as flat prices ("23.00", "10.50"):
    /// organics have no futures market, so there is no basis to quote. Those are cash and go back to the
    /// cash column. The rule is the shape of the value, not the commodity: a plain positive number with no
    /// letter and no sign is a price; anything with a month letter or a leading minus is a basis.</para>
    ///
    /// <para>Both steps touch manual rows only. Feed-written rows (Source = 'Barchart') already have cash
    /// and basis in the right columns and the feed owns them.</para>
    /// </summary>
    public partial class ConvertYearlyBidsToFuturesMonth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // (2) first, so the month conversion below reads a basis that is really a basis.
            migrationBuilder.Sql(@"
UPDATE dbo.BidSheetLocationBids
   SET Bid      = BasisBid,
       BasisBid = NULL
 WHERE Source = N'Manual'
   AND NULLIF(LTRIM(RTRIM(Bid)), N'') IS NULL
   AND BasisBid IS NOT NULL
   AND LTRIM(RTRIM(BasisBid)) NOT LIKE N'%[^0-9.]%'          -- digits and a decimal point only
   AND TRY_CONVERT(decimal(18,4), LTRIM(RTRIM(BasisBid))) > 0;");

            // (1) Yearly -> the month the basis letter names. Futures month codes: F Jan, G Feb, H Mar,
            // J Apr, K May, M Jun, N Jul, Q Aug, U Sep, V Oct, X Nov, Z Dec.
            migrationBuilder.Sql(@"
;WITH yearly AS
(
    SELECT b.Id, b.LocationId, b.CommodityCode, b.CropYear,
           TargetMonth = CASE UPPER(RIGHT(RTRIM(b.BasisBid), 1))
                             WHEN N'F' THEN 1  WHEN N'G' THEN 2  WHEN N'H' THEN 3  WHEN N'J' THEN 4
                             WHEN N'K' THEN 5  WHEN N'M' THEN 6  WHEN N'N' THEN 7  WHEN N'Q' THEN 8
                             WHEN N'U' THEN 9  WHEN N'V' THEN 10 WHEN N'X' THEN 11 WHEN N'Z' THEN 12
                         END
      FROM dbo.BidSheetLocationBids AS b
     WHERE b.Source = N'Manual'
       AND b.[Month] = 0
       AND b.BasisBid IS NOT NULL
)
-- A Yearly bid whose month already holds a typed monthly bid: the monthly one stands, the Yearly goes.
DELETE b
  FROM dbo.BidSheetLocationBids AS b
  JOIN yearly AS y ON y.Id = b.Id
 WHERE y.TargetMonth IS NOT NULL
   AND EXISTS (SELECT 1
                 FROM dbo.BidSheetLocationBids AS m
                WHERE m.LocationId    = y.LocationId
                  AND m.CommodityCode = y.CommodityCode
                  AND m.CropYear      = y.CropYear
                  AND m.[Month]       = y.TargetMonth);");

            migrationBuilder.Sql(@"
;WITH yearly AS
(
    SELECT b.Id,
           TargetMonth = CASE UPPER(RIGHT(RTRIM(b.BasisBid), 1))
                             WHEN N'F' THEN 1  WHEN N'G' THEN 2  WHEN N'H' THEN 3  WHEN N'J' THEN 4
                             WHEN N'K' THEN 5  WHEN N'M' THEN 6  WHEN N'N' THEN 7  WHEN N'Q' THEN 8
                             WHEN N'U' THEN 9  WHEN N'V' THEN 10 WHEN N'X' THEN 11 WHEN N'Z' THEN 12
                         END
      FROM dbo.BidSheetLocationBids AS b
     WHERE b.Source = N'Manual'
       AND b.[Month] = 0
       AND b.BasisBid IS NOT NULL
)
UPDATE b
   SET b.[Month] = y.TargetMonth
  FROM dbo.BidSheetLocationBids AS b
  JOIN yearly AS y ON y.Id = b.Id
 WHERE y.TargetMonth IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Deliberately nothing. A converted row is indistinguishable from a bid the originator typed
            // into that month, and a cash value moved back is indistinguishable from one typed as cash,
            // so a reversal would have to guess. The pre-release state of every bid row is preserved in
            // dbo.BidSheetLocationBids_PreGlobal until Drop-BidSheetPreGlobalSnapshots.sql is run.
        }
    }
}
