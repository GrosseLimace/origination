using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Creates the <c>barchart</c> schema — the landing zone for the BarChart daily grain-bid feed
    /// (see docs/application-context/Barchart Bid Feed - Database Plan.md).
    ///
    /// Five tables (Instrument catalog, CurrentQuote, QuoteSnapshot history, CommodityMap,
    /// ApiCallAudit), two views, and the load/utility procedures. The load process (owned by the
    /// integration side — Logic App/ADF undecided) calls the procedures with raw API JSON; all
    /// parsing, typing (TRY_CONVERT — bad values become NULL, never a failed load), and filing
    /// rules live here next to the data, so the schema is runner-agnostic.
    ///
    /// The bridge procedure (barchart.usp_ApplyQuotesToBidSheet) is created in the follow-up
    /// migration AddBidSheetBarchartColumns because it references dbo columns added there
    /// (SQL Server validates columns of existing tables at CREATE PROCEDURE time).
    ///
    /// Schema ownership: prefer the DBA pre-creating the schema per environment with
    /// AUTHORIZATION dbo (keeps ownership chaining from barchart procs into dbo tables); the
    /// guarded CREATE below no-ops in that case and otherwise falls back so CI never fails.
    /// </summary>
    public partial class AddBarchartSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Schema — dbo-owned when permissions allow (ownership chaining), plain otherwise.
            migrationBuilder.Sql(@"
IF SCHEMA_ID(N'barchart') IS NULL
BEGIN
    BEGIN TRY
        EXEC(N'CREATE SCHEMA [barchart] AUTHORIZATION [dbo];');
    END TRY
    BEGIN CATCH
        EXEC(N'CREATE SCHEMA [barchart];');
    END CATCH
END");

            // ── Tables ────────────────────────────────────────────────────────────────

            migrationBuilder.Sql(@"
IF OBJECT_ID(N'barchart.Instrument', N'U') IS NULL
BEGIN
    CREATE TABLE barchart.Instrument
    (
        Symbol              nvarchar(100)     NOT NULL CONSTRAINT PK_barchart_Instrument PRIMARY KEY CLUSTERED,
        LocationKey         nvarchar(50)      NULL,  -- middle segment of Symbol; groups one elevator listing's instruments
        Root                nvarchar(10)      NULL,  -- commodity root parsed from Symbol (ZC, ZS, ...)
        InstrumentType      nvarchar(20)      NULL,  -- bidCash | bidBasis, parsed from Symbol (P|B)
        DeliveryWindowFlag  char(1)           NULL,  -- F|L when a month is split into half-month bids
        SymbolDescription   nvarchar(500)     NULL,
        Elevator            nvarchar(300)     NULL,
        LocationName        nvarchar(300)     NULL,
        FacilityType        nvarchar(100)     NULL,
        Commodity           nvarchar(200)     NULL,  -- vendor display name; CommodityMap keys off this
        UnderlyingFuture    nvarchar(20)      NULL,
        DeliveryStart       datetimeoffset(0) NULL,
        DeliveryEnd         datetimeoffset(0) NULL,
        Address             nvarchar(500)     NULL,
        City                nvarchar(100)     NULL,
        State               nvarchar(10)      NULL,
        ZipCode             nvarchar(20)      NULL,
        Latitude            float             NULL,
        Longitude           float             NULL,
        County              nvarchar(100)     NULL,
        StateFips           nvarchar(10)      NULL,
        CountyFips          nvarchar(10)      NULL,
        Phone               nvarchar(50)      NULL,
        Website             nvarchar(300)     NULL,
        IsTest              bit               NOT NULL CONSTRAINT DF_barchart_Instrument_IsTest DEFAULT 0,
        IsActive            bit               NOT NULL CONSTRAINT DF_barchart_Instrument_IsActive DEFAULT 1,
        FirstSeenUtc        datetime2(3)      NOT NULL CONSTRAINT DF_barchart_Instrument_FirstSeenUtc DEFAULT SYSUTCDATETIME(),
        LastSeenUtc         datetime2(3)      NOT NULL CONSTRAINT DF_barchart_Instrument_LastSeenUtc DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_barchart_Instrument_LocationKey
        ON barchart.Instrument (LocationKey)
        INCLUDE (Commodity, InstrumentType, IsActive, IsTest);

    CREATE INDEX IX_barchart_Instrument_State_City
        ON barchart.Instrument (State, City);
END");

            migrationBuilder.Sql(@"
IF OBJECT_ID(N'barchart.CurrentQuote', N'U') IS NULL
BEGIN
    CREATE TABLE barchart.CurrentQuote
    (
        Symbol          nvarchar(100)     NOT NULL CONSTRAINT PK_barchart_CurrentQuote PRIMARY KEY CLUSTERED,
        LastPrice       decimal(18,6)     NULL,
        NetChange       decimal(18,6)     NULL,
        PercentChange   decimal(18,6)     NULL,
        OpenPrice       decimal(18,6)     NULL,
        HighPrice       decimal(18,6)     NULL,
        LowPrice        decimal(18,6)     NULL,
        ClosePrice      decimal(18,6)     NULL,
        UnitCode        nvarchar(10)      NULL,
        DayCode         nvarchar(5)       NULL,
        QuoteMode       nvarchar(10)      NULL,
        QuoteFlag       nvarchar(5)       NULL,
        TradeTimestamp  datetimeoffset(0) NULL,  -- when the ELEVATOR last updated its bid (UI 'as of')
        ServerTimestamp datetimeoffset(0) NULL,
        UpdatedAtUtc    datetime2(3)      NOT NULL CONSTRAINT DF_barchart_CurrentQuote_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_barchart_CurrentQuote_Instrument FOREIGN KEY (Symbol) REFERENCES barchart.Instrument (Symbol)
    );

    CREATE INDEX IX_barchart_CurrentQuote_TradeTimestamp
        ON barchart.CurrentQuote (TradeTimestamp DESC);
END");

            migrationBuilder.Sql(@"
IF OBJECT_ID(N'barchart.QuoteSnapshot', N'U') IS NULL
BEGIN
    CREATE TABLE barchart.QuoteSnapshot
    (
        SnapshotDate    date              NOT NULL,  -- Central-time business date
        Symbol          nvarchar(100)     NOT NULL,
        LastPrice       decimal(18,6)     NULL,
        NetChange       decimal(18,6)     NULL,
        TradeTimestamp  datetimeoffset(0) NULL,
        CreatedAtUtc    datetime2(3)      NOT NULL CONSTRAINT DF_barchart_QuoteSnapshot_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_barchart_QuoteSnapshot PRIMARY KEY CLUSTERED (SnapshotDate, Symbol),
        CONSTRAINT FK_barchart_QuoteSnapshot_Instrument FOREIGN KEY (Symbol) REFERENCES barchart.Instrument (Symbol)
    );

    CREATE INDEX IX_barchart_QuoteSnapshot_Symbol
        ON barchart.QuoteSnapshot (Symbol, SnapshotDate DESC);
END");

            migrationBuilder.Sql(@"
IF OBJECT_ID(N'barchart.CommodityMap', N'U') IS NULL
BEGIN
    -- Translates BarChart commodity display names to Scoular commodity codes.
    -- Created empty on purpose: seed values come from the business (Travis).
    -- Unmapped commodities are still ingested but never bridged to the Bid Sheet.
    CREATE TABLE barchart.CommodityMap
    (
        BarchartCommodity  nvarchar(200) NOT NULL CONSTRAINT PK_barchart_CommodityMap PRIMARY KEY CLUSTERED,
        CommodityCode      nvarchar(50)  NOT NULL,
        CommodityName      nvarchar(200) NULL,
        CommodityCategory  nvarchar(100) NULL,
        IsActive           bit           NOT NULL CONSTRAINT DF_barchart_CommodityMap_IsActive DEFAULT 1
    );
END");

            migrationBuilder.Sql(@"
IF OBJECT_ID(N'barchart.ApiCallAudit', N'U') IS NULL
BEGIN
    -- One row per vendor API call (the contract caps usage at 250k calls/month on a shared key).
    -- QueryParams must be pre-sanitized by the caller: it must NEVER contain the API key.
    CREATE TABLE barchart.ApiCallAudit
    (
        ApiCallId     bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_barchart_ApiCallAudit PRIMARY KEY CLUSTERED,
        CalledAtUtc   datetime2(3)   NOT NULL CONSTRAINT DF_barchart_ApiCallAudit_CalledAtUtc DEFAULT SYSUTCDATETIME(),
        Endpoint      nvarchar(100)  NOT NULL,
        QueryParams   nvarchar(2000) NULL,
        HttpStatus    int            NULL,
        Success       bit            NOT NULL,
        RowCount      int            NULL,
        DurationMs    int            NULL,
        ErrorMessage  nvarchar(2000) NULL
    );

    CREATE INDEX IX_barchart_ApiCallAudit_CalledAtUtc
        ON barchart.ApiCallAudit (CalledAtUtc)
        INCLUDE (Endpoint, Success);
END");

            // ── Views ─────────────────────────────────────────────────────────────────

            migrationBuilder.Sql(@"
CREATE OR ALTER VIEW barchart.vw_BarchartLocation AS
-- One row per elevator LISTING (LocationKey) — what the 'Add from BarChart' picker searches.
-- Instrument is one row per bid (elevator x commodity x delivery window); this collapses it.
SELECT
    i.LocationKey,
    MAX(i.Elevator)             AS Elevator,
    MAX(i.LocationName)         AS LocationName,
    MAX(i.FacilityType)         AS FacilityType,
    MAX(i.Address)              AS Address,
    MAX(i.City)                 AS City,
    MAX(i.State)                AS State,
    MAX(i.ZipCode)              AS ZipCode,
    AVG(i.Latitude)             AS Latitude,
    AVG(i.Longitude)            AS Longitude,
    MAX(i.Phone)                AS Phone,
    MAX(i.Website)              AS Website,
    COUNT_BIG(*)                AS ActiveInstrumentCount,
    COUNT_BIG(DISTINCT i.Commodity) AS CommodityCount,
    MIN(i.DeliveryStart)        AS EarliestDeliveryStart,
    MAX(i.DeliveryEnd)          AS LatestDeliveryEnd,
    MAX(i.LastSeenUtc)          AS LastSeenUtc,
    MAX(q.TradeTimestamp)       AS LatestQuoteTimestamp
FROM barchart.Instrument AS i
LEFT JOIN barchart.CurrentQuote AS q ON q.Symbol = i.Symbol
WHERE i.IsActive = 1 AND i.IsTest = 0 AND i.LocationKey IS NOT NULL
GROUP BY i.LocationKey;");

            migrationBuilder.Sql(@"
CREATE OR ALTER VIEW barchart.vw_MonthlyApiCallUsage AS
SELECT
    DATEFROMPARTS(YEAR(CalledAtUtc), MONTH(CalledAtUtc), 1) AS UsageMonth,
    Endpoint,
    COUNT_BIG(*) AS CallCount,
    SUM(CASE WHEN Success = 1 THEN 1 ELSE 0 END) AS SuccessCount,
    SUM(CASE WHEN Success = 0 THEN 1 ELSE 0 END) AS FailureCount
FROM barchart.ApiCallAudit
GROUP BY DATEFROMPARTS(YEAR(CalledAtUtc), MONTH(CalledAtUtc), 1), Endpoint;");

            // ── Procedures (one Sql() per proc — CREATE OR ALTER must lead its batch) ──

            migrationBuilder.Sql(@"
CREATE OR ALTER PROCEDURE barchart.usp_LoadInstrumentsJson
    @Json nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Accept the vendor envelope ({ ..., ""results"": [ ... ] }) or a bare JSON array.
    DECLARE @payload nvarchar(max) =
        CASE WHEN LEFT(LTRIM(@Json), 1) = '[' THEN @Json ELSE JSON_QUERY(@Json, '$.results') END;

    IF @payload IS NULL OR ISJSON(@payload) = 0
    BEGIN
        SELECT CAST(0 AS int) AS RowsLoaded;
        RETURN;
    END;

    ;WITH raw AS
    (
        SELECT
            LTRIM(RTRIM(j.symbol)) AS Symbol,
            j.symbolDescription, j.elevator, j.commodity, j.underlyingFuture,
            j.deliveryStart, j.deliveryEnd, j.locationName, j.facilityType,
            j.phone, j.website, j.address, j.city, j.state, j.zipCode,
            j.longitude, j.latitude, j.county, j.countyFipsCode, j.stateFipsCode
        FROM OPENJSON(@payload) WITH
        (
            symbol            nvarchar(4000) '$.symbol',
            symbolDescription nvarchar(4000) '$.symbolDescription',
            elevator          nvarchar(4000) '$.elevator',
            commodity         nvarchar(4000) '$.commodity',
            underlyingFuture  nvarchar(4000) '$.underlyingFuture',
            deliveryStart     nvarchar(4000) '$.deliveryStart',
            deliveryEnd       nvarchar(4000) '$.deliveryEnd',
            locationName      nvarchar(4000) '$.location',
            facilityType      nvarchar(4000) '$.facilityType',
            phone             nvarchar(4000) '$.phone',
            website           nvarchar(4000) '$.website',
            address           nvarchar(4000) '$.address',
            city              nvarchar(4000) '$.city',
            state             nvarchar(4000) '$.state',
            zipCode           nvarchar(4000) '$.zipCode',
            longitude         nvarchar(4000) '$.longitude',
            latitude          nvarchar(4000) '$.latitude',
            county            nvarchar(4000) '$.county',
            countyFipsCode    nvarchar(4000) '$.countyFipsCode',
            stateFipsCode     nvarchar(4000) '$.stateFipsCode'
        ) AS j
        WHERE NULLIF(LTRIM(RTRIM(j.symbol)), '') IS NOT NULL
    ),
    parsed AS
    (
        SELECT
            r.*,
            dx.d1, dx.d2, pd.preDash, wf.windowFlag, co.core, rt.typeLetter, rt.root
        FROM raw AS r
        -- Symbol anatomy (vendor-confirmed): {root}{P=cash|B=basis}{monthCode}{yy}[F|L]-{locationId}-{internalMapId}.CM
        CROSS APPLY (SELECT CHARINDEX('-', r.Symbol) AS d1,
                            CHARINDEX('-', r.Symbol, CHARINDEX('-', r.Symbol) + 1) AS d2) AS dx
        CROSS APPLY (SELECT CASE WHEN dx.d1 > 1 THEN LEFT(r.Symbol, dx.d1 - 1) END AS preDash) AS pd
        CROSS APPLY (SELECT CASE WHEN pd.preDash IS NOT NULL AND RIGHT(pd.preDash, 1) IN ('F', 'L')
                                 THEN RIGHT(pd.preDash, 1) END AS windowFlag) AS wf
        CROSS APPLY (SELECT CASE WHEN wf.windowFlag IS NOT NULL THEN LEFT(pd.preDash, LEN(pd.preDash) - 1)
                                 ELSE pd.preDash END AS core) AS co
        CROSS APPLY (SELECT CASE WHEN co.core IS NOT NULL AND LEN(co.core) >= 5
                                 THEN SUBSTRING(co.core, LEN(co.core) - 3, 1) END AS typeLetter,
                            CASE WHEN co.core IS NOT NULL AND LEN(co.core) >= 5
                                 THEN LEFT(co.core, LEN(co.core) - 4) END AS root) AS rt
    ),
    src AS
    (
        SELECT
            Symbol            = LEFT(p.Symbol, 100),
            LocationKey       = CASE WHEN p.d1 > 0 AND p.d2 > p.d1 + 1
                                     THEN LEFT(LTRIM(RTRIM(SUBSTRING(p.Symbol, p.d1 + 1, p.d2 - p.d1 - 1))), 50) END,
            Root              = LEFT(p.root, 10),
            InstrumentType    = CASE p.typeLetter WHEN 'P' THEN 'bidCash' WHEN 'B' THEN 'bidBasis' END,
            DeliveryWindowFlag = p.windowFlag,
            SymbolDescription = LEFT(p.symbolDescription, 500),
            Elevator          = LEFT(p.elevator, 300),
            LocationName      = LEFT(p.locationName, 300),
            FacilityType      = LEFT(p.facilityType, 100),
            Commodity         = LEFT(p.commodity, 200),
            UnderlyingFuture  = LEFT(p.underlyingFuture, 20),
            DeliveryStart     = TRY_CONVERT(datetimeoffset(0), p.deliveryStart),
            DeliveryEnd       = TRY_CONVERT(datetimeoffset(0), p.deliveryEnd),
            Address           = LEFT(REPLACE(REPLACE(REPLACE(p.address, CHAR(13) + CHAR(10), ', '), CHAR(13), ', '), CHAR(10), ', '), 500),
            City              = LEFT(LTRIM(RTRIM(p.city)), 100),
            State             = LEFT(LTRIM(RTRIM(p.state)), 10),
            ZipCode           = LEFT(LTRIM(RTRIM(p.zipCode)), 20),
            Latitude          = TRY_CONVERT(float, p.latitude),
            Longitude         = TRY_CONVERT(float, p.longitude),
            County            = LEFT(p.county, 100),
            StateFips         = LEFT(LTRIM(RTRIM(p.stateFipsCode)), 10),
            CountyFips        = LEFT(LTRIM(RTRIM(p.countyFipsCode)), 10),
            Phone             = LEFT(LTRIM(RTRIM(p.phone)), 50),
            Website           = LEFT(LTRIM(RTRIM(p.website)), 300),
            IsTest            = CASE WHEN LOWER(ISNULL(p.elevator, '')) LIKE '%bid sync test%'
                                       OR LOWER(ISNULL(p.symbolDescription, '')) LIKE '%bid sync test%'
                                       OR LOWER(ISNULL(p.elevator, '')) LIKE '%agvance%'
                                     THEN 1 ELSE 0 END,
            rn                = ROW_NUMBER() OVER (PARTITION BY p.Symbol ORDER BY (SELECT 0))
        FROM parsed AS p
    )
    MERGE barchart.Instrument WITH (HOLDLOCK) AS t
    USING (SELECT * FROM src WHERE rn = 1) AS s
       ON t.Symbol = s.Symbol
    WHEN MATCHED THEN UPDATE SET
        t.LocationKey = s.LocationKey, t.Root = s.Root, t.InstrumentType = s.InstrumentType,
        t.DeliveryWindowFlag = s.DeliveryWindowFlag, t.SymbolDescription = s.SymbolDescription,
        t.Elevator = s.Elevator, t.LocationName = s.LocationName, t.FacilityType = s.FacilityType,
        t.Commodity = s.Commodity, t.UnderlyingFuture = s.UnderlyingFuture,
        t.DeliveryStart = s.DeliveryStart, t.DeliveryEnd = s.DeliveryEnd,
        t.Address = s.Address, t.City = s.City, t.State = s.State, t.ZipCode = s.ZipCode,
        t.Latitude = s.Latitude, t.Longitude = s.Longitude, t.County = s.County,
        t.StateFips = s.StateFips, t.CountyFips = s.CountyFips,
        t.Phone = s.Phone, t.Website = s.Website,
        t.IsTest = s.IsTest,
        t.IsActive = 1,                    -- a reappearing symbol reactivates
        t.LastSeenUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED BY TARGET THEN INSERT
        (Symbol, LocationKey, Root, InstrumentType, DeliveryWindowFlag, SymbolDescription,
         Elevator, LocationName, FacilityType, Commodity, UnderlyingFuture,
         DeliveryStart, DeliveryEnd, Address, City, State, ZipCode, Latitude, Longitude,
         County, StateFips, CountyFips, Phone, Website, IsTest)
    VALUES
        (s.Symbol, s.LocationKey, s.Root, s.InstrumentType, s.DeliveryWindowFlag, s.SymbolDescription,
         s.Elevator, s.LocationName, s.FacilityType, s.Commodity, s.UnderlyingFuture,
         s.DeliveryStart, s.DeliveryEnd, s.Address, s.City, s.State, s.ZipCode, s.Latitude, s.Longitude,
         s.County, s.StateFips, s.CountyFips, s.Phone, s.Website, s.IsTest);

    SELECT @@ROWCOUNT AS RowsLoaded;
END");

            migrationBuilder.Sql(@"
CREATE OR ALTER PROCEDURE barchart.usp_DeactivateMissingInstruments
    @CutoffUtc datetime2
AS
BEGIN
    SET NOCOUNT ON;

    -- Deliberate, separate step (never part of a load): after a COMPLETE discovery sweep,
    -- switch off instruments the sweep did not touch. Rows are never deleted, so a linked
    -- Bid Sheet location cannot lose its catalog entry to a partial/failed vendor pull.
    UPDATE barchart.Instrument
       SET IsActive = 0
     WHERE IsActive = 1
       AND LastSeenUtc < @CutoffUtc;

    SELECT @@ROWCOUNT AS RowsDeactivated;
END");

            migrationBuilder.Sql(@"
CREATE OR ALTER PROCEDURE barchart.usp_LoadQuotesJson
    @Json nvarchar(max),
    @SnapshotDate date = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Business date defaults to 'today' in Central time (handles the UTC evening rollover).
    SET @SnapshotDate = ISNULL(@SnapshotDate,
        CONVERT(date, SYSDATETIMEOFFSET() AT TIME ZONE 'Central Standard Time'));

    DECLARE @payload nvarchar(max) =
        CASE WHEN LEFT(LTRIM(@Json), 1) = '[' THEN @Json ELSE JSON_QUERY(@Json, '$.results') END;

    IF @payload IS NULL OR ISJSON(@payload) = 0
    BEGIN
        SELECT CAST(0 AS int) AS QuotesUpserted, CAST(0 AS int) AS UnknownSymbolCount, @SnapshotDate AS SnapshotDate;
        RETURN;
    END;

    DECLARE @src TABLE
    (
        Symbol          nvarchar(100) PRIMARY KEY,
        LastPrice       decimal(18,6) NULL,
        NetChange       decimal(18,6) NULL,
        PercentChange   decimal(18,6) NULL,
        OpenPrice       decimal(18,6) NULL,
        HighPrice       decimal(18,6) NULL,
        LowPrice        decimal(18,6) NULL,
        ClosePrice      decimal(18,6) NULL,
        UnitCode        nvarchar(10)  NULL,
        DayCode         nvarchar(5)   NULL,
        QuoteMode       nvarchar(10)  NULL,
        QuoteFlag       nvarchar(5)   NULL,
        TradeTimestamp  datetimeoffset(0) NULL,
        ServerTimestamp datetimeoffset(0) NULL,
        IsKnownSymbol   bit NOT NULL
    );

    ;WITH raw AS
    (
        SELECT
            LEFT(LTRIM(RTRIM(j.symbol)), 100) AS Symbol,
            j.lastPrice, j.netChange, j.percentChange,
            j.openPrice, j.highPrice, j.lowPrice, j.closePrice,
            j.unitCode, j.dayCode, j.quoteMode, j.quoteFlag,
            j.tradeTimestamp, j.serverTimestamp, j.statusCode,
            ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(j.symbol)) ORDER BY (SELECT 0)) AS rn
        FROM OPENJSON(@payload) WITH
        (
            symbol          nvarchar(4000) '$.symbol',
            lastPrice       nvarchar(100)  '$.lastPrice',
            netChange       nvarchar(100)  '$.netChange',
            percentChange   nvarchar(100)  '$.percentChange',
            openPrice       nvarchar(100)  '$.open',
            highPrice       nvarchar(100)  '$.high',
            lowPrice        nvarchar(100)  '$.low',
            closePrice      nvarchar(100)  '$.close',
            unitCode        nvarchar(100)  '$.unitCode',
            dayCode         nvarchar(100)  '$.dayCode',
            quoteMode       nvarchar(100)  '$.mode',
            quoteFlag       nvarchar(100)  '$.flag',
            tradeTimestamp  nvarchar(100)  '$.tradeTimestamp',
            serverTimestamp nvarchar(100)  '$.serverTimestamp',
            statusCode      nvarchar(100)  '$.code'
        ) AS j
        WHERE NULLIF(LTRIM(RTRIM(j.symbol)), '') IS NOT NULL
          -- Per-row vendor status: skip explicit failures, keep rows without a code.
          AND (j.statusCode IS NULL OR TRY_CONVERT(int, j.statusCode) = 200)
    )
    INSERT @src (Symbol, LastPrice, NetChange, PercentChange, OpenPrice, HighPrice, LowPrice, ClosePrice,
                 UnitCode, DayCode, QuoteMode, QuoteFlag, TradeTimestamp, ServerTimestamp, IsKnownSymbol)
    SELECT
        r.Symbol,
        TRY_CONVERT(decimal(18,6), r.lastPrice),
        TRY_CONVERT(decimal(18,6), r.netChange),
        TRY_CONVERT(decimal(18,6), r.percentChange),
        TRY_CONVERT(decimal(18,6), r.openPrice),
        TRY_CONVERT(decimal(18,6), r.highPrice),
        TRY_CONVERT(decimal(18,6), r.lowPrice),
        TRY_CONVERT(decimal(18,6), r.closePrice),
        LEFT(r.unitCode, 10), LEFT(r.dayCode, 5), LEFT(r.quoteMode, 10), LEFT(r.quoteFlag, 5),
        TRY_CONVERT(datetimeoffset(0), r.tradeTimestamp),
        TRY_CONVERT(datetimeoffset(0), r.serverTimestamp),
        CASE WHEN EXISTS (SELECT 1 FROM barchart.Instrument i WHERE i.Symbol = r.Symbol) THEN 1 ELSE 0 END
    FROM raw AS r
    WHERE r.rn = 1;

    DECLARE @upserted int = 0;

    -- Latest price: exactly one row per symbol, overwritten in place.
    MERGE barchart.CurrentQuote WITH (HOLDLOCK) AS t
    USING (SELECT * FROM @src WHERE IsKnownSymbol = 1) AS s
       ON t.Symbol = s.Symbol
    WHEN MATCHED THEN UPDATE SET
        t.LastPrice = s.LastPrice, t.NetChange = s.NetChange, t.PercentChange = s.PercentChange,
        t.OpenPrice = s.OpenPrice, t.HighPrice = s.HighPrice, t.LowPrice = s.LowPrice, t.ClosePrice = s.ClosePrice,
        t.UnitCode = s.UnitCode, t.DayCode = s.DayCode, t.QuoteMode = s.QuoteMode, t.QuoteFlag = s.QuoteFlag,
        t.TradeTimestamp = s.TradeTimestamp, t.ServerTimestamp = s.ServerTimestamp,
        t.UpdatedAtUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED BY TARGET THEN INSERT
        (Symbol, LastPrice, NetChange, PercentChange, OpenPrice, HighPrice, LowPrice, ClosePrice,
         UnitCode, DayCode, QuoteMode, QuoteFlag, TradeTimestamp, ServerTimestamp)
    VALUES
        (s.Symbol, s.LastPrice, s.NetChange, s.PercentChange, s.OpenPrice, s.HighPrice, s.LowPrice, s.ClosePrice,
         s.UnitCode, s.DayCode, s.QuoteMode, s.QuoteFlag, s.TradeTimestamp, s.ServerTimestamp);

    SET @upserted = @@ROWCOUNT;

    -- History: one row per symbol per business date; a same-day rerun replaces, never duplicates.
    MERGE barchart.QuoteSnapshot WITH (HOLDLOCK) AS t
    USING (SELECT * FROM @src WHERE IsKnownSymbol = 1) AS s
       ON t.SnapshotDate = @SnapshotDate AND t.Symbol = s.Symbol
    WHEN MATCHED THEN UPDATE SET
        t.LastPrice = s.LastPrice, t.NetChange = s.NetChange, t.TradeTimestamp = s.TradeTimestamp,
        t.CreatedAtUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED BY TARGET THEN INSERT
        (SnapshotDate, Symbol, LastPrice, NetChange, TradeTimestamp)
    VALUES
        (@SnapshotDate, s.Symbol, s.LastPrice, s.NetChange, s.TradeTimestamp);

    SELECT
        @upserted AS QuotesUpserted,
        (SELECT COUNT(*) FROM @src WHERE IsKnownSymbol = 0) AS UnknownSymbolCount,
        @SnapshotDate AS SnapshotDate;
END");

            migrationBuilder.Sql(@"
CREATE OR ALTER PROCEDURE barchart.usp_GetSymbolsToQuote
    @BatchSize int = 100
AS
BEGIN
    SET NOCOUNT ON;

    IF @BatchSize IS NULL OR @BatchSize < 1 SET @BatchSize = 100;

    -- Ready-made getQuote batches so the load process never builds symbol lists itself.
    ;WITH s AS
    (
        SELECT Symbol,
               (ROW_NUMBER() OVER (ORDER BY Symbol) - 1) / @BatchSize AS batchZero
        FROM barchart.Instrument
        WHERE IsActive = 1 AND IsTest = 0
    )
    SELECT
        batchZero + 1 AS BatchNumber,
        COUNT(*)      AS SymbolCount,
        STRING_AGG(CONVERT(nvarchar(max), Symbol), ',') AS SymbolsCsv
    FROM s
    GROUP BY batchZero
    ORDER BY batchZero;
END");

            migrationBuilder.Sql(@"
CREATE OR ALTER PROCEDURE barchart.usp_LogApiCall
    @Endpoint     nvarchar(100),
    @QueryParams  nvarchar(2000) = NULL,   -- SANITIZED by the caller: never include the API key
    @HttpStatus   int            = NULL,
    @Success      bit,
    @RowCount     int            = NULL,
    @DurationMs   int            = NULL,
    @ErrorMessage nvarchar(2000) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    INSERT barchart.ApiCallAudit (Endpoint, QueryParams, HttpStatus, Success, RowCount, DurationMs, ErrorMessage)
    VALUES (@Endpoint, @QueryParams, @HttpStatus, @Success, @RowCount, @DurationMs, @ErrorMessage);
END");

            migrationBuilder.Sql(@"
CREATE OR ALTER PROCEDURE barchart.usp_CheckApiBudget
    @MonthlyCap int = 250000
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @mtd int =
    (
        SELECT COUNT(*)
        FROM barchart.ApiCallAudit
        WHERE CalledAtUtc >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1)
    );

    SELECT
        @mtd AS MonthToDateCalls,
        @MonthlyCap - @mtd AS RemainingCalls,
        CASE WHEN @mtd >= CAST(@MonthlyCap AS bigint) * 8 / 10 THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS AbortRecommended;
END");

            migrationBuilder.Sql(@"
CREATE OR ALTER PROCEDURE barchart.usp_PurgeBarchartHistory
    @AuditRetentionDays    int = 400,
    @SnapshotRetentionDays int = 730
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @auditCutoff datetime2 = DATEADD(DAY, -@AuditRetentionDays, SYSUTCDATETIME());
    DECLARE @snapCutoff  date      = DATEADD(DAY, -@SnapshotRetentionDays, CONVERT(date, SYSUTCDATETIME()));
    DECLARE @rows int = 1;

    WHILE @rows > 0
    BEGIN
        DELETE TOP (5000) FROM barchart.ApiCallAudit WHERE CalledAtUtc < @auditCutoff;
        SET @rows = @@ROWCOUNT;
    END;

    SET @rows = 1;
    WHILE @rows > 0
    BEGIN
        DELETE TOP (5000) FROM barchart.QuoteSnapshot WHERE SnapshotDate < @snapCutoff;
        SET @rows = @@ROWCOUNT;
    END;
END");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS barchart.usp_PurgeBarchartHistory;");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS barchart.usp_CheckApiBudget;");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS barchart.usp_LogApiCall;");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS barchart.usp_GetSymbolsToQuote;");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS barchart.usp_LoadQuotesJson;");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS barchart.usp_DeactivateMissingInstruments;");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS barchart.usp_LoadInstrumentsJson;");
            migrationBuilder.Sql("DROP VIEW IF EXISTS barchart.vw_MonthlyApiCallUsage;");
            migrationBuilder.Sql("DROP VIEW IF EXISTS barchart.vw_BarchartLocation;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS barchart.QuoteSnapshot;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS barchart.CurrentQuote;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS barchart.Instrument;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS barchart.CommodityMap;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS barchart.ApiCallAudit;");
            migrationBuilder.Sql(@"
IF SCHEMA_ID(N'barchart') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.objects WHERE schema_id = SCHEMA_ID(N'barchart'))
    EXEC(N'DROP SCHEMA [barchart];');");
        }
    }
}
