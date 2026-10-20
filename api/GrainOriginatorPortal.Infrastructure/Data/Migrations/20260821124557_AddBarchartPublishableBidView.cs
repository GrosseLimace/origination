using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   AddBarchartPublishableBidView
       Author:      Origination engineering
       Description: Diagnostic view over the BarChart feed: one row per candidate bid for every
                    feed-linked Bid Sheet location, with the price, its age, whether it would publish,
                    and what is on the sheet in that cell today.
       Rollback:    Down() drops the view. It reads existing tables and owns no data, so dropping it
                    cannot lose anything.
    */

    /// <summary>
    /// Creates <c>dbo.vw_BarchartPublishableBid</c>.
    ///
    /// Answers "why is there no bid here?" without anyone writing a five-table join — the question that
    /// comes up every time the feed looks wrong. Rejected candidates are included ON PURPOSE, with the
    /// reason: an unmapped commodity or a stale quote is invisible in the published data, which is
    /// exactly why it's hard to diagnose.
    /// </summary>
    public partial class AddBarchartPublishableBidView : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Thresholds are repeated from BarchartFeedDefaults because a view cannot take parameters.
            // WouldPublishAtDefaults is named to say so: apply-bids accepts a maxQuoteAgeDays override,
            // and a caller using one will get a different answer than this column suggests.
            // scripts/_VerifySchema.sql compares this view's winners against the published rows so the
            // two drifting apart is caught rather than discovered.
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
        -- First reason that applies, most fundamental first: an unmapped commodity can never publish,
        -- however fresh its price.
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
       -- Cash bids only, matching what the bridge publishes. Basis instruments are loaded alongside and
       -- are legitimately NEGATIVE (-30, -116 seen live), so including them here would flag every one of
       -- them as an implausible price and bury the real problems. Revisit if basis ever publishes.
       AND i.InstrumentType = N'bidCash'
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
    -- Same total order the bridge uses to choose one winner per cell, so rank 1 is the row the bridge
    -- would write. Blocked rows are ordered LAST rather than merely hidden: a window function ranks the
    -- whole partition, so without that term a blocked row can take rank 1 and the cell then reports no
    -- winner at all even though a publishable candidate exists.
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
    -- What is actually on the sheet in this cell right now. A 'Manual' source here against a
    -- publishable candidate is the feed being deliberately blocked by a typed bid, which is the single
    -- most confusing state to explain without seeing both sides at once.
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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP VIEW IF EXISTS dbo.vw_BarchartPublishableBid;");
        }
    }
}
