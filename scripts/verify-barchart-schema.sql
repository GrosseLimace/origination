/*
verify-barchart-schema.sql
--------------------------
Smoke test for the barchart schema (AddBarchartSchema + AddBidSheetBarchartColumns migrations).
Run against a database that has both migrations applied (local/dev). Everything runs inside a
transaction that is ROLLED BACK — no data is left behind.

Covers:
  1. Object existence (5 tables, 2 views, 8 procs, dbo columns).
  2. usp_LoadInstrumentsJson with real sample rows: symbol parsing (LocationKey 82259 groups
     GPC Muscatine's split-window + NonGMO instruments), window flags, AgVance test-row flagging,
     idempotent reload.
  3. usp_LoadQuotesJson twice on the same business date (snapshot idempotence).
  4. usp_GetSymbolsToQuote excludes test rows.
  5. The bridge (usp_ApplyQuotesToBidSheet): split-window winner selection, unmapped commodities
     skipped, manual cells untouched, feed-row pruning when a mapping is turned off, rerun stability.
  6. usp_LogApiCall / usp_CheckApiBudget round trip.

Prints '=== ALL BARCHART SMOKE CHECKS PASSED ===' on success; THROWs on the first failure.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

------------------------------------------------------------------------------
-- 1. Object existence
------------------------------------------------------------------------------
DECLARE @missing nvarchar(max) = N'';

SELECT @missing = @missing + name + N'; '
FROM (VALUES
    (N'barchart.Instrument'),   (N'barchart.CurrentQuote'), (N'barchart.QuoteSnapshot'),
    (N'barchart.CommodityMap'), (N'barchart.ApiCallAudit')
) AS t(name)
WHERE OBJECT_ID(t.name, N'U') IS NULL;

SELECT @missing = @missing + name + N'; '
FROM (VALUES (N'barchart.vw_BarchartLocation'), (N'barchart.vw_MonthlyApiCallUsage')) AS v(name)
WHERE OBJECT_ID(v.name, N'V') IS NULL;

SELECT @missing = @missing + name + N'; '
FROM (VALUES
    (N'barchart.usp_LoadInstrumentsJson'), (N'barchart.usp_DeactivateMissingInstruments'),
    (N'barchart.usp_LoadQuotesJson'),      (N'barchart.usp_GetSymbolsToQuote'),
    (N'barchart.usp_LogApiCall'),          (N'barchart.usp_CheckApiBudget'),
    (N'barchart.usp_PurgeBarchartHistory'),(N'barchart.usp_ApplyQuotesToBidSheet')
) AS p(name)
WHERE OBJECT_ID(p.name, N'P') IS NULL;

IF COL_LENGTH(N'dbo.BidSheetLocations', N'BarchartLocationKey') IS NULL SET @missing += N'dbo.BidSheetLocations.BarchartLocationKey; ';
IF COL_LENGTH(N'dbo.BidSheetLocationBids', N'Source')          IS NULL SET @missing += N'dbo.BidSheetLocationBids.Source; ';
IF COL_LENGTH(N'dbo.BidSheetLocationBids', N'BarchartSymbol')  IS NULL SET @missing += N'dbo.BidSheetLocationBids.BarchartSymbol; ';
IF COL_LENGTH(N'dbo.BidSheetLocationBids', N'QuoteAsOf')       IS NULL SET @missing += N'dbo.BidSheetLocationBids.QuoteAsOf; ';

IF @missing <> N''
BEGIN
    DECLARE @msg1 nvarchar(max) = N'MISSING OBJECTS: ' + @missing;
    THROW 50000, @msg1, 1;
END
PRINT '1. Object existence .............. OK';

------------------------------------------------------------------------------
-- Functional smoke (everything below is rolled back)
------------------------------------------------------------------------------
BEGIN TRANSACTION;

DECLARE @instrumentsJson nvarchar(max) = N'{"status":{"code":200,"message":"Success."},"results":[
 {"symbol":"ZCPQ26F-82259-15194.CM","symbolDescription":"Grain Processing Corporation Muscatine, IA Corn (#2 Yellow) 1/2 Aug 26 Cash","elevator":"Grain Processing Corporation","commodity":"Corn (#2 Yellow)","underlyingFuture":"ZCU26","deliveryStart":"2026-08-08T00:00:00-05:00","deliveryEnd":"2026-08-14T00:00:00-05:00","location":"GPC-MUSCATINE","facilityType":"River Terminal","phone":"563-264-4426","website":"www.grainprocessing.com","address":"1600 Dick Drake Hwy","city":"Muscatine","state":"IA","zipCode":"52761","longitude":"-91.0579","latitude":"41.39298","county":"Muscatine County","countyFipsCode":"139","stateFipsCode":"19"},
 {"symbol":"ZCPQ26L-82259-15194.CM","symbolDescription":"Grain Processing Corporation Muscatine, IA Corn (#2 Yellow) 2/2 Aug 26 Cash","elevator":"Grain Processing Corporation","commodity":"Corn (#2 Yellow)","underlyingFuture":"ZCU26","deliveryStart":"2026-08-22T00:00:00-05:00","deliveryEnd":"2026-08-31T00:00:00-05:00","location":"GPC-MUSCATINE","facilityType":"River Terminal","phone":"563-264-4426","website":"www.grainprocessing.com","address":"1600 Dick Drake Hwy","city":"Muscatine","state":"IA","zipCode":"52761","longitude":"-91.0579","latitude":"41.39298","county":"Muscatine County","countyFipsCode":"139","stateFipsCode":"19"},
 {"symbol":"ZCPQ26-82259-15195.CM","symbolDescription":"Grain Processing Corporation Muscatine, IA Corn (NonGMO) Aug 26 Cash","elevator":"Grain Processing Corporation","commodity":"Corn (NonGMO)","underlyingFuture":"ZCU26","deliveryStart":"2026-06-01T00:00:00-05:00","deliveryEnd":"2026-08-31T00:00:00-05:00","location":"GPC-MUSCATINE","facilityType":"River Terminal","phone":"563-264-4426","website":"www.grainprocessing.com","address":"1600 Dick Drake Hwy","city":"Muscatine","state":"IA","zipCode":"52761","longitude":"-91.0579","latitude":"41.39298","county":"Muscatine County","countyFipsCode":"139","stateFipsCode":"19"},
 {"symbol":"ZCPQ26-27300-6916.CM","symbolDescription":"Little Sioux Corn Processors Marcus, IA Corn (#2 Yellow) Aug 26 Cash","elevator":"Little Sioux Corn Processors","commodity":"Corn (#2 Yellow)","underlyingFuture":"ZCU26","deliveryStart":"2026-08-01T00:00:00-05:00","deliveryEnd":"2026-08-31T00:00:00-05:00","location":"LSCP","facilityType":"Ethanol/Bio-Fuel","phone":"712-376-2800","website":"www.littlesiouxcornprocessors.com","address":"4808 F Avenue","city":"Marcus","state":"IA","zipCode":"51035","longitude":"-95.764286","latitude":"42.821595","county":"Cherokee County","countyFipsCode":"035","stateFipsCode":"19"},
 {"symbol":"ZCPQ26-87495-17523.CM","symbolDescription":"AgVance Bid Sync Test Allendorf, IA Corn (#2 Yellow) Aug 26 Cash","elevator":"AgVance Bid Sync Test","commodity":"Corn (#2 Yellow)","underlyingFuture":"ZCU26","deliveryStart":"2026-08-01T00:00:00-05:00","deliveryEnd":"2026-08-31T23:59:59-05:00","location":"CFE Allendorf","facilityType":"Country Elevator","phone":"","website":"","address":"1631 Highway 59","city":"Allendorf","state":"IA","zipCode":"51354","longitude":"-95.64386","latitude":"43.413668","county":"Osceola County","countyFipsCode":"143","stateFipsCode":"19"}
]}';

------------------------------------------------------------------------------
-- 2. Instrument load: parsing + test flag + idempotence
------------------------------------------------------------------------------
EXEC barchart.usp_LoadInstrumentsJson @Json = @instrumentsJson;
EXEC barchart.usp_LoadInstrumentsJson @Json = @instrumentsJson;  -- reload = idempotent

IF (SELECT COUNT(*) FROM barchart.Instrument WHERE Symbol LIKE N'ZCPQ26%') <> 5
    THROW 50001, 'Expected exactly 5 sample instruments after double load (idempotence broken).', 1;

IF (SELECT COUNT(*) FROM barchart.Instrument WHERE LocationKey = N'82259') <> 3
    THROW 50002, 'LocationKey parsing broken: GPC Muscatine''s 3 instruments should share 82259.', 1;

IF NOT EXISTS (SELECT 1 FROM barchart.Instrument WHERE Symbol = N'ZCPQ26F-82259-15194.CM'
               AND DeliveryWindowFlag = 'F' AND Root = N'ZC' AND InstrumentType = N'bidCash')
    THROW 50003, 'Symbol anatomy parsing broken (window flag / root / instrument type).', 1;

IF NOT EXISTS (SELECT 1 FROM barchart.Instrument WHERE Symbol = N'ZCPQ26-87495-17523.CM' AND IsTest = 1)
    THROW 50004, 'AgVance ''Bid Sync Test'' row was not flagged IsTest = 1.', 1;

IF EXISTS (SELECT 1 FROM barchart.vw_BarchartLocation WHERE LocationKey = N'87495')
    THROW 50005, 'Test rows must not appear in vw_BarchartLocation.', 1;

IF NOT EXISTS (SELECT 1 FROM barchart.vw_BarchartLocation WHERE LocationKey = N'82259' AND ActiveInstrumentCount = 3)
    THROW 50006, 'vw_BarchartLocation should group GPC Muscatine into one row with 3 instruments.', 1;
PRINT '2. Instrument load + parsing ..... OK';

------------------------------------------------------------------------------
-- 3. Quote load: current + snapshot, same-day rerun idempotent
------------------------------------------------------------------------------
DECLARE @quotesJson nvarchar(max) = N'{"status":{"code":200,"message":"Success."},"results":[
 {"symbol":"ZCPQ26F-82259-15194.CM","lastPrice":"4.47","netChange":"0.0625","tradeTimestamp":"2026-07-22T12:12:36-05:00","serverTimestamp":"2026-07-22T12:12:42-05:00","dayCode":"L","mode":"i","unitCode":"4","open":"4.4475","high":"4.47","low":"4.4475","code":200},
 {"symbol":"ZCPQ26L-82259-15194.CM","lastPrice":"4.53","netChange":"0.0825","tradeTimestamp":"2026-07-22T12:12:36-05:00","serverTimestamp":"2026-07-22T12:12:42-05:00","dayCode":"L","mode":"i","unitCode":"4","code":200},
 {"symbol":"ZCPQ26-82259-15195.CM","lastPrice":"4.47","netChange":"0.0825","tradeTimestamp":"2026-07-22T12:12:37-05:00","serverTimestamp":"2026-07-22T12:12:42-05:00","dayCode":"L","mode":"i","unitCode":"4","code":200},
 {"symbol":"ZCPQ26-27300-6916.CM","lastPrice":"4.41","netChange":"0.0825","tradeTimestamp":"2026-07-22T12:13:57-05:00","serverTimestamp":"2026-07-22T12:24:07-05:00","dayCode":"L","mode":"i","unitCode":"4","code":200},
 {"symbol":"ZCPQ26-87495-17523.CM","lastPrice":"4.13","netChange":"0.0325","tradeTimestamp":"2026-07-21T21:32:32-05:00","serverTimestamp":"2026-07-21T21:45:35-05:00","dayCode":"K","mode":"i","unitCode":"4","code":200},
 {"symbol":"ZZUNKNOWN-1-1.CM","lastPrice":"1.23","code":200}
]}';

DECLARE @bizDate date = '2026-07-22';
EXEC barchart.usp_LoadQuotesJson @Json = @quotesJson, @SnapshotDate = @bizDate;
EXEC barchart.usp_LoadQuotesJson @Json = @quotesJson, @SnapshotDate = @bizDate;  -- same-day rerun

IF (SELECT COUNT(*) FROM barchart.CurrentQuote WHERE Symbol LIKE N'ZCPQ26%') <> 5
    THROW 50007, 'Expected 5 current quotes (unknown symbol must be skipped, known ones kept).', 1;

IF (SELECT COUNT(*) FROM barchart.QuoteSnapshot WHERE SnapshotDate = @bizDate AND Symbol LIKE N'ZCPQ26%') <> 5
    THROW 50008, 'Same-day quote rerun duplicated QuoteSnapshot rows (idempotence broken).', 1;

IF EXISTS (SELECT 1 FROM barchart.CurrentQuote WHERE Symbol = N'ZZUNKNOWN-1-1.CM')
    THROW 50009, 'Quotes for symbols missing from the catalog must be skipped.', 1;
PRINT '3. Quote load + snapshot ......... OK';

------------------------------------------------------------------------------
-- 4. Symbol batching excludes test rows
------------------------------------------------------------------------------
DECLARE @batches TABLE (BatchNumber int, SymbolCount int, SymbolsCsv nvarchar(max));
INSERT @batches EXEC barchart.usp_GetSymbolsToQuote @BatchSize = 100;

IF EXISTS (SELECT 1 FROM @batches WHERE SymbolsCsv LIKE N'%87495%')
    THROW 50010, 'usp_GetSymbolsToQuote must not include IsTest instruments.', 1;
PRINT '4. Symbol batching ............... OK';

------------------------------------------------------------------------------
-- 5. The bridge: winner selection, manual-wins, unmapped skipped, prune, rerun
------------------------------------------------------------------------------
INSERT barchart.CommodityMap (BarchartCommodity, CommodityCode, CommodityName, CommodityCategory)
VALUES (N'Corn (#2 Yellow)', N'CORN', N'Corn', N'Grains');   -- NonGMO left unmapped on purpose

DECLARE @gpcLocId int, @lscpLocId int;

INSERT dbo.BidSheetLocations (Name, City, State, Latitude, Longitude, BarchartLocationKey, TradeUnitCode, CreatedBy, CreatedAt)
VALUES (N'__SMOKE GPC Muscatine', N'Muscatine', N'IA', 41.39298, -91.0579, N'82259', N'__SMOKE_TU', N'smoke-test', SYSUTCDATETIME());
SET @gpcLocId = SCOPE_IDENTITY();

INSERT dbo.BidSheetLocations (Name, City, State, Latitude, Longitude, BarchartLocationKey, TradeUnitCode, CreatedBy, CreatedAt)
VALUES (N'__SMOKE Little Sioux', N'Marcus', N'IA', 42.821595, -95.764286, N'27300', N'__SMOKE_TU', N'smoke-test', SYSUTCDATETIME());
SET @lscpLocId = SCOPE_IDENTITY();

-- A pre-existing MANUAL bid in the exact cell the feed would target at Little Sioux.
INSERT dbo.BidSheetLocationBids (LocationId, CommodityCode, CropYear, Month, Bid, Source, CreatedBy, CreatedAt)
VALUES (@lscpLocId, N'CORN', 2026, 8, N'9.99', N'Manual', N'smoke-test', SYSUTCDATETIME());

EXEC barchart.usp_ApplyQuotesToBidSheet;

-- GPC Aug cell: no whole-month instrument, so the WIDER split window wins (L: Aug 22-31 = 4.53).
IF NOT EXISTS (SELECT 1 FROM dbo.BidSheetLocationBids
               WHERE LocationId = @gpcLocId AND CommodityCode = N'CORN' AND CropYear = 2026 AND Month = 8
                 AND Bid = N'4.53' AND Source = N'Barchart'
                 AND BarchartSymbol = N'ZCPQ26L-82259-15194.CM' AND QuoteAsOf IS NOT NULL)
    THROW 50011, 'Bridge winner selection broken: GPC Aug cell should be 4.53 from the wider L window.', 1;

-- NonGMO is unmapped -> must not create any other commodity cell at GPC.
IF (SELECT COUNT(*) FROM dbo.BidSheetLocationBids WHERE LocationId = @gpcLocId) <> 1
    THROW 50012, 'Bridge must skip unmapped commodities (NonGMO should not bridge).', 1;

-- Manual cell at Little Sioux must be untouched.
IF NOT EXISTS (SELECT 1 FROM dbo.BidSheetLocationBids
               WHERE LocationId = @lscpLocId AND CommodityCode = N'CORN' AND CropYear = 2026 AND Month = 8
                 AND Bid = N'9.99' AND Source = N'Manual' AND QuoteAsOf IS NULL)
    THROW 50013, 'Bridge overwrote a MANUAL bid — the ownership rule is broken.', 1;

-- Rerun: stable (no duplicates, same winner).
EXEC barchart.usp_ApplyQuotesToBidSheet;
IF (SELECT COUNT(*) FROM dbo.BidSheetLocationBids WHERE LocationId IN (@gpcLocId, @lscpLocId)) <> 2
    THROW 50014, 'Bridge rerun changed the row count (must be idempotent).', 1;

-- Turning a mapping off prunes the feed row on the next run; the manual row survives.
UPDATE barchart.CommodityMap SET IsActive = 0 WHERE BarchartCommodity = N'Corn (#2 Yellow)';
EXEC barchart.usp_ApplyQuotesToBidSheet;

IF EXISTS (SELECT 1 FROM dbo.BidSheetLocationBids WHERE LocationId = @gpcLocId)
    THROW 50015, 'Bridge should prune feed rows whose commodity mapping was deactivated.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.BidSheetLocationBids WHERE LocationId = @lscpLocId AND Source = N'Manual')
    THROW 50016, 'Pruning removed a MANUAL row — the ownership rule is broken.', 1;
PRINT '5. Bridge rules .................. OK';

------------------------------------------------------------------------------
-- 6. Call audit + budget check
------------------------------------------------------------------------------
EXEC barchart.usp_LogApiCall @Endpoint = N'getQuote', @QueryParams = N'batch=1;symbols=100',
                             @HttpStatus = 200, @Success = 1, @RowCount = 100, @DurationMs = 250;

DECLARE @budget TABLE (MonthToDateCalls int, RemainingCalls int, AbortRecommended bit);
INSERT @budget EXEC barchart.usp_CheckApiBudget @MonthlyCap = 250000;

IF NOT EXISTS (SELECT 1 FROM @budget WHERE MonthToDateCalls >= 1 AND AbortRecommended = 0)
    THROW 50017, 'usp_CheckApiBudget did not report the logged call / mis-flagged abort.', 1;
PRINT '6. Audit + budget ................ OK';

ROLLBACK TRANSACTION;
PRINT '';
PRINT '=== ALL BARCHART SMOKE CHECKS PASSED (transaction rolled back — no data persisted) ===';
