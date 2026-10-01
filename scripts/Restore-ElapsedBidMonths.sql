/* =============================================================================================
   Restore-ElapsedBidMonths.sql
   ---------------------------------------------------------------------------------------------
   Puts back the fed bids for months whose delivery window closed BEFORE the bridge stopped
   deleting them.

   Why this exists
   ---------------
   The nightly bridge used to prune a feed-owned cell the moment its delivery window elapsed: the
   Bid Sheet held "today's bids" and tidied up behind itself. So the record of what an elevator
   paid for August delivery disappeared on 1 September, and an originator looking back found an
   empty month. The bridge now freezes a past month instead (see the prune step in
   BarchartIngestRepository.ApplyBidsToBidSheetAsync), which fixes it going forward. This script
   recovers the months that were already lost.

   What it writes
   --------------
   For every linked location, mapped commodity and PAST contract month, the price the elevator was
   showing on the last day the window was still open -- read from dbo.BarchartQuoteSnapshot, which
   keeps a daily price per symbol for two years. Cash and basis are recovered independently and
   land on the same cell, exactly as the bridge writes them.

   Deliberately NOT reconstructing coverage cells (a later contract's bid reaching back into this
   month). Coverage is newer than the months being recovered, so those cells never existed; this
   restores what the sheet actually held, not a retrospective rewrite of it.

   Safe to re-run
   --------------
   - Only INSERTs where no cell exists for that location/commodity/year/month, so a hand-typed bid
     is never touched and a second run writes nothing.
   - Only months strictly before the current one. Live months are the bridge's business.
   - CreatedBy is 'barchart-history-restore', so restored rows are identifiable:
       SELECT * FROM dbo.BidSheetLocationBids WHERE CreatedBy = N'barchart-history-restore';
     and reversible:
       DELETE FROM dbo.BidSheetLocationBids WHERE CreatedBy = N'barchart-history-restore';
   - CashChangedAt / BasisChangedAt stay NULL: nothing about a closed month has just moved, and
     stamping them would make every restored pin pulse.

   Usage
   -----
   Set @DryRun = 1 (the default) to see the counts and a sample without writing. Set it to 0 to
   apply. Run per environment -- each one recovers as far back as its own snapshot history goes,
   which is 21 days on Dev (the feed started 2026-08-21) and may differ in QA and PROD.
   ============================================================================================= */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @DryRun bit = 1;

-- Plausibility bounds, matching BarchartFeedDefaults. A price outside these is the vendor's
-- placeholder or sentinel, not a bid.
DECLARE @MinPrice decimal(18,4) = 0.01;
DECLARE @MaxPrice decimal(18,4) = 100000;
DECLARE @CashType nvarchar(20)  = N'bidCash';
DECLARE @BasisType nvarchar(20) = N'bidBasis';
DECLARE @Actor nvarchar(255)    = N'barchart-history-restore';
DECLARE @CurrentMonthKey int    = YEAR(SYSUTCDATETIME()) * 100 + MONTH(SYSUTCDATETIME());

DECLARE @restored TABLE
(
    LocationId        int           NOT NULL,
    CommodityCode     nvarchar(50)  NOT NULL,
    CommodityName     nvarchar(200) NULL,
    CommodityCategory nvarchar(100) NULL,
    CropYear          int           NOT NULL,
    BidMonth          int           NOT NULL,
    Symbol            nvarchar(100) NULL,
    BidText           nvarchar(50)  NULL,
    QuoteAsOf         datetime2     NULL,
    BasisSymbol       nvarchar(100) NULL,
    BasisText         nvarchar(50)  NULL,
    BasisQuoteAsOf    datetime2     NULL,
    UnderlyingFuture  nvarchar(20)  NULL,
    PRIMARY KEY (LocationId, CommodityCode, CropYear, BidMonth)
);

;WITH candidate AS
(
    SELECT
        LocationId        = loc.Id,
        CommodityCode     = m.CommodityCode,
        CommodityName     = m.CommodityName,
        CommodityCategory = m.CommodityCategory,
        CropYear          = cmo.CropYear,
        BidMonth          = cmo.BidMonth,
        Symbol            = i.Symbol,
        PriceType         = i.InstrumentType,
        -- Same formatting the bridge uses: cash renders as money, basis as whole cents.
        BidText           = CASE WHEN i.InstrumentType = @BasisType
                                 THEN FORMAT(h.LastPrice, N'0.####', N'en-US')
                                 ELSE FORMAT(h.LastPrice, N'0.00##', N'en-US') END,
        QuoteAsOf         = CONVERT(datetime2, ISNULL(h.TradeTimestamp,
                                CAST(h.SnapshotDate AS datetime2))),
        UnderlyingFuture  = CASE
            WHEN NULLIF(i.UnderlyingFuture, N'') IS NULL THEN NULL
            WHEN i.DeliveryStart IS NOT NULL
             AND PATINDEX(N'%[FGHJKMNQUVXZ][0-9]', i.UnderlyingFuture) > 0
            THEN LEFT(i.UnderlyingFuture, LEN(i.UnderlyingFuture) - 1)
               + RIGHT(CONVERT(nvarchar(4),
                     YEAR(i.DeliveryStart)
                     + ((TRY_CONVERT(int, RIGHT(i.UnderlyingFuture, 1)) - (YEAR(i.DeliveryStart) % 10) + 10) % 10)), 2)
            ELSE i.UnderlyingFuture END,
        -- The bridge's own tiebreak: a whole-month bid beats a half-month one, then the freshest
        -- price, then the widest window, then the symbol so the order is total.
        rn = ROW_NUMBER() OVER (
                 PARTITION BY loc.Id, m.CommodityCode, cmo.CropYear, cmo.BidMonth, i.InstrumentType
                 ORDER BY CASE WHEN i.DeliveryWindowFlag IS NULL THEN 0 ELSE 1 END,
                          h.SnapshotDate DESC,
                          DATEDIFF(DAY, i.DeliveryStart, i.DeliveryEnd) DESC,
                          i.DeliveryStart ASC,
                          i.Symbol ASC)
    FROM dbo.BidSheetLocations AS loc
    INNER JOIN dbo.BarchartInstrument AS i
        ON i.LocationKey = loc.BarchartLocationKey
       AND i.IsTest = 0
       AND i.DeliveryStart IS NOT NULL
       AND i.DeliveryEnd IS NOT NULL
       AND i.InstrumentType IN (@CashType, @BasisType)
    INNER JOIN dbo.BarchartCommodityMap AS m
        ON m.BarchartCommodity = i.Commodity
       AND m.IsActive = 1
    -- The contract month, read from the symbol exactly as the bridge reads it.
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
    -- The last price recorded while the window was still open. A snapshot taken after the window
    -- closed is a price for a contract nobody could deliver into, which is not what the month paid.
    CROSS APPLY
    (
        SELECT TOP 1 s.LastPrice, s.TradeTimestamp, s.SnapshotDate
        FROM dbo.BarchartQuoteSnapshot AS s
        WHERE s.Symbol = i.Symbol
          AND s.LastPrice IS NOT NULL
          AND s.SnapshotDate < CAST(i.DeliveryEnd AS date)
          AND ((i.InstrumentType = @CashType  AND s.LastPrice >= @MinPrice AND s.LastPrice <= @MaxPrice)
            OR (i.InstrumentType = @BasisType AND ABS(s.LastPrice) <= @MaxPrice))
        ORDER BY s.SnapshotDate DESC
    ) AS h
    WHERE loc.BarchartLocationKey IS NOT NULL
      -- Past months only. Anything current or later belongs to the nightly bridge.
      AND (cmo.CropYear * 100 + cmo.BidMonth) < @CurrentMonthKey
)
INSERT @restored
    (LocationId, CommodityCode, CommodityName, CommodityCategory, CropYear, BidMonth,
     Symbol, BidText, QuoteAsOf, BasisSymbol, BasisText, BasisQuoteAsOf, UnderlyingFuture)
SELECT
    c.LocationId, c.CommodityCode,
    MAX(c.CommodityName), MAX(c.CommodityCategory),
    c.CropYear, c.BidMonth,
    Symbol         = MAX(CASE WHEN c.PriceType = @CashType  THEN c.Symbol    END),
    BidText        = MAX(CASE WHEN c.PriceType = @CashType  THEN c.BidText   END),
    QuoteAsOf      = MAX(CASE WHEN c.PriceType = @CashType  THEN c.QuoteAsOf END),
    BasisSymbol    = MAX(CASE WHEN c.PriceType = @BasisType THEN c.Symbol    END),
    BasisText      = MAX(CASE WHEN c.PriceType = @BasisType THEN c.BidText   END),
    BasisQuoteAsOf = MAX(CASE WHEN c.PriceType = @BasisType THEN c.QuoteAsOf END),
    UnderlyingFuture = ISNULL(MAX(CASE WHEN c.PriceType = @CashType  THEN c.UnderlyingFuture END),
                              MAX(CASE WHEN c.PriceType = @BasisType THEN c.UnderlyingFuture END))
FROM candidate AS c
WHERE c.rn = 1
GROUP BY c.LocationId, c.CommodityCode, c.CropYear, c.BidMonth;

-- ---- What would be written -------------------------------------------------------------------
SELECT Summary          = N'restorable cells',
       Cells            = COUNT(*),
       Locations        = COUNT(DISTINCT r.LocationId),
       EarliestMonth    = MIN(r.CropYear * 100 + r.BidMonth),
       LatestMonth      = MAX(r.CropYear * 100 + r.BidMonth),
       WithCash         = SUM(CASE WHEN r.BidText   IS NOT NULL THEN 1 ELSE 0 END),
       WithBasis        = SUM(CASE WHEN r.BasisText IS NOT NULL THEN 1 ELSE 0 END),
       -- LEFT JOIN rather than an EXISTS inside the SUM: SQL Server will not aggregate over a subquery.
       AlreadyOnTheSheet = SUM(CASE WHEN b.Id IS NOT NULL THEN 1 ELSE 0 END)
FROM @restored AS r
LEFT JOIN dbo.BidSheetLocationBids AS b
    ON b.LocationId = r.LocationId AND b.CommodityCode = r.CommodityCode
   AND b.CropYear = r.CropYear AND b.[Month] = r.BidMonth;

SELECT TOP 15 Sample = l.Name, r.CommodityCode, r.CropYear, r.BidMonth,
       Cash = r.BidText, Basis = r.BasisText, Board = r.UnderlyingFuture,
       AsOf = CONVERT(varchar(16), r.QuoteAsOf, 120)
FROM @restored AS r
INNER JOIN dbo.BidSheetLocations AS l ON l.Id = r.LocationId
ORDER BY l.Name, r.CommodityCode, r.CropYear, r.BidMonth;

-- ---- Apply -----------------------------------------------------------------------------------
IF @DryRun = 1
BEGIN
    SELECT Result = N'DRY RUN — nothing written. Set @DryRun = 0 to apply.';
END
ELSE
BEGIN
    BEGIN TRANSACTION;

    INSERT dbo.BidSheetLocationBids
        (LocationId, CommodityCode, CommodityName, CommodityCategory, CropYear, [Month],
         Bid, Source, BarchartSymbol, QuoteAsOf, BasisBid, BasisSymbol, BasisQuoteAsOf,
         UnderlyingFuture, CreatedBy, CreatedAt)
    SELECT
        r.LocationId, r.CommodityCode, r.CommodityName, r.CommodityCategory, r.CropYear, r.BidMonth,
        ISNULL(r.BidText, N''), N'Barchart', r.Symbol, r.QuoteAsOf,
        r.BasisText, r.BasisSymbol, r.BasisQuoteAsOf, r.UnderlyingFuture, @Actor, SYSUTCDATETIME()
    FROM @restored AS r
    -- Never overwrite what is already there, whoever owns it. A hand-typed bid for a past month is
    -- somebody's own record and outranks anything reconstructed.
    WHERE NOT EXISTS
    (
        SELECT 1 FROM dbo.BidSheetLocationBids AS b
        WHERE b.LocationId    = r.LocationId
          AND b.CommodityCode = r.CommodityCode
          AND b.CropYear      = r.CropYear
          AND b.[Month]       = r.BidMonth
    );

    DECLARE @written int = @@ROWCOUNT;

    COMMIT TRANSACTION;

    SELECT Result = N'restored', CellsWritten = @written;
END
