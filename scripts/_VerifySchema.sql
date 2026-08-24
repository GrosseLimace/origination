-- =============================================================================
-- Origination (Grain Originator Portal) — schema verification
-- Target DB: Origination
--   Dev:  azrscosqld01.database.windows.net / Origination
--   QA:   azrscosqlq01.database.windows.net / Origination
--   Prod: azrscosqlp01.database.windows.net / Origination
-- Run as: any reader (sys catalog views only, no data changes)
--
-- Compares the live database against the expected schema derived from
-- api/GrainOriginatorPortal.Api/Data/Migrations/ApplicationDbContextModelSnapshot.cs.
--
-- OUTPUT:
--   * If everything matches  -> a SINGLE row: "Database is current ...".
--   * If anything is wrong   -> one row per problem (missing/extra/mismatched
--     object or migration), sorted FAIL-first.
--
-- MAINTENANCE:
--   After every new migration:
--     1. Append the migration id to @Migrations.
--     2. Add / update rows in @Tables, @Columns, @CheckConstraints,
--        @UniqueIndexes for any new objects.
--   The four sections to update are clearly marked
--   "### UPDATE WHEN SCHEMA CHANGES ###".
--
-- KNOWN PRE-EXISTING GAPS (not introduced by the BarChart work, 2026-08-11):
--   The expected lists below have not been maintained for several migrations that
--   landed on main between 20260609 and 20260810 — e.g. dbo.MbpLocationSynonym,
--   dbo.UsageDashboardExcludedUsers, the DailyRecapGroup* tables, and their
--   migration ids. Until someone backfills them, expect WARN findings for those
--   objects ("exists in DB, not expected here"). Any finding naming a Barchart*
--   object or a BidSheet* Source/BarchartSymbol/QuoteAsOf column IS real.
-- =============================================================================

SET NOCOUNT ON;

-- =============================================================================
-- Expected schema (derived from ApplicationDbContextModelSnapshot.cs)
-- =============================================================================

DECLARE @Tables TABLE (
    SchemaName sysname,
    TableName  sysname,
    PRIMARY KEY (SchemaName, TableName)
);

DECLARE @Columns TABLE (
    SchemaName sysname,
    TableName  sysname,
    ColumnName sysname,
    SqlType    nvarchar(50),
    IsNullable bit,
    PRIMARY KEY (SchemaName, TableName, ColumnName)
);

DECLARE @CheckConstraints TABLE (
    SchemaName     sysname,
    TableName      sysname,
    ConstraintName sysname,
    PRIMARY KEY (SchemaName, ConstraintName)
);

DECLARE @UniqueIndexes TABLE (
    SchemaName sysname,
    TableName  sysname,
    IndexName  sysname,
    PRIMARY KEY (SchemaName, TableName, IndexName)
);

DECLARE @Migrations TABLE (
    MigrationId nvarchar(150) PRIMARY KEY
);

-- Collects every problem found; nothing here = database is current.
DECLARE @Findings TABLE (
    SortBucket int,
    Category   varchar(40),
    Item       nvarchar(400),
    Expected   nvarchar(100),
    Actual     nvarchar(100),
    Status     varchar(10)
);

-- -----------------------------------------------------------------------------
-- ### UPDATE WHEN SCHEMA CHANGES ### — Tables (35)
-- -----------------------------------------------------------------------------
INSERT INTO @Tables (SchemaName, TableName) VALUES
('dbo', 'BarchartApiCallAudit'),
('dbo', 'BarchartCommodityMap'),
('dbo', 'BarchartCurrentQuote'),
('dbo', 'BarchartInstrument'),
('dbo', 'BarchartQuoteSnapshot'),
('dbo', 'BidSheetLocationBids'),
('dbo', 'BidSheetLocationOrders'),
('dbo', 'BidSheetLocations'),
('dbo', 'BidSheetPreferences'),
('dbo', 'Commodities'),
('dbo', 'Customer'),
('dbo', 'CustomerCommodity'),
('dbo', 'CustomerLink'),
('dbo', 'CustomerTradeUnit'),
('dbo', 'DashboardActualHarvests'),
('dbo', 'DashboardMarketShares'),
('dbo', 'DashboardPlantingEstimates'),
('dbo', 'ESignEnrollment'),
('dbo', 'ElevatorCache'),
('dbo', 'FeatureUsageDaily'),
('dbo', 'HarvestWindows'),
('dbo', 'Notes'),
('dbo', 'ProducerDetails'),
('dbo', 'ProducerPlantingIntentions'),
('dbo', 'QueryLibrary'),
('dbo', 'QuerySearchLog'),
('dbo', 'SavedLists'),
('dbo', 'UserActivity'),
('dbo', 'UserActivityDaily'),
('dbo', 'UserClickEvent'),
('dbo', 'UserFeatureUsageDaily'),
('dbo', 'UserPreferences'),
('dbo', 'UserSession'),
('dbo', 'UserTradeUnitSnapshot'),
('dbo', 'WeeklyLoginAggregate');

-- -----------------------------------------------------------------------------
-- ### UPDATE WHEN SCHEMA CHANGES ### — Columns
-- Format: (schema, table, column, sql_type, is_nullable)
-- sql_type format must match what this script reconstructs from sys.columns:
--   int, bigint, bit, datetime2, datetime2(N), date, float, uniqueidentifier
--   nvarchar(N), nvarchar(max), nchar(N), varchar(N), varchar(max)
--   decimal(p,s), varbinary(N), varbinary(max)
-- NOTE: ColumnName is the DB column name (HasColumnName override), which for
--   the Customer / ESignEnrollment tables differs from the CLR property name.
-- -----------------------------------------------------------------------------
INSERT INTO @Columns (SchemaName, TableName, ColumnName, SqlType, IsNullable) VALUES
-- BarchartInstrument (BarChart bid feed — vendor catalog)
('dbo', 'BarchartInstrument', 'Symbol',             'nvarchar(100)', 0),
('dbo', 'BarchartInstrument', 'LocationKey',        'nvarchar(50)',  1),
('dbo', 'BarchartInstrument', 'Root',               'nvarchar(10)',  1),
('dbo', 'BarchartInstrument', 'InstrumentType',     'nvarchar(20)',  1),
('dbo', 'BarchartInstrument', 'DeliveryWindowFlag', 'char(1)',       1),
('dbo', 'BarchartInstrument', 'SymbolDescription',  'nvarchar(500)', 1),
('dbo', 'BarchartInstrument', 'Elevator',           'nvarchar(300)', 1),
('dbo', 'BarchartInstrument', 'LocationName',       'nvarchar(300)', 1),
('dbo', 'BarchartInstrument', 'FacilityType',       'nvarchar(100)', 1),
('dbo', 'BarchartInstrument', 'Commodity',          'nvarchar(200)', 1),
('dbo', 'BarchartInstrument', 'UnderlyingFuture',   'nvarchar(20)',  1),
('dbo', 'BarchartInstrument', 'DeliveryStart',      'datetime2(3)',  1),
('dbo', 'BarchartInstrument', 'DeliveryEnd',        'datetime2(3)',  1),
('dbo', 'BarchartInstrument', 'Address',            'nvarchar(500)', 1),
('dbo', 'BarchartInstrument', 'City',               'nvarchar(100)', 1),
('dbo', 'BarchartInstrument', 'State',              'nvarchar(10)',  1),
('dbo', 'BarchartInstrument', 'ZipCode',            'nvarchar(20)',  1),
('dbo', 'BarchartInstrument', 'Latitude',           'float',         1),
('dbo', 'BarchartInstrument', 'Longitude',          'float',         1),
('dbo', 'BarchartInstrument', 'County',             'nvarchar(100)', 1),
('dbo', 'BarchartInstrument', 'StateFips',          'nvarchar(10)',  1),
('dbo', 'BarchartInstrument', 'CountyFips',         'nvarchar(10)',  1),
('dbo', 'BarchartInstrument', 'Phone',              'nvarchar(50)',  1),
('dbo', 'BarchartInstrument', 'Website',            'nvarchar(300)', 1),
('dbo', 'BarchartInstrument', 'IsTest',             'bit',           0),
('dbo', 'BarchartInstrument', 'IsActive',           'bit',           0),
('dbo', 'BarchartInstrument', 'FirstSeenUtc',       'datetime2(3)',  0),
('dbo', 'BarchartInstrument', 'LastSeenUtc',        'datetime2(3)',  0),
-- BarchartCurrentQuote (latest price per instrument)
('dbo', 'BarchartCurrentQuote', 'Symbol',          'nvarchar(100)', 0),
('dbo', 'BarchartCurrentQuote', 'LastPrice',       'decimal(19,4)', 1),
('dbo', 'BarchartCurrentQuote', 'NetChange',       'decimal(19,4)', 1),
('dbo', 'BarchartCurrentQuote', 'PercentChange',   'decimal(19,4)', 1),
('dbo', 'BarchartCurrentQuote', 'OpenPrice',       'decimal(19,4)', 1),
('dbo', 'BarchartCurrentQuote', 'HighPrice',       'decimal(19,4)', 1),
('dbo', 'BarchartCurrentQuote', 'LowPrice',        'decimal(19,4)', 1),
('dbo', 'BarchartCurrentQuote', 'ClosePrice',      'decimal(19,4)', 1),
('dbo', 'BarchartCurrentQuote', 'UnitCode',        'nvarchar(10)',  1),
('dbo', 'BarchartCurrentQuote', 'DayCode',         'nvarchar(5)',   1),
('dbo', 'BarchartCurrentQuote', 'QuoteMode',       'nvarchar(10)',  1),
('dbo', 'BarchartCurrentQuote', 'QuoteFlag',       'nvarchar(5)',   1),
('dbo', 'BarchartCurrentQuote', 'TradeTimestamp',  'datetime2(3)',  1),
('dbo', 'BarchartCurrentQuote', 'ServerTimestamp', 'datetime2(3)',  1),
('dbo', 'BarchartCurrentQuote', 'UpdatedAtUtc',    'datetime2(3)',  0),
-- BarchartQuoteSnapshot (daily price history)
('dbo', 'BarchartQuoteSnapshot', 'SnapshotDate',   'date',          0),
('dbo', 'BarchartQuoteSnapshot', 'Symbol',         'nvarchar(100)', 0),
('dbo', 'BarchartQuoteSnapshot', 'LastPrice',      'decimal(19,4)', 1),
('dbo', 'BarchartQuoteSnapshot', 'NetChange',      'decimal(19,4)', 1),
('dbo', 'BarchartQuoteSnapshot', 'TradeTimestamp', 'datetime2(3)',  1),
('dbo', 'BarchartQuoteSnapshot', 'CreatedAtUtc',   'datetime2(3)',  0),
-- BarchartCommodityMap (vendor commodity name -> Scoular code; human-maintained)
('dbo', 'BarchartCommodityMap', 'BarchartCommodity', 'nvarchar(200)', 0),
('dbo', 'BarchartCommodityMap', 'CommodityCode',     'nvarchar(50)',  0),
('dbo', 'BarchartCommodityMap', 'CommodityName',     'nvarchar(200)', 1),
('dbo', 'BarchartCommodityMap', 'CommodityCategory', 'nvarchar(100)', 1),
('dbo', 'BarchartCommodityMap', 'IsActive',          'bit',           0),
('dbo', 'BarchartCommodityMap', 'CreatedAt',         'datetime2(3)',  0),
('dbo', 'BarchartCommodityMap', 'CreatedBy',         'nvarchar(255)', 0),
('dbo', 'BarchartCommodityMap', 'ModifiedAt',        'datetime2(3)',  1),
('dbo', 'BarchartCommodityMap', 'ModifiedBy',        'nvarchar(255)', 1),
-- BarchartApiCallAudit (one row per ingest call; backs the monthly usage view)
('dbo', 'BarchartApiCallAudit', 'ApiCallId',    'bigint',         0),
('dbo', 'BarchartApiCallAudit', 'CalledAtUtc',  'datetime2(3)',   0),
('dbo', 'BarchartApiCallAudit', 'Endpoint',     'nvarchar(100)',  0),
('dbo', 'BarchartApiCallAudit', 'QueryParams',  'nvarchar(2000)', 1),
('dbo', 'BarchartApiCallAudit', 'HttpStatus',   'int',            1),
('dbo', 'BarchartApiCallAudit', 'Success',      'bit',            0),
('dbo', 'BarchartApiCallAudit', 'RowsAffected', 'int',            1),
('dbo', 'BarchartApiCallAudit', 'DurationMs',   'int',            1),
('dbo', 'BarchartApiCallAudit', 'ErrorMessage', 'nvarchar(2000)', 1),
-- BidSheetLocations
('dbo', 'BidSheetLocations', 'Id',                'int',           0),
('dbo', 'BidSheetLocations', 'BarchartLocationKey', 'nvarchar(50)', 1),
('dbo', 'BidSheetLocations', 'Address',           'nvarchar(300)', 1),
('dbo', 'BidSheetLocations', 'City',              'nvarchar(100)', 1),
('dbo', 'BidSheetLocations', 'CreatedAt',         'datetime2',     0),
('dbo', 'BidSheetLocations', 'CreatedBy',         'nvarchar(255)', 0),
('dbo', 'BidSheetLocations', 'ElevatorCode',      'nvarchar(50)',  1),
('dbo', 'BidSheetLocations', 'GroupName',         'nvarchar(200)', 1),
('dbo', 'BidSheetLocations', 'IsScoularFacility', 'bit',           0),
('dbo', 'BidSheetLocations', 'Latitude',          'float',         1),
('dbo', 'BidSheetLocations', 'Longitude',         'float',         1),
('dbo', 'BidSheetLocations', 'ModifiedAt',        'datetime2',     1),
('dbo', 'BidSheetLocations', 'ModifiedBy',        'nvarchar(255)', 1),
('dbo', 'BidSheetLocations', 'Name',              'nvarchar(200)', 0),
('dbo', 'BidSheetLocations', 'State',             'nvarchar(10)',  1),
('dbo', 'BidSheetLocations', 'TradeUnitCode',     'nvarchar(100)', 0),
-- BidSheetLocationBids
('dbo', 'BidSheetLocationBids', 'Id',                'int',           0),
('dbo', 'BidSheetLocationBids', 'Bid',               'nvarchar(50)',  0),
('dbo', 'BidSheetLocationBids', 'CommodityCategory', 'nvarchar(100)', 1),
('dbo', 'BidSheetLocationBids', 'CommodityCode',     'nvarchar(50)',  0),
('dbo', 'BidSheetLocationBids', 'CommodityName',     'nvarchar(200)', 1),
('dbo', 'BidSheetLocationBids', 'CreatedAt',         'datetime2',     0),
('dbo', 'BidSheetLocationBids', 'CreatedBy',         'nvarchar(255)', 0),
('dbo', 'BidSheetLocationBids', 'CropYear',          'int',           0),
('dbo', 'BidSheetLocationBids', 'LocationId',        'int',           0),
('dbo', 'BidSheetLocationBids', 'ModifiedAt',        'datetime2',     1),
('dbo', 'BidSheetLocationBids', 'Source',            'nvarchar(20)',  0),
('dbo', 'BidSheetLocationBids', 'BarchartSymbol',    'nvarchar(100)', 1),
('dbo', 'BidSheetLocationBids', 'QuoteAsOf',         'datetime2',     1),
('dbo', 'BidSheetLocationBids', 'ModifiedBy',        'nvarchar(255)', 1),
('dbo', 'BidSheetLocationBids', 'Month',             'int',           0),
-- BidSheetLocationOrders
('dbo', 'BidSheetLocationOrders', 'Id',           'int',           0),
('dbo', 'BidSheetLocationOrders', 'LocationOrder', 'nvarchar(max)', 0),
('dbo', 'BidSheetLocationOrders', 'ModifiedAt',    'datetime2',     0),
('dbo', 'BidSheetLocationOrders', 'TradeUnitKey',  'nvarchar(500)', 0),
('dbo', 'BidSheetLocationOrders', 'UserId',        'nvarchar(256)', 0),
-- BidSheetPreferences
('dbo', 'BidSheetPreferences', 'Id',             'int',           0),
('dbo', 'BidSheetPreferences', 'CropCode',       'nvarchar(50)',  1),
('dbo', 'BidSheetPreferences', 'CropOrder',      'nvarchar(max)', 1),
('dbo', 'BidSheetPreferences', 'CropYear',       'int',           1),
('dbo', 'BidSheetPreferences', 'HiddenCrops',    'nvarchar(max)', 1),
('dbo', 'BidSheetPreferences', 'ModifiedAt',     'datetime2',     0),
('dbo', 'BidSheetPreferences', 'Month',          'int',           1),
('dbo', 'BidSheetPreferences', 'PrintLayout',    'nvarchar(max)', 1),
('dbo', 'BidSheetPreferences', 'SelectedMonths', 'nvarchar(max)', 1),
('dbo', 'BidSheetPreferences', 'TradeUnitKey',   'nvarchar(500)', 0),
('dbo', 'BidSheetPreferences', 'UserId',         'nvarchar(256)', 0),
-- Commodities
('dbo', 'Commodities', 'Id',                       'int',           0),
('dbo', 'Commodities', 'BaseUOM',                  'nvarchar(10)',  1),
('dbo', 'Commodities', 'Category',                 'nvarchar(100)', 1),
('dbo', 'Commodities', 'Code',                     'nvarchar(100)', 0),
('dbo', 'Commodities', 'IsActive',                 'bit',           0),
('dbo', 'Commodities', 'Name',                     'nvarchar(255)', 0),
('dbo', 'Commodities', 'ShowInPlantingIntentions', 'bit',           0),
('dbo', 'Commodities', 'Tier1',                    'nvarchar(100)', 1),
('dbo', 'Commodities', 'Tier2',                    'nvarchar(100)', 1),
('dbo', 'Commodities', 'Tier3',                    'nvarchar(100)', 1),
-- Customer (column names overridden via HasColumnName)
('dbo', 'Customer', 'CustomerId',                 'bigint',        0),
('dbo', 'Customer', 'MerchandisingAddressLine1',  'nvarchar(255)', 1),
('dbo', 'Customer', 'EffectiveEndDate',           'datetime2',     1),
('dbo', 'Customer', 'EffectiveStartDate',         'datetime2',     1),
('dbo', 'Customer', 'MerchandisingEmail',         'nvarchar(255)', 1),
('dbo', 'Customer', 'ExtendedAddressLine1',       'nvarchar(255)', 1),
('dbo', 'Customer', 'ExtendedAddressLine2',       'nvarchar(255)', 1),
('dbo', 'Customer', 'ExtendedAddressLine3',       'nvarchar(255)', 1),
('dbo', 'Customer', 'ExtendedAddressLine4',       'nvarchar(255)', 1),
('dbo', 'Customer', 'ExtendedCity',               'nvarchar(255)', 1),
('dbo', 'Customer', 'ExtendedCountry',            'nvarchar(255)', 1),
('dbo', 'Customer', 'ExtendedPostalCode',         'nvarchar(20)',  1),
('dbo', 'Customer', 'ExtendedPrimaryPhone',       'nvarchar(100)', 1),
('dbo', 'Customer', 'ExtendedStateProvince',      'nvarchar(50)',  1),
('dbo', 'Customer', 'IndustryCode1',              'nvarchar(50)',  1),
('dbo', 'Customer', 'IsActive',                   'bit',           0),
('dbo', 'Customer', 'IsManual',                   'bit',           0),
('dbo', 'Customer', 'MerchandisingCity',          'nvarchar(255)', 1),
('dbo', 'Customer', 'CustomerName',               'nvarchar(500)', 0),
('dbo', 'Customer', 'MerchandisingPhone',         'nvarchar(100)', 1),
('dbo', 'Customer', 'MerchandisingPostalCode',    'nvarchar(20)',  1),
('dbo', 'Customer', 'ScoularId',                  'nvarchar(400)', 1),
('dbo', 'Customer', 'MerchandisingStateProvince', 'nvarchar(50)',  1),
('dbo', 'Customer', 'SupplementalEmail',          'nvarchar(255)', 1),
-- CustomerCommodity
('dbo', 'CustomerCommodity', 'Id',          'int',    0),
('dbo', 'CustomerCommodity', 'CommodityId', 'int',    0),
('dbo', 'CustomerCommodity', 'CustomerId',  'bigint', 0),
-- CustomerLink
('dbo', 'CustomerLink', 'Id',             'int',    0),
('dbo', 'CustomerLink', 'FromCustomerId', 'bigint', 0),
('dbo', 'CustomerLink', 'ToCustomerId',   'bigint', 0),
-- CustomerTradeUnit
('dbo', 'CustomerTradeUnit', 'Id',              'int',           0),
('dbo', 'CustomerTradeUnit', 'CustomerId',      'bigint',        0),
('dbo', 'CustomerTradeUnit', 'IsActive',        'bit',           0),
('dbo', 'CustomerTradeUnit', 'IsManual',        'bit',           0),
('dbo', 'CustomerTradeUnit', 'TradeUnit',       'nvarchar(100)', 0),
('dbo', 'CustomerTradeUnit', 'UserDeactivated', 'bit',           0),
-- DashboardActualHarvests
('dbo', 'DashboardActualHarvests', 'Id',           'int',           0),
('dbo', 'DashboardActualHarvests', 'Bushels',      'int',           0),
('dbo', 'DashboardActualHarvests', 'CreatedAt',    'datetime2',     0),
('dbo', 'DashboardActualHarvests', 'CreatedBy',    'nvarchar(255)', 0),
('dbo', 'DashboardActualHarvests', 'CropCategory', 'nvarchar(100)', 0),
('dbo', 'DashboardActualHarvests', 'ModifiedAt',   'datetime2',     1),
('dbo', 'DashboardActualHarvests', 'ModifiedBy',   'nvarchar(255)', 1),
('dbo', 'DashboardActualHarvests', 'PlantingYear', 'int',           0),
('dbo', 'DashboardActualHarvests', 'TradeUnitKey', 'nvarchar(500)', 0),
-- DashboardMarketShares
('dbo', 'DashboardMarketShares', 'Id',             'int',           0),
('dbo', 'DashboardMarketShares', 'CreatedAt',      'datetime2',     0),
('dbo', 'DashboardMarketShares', 'CreatedBy',      'nvarchar(255)', 0),
('dbo', 'DashboardMarketShares', 'CropCategory',   'nvarchar(100)', 0),
('dbo', 'DashboardMarketShares', 'MarketSharePct', 'decimal(5,2)',  1),
('dbo', 'DashboardMarketShares', 'ModifiedAt',     'datetime2',     1),
('dbo', 'DashboardMarketShares', 'ModifiedBy',     'nvarchar(255)', 1),
('dbo', 'DashboardMarketShares', 'PlantingYear',   'int',           0),
('dbo', 'DashboardMarketShares', 'TradeUnitKey',   'nvarchar(500)', 0),
-- DashboardPlantingEstimates
('dbo', 'DashboardPlantingEstimates', 'Id',            'int',           0),
('dbo', 'DashboardPlantingEstimates', 'CreatedAt',     'datetime2',     0),
('dbo', 'DashboardPlantingEstimates', 'CreatedBy',     'nvarchar(255)', 0),
('dbo', 'DashboardPlantingEstimates', 'Crop',          'nvarchar(100)', 0),
('dbo', 'DashboardPlantingEstimates', 'ModifiedAt',    'datetime2',     1),
('dbo', 'DashboardPlantingEstimates', 'ModifiedBy',    'nvarchar(255)', 1),
('dbo', 'DashboardPlantingEstimates', 'PlantingYear',  'int',           0),
('dbo', 'DashboardPlantingEstimates', 'TradeUnitKey',  'nvarchar(500)', 0),
('dbo', 'DashboardPlantingEstimates', 'YieldEstimate', 'decimal(10,2)', 1),
-- ESignEnrollment (column names overridden via HasColumnName)
('dbo', 'ESignEnrollment', 'Id',                    'int',           0),
('dbo', 'ESignEnrollment', 'CustomerCode',          'nvarchar(50)',  0),
('dbo', 'ESignEnrollment', 'CustomerName',          'nvarchar(255)', 0),
('dbo', 'ESignEnrollment', 'eSignEnabled',          'bit',           0),
('dbo', 'ESignEnrollment', 'GUID',                  'nvarchar(255)', 1),
('dbo', 'ESignEnrollment', 'ScoularViewRecipients', 'nvarchar(max)', 1),
('dbo', 'ESignEnrollment', 'UpdatedOn',             'datetime2',     0),
-- ElevatorCache
('dbo', 'ElevatorCache', 'ElevatorCode',      'nvarchar(50)',  0),
('dbo', 'ElevatorCache', 'Address',           'nvarchar(300)', 1),
('dbo', 'ElevatorCache', 'City',              'nvarchar(100)', 1),
('dbo', 'ElevatorCache', 'ElevatorName',      'nvarchar(200)', 1),
('dbo', 'ElevatorCache', 'ElevatorShortName', 'nvarchar(100)', 1),
('dbo', 'ElevatorCache', 'IsActive',          'bit',           0),
('dbo', 'ElevatorCache', 'LastRefreshedAt',   'datetime2',     0),
('dbo', 'ElevatorCache', 'Latitude',          'float',         1),
('dbo', 'ElevatorCache', 'Longitude',         'float',         1),
('dbo', 'ElevatorCache', 'OurFacility',       'nvarchar(1)',   1),
('dbo', 'ElevatorCache', 'State',             'nvarchar(10)',  1),
('dbo', 'ElevatorCache', 'TradeUnitCode',     'nvarchar(50)',  1),
('dbo', 'ElevatorCache', 'ZipCode',           'nvarchar(20)',  1),
-- FeatureUsageDaily
('dbo', 'FeatureUsageDaily', 'Id',             'bigint',       0),
('dbo', 'FeatureUsageDaily', 'ActivityDate',   'date',         0),
('dbo', 'FeatureUsageDaily', 'ClickCount',     'int',          0),
('dbo', 'FeatureUsageDaily', 'FeatureCode',    'nvarchar(50)', 0),
('dbo', 'FeatureUsageDaily', 'RequestCount',   'int',          0),
('dbo', 'FeatureUsageDaily', 'SessionCount',   'int',          0),
('dbo', 'FeatureUsageDaily', 'SubFeatureCode', 'nvarchar(50)', 0),
('dbo', 'FeatureUsageDaily', 'UniqueUsers',    'int',          0),
-- HarvestWindows
('dbo', 'HarvestWindows', 'Id',                 'int',          0),
('dbo', 'HarvestWindows', 'Commodity',          'nvarchar(50)', 0),
('dbo', 'HarvestWindows', 'DeliveryEndDay',     'int',          0),
('dbo', 'HarvestWindows', 'DeliveryEndMonth',   'int',          0),
('dbo', 'HarvestWindows', 'DeliveryStartDay',   'int',          0),
('dbo', 'HarvestWindows', 'DeliveryStartMonth', 'int',          0),
('dbo', 'HarvestWindows', 'IsActive',           'bit',          0),
-- Notes
('dbo', 'Notes', 'Id',          'int',           0),
('dbo', 'Notes', 'CreatedAt',   'datetime2',     0),
('dbo', 'Notes', 'CreatedBy',   'nvarchar(200)', 0),
('dbo', 'Notes', 'CustomerId',  'bigint',        0),
('dbo', 'Notes', 'DeletedAt',   'datetime2',     1),
('dbo', 'Notes', 'DeletedBy',   'nvarchar(200)', 1),
('dbo', 'Notes', 'Description', 'nvarchar(max)', 0),
('dbo', 'Notes', 'IsDeleted',   'bit',           0),
('dbo', 'Notes', 'IsPinned',    'bit',           0),
('dbo', 'Notes', 'ModifiedAt',  'datetime2',     1),
('dbo', 'Notes', 'ModifiedBy',  'nvarchar(200)', 1),
('dbo', 'Notes', 'TradeUnit',   'nvarchar(100)', 1),
-- ProducerDetails
('dbo', 'ProducerDetails', 'Id',             'int',           0),
('dbo', 'ProducerDetails', 'BinCapacity',    'decimal(18,2)', 1),
('dbo', 'ProducerDetails', 'CreatedAt',      'datetime2',     0),
('dbo', 'ProducerDetails', 'CreatedBy',      'nvarchar(255)', 0),
('dbo', 'ProducerDetails', 'CustomerId',     'bigint',        0),
('dbo', 'ProducerDetails', 'ModifiedAt',     'datetime2',     1),
('dbo', 'ProducerDetails', 'ModifiedBy',     'nvarchar(255)', 1),
('dbo', 'ProducerDetails', 'PrimaryContact', 'nvarchar(255)', 1),
('dbo', 'ProducerDetails', 'TotalAcres',     'decimal(18,2)', 1),
-- ProducerPlantingIntentions (PlantingIntention entity)
('dbo', 'ProducerPlantingIntentions', 'Id',           'int',           0),
('dbo', 'ProducerPlantingIntentions', 'Acres',        'int',           0),
('dbo', 'ProducerPlantingIntentions', 'Category',     'nvarchar(100)', 1),
('dbo', 'ProducerPlantingIntentions', 'CreatedAt',    'datetime2',     0),
('dbo', 'ProducerPlantingIntentions', 'CreatedBy',    'nvarchar(255)', 0),
('dbo', 'ProducerPlantingIntentions', 'Crop',         'nvarchar(100)', 0),
('dbo', 'ProducerPlantingIntentions', 'CustomerId',   'bigint',        0),
('dbo', 'ProducerPlantingIntentions', 'Description',  'nvarchar(255)', 1),
('dbo', 'ProducerPlantingIntentions', 'ModifiedAt',   'datetime2',     1),
('dbo', 'ProducerPlantingIntentions', 'ModifiedBy',   'nvarchar(255)', 1),
('dbo', 'ProducerPlantingIntentions', 'PlantingYear', 'int',           0),
('dbo', 'ProducerPlantingIntentions', 'TradeUnit',    'nvarchar(100)', 0),
('dbo', 'ProducerPlantingIntentions', 'Type',         'nvarchar(100)', 1),
-- QueryLibrary
('dbo', 'QueryLibrary', 'Id',          'int',           0),
('dbo', 'QueryLibrary', 'Category',    'nvarchar(100)', 0),
('dbo', 'QueryLibrary', 'CreatedAt',   'datetime2',     0),
('dbo', 'QueryLibrary', 'Description', 'nvarchar(500)', 1),
('dbo', 'QueryLibrary', 'IsActive',    'bit',           0),
('dbo', 'QueryLibrary', 'ModifiedAt',  'datetime2',     1),
('dbo', 'QueryLibrary', 'Name',        'nvarchar(200)', 0),
('dbo', 'QueryLibrary', 'QueryText',   'nvarchar(500)', 0),
('dbo', 'QueryLibrary', 'SortOrder',   'int',           0),
('dbo', 'QueryLibrary', 'Tags',        'nvarchar(500)', 1),
-- QuerySearchLog
('dbo', 'QuerySearchLog', 'Id',             'bigint',        0),
('dbo', 'QuerySearchLog', 'MatchedQueryId', 'int',           1),
('dbo', 'QuerySearchLog', 'SearchText',     'nvarchar(500)', 0),
('dbo', 'QuerySearchLog', 'Timestamp',      'datetime2(3)',  0),
('dbo', 'QuerySearchLog', 'UserId',         'nvarchar(256)', 0),
-- SavedLists
('dbo', 'SavedLists', 'Id',                  'int',           0),
('dbo', 'SavedLists', 'CreatedAt',           'datetime2',     0),
('dbo', 'SavedLists', 'CreatedBy',           'nvarchar(255)', 0),
('dbo', 'SavedLists', 'ExcludedCustomerIds', 'nvarchar(max)', 1),
('dbo', 'SavedLists', 'Filters',             'nvarchar(max)', 1),
('dbo', 'SavedLists', 'IncludedCustomerIds', 'nvarchar(max)', 1),
('dbo', 'SavedLists', 'IsActive',            'bit',           0),
('dbo', 'SavedLists', 'ModifiedAt',          'datetime2',     1),
('dbo', 'SavedLists', 'ModifiedBy',          'nvarchar(255)', 1),
('dbo', 'SavedLists', 'Name',                'nvarchar(100)', 0),
('dbo', 'SavedLists', 'Query',               'nvarchar(500)', 0),
('dbo', 'SavedLists', 'TradeUnits',          'nvarchar(500)', 1),
-- UserActivity
('dbo', 'UserActivity', 'Id',             'bigint',        0),
('dbo', 'UserActivity', 'DurationMs',     'int',           0),
('dbo', 'UserActivity', 'FeatureCode',    'nvarchar(50)',  0),
('dbo', 'UserActivity', 'HttpMethod',     'nvarchar(10)',  0),
('dbo', 'UserActivity', 'Path',           'nvarchar(500)', 0),
('dbo', 'UserActivity', 'StatusCode',     'int',           0),
('dbo', 'UserActivity', 'SubFeatureCode', 'nvarchar(50)',  1),
('dbo', 'UserActivity', 'Timestamp',      'datetime2',     0),
('dbo', 'UserActivity', 'UserId',         'nvarchar(256)', 0),
-- UserActivityDaily
('dbo', 'UserActivityDaily', 'Id',                      'bigint',        0),
('dbo', 'UserActivityDaily', 'ActivityDate',            'date',          0),
('dbo', 'UserActivityDaily', 'CallClicks',              'int',           0),
('dbo', 'UserActivityDaily', 'ContractsViewed',         'int',           0),
('dbo', 'UserActivityDaily', 'CustomersViewed',         'int',           0),
('dbo', 'UserActivityDaily', 'EmailClicks',             'int',           0),
('dbo', 'UserActivityDaily', 'ListsBuilt',              'int',           0),
('dbo', 'UserActivityDaily', 'NotesCreated',            'int',           0),
('dbo', 'UserActivityDaily', 'PlantingIntentionsAdded', 'int',           0),
('dbo', 'UserActivityDaily', 'ProducerDetailsViewed',   'int',           0),
('dbo', 'UserActivityDaily', 'RequestCount',            'int',           0),
('dbo', 'UserActivityDaily', 'SessionCount',            'int',           0),
('dbo', 'UserActivityDaily', 'TotalSessionMinutes',     'int',           0),
('dbo', 'UserActivityDaily', 'UserId',                  'nvarchar(256)', 0),
-- UserClickEvent
('dbo', 'UserClickEvent', 'Id',             'bigint',        0),
('dbo', 'UserClickEvent', 'EventType',      'nvarchar(50)',  0),
('dbo', 'UserClickEvent', 'FeatureCode',    'nvarchar(50)',  0),
('dbo', 'UserClickEvent', 'SubFeatureCode', 'nvarchar(50)',  1),
('dbo', 'UserClickEvent', 'TargetId',       'nvarchar(200)', 1),
('dbo', 'UserClickEvent', 'Timestamp',      'datetime2',     0),
('dbo', 'UserClickEvent', 'UserId',         'nvarchar(256)', 0),
-- UserFeatureUsageDaily (per-user-per-feature daily rollup; backs the dashboard's
--   feature panels for closed days and is the only usage history past raw retention)
('dbo', 'UserFeatureUsageDaily', 'Id',               'bigint',        0),
('dbo', 'UserFeatureUsageDaily', 'ActivityDate',     'date',          0),
('dbo', 'UserFeatureUsageDaily', 'FeatureCode',      'nvarchar(50)',  0),
('dbo', 'UserFeatureUsageDaily', 'InteractionCount', 'int',           0),
('dbo', 'UserFeatureUsageDaily', 'RequestCount',     'int',           0),
('dbo', 'UserFeatureUsageDaily', 'ScreenMinutes',    'float',         0),
('dbo', 'UserFeatureUsageDaily', 'SubFeatureCode',   'nvarchar(50)',  0),
('dbo', 'UserFeatureUsageDaily', 'UserId',           'nvarchar(256)', 0),
-- UserPreferences
('dbo', 'UserPreferences', 'Id',                 'int',            0),
('dbo', 'UserPreferences', 'SelectedGroupNames', 'nvarchar(2000)', 0),
('dbo', 'UserPreferences', 'SelectedTradeUnits', 'nvarchar(2000)', 0),
('dbo', 'UserPreferences', 'UpdatedAt',          'datetime2',      0),
('dbo', 'UserPreferences', 'UserId',             'nvarchar(256)',  0),
-- UserSession (DurationMinutes is a PERSISTED computed column; SQL Server marks
--   computed columns as NULLABLE regardless of input nullability, so expect NULL)
('dbo', 'UserSession', 'Id',               'bigint',        0),
('dbo', 'UserSession', 'DurationMinutes',  'int',           1),
('dbo', 'UserSession', 'LastActivityTime', 'datetime2',     0),
('dbo', 'UserSession', 'LoginTime',        'datetime2',     0),
('dbo', 'UserSession', 'UserId',           'nvarchar(256)', 0),
-- UserTradeUnitSnapshot (composite PK: UserId + TradeUnitCode)
('dbo', 'UserTradeUnitSnapshot', 'UserId',        'nvarchar(256)', 0),
('dbo', 'UserTradeUnitSnapshot', 'TradeUnitCode', 'nvarchar(100)', 0),
('dbo', 'UserTradeUnitSnapshot', 'DisplayName',   'nvarchar(255)', 0),
('dbo', 'UserTradeUnitSnapshot', 'GroupName',     'nvarchar(100)', 1),
('dbo', 'UserTradeUnitSnapshot', 'SnapshotDate',  'date',          0),
-- WeeklyLoginAggregate
('dbo', 'WeeklyLoginAggregate', 'Id',              'bigint',        0),
('dbo', 'WeeklyLoginAggregate', 'LoginCount',      'int',           0),
('dbo', 'WeeklyLoginAggregate', 'SessionCount',    'int',           0),
('dbo', 'WeeklyLoginAggregate', 'TotalSessionMin', 'int',           0),
('dbo', 'WeeklyLoginAggregate', 'UserId',          'nvarchar(256)', 0),
('dbo', 'WeeklyLoginAggregate', 'WeekStartDate',   'date',          0);

-- -----------------------------------------------------------------------------
-- ### UPDATE WHEN SCHEMA CHANGES ### — CHECK constraints (0)
-- The snapshot defines no CHECK constraints. Any CHECK constraint found in the
-- live DB will surface as a 'CheckConstraint.Extra' WARN.
-- -----------------------------------------------------------------------------
-- (no rows)

-- -----------------------------------------------------------------------------
-- ### UPDATE WHEN SCHEMA CHANGES ### — Unique indexes (15)
-- EF Core auto-names single-property unique indexes as IX_<table>_<column>;
-- this project uses explicit names (IX_*/UQ_*) for most indexes.
-- (NON-unique indexes such as IX_*_Timestamp are intentionally NOT listed.)
-- -----------------------------------------------------------------------------
INSERT INTO @UniqueIndexes (SchemaName, TableName, IndexName) VALUES
('dbo', 'BidSheetLocationBids',        'UQ_BidSheetLocationBids_Location_Commodity_Year_Month'),
('dbo', 'BidSheetLocationOrders',      'UQ_BidSheetLocationOrders_User_TradeUnitKey'),
('dbo', 'BidSheetPreferences',         'UQ_BidSheetPreferences_User_TradeUnitKey'),
('dbo', 'Commodities',                 'IX_Commodities_Code'),
('dbo', 'CustomerCommodity',           'UQ_CustomerCommodity_Customer_Commodity'),
('dbo', 'CustomerLink',                'UQ_CustomerLink_From_To'),
('dbo', 'CustomerTradeUnit',           'UQ_CustomerTradeUnit_CustomerId_TradeUnit'),
('dbo', 'DashboardMarketShares',       'UQ_DashboardMarketShares_TradeUnitKey_CropCategory_PlantingYear'),
('dbo', 'DashboardPlantingEstimates',  'UQ_DashboardPlantingEstimates_TradeUnitKey_Crop_PlantingYear'),
('dbo', 'ESignEnrollment',             'UQ_eSignEnrollment_CustomerCode'),
('dbo', 'FeatureUsageDaily',           'UQ_FeatureUsageDaily'),
('dbo', 'ProducerDetails',             'IX_ProducerDetails_CustomerId'),
('dbo', 'UserActivityDaily',           'UQ_UserActivityDaily_UserId_Date'),
('dbo', 'UserFeatureUsageDaily',       'UQ_UserFeatureUsageDaily'),
('dbo', 'UserPreferences',             'UQ_UserPreferences_UserId'),
('dbo', 'WeeklyLoginAggregate',        'UQ_WeeklyLoginAggregate');

-- -----------------------------------------------------------------------------
-- ### UPDATE WHEN SCHEMA CHANGES ### — Migrations (26; see KNOWN PRE-EXISTING GAPS in the header)
-- -----------------------------------------------------------------------------
INSERT INTO @Migrations (MigrationId) VALUES
('20260310202402_AddESignEnrollment'),
('20260311165130_ReshapeAppTables'),
('20260311180519_AddNoteCustomerCode'),
('20260313170311_AddUserPreferences'),
('20260430164629_RenameSourceCustomerIdToScoularId'),
('20260513051734_RemoveTradeUnitCatalog'),
('20260513152851_CreateCustomerAndCustomerTradeUnit'),
('20260513185441_DropCustomerSnapshot'),
('20260513195804_AddCustomerFkAndCustomerLink'),
('20260513203133_DropRedundantCustomerColumns'),
('20260513213122_CreateCustomerCommodity'),
('20260513214615_DropProducerDetailsCommodities'),
('20260527130807_AddIsManualFlags'),
('20260602150513_AddShowInPlantingIntentions'),
('20260602181004_FlagSwwDnswForPlantingIntentions'),
('20260602201243_AddCanolaMilletPlantingDropWhiteMilo'),
('20260603200941_RemoveCasmFromPlantingIntentions'),
('20260604150610_AddUserDeactivatedToCustomerTradeUnit'),
('20260609161126_AddPrintLayoutToBidSheetPreference'),
('20260811142608_AddBarchartFeed'),
('20260812143729_AddCoverageQueryLibraryItems'),
('20260821124557_AddBarchartPublishableBidView'),
('20260824132811_AddBasisBidColumns'),
('20260824133524_AddBasisToPublishableBidView'),
('20260824134238_AddPriceModePreference'),
('20260824140609_UsePriceModeForStaleQuotes');

-- =============================================================================
-- Collect every discrepancy into @Findings.
-- The ActualCols CTE reconstructs the SQL type string from sys.columns to match
-- the expected format: 'nvarchar(20)', 'nvarchar(max)', 'decimal(12,2)', 'int',
-- 'bigint', 'float', 'date', 'bit', 'datetime2', 'datetime2(3)', etc.
-- =============================================================================

;WITH ActualCols AS (
    SELECT
        s.name AS SchemaName,
        t.name AS TableName,
        c.name AS ColumnName,
        CASE TYPE_NAME(c.user_type_id)
            WHEN 'nvarchar' THEN
                CASE WHEN c.max_length = -1 THEN N'nvarchar(max)'
                     ELSE N'nvarchar(' + CAST(c.max_length/2 AS nvarchar(10)) + N')' END
            WHEN 'nchar' THEN
                N'nchar(' + CAST(c.max_length/2 AS nvarchar(10)) + N')'
            WHEN 'varchar' THEN
                CASE WHEN c.max_length = -1 THEN N'varchar(max)'
                     ELSE N'varchar(' + CAST(c.max_length AS nvarchar(10)) + N')' END
            WHEN 'char' THEN
                N'char(' + CAST(c.max_length AS nvarchar(10)) + N')'
            WHEN 'varbinary' THEN
                CASE WHEN c.max_length = -1 THEN N'varbinary(max)'
                     ELSE N'varbinary(' + CAST(c.max_length AS nvarchar(10)) + N')' END
            WHEN 'decimal' THEN
                N'decimal(' + CAST(c.precision AS nvarchar(10)) + N','
                            + CAST(c.scale     AS nvarchar(10)) + N')'
            WHEN 'numeric' THEN
                N'numeric(' + CAST(c.precision AS nvarchar(10)) + N','
                            + CAST(c.scale     AS nvarchar(10)) + N')'
            WHEN 'datetime2' THEN
                -- default datetime2 scale is 7; render scale only when non-default
                CASE WHEN c.scale = 7 THEN N'datetime2'
                     ELSE N'datetime2(' + CAST(c.scale AS nvarchar(10)) + N')' END
            ELSE TYPE_NAME(c.user_type_id)
        END AS SqlType,
        c.is_nullable AS IsNullable
    FROM sys.columns c
    INNER JOIN sys.tables  t ON c.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
)
INSERT INTO @Findings (SortBucket, Category, Item, Expected, Actual, Status)

    -- ---- Missing tables ----
    SELECT 10, 'Table',
           '[' + e.SchemaName + '].[' + e.TableName + ']',
           'present', 'MISSING', 'FAIL'
    FROM @Tables e
    WHERE NOT EXISTS (
        SELECT 1 FROM sys.tables t
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = e.SchemaName AND t.name = e.TableName
    )

    UNION ALL

    -- ---- Extra tables (DB ahead of snapshot) ----
    --      Ignores: __EFMigrationsHistory (EF own), sysdiagrams (SSMS auto-creates)
    SELECT 11, 'Table.Extra',
           '[' + s.name + '].[' + t.name + ']',
           'listed in snapshot', 'EXTRA', 'WARN'
    FROM sys.tables t
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'dbo'
      AND t.name NOT IN ('__EFMigrationsHistory', 'sysdiagrams')
      AND NOT EXISTS (
          SELECT 1 FROM @Tables e
          WHERE e.SchemaName = s.name AND e.TableName = t.name
      )

    UNION ALL

    -- ---- Missing columns ----
    SELECT 20, 'Column.Missing',
           '[' + e.SchemaName + '].[' + e.TableName + '].[' + e.ColumnName + ']',
           'present', 'MISSING', 'FAIL'
    FROM @Columns e
    WHERE EXISTS (
        SELECT 1 FROM sys.tables t
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = e.SchemaName AND t.name = e.TableName
    )
    AND NOT EXISTS (
        SELECT 1 FROM ActualCols a
        WHERE a.SchemaName = e.SchemaName
          AND a.TableName  = e.TableName
          AND a.ColumnName = e.ColumnName
    )

    UNION ALL

    -- ---- Column type mismatch ----
    SELECT 21, 'Column.Type',
           '[' + e.SchemaName + '].[' + e.TableName + '].[' + e.ColumnName + ']',
           e.SqlType, a.SqlType, 'FAIL'
    FROM @Columns e
    INNER JOIN ActualCols a
      ON a.SchemaName = e.SchemaName
     AND a.TableName  = e.TableName
     AND a.ColumnName = e.ColumnName
    WHERE a.SqlType <> e.SqlType

    UNION ALL

    -- ---- Column nullability mismatch ----
    SELECT 22, 'Column.Nullability',
           '[' + e.SchemaName + '].[' + e.TableName + '].[' + e.ColumnName + ']',
           CASE e.IsNullable WHEN 0 THEN 'NOT NULL' ELSE 'NULL' END,
           CASE a.IsNullable WHEN 0 THEN 'NOT NULL' ELSE 'NULL' END,
           'FAIL'
    FROM @Columns e
    INNER JOIN ActualCols a
      ON a.SchemaName = e.SchemaName
     AND a.TableName  = e.TableName
     AND a.ColumnName = e.ColumnName
    WHERE a.IsNullable <> e.IsNullable

    UNION ALL

    -- ---- Extra columns (DB ahead of snapshot) ----
    SELECT 23, 'Column.Extra',
           '[' + a.SchemaName + '].[' + a.TableName + '].[' + a.ColumnName + ']',
           'listed in snapshot', 'EXTRA', 'WARN'
    FROM ActualCols a
    INNER JOIN @Tables t
      ON t.SchemaName = a.SchemaName AND t.TableName = a.TableName
    WHERE NOT EXISTS (
        SELECT 1 FROM @Columns e
        WHERE e.SchemaName = a.SchemaName
          AND e.TableName  = a.TableName
          AND e.ColumnName = a.ColumnName
    )

    UNION ALL

    -- ---- Missing CHECK constraints ----
    SELECT 30, 'CheckConstraint.Missing',
           '[' + e.SchemaName + '].[' + e.ConstraintName + ']',
           'present', 'MISSING', 'FAIL'
    FROM @CheckConstraints e
    WHERE NOT EXISTS (
        SELECT 1 FROM sys.check_constraints cc
        INNER JOIN sys.schemas s ON cc.schema_id = s.schema_id
        WHERE s.name = e.SchemaName AND cc.name = e.ConstraintName
    )

    UNION ALL

    -- ---- Extra CHECK constraints (in DB, not in snapshot) ----
    SELECT 31, 'CheckConstraint.Extra',
           '[' + s.name + '].[' + cc.name + ']',
           'listed in snapshot', 'EXTRA', 'WARN'
    FROM sys.check_constraints cc
    INNER JOIN sys.schemas s ON cc.schema_id = s.schema_id
    WHERE s.name = 'dbo'
      AND NOT EXISTS (
          SELECT 1 FROM @CheckConstraints e
          WHERE e.SchemaName = s.name AND e.ConstraintName = cc.name
      )

    UNION ALL

    -- ---- Missing unique indexes ----
    SELECT 40, 'UniqueIndex.Missing',
           '[' + e.SchemaName + '].[' + e.TableName + '].[' + e.IndexName + ']',
           'present', 'MISSING', 'FAIL'
    FROM @UniqueIndexes e
    WHERE NOT EXISTS (
        SELECT 1 FROM sys.indexes i
        INNER JOIN sys.tables  t ON i.object_id = t.object_id
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = e.SchemaName
          AND t.name = e.TableName
          AND i.name = e.IndexName
    )

    UNION ALL

    -- ---- Extra unique indexes (in DB, not in snapshot) ----
    --      Excludes sysdiagrams (SSMS auto-creates UK_principal_name)
    SELECT 41, 'UniqueIndex.Extra',
           '[' + s.name + '].[' + t.name + '].[' + i.name + ']',
           'listed in snapshot', 'EXTRA', 'WARN'
    FROM sys.indexes i
    INNER JOIN sys.tables  t ON i.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'dbo'
      AND i.is_unique = 1 AND i.is_primary_key = 0
      AND i.name IS NOT NULL
      AND t.name <> 'sysdiagrams'
      AND NOT EXISTS (
          SELECT 1 FROM @UniqueIndexes e
          WHERE e.SchemaName = s.name AND e.TableName = t.name AND e.IndexName = i.name
      )

    UNION ALL

    -- ---- Missing migrations (env behind code) ----
    SELECT 50, 'Migration.Missing',
           e.MigrationId, 'applied', 'MISSING', 'FAIL'
    FROM @Migrations e
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.__EFMigrationsHistory h
        WHERE h.MigrationId = e.MigrationId
    )

    UNION ALL

    -- ---- BarChart diagnostic view vs reality ----
    -- vw_BarchartPublishableBid re-implements the bridge's rules so it can explain a missing bid, which
    -- means it can drift from the bridge and start lying. Every winner it names should be on the sheet
    -- as a feed-owned cell with the same value. A mismatch means one of the two was changed alone.
    -- Skipped when no bids have been published yet (nothing to compare) or when a caller used a
    -- non-default maxQuoteAgeDays, which legitimately produces a different set.
    SELECT 55, 'Barchart.ViewDrift',
           CAST(COUNT(*) AS nvarchar(20)) + ' winner(s) disagree with the published cell',
           '0', CAST(COUNT(*) AS nvarchar(20)), 'WARN'
    FROM dbo.vw_BarchartPublishableBid AS v
    LEFT JOIN dbo.BidSheetLocationBids AS b
        ON b.LocationId    = v.LocationId
       AND b.CommodityCode = v.CommodityCode
       AND b.CropYear      = v.CropYear
       AND b.Month         = v.BidMonth
       AND b.Source        = N'Barchart'
    WHERE v.WinnerRank = 1
      AND EXISTS (SELECT 1 FROM dbo.BidSheetLocationBids WHERE Source = N'Barchart')
      AND (b.Id IS NULL OR b.Bid <> FORMAT(v.LastPrice, N'0.00##', N'en-US'))
    HAVING COUNT(*) > 0

    UNION ALL

    -- ---- Extra migrations (env ahead of code — someone forgot to pull) ----
    SELECT 51, 'Migration.Extra',
           h.MigrationId, 'listed in code', 'EXTRA', 'WARN'
    FROM dbo.__EFMigrationsHistory h
    WHERE NOT EXISTS (
        SELECT 1 FROM @Migrations e
        WHERE e.MigrationId = h.MigrationId
    );

-- =============================================================================
-- Result: one "all clear" row, or one row per problem (FAIL first).
-- =============================================================================
IF NOT EXISTS (SELECT 1 FROM @Findings)
    SELECT
        'OK' AS Status,
        'Database is current — '
            + CAST((SELECT COUNT(*) FROM @Tables)        AS varchar(10)) + ' tables, '
            + CAST((SELECT COUNT(*) FROM @Columns)       AS varchar(10)) + ' columns, '
            + CAST((SELECT COUNT(*) FROM @UniqueIndexes) AS varchar(10)) + ' unique indexes, and '
            + CAST((SELECT COUNT(*) FROM @Migrations)    AS varchar(10)) + ' migrations all verified.'
            AS Message;
ELSE
    SELECT
        Category,
        Item,
        Expected,
        Actual,
        Status
    FROM @Findings
    ORDER BY
        CASE Status WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END,
        SortBucket,
        Item;
