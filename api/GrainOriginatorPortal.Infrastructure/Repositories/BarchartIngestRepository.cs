using System.Data;
using System.Data.Common;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

/// <summary>
/// BarChart feed data access. Loads use <c>OPENJSON</c> to whitelist-extract vendor fields and
/// <c>TRY_CONVERT</c> to type them, so one malformed value becomes a NULL in that column instead of
/// failing the whole load — the vendor's real payloads contain typos, blanks and embedded newlines.
///
/// These statements are multi-statement batches (declares, a staging table variable, a transaction),
/// so they are issued as ADO commands rather than through <c>SqlQueryRaw</c>, which requires a single
/// composable SELECT it can wrap. Values are always bound as named parameters, never concatenated.
/// </summary>
public class BarchartIngestRepository : IBarchartIngestRepository
{
    private readonly ApplicationDbContext _appContext;

    public BarchartIngestRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext ?? throw new ArgumentNullException(nameof(appContext));
    }

    /// <summary>
    /// Extracts the vendor's <c>results</c> array (or accepts a bare array) and leaves <c>@payload</c>
    /// NULL when the body isn't usable JSON, so the callers can short-circuit instead of letting
    /// OPENJSON raise.
    /// </summary>
    private const string PayloadPrologue = @"
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @payload nvarchar(max) =
    CASE WHEN LEFT(LTRIM(@Json), 1) = N'[' THEN @Json ELSE JSON_QUERY(@Json, N'$.results') END;
";

    /// <inheritdoc />
    public async Task<int> LoadInstrumentsAsync(string json, CancellationToken cancellationToken = default)
    {
        // Symbol anatomy (vendor-confirmed):
        //   {root}{P=cash|B=basis}{monthCode}{yy}[F|L]-{locationId}-{internalMapId}.CM
        // e.g. ZCPQ26-27300-6916.CM -> root ZC, bidCash, location 27300
        //      ZCPQ26F-82259-15194.CM -> same plus first-half delivery window
        // The chained CROSS APPLYs slice the symbol once and reuse the offsets.
        const string sql = PayloadPrologue + @"
IF @payload IS NULL OR ISJSON(@payload) = 0
BEGIN
    SELECT CAST(0 AS int) AS Value;
END
ELSE
BEGIN
    ;WITH src AS
    (
        SELECT
            Symbol             = LEFT(sx.sym, 100),
            LocationKey        = CASE WHEN dx.d1 > 0 AND dx.d2 > dx.d1 + 1
                                      THEN LEFT(LTRIM(RTRIM(SUBSTRING(sx.sym, dx.d1 + 1, dx.d2 - dx.d1 - 1))), 50) END,
            Root               = LEFT(rt.root, 10),
            InstrumentType     = CASE rt.typeLetter WHEN N'P' THEN N'bidCash' WHEN N'B' THEN N'bidBasis' END,
            DeliveryWindowFlag = wf.windowFlag,
            SymbolDescription  = LEFT(j.symbolDescription, 500),
            Elevator           = LEFT(j.elevator, 300),
            LocationName       = LEFT(j.locationName, 300),
            FacilityType       = LEFT(j.facilityType, 100),
            Commodity          = LEFT(j.commodity, 200),
            UnderlyingFuture   = LEFT(j.underlyingFuture, 20),
            DeliveryStart      = CONVERT(datetime2(3), SWITCHOFFSET(TRY_CONVERT(datetimeoffset, j.deliveryStart), N'+00:00')),
            DeliveryEnd        = CONVERT(datetime2(3), SWITCHOFFSET(TRY_CONVERT(datetimeoffset, j.deliveryEnd), N'+00:00')),
            Address            = LEFT(REPLACE(REPLACE(REPLACE(j.address, CHAR(13) + CHAR(10), N', '), CHAR(13), N', '), CHAR(10), N', '), 500),
            City               = LEFT(LTRIM(RTRIM(j.city)), 100),
            State              = LEFT(LTRIM(RTRIM(j.state)), 10),
            ZipCode            = LEFT(LTRIM(RTRIM(j.zipCode)), 20),
            Latitude           = TRY_CONVERT(float, j.latitude),
            Longitude          = TRY_CONVERT(float, j.longitude),
            County             = LEFT(j.county, 100),
            StateFips          = LEFT(LTRIM(RTRIM(j.stateFipsCode)), 10),
            CountyFips         = LEFT(LTRIM(RTRIM(j.countyFipsCode)), 10),
            Phone              = LEFT(LTRIM(RTRIM(j.phone)), 50),
            Website            = LEFT(LTRIM(RTRIM(j.website)), 300),
            IsTest             = CASE WHEN LOWER(ISNULL(j.elevator, N'')) LIKE N'%bid sync test%'
                                        OR LOWER(ISNULL(j.symbolDescription, N'')) LIKE N'%bid sync test%'
                                        OR LOWER(ISNULL(j.elevator, N'')) LIKE N'%agvance%'
                                      THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END,
            rn                 = ROW_NUMBER() OVER (PARTITION BY sx.sym ORDER BY (SELECT 0))
        FROM OPENJSON(@payload) WITH
        (
            symbol            nvarchar(4000) N'$.symbol',
            symbolDescription nvarchar(4000) N'$.symbolDescription',
            elevator          nvarchar(4000) N'$.elevator',
            commodity         nvarchar(4000) N'$.commodity',
            underlyingFuture  nvarchar(4000) N'$.underlyingFuture',
            deliveryStart     nvarchar(4000) N'$.deliveryStart',
            deliveryEnd       nvarchar(4000) N'$.deliveryEnd',
            locationName      nvarchar(4000) N'$.location',
            facilityType      nvarchar(4000) N'$.facilityType',
            phone             nvarchar(4000) N'$.phone',
            website           nvarchar(4000) N'$.website',
            address           nvarchar(4000) N'$.address',
            city              nvarchar(4000) N'$.city',
            state             nvarchar(4000) N'$.state',
            zipCode           nvarchar(4000) N'$.zipCode',
            longitude         nvarchar(4000) N'$.longitude',
            latitude          nvarchar(4000) N'$.latitude',
            county            nvarchar(4000) N'$.county',
            countyFipsCode    nvarchar(4000) N'$.countyFipsCode',
            stateFipsCode     nvarchar(4000) N'$.stateFipsCode'
        ) AS j
        CROSS APPLY (SELECT LTRIM(RTRIM(j.symbol)) AS sym) AS sx
        CROSS APPLY (SELECT CHARINDEX(N'-', sx.sym) AS d1) AS d1x
        CROSS APPLY (SELECT d1x.d1 AS d1,
                            CASE WHEN d1x.d1 > 0 THEN CHARINDEX(N'-', sx.sym, d1x.d1 + 1) ELSE 0 END AS d2) AS dx
        CROSS APPLY (SELECT CASE WHEN dx.d1 > 1 THEN LEFT(sx.sym, dx.d1 - 1) END AS preDash) AS pd
        CROSS APPLY (SELECT CASE WHEN pd.preDash IS NOT NULL AND RIGHT(pd.preDash, 1) IN (N'F', N'L')
                                 THEN RIGHT(pd.preDash, 1) END AS windowFlag) AS wf
        CROSS APPLY (SELECT CASE WHEN wf.windowFlag IS NOT NULL THEN LEFT(pd.preDash, LEN(pd.preDash) - 1)
                                 ELSE pd.preDash END AS core) AS co
        CROSS APPLY (SELECT CASE WHEN LEN(ISNULL(co.core, N'')) >= 5 THEN SUBSTRING(co.core, LEN(co.core) - 3, 1) END AS typeLetter,
                            CASE WHEN LEN(ISNULL(co.core, N'')) >= 5 THEN LEFT(co.core, LEN(co.core) - 4) END AS root) AS rt
        WHERE NULLIF(sx.sym, N'') IS NOT NULL
    )
    MERGE dbo.BarchartInstrument WITH (HOLDLOCK) AS t
    USING
    (
        SELECT
            Symbol, LocationKey, Root, InstrumentType, DeliveryWindowFlag, SymbolDescription,
            Elevator, LocationName, FacilityType, Commodity, UnderlyingFuture,
            DeliveryStart, DeliveryEnd, Address, City, State, ZipCode, Latitude, Longitude,
            County, StateFips, CountyFips, Phone, Website, IsTest
        FROM src
        WHERE rn = 1
    ) AS s
       ON t.Symbol = s.Symbol
    WHEN MATCHED THEN UPDATE SET
        t.LocationKey        = s.LocationKey,
        t.Root               = s.Root,
        t.InstrumentType     = s.InstrumentType,
        t.DeliveryWindowFlag = s.DeliveryWindowFlag,
        t.SymbolDescription  = s.SymbolDescription,
        t.Elevator           = s.Elevator,
        t.LocationName       = s.LocationName,
        t.FacilityType       = s.FacilityType,
        t.Commodity          = s.Commodity,
        t.UnderlyingFuture   = s.UnderlyingFuture,
        t.DeliveryStart      = s.DeliveryStart,
        t.DeliveryEnd        = s.DeliveryEnd,
        t.Address            = s.Address,
        t.City               = s.City,
        t.State              = s.State,
        t.ZipCode            = s.ZipCode,
        t.Latitude           = s.Latitude,
        t.Longitude          = s.Longitude,
        t.County             = s.County,
        t.StateFips          = s.StateFips,
        t.CountyFips         = s.CountyFips,
        t.Phone              = s.Phone,
        t.Website            = s.Website,
        t.IsTest             = s.IsTest,
        t.IsActive           = CAST(1 AS bit),   -- a symbol that reappears comes back to life
        t.LastSeenUtc        = SYSUTCDATETIME()
    WHEN NOT MATCHED BY TARGET THEN INSERT
    (
        Symbol, LocationKey, Root, InstrumentType, DeliveryWindowFlag, SymbolDescription,
        Elevator, LocationName, FacilityType, Commodity, UnderlyingFuture,
        DeliveryStart, DeliveryEnd, Address, City, State, ZipCode, Latitude, Longitude,
        County, StateFips, CountyFips, Phone, Website, IsTest, IsActive, FirstSeenUtc, LastSeenUtc
    )
    VALUES
    (
        s.Symbol, s.LocationKey, s.Root, s.InstrumentType, s.DeliveryWindowFlag, s.SymbolDescription,
        s.Elevator, s.LocationName, s.FacilityType, s.Commodity, s.UnderlyingFuture,
        s.DeliveryStart, s.DeliveryEnd, s.Address, s.City, s.State, s.ZipCode, s.Latitude, s.Longitude,
        s.County, s.StateFips, s.CountyFips, s.Phone, s.Website, s.IsTest, CAST(1 AS bit),
        SYSUTCDATETIME(), SYSUTCDATETIME()
    );

    SELECT CAST(@@ROWCOUNT AS int);
END";

        return await ExecuteScalarIntAsync(sql, cancellationToken, ("@Json", json));
    }

    /// <inheritdoc />
    public async Task<BarchartQuoteLoadResult> LoadQuotesAsync(
        string json, DateOnly snapshotDate, CancellationToken cancellationToken = default)
    {
        // Current price and daily history are written in one transaction so they can't diverge.
        // The staging table variable keeps the JSON parsed once and lets both MERGEs share it.
        // @snapshotDate is supplied by the caller as a bound parameter (not declared here — SQL Server
        // treats variable names case-insensitively, so declaring it would collide with the parameter).
        const string sql = PayloadPrologue + @"
DECLARE @src TABLE
(
    Symbol          nvarchar(100) NOT NULL PRIMARY KEY,
    LastPrice       decimal(19,4) NULL,
    NetChange       decimal(19,4) NULL,
    PercentChange   decimal(19,4) NULL,
    OpenPrice       decimal(19,4) NULL,
    HighPrice       decimal(19,4) NULL,
    LowPrice        decimal(19,4) NULL,
    ClosePrice      decimal(19,4) NULL,
    UnitCode        nvarchar(10)  NULL,
    DayCode         nvarchar(5)   NULL,
    QuoteMode       nvarchar(10)  NULL,
    QuoteFlag       nvarchar(5)   NULL,
    TradeTimestamp  datetime2(3)  NULL,
    ServerTimestamp datetime2(3)  NULL,
    IsKnownSymbol   bit           NOT NULL
);

IF @payload IS NOT NULL AND ISJSON(@payload) = 1
BEGIN
    ;WITH raw AS
    (
        SELECT
            Symbol          = LEFT(LTRIM(RTRIM(j.symbol)), 100),
            LastPrice       = TRY_CONVERT(decimal(19,4), j.lastPrice),
            NetChange       = TRY_CONVERT(decimal(19,4), j.netChange),
            PercentChange   = TRY_CONVERT(decimal(19,4), j.percentChange),
            OpenPrice       = TRY_CONVERT(decimal(19,4), j.openPrice),
            HighPrice       = TRY_CONVERT(decimal(19,4), j.highPrice),
            LowPrice        = TRY_CONVERT(decimal(19,4), j.lowPrice),
            ClosePrice      = TRY_CONVERT(decimal(19,4), j.closePrice),
            UnitCode        = LEFT(j.unitCode, 10),
            DayCode         = LEFT(j.dayCode, 5),
            QuoteMode       = LEFT(j.quoteMode, 10),
            QuoteFlag       = LEFT(j.quoteFlag, 5),
            TradeTimestamp  = CONVERT(datetime2(3), SWITCHOFFSET(TRY_CONVERT(datetimeoffset, j.tradeTimestamp), N'+00:00')),
            ServerTimestamp = CONVERT(datetime2(3), SWITCHOFFSET(TRY_CONVERT(datetimeoffset, j.serverTimestamp), N'+00:00')),
            rn              = ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(j.symbol)) ORDER BY (SELECT 0))
        FROM OPENJSON(@payload) WITH
        (
            symbol          nvarchar(4000) N'$.symbol',
            lastPrice       nvarchar(100)  N'$.lastPrice',
            netChange       nvarchar(100)  N'$.netChange',
            percentChange   nvarchar(100)  N'$.percentChange',
            openPrice       nvarchar(100)  N'$.open',
            highPrice       nvarchar(100)  N'$.high',
            lowPrice        nvarchar(100)  N'$.low',
            closePrice      nvarchar(100)  N'$.close',
            unitCode        nvarchar(100)  N'$.unitCode',
            dayCode         nvarchar(100)  N'$.dayCode',
            quoteMode       nvarchar(100)  N'$.mode',
            quoteFlag       nvarchar(100)  N'$.flag',
            tradeTimestamp  nvarchar(100)  N'$.tradeTimestamp',
            serverTimestamp nvarchar(100)  N'$.serverTimestamp',
            statusCode      nvarchar(100)  N'$.code'
        ) AS j
        WHERE NULLIF(LTRIM(RTRIM(j.symbol)), N'') IS NOT NULL
          -- Per-row vendor status: skip explicit failures, keep rows that carry no code.
          AND (j.statusCode IS NULL OR TRY_CONVERT(int, j.statusCode) = 200)
    )
    INSERT @src
    (
        Symbol, LastPrice, NetChange, PercentChange, OpenPrice, HighPrice, LowPrice, ClosePrice,
        UnitCode, DayCode, QuoteMode, QuoteFlag, TradeTimestamp, ServerTimestamp, IsKnownSymbol
    )
    SELECT
        r.Symbol, r.LastPrice, r.NetChange, r.PercentChange, r.OpenPrice, r.HighPrice, r.LowPrice,
        r.ClosePrice, r.UnitCode, r.DayCode, r.QuoteMode, r.QuoteFlag, r.TradeTimestamp, r.ServerTimestamp,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.BarchartInstrument AS i WHERE i.Symbol = r.Symbol)
             THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END
    FROM raw AS r
    WHERE r.rn = 1;
END

DECLARE @upserted int = 0;

BEGIN TRANSACTION;

MERGE dbo.BarchartCurrentQuote WITH (HOLDLOCK) AS t
USING
(
    SELECT
        Symbol, LastPrice, NetChange, PercentChange, OpenPrice, HighPrice, LowPrice, ClosePrice,
        UnitCode, DayCode, QuoteMode, QuoteFlag, TradeTimestamp, ServerTimestamp
    FROM @src
    WHERE IsKnownSymbol = 1
) AS s
   ON t.Symbol = s.Symbol
WHEN MATCHED THEN UPDATE SET
    t.LastPrice       = s.LastPrice,
    t.NetChange       = s.NetChange,
    t.PercentChange   = s.PercentChange,
    t.OpenPrice       = s.OpenPrice,
    t.HighPrice       = s.HighPrice,
    t.LowPrice        = s.LowPrice,
    t.ClosePrice      = s.ClosePrice,
    t.UnitCode        = s.UnitCode,
    t.DayCode         = s.DayCode,
    t.QuoteMode       = s.QuoteMode,
    t.QuoteFlag       = s.QuoteFlag,
    t.TradeTimestamp  = s.TradeTimestamp,
    t.ServerTimestamp = s.ServerTimestamp,
    t.UpdatedAtUtc    = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN INSERT
(
    Symbol, LastPrice, NetChange, PercentChange, OpenPrice, HighPrice, LowPrice, ClosePrice,
    UnitCode, DayCode, QuoteMode, QuoteFlag, TradeTimestamp, ServerTimestamp, UpdatedAtUtc
)
VALUES
(
    s.Symbol, s.LastPrice, s.NetChange, s.PercentChange, s.OpenPrice, s.HighPrice, s.LowPrice,
    s.ClosePrice, s.UnitCode, s.DayCode, s.QuoteMode, s.QuoteFlag, s.TradeTimestamp,
    s.ServerTimestamp, SYSUTCDATETIME()
);

SET @upserted = @@ROWCOUNT;

-- Same business date replaces rather than duplicates, so a retried load is harmless.
MERGE dbo.BarchartQuoteSnapshot WITH (HOLDLOCK) AS t
USING
(
    SELECT Symbol, LastPrice, NetChange, TradeTimestamp
    FROM @src
    WHERE IsKnownSymbol = 1
) AS s
   ON t.SnapshotDate = @snapshotDate AND t.Symbol = s.Symbol
WHEN MATCHED THEN UPDATE SET
    t.LastPrice      = s.LastPrice,
    t.NetChange      = s.NetChange,
    t.TradeTimestamp = s.TradeTimestamp,
    t.CreatedAtUtc   = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN INSERT
    (SnapshotDate, Symbol, LastPrice, NetChange, TradeTimestamp, CreatedAtUtc)
VALUES
    (@snapshotDate, s.Symbol, s.LastPrice, s.NetChange, s.TradeTimestamp, SYSUTCDATETIME());

COMMIT TRANSACTION;

SELECT
    QuotesUpserted     = @upserted,
    UnknownSymbolCount = (SELECT COUNT(*) FROM @src WHERE IsKnownSymbol = 0);";

        var rows = await ExecuteReaderAsync(
            sql,
            reader => new BarchartQuoteLoadResult
            {
                QuotesUpserted = reader.GetInt32(0),
                UnknownSymbolCount = reader.GetInt32(1)
            },
            cancellationToken,
            ("@Json", json),
            ("@snapshotDate", snapshotDate));

        return rows.Count > 0 ? rows[0] : new BarchartQuoteLoadResult();
    }

    /// <inheritdoc />
    public async Task<List<BarchartQuoteBatch>> GetQuoteBatchesAsync(
        int batchSize, CancellationToken cancellationToken = default)
    {
        const string sql = @"
SET NOCOUNT ON;

;WITH numbered AS
(
    SELECT
        i.Symbol,
        BatchZero = (ROW_NUMBER() OVER (ORDER BY i.Symbol) - 1) / @BatchSize
    FROM dbo.BarchartInstrument AS i
    WHERE i.IsActive = 1
      AND i.IsTest = 0
)
SELECT
    -- ROW_NUMBER() is bigint, so the derived batch number is cast back to int for the caller.
    BatchNumber = CAST(n.BatchZero + 1 AS int),
    SymbolCount = COUNT(*),
    SymbolsCsv  = STRING_AGG(CONVERT(nvarchar(max), n.Symbol), N',')
FROM numbered AS n
GROUP BY n.BatchZero
ORDER BY n.BatchZero;";

        var effectiveBatchSize = batchSize < 1 ? 100 : batchSize;

        return await ExecuteReaderAsync(
            sql,
            reader => new BarchartQuoteBatch
            {
                BatchNumber = reader.GetInt32(0),
                SymbolCount = reader.GetInt32(1),
                SymbolsCsv = reader.IsDBNull(2) ? string.Empty : reader.GetString(2)
            },
            cancellationToken,
            ("@BatchSize", effectiveBatchSize));
    }

    /// <inheritdoc />
    public async Task<int> DeactivateMissingInstrumentsAsync(
        DateTime lastSeenBeforeUtc, CancellationToken cancellationToken = default)
    {
        const string sql = @"
SET NOCOUNT ON;

UPDATE dbo.BarchartInstrument
   SET IsActive = CAST(0 AS bit)
 WHERE IsActive = 1
   AND LastSeenUtc < @LastSeenBeforeUtc;

SELECT CAST(@@ROWCOUNT AS int);";

        return await ExecuteScalarIntAsync(sql, cancellationToken, ("@LastSeenBeforeUtc", lastSeenBeforeUtc));
    }

    /// <inheritdoc />
    public async Task<BarchartDeactivationImpact> PreviewDeactivationAsync(
        DateTime lastSeenBeforeUtc, CancellationToken cancellationToken = default)
    {
        const string sql = @"
SELECT
    ActiveCount     = COUNT(*),
    WouldDeactivate = SUM(CASE WHEN i.LastSeenUtc < @LastSeenBeforeUtc THEN 1 ELSE 0 END)
FROM dbo.BarchartInstrument AS i
WHERE i.IsActive = 1
  AND i.IsTest = 0;";

        var rows = await ExecuteReaderAsync(
            sql,
            reader => new BarchartDeactivationImpact
            {
                ActiveCount = reader.IsDBNull(0) ? 0 : reader.GetInt32(0),
                WouldDeactivate = reader.IsDBNull(1) ? 0 : reader.GetInt32(1)
            },
            cancellationToken,
            ("@LastSeenBeforeUtc", lastSeenBeforeUtc));

        return rows.FirstOrDefault() ?? new BarchartDeactivationImpact();
    }

    /// <inheritdoc />
    public async Task<int> ApplyBidsToBidSheetAsync(
        int? locationId, string? instrumentType, string appliedBy,
        int maxQuoteAgeDays = BarchartFeedDefaults.MaxQuoteAgeDays,
        CancellationToken cancellationToken = default)
    {
        // Publishes one winning price per (location, commodity, crop year, month) cell, then prunes
        // feed-owned cells that no longer have a winner (rolled-off delivery months, deactivated
        // instruments, or a commodity mapping switched off).
        //
        // The ownership rule lives here: only Source='Barchart' rows are ever written or removed, so a
        // manually entered bid is untouchable. The MATCHED clause additionally requires a real change,
        // which stops a no-op run from churning ModifiedAt on every cell.
        // @locationId, @instrumentType and @appliedBy arrive as bound parameters — they are not
        // declared here because SQL Server treats variable names case-insensitively, so a DECLARE
        // would collide with the parameter of the same name.
        const string sql = @"
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @winners TABLE
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
    PRIMARY KEY (LocationId, CommodityCode, CropYear, BidMonth)
);

;WITH candidate AS
(
    SELECT
        LocationId        = loc.Id,
        CommodityCode     = m.CommodityCode,
        CommodityName     = m.CommodityName,
        CommodityCategory = m.CommodityCategory,
        CropYear          = YEAR(i.DeliveryStart),
        BidMonth          = MONTH(i.DeliveryStart),
        Symbol            = i.Symbol,
        PriceType         = i.InstrumentType,
        -- Cash renders as money; basis is whole cents against the board, so trailing zeros are noise:
        -- an originator reads 30 under, not minus thirty point zero zero.
        BidText           = CASE WHEN i.InstrumentType = @basisType
                                 THEN FORMAT(q.LastPrice, N'0.####', N'en-US')
                                 ELSE FORMAT(q.LastPrice, N'0.00##', N'en-US') END,
        QuoteAsOf         = CONVERT(datetime2, q.TradeTimestamp),
        -- Whole-month bids beat half-month splits; then the widest window, earliest start and
        -- freshest quote. Symbol last makes the order total, so the winner never flip-flops.
        -- Partitioned by type as well, so cash and basis each get their own winner for the cell.
        rn = ROW_NUMBER() OVER (
                 PARTITION BY loc.Id, m.CommodityCode, YEAR(i.DeliveryStart), MONTH(i.DeliveryStart),
                              i.InstrumentType
                 ORDER BY CASE WHEN i.DeliveryWindowFlag IS NULL THEN 0 ELSE 1 END,
                          DATEDIFF(DAY, i.DeliveryStart, i.DeliveryEnd) DESC,
                          i.DeliveryStart ASC,
                          q.TradeTimestamp DESC,
                          i.Symbol ASC)
    FROM dbo.BidSheetLocations AS loc
    INNER JOIN dbo.BarchartInstrument AS i
        ON i.LocationKey = loc.BarchartLocationKey
       AND i.IsActive = 1
       AND i.IsTest = 0
       AND i.DeliveryStart IS NOT NULL
       AND i.InstrumentType IN (@cashType, @basisType)
       -- Skip windows that have fully elapsed: an originator can no longer deliver into them, so
       -- publishing a price for one would put a dead month on the Bid Sheet.
       AND (i.DeliveryEnd IS NULL OR i.DeliveryEnd >= CAST(SYSUTCDATETIME() AS date))
    INNER JOIN dbo.BarchartCurrentQuote AS q
        ON q.Symbol = i.Symbol
       AND q.LastPrice IS NOT NULL
       -- Only publish a price we'd stand behind. The vendor mixes fresh quotes with long-stale ones and
       -- with placeholders in the same payload, and a wrong number on the sheet is worse than a blank
       -- cell: an originator can see a blank, but reads a stale price as today's market.
       -- Cash has a floor (0.0025 is the vendor's no-bid placeholder); basis is legitimately negative,
       -- so it gets a symmetric magnitude bound instead. Both exclude the 214748.3647 sentinel.
       AND ((i.InstrumentType = @cashType AND q.LastPrice >= @minPrice AND q.LastPrice <= @maxPrice)
         OR (i.InstrumentType = @basisType AND ABS(q.LastPrice) <= @maxPrice))
       -- Publish live quotes at any age, and let the UI show how old they are. Age alone is a poor
       -- test: an elevator that posts a new-crop bid and leaves it for two months is behaving normally,
       -- and a delivery month already tells the user which period a bid covers. Measured on the feed,
       -- age was only ever a proxy for the vendor's own mode flag -- no live (mode i) quote exceeds 90
       -- days, while every quote past 90 days is mode d, as is every sentinel. A 7-day cutoff was
       -- therefore hiding ~1,245 real bids to block a population that mode identifies exactly.
       AND ISNULL(q.QuoteMode, N'i') <> N'd'
       -- Far outer backstop only, in case mode ever stops being trustworthy.
       AND (q.TradeTimestamp IS NULL
            OR q.TradeTimestamp >= DATEADD(DAY, -@maxQuoteAgeDays, SYSUTCDATETIME()))
    INNER JOIN dbo.BarchartCommodityMap AS m
        ON m.BarchartCommodity = i.Commodity
       AND m.IsActive = 1
    WHERE loc.BarchartLocationKey IS NOT NULL
      AND (@locationId IS NULL OR loc.Id = @locationId)
)
-- One row per cell carrying both prices. A cell with only one of the two still produces a row; the
-- other side stays NULL and the sheet simply has nothing to show for that mode.
INSERT @winners
    (LocationId, CommodityCode, CommodityName, CommodityCategory, CropYear, BidMonth,
     Symbol, BidText, QuoteAsOf, BasisSymbol, BasisText, BasisQuoteAsOf)
SELECT
    c.LocationId, c.CommodityCode,
    MAX(c.CommodityName), MAX(c.CommodityCategory),
    c.CropYear, c.BidMonth,
    Symbol         = MAX(CASE WHEN c.PriceType = @cashType  THEN c.Symbol    END),
    BidText        = MAX(CASE WHEN c.PriceType = @cashType  THEN c.BidText   END),
    QuoteAsOf      = MAX(CASE WHEN c.PriceType = @cashType  THEN c.QuoteAsOf END),
    BasisSymbol    = MAX(CASE WHEN c.PriceType = @basisType THEN c.Symbol    END),
    BasisText      = MAX(CASE WHEN c.PriceType = @basisType THEN c.BidText   END),
    BasisQuoteAsOf = MAX(CASE WHEN c.PriceType = @basisType THEN c.QuoteAsOf END)
FROM candidate AS c
WHERE c.rn = 1
GROUP BY c.LocationId, c.CommodityCode, c.CropYear, c.BidMonth;

DECLARE @written int = 0;
DECLARE @pruned  int = 0;

BEGIN TRANSACTION;

MERGE dbo.BidSheetLocationBids WITH (HOLDLOCK) AS t
USING
(
    SELECT LocationId, CommodityCode, CommodityName, CommodityCategory, CropYear, BidMonth,
           Symbol, BidText, QuoteAsOf, BasisSymbol, BasisText, BasisQuoteAsOf
    FROM @winners
) AS s
   ON t.LocationId    = s.LocationId
  AND t.CommodityCode = s.CommodityCode
  AND t.CropYear      = s.CropYear
  AND t.Month         = s.BidMonth
-- A manual cell matches here but satisfies no clause, so it is left exactly as the user typed it.
WHEN MATCHED AND t.Source = N'Barchart'
             AND (t.Bid <> ISNULL(s.BidText, N'')
                  OR ISNULL(t.BarchartSymbol, N'') <> ISNULL(s.Symbol, N'')
                  OR ISNULL(t.QuoteAsOf, N'19000101') <> ISNULL(s.QuoteAsOf, N'19000101')
                  OR ISNULL(t.BasisBid, N'') <> ISNULL(s.BasisText, N'')
                  OR ISNULL(t.BasisSymbol, N'') <> ISNULL(s.BasisSymbol, N'')
                  OR ISNULL(t.BasisQuoteAsOf, N'19000101') <> ISNULL(s.BasisQuoteAsOf, N'19000101'))
    THEN UPDATE SET
        t.Bid               = ISNULL(s.BidText, N''),
        t.CommodityName     = s.CommodityName,
        t.CommodityCategory = s.CommodityCategory,
        t.BarchartSymbol    = s.Symbol,
        t.QuoteAsOf         = s.QuoteAsOf,
        t.BasisBid          = s.BasisText,
        t.BasisSymbol       = s.BasisSymbol,
        t.BasisQuoteAsOf    = s.BasisQuoteAsOf,
        t.ModifiedBy        = @appliedBy,
        t.ModifiedAt        = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN INSERT
(
    LocationId, CommodityCode, CommodityName, CommodityCategory, CropYear, Month,
    Bid, Source, BarchartSymbol, QuoteAsOf, BasisBid, BasisSymbol, BasisQuoteAsOf, CreatedBy, CreatedAt
)
VALUES
(
    s.LocationId, s.CommodityCode, s.CommodityName, s.CommodityCategory, s.CropYear, s.BidMonth,
    ISNULL(s.BidText, N''), N'Barchart', s.Symbol, s.QuoteAsOf,
    s.BasisText, s.BasisSymbol, s.BasisQuoteAsOf, @appliedBy, SYSUTCDATETIME()
);

SET @written = @@ROWCOUNT;

-- Prune feed-owned cells with no current winner. Scoped to linked locations (and to the single
-- location when one was requested) so another trade unit's rows are never in range.
DELETE b
  FROM dbo.BidSheetLocationBids AS b
 INNER JOIN dbo.BidSheetLocations AS l
    ON l.Id = b.LocationId
 WHERE b.Source = N'Barchart'
   AND l.BarchartLocationKey IS NOT NULL
   AND (@locationId IS NULL OR l.Id = @locationId)
   AND NOT EXISTS
       (
           SELECT 1
           FROM @winners AS w
           WHERE w.LocationId    = b.LocationId
             AND w.CommodityCode = b.CommodityCode
             AND w.CropYear      = b.CropYear
             AND w.BidMonth      = b.Month
       );

SET @pruned = @@ROWCOUNT;

COMMIT TRANSACTION;

SELECT CAST(@written + @pruned AS int);";

        return await ExecuteScalarIntAsync(
            sql,
            cancellationToken,
            ("@locationId", locationId.HasValue ? locationId.Value : DBNull.Value),
            // instrumentType names the CASH type; basis is always published alongside it into its own
            // columns, so the sheet can switch between the two without a second run.
            ("@cashType", string.IsNullOrWhiteSpace(instrumentType)
                ? BarchartFeedDefaults.InstrumentType : instrumentType),
            ("@basisType", BarchartFeedDefaults.BasisInstrumentType),
            ("@appliedBy", appliedBy),
            ("@maxQuoteAgeDays", maxQuoteAgeDays),
            ("@minPrice", BarchartFeedDefaults.MinPublishablePrice),
            ("@maxPrice", BarchartFeedDefaults.MaxPublishablePrice));
    }

    /// <inheritdoc />
    public async Task LogApiCallAsync(BarchartApiCallAudit audit, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(audit);

        _appContext.BarchartApiCallAudits.Add(audit);
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<int> PurgeHistoryAsync(
        int auditRetentionDays, int snapshotRetentionDays, CancellationToken cancellationToken = default)
    {
        // Deliberately not wrapped in a transaction: each batch commits on its own so a purge that has
        // been deferred for months trims steadily instead of building one huge, lock-heavy transaction.
        const string sql = @"
SET NOCOUNT ON;

DECLARE @auditCutoff datetime2(3) = DATEADD(DAY, -@AuditRetentionDays, SYSUTCDATETIME());
DECLARE @snapshotCutoff date     = DATEADD(DAY, -@SnapshotRetentionDays, CONVERT(date, SYSUTCDATETIME()));
DECLARE @removed int = 0;
DECLARE @batch   int = 1;

WHILE @batch > 0
BEGIN
    DELETE TOP (5000) FROM dbo.BarchartApiCallAudit WHERE CalledAtUtc < @auditCutoff;
    SET @batch = @@ROWCOUNT;
    SET @removed = @removed + @batch;
END

SET @batch = 1;
WHILE @batch > 0
BEGIN
    DELETE TOP (5000) FROM dbo.BarchartQuoteSnapshot WHERE SnapshotDate < @snapshotCutoff;
    SET @batch = @@ROWCOUNT;
    SET @removed = @removed + @batch;
END

SELECT CAST(@removed AS int);";

        return await ExecuteScalarIntAsync(
            sql,
            cancellationToken,
            ("@AuditRetentionDays", auditRetentionDays),
            ("@SnapshotRetentionDays", snapshotRetentionDays));
    }

    /// <inheritdoc />
    public async Task<BarchartApiBudget> GetApiBudgetAsync(
        int monthlyCap, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        // Only the two endpoints that stand in 1:1 for a real BarChart call. The pipeline posts to
        // these immediately after calling the vendor, so counting them measures vendor quota; the rest
        // (quote-batches, apply-bids, deactivate, purge) are internal and consume none of it, and
        // including them would overstate usage against the contract cap.
        var monthToDate = await _appContext.BarchartApiCallAudits
            .AsNoTracking()
            .CountAsync(a => a.CalledAtUtc >= monthStart
                          && (a.Endpoint == VendorCallEndpoints.Instruments
                           || a.Endpoint == VendorCallEndpoints.Quotes), cancellationToken);

        return new BarchartApiBudget
        {
            MonthToDateCalls = monthToDate,
            RemainingCalls = monthlyCap - monthToDate,
            // 80% of the cap is the point to stop non-essential loads and leave headroom.
            AbortRecommended = monthlyCap > 0 && monthToDate >= (long)monthlyCap * 8 / 10
        };
    }

    /// <summary>Runs a batch whose final statement selects a single integer.</summary>
    private async Task<int> ExecuteScalarIntAsync(
        string sql, CancellationToken cancellationToken, params (string Name, object? Value)[] parameters)
    {
        var rows = await ExecuteReaderAsync(
            sql,
            reader => reader.IsDBNull(0) ? 0 : Convert.ToInt32(reader.GetValue(0)),
            cancellationToken,
            parameters);

        return rows.Count > 0 ? rows[0] : 0;
    }

    /// <summary>
    /// Runs a multi-statement batch and projects its final result set.
    ///
    /// Uses an ADO command rather than <c>SqlQueryRaw</c> because these batches declare variables and
    /// open transactions, which EF cannot compose into the subquery it wraps raw SQL in. Any
    /// transaction already open on the context is joined, so callers — including tests that wrap work
    /// in a rollback — keep control of the unit of work.
    /// </summary>
    private async Task<List<T>> ExecuteReaderAsync<T>(
        string sql,
        Func<DbDataReader, T> project,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        var connection = _appContext.Database.GetDbConnection();
        var openedHere = connection.State != ConnectionState.Open;

        if (openedHere)
            await _appContext.Database.OpenConnectionAsync(cancellationToken);

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;

            var transaction = _appContext.Database.CurrentTransaction?.GetDbTransaction();
            if (transaction is not null)
                command.Transaction = transaction;

            foreach (var (name, value) in parameters)
            {
                var parameter = command.CreateParameter();
                parameter.ParameterName = name;
                parameter.Value = value ?? DBNull.Value;
                command.Parameters.Add(parameter);
            }

            var results = new List<T>();
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                results.Add(project(reader));

            return results;
        }
        finally
        {
            if (openedHere)
                await _appContext.Database.CloseConnectionAsync();
        }
    }
}
