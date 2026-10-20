using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   AlignPublishableBidViewWithCoverage
       Author:      Origination engineering
       Description: Aligns dbo.vw_BarchartPublishableBid with the bridge, which now publishes a bid to
                    every month its delivery window covers rather than to its contract month alone.
       Rollback:    Down() restores the contract-month-only view.
    */

    /// <summary>
    /// The diagnostic view re-implements the bridge's rules so it can answer "why is this bid not on the
    /// sheet". That makes it drift the moment the bridge changes, which is what the
    /// <c>Barchart.ViewDrift</c> check in <c>scripts/_VerifySchema.sql</c> exists to catch -- so a bridge
    /// change ships with a matching view change, as UseContractMonthForBidCells and
    /// UseQuoteAgeNotVendorMode did before it.
    ///
    /// What changed in the bridge: one vendor bid in five opens its delivery window BEFORE its contract
    /// month (Cargill East St. Louis's "Nov 26" corn delivers from 1 October), and keying a cell off the
    /// contract month alone left those months blank -- reading as if the elevator would not take the
    /// grain, when it will, at that contract's price. Every month inside the window now gets the bid,
    /// marked with the contract it came from, and a month's own bid always outranks a covering one.
    ///
    /// Without this the view would still name winners at contract months only. It would NOT have tripped
    /// the drift check -- that looks view -> sheet, and every contract-month winner still matches -- but
    /// it could no longer explain the covered cells the bridge writes (120 of them on Dev): asking why
    /// October shows 5.38 would return nothing at all.
    /// </summary>
    public partial class AlignPublishableBidViewWithCoverage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE OR ALTER VIEW dbo.vw_BarchartPublishableBid AS" + ViewBody(withCoverage: true));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE OR ALTER VIEW dbo.vw_BarchartPublishableBid AS" + ViewBody(withCoverage: false));
        }

        private static string ViewBody(bool withCoverage)
        {
            // The months a bid can be delivered into: its contract month (Coverage 0) plus, with coverage
            // on, every other calendar month inside the window (Coverage 1). Twelve offsets cover the
            // longest window in the catalog (five months) with room to spare, and the window end is
            // exclusive -- 1 Dec means through 30 Nov -- hence the day step back.
            var cellMonths = withCoverage
                ? @"    CROSS APPLY (
        SELECT CellYear = cmo.CropYear, CellMonth = cmo.BidMonth, Coverage = 0
        UNION ALL
        SELECT YEAR(mo.d), MONTH(mo.d), 1
        FROM (SELECT d = DATEADD(MONTH, n.k, DATEFROMPARTS(YEAR(i.DeliveryStart), MONTH(i.DeliveryStart), 1))
              FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11)) AS n(k)) AS mo
        WHERE i.DeliveryEnd IS NOT NULL
          AND i.DeliveryStart IS NOT NULL
          AND mo.d <= DATEADD(DAY, -1, i.DeliveryEnd)
          AND NOT (YEAR(mo.d) = cmo.CropYear AND MONTH(mo.d) = cmo.BidMonth)
    ) AS cell"
                : @"    CROSS APPLY (SELECT CellYear = cmo.CropYear, CellMonth = cmo.BidMonth, Coverage = 0) AS cell";

            // A month already behind us can take no delivery, so it gets no cell. Only meaningful with
            // coverage on: without it the elapsed-window BlockedReason already covers the same ground.
            var pastMonthFilter = withCoverage
                ? @"
      AND (i.DeliveryStart IS NULL
           OR DATEFROMPARTS(cell.CellYear, cell.CellMonth, 1)
              >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1))"
                : string.Empty;

            // A month's OWN bid beats a covering one; among covering bids the nearest contract wins. Both
            // terms collapse to no-ops with coverage off, where every row is Coverage 0 at distance 0.
            var coverageOrder = withCoverage
                ? @"                          c.Coverage ASC,
                          ABS(DATEDIFF(MONTH, DATEFROMPARTS(c.CropYear, c.BidMonth, 1),
                                              DATEFROMPARTS(c.ContractCropYear, c.ContractMonth, 1))) ASC,
"
                : string.Empty;

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
        -- The cell this row would land on, which with coverage is not always the contract month.
        CropYear            = cell.CellYear,
        BidMonth            = cell.CellMonth,
        Coverage            = cell.Coverage,
        ContractCropYear    = cmo.CropYear,
        ContractMonth       = cmo.BidMonth,
        q.LastPrice,
        q.QuoteMode,
        q.TradeTimestamp,
        QuoteAgeDays        = DATEDIFF(DAY, q.TradeTimestamp, SYSUTCDATETIME()),
        -- First reason that applies, most fundamental first. Note what is NOT here: the vendor's mode
        -- flag. It reports how the quote was delivered (real-time, delayed, end-of-day), not whether the
        -- bid is any good, and it is a request parameter we do not control. How long the elevator has
        -- left the bid untouched is the honest test, and it is deliberately generous.
        BlockedReason       =
            CASE
                WHEN m.CommodityCode IS NULL                                          THEN N'unmapped commodity'
                WHEN i.DeliveryStart IS NULL                                          THEN N'no delivery window'
                WHEN i.DeliveryEnd IS NOT NULL
                     AND i.DeliveryEnd < CAST(SYSUTCDATETIME() AS date)                THEN N'delivery window elapsed'
                WHEN q.Symbol IS NULL OR q.LastPrice IS NULL                          THEN N'no quote yet'
                WHEN i.InstrumentType = N'bidBasis' AND ABS(q.LastPrice) > 100000       THEN N'implausible price'
                WHEN i.InstrumentType <> N'bidBasis'
                     AND (q.LastPrice < 0.01 OR q.LastPrice > 100000)                   THEN N'implausible price'
                WHEN q.TradeTimestamp IS NOT NULL
                     AND q.TradeTimestamp < DATEADD(DAY, -90, SYSUTCDATETIME())        THEN N'not quoted in over 90 days'
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
       AND m.IsActive = 1
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
                                          END, MONTH(i.DeliveryStart))) AS cmo
{cellMonths}
    WHERE loc.BarchartLocationKey IS NOT NULL{pastMonthFilter}
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
    -- Null on a month's own bid; the contract whose window reaches this month otherwise. Mirrors the
    -- CoveredByCropYear / CoveredByMonth columns the bridge writes onto the cell.
    CoveredByCropYear = CASE WHEN c.Coverage = 1 THEN c.ContractCropYear END,
    CoveredByMonth    = CASE WHEN c.Coverage = 1 THEN c.ContractMonth END,
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
                 ORDER BY
{coverageOrder}                          CASE WHEN c.DeliveryWindowFlag IS NULL THEN 0 ELSE 1 END,
                          c.TradeTimestamp DESC,
                          DATEDIFF(DAY, c.DeliveryStart, c.DeliveryEnd) DESC,
                          c.DeliveryStart ASC,
                          c.Symbol ASC)
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
    }
}
