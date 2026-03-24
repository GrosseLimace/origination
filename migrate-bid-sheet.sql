-- ============================================================
-- BidSheet table migration
-- Run this in SSMS against the Origination application database
-- ============================================================

-- 1. Drop old tables
IF OBJECT_ID('dbo.BidSheetEntries', 'U') IS NOT NULL
    DROP TABLE dbo.BidSheetEntries;

IF OBJECT_ID('dbo.BidReferences', 'U') IS NOT NULL
    DROP TABLE dbo.BidReferences;

-- 2. Create BidSheetLocations
CREATE TABLE dbo.BidSheetLocations (
    Id              INT IDENTITY(1,1)   NOT NULL,
    Name            NVARCHAR(200)       NOT NULL,
    Address         NVARCHAR(300)       NULL,
    City            NVARCHAR(100)       NULL,
    State           NVARCHAR(10)        NULL,
    Latitude        FLOAT               NULL,
    Longitude       FLOAT               NULL,
    ElevatorCode    NVARCHAR(50)        NULL,
    TradeUnitCode   NVARCHAR(100)       NOT NULL,
    GroupName       NVARCHAR(200)       NULL,
    CreatedBy       NVARCHAR(255)       NOT NULL,
    CreatedAt       DATETIME2           NOT NULL DEFAULT GETUTCDATE(),
    ModifiedBy      NVARCHAR(255)       NULL,
    ModifiedAt      DATETIME2           NULL,
    CONSTRAINT PK_BidSheetLocations PRIMARY KEY (Id)
);

CREATE INDEX IX_BidSheetLocations_TradeUnitCode
    ON dbo.BidSheetLocations (TradeUnitCode);

-- 3. Create BidSheetLocationBids (FK → BidSheetLocations, cascade delete)
CREATE TABLE dbo.BidSheetLocationBids (
    Id                  INT IDENTITY(1,1)   NOT NULL,
    LocationId          INT                 NOT NULL,
    CommodityCode       NVARCHAR(50)        NOT NULL,
    CommodityName       NVARCHAR(200)       NULL,
    CommodityCategory   NVARCHAR(100)       NULL,
    CropYear            INT                 NOT NULL,
    Bid                 NVARCHAR(50)        NOT NULL,
    CreatedBy           NVARCHAR(255)       NOT NULL,
    CreatedAt           DATETIME2           NOT NULL DEFAULT GETUTCDATE(),
    ModifiedBy          NVARCHAR(255)       NULL,
    ModifiedAt          DATETIME2           NULL,
    CONSTRAINT PK_BidSheetLocationBids PRIMARY KEY (Id),
    CONSTRAINT FK_BidSheetLocationBids_BidSheetLocations_LocationId
        FOREIGN KEY (LocationId) REFERENCES dbo.BidSheetLocations (Id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX UQ_BidSheetLocationBids_Location_Commodity_Year
    ON dbo.BidSheetLocationBids (LocationId, CommodityCode, CropYear);

-- 4. Record migration in EF history table
IF NOT EXISTS (
    SELECT 1 FROM dbo.__EFMigrationsHistory
    WHERE MigrationId = '20260324000000_ReplaceBidSheetTables'
)
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion)
    VALUES ('20260324000000_ReplaceBidSheetTables', '10.0.3');
