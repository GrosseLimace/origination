-- 45Z documents: version history on dbo.FieldPlanDocument (migration 20261105210201_AddFieldPlanDocumentVersions).
-- Adds seven columns: FieldName, and Status (Current / Overwritten / Archived, default Current) with who changed it,
-- when, the archive reason and, for an overwritten report or ledger, the document that replaced it. Rows already in
-- the table become Current. Touches no other table. Runs after field-plan-AddFieldPlanDocument.sql (it alters that
-- table). The deploy applies the migration itself; this script is for review, or for a DBA applying QA/PROD by hand.
-- XACT_ABORT: any failed statement rolls the whole transaction back, so the migration is never recorded without its change.
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105210201_AddFieldPlanDocumentVersions'
)
BEGIN
    ALTER TABLE [dbo].[FieldPlanDocument] ADD [FieldName] nvarchar(255) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105210201_AddFieldPlanDocumentVersions'
)
BEGIN
    ALTER TABLE [dbo].[FieldPlanDocument] ADD [ReplacedByDocStoreId] nvarchar(36) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105210201_AddFieldPlanDocumentVersions'
)
BEGIN
    ALTER TABLE [dbo].[FieldPlanDocument] ADD [Status] nvarchar(20) NOT NULL DEFAULT N'Current';
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105210201_AddFieldPlanDocumentVersions'
)
BEGIN
    ALTER TABLE [dbo].[FieldPlanDocument] ADD [StatusChangedAt] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105210201_AddFieldPlanDocumentVersions'
)
BEGIN
    ALTER TABLE [dbo].[FieldPlanDocument] ADD [StatusChangedBy] nvarchar(255) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105210201_AddFieldPlanDocumentVersions'
)
BEGIN
    ALTER TABLE [dbo].[FieldPlanDocument] ADD [StatusChangedByName] nvarchar(255) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105210201_AddFieldPlanDocumentVersions'
)
BEGIN
    ALTER TABLE [dbo].[FieldPlanDocument] ADD [StatusNote] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261105210201_AddFieldPlanDocumentVersions'
)
BEGIN
    INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261105210201_AddFieldPlanDocumentVersions', N'10.0.1');
END;

COMMIT;
GO

