-- =====================================================
-- QA Database Setup Script
-- Creates all missing app tables for Origination DB
-- Run against: azrscosqlq01.database.windows.net / Origination
-- =====================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Notes' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[Notes] (
        [Id]           int           NOT NULL IDENTITY(1,1),
        [CustomerId]   bigint        NOT NULL,
        [CustomerName] nvarchar(200) NOT NULL,
        [CustomerCode] nvarchar(50)  NULL,
        [TradeUnit]    nvarchar(100) NULL,
        [Description]  nvarchar(max) NOT NULL,
        [CreatedBy]    nvarchar(200) NOT NULL,
        [CreatedAt]    datetime2     NOT NULL DEFAULT (GETUTCDATE()),
        [ModifiedBy]   nvarchar(200) NULL,
        [ModifiedAt]   datetime2     NULL,
        [IsPinned]     bit           NOT NULL DEFAULT (0),
        CONSTRAINT [PK_Notes] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_Notes_CustomerId] ON [dbo].[Notes] ([CustomerId]);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProducerDetails' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[ProducerDetails] (
        [Id]                 int            NOT NULL IDENTITY(1,1),
        [CustomerId]         bigint         NOT NULL,
        [SourceCustomerId]   nvarchar(400)  NULL,
        [CustomerName]       nvarchar(255)  NOT NULL,
        [TotalAcres]         decimal(18,2)  NULL,
        [BinCapacity]        decimal(18,2)  NULL,
        [PrimaryContact]     nvarchar(255)  NULL,
        [Commodities]        nvarchar(1000) NULL,
        [LinkedProducerIds]  nvarchar(1000) NULL,
        [CreatedBy]          nvarchar(255)  NOT NULL,
        [CreatedAt]          datetime2      NOT NULL DEFAULT (GETUTCDATE()),
        [ModifiedBy]         nvarchar(255)  NULL,
        [ModifiedAt]         datetime2      NULL,
        CONSTRAINT [PK_ProducerDetails] PRIMARY KEY ([Id])
    );
    CREATE UNIQUE INDEX [IX_ProducerDetails_CustomerId] ON [dbo].[ProducerDetails] ([CustomerId]);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProducerPlantingIntentions' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[ProducerPlantingIntentions] (
        [Id]           int           NOT NULL IDENTITY(1,1),
        [CustomerId]   bigint        NOT NULL,
        [CustomerName] nvarchar(255) NOT NULL,
        [CustomerCode] nvarchar(50)  NOT NULL,
        [TradeUnit]    nvarchar(100) NOT NULL,
        [PlantingYear] int           NOT NULL,
        [Crop]         nvarchar(100) NOT NULL,
        [Type]         nvarchar(100) NULL,
        [Description]  nvarchar(255) NULL,
        [Acres]        int           NOT NULL,
        [CreatedAt]    datetime2     NOT NULL DEFAULT (GETUTCDATE()),
        [CreatedBy]    nvarchar(255) NOT NULL,
        [ModifiedAt]   datetime2     NULL,
        [ModifiedBy]   nvarchar(255) NULL,
        CONSTRAINT [PK_ProducerPlantingIntentions] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProducerPlantingIntentions_CustomerId] ON [dbo].[ProducerPlantingIntentions] ([CustomerId]);
    CREATE INDEX [IX_ProducerPlantingIntentions_TradeUnit]  ON [dbo].[ProducerPlantingIntentions] ([TradeUnit]);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TradeUnits' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[TradeUnits] (
        [Id]       int           NOT NULL IDENTITY(1,1),
        [Code]     nvarchar(100) NOT NULL,
        [IsActive] bit           NOT NULL DEFAULT (1),
        CONSTRAINT [PK_TradeUnits] PRIMARY KEY ([Id])
    );
    CREATE UNIQUE INDEX [IX_TradeUnits_Code] ON [dbo].[TradeUnits] ([Code]);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TradeUnitGroups' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[TradeUnitGroups] (
        [Id]        int           NOT NULL IDENTITY(1,1),
        [GroupName] nvarchar(100) NOT NULL,
        [IsActive]  bit           NOT NULL DEFAULT (1),
        CONSTRAINT [PK_TradeUnitGroups] PRIMARY KEY ([Id])
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GroupTradeUnits' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[GroupTradeUnits] (
        [Id]            int           NOT NULL IDENTITY(1,1),
        [GroupId]       int           NOT NULL,
        [TradeUnitCode] nvarchar(100) NOT NULL,
        [Location]      nvarchar(200) NULL,
        [IsActive]      bit           NOT NULL DEFAULT (1),
        CONSTRAINT [PK_GroupTradeUnits] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_GroupTradeUnits_TradeUnitGroups] FOREIGN KEY ([GroupId]) REFERENCES [dbo].[TradeUnitGroups] ([Id])
    );
    CREATE INDEX [IX_GroupTradeUnits_TradeUnitCode] ON [dbo].[GroupTradeUnits] ([TradeUnitCode]);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Commodities' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[Commodities] (
        [Id]       int           NOT NULL IDENTITY(1,1),
        [Code]     nvarchar(100) NOT NULL,
        [Name]     nvarchar(255) NOT NULL,
        [Category] nvarchar(100) NULL,
        [IsActive] bit           NOT NULL DEFAULT (1),
        CONSTRAINT [PK_Commodities] PRIMARY KEY ([Id])
    );
    CREATE UNIQUE INDEX [IX_Commodities_Code] ON [dbo].[Commodities] ([Code]);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardPlantingEstimates' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[DashboardPlantingEstimates] (
        [Id]           int            NOT NULL IDENTITY(1,1),
        [TradeUnitKey] nvarchar(500)  NOT NULL,
        [Crop]         nvarchar(100)  NOT NULL,
        [PlantingYear] int            NOT NULL,
        [YieldEstimate] decimal(10,2) NULL,
        [CreatedAt]    datetime2      NOT NULL DEFAULT (GETUTCDATE()),
        [CreatedBy]    nvarchar(255)  NOT NULL,
        [ModifiedAt]   datetime2      NULL,
        [ModifiedBy]   nvarchar(255)  NULL,
        CONSTRAINT [PK_DashboardPlantingEstimates] PRIMARY KEY ([Id])
    );
    CREATE UNIQUE INDEX [UQ_DashboardPlantingEstimates_TradeUnitKey_Crop_PlantingYear]
        ON [dbo].[DashboardPlantingEstimates] ([TradeUnitKey], [Crop], [PlantingYear]);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardMarketShares' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[DashboardMarketShares] (
        [Id]             int           NOT NULL IDENTITY(1,1),
        [TradeUnitKey]   nvarchar(500) NOT NULL,
        [CropCategory]   nvarchar(100) NOT NULL,
        [PlantingYear]   int           NOT NULL,
        [MarketSharePct] decimal(5,2)  NULL,
        [CreatedAt]      datetime2     NOT NULL DEFAULT (GETUTCDATE()),
        [CreatedBy]      nvarchar(255) NOT NULL,
        [ModifiedAt]     datetime2     NULL,
        [ModifiedBy]     nvarchar(255) NULL,
        CONSTRAINT [PK_DashboardMarketShares] PRIMARY KEY ([Id])
    );
    CREATE UNIQUE INDEX [UQ_DashboardMarketShares_TradeUnitKey_CropCategory_PlantingYear]
        ON [dbo].[DashboardMarketShares] ([TradeUnitKey], [CropCategory], [PlantingYear]);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardActualHarvests' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[DashboardActualHarvests] (
        [Id]           int           NOT NULL IDENTITY(1,1),
        [TradeUnitKey] nvarchar(500) NOT NULL,
        [CropCategory] nvarchar(100) NOT NULL,
        [PlantingYear] int           NOT NULL,
        [Bushels]      int           NOT NULL,
        [CreatedAt]    datetime2     NOT NULL DEFAULT (GETUTCDATE()),
        [CreatedBy]    nvarchar(255) NOT NULL,
        [ModifiedAt]   datetime2     NULL,
        [ModifiedBy]   nvarchar(255) NULL,
        CONSTRAINT [PK_DashboardActualHarvests] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_DashboardActualHarvests_TradeUnitKey_PlantingYear]
        ON [dbo].[DashboardActualHarvests] ([TradeUnitKey], [PlantingYear]);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SavedLists' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[SavedLists] (
        [Id]         int           NOT NULL IDENTITY(1,1),
        [Name]       nvarchar(100) NOT NULL,
        [Query]      nvarchar(500) NOT NULL,
        [TradeUnits] nvarchar(500) NULL,
        [Filters]    nvarchar(max) NULL,
        [CreatedBy]  nvarchar(255) NOT NULL,
        [CreatedAt]  datetime2     NOT NULL DEFAULT (GETUTCDATE()),
        [ModifiedAt] datetime2     NULL,
        [ModifiedBy] nvarchar(255) NULL,
        [IsActive]   bit           NOT NULL DEFAULT (1),
        CONSTRAINT [PK_SavedLists] PRIMARY KEY ([Id])
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserPreferences' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE [dbo].[UserPreferences] (
        [Id]                  int            NOT NULL IDENTITY(1,1),
        [UserId]              nvarchar(256)  NOT NULL,
        [SelectedGroupNames]  nvarchar(2000) NOT NULL DEFAULT ('[]'),
        [SelectedTradeUnits]  nvarchar(2000) NOT NULL DEFAULT ('[]'),
        [UpdatedAt]           datetime2      NOT NULL,
        CONSTRAINT [PK_UserPreferences] PRIMARY KEY ([Id])
    );
    CREATE UNIQUE INDEX [UQ_UserPreferences_UserId] ON [dbo].[UserPreferences] ([UserId]);
END

-- Sync migration history so EF knows all migrations are applied
INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
SELECT '20260203213531_AddCustomerForeignKeys', '10.0.3'
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory] WHERE [MigrationId] = '20260203213531_AddCustomerForeignKeys');

INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
SELECT '20260311180519_AddNoteCustomerCode', '10.0.3'
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory] WHERE [MigrationId] = '20260311180519_AddNoteCustomerCode');

INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
SELECT '20260313170311_AddUserPreferences', '10.0.3'
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory] WHERE [MigrationId] = '20260313170311_AddUserPreferences');
