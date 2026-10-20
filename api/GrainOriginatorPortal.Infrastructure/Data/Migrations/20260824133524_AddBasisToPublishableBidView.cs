using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   AddBasisToPublishableBidView
       Author:      Origination engineering
       Description: Rebuilds dbo.vw_BarchartPublishableBid so it covers basis as well as cash, now that
                    the bridge publishes both onto the same Bid Sheet row.
       Rollback:    Down() restores the cash-only definition. The view owns no data either way.
    */

    /// <summary>
    /// Extends the diagnostic view to both price types.
    ///
    /// The previous definition filtered to <c>bidCash</c>, because including basis flagged every
    /// (legitimately negative) basis quote as an implausible price and buried the real problems. Now
    /// that basis is published, it needs to be diagnosable too — so the view carries a
    /// <c>PriceType</c> column and applies the bound that belongs to each type, rather than judging
    /// both by the cash rules.
    /// </summary>
    public partial class AddBasisToPublishableBidView : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
CREATE OR ALTER VIEW dbo.vw_BarchartPublishableBid AS
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
        -- Plain-language type, so a reader does not have to know the vendor's wording.
        PriceType           = CASE WHEN i.InstrumentType = N'bidBasis' THEN N'basis' ELSE N'cash' END,
        i.DeliveryStart,
        i.DeliveryEnd,
        i.DeliveryWindowFlag,
        CropYear            = YEAR(i.DeliveryStart),
        BidMonth            = MONTH(i.DeliveryStart),
        q.LastPrice,
        q.QuoteMode,
        q.TradeTimestamp,
        QuoteAgeDays        = DATEDIFF(DAY, q.TradeTimestamp, SYSUTCDATETIME()),
        -- First reason that applies, most fundamental first: an unmapped commodity can never publish,
        -- however fresh its price. The price test differs by type -- cash has a floor because 0.0025 is
        -- the vendor's no-bid placeholder, while basis is normally NEGATIVE and only needs a magnitude
        -- bound to exclude the 214748.3647 sentinel.
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
                     AND q.TradeTimestamp < DATEADD(DAY, -7, SYSUTCDATETIME())         THEN N'stale quote'
                ELSE NULL
            END
    FROM dbo.BidSheetLocations AS loc
    INNER JOIN dbo.BarchartInstrument AS i
        ON i.LocationKey = loc.BarchartLocationKey
       AND i.IsActive = 1
       AND i.IsTest = 0
       AND i.InstrumentType IN (N'bidCash', N'bidBasis')
    -- Both LEFT JOINs are the point of the view: a missing mapping or a missing quote must show up as a
    -- row with a reason, not disappear the way it does in the bridge's inner joins.
    LEFT JOIN dbo.BarchartCurrentQuote AS q
        ON q.Symbol = i.Symbol
    LEFT JOIN dbo.BarchartCommodityMap AS m
        ON m.BarchartCommodity = i.Commodity
       AND m.IsActive = 1
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
    -- Same total order the bridge uses, and partitioned by type the same way, so rank 1 of each type is
    -- the row the bridge writes into that type's column. Blocked rows sort last rather than merely being
    -- hidden: a window function ranks the whole partition, so without that term a blocked row can take
    -- rank 1 and the cell then reports no winner even though a publishable candidate exists.
    WinnerRank = CASE
        WHEN c.BlockedReason IS NOT NULL THEN NULL
        ELSE ROW_NUMBER() OVER (
                 PARTITION BY c.LocationId, c.CommodityCode, c.CropYear, c.BidMonth, c.PriceType
                 ORDER BY CASE WHEN c.BlockedReason IS NULL THEN 0 ELSE 1 END,
                          CASE WHEN c.DeliveryWindowFlag IS NULL THEN 0 ELSE 1 END,
                          DATEDIFF(DAY, c.DeliveryStart, c.DeliveryEnd) DESC,
                          c.DeliveryStart ASC,
                          c.TradeTimestamp DESC,
                          c.Symbol ASC)
    END,
    -- What is actually on the sheet in this cell right now, for the matching price type. A 'Manual'
    -- source against a publishable candidate is the feed being deliberately blocked by a typed bid,
    -- which is the most confusing state to explain without seeing both sides at once.
    CurrentSheetBid    = CASE WHEN c.PriceType = N'basis' THEN b.BasisBid       ELSE b.Bid       END,
    CurrentSheetSource = b.Source,
    CurrentSheetAsOf   = CASE WHEN c.PriceType = N'basis' THEN b.BasisQuoteAsOf ELSE b.QuoteAsOf END
FROM candidate AS c
LEFT JOIN dbo.BidSheetLocationBids AS b
    ON b.LocationId    = c.LocationId
   AND b.CommodityCode = c.CommodityCode
   AND b.CropYear      = c.CropYear
   AND b.Month         = c.BidMonth;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Restores the cash-only definition from AddBarchartPublishableBidView.
            migrationBuilder.Sql(@"
CREATE OR ALTER VIEW dbo.vw_BarchartPublishableBid AS
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
        i.DeliveryStart,
        i.DeliveryEnd,
        i.DeliveryWindowFlag,
        CropYear            = YEAR(i.DeliveryStart),
        BidMonth            = MONTH(i.DeliveryStart),
        q.LastPrice,
        q.QuoteMode,
        q.TradeTimestamp,
        QuoteAgeDays        = DATEDIFF(DAY, q.TradeTimestamp, SYSUTCDATETIME()),
        BlockedReason       =
            CASE
                WHEN m.CommodityCode IS NULL                                          THEN N'unmapped commodity'
                WHEN i.DeliveryStart IS NULL                                          THEN N'no delivery window'
                WHEN i.DeliveryEnd IS NOT NULL
                     AND i.DeliveryEnd < CAST(SYSUTCDATETIME() AS date)                THEN N'delivery window elapsed'
                WHEN q.Symbol IS NULL OR q.LastPrice IS NULL                          THEN N'no quote yet'
                WHEN q.LastPrice < 0.01 OR q.LastPrice > 100000                        THEN N'implausible price'
                WHEN q.TradeTimestamp IS NOT NULL
                     AND q.TradeTimestamp < DATEADD(DAY, -7, SYSUTCDATETIME())         THEN N'stale quote'
                ELSE NULL
            END
    FROM dbo.BidSheetLocations AS loc
    INNER JOIN dbo.BarchartInstrument AS i
        ON i.LocationKey = loc.BarchartLocationKey
       AND i.IsActive = 1
       AND i.IsTest = 0
       AND i.InstrumentType = N'bidCash'
    LEFT JOIN dbo.BarchartCurrentQuote AS q
        ON q.Symbol = i.Symbol
    LEFT JOIN dbo.BarchartCommodityMap AS m
        ON m.BarchartCommodity = i.Commodity
       AND m.IsActive = 1
    WHERE loc.BarchartLocationKey IS NOT NULL
)
SELECT
    c.LocationId, c.LocationName, c.TradeUnitCode, c.BarchartLocationKey, c.Elevator, c.City, c.State,
    c.Symbol, c.VendorCommodity, c.CommodityCode, c.InstrumentType, c.DeliveryStart, c.DeliveryEnd,
    c.DeliveryWindowFlag, c.CropYear, c.BidMonth, c.LastPrice, c.QuoteMode, c.TradeTimestamp,
    c.QuoteAgeDays, c.BlockedReason,
    WouldPublishAtDefaults = CASE WHEN c.BlockedReason IS NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END,
    WinnerRank = CASE
        WHEN c.BlockedReason IS NOT NULL THEN NULL
        ELSE ROW_NUMBER() OVER (
                 PARTITION BY c.LocationId, c.CommodityCode, c.CropYear, c.BidMonth
                 ORDER BY CASE WHEN c.BlockedReason IS NULL THEN 0 ELSE 1 END,
                          CASE WHEN c.DeliveryWindowFlag IS NULL THEN 0 ELSE 1 END,
                          DATEDIFF(DAY, c.DeliveryStart, c.DeliveryEnd) DESC,
                          c.DeliveryStart ASC,
                          c.TradeTimestamp DESC,
                          c.Symbol ASC)
    END,
    CurrentSheetBid    = b.Bid,
    CurrentSheetSource = b.Source,
    CurrentSheetAsOf   = b.QuoteAsOf
FROM candidate AS c
LEFT JOIN dbo.BidSheetLocationBids AS b
    ON b.LocationId    = c.LocationId
   AND b.CommodityCode = c.CommodityCode
   AND b.CropYear      = c.CropYear
   AND b.Month         = c.BidMonth;");
        }
    }
}
