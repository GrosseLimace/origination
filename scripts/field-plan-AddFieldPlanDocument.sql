-- 45Z documents: dbo.FieldPlanDocument (migration 20261105151619_AddFieldPlanDocument). One row per document kept in
-- Doc Store (category Sustainability-45z), because Doc Store cannot list a category's documents by metadata.
-- Creates one new table and its indexes; touches no existing table or row. The deploy applies the migration itself;
-- this script is for review, or for a DBA applying QA/PROD by hand (it records the migration, so the deploy skips it).
-- XACT_ABORT: any failed statement rolls the whole transaction back, so the migration is never recorded without its change.
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105151619_AddFieldPlanDocument'
)
BEGIN
    CREATE TABLE [dbo].[FieldPlanDocument] (
        [Id] int NOT NULL IDENTITY,
        [DocStoreId] nvarchar(36) NOT NULL,
        [CustomerId] bigint NOT NULL,
        [CropYear] int NOT NULL,
        [DocumentType] nvarchar(30) NOT NULL,
        [FieldProgramRecordId] int NULL,
        [SplitId] nvarchar(20) NULL,
        [Commodity] nvarchar(100) NULL,
        [FileName] nvarchar(255) NOT NULL,
        [ContentType] nvarchar(100) NOT NULL,
        [SizeBytes] bigint NOT NULL,
        [CreatedAt] datetime2 NOT NULL DEFAULT (GETUTCDATE()),
        [CreatedBy] nvarchar(255) NOT NULL,
        [CreatedByName] nvarchar(255) NULL,
        CONSTRAINT [PK_FieldPlanDocument] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_FieldPlanDocument_Customer_CustomerId] FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customer] ([CustomerId]),
        CONSTRAINT [FK_FieldPlanDocument_FieldProgramRecord_FieldProgramRecordId] FOREIGN KEY ([FieldProgramRecordId]) REFERENCES [dbo].[FieldProgramRecord] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105151619_AddFieldPlanDocument'
)
BEGIN
    CREATE INDEX [IX_FieldPlanDocument_Customer_CropYear] ON [dbo].[FieldPlanDocument] ([CustomerId], [CropYear]);
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105151619_AddFieldPlanDocument'
)
BEGIN
    CREATE INDEX [IX_FieldPlanDocument_FieldProgramRecordId] ON [dbo].[FieldPlanDocument] ([FieldProgramRecordId]);
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105151619_AddFieldPlanDocument'
)
BEGIN
    CREATE UNIQUE INDEX [UQ_FieldPlanDocument_DocStoreId] ON [dbo].[FieldPlanDocument] ([DocStoreId]);
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105151619_AddFieldPlanDocument'
)
BEGIN
    INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261105151619_AddFieldPlanDocument', N'10.0.1');
END;

COMMIT;
GO

