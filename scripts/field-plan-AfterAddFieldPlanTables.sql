-- XACT_ABORT: any failed statement (e.g. the unique index meeting duplicate rows) rolls the whole transaction back,
-- so a migration is never recorded without its change.
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103215107_DropProgramEnrollment'
)
BEGIN
    DROP TABLE IF EXISTS [dbo].[ProgramEnrollment];
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103215107_DropProgramEnrollment'
)
BEGIN
    INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261103215107_DropProgramEnrollment', N'10.0.3');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103220955_AddFieldSeasonUniqueRow'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UQ_ProducerFieldSeason_Field_PlantingIntention] ON [dbo].[ProducerFieldSeason] ([ProducerFieldId], [PlantingIntentionId]) WHERE [IsDeleted] = 0');
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261103220955_AddFieldSeasonUniqueRow'
)
BEGIN
    INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261103220955_AddFieldSeasonUniqueRow', N'10.0.3');
END;

COMMIT;
GO

