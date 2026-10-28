using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   UseContractMonthForBidCells
       Author:      Origination engineering
       Description: Aligns dbo.vw_BarchartPublishableBid with the bridge, which now files a bid under the
                    contract month named by its symbol rather than under the month its delivery window
                    happens to start in.
       Rollback:    Down() restores delivery-window-start keying.
    */

    /// <summary>
    /// Files each candidate under the contract month encoded in its symbol.
    ///
    /// A BarChart symbol is root + P or B + month code + two-digit year + optional F/L + dash + location
    /// + dash + map + .CM, and the vendor publishes one symbol per contract month. The delivery window
    /// only says how much flexibility that contract carries, so the two disagree whenever an elevator
    /// allows early or late delivery: measured on the live feed, 9,623 of 61,387 active instruments have
    /// a window that starts in a different month from the one their symbol names.
    ///
    /// Keying off the window start therefore mis-files those bids. Farmers Cooperative Dorchester at
    /// Herkimer publishes ZCPV26 (October, 1 Oct - 1 Nov, 4.47) and ZCPX26 (November, 1 Oct - 1 Dec,
    /// 4.58); both started in October, the widest-window tiebreak preferred ZCPX26, and the sheet showed
    /// November's 4.58 in the October cell while November stayed blank.
    ///
    /// The view has to move with the bridge or it starts reporting a different answer than the sheet --
    /// which is the failure the drift check in _VerifySchema.sql exists to catch.
    /// </summary>
    public partial class UseContractMonthForBidCells : Migration
    {
        /// <summary>
        /// Builds the view body. <paramref name="byContractMonth"/> selects the new symbol-derived key;
        /// false reproduces the previous delivery-window-start key for <see cref="Down"/>.
        /// </summary>
        private static string ViewBody(bool byContractMonth)
        {
            var cropYear = byContractMonth ? "cmo.CropYear" : "YEAR(i.DeliveryStart)";
            var bidMonth = byContractMonth ? "cmo.BidMonth" : "MONTH(i.DeliveryStart)";

            // The symbol parse only exists in the contract-month shape; the old shape needs no apply.
            var monthApply = byContractMonth
                ? @"
    CROSS APPLY (SELECT Pos = PATINDEX(N'%[FGHJKMNQUVXZ][0-9][0-9][-FL]%', i.Symbol)) AS sp
    CROSS APPLY (SELECT MonthCode = CASE WHEN sp.Pos > 0 THEN SUBSTRING(i.Symbol, sp.Pos, 1) END,
                        CodeYear  = CASE WHEN sp.Pos > 0
                                         THEN TRY_CONVERT(int, SUBSTRING(i.Symbol, sp.Pos + 1, 2)) END) AS sy
    CROSS APPLY (SELECT CropYear = ISNULL(2000 + sy.CodeYear, YEAR(i.DeliveryStart)),
                        BidMonth = ISNULL(CASE sy.MonthCode
                                              WHEN N'F' THEN 1  WHEN N'G' THEN 2  WHEN N'H' THEN 3
                                              WHEN N'J' THEN 4  WHEN N'K' THEN 5  WHEN N'M' THEN 6
                                              WHEN N'N' THEN 7  WHEN N'Q' THEN 8  WHEN N'U' THEN 9
                                              WHEN N'V' THEN 10 WHEN N'X' THEN 11 WHEN N'Z' THEN 12
                                          END, MONTH(i.DeliveryStart))) AS cmo"
                : string.Empty;

            // Mirrors the bridge's tiebreak exactly. Contract-month keying leaves at most one candidate
            // per cell in practice, so this only decides first-half against last-half splits.
            var winnerOrder = byContractMonth
                ? @"CASE WHEN c.DeliveryWindowFlag IS NULL THEN 0 ELSE 1 END,
                          c.TradeTimestamp DESC,
                          DATEDIFF(DAY, c.DeliveryStart, c.DeliveryEnd) DESC,
                          c.DeliveryStart ASC,
                          c.Symbol ASC"
                : @"CASE WHEN c.DeliveryWindowFlag IS NULL THEN 0 ELSE 1 END,
                          DATEDIFF(DAY, c.DeliveryStart, c.DeliveryEnd) DESC,
                          c.DeliveryStart ASC,
                          c.TradeTimestamp DESC,
                          c.Symbol ASC";

            return $@"
WITH candidate AS
(
    SELECT
        LocationId          = loc.Id,
        LocationName        = loc.Name,
        loc.TradeUnitCode,
        loc.BarchartLocationKey,
        i.Elevator,
        i.City,
        i.State,
        i.Symbol,
        VendorCommodity     = i.Commodity,
        CommodityCode       = m.CommodityCode,
        i.InstrumentType,
        PriceType           = CASE WHEN i.InstrumentType = N'bidBasis' THEN N'basis' ELSE N'cash' END,
        i.DeliveryStart,
        i.DeliveryEnd,
        i.DeliveryWindowFlag,
        CropYear            = {cropYear},
        BidMonth            = {bidMonth},
        q.LastPrice,
        q.QuoteMode,
        q.TradeTimestamp,
        QuoteAgeDays        = DATEDIFF(DAY, q.TradeTimestamp, SYSUTCDATETIME()),
        -- First reason that applies, most fundamental first. Note what is NOT here: age. A live quote
        -- publishes however old it is, because an elevator leaving a new-crop bid alone for weeks is
        -- normal and the delivery month already says which period the bid covers. The UI mutes an old
        -- bid rather than hiding it. Only the vendor's own dead-record flag blocks.
        BlockedReason       =
            CASE
                WHEN m.CommodityCode IS NULL                                          THEN N'unmapped commodity'
                WHEN i.DeliveryStart IS NULL                                          THEN N'no delivery window'
                WHEN i.DeliveryEnd IS NOT NULL
                     AND i.DeliveryEnd < CAST(SYSUTCDATETIME() AS date)                THEN N'delivery window elapsed'
                WHEN q.Symbol IS NULL OR q.LastPrice IS NULL                          THEN N'no quote yet'
                WHEN q.QuoteMode = N'd'                                                THEN N'dead quote (vendor mode d)'
                WHEN i.InstrumentType = N'bidBasis' AND ABS(q.LastPrice) > 100000       THEN N'implausible price'
                WHEN i.InstrumentType <> N'bidBasis'
                     AND (q.LastPrice < 0.01 OR q.LastPrice > 100000)                   THEN N'implausible price'
                WHEN q.TradeTimestamp IS NOT NULL
                     AND q.TradeTimestamp < DATEADD(DAY, -365, SYSUTCDATETIME())       THEN N'older than the outer bound'
                ELSE NULL
            END
    FROM dbo.BidSheetLocations AS loc
    INNER JOIN dbo.BarchartInstrument AS i
        ON i.LocationKey = loc.BarchartLocationKey
       AND i.IsActive = 1
       AND i.IsTest = 0
       AND i.InstrumentType IN (N'bidCash', N'bidBasis')
    LEFT JOIN dbo.BarchartCurrentQuote AS q
        ON q.Symbol = i.Symbol
    LEFT JOIN dbo.BarchartCommodityMap AS m
        ON m.BarchartCommodity = i.Commodity
       AND m.IsActive = 1{monthApply}
    WHERE loc.BarchartLocationKey IS NOT NULL
)
SELECT
    c.LocationId,
    c.LocationName,
    c.TradeUnitCode,
    c.BarchartLocationKey,
    c.Elevator,
    c.City,
    c.State,
    c.Symbol,
    c.VendorCommodity,
    c.CommodityCode,
    c.InstrumentType,
    c.PriceType,
    c.DeliveryStart,
    c.DeliveryEnd,
    c.DeliveryWindowFlag,
    c.CropYear,
    c.BidMonth,
    c.LastPrice,
    c.QuoteMode,
    c.TradeTimestamp,
    c.QuoteAgeDays,
    c.BlockedReason,
    WouldPublishAtDefaults = CASE WHEN c.BlockedReason IS NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END,
    WinnerRank = CASE
        WHEN c.BlockedReason IS NOT NULL THEN NULL
        ELSE ROW_NUMBER() OVER (
                 PARTITION BY c.LocationId, c.CommodityCode, c.CropYear, c.BidMonth, c.PriceType
                 ORDER BY CASE WHEN c.BlockedReason IS NULL THEN 0 ELSE 1 END,
                          {winnerOrder})
    END,
    CurrentSheetBid    = CASE WHEN c.PriceType = N'basis' THEN b.BasisBid       ELSE b.Bid       END,
    CurrentSheetSource = b.Source,
    CurrentSheetAsOf   = CASE WHEN c.PriceType = N'basis' THEN b.BasisQuoteAsOf ELSE b.QuoteAsOf END
FROM candidate AS c
LEFT JOIN dbo.BidSheetLocationBids AS b
    ON b.LocationId    = c.LocationId
   AND b.CommodityCode = c.CommodityCode
   AND b.CropYear      = c.CropYear
   AND b.Month         = c.BidMonth;";
        }

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE OR ALTER VIEW dbo.vw_BarchartPublishableBid AS" + ViewBody(byContractMonth: true));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE OR ALTER VIEW dbo.vw_BarchartPublishableBid AS" + ViewBody(byContractMonth: false));
        }
    }
}
